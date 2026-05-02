// UART frame parser — based on lleokaganov/uart protocol.
//
// Wire format:
//   [0xFE × n] 0x68  ADDR_LO ADDR_HI  0x68  CTRL  LEN  DATA(len)  CHK  [0x16]
//
// • Optional 0xFE preamble (idle bytes from RS-485 line).
// • 0x68 / 0x68 frame markers bracket the address.
// • CTRL high bit (0x80) = "answer" / reply from device.
// • Each data byte is shifted: wire = (logical + 0x33) & 0xFF, decode by subtracting.
// • CHK is the 8-bit sum of every byte from the leading 0x68 through the last data byte.
// • Trailing 0x16 is the line terminator.
//
// On top of the frame layer, we recognize a small dictionary of "exchanges" used
// by the Movicom BMS Mini S battery + the EV charger station. The BMS has a
// 16-bit address (0x31CE) and exposes three reply types depending on the
// requested chunk:
//
//   request d=[01 10]            → universal poll (model, serial, line ID)
//   request d=[02 2B]  reply 43B → BMS info (model + serial in ASCII)
//   request d=[2D 37]  reply 55B → 15B summary header + 20×2B cell voltages
//
// The summary header layout (taken from the original repo's parsing code):
//   d[0..1]   uint16 BE   pack voltage × 0.1 V
//   d[2..5]   int32  BE   pack current × 0.1 A  (signed)
//   d[6]      uint8       SOC %
//   d[7..9]   uint8 ×3    flag bytes (alarms / state)
//   d[10..14] uint8 ×5    temperatures °C  (T1..T5)
//
// The cells block is 20 little-endian-pair words at d[15..54], 0.1 mV each
// (typical readings ~4100 → 4.1 V).

(function (root) {
  function hex2(b) { return (b & 0xff).toString(16).toUpperCase().padStart(2, '0'); }
  function hex4(w) { return hex2((w >> 8) & 0xff) + hex2(w & 0xff); }

  function parseSampleText(text) {
    const bytes = [];
    const lineRanges = [];
    text.split('\n').forEach((ln) => {
      const start = bytes.length;
      ln.trim().split(/\s+/).forEach((tok) => {
        if (!tok) return;
        const v = parseInt(tok, 16);
        if (!Number.isNaN(v)) bytes.push(v);
      });
      if (bytes.length > start) lineRanges.push([start, bytes.length]);
    });
    return { bytes: Uint8Array.from(bytes), lineRanges };
  }

  function findFrame(buffer, from = 0) {
    for (let i = from; i <= buffer.length - 6; i++) {
      let j = i;
      while (j < buffer.length && buffer[j] === 0xfe) j++;
      const prefixLen = j - i;
      if (buffer.length <= j + 5) return null;
      if (buffer[j] !== 0x68 || buffer[j + 3] !== 0x68) continue;
      const len = buffer[j + 5];
      const frameLen = prefixLen + 6 + len + 1;
      if (buffer.length < i + frameLen) return null;
      let end = i + frameLen;
      let sm = 0;
      for (let k = j; k < end - 1; k++) sm = (sm + buffer[k]) & 0xff;
      const sumOk = sm === buffer[end - 1];
      let isEnd = 0;
      if (buffer[end] === 0x16) { end++; isEnd = 1; }
      const control = buffer[j + 4];
      const dataStart = j + 6;
      const encoded = buffer.slice(dataStart, dataStart + len);
      const data = new Uint8Array(encoded.length);
      for (let k = 0; k < encoded.length; k++) data[k] = (encoded[k] - 0x33) & 0xff;
      // The wire order is ADDR_LO ADDR_HI but humans read the bytes in their
      // appearance order so "68 20 DF 68" → "20DF" on screen.
      const addrHex = hex2(buffer[j + 1]) + hex2(buffer[j + 2]);
      const addr = (buffer[j + 1] << 8) | buffer[j + 2];
      return {
        start: i,
        end,
        addr,
        addrHex,
        len,
        code: control & 0x7f,
        codeHex: hex2(control),
        codeBare: hex2(control & 0x7f),
        control,
        isAnswer: !!(control & 0x80),
        sumOk,
        sumExpected: hex2(sm),
        sumActual: hex2(buffer[end - 1 - isEnd]),
        raw: buffer.slice(i, end),
        encoded,
        data,
        prefixLen,
        terminator: isEnd,
      };
    }
    return null;
  }

  function* iterateFrames(buffer) {
    let i = 0;
    while (i < buffer.length) {
      const f = findFrame(buffer, i);
      if (!f) break;
      yield f;
      i = f.end;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bit-flag dictionaries.
  //
  // In the live UART reply at d[7..9] the BMS packs three alarm bytes. The
  // exact bit map is not in the open-source repo; the entries below come from
  // the BMS Mini S CAN datasheet's state-flag groups (id 02A0/03A0) which are
  // the same bits routed to UART. Where unmapped the byte is shown raw.
  // ─────────────────────────────────────────────────────────────────────────
  const FLAG_BMS_BYTE_0 = [
    'pack open',
    'charger present',
    'power-down request',
    'charge inhibit',
    'discharge inhibit',
    'charge contactor fb',
    'discharge contactor fb',
    'isolation monitor',
  ];
  const FLAG_BMS_BYTE_1 = [
    'SOC below threshold',
    'charge current limit',
    'charge relay on',
    'charger enabled',
    'charging in progress',
    'discharge relay on',
    'discharging',
    'overvoltage (EV)',
  ];
  const FLAG_BMS_BYTE_2 = [
    'pack heating',
    'pack cooling',
    'aux contactor closed',
    'main contactor closed',
    'cell analysis active',
    'service reset',
    'precharge contactor',
    'WDT restart',
  ];
  function bitsOf(byte, table) {
    const out = [];
    for (let i = 0; i < 8; i++) {
      if (byte & (1 << i)) out.push({ bit: i, label: table[i] || `bit ${i}` });
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-byte annotation. Returns an array the same length as frame.data,
  // where each entry is { role, label, value }. role drives the colour in
  // the inspector and the byte stream highlight.
  // ─────────────────────────────────────────────────────────────────────────
  function annotateBytes(frame, interp) {
    const d = frame.data;
    const ann = new Array(d.length).fill(null).map((_, i) => ({
      role: 'data', label: '·', value: hex2(d[i]),
    }));

    if (interp.kind === 'bms-request') {
      if (d.length >= 1) ann[0] = { role: 'addr', label: 'chunk start', value: hex2(d[0]) };
      if (d.length >= 2) ann[1] = { role: 'addr', label: 'chunk length', value: hex2(d[1]) };
      return ann;
    }
    if (interp.kind === 'poll' || interp.kind === 'poll-reply') {
      // 20DF-02 universal poll: payload [01 10]
      if (d.length >= 1) ann[0] = { role: 'meta', label: 'poll cmd', value: hex2(d[0]) };
      if (d.length >= 2) ann[1] = { role: 'meta', label: 'poll arg', value: hex2(d[1]) };
      // poll-reply is an ASCII id string
      if (interp.kind === 'poll-reply') {
        for (let i = 0; i < d.length; i++) {
          if (d[i] >= 0x20 && d[i] < 0x7f) {
            ann[i] = { role: 'text', label: `chr "${String.fromCharCode(d[i])}"`, value: hex2(d[i]) };
          }
        }
      }
      return ann;
    }
    if (interp.kind === 'bms-info') {
      // First 7 bytes = model, bytes 7..22 = serial (ASCII).
      for (let i = 0; i < 7 && i < d.length; i++) {
        ann[i] = { role: 'text', label: `model[${i}]`, value: hex2(d[i]) };
      }
      for (let i = 7; i < 23 && i < d.length; i++) {
        ann[i] = { role: 'text', label: `serial[${i-7}]`, value: hex2(d[i]) };
      }
      // remaining bytes: misc / line-id
      for (let i = 23; i < d.length; i++) {
        ann[i] = { role: 'meta', label: `misc[${i-23}]`, value: hex2(d[i]) };
      }
      return ann;
    }
    if (interp.kind === 'bms-cells') {
      // 15-byte summary header
      if (d.length >= 2) {
        ann[0] = { role: 'val', label: 'V hi', value: hex2(d[0]) };
        ann[1] = { role: 'val', label: 'V lo', value: hex2(d[1]) };
      }
      for (let i = 2; i < 6 && i < d.length; i++) {
        ann[i] = { role: 'val', label: `A[${i-2}]`, value: hex2(d[i]) };
      }
      if (d.length > 6) ann[6] = { role: 'val', label: 'SOC', value: hex2(d[6]) };
      for (let i = 7; i < 10 && i < d.length; i++) {
        ann[i] = { role: 'flag', label: `flags[${i-7}]`, value: hex2(d[i]) };
      }
      for (let i = 10; i < 15 && i < d.length; i++) {
        ann[i] = { role: 'temp', label: `T${i-9}`, value: hex2(d[i]) };
      }
      // cells region
      for (let i = 15; i < d.length; i += 2) {
        const cellNo = ((i - 15) / 2) + 1;
        if (i < d.length) ann[i] = { role: 'cell', label: `c${cellNo} hi`, value: hex2(d[i]) };
        if (i + 1 < d.length) ann[i + 1] = { role: 'cell', label: `c${cellNo} lo`, value: hex2(d[i + 1]) };
      }
      return ann;
    }
    if (interp.kind === 'station-tx' || interp.kind === 'station-ack') {
      for (let i = 0; i < d.length; i++) ann[i].role = 'station';
      return ann;
    }
    if (interp.kind === 'aux') {
      for (let i = 0; i < d.length; i++) ann[i].role = 'aux';
      return ann;
    }
    if (interp.kind === 'meta') {
      for (let i = 0; i < d.length; i++) ann[i].role = 'meta';
      return ann;
    }
    return ann;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // High-level interpretation
  // ─────────────────────────────────────────────────────────────────────────
  function interpret(frame) {
    const id = frame.addrHex + '-' + frame.codeHex;
    const d = frame.data;
    const out = {
      id,
      addr: frame.addrHex,
      code: frame.codeHex,
      kind: 'unknown',
      summary: '',
      fields: [],   // { label, value, hint? } pairs surfaced in the inspector
      flagSet: [],  // [{ label, byte, bits: [{bit,label}] }]
    };
    const isReq = !frame.isAnswer;
    const isAns = frame.isAnswer;

    // ── BMS (0x31CE) ──────────────────────────────────────────────────────
    if (frame.addrHex === '31CE' && isReq && d.length >= 2) {
      out.kind = 'bms-request';
      const start = d[0], length = d[1];
      const named =
        (start === 0x01 && length === 0x10) ? ' · universal poll' :
        (start === 0x02 && length === 0x2b) ? ' · ask info'        :
        (start === 0x2d && length === 0x37) ? ' · ask cells'       : '';
      out.summary = `request 0x${hex2(start)} / 0x${hex2(length)} bytes${named}`;
      out.fields = [
        { label: 'chunk start', value: `0x${hex2(start)}` },
        { label: 'chunk length', value: `0x${hex2(length)} (${length})` },
      ];
      return out;
    }

    if (frame.addrHex === '31CE' && isAns) {
      if (d.length === 0x2b) {
        let serial = '';
        for (let i = 7; i < 23; i++) serial += String.fromCharCode(d[i]);
        let model = '';
        for (let i = 0; i < 7; i++) model += String.fromCharCode(d[i]);
        // Only keep printable ASCII (letters, digits, space and a few punct);
        // some firmware leaves these fields filled with 0x55 padding or status
        // bytes that should be treated as "no name available" by the consumer
        // view. The engineer view still sees the raw bytes via inspector.
        const clean = (s) => s.replace(/[^A-Za-z0-9 \-_.]/g, '').trim();
        out.kind = 'bms-info';
        out.serial = clean(serial);
        out.model  = clean(model);
        out.summary = `info · ${out.model || '—'} · S/N ${out.serial || '—'}`;
        out.fields = [
          { label: 'model',  value: out.model || '—', hint: 'bytes 0..6 ASCII' },
          { label: 'serial', value: out.serial || '—', hint: 'bytes 7..22 ASCII' },
        ];
        return out;
      }
      if (d.length >= 0x37) {
        out.kind = 'bms-cells';
        out.voltage = ((d[0] << 8) | d[1]) / 10;
        let cur = (d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5];
        out.current = (cur | 0) / 10;
        out.soc = d[6];
        out.flagBytes = [d[7], d[8], d[9]];
        out.flags = out.flagBytes.map(hex2).join(' ');
        out.temps = [d[10], d[11], d[12], d[13], d[14]];
        const cells = [];
        for (let i = 0; i < 20; i++) {
          const v = (d[15 + i * 2] << 8) | d[15 + i * 2 + 1];
          cells.push(v);
        }
        out.cells = cells;
        const present = cells.filter((v) => v > 0);
        out.cellMin = present.length ? Math.min(...present) : 0;
        out.cellMax = present.length ? Math.max(...cells)  : 0;
        out.cellSpread = out.cellMax - out.cellMin;
        out.summary = `${out.voltage.toFixed(1)}V  ${out.current.toFixed(1)}A  ${out.soc}%  ·  Δ${out.cellSpread} mV`;
        out.fields = [
          { label: 'pack voltage',  value: `${out.voltage.toFixed(1)} V`, hint: 'd[0..1] uint16 BE × 0.1' },
          { label: 'pack current',  value: `${out.current.toFixed(1)} A`, hint: 'd[2..5] int32 BE × 0.1 (signed)' },
          { label: 'state of charge', value: `${out.soc} %`,             hint: 'd[6] uint8' },
          { label: 'temperatures',  value: out.temps.map((t) => `${t}°`).join(' · '), hint: 'd[10..14] T1..T5 °C' },
          { label: 'cells (min/max/Δ)', value: `${out.cellMin} / ${out.cellMax} / ${out.cellSpread} mV`, hint: 'd[15..54] uint16 BE ×20' },
        ];
        out.flagSet = [
          { label: 'flags[0]', byte: d[7], bits: bitsOf(d[7], FLAG_BMS_BYTE_0) },
          { label: 'flags[1]', byte: d[8], bits: bitsOf(d[8], FLAG_BMS_BYTE_1) },
          { label: 'flags[2]', byte: d[9], bits: bitsOf(d[9], FLAG_BMS_BYTE_2) },
        ];
        return out;
      }
      if (d.length >= 15) {
        // legacy short summary frame (older firmware)
        out.kind = 'bms-summary';
        out.voltage = ((d[0] << 8) | d[1]) / 10;
        const cur = (d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5];
        out.current = (cur | 0) / 10;
        out.soc = d[6];
        out.flagBytes = [d[7], d[8], d[9]];
        out.flags = out.flagBytes.map(hex2).join(' ');
        out.temps = [d[10], d[11], d[12], d[13], d[14]];
        out.summary = `${out.voltage.toFixed(1)}V  ${out.current.toFixed(1)}A  ${out.soc}%`;
        out.fields = [
          { label: 'pack voltage',  value: `${out.voltage.toFixed(1)} V` },
          { label: 'pack current',  value: `${out.current.toFixed(1)} A` },
          { label: 'state of charge', value: `${out.soc} %` },
          { label: 'temperatures',  value: out.temps.map((t) => `${t}°`).join(' · ') },
        ];
        out.flagSet = [
          { label: 'flags[0]', byte: d[7], bits: bitsOf(d[7], FLAG_BMS_BYTE_0) },
          { label: 'flags[1]', byte: d[8], bits: bitsOf(d[8], FLAG_BMS_BYTE_1) },
          { label: 'flags[2]', byte: d[9], bits: bitsOf(d[9], FLAG_BMS_BYTE_2) },
        ];
        return out;
      }
    }

    // ── Comm-bridge poll (0x20DF-02 [01 10]) ─────────────────────────────
    if (frame.addrHex === '20DF' && isReq) {
      out.kind = 'poll';
      out.summary = d.length >= 2 ? `poll  cmd=0x${hex2(d[0])} arg=0x${hex2(d[1])}` : 'poll request';
      out.fields = d.length >= 2 ? [
        { label: 'cmd', value: `0x${hex2(d[0])}` },
        { label: 'arg', value: `0x${hex2(d[1])}` },
      ] : [];
      return out;
    }
    if (frame.addrHex === '20DF' && isAns) {
      // Reply payload is an ASCII id string in this firmware.
      let ascii = '';
      for (let i = 0; i < d.length; i++) ascii += (d[i] >= 0x20 && d[i] < 0x7f) ? String.fromCharCode(d[i]) : '·';
      out.kind = 'poll-reply';
      out.ascii = ascii;
      out.summary = `id "${ascii.trim()}"`;
      out.fields = [{ label: 'ASCII id', value: ascii.trim(), hint: `${d.length} bytes` }];
      return out;
    }

    // ── Charging Station heartbeat (0x10EF) ──────────────────────────────
    if (frame.addrHex === '10EF' && isReq) {
      out.kind = 'station-tx';
      out.summary = `heartbeat  ${d.length}B`;
      return out;
    }
    if (frame.addrHex === '10EF' && isAns) {
      out.kind = 'station-ack';
      out.summary = `ack  ${d.length}B`;
      return out;
    }

    // ── Aux telemetry (0x708F) ───────────────────────────────────────────
    if (frame.addrHex === '708F') {
      out.kind = 'aux';
      out.summary = isAns ? `aux reply  ${d.length}B` : `aux probe  ${d.length}B`;
      return out;
    }

    // ── Probe / meta (0xB04F, 0x35CA) ────────────────────────────────────
    if (frame.addrHex === 'B04F' || frame.addrHex === '35CA') {
      out.kind = 'meta';
      out.summary = `meta  ${d.length}B`;
      return out;
    }

    out.summary = `len=${frame.len}`;
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pair request frames with their reply.
  //
  // For each non-answer frame, we walk forward through the frames list looking
  // for the next answer frame at the same address — that is its "exchange
  // partner". An answer that appears with no preceding open request is left
  // unpaired (rare on this bus). The result is an array of "events" where each
  // event is either:
  //   { kind: 'pair',  request, reply, addrHex, latencyMs }
  //   { kind: 'solo',  frame }                        // unmatched frame
  // and the frame log iterates events instead of raw frames so request/reply
  // pairs render together.
  // ─────────────────────────────────────────────────────────────────────────
  function pairExchanges(frames) {
    const events = [];
    const used = new Set();
    for (let i = 0; i < frames.length; i++) {
      if (used.has(i)) continue;
      const f = frames[i];
      if (f.isAnswer) {
        events.push({ kind: 'solo', frame: f });
        continue;
      }
      // walk forward to find next answer at the same address, but bail if we
      // see another *request* to the same address first (means the device
      // didn't reply — log as a lonely request).
      let pair = -1;
      for (let j = i + 1; j < frames.length; j++) {
        if (used.has(j)) continue;
        const g = frames[j];
        if (g.addrHex !== f.addrHex) continue;
        if (g.isAnswer) { pair = j; break; }
        else break; // another request to same address with no reply between
      }
      if (pair >= 0) {
        used.add(pair);
        events.push({
          kind: 'pair',
          request: f,
          reply: frames[pair],
          addrHex: f.addrHex,
          latencyMs: (frames[pair].ts || 0) - (f.ts || 0),
        });
      } else {
        events.push({ kind: 'solo', frame: f });
      }
    }
    return events;
  }

  const DEVICES = {
    '20DF': { name: 'Comm Bridge',      role: 'poll'    },
    '10EF': { name: 'Charging Station', role: 'host'    },
    '31CE': { name: 'Battery BMS',      role: 'bms'     },
    '708F': { name: 'Aux Telemetry',    role: 'aux'     },
    'B04F': { name: 'Probe B0',         role: 'meta'    },
    '35CA': { name: 'Probe 35',         role: 'meta'    },
  };

  root.UARTParser = {
    parseSampleText, findFrame, iterateFrames, interpret,
    annotateBytes, pairExchanges,
    hex2, hex4, DEVICES,
    FLAG_BMS_BYTE_0, FLAG_BMS_BYTE_1, FLAG_BMS_BYTE_2,
  };
})(window);

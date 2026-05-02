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

  // ═══════════════════════════════════════════════════════════════════════
  //  CAN PDO pipeline (BMS Mini S CANopen + CHAdeMO-style station frames)
  // ═══════════════════════════════════════════════════════════════════════

  // ── Bit-flag dictionaries (Russian labels copied verbatim from can/can.txt)

  // 01A0 byte 0
  const FLAG_BMS_CAN_TPDO1_BYTE0 = [
    'Открыта АКБ',
    'ЗУ',
    'Запрос на отключение питания',
    'Запрет заряда',
    'Запрет разряда',
    'Обратная связь контактора заряда',
    'Обратная связь контактора разряда',
    'Статус контроля изоляции',
  ];

  // 02A0 low word (bytes 3,2,1,0) — bits 0..26 mapped, gaps left null
  const FLAG_BMS_CAN_TPDO2_LO = (function () {
    const a = new Array(32).fill(null);
    a[0]  = 'SOC ниже заданного уровня';
    a[1]  = 'Ток заряда выше заданного уровня';
    a[2]  = 'реле заряда ON';
    a[3]  = 'Разрешение ЗУ';
    a[4]  = 'Идет заряд АКБ';
    a[5]  = 'реле разряда ON';
    a[6]  = 'Идет разряд АКБ';
    a[7]  = 'Повышенное напряжение (EV)';
    a[8]  = 'Нагрев АКБ';
    a[9]  = 'Охлаждение АКБ';
    a[10] = 'отключение контактора разряда от погрузчика HYG';
    a[11] = 'инициализация платы - калибруется ток, сканируется BMS Logic';
    a[12] = 'контактор предзаряда';
    a[13] = 'отключение контактора разряда от погрузчика Combilift';
    a[14] = 'процесс анализа ячеек (Cell analysis)';
    a[17] = 'дополнительный (AUX) контактор разряда замкнут';
    a[18] = 'подтверждение отключения питания';
    a[19] = 'сигнал EWS от погрузчика Crown';
    a[20] = 'главный контактор замкнут';
    a[21] = 'служебный сброс системы';
    a[22] = 'общее реле ON';
    a[23] = 'Готов заряжаться';
    a[24] = 'Готов разряжаться';
    a[25] = 'Power up';
    a[26] = 'External 1';
    return a;
  })();

  // 02A0 high word (bytes 7,6,5,4) — bits 0..29 mapped, gaps left null
  const FLAG_BMS_CAN_TPDO2_HI = (function () {
    const a = new Array(32).fill(null);
    a[0]  = 'Превышение тока';
    a[1]  = 'Низкое напряжение';
    a[2]  = 'Высокое напряжение';
    a[3]  = 'Низкая температура (разряд)';
    a[4]  = 'Высокая температура (разряд)';
    a[5]  = 'Открыта крышка АКБ';
    a[6]  = 'Повышенная влажность';
    a[7]  = 'Вода';
    a[8]  = 'Высокая температура платы';
    a[9]  = 'Cell monitor offline';
    a[10] = 'критическая ошибка';
    a[11] = 'ошибка Crown';
    a[12] = 'Несоответствие кол-ва ячеек';
    a[13] = 'Потеря связи с HYG';
    a[14] = 'надо квитировать записи в журнале ошибок';
    a[15] = 'Потеря связи с Combilift';
    a[16] = 'Короткое замыкание';
    a[17] = 'Перегрев контактора';
    a[19] = 'ошибка АЦП';
    a[20] = 'обрыв/кз датчика тока';
    a[21] = 'задрочили контактор заряда';
    a[22] = 'задрочили контактор разряда';
    a[23] = 'Потеря связи с BMS Current Sensor';
    a[24] = 'внутренняя ошибка BMS Current Sensor';
    a[26] = 'перезапуск платы WDT';
    a[27] = 'Нет датчиков температуры';
    a[28] = 'КЗ датчика температуры';
    a[29] = 'Потеря связи со Spirit';
    return a;
  })();

  // 03A0 low word (bytes 3,2,1,0)
  const FLAG_BMS_CAN_TPDO3_LO = (function () {
    const a = new Array(32).fill(null);
    a[0]  = 'Низкая температура (заряд)';
    a[1]  = 'Высокая температура (заряд)';
    a[2]  = 'ошибка монтирования SD-карты';
    a[3]  = 'ошибка записи/чтения SD-карты';
    a[4]  = 'Недопустимый заряд (контактор разряда)';
    a[5]  = 'Залипание контактора';
    a[8]  = 'Нарушение изоляции';
    a[12] = 'Ошибка обратной связи контактора';
    a[13] = 'General error';
    a[17] = 'ошибка предзаряда';
    a[19] = 'Current limit error';
    return a;
  })();

  // 03A0 high half (bytes 5,4 = 16 bits)
  const FLAG_BMS_CAN_TPDO3_HI = (function () {
    const a = new Array(16).fill(null);
    a[0]  = 'Запрос на заряд';
    a[1]  = 'Запрос на предзаряд';
    a[2]  = 'Запрос на разряд';
    a[6]  = 'Interlock';
    a[7]  = 'Fuse 1';
    a[8]  = 'Fuse 2';
    a[9]  = 'Fuse 3';
    a[10] = 'Circuit breaker status';
    a[11] = 'Balancing request';
    a[12] = 'Close Main contactor';
    a[13] = 'Close External 1';
    a[14] = 'Close External 2';
    return a;
  })();

  // 0500 byte 0 — station-rx error flags
  const FLAG_STATION_RX_ERR = [
    'Energy transfer system error',
    'Battery overvoltage',
    'Battery undervoltage',
    'Battery current deviation error',
    'High battery temperature',
    'Battery voltage deviation error',
    null,
    null,
  ];
  // 0500 byte 1 — station-rx status flags
  const FLAG_STATION_RX_STAT = [
    'EV charging enabled',
    'EV contactor status',
    'EV charging position',
    'EV charging stop control',
    'Wait request to delay energy transfer',
    'Digital communication toggle',
    null,
    null,
  ];
  // 0508 byte 0 — station-tx error/equipment status flags
  const FLAG_STATION_TX_ERR = [
    'Charging system error',
    'EV supply equipment malfunction',
    'EV incompatibility',
    null,
    null,
    null,
    null,
    null,
  ];
  // 0508 byte 1 — station-tx ready-state flags
  const FLAG_STATION_TX_STAT = [
    'EV supply equipment stop control',
    'EV supply equipment status',
    'Vehicle connector latched',
    'EV supply equipment ready',
    'Waiting state before charging start',
    null,
    null,
    null,
  ];

  // ── Helper: turn a byte into [{bit,label}] given a label table.
  function bitsOfTable(byte, table) {
    const out = [];
    for (let i = 0; i < 8; i++) {
      if (byte & (1 << i)) out.push({ bit: i, label: table[i] || `bit ${i}` });
    }
    return out;
  }

  // Helper: turn a multi-byte little-endian word into a list of set bits with
  // labels from a 32-entry (or 16-entry) table.
  function bitsOfWord(word, table, width) {
    const out = [];
    for (let i = 0; i < width; i++) {
      if (word & (1 << i)) out.push({ bit: i, label: table[i] || `bit ${i}` });
    }
    return out;
  }

  // Pretty 8-bit binary
  function bin8(b) { return (b & 0xff).toString(2).padStart(8, '0'); }

  // Build a flagSet entry that the existing FlagTable React component can render.
  // FlagTable renders 8 rows with `set.byte`, `set.bits`. For wider flag sets,
  // we emit multiple FlagTable entries — one per source byte — so the existing
  // single-byte UI can still display them. The labels are derived from the
  // corresponding window of the wide-word label table.
  function flagSetForWord(label, bytes /* low-to-high in WORD */, table, totalBits) {
    // bytes is given low-to-high in word; bit 0 of word = bit 0 of bytes[0],
    // bit 8 = bit 0 of bytes[1], etc.
    const sets = [];
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i] & 0xff;
      const bits = [];
      for (let b = 0; b < 8; b++) {
        if (byte & (1 << b)) {
          const wbit = i * 8 + b;
          if (wbit >= totalBits) break;
          bits.push({ bit: b, label: table[wbit] || `bit ${wbit}` });
        }
      }
      sets.push({
        label: `${label} · b${i*8}..b${i*8+7}`,
        byte,
        bits,
      });
    }
    return sets;
  }

  // Count set bits in a Uint8Array slice
  function popcountBytes(bytes) {
    let n = 0;
    for (let i = 0; i < bytes.length; i++) {
      let b = bytes[i];
      while (b) { n += b & 1; b >>>= 1; }
    }
    return n;
  }

  // ── parseCanText ────────────────────────────────────────────────────────
  //   Each non-empty, non-comment line:  <id_hex> <b0> <b1> ... <bN>
  //   `lineRanges` mirror the RS485 convention so app's playback cursor logic
  //   keeps working — for CAN they are [[i, i+1], …] (one frame per line).
  function parseCanText(text) {
    const frames = [];
    const lineRanges = [];
    const lines = text.split('\n');
    let lineIdx = 0;
    for (let li = 0; li < lines.length; li++) {
      let s = lines[li];
      const hash = s.indexOf('#');
      if (hash >= 0) s = s.slice(0, hash);
      const toks = s.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      const idTok = toks[0];
      const id = parseInt(idTok, 16);
      if (Number.isNaN(id)) continue;
      // Normalize to a 4-char zero-padded uppercase hex so device-table lookups
      // and idKey stripping behave the same regardless of source formatting.
      const idHex = id.toString(16).toUpperCase().padStart(4, '0');
      const data = new Uint8Array(Math.min(8, toks.length - 1));
      for (let k = 0; k < data.length; k++) {
        const v = parseInt(toks[k + 1], 16);
        data[k] = Number.isNaN(v) ? 0 : (v & 0xff);
      }
      // raw on the wire = [id_hi, id_lo, ...data], so the inspector shows
      // e.g. "01 A0 02 56 00 1A 1B 04 FB 01"
      const raw = new Uint8Array(2 + data.length);
      raw[0] = (id >> 8) & 0xff;
      raw[1] = id & 0xff;
      for (let k = 0; k < data.length; k++) raw[2 + k] = data[k];
      const f = {
        start: lineIdx,
        end:   lineIdx + 1,
        kind: 'can',
        id,
        idHex,
        addrHex: idHex,            // alias for inspector code
        data,
        encoded: data,             // alias (no shift on CAN)
        len: data.length,
        raw,
        control: 0,
        code: 0,
        codeHex: '00',
        codeBare: '00',
        isAnswer: false,
        sumOk: true,
        sumExpected: '',
        sumActual: '',
        prefixLen: 0,
        terminator: 0,
        ts: undefined,
        srcLine: li,
      };
      frames.push(f);
      lineRanges.push([lineIdx, lineIdx + 1]);
      lineIdx++;
    }
    return { frames, lineRanges, bytes: new Uint8Array(0) };
  }

  // ── interpretCan ────────────────────────────────────────────────────────
  function interpretCan(frame) {
    // Compare against canonical 3-character form (drop leading zeros). The
    // capture file may write the ID either as "01A0" or "1A0" — both should
    // resolve to the same kind. Display still uses the original.
    const idHex = frame.idHex;
    const idKey = idHex.replace(/^0+/, '') || '0';
    const d = frame.data;
    const out = {
      id: idHex,
      addr: idHex,
      code: '00',
      kind: 'can-unknown',
      summary: '',
      fields: [],
      flagSet: [],
    };

    // Helpers for little-endian word reads per can.txt convention "i/10 2,1"
    // → the spec lists HIGH-byte index first: (data[hi] << 8) | data[lo].
    const u16 = (hi, lo) => ((d[hi] || 0) << 8) | (d[lo] || 0);
    const i16 = (hi, lo) => {
      const v = u16(hi, lo);
      return v & 0x8000 ? v - 0x10000 : v;
    };
    const i8 = (i) => {
      const v = d[i] || 0;
      return v & 0x80 ? v - 0x100 : v;
    };

    if (idKey === '80') {
      out.kind = 'can-sync';
      out.summary = 'CANopen sync';
      return out;
    }

    if (idKey === '1A0') {
      out.kind = 'can-bms-tpdo1';
      const flags0 = d[0] || 0;
      const current = i16(2, 1) / 10;
      const tmin = i8(3);
      const tmax = i8(4);
      const soc = d[5] || 0;
      const voltage = u16(7, 6) / 10;
      out.voltage = voltage;
      out.current = current;
      out.soc = soc;
      out.temps = [tmin, tmax, null, null, null];
      out.flagBytes = [flags0, 0, 0];
      out.flags = hex2(flags0) + ' ·· ··';
      // 20-cell array (CAN doesn't carry per-cell voltages on these IDs).
      out.cells = new Array(20).fill(null);
      out.cellMin = 0;
      out.cellMax = 0;
      out.cellSpread = 0;
      out.summary = `${voltage.toFixed(1)}V  ${current.toFixed(1)}A  ${soc}%`;
      out.fields = [
        { label: 'pack voltage',  value: `${voltage.toFixed(1)} V`, hint: 'd[7,6] uint16 LE × 0.1' },
        { label: 'pack current',  value: `${current.toFixed(1)} A`, hint: 'd[2,1] int16  LE × 0.1 (signed)' },
        { label: 'state of charge', value: `${soc} %`,             hint: 'd[5] uint8' },
        { label: 'temperatures',  value: `Tmin ${tmin}° · Tmax ${tmax}°`, hint: 'd[3]=Tmin, d[4]=Tmax (int8)' },
      ];
      out.flagSet = [
        { label: 'd[0] state', byte: flags0, bits: bitsOfTable(flags0, FLAG_BMS_CAN_TPDO1_BYTE0) },
      ];
      return out;
    }

    if (idKey === '2A0') {
      out.kind = 'can-bms-tpdo2';
      // Low half = bytes 3,2,1,0 (low-to-high in word order = [0,1,2,3]).
      // i.e. word_lo = d[0] | (d[1]<<8) | (d[2]<<16) | (d[3]<<24).
      // The spec's "bits 3,2,1,0" notation says the high byte is listed first;
      // bit 0 of the word lives in the byte at position 0.
      const loBytes = [d[0] || 0, d[1] || 0, d[2] || 0, d[3] || 0];
      const hiBytes = [d[4] || 0, d[5] || 0, d[6] || 0, d[7] || 0];
      const setsLo = flagSetForWord('errors+state lo', loBytes, FLAG_BMS_CAN_TPDO2_LO, 32);
      const setsHi = flagSetForWord('alarms hi',       hiBytes, FLAG_BMS_CAN_TPDO2_HI, 32);
      out.flagSet = [...setsLo, ...setsHi];
      const setBits = popcountBytes(d);
      out.summary = `32+32 state bits · ${setBits} set`;
      return out;
    }

    if (idKey === '3A0') {
      out.kind = 'can-bms-tpdo3';
      const loBytes = [d[0] || 0, d[1] || 0, d[2] || 0, d[3] || 0];
      const hiBytes = [d[4] || 0, d[5] || 0];
      const setsLo = flagSetForWord('errors lo',   loBytes, FLAG_BMS_CAN_TPDO3_LO, 32);
      const setsHi = flagSetForWord('requests hi', hiBytes, FLAG_BMS_CAN_TPDO3_HI, 16);
      out.flagSet = [...setsLo, ...setsHi];
      const setBits = popcountBytes(d.slice(0, 6));
      out.summary = `32+16 state bits · ${setBits} set`;
      return out;
    }

    if (idKey === '500') {
      out.kind = 'can-station-rx';
      const err = d[0] || 0;
      const stat = d[1] || 0;
      const req = u16(3, 2) / 10;
      const tar = u16(5, 4) / 10;
      const lim = u16(7, 6) / 10;
      out.summary = `req ${req}A · tar ${tar}V · lim ${lim}V`;
      out.fields = [
        { label: 'requested DC current', value: `${req} A`, hint: 'd[3,2] uint16 LE × 0.1' },
        { label: 'DC voltage target',    value: `${tar} V`, hint: 'd[5,4] uint16 LE × 0.1' },
        { label: 'DC voltage limit',     value: `${lim} V`, hint: 'd[7,6] uint16 LE × 0.1' },
      ];
      out.flagSet = [
        { label: 'd[0] errors',  byte: err,  bits: bitsOfTable(err,  FLAG_STATION_RX_ERR)  },
        { label: 'd[1] status',  byte: stat, bits: bitsOfTable(stat, FLAG_STATION_RX_STAT) },
      ];
      return out;
    }

    if (idKey === '501') {
      out.kind = 'can-station-rx-info';
      const ver = d[0] || 0;
      const soc = d[1] || 0;
      const tmax = u16(3, 2);
      const test = u16(5, 4);
      out.summary = `v${ver} · soc ${soc}% · est ${test}min`;
      out.fields = [
        { label: 'software version',   value: String(ver),    hint: 'd[0]' },
        { label: 'state of charge',    value: `${soc} %`,     hint: 'd[1]' },
        { label: 'maximum charge time',value: `${tmax} min`,  hint: 'd[3,2] uint16 LE' },
        { label: 'estimated charge time', value: `${test} min`, hint: 'd[5,4] uint16 LE' },
      ];
      return out;
    }

    if (idKey === '502') {
      out.kind = 'can-station-rx-flags';
      const b = d[0] || 0;
      out.fields = [{ label: 'voltage control', value: (b & 1) ? 'enabled' : 'disabled', hint: 'd[0] bit 0' }];
      out.flagSet = [
        { label: 'd[0]', byte: b, bits: bitsOfTable(b, ['Voltage control enabled', null, null, null, null, null, null, null]) },
      ];
      out.summary = (b & 1) ? 'voltage control · enabled' : 'voltage control · disabled';
      return out;
    }

    if (idKey === '508') {
      out.kind = 'can-station-tx';
      const err = d[0] || 0;
      const stat = d[1] || 0;
      const vava = u16(3, 2) / 10;
      const aava = u16(5, 4) / 10;
      const vlim = u16(7, 6); // raw V per spec (no /10)
      out.summary = `ava ${vava}V/${aava}A · lim ${vlim}V`;
      out.fields = [
        { label: 'rated DC voltage', value: `${vava} V`, hint: 'd[3,2] uint16 LE × 0.1' },
        { label: 'available DC current', value: `${aava} A`, hint: 'd[5,4] uint16 LE × 0.1' },
        { label: 'DC voltage limit', value: `${vlim} V`, hint: 'd[7,6] uint16 LE (raw V)' },
      ];
      out.flagSet = [
        { label: 'd[0] equipment errors', byte: err,  bits: bitsOfTable(err,  FLAG_STATION_TX_ERR)  },
        { label: 'd[1] ready state',      byte: stat, bits: bitsOfTable(stat, FLAG_STATION_TX_STAT) },
      ];
      return out;
    }

    if (idKey === '509') {
      out.kind = 'can-station-tx-info';
      const sv = d[0] || 0;
      const pwr = (d[1] || 0) * 50;
      const vout = u16(3, 2) / 10;
      const aout = u16(5, 4) / 10;
      const trem = i16(7, 6);
      out.summary = `out ${vout}V/${aout}A · ${pwr}W · ${trem}min`;
      out.fields = [
        { label: 'control protocol ver', value: String(sv),   hint: 'd[0]' },
        { label: 'available DC power',   value: `${pwr} W`,   hint: 'd[1] × 50 W' },
        { label: 'output voltage',       value: `${vout} V`,  hint: 'd[3,2] uint16 LE × 0.1' },
        { label: 'output current',       value: `${aout} A`,  hint: 'd[5,4] uint16 LE × 0.1' },
        { label: 'remaining time',       value: `${trem} min`, hint: 'd[7,6] int16 LE' },
      ];
      return out;
    }

    if (idKey === '510') {
      out.kind = 'can-station-tx-vctl';
      const b = d[0] || 0;
      out.fields = [{ label: 'voltage control', value: (b & 1) ? 'enabled' : 'disabled', hint: 'd[0] bit 0' }];
      out.flagSet = [
        { label: 'd[0]', byte: b, bits: bitsOfTable(b, [null, 'Voltage control enabled', null, null, null, null, null, null]) },
      ];
      out.summary = (b & 1) ? 'voltage control · enabled' : 'voltage control · disabled';
      return out;
    }

    if (idKey === '580' || idKey === '581' || idKey === '582' || idKey === '583' ||
        idKey === '584' || idKey === '585' || idKey === '586' || idKey === '587') {
      out.kind = 'can-station-id';
      let ascii = '';
      for (let i = 0; i < d.length; i++) {
        const c = d[i];
        ascii += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '·';
      }
      const trimmed = ascii.replace(/[·\s]+$/g, '');
      out.ascii = ascii;
      out.model = trimmed;
      out.serial = null;
      out.summary = `id "${trimmed}"`;
      out.fields = [{ label: 'ASCII', value: trimmed || '—', hint: `${d.length} bytes` }];
      return out;
    }

    if (idKey === '720') {
      out.kind = 'can-heartbeat';
      const s = d[0] || 0;
      const stateName =
        s === 0   ? 'bootup' :
        s === 4   ? 'stopped' :
        s === 5   ? 'operational' :
        s === 127 ? 'pre-operational' :
        `state ${s}`;
      out.summary = `node 0x20 · ${stateName}`;
      out.fields = [{ label: 'NMT state', value: `${s} (${stateName})`, hint: 'd[0]' }];
      return out;
    }

    out.summary = 'len=' + d.length;
    return out;
  }

  // ── annotateBytesCan ────────────────────────────────────────────────────
  function annotateBytesCan(frame, interp) {
    const d = frame.data;
    const ann = new Array(d.length).fill(null).map((_, i) => ({
      role: 'data', label: '·', value: hex2(d[i]),
    }));
    const k = (interp && interp.kind) || frame.kind;

    if (k === 'can-bms-tpdo1') {
      if (0 < d.length) ann[0] = { role: 'flag', label: 'status',  value: hex2(d[0]) };
      if (1 < d.length) ann[1] = { role: 'val',  label: 'A lo',    value: hex2(d[1]) };
      if (2 < d.length) ann[2] = { role: 'val',  label: 'A hi',    value: hex2(d[2]) };
      if (3 < d.length) ann[3] = { role: 'temp', label: 'Tmin',    value: hex2(d[3]) };
      if (4 < d.length) ann[4] = { role: 'temp', label: 'Tmax',    value: hex2(d[4]) };
      if (5 < d.length) ann[5] = { role: 'val',  label: 'SOC',     value: hex2(d[5]) };
      if (6 < d.length) ann[6] = { role: 'val',  label: 'V lo',    value: hex2(d[6]) };
      if (7 < d.length) ann[7] = { role: 'val',  label: 'V hi',    value: hex2(d[7]) };
      return ann;
    }
    if (k === 'can-bms-tpdo2' || k === 'can-bms-tpdo3') {
      for (let i = 0; i < d.length; i++) ann[i] = { role: 'flag', label: `b${i*8}..b${i*8+7}`, value: hex2(d[i]) };
      return ann;
    }
    if (k === 'can-station-rx') {
      if (0 < d.length) ann[0] = { role: 'flag', label: 'err',     value: hex2(d[0]) };
      if (1 < d.length) ann[1] = { role: 'flag', label: 'stat',    value: hex2(d[1]) };
      if (2 < d.length) ann[2] = { role: 'val',  label: 'Req lo',  value: hex2(d[2]) };
      if (3 < d.length) ann[3] = { role: 'val',  label: 'Req hi',  value: hex2(d[3]) };
      if (4 < d.length) ann[4] = { role: 'val',  label: 'Tar lo',  value: hex2(d[4]) };
      if (5 < d.length) ann[5] = { role: 'val',  label: 'Tar hi',  value: hex2(d[5]) };
      if (6 < d.length) ann[6] = { role: 'val',  label: 'Lim lo',  value: hex2(d[6]) };
      if (7 < d.length) ann[7] = { role: 'val',  label: 'Lim hi',  value: hex2(d[7]) };
      return ann;
    }
    if (k === 'can-station-rx-info') {
      if (0 < d.length) ann[0] = { role: 'meta', label: 'ver',         value: hex2(d[0]) };
      if (1 < d.length) ann[1] = { role: 'val',  label: 'SOC',         value: hex2(d[1]) };
      if (2 < d.length) ann[2] = { role: 'val',  label: 'TimeMax lo',  value: hex2(d[2]) };
      if (3 < d.length) ann[3] = { role: 'val',  label: 'TimeMax hi',  value: hex2(d[3]) };
      if (4 < d.length) ann[4] = { role: 'val',  label: 'TimeEst lo',  value: hex2(d[4]) };
      if (5 < d.length) ann[5] = { role: 'val',  label: 'TimeEst hi',  value: hex2(d[5]) };
      return ann;
    }
    if (k === 'can-station-rx-flags' || k === 'can-station-tx-vctl') {
      if (0 < d.length) ann[0] = { role: 'flag', label: 'vctl', value: hex2(d[0]) };
      return ann;
    }
    if (k === 'can-station-tx') {
      if (0 < d.length) ann[0] = { role: 'flag', label: 'err',       value: hex2(d[0]) };
      if (1 < d.length) ann[1] = { role: 'flag', label: 'stat',      value: hex2(d[1]) };
      if (2 < d.length) ann[2] = { role: 'val',  label: 'Vava lo',   value: hex2(d[2]) };
      if (3 < d.length) ann[3] = { role: 'val',  label: 'Vava hi',   value: hex2(d[3]) };
      if (4 < d.length) ann[4] = { role: 'val',  label: 'Aava lo',   value: hex2(d[4]) };
      if (5 < d.length) ann[5] = { role: 'val',  label: 'Aava hi',   value: hex2(d[5]) };
      if (6 < d.length) ann[6] = { role: 'val',  label: 'Vlim lo',   value: hex2(d[6]) };
      if (7 < d.length) ann[7] = { role: 'val',  label: 'Vlim hi',   value: hex2(d[7]) };
      return ann;
    }
    if (k === 'can-station-tx-info') {
      if (0 < d.length) ann[0] = { role: 'meta', label: 'sw ver',    value: hex2(d[0]) };
      if (1 < d.length) ann[1] = { role: 'val',  label: 'pwr/50W',   value: hex2(d[1]) };
      if (2 < d.length) ann[2] = { role: 'val',  label: 'Vout lo',   value: hex2(d[2]) };
      if (3 < d.length) ann[3] = { role: 'val',  label: 'Vout hi',   value: hex2(d[3]) };
      if (4 < d.length) ann[4] = { role: 'val',  label: 'Aout lo',   value: hex2(d[4]) };
      if (5 < d.length) ann[5] = { role: 'val',  label: 'Aout hi',   value: hex2(d[5]) };
      if (6 < d.length) ann[6] = { role: 'val',  label: 'Trem lo',   value: hex2(d[6]) };
      if (7 < d.length) ann[7] = { role: 'val',  label: 'Trem hi',   value: hex2(d[7]) };
      return ann;
    }
    if (k === 'can-station-id') {
      for (let i = 0; i < d.length; i++) {
        const c = d[i];
        const ch = (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '·';
        ann[i] = { role: 'text', label: `chr "${ch}"`, value: hex2(d[i]) };
      }
      return ann;
    }
    if (k === 'can-heartbeat') {
      if (0 < d.length) ann[0] = { role: 'meta', label: 'NMT state', value: hex2(d[0]) };
      return ann;
    }
    return ann;  // sync, unknown
  }

  // Keyed by the 4-character zero-padded ID string we emit from parseCanText
  // (e.g. capture lines write "0080", "01A0", "0500"). Lookups using
  // frame.addrHex / frame.idHex therefore match without normalization.
  const CAN_DEVICES = {
    '0080': { name: 'CANopen Sync',     role: 'sync'    },
    '01A0': { name: 'BMS · TPDO1',      role: 'bms'     },
    '02A0': { name: 'BMS · TPDO2',      role: 'bms'     },
    '03A0': { name: 'BMS · TPDO3',      role: 'bms'     },
    '0500': { name: 'Station · req',    role: 'station' },
    '0501': { name: 'Station · info',   role: 'station' },
    '0502': { name: 'Station · vctl',   role: 'station' },
    '0508': { name: 'Station · ava',    role: 'station' },
    '0509': { name: 'Station · out',    role: 'station' },
    '0510': { name: 'Station · vctl',   role: 'station' },
    '0580': { name: 'Station · ID0',    role: 'meta'    },
    '0581': { name: 'Station · ID1',    role: 'meta'    },
    '0584': { name: 'Station TX · ID0', role: 'meta'    },
    '0720': { name: 'Heartbeat 0x20',   role: 'sync'    },
  };

  // ── Source registry ────────────────────────────────────────────────────
  // Lets the apps switch protocols without conditionals scattered everywhere.
  const SOURCES = {
    rs485: {
      id: 'rs485',
      label: 'RS485 / UART',
      defaultFile: 'data/sample.txt',
      files: [{ value: 'data/sample.txt', label: 'sample.txt' }],
      parse: parseSampleText,
      decode: function (parsed, upToBytes) {
        const out = [];
        if (!parsed || !parsed.bytes) return out;
        let i = 0;
        while (i < upToBytes) {
          const f = findFrame(parsed.bytes, i);
          if (!f) break;
          if (f.end > upToBytes) break;
          f.interp = interpret(f);
          f.kind = 'rs485';
          out.push(f);
          i = f.end;
        }
        return out;
      },
      annotate: annotateBytes,
      pair: pairExchanges,
      devices: DEVICES,
      hasByteStream: true,
      hasCells: true,
      hasPairs: true,
    },
    can: {
      id: 'can',
      label: 'CAN PDO',
      defaultFile: 'data/can_run.txt',
      files: [
        { value: 'data/can_start.txt', label: 'can_start.txt — boot up' },
        { value: 'data/can_run.txt',   label: 'can_run.txt — running'  },
        { value: 'data/can_bat.txt',   label: 'can_bat.txt — battery only' },
        { value: 'data/can_end.txt',   label: 'can_end.txt — shutdown' },
      ],
      parse: parseCanText,
      decode: function (parsed, upToLineIdx) {
        if (!parsed || !parsed.frames) return [];
        const upTo = Math.min(upToLineIdx, parsed.frames.length);
        const out = parsed.frames.slice(0, upTo);
        out.forEach((f) => { if (!f.interp) f.interp = interpretCan(f); });
        return out;
      },
      annotate: annotateBytesCan,
      pair: function (frames) { return frames.map((f) => ({ kind: 'solo', frame: f })); },
      devices: CAN_DEVICES,
      hasByteStream: false,
      hasCells: false,
      hasPairs: false,
    },
  };

  // Convenience: for an event index, what cursor unit does the source use?
  // RS485 → byte position; CAN → line index.
  function cursorOf(srcId, parsed, upToLineIdx) {
    if (srcId === 'rs485') {
      if (!parsed || !parsed.lineRanges || !parsed.lineRanges.length) return 0;
      const i = Math.min(upToLineIdx, parsed.lineRanges.length - 1);
      return parsed.lineRanges[i][1];
    }
    return upToLineIdx + 1;
  }

  // Top-level annotate() that dispatches by frame.kind so callers don't need
  // to know about the protocol pipeline.
  function annotate(frame, interp) {
    if (frame && frame.kind === 'can') return annotateBytesCan(frame, interp);
    return annotateBytes(frame, interp);
  }

  root.UARTParser = {
    parseSampleText, findFrame, iterateFrames, interpret,
    annotateBytes, annotate, pairExchanges,
    hex2, hex4, DEVICES,
    FLAG_BMS_BYTE_0, FLAG_BMS_BYTE_1, FLAG_BMS_BYTE_2,
    // CAN
    parseCanText, interpretCan, annotateBytesCan, CAN_DEVICES,
    FLAG_BMS_CAN_TPDO1_BYTE0,
    FLAG_BMS_CAN_TPDO2_LO, FLAG_BMS_CAN_TPDO2_HI,
    FLAG_BMS_CAN_TPDO3_LO, FLAG_BMS_CAN_TPDO3_HI,
    FLAG_STATION_RX_ERR, FLAG_STATION_RX_STAT,
    FLAG_STATION_TX_ERR, FLAG_STATION_TX_STAT,
    SOURCES, cursorOf,
  };
})(window);

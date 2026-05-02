/* global React, ReactDOM, UARTParser, TweaksPanel, useTweaks, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakButton */
const { useEffect, useMemo, useRef, useState, useCallback } = React;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  const t = new Date(ms);
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}.${String(t.getMilliseconds()).padStart(3, '0')}`;
};
const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0');

const KIND_LABEL = {
  'bms-request':  'BMS · request',
  'bms-info':     'BMS · info',
  'bms-cells':    'BMS · cells',
  'bms-summary':  'BMS · summary',
  'poll':         'poll',
  'poll-reply':   'poll · reply',
  'station-tx':   'station · tx',
  'station-ack':  'station · ack',
  'aux':          'aux',
  'meta':         'meta',
  'unknown':      '—',
};

// ────────────────────────────────────────────────────────────────────────────
// Bytes panel — raw hex with frame highlighting
// ────────────────────────────────────────────────────────────────────────────
function BytesView({ buffer, frames, cursor }) {
  const containerRef = useRef(null);
  // window the rendering: last ~512 bytes around the cursor
  const start = Math.max(0, cursor - 512);
  const end = Math.min(buffer.length, cursor + 32);
  const slice = useMemo(() => Array.from(buffer.slice(start, end)), [buffer, start, end]);

  // map byte index → frame role
  const roleAt = useMemo(() => {
    const map = new Map();
    frames.forEach((f, idx) => {
      for (let i = f.start; i < f.end; i++) map.set(i, { f, idx });
    });
    return map;
  }, [frames]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cursor]);

  return (
    <div ref={containerRef} className="bytes-stream">
      {slice.map((b, i) => {
        const abs = i + start;
        const meta = roleAt.get(abs);
        const cls = ['byte'];
        if (meta) {
          const rel = abs - meta.f.start;
          if (b === 0xfe) cls.push('byte-pre');
          else if (rel === meta.f.prefixLen || rel === meta.f.prefixLen + 3) cls.push('byte-mark');
          else if (rel === meta.f.prefixLen + 4) cls.push('byte-ctrl');
          else if (rel === meta.f.end - meta.f.start - 1 && meta.f.terminator) cls.push('byte-end');
          else if (rel === meta.f.end - meta.f.start - 1 - meta.f.terminator) cls.push('byte-sum');
          else if (rel >= meta.f.prefixLen + 6) cls.push('byte-data');
          else cls.push('byte-hdr');
        } else {
          cls.push('byte-orphan');
        }
        if (abs >= cursor - 1 && abs < cursor) cls.push('byte-cursor');
        return <span key={abs} className={cls.join(' ')}>{hex2(b)}</span>;
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cell pack visual — stylized 18650-style cells with terminals + fill level
// ────────────────────────────────────────────────────────────────────────────
function Cell({ index, value, fillPct, status }) {
  // status: 'hi' | 'lo' | null
  const empty = !value;
  return (
    <div className={`cell ${empty ? 'cell-empty' : ''} cell-${status || 'mid'}`}>
      <div className="cell-num">{pad2(index + 1)}</div>
      <svg className="cell-svg" viewBox="0 0 28 70" preserveAspectRatio="none">
        {/* positive terminal nub */}
        <rect x="10" y="0"  width="8" height="3" className="cell-cap" />
        {/* body */}
        <rect x="2"  y="3"  width="24" height="65" rx="2" className="cell-body" />
        {/* inner well */}
        <rect x="4"  y="5"  width="20" height="61" className="cell-well" />
        {/* electrolyte fill — grows from bottom */}
        <rect
          x="4"
          y={5 + (1 - fillPct) * 61}
          width="20"
          height={fillPct * 61}
          className="cell-fluid"
        />
        {/* horizontal score lines on the can */}
        <line x1="2" y1="10" x2="26" y2="10" className="cell-score" />
        <line x1="2" y1="62" x2="26" y2="62" className="cell-score" />
      </svg>
      <div className="cell-val">{empty ? '——' : value}</div>
    </div>
  );
}

function CellPack({ cells }) {
  const safe = cells || new Array(20).fill(null);
  const present = safe.filter((v) => v != null && v > 0);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 1;
  const spread = Math.max(1, max - min);

  return (
    <div className="cells-grid">
      {safe.map((v, i) => {
        const pct = v ? Math.max(0.08, (v - min) / spread) : 0;
        let status = null;
        if (v && present.length > 1) {
          if (v === max) status = 'hi';
          else if (v === min) status = 'lo';
        }
        return <Cell key={i} index={i} value={v} fillPct={pct} status={status} />;
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sparkline
// ────────────────────────────────────────────────────────────────────────────
function Spark({ data, width = 280, height = 56, accent }) {
  if (!data || data.length < 2) {
    return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <line x1="0" y1={height-1} x2={width} y2={height-1} stroke="currentColor" strokeOpacity="0.2" />
    </svg>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(0.0001, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${pts.join(' L')}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1="0" y1={height-1} x2={width} y2={height-1} stroke="currentColor" strokeOpacity="0.15" />
      <path d={path} fill="none" stroke={accent} strokeWidth="1.4" />
      <circle cx={pts.length ? (pts[pts.length-1].split(',')[0]) : 0}
              cy={pts.length ? (pts[pts.length-1].split(',')[1]) : 0}
              r="2" fill={accent} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Frame log row — single (unpaired) frame
// ────────────────────────────────────────────────────────────────────────────
function FrameRow({ frame, onPick, picked }) {
  const sumCls = frame.sumOk ? 'ok' : 'bad';
  const ans = frame.isAnswer ? 'tx' : 'rx';
  const k = frame.interp.kind;
  return (
    <button className={`frow ${picked ? 'frow-picked' : ''}`} onClick={() => onPick(frame)}>
      <span className="fr-time">{frame.tsLabel}</span>
      <span className={`fr-dir fr-${ans}`}>{ans === 'tx' ? '↩' : '→'}</span>
      <span className="fr-addr">{frame.addrHex}</span>
      <span className={`fr-code fr-code-${ans}`}>·{frame.codeHex}</span>
      <span className={`fr-kind k-${k}`}>{KIND_LABEL[k]}</span>
      <span className="fr-len">{String(frame.len).padStart(2, '0')}B</span>
      <span className={`fr-sum sum-${sumCls}`}>{frame.sumOk ? 'OK' : 'BAD'}</span>
      <span className="fr-summary">{frame.interp.summary}</span>
    </button>
  );
}

// Paired exchange — request frame on top, reply frame underneath, with the
// shared address rendered once on the left and a latency tag on the right.
function PairRow({ pair, onPick, pickedStart }) {
  const { request, reply, addrHex, latencyMs } = pair;
  const dev = UARTParser.DEVICES[addrHex]?.name || 'unknown';
  return (
    <div className={`pair pair-${request.interp.kind}`}>
      <div className="pair-spine">
        <div className="pair-addr">{addrHex}</div>
        <div className="pair-dev">{dev}</div>
        <div className="pair-lat">{latencyMs ? `${latencyMs}ms` : '·'}</div>
      </div>
      <div className="pair-frames">
        <button
          className={`frow frow-pair frow-req ${pickedStart === request.start ? 'frow-picked' : ''}`}
          onClick={() => onPick(request)}>
          <span className="fr-time">{request.tsLabel}</span>
          <span className="fr-dir fr-rx">→</span>
          <span className="fr-code fr-code-rx">·{request.codeHex}</span>
          <span className={`fr-kind k-${request.interp.kind}`}>{KIND_LABEL[request.interp.kind]}</span>
          <span className="fr-len">{String(request.len).padStart(2, '0')}B</span>
          <span className={`fr-sum sum-${request.sumOk ? 'ok' : 'bad'}`}>{request.sumOk ? 'OK' : 'BAD'}</span>
          <span className="fr-summary">{request.interp.summary}</span>
        </button>
        <button
          className={`frow frow-pair frow-rep ${pickedStart === reply.start ? 'frow-picked' : ''}`}
          onClick={() => onPick(reply)}>
          <span className="fr-time">{reply.tsLabel}</span>
          <span className="fr-dir fr-tx">↩</span>
          <span className="fr-code fr-code-tx">·{reply.codeHex}</span>
          <span className={`fr-kind k-${reply.interp.kind}`}>{KIND_LABEL[reply.interp.kind]}</span>
          <span className="fr-len">{String(reply.len).padStart(2, '0')}B</span>
          <span className={`fr-sum sum-${reply.sumOk ? 'ok' : 'bad'}`}>{reply.sumOk ? 'OK' : 'BAD'}</span>
          <span className="fr-summary">{reply.interp.summary}</span>
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Inspector — rich semantic breakdown
// ────────────────────────────────────────────────────────────────────────────
const ROLE_LABEL = {
  addr:    'request param',
  text:    'ASCII',
  meta:    'meta',
  val:     'value',
  flag:    'flag byte',
  temp:    'temperature',
  cell:    'cell voltage',
  station: 'station data',
  aux:     'aux data',
  data:    'data',
};

function ByteAnnotated({ ann, value, idx }) {
  return (
    <div className={`ba ba-${ann.role}`} title={`d[${idx}] = 0x${value} · ${ann.label}`}>
      <span className="ba-i">{String(idx).padStart(2, '0')}</span>
      <span className="ba-v">{value}</span>
      <span className="ba-l">{ann.label}</span>
    </div>
  );
}

function FlagTable({ set }) {
  if (!set.bits.length && set.byte === 0) {
    return (
      <div className="flag-block flag-block-empty">
        <div className="flag-h"><label>{set.label}</label><span className="flag-byte">0x{hex2(set.byte)}</span></div>
        <div className="flag-empty">no bits set</div>
      </div>
    );
  }
  // show all 8 bit slots so the user sees what's mapped
  return (
    <div className="flag-block">
      <div className="flag-h">
        <label>{set.label}</label>
        <span className="flag-byte">0x{hex2(set.byte)} · {set.byte.toString(2).padStart(8,'0')}</span>
      </div>
      <div className="flag-bits">
        {Array.from({ length: 8 }, (_, b) => {
          const on = !!(set.byte & (1 << b));
          const lab = set.bits.find((x) => x.bit === b)?.label || `bit ${b}`;
          return (
            <div key={b} className={`flag-bit ${on ? 'on' : 'off'}`}>
              <span className="flag-bit-i">{b}</span>
              <span className="flag-bit-l">{lab}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FrameInspector({ frame }) {
  const ann = useMemo(() => UARTParser.annotateBytes(frame, frame.interp), [frame]);
  return (
    <div className="inspect">
      <div className="inspect-grid">
        <div><label>address</label><span>0x{frame.addrHex} <em>{UARTParser.DEVICES[frame.addrHex]?.name || 'unknown'}</em></span></div>
        <div><label>control</label><span>0x{hex2(frame.control)} <em>{frame.isAnswer ? 'reply' : 'request'}</em></span></div>
        <div><label>code</label><span>0x{frame.codeBare}</span></div>
        <div><label>length</label><span>{frame.len} bytes</span></div>
        <div><label>checksum</label><span className={frame.sumOk ? 'ok' : 'bad'}>{frame.sumOk ? `valid · 0x${frame.sumExpected}` : `INVALID exp 0x${frame.sumExpected}`}</span></div>
        <div><label>terminator</label><span>{frame.terminator ? '0x16 ✓' : 'missing'}</span></div>
        <div><label>preamble</label><span>{frame.prefixLen} × 0xFE</span></div>
        <div><label>kind</label><span>{KIND_LABEL[frame.interp.kind]}</span></div>
      </div>

      {frame.interp.fields?.length > 0 && (
        <div className="inspect-section">
          <div className="inspect-h">decoded fields</div>
          <div className="field-list">
            {frame.interp.fields.map((f, i) => (
              <div key={i} className="field">
                <label>{f.label}</label>
                <span>{f.value}</span>
                {f.hint && <em>{f.hint}</em>}
              </div>
            ))}
          </div>
        </div>
      )}

      {frame.interp.flagSet?.length > 0 && (
        <div className="inspect-section">
          <div className="inspect-h">flag bits</div>
          <div className="flag-stack">
            {frame.interp.flagSet.map((s, i) => <FlagTable key={i} set={s} />)}
          </div>
        </div>
      )}

      {frame.interp.kind === 'bms-cells' && frame.interp.cells && (
        <div className="inspect-section">
          <div className="inspect-h">cell voltages · 20-string · 0.1 mV units</div>
          <div className="inspect-cells">
            {frame.interp.cells.map((v, i) => (
              <div key={i} className={`ic ${v === frame.interp.cellMax ? 'ic-hi' : ''} ${v > 0 && v === frame.interp.cellMin ? 'ic-lo' : ''}`}>
                <span className="ic-i">{pad2(i + 1)}</span>
                <span className="ic-v">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="inspect-section">
        <div className="inspect-h">payload bytes <em>(byte − 0x33 from wire)</em></div>
        <div className="ba-grid">
          {Array.from(frame.data).map((b, i) => (
            <ByteAnnotated key={i} ann={ann[i] || { role: 'data', label: '·' }} value={hex2(b)} idx={i} />
          ))}
        </div>
      </div>

      <div className="inspect-section">
        <div className="inspect-h">raw frame on wire</div>
        <code className="raw-wire">{Array.from(frame.raw).map(hex2).join(' ')}</code>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// App
// ────────────────────────────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "playbackRate": 8,
  "autoPlay": true,
  "showRaw": true,
  "compactDensity": false,
  "accent": "amber"
}/*EDITMODE-END*/;

const ACCENTS = {
  amber:  'oklch(0.78 0.14 65)',
  cyan:   'oklch(0.78 0.10 215)',
  lime:   'oklch(0.82 0.14 130)',
  rose:   'oklch(0.78 0.14 20)',
};

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const accent = ACCENTS[tweaks.accent] || ACCENTS.amber;

  // Apply density / accent globally
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.dataset.density = tweaks.compactDensity ? 'compact' : 'normal';
  }, [accent, tweaks.compactDensity]);

  // ── data load
  const [parsed, setParsed] = useState({ bytes: new Uint8Array(0), lineRanges: [] });
  const [loadErr, setLoadErr] = useState(null);
  useEffect(() => {
    fetch('data/sample.txt')
      .then((r) => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
      .then((txt) => setParsed(UARTParser.parseSampleText(txt)))
      .catch((e) => setLoadErr(String(e)));
  }, []);

  // ── playback state
  const [eventIdx, setEventIdx] = useState(0); // index into lineRanges
  const [playing, setPlaying] = useState(tweaks.autoPlay);
  const totalEvents = parsed.lineRanges.length;
  const cursor = useMemo(() => {
    if (!totalEvents) return 0;
    const i = Math.min(eventIdx, totalEvents - 1);
    return parsed.lineRanges[i][1];
  }, [eventIdx, parsed, totalEvents]);

  // step rate driven by tweaks.playbackRate (events per sec)
  useEffect(() => {
    if (!playing || !totalEvents) return;
    const ms = Math.max(8, 1000 / Math.max(1, tweaks.playbackRate));
    const id = setInterval(() => {
      setEventIdx((i) => {
        if (i >= totalEvents - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [playing, totalEvents, tweaks.playbackRate]);

  // ── frames decoded so far
  const buffer = parsed.bytes;
  const frames = useMemo(() => {
    if (!buffer.length || !totalEvents) return [];
    const out = [];
    const upTo = cursor;
    let i = 0;
    let nFrame = 0;
    const baseTs = Date.now() - totalEvents * 50;
    while (i < upTo) {
      const f = UARTParser.findFrame(buffer, i);
      if (!f) break;
      if (f.end > upTo) break;
      f.interp = UARTParser.interpret(f);
      f.ts = baseTs + nFrame * 47;
      f.tsLabel = fmtTime(f.ts);
      out.push(f);
      i = f.end;
      nFrame++;
    }
    return out;
  }, [buffer, cursor, totalEvents]);

  // ── derived state for the dashboards
  const latest = useMemo(() => {
    let summary = null, cells = null, info = null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (!summary && f.interp.kind === 'bms-summary') summary = f;
      if (!cells   && f.interp.kind === 'bms-cells')   cells = f;
      if (!info    && f.interp.kind === 'bms-info')    info = f;
      if (summary && cells && info) break;
    }
    // bms-cells frames carry the summary block too — use them as a fallback.
    if (!summary && cells) summary = cells;
    return { summary, cells, info };
  }, [frames]);

  const history = useMemo(() => {
    const v = [], a = [], s = [];
    frames.forEach((f) => {
      if (f.interp.kind === 'bms-summary' || f.interp.kind === 'bms-cells') {
        if (typeof f.interp.voltage === 'number') v.push(f.interp.voltage);
        if (typeof f.interp.current === 'number') a.push(f.interp.current);
        if (typeof f.interp.soc === 'number')     s.push(f.interp.soc);
      }
    });
    return {
      v: v.slice(-120),
      a: a.slice(-120),
      s: s.slice(-120),
    };
  }, [frames]);

  // ── stats
  const stats = useMemo(() => {
    const byDev = {};
    let bad = 0;
    frames.forEach((f) => {
      const k = f.addrHex;
      byDev[k] = (byDev[k] || 0) + 1;
      if (!f.sumOk) bad++;
    });
    return { total: frames.length, byDev, bad };
  }, [frames]);

  // ── multi-select device filter (persisted as comma-joined string)
  const filterRaw = tweaks.filterDevices || '';
  const activeDevices = useMemo(() => new Set(filterRaw.split(',').filter(Boolean)), [filterRaw]);
  const toggleDevice = useCallback((addr) => {
    const next = new Set(activeDevices);
    next.has(addr) ? next.delete(addr) : next.add(addr);
    setTweak('filterDevices', Array.from(next).join(','));
  }, [activeDevices, setTweak]);
  const clearDevices = useCallback(() => setTweak('filterDevices', ''), [setTweak]);

  const filtered = useMemo(() => {
    if (activeDevices.size === 0) return frames;
    return frames.filter((f) => activeDevices.has(f.addrHex));
  }, [frames, activeDevices]);

  // Group request+reply pairs into a single exchange entry. Solo frames
  // (orphan replies, unmatched requests) become standalone rows.
  const events = useMemo(() => UARTParser.pairExchanges(filtered), [filtered]);

  // ── selection
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    if (!picked) return;
    // when frames advance, keep latest pick "live" if it's the most recent
  }, [picked, frames]);

  // auto-scroll log
  const logRef = useRef(null);
  useEffect(() => {
    if (!logRef.current) return;
    if (!playing) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events.length, playing]);

  const stepBy = useCallback((n) => {
    setPlaying(false);
    setEventIdx((i) => Math.max(0, Math.min(totalEvents - 1, i + n)));
  }, [totalEvents]);

  const reset = useCallback(() => {
    setPlaying(false);
    setEventIdx(0);
    setPicked(null);
  }, []);

  // ── header live status
  const status = playing ? 'streaming' : (eventIdx >= totalEvents - 1 && totalEvents ? 'end of capture' : 'paused');
  const statusDot = playing ? 'live' : (status === 'paused' ? 'idle' : 'done');

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <div className="brand-mark"></div>
          <div className="brand-stack">
            <div className="brand-name">UART · CAN inspector</div>
            <div className="brand-sub">battery + station bus monitor</div>
          </div>
        </div>

        <div className="status-cluster">
          <div className={`status-pill status-${statusDot}`}>
            <span className="dot"></span>
            <span>{status}</span>
          </div>
          <div className="status-meta">
            <div><label>port</label><span>/dev/ttyUSB0</span></div>
            <div><label>baud</label><span>9600 8N1</span></div>
            <div><label>frames</label><span>{stats.total}</span></div>
            <div><label>chk fail</label><span className={stats.bad ? 'warn' : ''}>{stats.bad}</span></div>
          </div>
        </div>

        <div className="transport">
          <button className="t-btn" onClick={reset} title="rewind">⏮</button>
          <button className="t-btn" onClick={() => stepBy(-1)} title="back one event">−1</button>
          <button className={`t-btn t-play ${playing ? 'on' : ''}`} onClick={() => setPlaying((p) => !p)}>
            {playing ? '◼ pause' : '▶ play'}
          </button>
          <button className="t-btn" onClick={() => stepBy(1)} title="step one event">+1</button>
          <button className="t-btn" onClick={() => stepBy(50)} title="jump 50 events">+50</button>
        </div>
      </header>

      <div className="scrub">
        <input type="range" min={0} max={Math.max(0, totalEvents - 1)} value={eventIdx}
               onChange={(e) => { setPlaying(false); setEventIdx(parseInt(e.target.value, 10)); }} />
        <div className="scrub-meta">
          <span>{eventIdx} / {totalEvents}</span>
          <span>·</span>
          <span>{cursor.toLocaleString()} bytes</span>
          <span>·</span>
          <span>{tweaks.playbackRate}× rate</span>
        </div>
      </div>

      {loadErr && <div className="banner err">data/sample.txt failed to load: {loadErr}</div>}

      <main className="grid">
        {/* ── BMS card ── */}
        <section className="card card-bms">
          <header className="card-h">
            <span className="card-title">battery pack</span>
            <span className="card-sub">{latest.info?.interp?.serial || latest.info?.interp?.model || 'awaiting BMS info…'}</span>
          </header>
          <div className="bms-readouts">
            <div className="rdo">
              <label>voltage</label>
              <div className="rdo-val">{latest.summary ? latest.summary.interp.voltage.toFixed(1) : '——'}<small>V</small></div>
              <Spark data={history.v} accent={accent} />
            </div>
            <div className="rdo">
              <label>current</label>
              <div className="rdo-val">{latest.summary ? latest.summary.interp.current.toFixed(1) : '——'}<small>A</small></div>
              <Spark data={history.a} accent={accent} />
            </div>
            <div className="rdo">
              <label>state of charge</label>
              <div className="rdo-val">{latest.summary ? latest.summary.interp.soc : '——'}<small>%</small></div>
              <div className="soc-bar"><div className="soc-fill" style={{ width: `${latest.summary ? latest.summary.interp.soc : 0}%` }}></div></div>
            </div>
            <div className="rdo">
              <label>flags</label>
              <div className="rdo-mono">{latest.summary ? latest.summary.interp.flags : '·· ·· ··'}</div>
              <div className="rdo-temps">
                {(latest.summary ? latest.summary.interp.temps : [null,null,null,null,null]).map((t, i) => (
                  <span key={i} className="temp-chip"><label>T{i+1}</label><span>{t == null ? '——' : `${t}°`}</span></span>
                ))}
              </div>
            </div>
          </div>
          <div className="cells-wrap">
            <div className="cells-h">
              <span>cell voltages · 20-string</span>
              <span className="cells-stats">
                {latest.cells ? (
                  <>
                    <em>min</em>{Math.min(...latest.cells.interp.cells.filter(v=>v>0))}
                    &nbsp;<em>max</em>{Math.max(...latest.cells.interp.cells)}
                    &nbsp;<em>Δ</em>{Math.max(...latest.cells.interp.cells) - Math.min(...latest.cells.interp.cells.filter(v=>v>0))}
                  </>
                ) : <em>no cell data yet</em>}
              </span>
            </div>
            <CellPack cells={latest.cells?.interp?.cells} />
          </div>
        </section>

        {/* ── Bus map / device counters ── */}
        <section className="card card-bus">
          <header className="card-h"><span className="card-title">bus map</span><span className="card-sub">device addresses on the line</span></header>
          <div className="bus-list">
            {Object.entries(UARTParser.DEVICES).map(([addr, dev]) => {
              const n = stats.byDev[addr] || 0;
              const seen = n > 0;
              const on = activeDevices.has(addr);
              return (
                <button key={addr} className={`bus-row ${seen ? 'seen' : ''} ${on ? 'on' : ''}`}
                        onClick={() => toggleDevice(addr)}
                        disabled={!seen}>
                  <span className={`bus-check ${on ? 'checked' : ''}`}>{on ? '✓' : ''}</span>
                  <span className="bus-addr">0x{addr}</span>
                  <span className="bus-name">
                    <span className="bus-name-main">{dev.name}</span>
                    <span className="bus-name-role">{dev.role}</span>
                  </span>
                  <span className="bus-count">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="bus-actions">
            <button className="bus-action" onClick={clearDevices} disabled={activeDevices.size === 0}>
              show all ({activeDevices.size === 0 ? 'active' : 'clear filter'})
            </button>
            <span className="bus-hint">click rows to filter · multi-select</span>
          </div>
          <div className="legend">
            <div><span className="lg lg-pre"></span>preamble FE</div>
            <div><span className="lg lg-mark"></span>frame mark 68</div>
            <div><span className="lg lg-ctrl"></span>control</div>
            <div><span className="lg lg-data"></span>encoded data</div>
            <div><span className="lg lg-sum"></span>checksum</div>
            <div><span className="lg lg-end"></span>terminator 16</div>
          </div>
        </section>

        {/* ── Raw bytes stream ── */}
        {tweaks.showRaw && (
          <section className="card card-bytes">
            <header className="card-h">
              <span className="card-title">raw bytes</span>
              <span className="card-sub">colorized by frame role · last 512B window</span>
            </header>
            <BytesView buffer={buffer} frames={frames} cursor={cursor} />
          </section>
        )}

        {/* ── Frame log ── */}
        <section className="card card-log">
          <header className="card-h">
            <span className="card-title">frame log</span>
            <span className="card-sub">
              {activeDevices.size === 0 ? `${events.length} exchanges · ${filtered.length} frames` : `${events.length} exchanges · ${activeDevices.size} device${activeDevices.size>1?'s':''}`}
            </span>
          </header>
          <div className="log-body" ref={logRef}>
            {events.length === 0 && <div className="log-empty">— no frames yet —</div>}
            {events.slice(-200).map((ev, i) => (
              ev.kind === 'pair'
                ? <PairRow key={'p'+ev.request.start} pair={ev}
                           onPick={setPicked}
                           pickedStart={picked?.start} />
                : <FrameRow key={'f'+ev.frame.start+':'+i} frame={ev.frame}
                            picked={picked && picked.start === ev.frame.start}
                            onPick={setPicked} />
            ))}
          </div>
        </section>

        {/* ── Inspector ── */}
        <section className="card card-inspect">
          <header className="card-h">
            <span className="card-title">frame inspector</span>
            <span className="card-sub">{picked ? `0x${picked.addrHex} · ctl=0x${hex2(picked.control)} · ${KIND_LABEL[picked.interp.kind]}` : 'select a frame'}</span>
          </header>
          {picked ? (
            <FrameInspector frame={picked} />
          ) : (
            <div className="inspect-empty">click any row in the frame log to inspect →</div>
          )}
        </section>
      </main>

      <TweaksPanel title="Tweaks" initialPos={{ right: 24, bottom: 24 }}>
        <TweakSection title="playback">
          <TweakSlider label="rate (events/s)" value={tweaks.playbackRate} min={1} max={120} step={1}
            onChange={(v) => setTweak('playbackRate', v)} />
          <TweakToggle label="auto-play on load" value={tweaks.autoPlay}
            onChange={(v) => setTweak('autoPlay', v)} />
        </TweakSection>
        <TweakSection title="layout">
          <TweakToggle label="show raw bytes panel" value={tweaks.showRaw}
            onChange={(v) => setTweak('showRaw', v)} />
          <TweakToggle label="compact density" value={tweaks.compactDensity}
            onChange={(v) => setTweak('compactDensity', v)} />
        </TweakSection>
        <TweakSection title="theme">
          <TweakRadio label="accent" value={tweaks.accent}
            options={[
              { value: 'amber', label: 'amber' },
              { value: 'cyan',  label: 'cyan' },
              { value: 'lime',  label: 'lime' },
              { value: 'rose',  label: 'rose' },
            ]} onChange={(v) => setTweak('accent', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

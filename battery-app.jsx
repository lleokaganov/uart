/* global React, ReactDOM, UARTParser */
const { useEffect, useMemo, useRef, useState, useCallback } = React;

// ── source mode persisted in localStorage ──────────────────────────────────
const LS_MODE = 'bms-source';
const LS_FILE = 'bms-source-file';
function readMode() {
  try {
    const v = window.localStorage.getItem(LS_MODE);
    return v === 'can' ? 'can' : 'rs485';
  } catch { return 'rs485'; }
}
function readFile(mode) {
  try {
    const v = window.localStorage.getItem(LS_FILE);
    const src = UARTParser.SOURCES[mode];
    if (v && src && src.files.some((f) => f.value === v)) return v;
    return src ? src.defaultFile : 'data/sample.txt';
  } catch { return 'data/sample.txt'; }
}
function writeMode(m) { try { window.localStorage.setItem(LS_MODE, m); } catch {} }
function writeFile(f) { try { window.localStorage.setItem(LS_FILE, f); } catch {} }

// ────────────────────────────────────────────────────────────────────────────
// Pack SVG — a tall, slightly-tapered cell shape with terminal nub, a label
// area, and a fluid level we tint based on charge state. No icons. No badges.
// ────────────────────────────────────────────────────────────────────────────
function PackSVG({ fillPct }) {
  const fill = Math.max(0.02, Math.min(1, fillPct || 0));
  const fluidY = 36 + (1 - fill) * 380;
  const fluidH = fill * 380;
  return (
    <svg viewBox="0 0 200 460" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="shell" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="oklch(0.92 0.005 60)" />
          <stop offset="35%"  stopColor="oklch(0.97 0.004 60)" />
          <stop offset="65%"  stopColor="oklch(0.95 0.004 60)" />
          <stop offset="100%" stopColor="oklch(0.86 0.008 60)" />
        </linearGradient>
        <linearGradient id="cap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="oklch(0.78 0.006 60)" />
          <stop offset="100%" stopColor="oklch(0.62 0.008 60)" />
        </linearGradient>
        <linearGradient id="well" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="oklch(0.84 0.005 60)" />
          <stop offset="100%" stopColor="oklch(0.92 0.004 60)" />
        </linearGradient>
        <linearGradient id="fluid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="oklch(0.78 0.05 145 / 0.85)" />
          <stop offset="100%" stopColor="oklch(0.66 0.07 145 / 0.95)" />
        </linearGradient>
        <clipPath id="wellclip">
          <rect x="20" y="36" width="160" height="380" rx="6" />
        </clipPath>
      </defs>

      {/* positive terminal nub */}
      <rect x="78" y="0" width="44" height="14" rx="2" fill="url(#cap)" />
      <rect x="84" y="2" width="32" height="3"  fill="oklch(0.92 0.004 60)" opacity="0.7" />

      {/* shell */}
      <rect x="10" y="14" width="180" height="436" rx="14" fill="url(#shell)"
            stroke="oklch(0.78 0.008 60)" strokeWidth="0.8" />

      {/* inner well */}
      <rect x="20" y="36" width="160" height="380" rx="6" fill="url(#well)" />

      {/* fluid */}
      <g clipPath="url(#wellclip)">
        <rect className="pack-fluid" x="20" y={fluidY} width="160" height={fluidH}
              fill="url(#fluid)" />
        {/* meniscus */}
        <ellipse cx="100" cy={fluidY} rx="80" ry="3"
                 fill="oklch(0.94 0.02 145)" opacity="0.6" />
      </g>

      {/* horizontal score lines on the can */}
      <line x1="10" y1="40"  x2="190" y2="40"  stroke="oklch(0.78 0.008 60)" strokeWidth="0.6" opacity="0.6" />
      <line x1="10" y1="412" x2="190" y2="412" stroke="oklch(0.78 0.008 60)" strokeWidth="0.6" opacity="0.6" />

      {/* highlight stripe */}
      <rect x="34" y="50" width="6" height="350" rx="2" fill="oklch(1 0 0)" opacity="0.55" />

      {/* label area — extremely subtle, just a band */}
      <rect x="20" y="220" width="160" height="64" fill="oklch(0.94 0.005 60)" opacity="0.55" />
    </svg>
  );
}

// Single-cell SVG used in the cell-pack zoom
function CellSVG({ fillPct, warn }) {
  const fill = Math.max(0.05, Math.min(1, fillPct || 0));
  const fluidY = 12 + (1 - fill) * 130;
  const fluidH = fill * 130;
  return (
    <svg viewBox="0 0 56 152" preserveAspectRatio="xMidYMid meet">
      <rect x="20" y="0" width="16" height="6" rx="1" fill="oklch(0.62 0.008 60)" />
      <rect className="can-body" x="4" y="6" width="48" height="142" rx="5"
            fill="oklch(0.96 0.004 60)"
            stroke="oklch(0.78 0.008 60)" strokeWidth="0.6" />
      <rect x="8" y="10" width="40" height="134" rx="3" fill="oklch(0.92 0.005 60)" />
      <rect className="can-fluid" x="8" y={fluidY} width="40" height={fluidH}
            fill={warn ? 'oklch(0.78 0.16 65 / 0.55)' : 'oklch(0.74 0.06 145 / 0.55)'} />
      <rect x="11" y="14" width="3" height="120" rx="1" fill="oklch(1 0 0)" opacity="0.5" />
    </svg>
  );
}

// Sparkline for the single-cell view — no axes, no labels, just the curve.
function CellSpark({ data, warn }) {
  if (!data || data.length < 2) return null;
  const w = 360, h = 60;
  const min = Math.min(...data), max = Math.max(...data);
  const range = Math.max(1, max - min);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i*step).toFixed(1)},${(h - 4 - ((v - min)/range)*(h-8)).toFixed(1)}`);
  const color = warn ? 'oklch(0.72 0.16 65)' : 'oklch(0.45 0.02 60)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1="0" y1={h-1} x2={w} y2={h-1} stroke="oklch(0.88 0.01 60)" strokeWidth="0.5" />
      <path d={`M${pts.join(' L')}`} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={pts[pts.length-1].split(',')[0]} cy={pts[pts.length-1].split(',')[1]} r="2.5" fill={color} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main app — single screen, three numbers, swipe to scrub, pinch/scroll to zoom
// ────────────────────────────────────────────────────────────────────────────
function App() {
  // ── source mode (RS485 ↔ CAN), persisted in localStorage
  const [sourceMode, setSourceMode] = useState(() => readMode());
  const [sourceFile, setSourceFile] = useState(() => readFile(readMode()));
  const SOURCE = UARTParser.SOURCES[sourceMode] || UARTParser.SOURCES.rs485;
  const isCan = sourceMode === 'can';

  // ── data
  const [parsed, setParsed] = useState({ bytes: new Uint8Array(0), lineRanges: [], frames: [] });
  const [bootDone, setBootDone] = useState(false);
  useEffect(() => {
    setBootDone(false);
    fetch(sourceFile)
      .then((r) => r.text())
      .then((txt) => {
        setParsed(SOURCE.parse(txt));
        setBootDone(true);
      })
      .catch(() => setBootDone(true));
  }, [sourceFile, sourceMode]);

  // Decode all frames once, up front. This is consumer view — playback is just
  // a virtual cursor across the full capture, not a streaming simulation.
  const allFrames = useMemo(() => {
    if (isCan) {
      const out = parsed.frames || [];
      out.forEach((f, i) => {
        if (!f.interp) f.interp = UARTParser.interpretCan(f);
        f.ts = i * 47;
      });
      return out;
    }
    if (!parsed.bytes || !parsed.bytes.length) return [];
    const out = [];
    let i = 0, n = 0;
    while (i < parsed.bytes.length) {
      const f = UARTParser.findFrame(parsed.bytes, i);
      if (!f) break;
      f.interp = UARTParser.interpret(f);
      f.ts = n * 47;
      out.push(f); i = f.end; n++;
    }
    return out;
  }, [parsed, isCan]);

  const cycleSource = useCallback(() => {
    setSourceMode((cur) => {
      const next = cur === 'rs485' ? 'can' : 'rs485';
      writeMode(next);
      const nf = (UARTParser.SOURCES[next] || UARTParser.SOURCES.rs485).defaultFile;
      setSourceFile(nf);
      writeFile(nf);
      return next;
    });
  }, []);

  // ── virtual time cursor
  // 1.0 = present, 0 = start of capture. The user drags horizontally to scrub.
  const [t, setT] = useState(1.0);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef(null);

  // Auto-advance the present so the live display ticks. We move slowly
  // through the capture so the numbers actually change while the user watches.
  useEffect(() => {
    if (scrubbing) return;
    if (!allFrames.length) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      // creep forward at ~1% per second when "live"
      setT((cur) => {
        if (cur >= 1.0) return 1.0;
        return Math.min(1.0, cur + dt * 0.01);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrubbing, allFrames.length]);

  // pointer-drag scrubbing
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const { startX, startT, w } = dragRef.current;
      const dx = (e.clientX ?? e.touches?.[0]?.clientX ?? startX) - startX;
      // a full screen-width drag = ±50% of capture
      const next = Math.max(0, Math.min(1, startT + (dx / w) * 0.5));
      setT(next);
    };
    const onUp = () => {
      dragRef.current = null;
      setScrubbing(false);
      // snap back to live if user landed within the last 2%
      setT((cur) => (cur > 0.98 ? 1.0 : cur));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const onPointerDown = (e) => {
    if (zoom !== 0) return;
    dragRef.current = { startX: e.clientX, startT: t, w: window.innerWidth };
    setScrubbing(true);
  };

  // ── derived state at t
  const frameCutoff = useMemo(() => {
    if (!allFrames.length) return 0;
    return Math.floor(t * (allFrames.length - 1));
  }, [t, allFrames.length]);

  const latestReply = useMemo(() => {
    const want = isCan ? 'can-bms-tpdo1' : 'bms-cells';
    for (let i = frameCutoff; i >= 0; i--) {
      const f = allFrames[i];
      if (f && f.interp.kind === want) return f;
    }
    return null;
  }, [allFrames, frameCutoff, isCan]);

  const latestInfo = useMemo(() => {
    if (isCan) {
      for (let i = frameCutoff; i >= 0; i--) {
        const f = allFrames[i];
        if (f && f.interp.kind === 'can-station-id' && f.interp.model) return f;
      }
      return null;
    }
    for (let i = frameCutoff; i >= 0; i--) {
      const f = allFrames[i];
      if (f && f.interp.kind === 'bms-info') return f;
    }
    return null;
  }, [allFrames, frameCutoff, isCan]);

  // history of cells across the whole capture (for single-cell view).
  // Empty in CAN mode — cell-level data is not transmitted on the PDO bus.
  const cellHistory = useMemo(() => {
    const series = Array.from({ length: 20 }, () => []);
    if (isCan) return series;
    allFrames.forEach((f, i) => {
      if (i > frameCutoff) return;
      if (f.interp.kind !== 'bms-cells') return;
      f.interp.cells.forEach((v, idx) => {
        if (v > 0) series[idx].push(v);
      });
    });
    return series.map((s) => s.slice(-160));
  }, [allFrames, frameCutoff, isCan]);

  const v   = latestReply?.interp?.voltage;
  const a   = latestReply?.interp?.current ?? 0;
  const soc = latestReply?.interp?.soc;
  const cells = latestReply?.interp?.cells || [];
  const cellMin = latestReply?.interp?.cellMin ?? 0;
  const cellMax = latestReply?.interp?.cellMax ?? 0;
  const cellSpread = cellMax - cellMin;

  // tint state
  let tint = 'idle';
  if (typeof a === 'number') {
    if (a > 0.5)  tint = 'discharge';
    if (a < -0.5) tint = 'charge';
  }
  const stateLabel = tint === 'charge' ? 'Charging' : tint === 'discharge' ? 'In use' : 'Resting';

  // outlier detection — flag a cell if it's >25 mV below the median
  // (cells are 0.1 mV units so 250 raw = 25 mV)
  const outlierIdx = useMemo(() => {
    if (isCan) return -1;
    const present = cells.map((c, i) => ({ c, i })).filter((x) => x.c > 0);
    if (present.length < 4) return -1;
    const sorted = [...present].sort((x, y) => x.c - y.c);
    const median = sorted[Math.floor(sorted.length / 2)].c;
    let worst = -1, worstDelta = 0;
    present.forEach(({ c, i }) => {
      const d = median - c;
      if (d > worstDelta && d >= 250) { worstDelta = d; worst = i; }
    });
    return worst;
  }, [cells, isCan]);

  // ── zoom navigation
  const [zoom, setZoom] = useState(0);
  const [pickedCell, setPickedCell] = useState(0);

  // CAN mode has no per-cell data — clamp zoom to the pack view.
  useEffect(() => {
    if (isCan && zoom !== 0) setZoom(0);
  }, [isCan, zoom]);

  // wheel/pinch to zoom in/out — disabled in CAN since there's nothing to zoom.
  useEffect(() => {
    if (isCan) return;
    const onWheel = (e) => {
      // pinch = ctrlKey under most browsers' trackpad gesture mapping
      if (Math.abs(e.deltaY) < 4) return;
      if (e.deltaY < 0) {
        // zoom in
        setZoom((z) => Math.min(2, z + 1));
      } else {
        setZoom((z) => Math.max(0, z - 1));
      }
      e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [isCan]);

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setZoom(0); }
      if (e.key === 'ArrowDown' || e.key === '-') setZoom((z) => Math.max(0, z - 1));
      if (e.key === 'ArrowUp'   || e.key === '+' || e.key === '=') setZoom((z) => Math.min(2, z + 1));
      if (zoom === 2) {
        if (e.key === 'ArrowLeft')  setPickedCell((c) => (c + 19) % 20);
        if (e.key === 'ArrowRight') setPickedCell((c) => (c + 1) % 20);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  // time stamp string for the scrub indicator
  const timeLabel = useMemo(() => {
    if (t >= 0.999) return 'NOW';
    const minsAgo = Math.round((1 - t) * 8); // pretend the capture spans ~8 min
    if (minsAgo === 0) return 'A MOMENT AGO';
    if (minsAgo === 1) return '1 MIN AGO';
    return `${minsAgo} MIN AGO`;
  }, [t]);

  // ── render
  if (!bootDone) {
    return <div className="stage"><div className="boot">connecting</div></div>;
  }
  if (!allFrames.length) {
    return <div className="stage"><div className="boot">no battery</div></div>;
  }

  const fillPct = (soc ?? 0) / 100;

  const stageCls = [
    'stage',
    `zoom-${zoom}`,
    `tint-${tint}`,
    scrubbing ? 'scrubbing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stageCls} onPointerDown={onPointerDown}>
      <div className="time-stage">
        <span>{timeLabel}</span>
      </div>

      <button
        className="src-pill"
        onClick={(e) => { e.stopPropagation(); cycleSource(); }}
        onPointerDown={(e) => e.stopPropagation()}
        title="switch protocol source">
        {sourceMode === 'rs485' ? 'RS485' : 'CAN'}
      </button>

      <button className="hint-back" onClick={() => setZoom((z) => Math.max(0, z - 1))}>
        ◂ back
      </button>

      {/* pack hero */}
      <div className="hero">
        <div className="pack">
          <PackSVG fillPct={fillPct} />
        </div>
        <div className="readout">
          <div className="num">
            <span className="v">{v != null ? v.toFixed(1) : '—'}</span>
            <span className="u">V</span>
          </div>
          <div className="sep" />
          <div className="num">
            <span className="v">{Math.abs(a).toFixed(1)}</span>
            <span className="u">A</span>
          </div>
          <div className="sep" />
          <div className="num">
            <span className="v">{soc ?? '—'}</span>
            <span className="u">%</span>
          </div>
        </div>
      </div>

      {/* cell pack zoom */}
      <div className="cells-stage">
        {isCan ? (
          <div className="cells-empty">cell voltages not available on CAN</div>
        ) : (
          <div className="cell-row">
            {cells.map((c, i) => {
              const present = cells.filter((x) => x > 0);
              const min = present.length ? Math.min(...present) : 0;
              const max = present.length ? Math.max(...present) : 1;
              const range = Math.max(1, max - min);
              const fill = c > 0 ? 0.25 + ((c - min) / range) * 0.7 : 0.05;
              return (
                <div key={i}
                     className={`cell-frame ${i === outlierIdx ? 'warn' : ''}`}
                     onClick={() => { setPickedCell(i); setZoom(2); }}>
                  <div className="num">{String(i+1).padStart(2,'0')}</div>
                  <CellSVG fillPct={fill} warn={i === outlierIdx} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* single cell zoom */}
      <div className="cell-detail">
        <div className="label">Cell {String(pickedCell + 1).padStart(2,'0')}</div>
        <div className="value">
          {cells[pickedCell] ? (cells[pickedCell] / 1000).toFixed(3) : '—'}
          <span className="u">V</span>
        </div>
        <div className="history">
          <CellSpark data={cellHistory[pickedCell]} warn={pickedCell === outlierIdx} />
        </div>
        <div className="neighbors">
          <button onClick={() => setPickedCell((c) => (c + 19) % 20)}>◂ prev</button>
          <button onClick={() => setPickedCell((c) => (c + 1) % 20)}>next ▸</button>
        </div>
      </div>

      {/* caption */}
      {zoom === 0 && (
        <div className="caption">
          <div className="name">{latestInfo?.interp?.model || 'Battery'}</div>
          <div className="state">
            <span className="dot" />
            <span>{stateLabel}</span>
          </div>
        </div>
      )}

      {/* outlier issue card — only on the pack view */}
      {zoom === 0 && outlierIdx >= 0 && (
        <div className="issue">
          <div className="glyph">!</div>
          <div className="body">
            <div className="head">Cell {String(outlierIdx + 1).padStart(2, '0')} is drifting.</div>
            <div className="desc">
              It's running about <em>{((cellMax - cells[outlierIdx]) / 10).toFixed(0)} mV</em> below
              the rest of the pack. This is normal after a deep discharge and usually resolves on the next full charge.
            </div>
          </div>
        </div>
      )}

      {/* hint at the bottom */}
      <div className={`hint ${zoom !== 0 ? 'hide' : ''}`}>
        <span>drag to look back</span>
        {!isCan && <>
          <span className="pip" />
          <span>scroll in to see the cells</span>
        </>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

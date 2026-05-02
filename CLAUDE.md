# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static web interface for inspecting the UART/CAN telemetry of a Movicom BMS Mini S battery and the charging station it talks to. Two views (`inspector.html` engineer, `battery.html` consumer) share one decoder (`parser.js`). Deployed at `uart.lleo.me`.

No build step: React 18 + Babel-standalone are loaded from CDN, JSX is transpiled in the browser. Open the HTML files via any static server.

## Common commands

```
# serve locally
python3 -m http.server 8000

# syntax-check the (only) plain-JS file
node --check parser.js

# smoke-test the decoder against captured data without a browser
node -e '
  const fs = require("fs");
  const win = {};
  new Function("window", fs.readFileSync("parser.js","utf8"))(win);
  const p = win.UARTParser.parseCanText(fs.readFileSync("data/can_run.txt","utf8"));
  console.log(p.frames.length, "frames");
  const f = p.frames.find(x => x.idHex === "01A0");
  f.interp = win.UARTParser.interpretCan(f);
  console.log(f.interp.summary);
'
```

There is no test suite, no linter, no package manager. Verification happens in a real browser. Use the Chrome MCP (`mcp__claude-in-chrome__*`) to drive `https://uart.lleo.me/inspector` or a local `127.0.0.1:8000/inspector.html` after pushing.

## Architecture

### One decoder, two protocols

`parser.js` is plain JS attached to `window.UARTParser` (no modules). It exposes a `SOURCES` registry that abstracts the active protocol:

- `SOURCES.rs485` — `[0xFE…] 68 ADDR 68 CTRL LEN DATA CHK [0x16]` byte stream. Each data byte is `wire = (logical + 0x33) & 0xFF` — subtract `0x33` to decode. The BMS Mini S address is `0x31CE`; the charging station is `0x10EF`.
- `SOURCES.can` — line-based CAN PDO captures (`<id_hex> <byte0> … <byte7>`, one frame per line). IDs follow the BMS Mini S CANopen mapping (0x080 sync, 0x1A0/0x2A0/0x3A0 BMS TPDOs, 0x720 heartbeat) and a CHAdeMO-style station bus (0x500/0x508 family + 0x580 ASCII identifiers).

Both pipelines produce frame objects with the same surface shape (`addrHex`, `data`, `len`, `interp`, `start`/`end`), so the React views consume them uniformly. CAN frames set `kind: 'can'`; RS485 frames set `kind: 'rs485'`. A top-level `UARTParser.annotate(frame, interp)` dispatches per-byte annotation to the right helper.

### Two views, both stateless re-decoders

Both views fetch a sample file and re-decode the entire stream on every render via memoized loops over the parsed bytes/lines. There is no persistent decoder state — every frame is a pure function of its bytes. This means tweaks (playback rate, source switch, scrub position) can change cheaply.

- `app.jsx` (engineer) — frame log with paired request/reply rows, byte-level annotated inspector, flag-bit tables, cell-pack visual, sparklines. Source switch lives in the **header**, not the TweaksPanel (see below). RS485 is the default.
- `battery-app.jsx` (consumer) — minimalist V/A/% readout with a 20-cell zoomable pack visualization. Source mode persisted in `localStorage` under keys `bms-source` and `bms-source-file`. A `.src-pill` in the top-right corner cycles RS485 ↔ CAN. CAN mode hides the cell row (PDO has no per-cell telemetry).

### TweaksPanel is invisible on the deployed site

`tweaks-panel.jsx` is a generic dev-tool helper from a Claude Design preview environment. It only renders when a parent iframe posts `__activate_edit_mode`. On `uart.lleo.me` (no embedder), the panel never opens and there is no opener button. **Anything end users need to interact with must live outside `<TweaksPanel>`.** The `TWEAK_DEFAULTS` block delimited by `/*EDITMODE-BEGIN*/`…`/*EDITMODE-END*/` may be rewritten by an external host tool — preserve those markers when editing defaults.

The TweaksPanel still works inside an embedder and is fine for dev-only knobs (playback rate, raw-bytes panel, accent color). Do not put protocol-level controls there.

### Why `can/can.txt` exists

This is the protocol *reference* — Russian/English bit-label tables for every BMS and station frame, sourced from the Movicom docs and the IEC 61851-24 / CHAdeMO specs. `parser.js` reads its bit labels from this file conceptually (the strings are duplicated into JS arrays). Three known decoder bugs were fixed in commit `e02ac7f`; the file deliberately keeps two non-spec bits (`01A0` byte 0 bits 5,6 — contactor feedback) because the firmware emits them despite the public spec listing those bits as reserved.

The byte-order notation in `can.txt` like `i/10 2,1` reads "high byte first in the listing" — i.e. **little-endian**, byte 2 is high, byte 1 is low. Easy to misread.

## Layout & data flow gotchas

- The cell-pack visualization in CAN mode would crash on `Math.max(...new Array(20).fill(null))` if not gated. The current code routes around this with an `isCan ?` ternary at the cell-stats line; if you add new derived stats from `interp.cells`, gate them the same way.
- `lineRanges` is the unit of playback for both protocols. RS485 uses it to map line index → byte cursor; CAN uses it as a 1:1 frame index. The `cursorOf` helper papers over the difference.
- The CAN source files (`data/can_start.txt`, `can_run.txt`, `can_bat.txt`, `can_end.txt`) are real captures of one charging session in four phases. `can_run.txt` is the most active and is the default for both views.

## Conventions in this repo

- Plain JS for `parser.js` (loaded as `<script src>`); JSX with `type="text/babel"` for the views. No imports, no exports — everything attaches to `window`.
- Classes prefixed `twk-` belong to `tweaks-panel.jsx`; the inspector uses unprefixed semantic class names (`.frow`, `.bus-row`, `.card-bms`, `.source-switch`); the consumer view uses `.stage`, `.hero`, `.cells-stage`, `.src-pill`.
- Russian labels in protocol bit lists are intentional and copied verbatim from the device documentation; do not paraphrase or translate.

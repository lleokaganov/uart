# Web interface — PR

Adds a static, self-contained web interface for the UART/CAN protocol used in
this repo. Two views, one shared decoder.

## Files

- `parser.js` — pure-JS frame decoder. Handles the `[FE…] 68 ADDR 68 CTRL LEN
  DATA CHK [16]` framing, the `+0x33` data shift, request/reply pairing, and
  the BMS Mini S payload semantics (info, summary, 20-cell block, flag bits).
  No DOM dependencies — usable from Node too.
- `inspector.html` + `app.jsx` + `styles.css` + `tweaks-panel.jsx` — engineer
  view. Live frame log with paired request+reply rows, byte-by-byte annotated
  inspector, flag-bit tables, cell pack visual, sparklines for V/A/SoC.
- `battery.html` + `battery-app.jsx` + `battery.css` — consumer view. One
  battery, three numbers (V/A/%), drag to scrub time, scroll/pinch to zoom
  into the 20 cells then into a single cell.
- `data/sample.txt` — copy of the supplied capture for the playback demo.

Both HTML files are static — open them with `file://` or any tiny static server.

## Stack

- React 18 + Babel-standalone via CDN (no build step).
- All decoding lives in `parser.js`. Both views read from the same source of
  truth.
- Sample capture is replayed as a virtual time stream; in production the
  parser would be fed bytes from a real serial port (`navigator.serial`,
  Node `serialport`, etc.) — the API is the same.

## Where to put it in the repo

Suggested: a new `web/` directory. The existing `index.html` / `uart.js` /
`mine.*` workbench is left untouched.

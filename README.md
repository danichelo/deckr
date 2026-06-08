# Deckr

**Present HTML decks like a native desktop app.**

Deckr is a focused, frameless desktop viewer that opens an HTML file (or folder) and presents it
full-screen — fast, distraction-free, and PDF-exportable. Think *Preview / Acrobat Reader, but for
HTML decks.* Built with AI-assisted workflows in mind (e.g. Claude-generated decks): open it, present
it, export a clean PDF, and send it.

<!-- Add a screenshot or GIF here: home screen → a deck → PDF export -->

---

## Features

- **Open anything HTML** — a single `.html`/`.htm` file, or a **folder** (auto-finds `index.html`).
  Relative assets (images, fonts, CSS, JS) all resolve because decks load over `file://`.
- **Live auto-reload** — watches the open file and silently reloads on save (300 ms debounce), with
  scroll position preserved. Ideal for editing loops.
- **Presentation mode** — true fullscreen, auto-hiding top bar, cursor auto-hides after 3 s, and a
  **Presentation Lock** for a pure, chrome-free content view.
- **Zoom & fit** — 25%–400% zoom plus Fit to Window / Width / Height. Zoom level is remembered.
- **PDF export — three modes**, all producing viewer-safe pages (no oversized-page warnings):
  - **Smart PDF** (default) — auto-detects decks vs documents; exports each slide as a full-bleed
    **16:9 landscape page** (13.333 × 7.5 in).
  - **Document PDF** — standard multi-page **Letter** pagination for reports.
  - **Exact Capture** (advanced) — preserves rendered size, with an oversized-page warning.
- **Recent files** — last 8, persisted to disk, with folder + timestamp; missing files are shown
  grayed (not deleted).
- **Native desktop feel** — full app menu, file associations (double-click `.html` to open),
  single-instance, remembered window size/position, custom min/maximize/close controls.
- **Dark & light themes**, a settings panel, and About + keyboard-shortcut overlays.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open HTML | `Ctrl/Cmd + O` |
| Open Folder | `Ctrl/Cmd + Shift + O` |
| Reload | `Ctrl/Cmd + R` |
| Export Smart PDF | `Ctrl/Cmd + P` |
| Close file | `Ctrl/Cmd + W` |
| Zoom in / out / reset | `Ctrl/Cmd + =` / `-` / `0` |
| Presentation Lock | `Ctrl/Cmd + L` |
| Toggle fullscreen | `F` or `F11` (`Ctrl/Cmd + Shift + F`) |
| Exit lock → fullscreen → home | `Esc` |
| Next / Prev / First / Last slide | `Space` `→` / `←` / `Home` / `End` *(passed to the deck)* |
| Shortcuts help | `?` or `F1` |

## Install & build

**Requirements:** Node.js 18+ and npm. (Electron bundles its own Chromium runtime.)

```bash
npm install        # install dependencies
npm start          # run in development

npm run dist-win   # build the Windows installer (NSIS)
npm run dist-mac   # build the macOS DMG  — must be run on macOS
npm run dist-all   # both
```

- Windows output: `dist/Deckr Setup 1.0.0.exe` (one-click installer) + `dist/win-unpacked/`.
- Default Windows install location: `%LOCALAPPDATA%\Programs\deckr\Deckr.exe`.

## Platform support

| Platform | Status |
|---|---|
| **Windows 10/11 (x64)** | Built and tested ✅ |
| **macOS (x64 + arm64)** | Cross-platform code + `dist-mac` target exist, but the macOS app **must be built on a Mac** and is **not yet code-signed/notarized**. Untested on macOS. |

## Project structure

```
main.js             # main process: window, native menu, IPC, file watching,
                    # recent/settings/window-state persistence, PDF export
preload.js          # contextBridge "presenter" API (secure IPC surface)
pdf-export.js       # pure PDF planning: deck/document detection + page-size logic
renderer/index.html # the entire UI (home, viewer, modals) — HTML/CSS/JS
assets/icon.png     # app icon (512×512)
package.json        # electron-builder config, scripts, file associations
```

## How it works

- **Electron 28** + `electron-builder` 24. No runtime dependencies beyond Electron — lean
  `node_modules`.
- Secure renderer: `contextIsolation: true`, `nodeIntegration: false`; all privileged actions go
  through the preload bridge. `webSecurity` is disabled **only** so local decks can load their own
  `file://` assets — **Deckr is intended for trusted, local HTML.**
- User data (survives reinstall) lives in `app.getPath('userData')`: `recent.json`, `settings.json`,
  `window-state.json`.
- PDF export renders the deck in a hidden window and uses Chromium's `printToPDF` with bounded,
  standard page sizes, so output opens cleanly in **Adobe Acrobat, Preview, Chrome, Outlook, Gmail,
  and Google Drive.**

## Known limitations

- macOS needs an on-Mac build plus signing/notarization; window controls currently use a
  Windows-style layout.
- Broken individual assets show the browser's broken-image glyph plus a small toast.
- Slide-navigation keys are passed through to the deck (Deckr can't synthesize "next slide" for
  arbitrary HTML).

## License

[MIT](LICENSE)

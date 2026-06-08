# Electron — HTML Presentation Viewer

Drop any HTML deck. Present full-screen. No browser chrome.

---

## Setup (one time, ~3 minutes)

**Step 1** — Install Node.js if you don't have it
→ https://nodejs.org (download the LTS version)

**Step 2** — Open Terminal (Mac) or Command Prompt (Windows) in this folder

**Step 3** — Run:
```
npm install
```

---

## Run it
```
npm start
```

---

## Build a real app you can double-click

**Mac → creates Electron.dmg**
```
npm run dist-mac
```

**Windows → creates Electron Setup.exe**
```
npm run dist-win
```

Output goes into the `dist/` folder.
Double-click the .dmg or .exe to install like any other app.

---

## How to use

- **Drop** any .html file onto the window
- Or click **Open File** to browse
- Recent files are remembered
- Arrow keys navigate slides
- Move mouse to top of screen to reveal toolbar
- Toolbar has fullscreen toggle, home button, close

---

## Custom icon (optional)

Drop your icon files into the `assets/` folder:
- `icon.icns` for Mac
- `icon.ico` for Windows

Then rebuild.

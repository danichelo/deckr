const { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const pkg = require('./package.json');
const pdfExport = require('./pdf-export');

const APP_NAME = (pkg.build && pkg.build.productName) || pkg.name;
const GITHUB_REPO = 'https://github.com/danichelo/deckr';
const GITHUB_RELEASES = GITHUB_REPO + '/releases';
const GITHUB_DOCS = GITHUB_REPO + '#readme';
const MAX_RECENT = 8;

let win;
let currentFilePath = null;
let watcher = null;
let reloadTimer = null;
let pendingOpen = null; // file requested before the window is ready
let viewing = false;    // renderer-reported: a deck is open
let locked = false;     // renderer-reported: presentation lock active

// ── userData-backed persistence (survives reinstall; not localStorage) ──
const recentFilePath = () => path.join(app.getPath('userData'), 'recent.json');
const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const toolsFilePath = () => path.join(app.getPath('userData'), 'tools.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { /* best effort */ }
}

// ── Settings ──
const DEFAULT_SETTINGS = { theme: 'dark', defaultZoom: 1, rememberWindowSize: true };
function readSettings() { return { ...DEFAULT_SETTINGS, ...readJSON(settingsPath(), {}) }; }
function writeSettings(patch) { writeJSON(settingsPath(), { ...readSettings(), ...patch }); }

// ── Recent files ──
function readRecent() { return readJSON(recentFilePath(), []); }
function writeRecent(list) { writeJSON(recentFilePath(), list); }
function addRecent(filePath) {
  let list = readRecent().filter(x => x.path !== filePath);
  list.unshift({
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
    time: Date.now(),
  });
  if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
  writeRecent(list);
}
// Annotate each entry with whether the file still exists (don't prune missing ones).
function recentWithStatus() {
  return readRecent().map(x => ({ ...x, exists: fs.existsSync(x.path) }));
}

// ── Tools (user-registered HTML files; permanent, persisted like recents) ──
function readTools() { return readJSON(toolsFilePath(), []); }
function writeTools(list) { writeJSON(toolsFilePath(), list); }
function addTool(name, filePath) {
  const list = readTools().filter(t => t.path !== filePath); // dedupe by path
  list.push({ name: name || path.basename(filePath), path: filePath, time: Date.now() });
  writeTools(list);
}
function toolsWithStatus() {
  return readTools().map(t => ({ ...t, exists: fs.existsSync(t.path) }));
}

// ── Window state ──
function isVisibleOnSomeDisplay(b) {
  return screen.getAllDisplays().some(d => {
    const w = d.workArea;
    return b.x < w.x + w.width && b.x + b.width > w.x &&
           b.y < w.y + w.height && b.y + b.height > w.y;
  });
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  if (!readSettings().rememberWindowSize) return;
  const normal = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  writeJSON(windowStatePath(), { bounds: normal, maximized: win.isMaximized() });
}

function createWindow() {
  const state = readSettings().rememberWindowSize ? readJSON(windowStatePath(), null) : null;
  const opts = {
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allows the deck iframe to load local file:// assets (images/fonts/css/js)
    },
  };
  if (state && state.bounds) {
    if (isVisibleOnSomeDisplay(state.bounds)) Object.assign(opts, state.bounds);
    else { opts.width = state.bounds.width; opts.height = state.bounds.height; }
  }

  win = new BrowserWindow(opts);
  if (state && state.maximized) win.maximize();

  win.loadFile('renderer/index.html');

  win.once('ready-to-show', () => {
    win.show();
    const argPath = pendingOpen || fileFromArgv(process.argv);
    pendingOpen = null;
    if (argPath) openPath(argPath);
  });

  // Keep renderer UI in sync with native window state.
  win.on('maximize', () => send('window-maximized', true));
  win.on('unmaximize', () => send('window-maximized', false));
  win.on('enter-full-screen', () => send('fullscreen-changed', true));
  win.on('leave-full-screen', () => send('fullscreen-changed', false));
  win.on('close', saveWindowState);
  win.on('closed', () => { stopWatching(); win = null; });

  // Keyboard handling that must fire even while the presentation iframe holds focus.
  // (Key events inside the sandboxed frame never reach the renderer's listeners.)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (input.key === 'Escape') {
      // Priority: exit lock → exit fullscreen (stay in viewer) → go home.
      if (locked) send('menu-command', 'exit-lock');
      else if (win.isFullScreen()) win.setFullScreen(false);
      else if (viewing) send('menu-command', 'home');
    } else if (mod && input.shift && (input.key === 'F' || input.key === 'f')) {
      win.setFullScreen(!win.isFullScreen());
    } else if (!mod && !input.alt && viewing && (input.key === 'F' || input.key === 'f')) {
      // Bare F toggles fullscreen while a deck is open.
      win.setFullScreen(!win.isFullScreen());
    }
    // Arrow / Space / Home / End are left untouched so they pass through to the deck.
  });

  // External links open in the OS browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Find an .html/.htm path among launch args (Windows double-click / file association).
function fileFromArgv(argv) {
  return argv.slice(1).find(a => /\.html?$/i.test(a) && fs.existsSync(a)) || null;
}

// ── File loading + watching ──
// Decks load over file:// so relative assets resolve and folder-based presentations work.
function openPath(filePath) {
  if (!filePath) return;
  let stat;
  try { stat = fs.statSync(filePath); }
  catch {
    send('file-error', { filePath, reason: 'File not found on disk.', notFound: true, reload: false });
    return;
  }
  if (stat.isDirectory()) {
    const entry = findEntryHtml(filePath);
    if (entry) return openPath(entry);
    send('toast', { type: 'error', message: 'No HTML file found in that folder' });
    return;
  }
  if (!/\.html?$/i.test(filePath)) {
    send('toast', { type: 'error', message: 'Unsupported file — open an .html file' });
    return;
  }
  currentFilePath = filePath;
  addRecent(filePath);
  buildMenu(); // refresh Open Recent
  startWatching(filePath);
  send('load-file', { filePath, fileUrl: pathToFileURL(filePath).href });
}

// Open a folder presentation: find its entry HTML (prefer index.html).
async function openFolder() {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return;
  const entry = findEntryHtml(r.filePaths[0]);
  if (!entry) {
    send('toast', { type: 'error', message: 'No HTML file found in that folder' });
    return;
  }
  openPath(entry);
}
function findEntryHtml(dir) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const idx = files.find(f => f.toLowerCase() === 'index.html' || f.toLowerCase() === 'index.htm');
  if (idx) return path.join(dir, idx);
  const html = files.find(f => /\.html?$/i.test(f));
  return html ? path.join(dir, html) : null;
}

// Re-read the current file (manual Ctrl+R / menu, or auto-reload on disk change).
function reloadCurrent(auto) {
  if (!currentFilePath) return;
  if (!fs.existsSync(currentFilePath)) {
    send('file-error', { filePath: currentFilePath, reason: 'File not found on disk.', notFound: true, reload: true });
    return;
  }
  send('file-updated', { filePath: currentFilePath, fileUrl: pathToFileURL(currentFilePath).href, auto: !!auto });
}

function startWatching(filePath) {
  stopWatching();
  try {
    watcher = fs.watch(filePath, () => scheduleAutoReload());
  } catch (e) { /* watching is best-effort */ }
}
function stopWatching() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  clearTimeout(reloadTimer);
}
function scheduleAutoReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    // Editors/AI tools often save atomically (rename), which detaches the watch — re-arm it.
    startWatching(currentFilePath);
    reloadCurrent(true);
  }, 300);
}

// ── PDF export ──
// Three modes, all producing PDF-safe, bounded page sizes (no oversized-page warnings):
//   smart    → auto-detect; deck = one landscape page per slide, document = paginated Letter
//   document → standard multi-page Letter pagination
//   exact    → preserve rendered size (clamped to the PDF ceiling), with a warning
async function exportPDF(mode) {
  mode = mode || 'smart';
  if (!currentFilePath) { send('toast', { type: 'error', message: 'Open a file first' }); return; }

  if (mode === 'exact') {
    const warn = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Export Anyway'],
      defaultId: 1, cancelId: 0,
      title: 'Exact Capture',
      message: 'Export at the deck’s exact rendered size?',
      detail: 'This can create very large PDF pages that some viewers (e.g. Adobe Acrobat) may warn about or refuse to open. For sharing with clients, use Smart PDF instead.',
    });
    if (warn.response !== 1) return;
  }

  const defaultName = path.basename(currentFilePath).replace(/\.html?$/i, '') + '.pdf';
  const save = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (save.canceled || !save.filePath) return;

  send('toast', { type: 'info', message: 'Exporting PDF…' });
  let pdfWin;
  try {
    // A standard 16:9 content viewport so viewport-relative (vw/vh) decks lay out at a
    // predictable, safe size; fixed-pixel decks keep their own dimensions.
    pdfWin = new BrowserWindow({
      show: false, width: 1280, height: 720, useContentSize: true,
      webPreferences: { webSecurity: false, offscreen: false },
    });
    await pdfWin.loadURL(pathToFileURL(currentFilePath).href);
    await new Promise(res => setTimeout(res, 450)); // let web fonts / images settle

    const det = await pdfWin.webContents.executeJavaScript(pdfExport.DETECT_JS);
    const effective = pdfExport.decideMode(mode, det);

    let plan;
    if (effective === 'deck') {
      plan = pdfExport.deckPlan(det);
    } else if (effective === 'document') {
      plan = pdfExport.documentPlan();
    } else {
      const size = await pdfWin.webContents.executeJavaScript(pdfExport.SIZE_JS);
      plan = pdfExport.exactPlan(size);
    }

    if (plan.css) {
      await pdfWin.webContents.insertCSS(plan.css);
      await new Promise(res => setTimeout(res, 120)); // allow reflow before printing
    }

    const data = await pdfWin.webContents.printToPDF(plan.options);
    fs.writeFileSync(save.filePath, data);
    send('toast', { type: 'success', message: 'PDF exported (' + pdfExport.modeLabel(effective) + ')' });
    shell.showItemInFolder(save.filePath);
  } catch (e) {
    send('toast', { type: 'error', message: 'PDF export failed' });
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close();
  }
}

function revealCurrent() {
  if (currentFilePath && fs.existsSync(currentFilePath)) shell.showItemInFolder(currentFilePath);
  else send('toast', { type: 'error', message: 'No file to reveal' });
}

// ── About ──
function appInfo() {
  return { name: APP_NAME, version: pkg.version, description: pkg.description, github: GITHUB_REPO, docs: GITHUB_DOCS };
}

// ── Native menu (rebuilt whenever recents change, so Open Recent stays current) ──
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (c) => () => send('menu-command', c);
  const recents = readRecent();

  const recentSubmenu = recents.length
    ? recents.map(r => ({ label: r.name, sublabel: r.dir, click: () => openPath(r.path) }))
        .concat([{ type: 'separator' }, { label: 'Clear Recent', click: () => { writeRecent([]); buildMenu(); send('recent-changed'); } }])
    : [{ label: 'No Recent Files', enabled: false }];

  const revealLabel = isMac ? 'Reveal in Finder' : 'Reveal in Explorer';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open HTML…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openFolder() },
        { label: 'Open Recent', submenu: recentSubmenu },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => reloadCurrent(false) },
        {
          label: 'Export PDF',
          submenu: [
            { label: 'Smart PDF', accelerator: 'CmdOrCtrl+P', click: () => exportPDF('smart') },
            { label: 'Document PDF', click: () => exportPDF('document') },
            { type: 'separator' },
            { label: 'Exact Capture (Advanced)…', click: () => exportPDF('exact') },
          ],
        },
        { label: revealLabel, click: () => revealCurrent() },
        { type: 'separator' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', click: cmd('close-file') },
        ...(isMac ? [] : [{ label: 'Quit', role: 'quit' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Fit to Window', click: cmd('fit-window') },
        { label: 'Fit Width', click: cmd('fit-width') },
        { label: 'Fit Height', click: cmd('fit-height') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: cmd('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: cmd('zoom-out') },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: cmd('zoom-reset') },
        { type: 'separator' },
        { label: 'Presentation Lock', accelerator: 'CmdOrCtrl+L', click: cmd('toggle-lock') },
        { role: 'togglefullscreen' }, // F11 on Win/Linux, Ctrl+Cmd+F on macOS
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: isMac ? undefined : 'F1', click: cmd('shortcuts') },
        { label: 'Documentation', click: () => shell.openExternal(GITHUB_DOCS) },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => shell.openExternal(GITHUB_RELEASES) },
        { label: `About ${APP_NAME}`, click: cmd('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC ──
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }],
  });
  if (!r.canceled && r.filePaths.length) { openPath(r.filePaths[0]); return true; }
  return false;
});
ipcMain.handle('open-folder', () => { openFolder(); return true; });
ipcMain.handle('open-path', (e, p) => { openPath(p); return true; });
ipcMain.handle('locate-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }],
  });
  if (!r.canceled && r.filePaths.length) { openPath(r.filePaths[0]); return true; }
  return false;
});
ipcMain.handle('reload-file', () => { reloadCurrent(false); return true; });
ipcMain.handle('get-recent', () => recentWithStatus());
ipcMain.handle('remove-recent', (e, p) => { writeRecent(readRecent().filter(x => x.path !== p)); buildMenu(); return recentWithStatus(); });
ipcMain.handle('clear-recent', () => { writeRecent([]); buildMenu(); return []; });

// Tools
ipcMain.handle('pick-tool-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { path: p, defaultName: path.basename(p).replace(/\.html?$/i, '') };
});
ipcMain.handle('add-tool', (e, { name, path: p }) => { addTool(name, p); return toolsWithStatus(); });
ipcMain.handle('get-tools', () => toolsWithStatus());
ipcMain.handle('remove-tool', (e, p) => { writeTools(readTools().filter(t => t.path !== p)); return toolsWithStatus(); });
ipcMain.handle('app-info', () => appInfo());
ipcMain.handle('get-settings', () => readSettings());
ipcMain.handle('set-settings', (e, patch) => { writeSettings(patch); return readSettings(); });

ipcMain.on('export-pdf', (e, mode) => exportPDF(mode));
ipcMain.on('reveal-file', () => revealCurrent());
ipcMain.on('viewer-state', (e, s) => { viewing = !!(s && s.viewing); locked = !!(s && s.locked); });
ipcMain.on('close-file', () => { currentFilePath = null; stopWatching(); });
ipcMain.on('open-external', (e, url) => shell.openExternal(url));
ipcMain.on('window-minimize', () => win && win.minimize());
ipcMain.on('window-maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('window-close', () => win && win.close());
ipcMain.on('window-fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));
ipcMain.on('exit-fullscreen', () => { if (win && win.isFullScreen()) win.setFullScreen(false); });

// ── App lifecycle (single instance so file-association double-clicks reuse the window) ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = fileFromArgv(argv);
    if (p) openPath(p);
  });

  // macOS file association / drag-to-dock.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (win) openPath(filePath); else pendingOpen = filePath;
  });

  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

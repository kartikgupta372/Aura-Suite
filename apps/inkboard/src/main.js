// Inkboard — main process
// Owns everything that touches the operating system: windows, the library
// folder on disk, file dialogs, export, settings and AI requests.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, net, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { pathToFileURL } = require('url');

const EXT = '.inkb';
const isMac = process.platform === 'darwin';

let win = null;
let watcher = null;
let watchTimer = null;
let pendingOpen = [];

// ---------------------------------------------------------------- settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaultSettings = () => ({
  libraryRoot: path.join(app.getPath('documents'), 'Inkboard'),
  theme: 'light',
  handwritingMode: 'neaten',          // off | neaten | convert
  neatenDelay: 900,
  convertDelay: 1600,
  convertFont: 'handwriting',         // handwriting | print
  aiProvider: 'anthropic',            // anthropic | openai
  aiModel: 'claude-haiku-5-5',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiKeyEnc: '',
  penOnly: false,
  defaultBackground: 'dots',
  recent: [],
  lastOpen: [],
  pressure: true,
  smoothing: 0.5,
});
let settings = null;

function loadSettings() {
  try {
    settings = Object.assign(defaultSettings(), JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    settings = defaultSettings();
  }
  return settings;
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}
function encryptKey(key) {
  if (!key) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(key).toString('base64');
  return 'raw:' + Buffer.from(key).toString('base64');
}
function decryptKey(s) {
  if (!s) return '';
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('raw:')) return Buffer.from(s.slice(4), 'base64').toString();
  } catch { /* fallthrough */ }
  return '';
}
function publicSettings() {
  const { aiKeyEnc, ...rest } = settings;
  return { ...rest, hasAiKey: !!decryptKey(aiKeyEnc) };
}

// ---------------------------------------------------------------- helpers
const safeName = (n) => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 120) || 'Untitled';

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}
async function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext);
  let i = 2;
  while (await exists(p)) p = path.join(dir, `${base} ${i++}${ext}`);
  return p;
}
function insideRoot(p) {
  const root = path.resolve(settings.libraryRoot);
  const rel = path.relative(root, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
// The page can only ask for notebook files, and library actions stay inside the library folder.
function needNotebook(p) {
  if (typeof p !== 'string' || !p.toLowerCase().endsWith(EXT)) throw new Error('Only .inkb notebooks can be opened or saved.');
  return p;
}
function needInLibrary(p) {
  if (typeof p !== 'string' || !insideRoot(p) || path.resolve(p) === path.resolve(settings.libraryRoot)) throw new Error('That item is outside your Inkboard library.');
  return p;
}
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function blankNotebook(title) {
  const now = Date.now();
  return {
    format: 'inkboard', version: 1, title, created: now, modified: now,
    pages: [{ id: 'p' + now.toString(36), name: 'Page 1', background: settings.defaultBackground, elements: [], view: { x: 0, y: 0, zoom: 1 } }],
    activePage: 0,
  };
}

async function ensureLibrary() {
  await fsp.mkdir(settings.libraryRoot, { recursive: true });
  const entries = await fsp.readdir(settings.libraryRoot);
  if (entries.length === 0) {
    // First run: give the user something to start in.
    await fsp.mkdir(path.join(settings.libraryRoot, 'My Notes'), { recursive: true });
    await atomicWrite(path.join(settings.libraryRoot, 'My Notes', 'Welcome' + EXT), JSON.stringify(blankNotebook('Welcome')));
  }
}

async function listTree(dir, depth = 0) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({ type: 'folder', name: e.name, path: full, children: depth < 8 ? await listTree(full, depth + 1) : [] });
    } else if (e.isFile() && e.name.toLowerCase().endsWith(EXT)) {
      let mtime = 0;
      try { mtime = (await fsp.stat(full)).mtimeMs; } catch {}
      out.push({ type: 'notebook', name: e.name.slice(0, -EXT.length), path: full, mtime });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'folder' ? -1 : 1));
  return out;
}

function startWatching() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  try {
    watcher = fs.watch(settings.libraryRoot, { recursive: true }, (_evt, file) => {
      if (file && (file.endsWith('.tmp'))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => win && win.webContents.send('lib:changed'), 250);
    });
    watcher.on('error', () => {});
  } catch { /* recursive watch unsupported: renderer refreshes after its own actions */ }
}

function addRecent(p) {
  settings.recent = [p, ...settings.recent.filter((r) => r !== p)].slice(0, 12);
  saveSettings();
}

// ---------------------------------------------------------------- window
function createWindow() {
  const dark = settings.theme === 'dark';
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: dark ? '#1b1d21' : '#f4f4f2',
    title: 'Inkboard',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: dark ? '#1b1d21' : '#f4f4f2', symbolColor: dark ? '#e8e8e8' : '#222', height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Keep links in text boxes out of the app window.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  // Right-click menu with spelling suggestions (Word-like).
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    const items = [];
    for (const s of params.dictionarySuggestions.slice(0, 6)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (params.misspelledWord) {
      if (!items.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { label: 'Paste as plain text', role: 'pasteAndMatchStyle' }, { type: 'separator' }, { role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.on('close', (e) => {
    // Let the renderer flush pending saves first.
    if (win.__closing) return;
    e.preventDefault();
    win.__closing = true;
    win.webContents.send('app:before-close');
    setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); }, 2500);
  });
  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------- IPC
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });
}

handle('settings:get', async () => publicSettings());
handle('settings:set', async (patch) => {
  const p = { ...patch };
  if ('aiKey' in p) { settings.aiKeyEnc = encryptKey(String(p.aiKey || '').trim()); delete p.aiKey; }
  delete p.aiKeyEnc;
  const rootChanged = p.libraryRoot && p.libraryRoot !== settings.libraryRoot;
  Object.assign(settings, p);
  saveSettings();
  if (p.theme && win && !isMac) {
    const dark = p.theme === 'dark';
    try { win.setTitleBarOverlay({ color: dark ? '#1b1d21' : '#f4f4f2', symbolColor: dark ? '#e8e8e8' : '#222' }); } catch {}
  }
  if (rootChanged) { await ensureLibrary(); startWatching(); }
  return publicSettings();
});

handle('lib:root', async () => settings.libraryRoot);
handle('lib:chooseRoot', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your Inkboard library folder', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.libraryRoot });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.libraryRoot = r.filePaths[0];
  saveSettings();
  await ensureLibrary();
  startWatching();
  return settings.libraryRoot;
});
handle('lib:tree', async () => ({ root: settings.libraryRoot, children: await listTree(settings.libraryRoot) }));
handle('lib:createFolder', async (parent, name) => {
  const dir = parent || settings.libraryRoot;
  const p = await uniquePath(dir, safeName(name || 'New folder'), '');
  await fsp.mkdir(p, { recursive: true });
  return p;
});
handle('lib:createNotebook', async (parent, name) => {
  const dir = parent || settings.libraryRoot;
  const base = safeName(name || 'Untitled notebook');
  const p = await uniquePath(dir, base, EXT);
  await atomicWrite(p, JSON.stringify(blankNotebook(path.basename(p, EXT))));
  return p;
});
handle('lib:rename', async (p, newName) => {
  needInLibrary(p);
  const isFile = p.toLowerCase().endsWith(EXT);
  const dir = path.dirname(p);
  const target = path.join(dir, safeName(newName) + (isFile ? EXT : ''));
  if (target === p) return p;
  if (await exists(target)) throw new Error('Something with that name already exists here.');
  await fsp.rename(p, target);
  return target;
});
handle('lib:delete', async (p) => { needInLibrary(p); await shell.trashItem(p); return true; });
handle('lib:move', async (src, destDir) => {
  needInLibrary(src);
  if (!insideRoot(destDir)) throw new Error('That folder is outside your Inkboard library.');
  if (path.resolve(destDir).startsWith(path.resolve(src) + path.sep)) throw new Error('Cannot move a folder into itself.');
  const isFile = src.toLowerCase().endsWith(EXT);
  const base = path.basename(src, isFile ? EXT : '');
  const target = path.join(destDir, path.basename(src));
  if (path.resolve(target) === path.resolve(src)) return src;
  const finalPath = (await exists(target)) ? await uniquePath(destDir, base, isFile ? EXT : '') : target;
  await fsp.rename(src, finalPath);
  return finalPath;
});
handle('lib:duplicate', async (p) => {
  needInLibrary(p);
  const isFile = p.toLowerCase().endsWith(EXT);
  const base = path.basename(p, isFile ? EXT : '') + ' copy';
  const target = await uniquePath(path.dirname(p), base, isFile ? EXT : '');
  await fsp.cp(p, target, { recursive: true });
  return target;
});
handle('lib:reveal', async (p) => { shell.showItemInFolder(p); return true; });

handle('file:read', async (p) => {
  needNotebook(p);
  const text = await fsp.readFile(p, 'utf8');
  addRecent(p);
  return text;
});
handle('file:write', async (p, text) => { needNotebook(p); await atomicWrite(p, text); return Date.now(); });
handle('file:exists', async (p) => exists(p));
handle('file:openDialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open notebook', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Inkboard notebook', extensions: ['inkb'] }], defaultPath: settings.libraryRoot });
  return r.canceled ? [] : r.filePaths;
});
handle('file:saveAsDialog', async (defaultName) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save notebook as', defaultPath: path.join(settings.libraryRoot, safeName(defaultName) + EXT), filters: [{ name: 'Inkboard notebook', extensions: ['inkb'] }] });
  return r.canceled ? null : r.filePath;
});
handle('file:openImageDialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Insert image', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }] });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths) {
    const buf = await fsp.readFile(f);
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    out.push('data:' + mime + ';base64,' + buf.toString('base64'));
  }
  return out;
});
handle('app:pendingOpen', async () => { const p = pendingOpen; pendingOpen = []; return p; });
handle('app:setLastOpen', async (paths) => { settings.lastOpen = paths; saveSettings(); return true; });
handle('app:toggleDevTools', async () => { win.webContents.toggleDevTools(); return true; });
handle('app:openExternal', async (url) => { if (/^https?:/.test(url)) await shell.openExternal(url); return true; });
handle('app:closeNow', async () => { if (win) win.destroy(); return true; });

// ---------------------------------------------------------------- export
// The renderer sends self-contained HTML for each page (ink rendered to an
// image + the live text boxes). We lay it out in a hidden window so text
// stays real text in PDFs and pixel-perfect in PNGs.
async function renderHidden(html, width, height, offscreen = false) {
  const tmp = path.join(os.tmpdir(), 'inkboard-export-' + Date.now() + '.html');
  await fsp.writeFile(tmp, html.replace('</style>', 'html,body{overflow:hidden}::-webkit-scrollbar{display:none}</style>'));
  // Offscreen windows are not limited to the screen size, so big boards export whole.
  const w = new BrowserWindow({
    show: false, width: Math.max(200, Math.ceil(width)), height: Math.max(200, Math.ceil(height)), useContentSize: true,
    enableLargerThanScreen: true, frame: false,
    webPreferences: { sandbox: true, offscreen, backgroundThrottling: false },
  });
  if (offscreen) { w.webContents.setFrameRate(5); w.setContentSize(Math.ceil(width), Math.ceil(height)); }
  await w.loadFile(tmp);
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
  return { w, tmp };
}
handle('export:pdf', async ({ html, defaultName }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Export PDF', defaultPath: path.join(app.getPath('documents'), safeName(defaultName) + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null;
  const { w, tmp } = await renderHidden(html, 1200, 900);
  try {
    const data = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    await fsp.writeFile(r.filePath, data);
  } finally { w.destroy(); fsp.unlink(tmp).catch(() => {}); }
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
handle('export:png', async ({ html, width, height, defaultName }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Export image', defaultPath: path.join(app.getPath('documents'), safeName(defaultName) + '.png'), filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (r.canceled) return null;
  const { w, tmp } = await renderHidden(html, width, height, true);
  try {
    await new Promise((r) => setTimeout(r, 120));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) });
    await fsp.writeFile(r.filePath, img.toPNG());
  } finally { w.destroy(); fsp.unlink(tmp).catch(() => {}); }
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
handle('export:assetUrl', async (rel) => pathToFileURL(path.join(__dirname, 'renderer', rel)).href);

// ---------------------------------------------------------------- AI
const TRANSCRIBE_PROMPT = [
  'This image contains handwriting written on a digital whiteboard.',
  'Transcribe it exactly as the writer intended. Keep the original wording, capitalisation, punctuation and line breaks.',
  'If a word is ambiguous, choose the most likely real word given the context.',
  'For maths or symbols use plain Unicode (e.g. ×, ÷, ², →, π).',
  'Reply with ONLY the transcription — no quotes, no commentary. If nothing is legible, reply with nothing.',
].join(' ');

handle('ai:transcribe', async ({ base64 }) => {
  const key = decryptKey(settings.aiKeyEnc);
  if (!key) throw new Error('Add an API key in Settings → AI to convert handwriting to text.');
  const model = settings.aiModel || 'claude-haiku-5-5';
  const t0 = Date.now();
  let text = '';
  if (settings.aiProvider === 'openai') {
    const base = (settings.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await net.fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 1024,
        messages: [{ role: 'user', content: [{ type: 'text', text: TRANSCRIBE_PROMPT }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + base64 } }] }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'AI request failed (' + res.status + ')');
    text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } else {
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 1024,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }, { type: 'text', text: TRANSCRIBE_PROMPT }] }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'AI request failed (' + res.status + ')');
    text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  return { text: text.trim(), ms: Date.now() - t0 };
});

// ---------------------------------------------------------------- lifecycle
function collectOpenArgs(argv) {
  return argv.filter((a) => typeof a === 'string' && a.toLowerCase().endsWith(EXT) && fs.existsSync(a));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = collectOpenArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length) win.webContents.send('app:open-files', files);
    }
  });
  app.on('open-file', (e, file) => { e.preventDefault(); if (win) win.webContents.send('app:open-files', [file]); else pendingOpen.push(file); });

  app.whenReady().then(async () => {
    loadSettings();
    nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : 'light';
    pendingOpen.push(...collectOpenArgs(process.argv.slice(1)));
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    try { await ensureLibrary(); } catch (e) { console.error(e); }
    startWatching();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}

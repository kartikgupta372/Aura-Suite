// Inkboard — application shell: notebooks, tabs, pages, toolbars, settings,
// saving to disk, export and keyboard shortcuts.
import { Board, PAPERS } from './board.js';
import { Handwriting } from './handwriting.js';
import { Library, parentDir } from './library.js';
import { FormatBar } from './format.js';
import { uid, debounce, toast, sanitizeHtml, escapeHtml, unionRect, clamp } from './util.js';
import { renderToCanvas, bounds, isShape, DEFAULT_INK, transformElement } from './ink.js';

const api = window.inkAPI;
const $ = (s) => document.querySelector(s);
const isMac = api.platform === 'darwin';
if (isMac) document.body.classList.add('mac');

const PEN_COLORS = [DEFAULT_INK, '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777'];
const HL_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74', '#c4b5fd'];
const STICKY_COLORS = ['#fff3a3', '#ffd6e7', '#cfe8ff', '#d3f5d3', '#ffe1b8', '#e6dcff'];
const SHAPES = [['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)'], ['diamond', 'Diamond'], ['triangle', 'Triangle'], ['line', 'Line (L)'], ['arrow', 'Arrow (A)']];
const BACKGROUNDS = [['plain', 'Plain'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Ruled lines']];
const PAPER_NAMES = { auto: 'Match app theme', white: 'White', cream: 'Cream', grey: 'Soft grey', dark: 'Dark', chalk: 'Chalkboard', navy: 'Navy' };

const state = { settings: {}, docs: [], active: -1 };
let board, hw, fmt, library;

// =================================================================== boot
async function init() {
  state.settings = await api.settings.get();
  board = new Board($('#stage'));
  window.__ink = { get board() { return board; } };
  hw = new Handwriting(board, () => state.settings);
  fmt = new FormatBar($('#formatBar'), board, appApi);
  library = new Library($('#sidebar'), appApi);
  applySettings();
  restoreToolPrefs();
  wireBoard();
  wireChrome();
  wireKeys();
  wirePasteDrop();
  wireFind();
  await library.refresh();

  api.lib.onChanged(debounce(() => library.refresh(), 150));
  api.app.onOpenFiles((files) => files.forEach((f) => openFile(f)));
  api.app.onBeforeClose(async () => {
    try { board.text.endEdit(); await flushAll(); await api.app.setLastOpen(state.docs.map((d) => d.path)); } catch {}
    api.app.closeNow();
  });

  const pending = await api.app.pendingOpen();
  const toOpen = [...new Set([...(state.settings.lastOpen || []), ...pending])];
  for (const p of toOpen) { if (await api.file.exists(p)) await openFile(p, { activate: false, quiet: true }); }
  if (state.docs.length) activate(pending.length ? state.docs.findIndex((d) => d.path === pending[pending.length - 1]) : 0);
  else {
    const first = firstNotebook(library.tree && library.tree.children);
    if (first) await openFile(first);
  }
  updateEmpty();
  if (localStorage.getItem('ink.pagesHidden') === '1') document.body.classList.add('no-pages');
  if (localStorage.getItem('ink.sideHidden') === '1') document.body.classList.add('no-sidebar');
}
function firstNotebook(nodes = []) {
  for (const n of nodes) {
    if (n.type === 'notebook') return n.path;
    const f = firstNotebook(n.children || []); if (f) return f;
  }
  return null;
}

// Small API the library / format bar call back into.
const appApi = {
  openFile: (p) => openFile(p),
  isOpen: (p) => state.docs.some((d) => d.path === p),
  activePath: () => (activeDoc() ? activeDoc().path : null),
  flushAll: () => flushAll(),
  pathMoved,
  closePathsUnder,
  openDialog,
  chooseLibrary,
  menu: (x, y, items) => showMenu(x, y, items),
  confirm: (t, b, ok) => confirmModal(t, b, ok),
  swatchMenu,
};

function applySettings() {
  const s = state.settings;
  document.body.classList.toggle('dark', s.theme === 'dark');
  $('#themeBtn use').setAttribute('href', s.theme === 'dark' ? '#i-sun' : '#i-moon');
  board.theme = s.theme;
  board.pressure = s.pressure !== false;
  board.smoothing = s.smoothing ?? 0.5;
  board.penOnly = !!s.penOnly;
  board.requestRender();
  updatePaperClass();
  updateHwChip();
  if (activeDoc()) { thumbCache.clear(); renderPages(); syncDock(); }
}
async function setSettings(patch) {
  state.settings = await api.settings.set(patch);
  applySettings();
}
function updatePaperClass() { board.text.layer.classList.toggle('dark-paper', board.darkPaper); }

// =================================================================== documents
const activeDoc = () => state.docs[state.active] || null;

function normalize(data, path) {
  if (!data || data.format !== 'inkboard' || !Array.isArray(data.pages)) throw new Error('Not an Inkboard notebook');
  if (!data.pages.length) data.pages.push(newPage(1));
  for (const p of data.pages) {
    p.id ||= uid('p');
    p.elements = Array.isArray(p.elements) ? p.elements.filter((e) => e && e.id && e.type) : [];
    p.background ||= state.settings.defaultBackground || 'dots';
    p.view ||= { x: 0, y: 0, zoom: 1 };
    p.name ||= 'Page';
  }
  data.activePage = clamp(data.activePage || 0, 0, data.pages.length - 1);
  data.title = baseName(path);
  return data;
}
function newPage(n) {
  return { id: uid('p'), name: 'Page ' + n, background: state.settings.defaultBackground || 'dots', paper: 'auto', elements: [], view: { x: -60, y: -120, zoom: 1 } };
}
const baseName = (p) => p.split(/[\\/]/).pop().replace(/\.inkb$/i, '');

async function openFile(path, { activate: act = true, quiet = false } = {}) {
  const i = state.docs.findIndex((d) => d.path === path);
  if (i >= 0) { if (act) activate(i); return; }
  try {
    const text = await api.file.read(path);
    const data = normalize(JSON.parse(text), path);
    const doc = { path, data, dirty: false, savedAt: Date.now() };
    doc.save = debounce(() => saveDoc(doc), 650);
    state.docs.push(doc);
    maybeSeedWelcome(doc);
    if (act) activate(state.docs.length - 1);
    else renderTabs();
    rememberOpen();
  } catch (e) {
    if (!quiet) toast('Could not open ' + baseName(path) + ': ' + e.message, 'error', 4000);
  }
}

function activate(i) {
  if (i < 0 || i >= state.docs.length) { state.active = -1; updateEmpty(); renderTabs(); renderPages(); return; }
  board.text.endEdit();
  state.active = i;
  const doc = activeDoc();
  const page = doc.data.pages[doc.data.activePage];
  board.setPage(page);
  updatePaperClass();
  renderTabs();
  renderPages();
  updateEmpty();
  updateStatus();
  library.render();
  document.title = doc.data.title + ' — Inkboard';
  fitIfFresh(page);
}
function fitIfFresh(page) {
  if (page.view.x === 0 && page.view.y === 0 && page.view.zoom === 1) board.fitContent(page.elements.length ? board.contentBounds() : null, 1);
}

async function closeDoc(i) {
  const doc = state.docs[i]; if (!doc) return;
  if (i === state.active) board.text.endEdit();
  await saveNow(doc);
  state.docs.splice(i, 1);
  if (state.active >= state.docs.length) state.active = state.docs.length - 1;
  else if (i < state.active) state.active--;
  activate(state.active);
  rememberOpen();
  library.render();
}

function rememberOpen() { api.app.setLastOpen(state.docs.map((d) => d.path)).catch(() => {}); }

function markDirty(doc = activeDoc()) {
  if (!doc) return;
  doc.dirty = true;
  doc.data.modified = Date.now();
  updateStatus();
  doc.save();
}

function serialize(doc) {
  const pages = doc.data.pages.map((p) => {
    if (p !== board.page) return p;
    return { ...p, elements: p.elements.map((e) => (e.type === 'text' ? { ...e, h: Math.round(board.textHeight(e)), html: board.text.liveHtml(e.id) ?? e.html } : e)) };
  });
  return JSON.stringify({ ...doc.data, pages });
}

async function saveDoc(doc) {
  if (doc.closed || !doc.dirty) return;
  if (doc.saving) { doc.save(); return; }
  doc.saving = true; doc.dirty = false;
  updateStatus();
  try {
    await api.file.write(doc.path, serialize(doc));
    doc.savedAt = Date.now(); doc.error = null;
  } catch (e) {
    doc.dirty = true; doc.error = e.message;
    toast('Could not save “' + doc.data.title + '”: ' + e.message, 'error', 5000);
  } finally {
    doc.saving = false;
    updateStatus();
  }
}
async function saveNow(doc) { if (!doc) return; doc.save.cancel(); if (doc.dirty) await saveDoc(doc); }
async function flushAll() { for (const d of state.docs) await saveNow(d); }

function updateStatus() {
  const doc = activeDoc();
  const el = $('#saveStatus');
  if (!doc) { el.textContent = ''; return; }
  el.title = doc.path;
  if (doc.error) el.textContent = 'Not saved — retrying';
  else if (doc.saving) el.textContent = 'Saving…';
  else if (doc.dirty) el.textContent = 'Edited';
  else el.textContent = 'Saved to ' + parentDir(doc.path).split(/[\\/]/).pop();
  renderTabs();
}

function pathMoved(oldP, newP) {
  for (const d of state.docs) {
    if (d.path === oldP) d.path = newP;
    else if (d.path.startsWith(oldP + '/') || d.path.startsWith(oldP + '\\')) d.path = newP + d.path.slice(oldP.length);
    d.data.title = baseName(d.path);
  }
  renderTabs(); updateStatus(); rememberOpen();
}
function closePathsUnder(p) {
  const under = (d) => d.path === p || d.path.startsWith(p + '/') || d.path.startsWith(p + '\\');
  const activeWasUnder = activeDoc() && under(activeDoc());
  for (const d of state.docs.filter(under)) { d.closed = true; d.save.cancel(); }
  const cur = activeDoc();
  state.docs = state.docs.filter((d) => !under(d));
  state.active = activeWasUnder ? Math.min(state.docs.length - 1, Math.max(0, state.active - 1)) : state.docs.indexOf(cur);
  activate(state.active);
  rememberOpen();
}

async function openDialog() {
  const files = await api.file.openDialog();
  for (const f of files) await openFile(f);
}
async function saveAs() {
  const doc = activeDoc(); if (!doc) return;
  board.text.endEdit();
  const p = await api.file.saveAsDialog(doc.data.title + ' copy');
  if (!p) return;
  await saveNow(doc);
  doc.data.title = baseName(p);
  await api.file.write(p, serialize(doc));
  await openFile(p);
  library.refresh();
  toast('Saved a copy as ' + baseName(p), 'ok');
}
async function chooseLibrary() {
  await flushAll();
  const root = await api.lib.chooseRoot();
  if (!root) return;
  state.settings = await api.settings.get();
  library.selectedFolder = null;
  await library.refresh();
  toast('Library folder: ' + root, 'ok');
}

function updateEmpty() {
  const none = !activeDoc();
  $('#emptyState').classList.toggle('hidden', !none);
  for (const id of ['#dock', '#zoomBar', '#hwChip']) $(id).classList.toggle('hidden', none);
  if (none) { $('#toolOptions').replaceChildren(); $('#selBar').classList.add('hidden'); document.title = 'Inkboard'; }
  else renderToolOptions();
}

function maybeSeedWelcome(doc) {
  if (localStorage.getItem('ink.welcomed') || doc.data.title !== 'Welcome') return;
  const p = doc.data.pages[0];
  if (p.elements.length) return;
  localStorage.setItem('ink.welcomed', '1');
  p.elements = [
    { id: uid(), type: 'text', x: 0, y: 0, w: 520, fs: 16, html: '<h1>Welcome to Inkboard</h1><div>A whiteboard you can also <b>write documents</b> on. Everything saves automatically into your library folder.</div><div><br></div><ul class="checklist"><li>Write with the <b>pen</b> (P). Pause and your handwriting gets neatened.</li><li><b>Double-click anywhere</b> to type, just like Word.</li><li>Type <code>#</code>, <code>-</code>, <code>1.</code> or <code>[]</code> then a space for headings, bullets, numbering and checklists.</li><li>Hold the pen still at the end of a stroke to snap it into a perfect shape.</li><li>Add pages on the right, notebooks and folders on the left.</li><li>Turn on <b>Convert to text</b> (bottom-right) to have AI replace messy handwriting with clean text.</li></ul>' },
    { id: uid(), type: 'text', sticky: true, bg: '#fff3a3', x: 580, y: 10, w: 230, fs: 16, html: '<div><b>Tip</b></div><div>Press <b>?</b> to see every keyboard shortcut.</div>' },
  ];
  doc.dirty = true; doc.save();
}

// =================================================================== tabs
function renderTabs() {
  const host = $('#tabs');
  host.replaceChildren(...state.docs.map((d, i) => {
    const t = document.createElement('div');
    t.className = 'tab' + (i === state.active ? ' active' : '');
    t.title = d.path;
    t.innerHTML = `<span class="t-name"></span>${d.dirty || d.saving ? '<span class="dot"></span>' : ''}<button class="x" title="Close (Ctrl+W)"><svg class="i"><use href="#i-x"/></svg></button>`;
    t.querySelector('.t-name').textContent = d.data.title;
    t.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeDoc(i); } });
    t.addEventListener('click', (e) => { if (e.target.closest('.x')) closeDoc(i); else activate(i); });
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: 'Show in folder', action: () => api.lib.reveal(d.path) },
        { label: 'Save a copy as…', action: () => { activate(i); saveAs(); } },
        '-',
        { label: 'Close', hint: 'Ctrl+W', action: () => closeDoc(i) },
        { label: 'Close others', action: async () => { for (const o of [...state.docs]) if (o !== d) await closeDoc(state.docs.indexOf(o)); } },
      ]);
    });
    return t;
  }));
}

// =================================================================== pages
const thumbCache = new Map();
function renderThumb(page, canvas) {
  const cached = thumbCache.get(page.id);
  const key = page.elements;
  if (cached && cached.key === key && cached.paper === board.paperColor + page.paper && canvas.__drawn === key) return;
  const W = 320, H = 200;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const paper = page.paper && page.paper !== 'auto' ? PAPERS[page.paper] || page.paper : board.theme === 'dark' ? PAPERS.dark : PAPERS.white;
  ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
  const dark = luminance(paper) < 0.42;
  const hOf = (e) => (page === board.page ? board.textHeight(e) : e.h);
  const rect = unionRect(page.elements.map((e) => bounds(e, e.type === 'text' ? hOf(e) : undefined)));
  if (rect) {
    const pad = 16;
    const s = Math.min((W - pad * 2) / Math.max(rect.w, 1), (H - pad * 2) / Math.max(rect.h, 1), 0.6);
    const ox = (W - rect.w * s) / 2, oy = (H - rect.h * s) / 2;
    const c = renderToCanvas(page.elements.map((e) => (e.type === 'text' ? { ...e, h: hOf(e) } : e)), rect, s, { darkPaper: dark, drawText: true });
    ctx.drawImage(c, ox, oy);
  }
  canvas.__drawn = key;
  thumbCache.set(page.id, { key, paper: board.paperColor + page.paper });
}
function luminance(hex) {
  if (!hex || hex[0] !== '#') return 1;
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function renderPages() {
  const list = $('#pageList');
  const doc = activeDoc();
  if (!doc) { list.replaceChildren(); return; }
  const items = doc.data.pages.map((p, i) => {
    const it = document.createElement('div');
    it.className = 'page-item' + (i === doc.data.activePage ? ' active' : '');
    it.draggable = true;
    it.dataset.index = i;
    const c = document.createElement('canvas');
    renderThumb(p, c);
    const name = document.createElement('div');
    name.className = 'pname';
    name.innerHTML = `<span class="n">${i + 1}</span><span class="t"></span>`;
    name.querySelector('.t').textContent = p.name;
    it.append(c, name);
    it.addEventListener('click', () => gotoPage(i));
    it.addEventListener('dblclick', () => renamePage(i, name));
    it.addEventListener('contextmenu', (e) => { e.preventDefault(); pageMenu(e.clientX, e.clientY, i); });
    it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ink-page', String(i)); });
    it.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/ink-page')) { e.preventDefault(); it.classList.add('drag-over'); } });
    it.addEventListener('dragleave', () => it.classList.remove('drag-over'));
    it.addEventListener('drop', (e) => {
      it.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/ink-page'), 10);
      if (Number.isNaN(from) || from === i) return;
      movePage(from, i);
    });
    return it;
  });
  const add = document.createElement('button');
  add.className = 'add-page';
  add.innerHTML = '<svg class="i"><use href="#i-plus"/></svg>Add page';
  add.addEventListener('click', () => addPage());
  list.replaceChildren(...items, add);
}
const refreshActiveThumb = debounce(() => {
  const doc = activeDoc(); if (!doc) return;
  const it = $(`#pageList .page-item[data-index="${doc.data.activePage}"] canvas`);
  if (it) renderThumb(board.page, it);
}, 350);

function gotoPage(i) {
  const doc = activeDoc(); if (!doc || i < 0 || i >= doc.data.pages.length) return;
  board.text.endEdit();
  doc.data.activePage = i;
  board.setPage(doc.data.pages[i]);
  fitIfFresh(doc.data.pages[i]);
  updatePaperClass();
  renderPages();
  const item = $(`#pageList .page-item[data-index="${i}"]`);
  if (item) item.scrollIntoView({ block: 'nearest' });
  markDirty(doc);
}
function addPage(afterIndex) {
  const doc = activeDoc(); if (!doc) return;
  const at = (afterIndex ?? doc.data.activePage) + 1;
  const cur = doc.data.pages[doc.data.activePage];
  const p = newPage(doc.data.pages.length + 1);
  if (cur) { p.background = cur.background; p.paper = cur.paper || 'auto'; }
  doc.data.pages.splice(at, 0, p);
  gotoPage(at);
}
function duplicatePage(i) {
  const doc = activeDoc();
  const src = doc.data.pages[i];
  const elements = (src === board.page ? src.elements.map((e) => (e.type === 'text' ? { ...e, h: board.textHeight(e) } : e)) : src.elements).map((e) => ({ ...e, id: uid() }));
  doc.data.pages.splice(i + 1, 0, { ...src, id: uid('p'), name: src.name + ' copy', elements, view: { ...src.view } });
  gotoPage(i + 1);
}
async function deletePage(i) {
  const doc = activeDoc();
  if (doc.data.pages.length === 1) { toast('A notebook needs at least one page'); return; }
  const p = doc.data.pages[i];
  if (p.elements.length && !(await confirmModal(`Delete “${p.name}”?`, 'Everything on this page will be removed from the notebook.', 'Delete page'))) return;
  doc.data.pages.splice(i, 1);
  doc.data.activePage = Math.min(doc.data.activePage >= i ? Math.max(0, doc.data.activePage - 1) : doc.data.activePage, doc.data.pages.length - 1);
  board.setPage(doc.data.pages[doc.data.activePage]);
  renderPages();
  markDirty(doc);
}
function movePage(from, to) {
  const doc = activeDoc();
  const activeId = doc.data.pages[doc.data.activePage].id;
  const [p] = doc.data.pages.splice(from, 1);
  doc.data.pages.splice(to, 0, p);
  doc.data.activePage = doc.data.pages.findIndex((x) => x.id === activeId);
  renderPages();
  markDirty(doc);
}
function renamePage(i, nameEl) {
  const doc = activeDoc();
  const input = document.createElement('input');
  input.value = doc.data.pages[i].name;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const fin = (ok) => {
    if (done) return; done = true;
    if (ok && input.value.trim()) { doc.data.pages[i].name = input.value.trim(); markDirty(doc); }
    renderPages();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
  input.addEventListener('blur', () => fin(true));
}
function pageMenu(x, y, i) {
  const doc = activeDoc();
  showMenu(x, y, [
    { label: 'Rename', action: () => renamePage(i, $(`#pageList .page-item[data-index="${i}"] .pname`)) },
    { label: 'Duplicate', action: () => duplicatePage(i) },
    { label: 'Insert page after', action: () => addPage(i) },
    '-',
    { label: 'Move up', disabled: i === 0, action: () => movePage(i, i - 1) },
    { label: 'Move down', disabled: i === doc.data.pages.length - 1, action: () => movePage(i, i + 1) },
    '-',
    { label: 'Export page as PNG', action: () => { gotoPage(i); exportPng(); } },
    { label: 'Delete page', danger: true, action: () => deletePage(i) },
  ]);
}
function pageStyleMenu(x, y) {
  const p = board.page; if (!p) return;
  const set = (patch) => { Object.assign(p, patch); board.patternCache.clear(); board.requestRender(); updatePaperClass(); markDirty(); refreshActiveThumb(); };
  showMenu(x, y, [
    { head: 'Background' },
    ...BACKGROUNDS.map(([v, l]) => ({ label: l, checked: (p.background || 'dots') === v, action: () => set({ background: v }) })),
    '-',
    { head: 'Paper' },
    ...Object.keys(PAPER_NAMES).map((k) => ({ label: PAPER_NAMES[k], checked: (p.paper || 'auto') === k, swatch: PAPERS[k], action: () => set({ paper: k }) })),
    '-',
    { label: 'Use for new pages', action: () => setSettings({ defaultBackground: p.background }) },
  ]);
}

// =================================================================== board wiring
function wireBoard() {
  board.on('change', () => { markDirty(); refreshActiveThumb(); });
  board.on('textinput', () => { const d = activeDoc(); if (d) { d.dirty = true; updateStatus(); d.save(); } });
  board.on('history', () => {
    $('#undoBtn').disabled = !board.canUndo();
    $('#redoBtn').disabled = !board.canRedo();
  });
  board.on('tool', () => { syncDock(); renderToolOptions(); });
  board.on('camera', () => {
    $('#zoomLabel').textContent = Math.round(board.cam.zoom * 100) + '%';
    positionSelBar();
    savePageViewSoon();
  });
  board.on('selection', () => { buildSelBar(); positionSelBar(); });
  board.on('interact', () => $('#selBar').classList.add('hidden'));
  board.on('editstart', () => { $('#toolOptions').classList.add('hidden'); $('#selBar').classList.add('hidden'); fmt.show(); });
  board.on('editend', () => { fmt.hide(); $('#toolOptions').classList.remove('hidden'); renderToolOptions(); });
  board.on('snapped', () => { if (!localStorage.getItem('ink.snapTip')) { localStorage.setItem('ink.snapTip', '1'); toast('Shape snapped — lift the pen to keep it'); } });
  $('#stage').addEventListener('pointerup', () => requestAnimationFrame(positionSelBar));
}
const savePageViewSoon = debounce(() => { const d = activeDoc(); if (d && !d.dirty) { d.dirty = true; d.save(); } }, 2500);

function syncDock() {
  for (const b of document.querySelectorAll('#dock .tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === board.tool);
  $('#penDot').style.background = board.styles.pen.color === DEFAULT_INK && board.darkPaper ? '#ececec' : board.styles.pen.color;
  $('#hlDot').style.background = board.styles.highlighter.color;
  $('#shapeIcon use').setAttribute('href', board.tool === 'shape' ? '#i-' + board.shapeKind : '#i-shapes');
}

function saveToolPrefs() {
  localStorage.setItem('ink.tools', JSON.stringify({ styles: board.styles, shapeKind: board.shapeKind, tool: board.tool }));
}
function restoreToolPrefs() {
  try {
    const t = JSON.parse(localStorage.getItem('ink.tools') || 'null');
    if (t) {
      for (const k of Object.keys(board.styles)) Object.assign(board.styles[k], t.styles[k] || {});
      board.shapeKind = t.shapeKind || 'rect';
      board.setTool(['laser', 'hand'].includes(t.tool) ? 'pen' : t.tool || 'pen');
    } else board.setTool('pen');
  } catch { board.setTool('pen'); }
  board.stage.dataset.tool = board.tool;
  board.text.layer.classList.toggle('interactive', ['select', 'text', 'lasso'].includes(board.tool));
  syncDock();
}

function swatchRow(colors, current, onPick, opts = {}) {
  const frag = [];
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : '');
    b.style.background = c === DEFAULT_INK && board.darkPaper && !opts.raw ? '#ececec' : c;
    b.title = c;
    b.addEventListener('click', () => onPick(c));
    frag.push(b);
  }
  if (opts.custom !== false) {
    const b = document.createElement('label');
    b.className = 'swatch custom';
    b.title = 'Custom colour';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
    inp.addEventListener('input', () => onPick(inp.value));
    b.appendChild(inp);
    frag.push(b);
  }
  return frag;
}
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function renderToolOptions() {
  const host = $('#toolOptions');
  if (board.text.editingId) return;
  const t = board.tool;
  const parts = [];
  const sep = () => el('span', 'sep');
  const sizeButtons = (st, sizes, max) => {
    const out = [];
    for (const s of sizes) {
      const b = el('button', 'size-btn' + (Math.abs(st.size - s) < 0.01 ? ' on' : ''));
      const d = Math.max(3, Math.min(18, s * (max > 30 ? 0.55 : 1.6)));
      b.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`;
      b.title = s + ' px';
      b.addEventListener('click', () => { st.size = s; saveToolPrefs(); renderToolOptions(); });
      out.push(b);
    }
    const r = el('input'); r.type = 'range'; r.min = 1; r.max = max; r.step = 0.5; r.value = st.size; r.title = 'Size';
    r.addEventListener('input', () => { st.size = parseFloat(r.value); saveToolPrefs(); for (const b of host.querySelectorAll('.size-btn')) b.classList.remove('on'); });
    out.push(r);
    return out;
  };
  if (t === 'pen' || t === 'highlighter') {
    const st = board.styles[t];
    parts.push(...swatchRow(t === 'pen' ? PEN_COLORS : HL_COLORS, st.color, (c) => { st.color = c; saveToolPrefs(); renderToolOptions(); syncDock(); }));
    parts.push(sep());
    parts.push(...sizeButtons(st, t === 'pen' ? [1.5, 3, 6] : [12, 20, 32], t === 'pen' ? 24 : 60));
  } else if (t === 'eraser') {
    const st = board.styles.eraser;
    const seg = el('div', 'seg');
    for (const [v, l] of [['stroke', 'Whole stroke'], ['partial', 'Partial']]) {
      const b = el('button', st.mode === v ? 'on' : '', l);
      b.addEventListener('click', () => { st.mode = v; saveToolPrefs(); renderToolOptions(); });
      seg.appendChild(b);
    }
    parts.push(seg, sep(), el('span', 'opt-label', 'Size'));
    const r = el('input'); r.type = 'range'; r.min = 6; r.max = 80; r.value = st.size;
    r.addEventListener('input', () => { st.size = parseFloat(r.value); saveToolPrefs(); });
    parts.push(r, sep());
    const clear = el('button', 'btn', 'Clear page');
    clear.addEventListener('click', async () => { if (board.elements.length && await confirmModal('Clear this page?', 'You can undo this with Ctrl+Z.', 'Clear page')) board.commit([], { label: 'Clear page' }); });
    parts.push(clear);
  } else if (t === 'shape') {
    const st = board.styles.shape;
    const seg = el('div', 'seg');
    for (const [k, title] of SHAPES) {
      const b = el('button', board.shapeKind === k ? 'on' : '', `<svg class="i"><use href="#i-${k}"/></svg>`);
      b.title = title;
      b.addEventListener('click', () => { board.shapeKind = k; saveToolPrefs(); renderToolOptions(); syncDock(); });
      seg.appendChild(b);
    }
    parts.push(seg, sep());
    parts.push(...swatchRow(PEN_COLORS, st.color, (c) => { st.color = c; saveToolPrefs(); renderToolOptions(); }));
    parts.push(sep(), ...sizeButtons(st, [1.5, 3, 6], 20), sep());
    const fill = el('label', 'chk', '<input type="checkbox"> Fill');
    fill.querySelector('input').checked = st.fill;
    fill.querySelector('input').addEventListener('change', (e) => { st.fill = e.target.checked; saveToolPrefs(); });
    const dash = el('label', 'chk', '<input type="checkbox"> Dashed');
    dash.querySelector('input').checked = st.dash;
    dash.querySelector('input').addEventListener('change', (e) => { st.dash = e.target.checked; saveToolPrefs(); });
    parts.push(fill, dash);
  } else if (t === 'sticky') {
    parts.push(el('span', 'opt-label', 'Note colour'));
    parts.push(...swatchRow(STICKY_COLORS, board.styles.sticky.bg, (c) => { board.styles.sticky.bg = c; saveToolPrefs(); renderToolOptions(); }, { custom: false }));
    parts.push(el('span', 'tip', 'Click to place a note'));
  } else if (t === 'text') {
    parts.push(el('span', 'tip', 'Click to add a text box — or double-click anywhere with any tool'));
  } else if (t === 'select') {
    parts.push(el('span', 'tip', 'Drag left→right to select enclosed · right→left to select touching · Shift-click to add'));
  } else if (t === 'lasso') {
    parts.push(el('span', 'tip', 'Draw around ink to select it'));
  } else if (t === 'laser') {
    parts.push(el('span', 'tip', 'Point things out — the trail fades on its own'));
  } else if (t === 'hand') {
    parts.push(el('span', 'tip', 'Drag to move around · Ctrl+scroll to zoom'));
  }
  host.replaceChildren(...parts);
}

// ------------------------------------------------------------------ selection bar
function buildSelBar() {
  const bar = $('#selBar');
  const els = board.selectedElements();
  if (!els.length || board.text.editingId) { bar.classList.add('hidden'); return; }
  const parts = [];
  const btn = (icon, title, fn, cls = '') => {
    const b = el('button', 'fbtn ' + cls, icon.startsWith('<') ? icon : `<svg class="i"><use href="#i-${icon}"/></svg>`);
    b.title = title; b.addEventListener('click', fn); return b;
  };
  const allText = els.every((e) => e.type === 'text');
  const strokes = els.filter((e) => e.type === 'stroke' && e.tool === 'pen');
  const aiText = els.filter((e) => e.type === 'text' && e.ink);
  if (allText && els.length === 1) parts.push(btn('<span class="lbl"><svg class="i"><use href="#i-text"/></svg>Edit</span>', 'Edit text (Enter)', () => board.text.edit(els[0].id, { selectAll: false })));
  const recolorable = els.some((e) => e.type === 'stroke' || isShape(e) || e.type === 'text');
  if (recolorable) {
    const colors = allText && els.every((e) => e.sticky) ? STICKY_COLORS : PEN_COLORS.slice(0, 6);
    const cur = els[0].sticky ? els[0].bg : els[0].color;
    parts.push(...swatchRow(colors, cur, (c) => board.recolorSelection(c)));
    parts.push(el('span', 'sep'));
  }
  if (strokes.length) {
    parts.push(btn('<span class="lbl"><svg class="i"><use href="#i-sparkle"/></svg>Neaten</span>', 'Straighten and tidy the selected handwriting', () => {
      if (!hw.neaten(strokes, { animate: true })) toast('Nothing to neaten — select some handwritten words');
    }));
    parts.push(btn('<span class="lbl"><svg class="i"><use href="#i-type"/></svg>To text</span>', 'Convert handwriting to typed text with AI', async () => {
      if (!state.settings.hasAiKey) { openSettings('ai'); toast('Add an AI key to convert handwriting to text'); return; }
      const ok = await hw.convert(strokes, { auto: false });
      if (!ok) toast('No text recognised', 'info');
    }));
  }
  if (aiText.length) parts.push(btn('<span class="lbl"><svg class="i"><use href="#i-revert"/></svg>Original ink</span>', 'Put the original handwriting back', () => hw.revert(aiText)));
  parts.push(btn('copy', 'Duplicate (Ctrl+D)', () => board.duplicateSelection()));
  parts.push(btn('front', 'Bring to front (Ctrl+])', () => board.arrange('front')));
  parts.push(btn('back', 'Send to back (Ctrl+[)', () => board.arrange('back')));
  parts.push(btn('trash', 'Delete (Del)', () => board.deleteSelection(), 'danger'));
  bar.replaceChildren(...parts);
}
function positionSelBar() {
  const bar = $('#selBar');
  const r = board.selectionBounds();
  if (!r || board.mode || board.text.editingId || !board.selection.size) { bar.classList.add('hidden'); return; }
  if (!bar.children.length) buildSelBar();
  bar.classList.remove('hidden');
  const [sx, sy] = board.toScreen(r.x, r.y);
  const w = bar.offsetWidth, h = bar.offsetHeight;
  let x = sx + (r.w * board.cam.zoom) / 2 - w / 2;
  let y = sy - h - 16;
  if (y < 110) y = sy + r.h * board.cam.zoom + 16;
  x = clamp(x, 8, board.W - w - 8);
  y = clamp(y, 8, board.H - h - 60);
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}

// =================================================================== chrome
function wireChrome() {
  for (const b of document.querySelectorAll('#dock .tool[data-tool]')) {
    b.addEventListener('click', () => { board.text.endEdit(); board.setTool(b.dataset.tool); saveToolPrefs(); });
  }
  $('#undoBtn').addEventListener('click', () => board.undo());
  $('#redoBtn').addEventListener('click', () => board.redo());
  $('#imageBtn').addEventListener('click', insertImageDialog);
  $('#zoomIn').addEventListener('click', () => board.zoomAt(1.25));
  $('#zoomOut').addEventListener('click', () => board.zoomAt(0.8));
  $('#zoomFit').addEventListener('click', () => board.fitContent());
  $('#zoomLabel').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 8, [
      { label: 'Zoom to 50%', action: () => board.setZoom(0.5) },
      { label: 'Zoom to 100%', hint: 'Ctrl+0', action: () => board.setZoom(1) },
      { label: 'Zoom to 200%', action: () => board.setZoom(2) },
      '-',
      { label: 'Fit everything', hint: 'Shift+1', action: () => board.fitContent() },
      { label: 'Zoom to selection', hint: 'Shift+2', disabled: !board.selection.size, action: () => board.fitContent(board.selectionBounds(), 3) },
    ], { above: true });
  });
  $('#pageStyleBtn').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); pageStyleMenu(r.left, r.top - 8); });
  $('#hwBtn').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); hwMenu(r.right, r.top - 8); });
  $('#sidebarToggle').addEventListener('click', toggleSidebar);
  $('#pagesToggle').addEventListener('click', togglePages);
  $('#settingsBtn').addEventListener('click', () => openSettings());
  $('#themeBtn').addEventListener('click', () => setSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' }));
  $('#exportBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.right - 220, r.bottom + 6, [
      { label: 'Export this page as PNG', action: exportPng },
      { label: 'Export this page as PDF', action: () => exportPdf(false) },
      { label: 'Export whole notebook as PDF', hint: 'Ctrl+P', action: () => exportPdf(true) },
      '-',
      { label: 'Save a copy as…', hint: 'Ctrl+Shift+S', action: saveAs },
      { label: 'Show notebook in folder', action: () => activeDoc() && api.lib.reveal(activeDoc().path) },
    ]);
  });
  $('#newTabBtn').addEventListener('click', () => library.newNotebook());
  $('#openFileBtn').addEventListener('click', openDialog);
  $('#saveAsBtn').addEventListener('click', saveAs);
  $('#addPageBtn').addEventListener('click', () => addPage());
  $('#emptyNew').addEventListener('click', () => library.newNotebook());
  $('#emptyOpen').addEventListener('click', openDialog);
  window.addEventListener('resize', () => positionSelBar());
}
function toggleSidebar() { const h = document.body.classList.toggle('no-sidebar'); localStorage.setItem('ink.sideHidden', h ? '1' : '0'); setTimeout(() => board.resize(), 200); }
function togglePages() { const h = document.body.classList.toggle('no-pages'); localStorage.setItem('ink.pagesHidden', h ? '1' : '0'); setTimeout(() => board.resize(), 200); }

function updateHwChip() {
  const m = state.settings.handwritingMode || 'neaten';
  $('#hwState').textContent = { off: 'Off', neaten: 'Neaten', convert: 'To text (AI)' }[m];
}
function hwMenu(x, y) {
  const m = state.settings.handwritingMode || 'neaten';
  const hasKey = state.settings.hasAiKey;
  showMenu(x - 290, y, [
    { head: 'When I pause writing…' },
    { label: 'Leave my ink alone', checked: m === 'off', action: () => setSettings({ handwritingMode: 'off' }) },
    { label: 'Neaten it (offline, instant)', checked: m === 'neaten', action: () => setSettings({ handwritingMode: 'neaten' }) },
    { label: hasKey ? 'Convert it to clean text (AI)' : 'Convert to clean text (AI) — add key…', checked: m === 'convert', action: () => { if (!hasKey) openSettings('ai'); else setSettings({ handwritingMode: 'convert' }); } },
    '-',
    { head: 'Converted text looks like' },
    { label: 'Neat handwriting', checked: state.settings.convertFont !== 'print', action: () => setSettings({ convertFont: 'handwriting' }) },
    { label: 'Typed text', checked: state.settings.convertFont === 'print', action: () => setSettings({ convertFont: 'print' }) },
    '-',
    { label: 'Handwriting & AI settings…', action: () => openSettings('ai') },
  ], { above: true });
}

async function insertImageDialog() {
  const srcs = await api.file.openImages();
  srcs.forEach((s, i) => { const [cx, cy] = board.viewCenter(); board.insertImage(s, [cx + i * 30, cy + i * 30]); });
}

// =================================================================== keyboard
function wireKeys() {
  const toolKeys = { v: 'select', q: 'lasso', h: 'hand', p: 'pen', m: 'highlighter', e: 'eraser', t: 'text', n: 'sticky', s: 'shape', k: 'laser' };
  const shapeKeys = { r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', d: 'diamond' };
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (document.querySelector('.modal-back')) return;

    // --- work everywhere
    if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else { const d = activeDoc(); if (d) { d.dirty = true; saveNow(d).then(() => toast('Saved', 'ok', 1200)); } } return; }
    if (mod && k === 'o') { e.preventDefault(); openDialog(); return; }
    if (mod && k === 'n') { e.preventDefault(); if (e.shiftKey) addPage(); else library.newNotebook(); return; }
    if (mod && (k === 'f' || k === 'h')) { e.preventDefault(); openFind(k === 'h'); return; }
    if (mod && k === 'w') { e.preventDefault(); if (state.active >= 0) closeDoc(state.active); return; }
    if (mod && k === 'p') { e.preventDefault(); exportPdf(true); return; }
    if (mod && e.key === 'Tab') { e.preventDefault(); if (state.docs.length) activate((state.active + (e.shiftKey ? -1 : 1) + state.docs.length) % state.docs.length); return; }
    if (mod && e.key === 'PageDown') { e.preventDefault(); gotoPage((activeDoc()?.data.activePage ?? 0) + 1); return; }
    if (mod && e.key === 'PageUp') { e.preventDefault(); gotoPage((activeDoc()?.data.activePage ?? 0) - 1); return; }
    if ((mod && e.shiftKey && k === 'i') || e.key === 'F12') { e.preventDefault(); api.app.toggleDevTools(); return; }
    if (e.key === 'F11') return;
    if (typing) return;
    if (!activeDoc()) return;

    if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); return; }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? board.redo() : board.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); board.redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); if (board.tool !== 'select' && board.tool !== 'lasso') board.setTool('select'); board.selectAll(); return; }
    if (mod && k === 'd') { e.preventDefault(); board.duplicateSelection(); return; }
    if (mod && k === 'c') { if (board.copySelection()) e.preventDefault(); return; }
    if (mod && k === 'x') { if (board.selection.size) { e.preventDefault(); board.cutSelection(); } return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); board.zoomAt(1.25); return; }
    if (mod && k === '-') { e.preventDefault(); board.zoomAt(0.8); return; }
    if (mod && k === '0') { e.preventDefault(); board.setZoom(1); return; }
    if (mod && e.key === ']') { e.preventDefault(); board.arrange(e.shiftKey ? 'front' : 'forward'); return; }
    if (mod && e.key === '[') { e.preventDefault(); board.arrange(e.shiftKey ? 'back' : 'backward'); return; }
    if (mod) return;

    if (e.key === ' ' && !e.repeat) { e.preventDefault(); board.spaceDown = true; document.body.classList.add('space'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (board.selection.size) { e.preventDefault(); board.deleteSelection(); } return; }
    if (e.key === 'Escape') {
      if (!$('#findBar').classList.contains('hidden')) { closeFind(); return; }
      if (board.selection.size) board.clearSelection(); else if (board.tool !== 'pen') board.setTool('pen');
      return;
    }
    if (e.key === 'Enter' && board.selection.size === 1) {
      const sel = board.selectedElements()[0];
      if (sel.type === 'text') { e.preventDefault(); board.text.edit(sel.id); }
      return;
    }
    if (e.key.startsWith('Arrow') && board.selection.size) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / board.cam.zoom;
      board.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      return;
    }
    if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) { board.fitContent(); return; }
    if (e.key === '@' || (e.shiftKey && e.code === 'Digit2')) { if (board.selection.size) board.fitContent(board.selectionBounds(), 3); return; }
    if (e.key === '?') { openSettings('keys'); return; }
    if (e.key === '[' || e.key === ']') {
      const st = board.styles[board.tool === 'highlighter' ? 'highlighter' : board.tool === 'eraser' ? 'eraser' : board.tool === 'shape' ? 'shape' : 'pen'];
      st.size = clamp(st.size * (e.key === ']' ? 1.25 : 0.8), 1, 80);
      saveToolPrefs(); renderToolOptions();
      return;
    }
    if (/^[1-8]$/.test(e.key) && !e.shiftKey && !e.altKey) {
      const tool = board.tool === 'highlighter' ? 'highlighter' : 'pen';
      const colors = tool === 'pen' ? PEN_COLORS : HL_COLORS;
      const c = colors[parseInt(e.key, 10) - 1];
      if (c) { board.styles[tool].color = c; if (board.tool !== tool) board.setTool(tool); saveToolPrefs(); renderToolOptions(); syncDock(); }
      return;
    }
    if (e.altKey || e.shiftKey) return;
    if (shapeKeys[k]) { board.shapeKind = shapeKeys[k]; board.setTool('shape'); renderToolOptions(); syncDock(); saveToolPrefs(); return; }
    if (toolKeys[k]) { board.setTool(toolKeys[k]); saveToolPrefs(); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { board.spaceDown = false; document.body.classList.remove('space'); } });
  window.addEventListener('blur', () => { board.spaceDown = false; document.body.classList.remove('space'); });
}

// =================================================================== paste & drop
function wirePasteDrop() {
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName) || !activeDoc()) return;
    const dt = e.clipboardData;
    const at = board.cursorWorld || board.viewCenter();
    const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach((f, i) => readDataUrl(f).then((src) => board.insertImage(src, [at[0] + i * 30, at[1] + i * 30])));
      return;
    }
    const text = dt.getData('text/plain');
    if (text) {
      try {
        const j = JSON.parse(text);
        if (j && j.inkboard && Array.isArray(j.elements)) { e.preventDefault(); board.setTool('select'); board.pasteElements(j.elements); return; }
      } catch {}
    }
    const html = dt.getData('text/html');
    if (html || text) {
      e.preventDefault();
      const content = html ? sanitizeHtml(html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, '')) : text.split(/\r?\n/).map((l) => '<div>' + (escapeHtml(l) || '<br>') + '</div>').join('');
      const node = board.text.createAt(at[0], at[1], { html: content });
      board.text.endEdit();
      board.setTool('select');
      board.setSelection([node.id]);
    }
  });
  const ws = $('#workspace');
  ws.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  ws.addEventListener('drop', async (e) => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    const r = board.stage.getBoundingClientRect();
    const at = board.toWorld(e.clientX - r.left, e.clientY - r.top);
    let i = 0;
    for (const f of files) {
      if (f.type.startsWith('image/') && activeDoc()) { const src = await readDataUrl(f); board.insertImage(src, [at[0] + i * 30, at[1] + i * 30]); i++; }
      else if (/\.inkb$/i.test(f.name) && f.path) openFile(f.path);
    }
  });
  board.stage.addEventListener('pointermove', (e) => { const r = board.stage.getBoundingClientRect(); board.cursorWorld = board.toWorld(e.clientX - r.left, e.clientY - r.top); });
}
function readDataUrl(file) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }

// =================================================================== find & replace
const find = { matches: [], idx: -1 };
function wireFind() {
  const input = $('#findInput');
  input.addEventListener('input', () => runFind(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeFind();
  });
  $('#replaceInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') replaceOne(); if (e.key === 'Escape') closeFind(); });
  $('#findNext').addEventListener('click', () => stepFind(1));
  $('#findPrev').addEventListener('click', () => stepFind(-1));
  $('#findClose').addEventListener('click', closeFind);
  $('#replaceOne').addEventListener('click', replaceOne);
  $('#replaceAll').addEventListener('click', replaceAll);
  board.on('change', () => { if (!$('#findBar').classList.contains('hidden')) runFind(false); });
}
function openFind(replace) {
  board.text.endEdit();
  $('#findBar').classList.remove('hidden');
  $('#replaceRow').classList.toggle('hidden', !replace);
  const s = window.getSelection().toString();
  if (s && s.length < 80) $('#findInput').value = s;
  $('#findInput').focus(); $('#findInput').select();
  runFind(true);
}
function closeFind() { $('#findBar').classList.add('hidden'); CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); find.matches = []; }
function runFind(jump) {
  const q = $('#findInput').value;
  find.matches = [];
  if (q) {
    const ql = q.toLowerCase();
    for (const e of board.elements) {
      if (e.type !== 'text') continue;
      const node = board.text.nodes.get(e.id); if (!node) continue;
      const walker = document.createTreeWalker(node.firstChild, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const s = n.data.toLowerCase();
        let i = s.indexOf(ql);
        while (i >= 0) {
          const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length);
          find.matches.push({ id: e.id, range: r });
          i = s.indexOf(ql, i + q.length);
        }
      }
    }
  }
  if (jump || find.idx >= find.matches.length) find.idx = find.matches.length ? 0 : -1;
  paintFind(jump);
}
function paintFind(scroll) {
  CSS.highlights.set('find', new Highlight(...find.matches.map((m) => m.range)));
  const cur = find.matches[find.idx];
  if (cur) {
    CSS.highlights.set('find-current', new Highlight(cur.range));
    const e = board.getById(cur.id);
    if (scroll && e) board.scrollIntoView(board.boundsOf(e));
  } else CSS.highlights.delete('find-current');
  $('#findCount').textContent = find.matches.length ? `${find.idx + 1}/${find.matches.length}` : $('#findInput').value ? '0/0' : '';
}
function stepFind(d) {
  if (!find.matches.length) return;
  find.idx = (find.idx + d + find.matches.length) % find.matches.length;
  paintFind(true);
}
function commitTextNodes(ids) {
  const map = new Map();
  for (const id of ids) {
    const node = board.text.nodes.get(id); const e = board.getById(id);
    if (!node || !e) continue;
    const html = node.firstChild.innerHTML;
    node.__html = html;
    map.set(id, { ...e, html });
  }
  board.replace(map, 'Replace');
}
function replaceOne() {
  const cur = find.matches[find.idx]; if (!cur) return;
  cur.range.deleteContents();
  cur.range.insertNode(document.createTextNode($('#replaceInput').value));
  commitTextNodes([cur.id]);
  runFind(false); paintFind(true);
}
function replaceAll() {
  const ids = new Set(find.matches.map((m) => m.id));
  const rep = $('#replaceInput').value;
  const n = find.matches.length;
  for (const m of [...find.matches].reverse()) { m.range.deleteContents(); m.range.insertNode(document.createTextNode(rep)); }
  commitTextNodes(ids);
  runFind(false);
  toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`, 'ok');
}

// =================================================================== export
function pageRect(page) {
  const hOf = (e) => (page === board.page ? board.textHeight(e) : e.h || 40);
  const r = unionRect(page.elements.map((e) => bounds(e, e.type === 'text' ? hOf(e) : undefined)));
  if (!r) return { x: 0, y: 0, w: 800, h: 600 };
  const pad = 40;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}
async function buildExportHtml(pages, scale = 1) {
  const cssUrl = await api.exporter.assetUrl('text.css');
  const sections = [], pageCss = [];
  pages.forEach((page, i) => {
    const rect = pageRect(page);
    const paper = page.paper && page.paper !== 'auto' ? PAPERS[page.paper] || page.paper : state.settings.theme === 'dark' ? PAPERS.dark : PAPERS.white;
    const dark = luminance(paper) < 0.42;
    const res = Math.min(2, 7000 / Math.max(rect.w, rect.h));
    const ink = renderToCanvas(page.elements.filter((e) => e.type !== 'text'), rect, res, { darkPaper: dark }).toDataURL('image/png');
    const texts = page.elements.filter((e) => e.type === 'text').map((e) => {
      const html = page === board.page ? board.text.liveHtml(e.id) ?? e.html : e.html;
      const style = `left:${e.x - rect.x}px;top:${e.y - rect.y}px;width:${e.w}px;font-size:${e.fs || 16}px;${e.color && !e.sticky ? 'color:' + e.color + ';' : ''}${e.sticky ? '--sticky:' + (e.bg || '#fff3a3') + ';' : ''}`;
      return `<div class="tx${e.sticky ? ' sticky' : ''}" data-font="${e.font || 'sans'}" style="${style}"><div class="tx-content">${html}</div></div>`;
    }).join('');
    pageCss.push(`@page p${i}{size:${Math.ceil(rect.w)}px ${Math.ceil(rect.h)}px;margin:0}.pg${i}{page:p${i};width:${Math.ceil(rect.w)}px;height:${Math.ceil(rect.h)}px;background:${paper}}`);
    sections.push(`<section class="pg pg${i}${dark ? ' dark-paper' : ''}" style="${dark ? '--ink:#ececec;' : ''}"><img src="${ink}">${texts}</section>`);
  });
  const first = pageRect(pages[0]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${cssUrl}"><style>
html,body{margin:0;padding:0}body{zoom:${scale}}.pg{position:relative;overflow:hidden;break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pg:last-child{break-after:auto}.pg>img{position:absolute;left:0;top:0;width:100%;height:100%}
${pageCss.join('\n')}</style></head><body>${sections.join('')}</body></html>`;
  return { html, width: first.w * scale, height: first.h * scale };
}
async function exportPng() {
  const doc = activeDoc(); if (!doc) return;
  const rect = pageRect(board.page);
  const scale = Math.min(2, 8000 / Math.max(rect.w, rect.h));
  try {
    const { html, width, height } = await buildExportHtml([board.page], scale);
    const p = await api.exporter.png({ html, width, height, defaultName: doc.data.title + ' - ' + board.page.name });
    if (p) toast('Exported ' + p.split(/[\\/]/).pop(), 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'error'); }
}
async function exportPdf(all) {
  const doc = activeDoc(); if (!doc) return;
  try {
    const pages = all ? doc.data.pages : [board.page];
    const { html } = await buildExportHtml(pages, 1);
    const p = await api.exporter.pdf({ html, defaultName: all ? doc.data.title : doc.data.title + ' - ' + board.page.name });
    if (p) toast('Exported ' + p.split(/[\\/]/).pop(), 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'error'); }
}

// =================================================================== menus & modals
let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function showMenu(x, y, items, opts = {}) {
  closeMenu();
  const m = el('div', 'menu');
  for (const it of items) {
    if (it === '-') { m.appendChild(el('div', 'msep')); continue; }
    if (it.head) { m.appendChild(el('div', 'mhead', escapeHtml(it.head))); continue; }
    const row = el('div', 'mi' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : ''));
    if (it.swatch !== undefined) row.innerHTML = `<span class="swatch" style="width:14px;height:14px;background:${it.swatch || 'conic-gradient(#fff 0 50%, #1f2125 0)'}"></span>`;
    row.appendChild(document.createTextNode(it.label));
    if (it.hint) row.appendChild(el('span', 'hint', escapeHtml(it.hint)));
    row.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
    m.appendChild(row);
  }
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  if (opts.above) y = y - h;
  m.style.left = clamp(x, 6, innerWidth - w - 6) + 'px';
  m.style.top = clamp(y, 6, innerHeight - h - 6) + 'px';
  openMenuEl = m;
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) closeMenu(); }, { once: true, capture: true }), 0);
}
function swatchMenu(x, y, colors, onPick, keepFocus) {
  closeMenu();
  const m = el('div', 'menu');
  m.style.display = 'flex'; m.style.flexWrap = 'wrap'; m.style.gap = '6px'; m.style.width = '196px'; m.style.minWidth = '0'; m.style.padding = '10px';
  for (const c of colors) {
    const b = el('button', 'swatch');
    b.style.background = c === 'transparent' ? 'linear-gradient(135deg,#fff 45%,#e11d48 45% 55%,#fff 55%)' : c;
    b.title = c === 'transparent' ? 'None' : c;
    if (keepFocus) b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { closeMenu(); onPick(c); });
    m.appendChild(b);
  }
  const lab = el('label', 'swatch custom'); const inp = el('input'); inp.type = 'color';
  inp.addEventListener('change', () => { closeMenu(); onPick(inp.value); });
  lab.appendChild(inp); m.appendChild(lab);
  document.body.appendChild(m);
  m.style.left = clamp(x, 6, innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = clamp(y, 6, innerHeight - m.offsetHeight - 6) + 'px';
  openMenuEl = m;
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) closeMenu(); }, { once: true, capture: true }), 0);
}

function modal(title, bodyEl, buttons, cls = '') {
  return new Promise((resolve) => {
    const back = el('div', 'modal-back');
    const box = el('div', 'modal ' + cls);
    const head = el('header'); head.textContent = title;
    const foot = el('footer');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    for (const b of buttons) {
      const btn = el('button', 'btn ' + (b.cls || ''), escapeHtml(b.label));
      btn.addEventListener('click', () => close(b.value));
      foot.appendChild(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Enter' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { const p = buttons.find((b) => b.primary); if (p) { e.preventDefault(); close(p.value); } }
    };
    document.addEventListener('keydown', onKey, true);
    box.append(head, bodyEl, foot);
    back.appendChild(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.body.appendChild(back);
    const f = box.querySelector('.btn.primary, .btn.danger'); if (f) f.focus();
  });
}
function confirmModal(title, body, okLabel = 'OK') {
  const b = el('div', 'body'); b.appendChild(el('p', '', escapeHtml(body)));
  return modal(title, b, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, cls: 'danger', primary: true }], 'small');
}

// ------------------------------------------------------------------ settings
async function openSettings(tab = 'general') {
  state.settings = await api.settings.get();
  const s = state.settings;
  const body = el('div');
  const tabs = el('div', 'settings-tabs');
  const pane = el('div', 'body');
  const TABS = [['general', 'General'], ['ai', 'Handwriting & AI'], ['keys', 'Shortcuts']];
  for (const [k, l] of TABS) {
    const b = el('button', k === tab ? 'on' : '', l);
    b.addEventListener('click', () => { tab = k; tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    tabs.appendChild(b);
  }
  body.append(tabs, pane);
  const field = (label, control, help) => {
    const f = el('div', 'field');
    const l = el('label'); l.textContent = label;
    f.append(l, control);
    if (help) f.appendChild(el('div', 'help', help));
    return f;
  };
  const select = (opts, val, on) => {
    const sel = el('select');
    for (const [v, l] of opts) { const o = el('option'); o.value = v; o.textContent = l; if (String(v) === String(val)) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => on(sel.value));
    return sel;
  };
  const check = (val, on, label) => {
    const l = el('label', 'chk'); const c = el('input'); c.type = 'checkbox'; c.checked = !!val;
    c.addEventListener('change', () => on(c.checked)); l.append(c, document.createTextNode(label || '')); return l;
  };
  const draw = () => {
    pane.replaceChildren();
    if (tab === 'general') {
      const row = el('div', 'inline');
      const pb = el('div', 'path-box'); pb.textContent = s.libraryRoot; pb.title = s.libraryRoot;
      const ch = el('button', 'btn', 'Change…');
      ch.addEventListener('click', async () => { await chooseLibrary(); state.settings = await api.settings.get(); pb.textContent = state.settings.libraryRoot; });
      const show = el('button', 'btn', 'Show');
      show.addEventListener('click', () => api.lib.reveal(s.libraryRoot));
      row.append(pb, ch, show);
      pane.append(
        field('Library folder', row, 'Every notebook is a .inkb file inside this folder. Use the sidebar to make sub-folders.'),
        field('Theme', select([['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => setSettings({ theme: v }))),
        field('New pages use', select(BACKGROUNDS, s.defaultBackground, (v) => setSettings({ defaultBackground: v }))),
        field('Pen pressure', check(s.pressure !== false, (v) => setSettings({ pressure: v }), 'Use stylus pressure for line thickness')),
        field('Ink smoothing', (() => { const r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = s.smoothing ?? 0.5; r.style.width = '220px'; r.addEventListener('change', () => setSettings({ smoothing: parseFloat(r.value) })); return r; })(), 'Higher = steadier lines while you write; lower = more responsive.'),
        field('Touch input', check(s.penOnly, (v) => setSettings({ penOnly: v }), 'Only the stylus draws — fingers pan and zoom'), 'Palm rejection for touch screens with a pen.'),
      );
    } else if (tab === 'ai') {
      const keyRow = el('div', 'inline');
      const key = el('input'); key.type = 'password'; key.placeholder = s.hasAiKey ? '•••••••• saved (type to replace)' : 'Paste your API key';
      const save = el('button', 'btn primary', 'Save key');
      const status = el('div', 'help');
      save.addEventListener('click', async () => {
        await setSettings({ aiKey: key.value });
        key.value = ''; key.placeholder = state.settings.hasAiKey ? '•••••••• saved (type to replace)' : 'Paste your API key';
        status.textContent = state.settings.hasAiKey ? 'Key saved (encrypted on this computer).' : 'Key removed.';
      });
      keyRow.append(key, save);
      const test = el('button', 'btn', 'Test with sample handwriting');
      test.addEventListener('click', async () => {
        status.textContent = 'Testing…';
        try {
          const c = document.createElement('canvas'); c.width = 360; c.height = 90;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 360, 90); g.fillStyle = '#000'; g.font = '48px Caveat'; g.fillText('hello world', 20, 60);
          const r = await api.ai.transcribe(c.toDataURL('image/png').split(',')[1]);
          status.textContent = `✓ Works — read “${r.text}” in ${r.ms} ms`;
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
      const provider = select([['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI-compatible (OpenAI, Groq, local…)']], s.aiProvider, async (v) => {
        await setSettings({ aiProvider: v, aiModel: v === 'anthropic' ? 'claude-haiku-5-5' : s.aiModel && !s.aiModel.startsWith('claude') ? s.aiModel : '' });
        Object.assign(s, state.settings); draw();
      });
      const model = el('input'); model.type = 'text'; model.value = s.aiModel || ''; model.placeholder = s.aiProvider === 'anthropic' ? 'claude-haiku-5-5' : 'a vision model name';
      model.addEventListener('change', () => setSettings({ aiModel: model.value.trim() }));
      const base = el('input'); base.type = 'text'; base.value = s.aiBaseUrl || ''; base.placeholder = 'https://api.openai.com/v1';
      base.addEventListener('change', () => setSettings({ aiBaseUrl: base.value.trim() }));
      const delay = el('input'); delay.type = 'number'; delay.min = 300; delay.max = 6000; delay.step = 100; delay.value = s.convertDelay || 1600; delay.style.width = '110px';
      delay.addEventListener('change', () => setSettings({ convertDelay: parseInt(delay.value, 10) || 1600 }));
      const ndelay = el('input'); ndelay.type = 'number'; ndelay.min = 200; ndelay.max = 5000; ndelay.step = 100; ndelay.value = s.neatenDelay || 900; ndelay.style.width = '110px';
      ndelay.addEventListener('change', () => setSettings({ neatenDelay: parseInt(ndelay.value, 10) || 900 }));
      pane.append(
        field('When I pause writing', select([['off', 'Leave my ink alone'], ['neaten', 'Neaten it (offline, instant)'], ['convert', 'Convert it to clean text (AI)']], s.handwritingMode, (v) => setSettings({ handwritingMode: v })), 'Neaten straightens lines, fixes slant and evens out letter sizes — no internet needed. Convert replaces handwriting with text; the original ink is kept so you can switch back.'),
        field('Neaten after (ms)', ndelay),
        field('Convert after (ms)', delay),
        field('Converted text font', select([['handwriting', 'Neat handwriting'], ['print', 'Typed text']], s.convertFont, (v) => setSettings({ convertFont: v }))),
        field('AI provider', provider),
        ...(s.aiProvider === 'openai' ? [field('API base URL', base, 'For Groq use https://api.groq.com/openai/v1')] : []),
        field('Model', model, s.aiProvider === 'anthropic' ? 'Haiku is the fastest Claude model for this.' : 'Must accept images.'),
        field('API key', keyRow),
        field('', (() => { const d = el('div', 'inline'); d.append(test); return d; })()),
      );
      pane.appendChild(status);
    } else {
      const k = el('div', 'keys');
      const rows = [
        ['Tools'], ['Select / Lasso / Pan', 'V · Q · H'], ['Pen / Highlighter / Eraser', 'P · M · E'], ['Text box / Sticky note', 'T · N'],
        ['Shapes: rectangle, ellipse, line, arrow, diamond', 'R · O · L · A · D'], ['Laser pointer', 'K'], ['Pen colours', '1 – 8'], ['Thinner / thicker', '[ · ]'], ['Pan while held', 'Space'],
        ['Writing'], ['Type anywhere', 'Double-click'], ['Bold / Italic / Underline', 'Ctrl+B · I · U'], ['Strikethrough', 'Ctrl+Shift+X'], ['Bullets / Numbers / Checklist', 'Ctrl+Shift+8 · 7 · 9'],
        ['Heading 1 / 2 / 3 / Normal', 'Ctrl+Alt+1 · 2 · 3 · 0'], ['Bigger / smaller text', 'Ctrl+] · Ctrl+['], ['Align left / center / right / justify', 'Ctrl+L · E · R · J'], ['Link', 'Ctrl+K'], ['Insert today’s date', 'Ctrl+;'],
        ['Paste without formatting', 'Ctrl+Shift+V'], ['Markdown while typing', '# - 1. [] > ---  **b** *i* `code`'], ['Finish editing', 'Esc'],
        ['Board'], ['Undo / Redo', 'Ctrl+Z · Ctrl+Y'], ['Copy / Cut / Paste / Duplicate', 'Ctrl+C · X · V · D'], ['Select all / Delete', 'Ctrl+A · Del'], ['Bring forward / back', 'Ctrl+] · Ctrl+['],
        ['Zoom in / out / 100%', 'Ctrl+= · Ctrl+- · Ctrl+0'], ['Fit everything / selection', 'Shift+1 · Shift+2'], ['Find / Replace', 'Ctrl+F · Ctrl+H'],
        ['Notebooks'], ['New notebook / New page', 'Ctrl+N · Ctrl+Shift+N'], ['Next / previous page', 'Ctrl+PgDn · Ctrl+PgUp'], ['Next tab / Close tab', 'Ctrl+Tab · Ctrl+W'],
        ['Save now / Save a copy', 'Ctrl+S · Ctrl+Shift+S'], ['Open', 'Ctrl+O'], ['Export notebook to PDF', 'Ctrl+P'], ['Hide library', 'Ctrl+\\'],
      ];
      for (const r of rows) {
        if (r.length === 1) { k.appendChild(el('h4', '', escapeHtml(r[0]))); continue; }
        k.appendChild(el('div', 'k', escapeHtml(r[0])));
        k.appendChild(el('div', '', r[1].split(' · ').map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join(' ')));
      }
      pane.appendChild(k);
    }
  };
  draw();
  await modal('Settings', body, [{ label: 'Done', value: true, cls: 'primary', primary: true }]);
}

init().catch((e) => { console.error(e); toast('Startup error: ' + e.message, 'error', 8000); });

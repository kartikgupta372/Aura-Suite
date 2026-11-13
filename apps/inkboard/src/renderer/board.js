// The whiteboard engine: camera, rendering, input, tools, selection, history.
//
// Rendering is split in three layers for speed:
//   #ink  – committed elements (low-overhead 2D canvas, redrawn only when dirty)
//   .text – Word-style text boxes as real DOM, moved with one CSS transform
//   #ui   – the stroke being drawn, selection, previews (desynchronized canvas
//           for the lowest possible pen latency)
import { uid, clamp, round2, rectsIntersect, rectContains, unionRect, pointInPoly, segSegDist, distToSeg } from './util.js';
import { bounds, hitTest, renderElement, livePath, transformElement, hitPolyline, isShape, mapColor, DEFAULT_INK } from './ink.js';
import { TextLayer } from './text.js';
import { recognizeShape } from './handwriting.js';

const MIN_ZOOM = 0.1, MAX_ZOOM = 8;
const HISTORY_LIMIT = 300;
const HANDLE = 7;

export const PAPERS = {
  auto: null,
  white: '#ffffff',
  cream: '#fbf8ef',
  grey: '#eef0f3',
  dark: '#1f2125',
  chalk: '#1e3a2f',
  navy: '#172238',
};

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export class Board {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.inkCanvas = stage.querySelector('#ink');
    this.uiCanvas = stage.querySelector('#ui');
    this.ctx = this.inkCanvas.getContext('2d', { alpha: false });
    this.uctx = this.uiCanvas.getContext('2d', { desynchronized: true });
    this.opts = opts;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.page = null;
    this.tool = 'pen';
    this.prevTool = 'pen';
    this.shapeKind = 'rect';
    this.styles = {
      pen: { color: DEFAULT_INK, size: 3 },
      highlighter: { color: '#fde047', size: 20 },
      shape: { color: DEFAULT_INK, size: 3, fill: false, dash: false },
      eraser: { size: 20, mode: 'stroke' },
      sticky: { bg: '#fff3a3' },
    };
    this.pressure = true;
    this.smoothing = 0.5;
    this.penOnly = false;
    this.theme = 'light';
    this.selection = new Set();
    this.histories = new Map();
    this.handlers = {};
    this.pointers = new Map();
    this.hidden = new Set();       // ids temporarily not drawn (e.g. while animating)
    this.overrides = new Map();    // id -> element drawn instead (animations)
    this.busy = [];                // rects with AI work in progress
    this.laser = [];
    this.mode = null;              // current gesture
    this.spaceDown = false;
    this.lastTaps = [];
    this.dpr = window.devicePixelRatio || 1;
    this._raf = 0; this._inkDirty = true; this._uiDirty = true;
    this.patternCache = new Map();

    this.text = new TextLayer(this, stage.querySelector('#textLayer'));

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.bindInput();
  }

  // ------------------------------------------------------------ events
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, ...args) { (this.handlers[name] || []).forEach((f) => f(...args)); }

  // ------------------------------------------------------------ page/doc
  setPage(page) {
    this.text.endEdit();
    this.cancelGesture();
    this.page = page;
    this.sceneCache = null;
    this.selection.clear();
    if (!this.histories.has(page.id)) this.histories.set(page.id, { undo: [], redo: [] });
    const v = page.view || { x: 0, y: 0, zoom: 1 };
    this.cam = { x: v.x, y: v.y, zoom: clamp(v.zoom || 1, MIN_ZOOM, MAX_ZOOM) };
    this.text.sync(true);
    this.applyCamera();
    this.emit('selection');
    this.emit('history');
  }
  get elements() { return this.page ? this.page.elements : []; }
  get history() { return this.histories.get(this.page.id); }
  get paperColor() {
    const p = this.page && this.page.paper;
    if (p && p !== 'auto') return PAPERS[p] || p;
    return this.theme === 'dark' ? PAPERS.dark : PAPERS.white;
  }
  get darkPaper() { return luminance(this.paperColor) < 0.42; }

  // Replace the element list as one undoable step.
  commit(next, opts = {}) {
    if (!this.page) return null;
    const prev = this.page.elements;
    if (next === prev) return null;
    const entry = { before: prev, after: next, label: opts.label || '' };
    if (!opts.noHistory) {
      const h = this.history;
      h.undo.push(entry);
      if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
      h.redo.length = 0;
    }
    this.page.elements = next;
    this.afterElementsChanged();
    return entry;
  }
  // Push a history step for a change that was already applied live (eraser etc.).
  pushHistory(before, after, label) {
    if (before === after) return;
    const h = this.history;
    h.undo.push({ before, after, label });
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo.length = 0;
    this.emit('history');
  }
  dropHistoryEntry(entry) {
    const h = this.history;
    const i = h.undo.lastIndexOf(entry);
    if (i >= 0) h.undo.splice(i, 1);
    this.emit('history');
  }
  afterElementsChanged(silent) {
    const ids = new Set(this.page.elements.map((e) => e.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.text.sync();
    this.requestRender();
    if (!silent) this.emit('change');
    this.emit('history');
    this.emit('selection');
  }
  undo() {
    this.text.endEdit();
    const h = this.history; if (!h || !h.undo.length) return;
    const e = h.undo.pop(); h.redo.push(e);
    this.page.elements = e.before;
    this.afterElementsChanged();
  }
  redo() {
    this.text.endEdit();
    const h = this.history; if (!h || !h.redo.length) return;
    const e = h.redo.pop(); h.undo.push(e);
    this.page.elements = e.after;
    this.afterElementsChanged();
  }
  canUndo() { return !!(this.page && this.history.undo.length); }
  canRedo() { return !!(this.page && this.history.redo.length); }

  add(els, label = 'Add') { return this.commit([...this.elements, ...els], { label }); }
  removeIds(ids, label = 'Delete') { const s = new Set(ids); return this.commit(this.elements.filter((e) => !s.has(e.id)), { label }); }
  replace(map, label = 'Edit') {
    let changed = false;
    const next = this.elements.map((e) => { const r = map.get(e.id); if (r && r !== e) { changed = true; return r; } return e; });
    return changed ? this.commit(next, { label }) : null;
  }
  getById(id) { return this.elements.find((e) => e.id === id); }
  textHeight(el) { return this.text.heightOf(el); }
  boundsOf(el) { return bounds(el, el.type === 'text' ? this.textHeight(el) : undefined); }

  // ------------------------------------------------------------ camera
  resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    for (const c of [this.inkCanvas, this.uiCanvas]) {
      c.width = Math.max(1, Math.round(r.width * this.dpr));
      c.height = Math.max(1, Math.round(r.height * this.dpr));
      c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    }
    this.requestRender();
  }
  applyCamera() {
    const { x, y, zoom } = this.cam;
    this.text.layer.style.transform = `scale(${zoom}) translate(${-x}px, ${-y}px)`;
    if (this.page) this.page.view = { x: round2(x), y: round2(y), zoom: round2(zoom * 1000) / 1000 };
    this.requestRender();
    this.emit('camera', this.cam);
  }
  toWorld(sx, sy) { return [sx / this.cam.zoom + this.cam.x, sy / this.cam.zoom + this.cam.y]; }
  toScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.zoom, (wy - this.cam.y) * this.cam.zoom]; }
  eventPoint(e) {
    const r = this.stage.getBoundingClientRect();
    return this.toWorld(e.clientX - r.left, e.clientY - r.top);
  }
  zoomAt(factor, sx = this.W / 2, sy = this.H / 2) {
    const z0 = this.cam.zoom, z1 = clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM);
    if (z1 === z0) return;
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.zoom = z1;
    this.cam.x = wx - sx / z1;
    this.cam.y = wy - sy / z1;
    this.applyCamera();
  }
  setZoom(z) { this.zoomAt(z / this.cam.zoom); }
  panBy(dxScreen, dyScreen) { this.cam.x -= dxScreen / this.cam.zoom; this.cam.y -= dyScreen / this.cam.zoom; this.applyCamera(); }
  contentBounds(els = this.elements) { return unionRect(els.map((e) => this.boundsOf(e))); }
  fitContent(rect = this.contentBounds(), maxZoom = 1.5) {
    if (!rect) { this.cam = { x: -60, y: -120, zoom: 1 }; this.applyCamera(); return; }
    // leave room for the floating toolbars at the top and bottom
    const padX = 60, top = 120, bottom = 70;
    const z = clamp(Math.min((this.W - padX * 2) / Math.max(rect.w, 1), (this.H - top - bottom) / Math.max(rect.h, 1)), MIN_ZOOM, maxZoom);
    this.cam.zoom = z;
    this.cam.x = rect.x + rect.w / 2 - this.W / 2 / z;
    this.cam.y = rect.y - top / z + Math.max(0, (this.H - top - bottom) / z - rect.h) / 2;
    this.applyCamera();
  }
  scrollIntoView(rect) {
    const [sx, sy] = this.toScreen(rect.x, rect.y);
    const sw = rect.w * this.cam.zoom, sh = rect.h * this.cam.zoom;
    if (sx > 40 && sy > 80 && sx + sw < this.W - 40 && sy + sh < this.H - 40) return;
    this.cam.x = rect.x + rect.w / 2 - this.W / 2 / this.cam.zoom;
    this.cam.y = rect.y + rect.h / 2 - this.H / 2 / this.cam.zoom;
    this.applyCamera();
  }
  viewCenter() { return this.toWorld(this.W / 2, this.H / 2); }

  // ------------------------------------------------------------ rendering
  requestRender() { this._inkDirty = true; this._uiDirty = true; this.schedule(); }
  requestUi() { this._uiDirty = true; this.schedule(); }
  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this._inkDirty) { this._inkDirty = false; this.renderInk(); }
      if (this._uiDirty) { this._uiDirty = false; this.renderUi(); }
    });
  }

  backgroundPattern(kind, tilePx, color) {
    const key = kind + tilePx + color;
    let pat = this.patternCache.get(key);
    if (pat) return pat;
    if (this.patternCache.size > 40) this.patternCache.clear();
    const s = Math.max(2, Math.round(tilePx));
    const c = new OffscreenCanvas(s, s);
    const g = c.getContext('2d');
    g.fillStyle = color; g.strokeStyle = color;
    if (kind === 'dots') {
      const r = Math.max(0.9, Math.min(1.5, s / 20 / this.dpr)) * this.dpr * 0.8;
      g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
    } else if (kind === 'grid') {
      g.lineWidth = this.dpr * 0.8;
      g.beginPath(); g.moveTo(0.5, 0); g.lineTo(0.5, s); g.moveTo(0, 0.5); g.lineTo(s, 0.5); g.stroke();
    } else if (kind === 'lines') {
      g.lineWidth = this.dpr * 0.9;
      g.beginPath(); g.moveTo(0, 0.5); g.lineTo(s, 0.5); g.stroke();
    }
    pat = this.ctx.createPattern(c, 'repeat');
    this.patternCache.set(key, pat);
    return pat;
  }

  renderInk() {
    const ctx = this.ctx, dpr = this.dpr, { x, y, zoom } = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const paper = this.paperColor, dark = this.darkPaper;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    if (!this.page) return;

    const bg = this.page.background || 'dots';
    if (bg !== 'plain') {
      let spacing = bg === 'lines' ? 32 : 24;
      while (spacing * zoom < 12) spacing *= 2;
      const tile = spacing * zoom * dpr;
      const col = dark ? 'rgba(255,255,255,0.13)' : bg === 'dots' ? 'rgba(20,24,32,0.22)' : 'rgba(40,80,160,0.13)';
      const pat = this.backgroundPattern(bg, tile, col);
      const ox = (-x * zoom * dpr) % tile, oy = (-y * zoom * dpr) % tile;
      pat.setTransform(new DOMMatrix([tile / Math.round(tile), 0, 0, tile / Math.round(tile), ox, oy]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    }

    const view = { x, y, w: this.W / zoom, h: this.H / zoom };
    const o = { darkPaper: dark, onImageLoad: () => { this.sceneCache = null; this.requestRender(); } };
    const drag = this.mode && this.mode.xform;
    // Big boards: draw from a cached bitmap so panning costs one blit.
    if (this.elements.length > 350 && !drag && !this.overrides.size && !this.hidden.size) {
      this.drawScene(ctx, view, o, dark);
      return;
    }
    this.sceneCache = null;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -x * zoom * dpr, -y * zoom * dpr);
    for (const el0 of this.elements) {
      if (el0.type === 'text' || this.hidden.has(el0.id)) continue;
      const el = this.overrides.get(el0.id) || el0;
      if (drag && this.selection.has(el.id)) {
        ctx.save();
        ctx.transform(...drag);
        renderElement(ctx, el, o);
        ctx.restore();
        continue;
      }
      if (!rectsIntersect(bounds(el), view)) continue;
      renderElement(ctx, el, o);
    }
    for (const el of this.overrides.values()) if (!this.elements.some((e) => e.id === el.id)) renderElement(ctx, el, o);
  }

  drawScene(ctx, view, o, dark) {
    const dpr = this.dpr, z = this.cam.zoom;
    const els = this.elements;
    let c = this.sceneCache;
    const rebuild = () => {
      const mx = view.w * 0.3, my = view.h * 0.3;
      const rect = { x: view.x - mx, y: view.y - my, w: view.w + 2 * mx, h: view.h + 2 * my };
      const pw = Math.ceil(rect.w * z * dpr), ph = Math.ceil(rect.h * z * dpr);
      const canvas = c && c.canvas.width === pw && c.canvas.height === ph ? c.canvas : new OffscreenCanvas(pw, ph);
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.setTransform(z * dpr, 0, 0, z * dpr, -rect.x * z * dpr, -rect.y * z * dpr);
      for (const el of els) if (el.type !== 'text' && rectsIntersect(bounds(el), rect)) renderElement(g, el, o);
      c = this.sceneCache = { canvas, g, rect, zoom: z, els, count: els.length, dark };
    };
    if (!c || c.dark !== dark) rebuild();
    else if (c.zoom !== z) {
      // mid-zoom: stretch the old bitmap now, redraw crisp once zooming pauses
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -view.x * z * dpr, -view.y * z * dpr);
      ctx.drawImage(c.canvas, c.rect.x, c.rect.y, c.rect.w, c.rect.h);
      clearTimeout(this._zoomT);
      this._zoomT = setTimeout(() => { this.sceneCache = null; this.requestRender(); }, 140);
      return;
    } else if (c.els !== els) {
      let prefix = els.length >= c.count;
      if (prefix) for (let i = 0; i < c.count; i++) if (els[i] !== c.els[i]) { prefix = false; break; }
      if (prefix) {
        for (let i = c.count; i < els.length; i++) if (els[i].type !== 'text') renderElement(c.g, els[i], o);
        c.els = els; c.count = els.length;
      } else rebuild();
    }
    if (view.x < c.rect.x || view.y < c.rect.y || view.x + view.w > c.rect.x + c.rect.w || view.y + view.h > c.rect.y + c.rect.h) rebuild();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c.canvas, Math.round((c.rect.x - view.x) * z * dpr), Math.round((c.rect.y - view.y) * z * dpr));
  }

  renderUi() {
    const ctx = this.uctx, dpr = this.dpr, { x, y, zoom } = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -x * zoom * dpr, -y * zoom * dpr);
    const m = this.mode;
    const dark = this.darkPaper;

    // live stroke
    if (m && m.type === 'draw') {
      const pts = m.predicted && m.predicted.length ? m.points.concat(m.predicted) : m.points;
      if (m.snapped) {
        renderElement(ctx, m.snapped, { darkPaper: dark });
      } else {
        ctx.fillStyle = mapColor(m.el.color, dark);
        if (m.el.tool === 'highlighter') { ctx.globalAlpha = 0.38; }
        ctx.fill(livePath(pts, m.el));
        ctx.globalAlpha = 1;
      }
    }
    if (m && m.type === 'shape' && m.el) renderElement(ctx, m.el, { darkPaper: dark });

    // AI work in progress shimmer
    if (this.busy.length) {
      const t = performance.now() / 600;
      for (const b of this.busy) {
        ctx.fillStyle = `rgba(99,102,241,${0.07 + 0.05 * Math.sin(t)})`;
        ctx.beginPath(); ctx.roundRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12, 8 / zoom); ctx.fill();
      }
      this.requestUi();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // selection
    const sel = this.selectionBounds();
    if (sel && !(m && m.type === 'draw')) {
      let r = sel;
      if (m && m.xform) {
        const [a, , , d, e, f] = m.xform;
        r = { x: r.x * a + e, y: r.y * d + f, w: r.w * a, h: r.h * d };
      }
      const [sx, sy] = this.toScreen(r.x, r.y);
      const sw = r.w * zoom, sh = r.h * zoom;
      ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.round(sx - 4) + 0.5, Math.round(sy - 4) + 0.5, Math.round(sw + 8), Math.round(sh + 8));
      ctx.setLineDash([]);
      if (!(m && m.type === 'move')) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.5;
        for (const [hx, hy] of this.handlePoints({ x: sx - 4, y: sy - 4, w: sw + 8, h: sh + 8 })) {
          ctx.beginPath(); ctx.roundRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE, 2); ctx.fill(); ctx.stroke();
        }
      }
    }
    // hover outline for text in select mode
    if (this.hoverId && !this.selection.has(this.hoverId) && !m) {
      const el = this.getById(this.hoverId);
      if (el) {
        const b = this.boundsOf(el); const [sx, sy] = this.toScreen(b.x, b.y);
        ctx.strokeStyle = 'rgba(99,102,241,.55)'; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(sx - 3) + 0.5, Math.round(sy - 3) + 0.5, Math.round(b.w * zoom + 6), Math.round(b.h * zoom + 6));
      }
    }
    if (m && m.type === 'marquee') {
      const [ax, ay] = this.toScreen(m.x0, m.y0), [bx, by] = this.toScreen(m.x1, m.y1);
      ctx.fillStyle = 'rgba(99,102,241,.08)'; ctx.strokeStyle = 'rgba(99,102,241,.8)'; ctx.lineWidth = 1;
      if (m.x1 < m.x0) ctx.setLineDash([4, 3]);
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }
    if (m && m.type === 'lasso' && m.poly.length > 1) {
      ctx.strokeStyle = '#6366f1'; ctx.fillStyle = 'rgba(99,102,241,.07)'; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      m.poly.forEach((p, i) => { const [sx, sy] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    // eraser cursor
    if (this.tool === 'eraser' && this.cursor && !this.pointersDownTouch()) {
      const [sx, sy] = this.toScreen(this.cursor[0], this.cursor[1]);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
      ctx.fillStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.04)';
      ctx.beginPath(); ctx.arc(sx, sy, this.styles.eraser.size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // laser
    if (this.laser.length) {
      const now = performance.now();
      this.laser = this.laser.filter((p) => now - p.t < 900);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.laser.length; i++) {
        const a = this.laser[i - 1], b = this.laser[i];
        const age = (now - b.t) / 900;
        ctx.strokeStyle = `rgba(239,68,68,${(1 - age) * 0.9})`;
        ctx.lineWidth = 5 * (1 - age) + 1;
        const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      if (this.laser.length) this.requestUi();
    }
  }
  pointersDownTouch() { return false; }

  // ------------------------------------------------------------ selection
  selectionBounds() {
    if (!this.selection.size) return null;
    return unionRect(this.elements.filter((e) => this.selection.has(e.id)).map((e) => this.boundsOf(e)));
  }
  selectedElements() { return this.elements.filter((e) => this.selection.has(e.id)); }
  setSelection(ids) {
    this.selection = new Set(ids);
    this.requestUi();
    this.emit('selection');
  }
  clearSelection() { if (this.selection.size) this.setSelection([]); }
  selectAll() { this.text.endEdit(); this.setSelection(this.elements.map((e) => e.id)); }
  handlePoints(r) {
    const { x, y, w, h } = r;
    return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
  }
  handleAt(sx, sy) {
    const sel = this.selectionBounds(); if (!sel) return -1;
    const [x, y] = this.toScreen(sel.x, sel.y);
    const pts = this.handlePoints({ x: x - 4, y: y - 4, w: sel.w * this.cam.zoom + 8, h: sel.h * this.cam.zoom + 8 });
    for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i][0] - sx) <= HANDLE && Math.abs(pts[i][1] - sy) <= HANDLE) return i;
    return -1;
  }
  topmostAt(wx, wy, filter) {
    const tol = 5 / this.cam.zoom;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (filter && !filter(el)) continue;
      if (hitTest(el, wx, wy, tol, el.type === 'text' ? this.textHeight(el) : undefined)) return el;
    }
    return null;
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.removeIds([...this.selection]);
    this.clearSelection();
  }
  duplicateSelection(offset = 24) {
    const els = this.selectedElements(); if (!els.length) return;
    const copies = els.map((e) => ({ ...transformElement(e, (x, y) => [x + offset, y + offset]), id: uid() }));
    this.add(copies, 'Duplicate');
    this.setSelection(copies.map((c) => c.id));
  }
  nudge(dx, dy) {
    const els = this.selectedElements(); if (!els.length) return;
    const map = new Map(els.map((e) => [e.id, transformElement(e, (x, y) => [x + dx, y + dy])]));
    this.replace(map, 'Move');
  }
  arrange(where) {
    const sel = this.selection; if (!sel.size) return;
    const inSel = this.elements.filter((e) => sel.has(e.id)), rest = this.elements.filter((e) => !sel.has(e.id));
    let next;
    if (where === 'front') next = [...rest, ...inSel];
    else if (where === 'back') next = [...inSel, ...rest];
    else {
      next = [...this.elements];
      const dir = where === 'forward' ? 1 : -1;
      const idx = next.map((e, i) => (sel.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (dir > 0) idx.reverse();
      for (const i of idx) { const j = i + dir; if (j < 0 || j >= next.length || sel.has(next[j].id)) continue; [next[i], next[j]] = [next[j], next[i]]; }
    }
    this.commit(next, { label: 'Arrange' });
  }
  recolorSelection(color) {
    const map = new Map();
    for (const e of this.selectedElements()) {
      if (e.type === 'stroke' || isShape(e)) map.set(e.id, { ...e, color });
      else if (e.type === 'text' && e.sticky) map.set(e.id, { ...e, bg: color });
      else if (e.type === 'text') map.set(e.id, { ...e, color });
    }
    this.replace(map, 'Recolor');
  }

  // ------------------------------------------------------------ clipboard
  copySelection() {
    const els = this.selectedElements().map((e) => (e.type === 'text' ? { ...e, h: this.textHeight(e) } : e));
    if (!els.length) return false;
    this.clipboard = els;
    try { navigator.clipboard.writeText(JSON.stringify({ inkboard: 1, elements: els })); } catch {}
    return true;
  }
  cutSelection() { if (this.copySelection()) this.deleteSelection(); }
  pasteElements(els, at) {
    const b = unionRect(els.map((e) => bounds(e, e.h)));
    let dx = 24, dy = 24;
    if (at && b) { dx = at[0] - (b.x + b.w / 2); dy = at[1] - (b.y + b.h / 2); }
    const copies = els.map((e) => ({ ...transformElement(e, (x, y) => [x + dx, y + dy]), id: uid() }));
    this.add(copies, 'Paste');
    this.setSelection(copies.map((c) => c.id));
  }
  insertImage(src, at) {
    const img = new Image();
    img.onload = () => {
      const maxW = 640 / this.cam.zoom;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxW) { h = (h * maxW) / w; w = maxW; }
      const [cx, cy] = at || this.viewCenter();
      const el = { id: uid(), type: 'image', x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h), src };
      this.add([el], 'Image');
      this.setTool('select');
      this.setSelection([el.id]);
    };
    img.src = src;
  }

  // ------------------------------------------------------------ tools
  setTool(tool) {
    if (tool === this.tool) return;
    if (this.tool !== 'hand') this.prevTool = this.tool;
    this.tool = tool;
    if (tool !== 'select' && tool !== 'lasso') this.clearSelection();
    this.stage.dataset.tool = tool;
    this.text.layer.classList.toggle('interactive', tool === 'select' || tool === 'text' || tool === 'lasso');
    this.cursor = null;
    this.requestUi();
    this.emit('tool', tool);
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => this.onDown(e));
    s.addEventListener('pointermove', (e) => this.onMove(e));
    s.addEventListener('pointerup', (e) => this.onUp(e));
    s.addEventListener('pointercancel', (e) => this.onUp(e, true));
    s.addEventListener('pointerleave', () => { if (!this.mode) { this.cursor = null; this.hoverId = null; this.requestUi(); } });
    s.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    s.addEventListener('dblclick', (e) => this.onDblClick(e));
    s.addEventListener('contextmenu', (e) => { if (!this.text.isEditingTarget(e.target)) e.preventDefault(); });
    // Gestures on trackpads (Safari-style) are delivered as ctrl+wheel in Chromium.
  }

  onWheel(e) {
    if (this.text.isEditingTarget(e.target) && !e.ctrlKey) {
      const n = this.text.editingNode();
      if (n && n.scrollHeight > n.clientHeight) return;
    }
    e.preventDefault();
    const r = this.stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomAt(Math.exp(-clamp(d, -60, 60) * 0.008), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      if (e.shiftKey && !e.deltaX) this.panBy(-e.deltaY * k, 0);
      else this.panBy(-e.deltaX * k, -e.deltaY * k);
    }
  }

  onDown(e) {
    if (this.text.isEditingTarget(e.target)) return;
    if (e.target.closest && e.target.closest('.no-board')) return;
    const r = this.stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    this.pointers.set(e.pointerId, { sx, sy, type: e.pointerType });
    if (e.pointerType === 'pen') this.seenPen = true;

    // Two fingers: pinch-zoom / pan, abandoning any stroke just started.
    if (e.pointerType === 'touch' && [...this.pointers.values()].filter((p) => p.type === 'touch').length >= 2) {
      if (this.mode && this.mode.type === 'draw') this.mode = null;
      this.startPinch();
      return;
    }
    if (this.text.editingId) this.text.endEdit();
    try { this.stage.setPointerCapture(e.pointerId); } catch {}

    const [wx, wy] = this.toWorld(sx, sy);
    const touchPans = e.pointerType === 'touch' && (this.penOnly || this.seenPen);
    if (e.button === 1 || (e.button === 0 && this.spaceDown) || this.tool === 'hand' || touchPans) {
      this.mode = { type: 'pan', sx, sy, id: e.pointerId };
      this.stage.classList.add('panning');
      return;
    }
    if (e.button === 2) return;

    let tool = this.tool;
    if (e.pointerType === 'pen' && (e.buttons & 32)) tool = 'eraser';   // eraser end of a stylus
    this.emit('interact');

    switch (tool) {
      case 'pen': case 'highlighter': return this.startDraw(e, tool, wx, wy);
      case 'eraser': return this.startErase(e, wx, wy);
      case 'shape': return this.startShape(wx, wy);
      case 'laser': this.mode = { type: 'laser' }; this.laser.push({ x: wx, y: wy, t: performance.now() }); return this.requestUi();
      case 'text': {
        const hit = this.topmostAt(wx, wy, (el) => el.type === 'text');
        if (hit) { this.text.edit(hit.id, { clientX: e.clientX, clientY: e.clientY }); return; }
        this.mode = { type: 'click-create', kind: 'text', wx, wy, sx, sy };
        return;
      }
      case 'sticky':
        this.mode = { type: 'click-create', kind: 'sticky', wx, wy, sx, sy };
        return;
      case 'select': case 'lasso': return this.startSelect(e, tool, wx, wy, sx, sy);
    }
  }

  onMove(e) {
    const r = this.stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = this.pointers.get(e.pointerId);
    if (p) { p.sx = sx; p.sy = sy; }
    const m = this.mode;
    const [wx, wy] = this.toWorld(sx, sy);
    if (this.tool === 'eraser' || (m && m.type === 'erase')) { this.cursor = [wx, wy]; this.requestUi(); }
    if (!m) {
      if (this.tool === 'select' && e.pointerType !== 'touch') this.updateHover(wx, wy, sx, sy);
      return;
    }
    switch (m.type) {
      case 'pinch': return this.movePinch();
      case 'pan': this.panBy(sx - m.sx, sy - m.sy); m.sx = sx; m.sy = sy; return;
      case 'draw': return this.moveDraw(e);
      case 'erase': return this.moveErase(wx, wy);
      case 'shape': return this.moveShape(wx, wy, e.shiftKey);
      case 'laser': this.laser.push({ x: wx, y: wy, t: performance.now() }); return this.requestUi();
      case 'marquee': m.x1 = wx; m.y1 = wy; return this.requestUi();
      case 'lasso': m.poly.push([wx, wy]); return this.requestUi();
      case 'move': return this.moveSelection(wx, wy, e.shiftKey);
      case 'resize': return this.moveResize(wx, wy, e.shiftKey);
      case 'pending-select':
        if (Math.hypot(sx - m.sx, sy - m.sy) > 3) { this.mode = { type: 'move', x0: m.x0, y0: m.y0, xform: null }; this.moveSelection(wx, wy, e.shiftKey); }
        return;
    }
  }

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    const m = this.mode;
    if (!m) return;
    if (m.type === 'pinch') { if (this.pointers.size < 2) this.mode = null; return; }
    this.mode = null;
    this.stage.classList.remove('panning');
    switch (m.type) {
      case 'draw': return cancelled ? this.requestUi() : this.endDraw(m);
      case 'erase': return this.endErase(m);
      case 'shape': return this.endShape(m);
      case 'marquee': return this.endMarquee(m, e.shiftKey);
      case 'lasso': return this.endLasso(m, e.shiftKey);
      case 'move': return this.endMove(m);
      case 'resize': return this.endResize(m);
      case 'click-create': {
        if (m.kind === 'text') this.text.createAt(m.wx, m.wy - 12);
        else this.text.createAt(m.wx - 110, m.wy - 30, { sticky: true, bg: this.styles.sticky.bg });
        return;
      }
      case 'pending-select': {
        // simple click on an already-selected text box -> edit it
        if (m.textId && m.wasSelected && this.selection.size === 1) this.text.edit(m.textId, { clientX: e.clientX, clientY: e.clientY });
        this.requestUi();
        return;
      }
      default: this.requestUi();
    }
  }

  cancelGesture() {
    if (this.mode && this.mode.type === 'erase' && this.mode.before) this.pushHistory(this.mode.before, this.elements, 'Erase');
    this.mode = null; this.requestRender();
  }

  onDblClick(e) {
    const tgt = this.text.nodeFromTarget(e.target);
    const [wx, wy] = this.eventPoint(e);
    if (tgt) { this.text.edit(tgt, { clientX: e.clientX, clientY: e.clientY }); return; }
    // Double-clicking with the pen leaves two tiny dots behind: remove them.
    if (this.tool === 'pen' || this.tool === 'highlighter') {
      const now = performance.now();
      const taps = this.lastTaps.filter((t) => now - t.t < 700).map((t) => t.entry);
      for (const entry of taps.reverse()) {
        if (this.history.undo[this.history.undo.length - 1] === entry) {
          this.history.undo.pop();
          this.page.elements = entry.before;
        }
      }
      this.lastTaps = [];
      this.afterElementsChanged(true);
    }
    const hit = this.topmostAt(wx, wy, (el) => el.type !== 'stroke');
    if (hit && hit.type === 'text') { this.text.edit(hit.id, { clientX: e.clientX, clientY: e.clientY }); return; }
    if (hit) return;
    this.text.createAt(wx, wy - 12);
  }

  updateHover(wx, wy) {
    const hit = this.topmostAt(wx, wy);
    const id = hit ? hit.id : null;
    const handle = this.selection.size ? this.handleAt(...this.toScreen(wx, wy)) : -1;
    this.stage.style.cursor = handle >= 0 ? ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][handle] : hit ? 'move' : '';
    if (id !== this.hoverId) { this.hoverId = id; this.requestUi(); }
  }

  // --- pinch
  startPinch() {
    const t = [...this.pointers.values()].slice(0, 2);
    this.mode = { type: 'pinch', d0: Math.hypot(t[0].sx - t[1].sx, t[0].sy - t[1].sy), cx: (t[0].sx + t[1].sx) / 2, cy: (t[0].sy + t[1].sy) / 2 };
    this.requestUi();
  }
  movePinch() {
    const m = this.mode;
    const t = [...this.pointers.values()].slice(0, 2);
    if (t.length < 2) return;
    const d = Math.hypot(t[0].sx - t[1].sx, t[0].sy - t[1].sy);
    const cx = (t[0].sx + t[1].sx) / 2, cy = (t[0].sy + t[1].sy) / 2;
    this.panBy(cx - m.cx, cy - m.cy);
    if (m.d0 > 10) this.zoomAt(d / m.d0, cx, cy);
    m.d0 = d; m.cx = cx; m.cy = cy;
  }

  // --- drawing
  startDraw(e, tool, wx, wy) {
    const st = this.styles[tool];
    const pr = tool === 'pen' && this.pressure && e.pointerType === 'pen';
    const el = { tool, color: st.color, size: round2(st.size / this.cam.zoom), pr, sl: 0.25 + this.smoothing * 0.5 };
    this.mode = { type: 'draw', el, points: [[round2(wx), round2(wy), pr ? e.pressure || 0.5 : 0.5]], t0: performance.now(), lastMove: performance.now(), anchor: [wx, wy], predicted: null, snapped: null };
    this.emit('inkStart');
    this.requestUi();
  }
  moveDraw(e) {
    const m = this.mode;
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const r = this.stage.getBoundingClientRect();
    const minD = 0.6 / this.cam.zoom;
    for (const ev of evts.length ? evts : [e]) {
      const [x, y] = this.toWorld(ev.clientX - r.left, ev.clientY - r.top);
      const last = m.points[m.points.length - 1];
      if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < minD) continue;
      m.points.push([round2(x), round2(y), m.el.pr ? ev.pressure || 0.5 : 0.5]);
    }
    // Predicted points shave a frame or two of perceived latency.
    m.predicted = null;
    if (e.getPredictedEvents && !m.snapped) {
      const pe = e.getPredictedEvents();
      if (pe.length) m.predicted = pe.slice(0, 2).map((ev) => { const [x, y] = this.toWorld(ev.clientX - r.left, ev.clientY - r.top); return [x, y, m.el.pr ? ev.pressure || 0.5 : 0.5]; });
    }
    // Hold still at the end of a stroke to snap it into a clean shape.
    const last = m.points[m.points.length - 1];
    if (Math.hypot(last[0] - m.anchor[0], last[1] - m.anchor[1]) * this.cam.zoom > 4) {
      m.anchor = [last[0], last[1]];
      if (m.snapped) { m.snapped = null; }
      clearTimeout(m.holdTimer);
      if (m.el.tool === 'pen') m.holdTimer = setTimeout(() => this.trySnap(m), 520);
    }
    this.requestUi();
  }
  trySnap(m) {
    if (this.mode !== m || m.points.length < 6) return;
    const shape = recognizeShape(m.points, this.cam.zoom);
    if (!shape) return;
    m.snapped = { id: 'snap', ...shape, color: m.el.color, size: Math.max(1.5, m.el.size * 0.9) };
    m.predicted = null;
    this.requestUi();
    this.emit('snapped');
  }
  endDraw(m) {
    clearTimeout(m.holdTimer);
    let el;
    if (m.snapped) {
      el = { ...m.snapped, id: uid() };
    } else {
      el = { id: uid(), type: 'stroke', ...m.el, points: m.points };
    }
    const entry = this.add([el], 'Draw');
    if (el.type === 'stroke') {
      const b = bounds(el);
      if (b.w * this.cam.zoom < 10 && b.h * this.cam.zoom < 10 && performance.now() - m.t0 < 250) this.lastTaps.push({ entry, t: performance.now() });
      if (this.lastTaps.length > 4) this.lastTaps.shift();
      this.emit('inkAdded', el);
    }
    this.requestUi();
  }

  // --- erasing
  startErase(e, wx, wy) {
    this.mode = { type: 'erase', before: this.elements, last: [wx, wy], partial: this.styles.eraser.mode === 'partial' };
    this.moveErase(wx, wy);
  }
  moveErase(wx, wy) {
    const m = this.mode;
    const r = this.styles.eraser.size / 2 / this.cam.zoom;
    const a = m.last, b = [wx, wy];
    const box = { x: Math.min(a[0], b[0]) - r, y: Math.min(a[1], b[1]) - r, w: Math.abs(a[0] - b[0]) + 2 * r, h: Math.abs(a[1] - b[1]) + 2 * r };
    let changed = false;
    const next = [];
    for (const el of this.elements) {
      if (el.type === 'text' || el.type === 'image' || !rectsIntersect(bounds(el), box)) { next.push(el); continue; }
      const pts = hitPolyline(el);
      const rr = r + (el.size || 2) / 2;
      if (m.partial && el.type === 'stroke') {
        const pieces = splitStroke(el, a, b, rr);
        if (pieces === null) { next.push(el); continue; }
        changed = true;
        next.push(...pieces);
        continue;
      }
      let hit = false;
      if (pts.length === 1) hit = distToSeg(pts[0][0], pts[0][1], a[0], a[1], b[0], b[1]) <= rr;
      for (let i = 1; i < pts.length && !hit; i++) if (segSegDist(a, b, pts[i - 1], pts[i]) <= rr) hit = true;
      if (!hit && el.fill) hit = hitTest(el, wx, wy, r);
      if (hit) changed = true; else next.push(el);
    }
    m.last = b;
    if (changed) { this.page.elements = next; this.requestRender(); }
  }
  endErase(m) {
    if (this.elements !== m.before) {
      this.pushHistory(m.before, this.elements, 'Erase');
      this.afterElementsChanged();
    }
  }

  // --- shapes
  startShape(wx, wy) {
    this.mode = { type: 'shape', x0: wx, y0: wy, el: null };
  }
  moveShape(wx, wy, shift) {
    const m = this.mode;
    let x2 = wx, y2 = wy;
    const kind = this.shapeKind;
    if (shift) {
      if (kind === 'line' || kind === 'arrow') {
        const ang = Math.round(Math.atan2(wy - m.y0, wx - m.x0) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(wx - m.x0, wy - m.y0);
        x2 = m.x0 + Math.cos(ang) * len; y2 = m.y0 + Math.sin(ang) * len;
      } else {
        const d = Math.max(Math.abs(wx - m.x0), Math.abs(wy - m.y0));
        x2 = m.x0 + Math.sign(wx - m.x0 || 1) * d; y2 = m.y0 + Math.sign(wy - m.y0 || 1) * d;
      }
    }
    const st = this.styles.shape;
    m.el = { id: 'preview', type: kind, x1: round2(m.x0), y1: round2(m.y0), x2: round2(x2), y2: round2(y2), color: st.color, size: round2(st.size / this.cam.zoom), fill: st.fill, dash: st.dash };
    this.requestUi();
  }
  endShape(m) {
    if (!m.el || Math.hypot(m.el.x2 - m.el.x1, m.el.y2 - m.el.y1) * this.cam.zoom < 4) { this.requestUi(); return; }
    const el = { ...m.el, id: uid() };
    this.add([el], 'Shape');
    this.requestUi();
  }

  // --- select / move / resize
  startSelect(e, tool, wx, wy, sx, sy) {
    const handle = this.handleAt(sx, sy);
    if (handle >= 0) {
      const b = this.selectionBounds();
      this.mode = { type: 'resize', handle, b, xform: null };
      return;
    }
    const sb = this.selectionBounds();
    const pad = 6 / this.cam.zoom;
    const insideSel = sb && wx >= sb.x - pad && wy >= sb.y - pad && wx <= sb.x + sb.w + pad && wy <= sb.y + sb.h + pad;
    const hit = this.topmostAt(wx, wy);
    if (hit && !e.shiftKey && (!insideSel || !this.selection.has(hit.id)) && !(insideSel && this.selection.size > 1)) {
      const wasSelected = this.selection.has(hit.id);
      this.setSelection([hit.id]);
      this.mode = { type: 'pending-select', x0: wx, y0: wy, sx, sy, textId: hit.type === 'text' ? hit.id : null, wasSelected };
      return;
    }
    if (hit && e.shiftKey) {
      const s = new Set(this.selection);
      s.has(hit.id) ? s.delete(hit.id) : s.add(hit.id);
      this.setSelection(s);
      return;
    }
    if (insideSel) {
      const single = this.selection.size === 1 ? this.getById([...this.selection][0]) : null;
      this.mode = { type: 'pending-select', x0: wx, y0: wy, sx, sy, textId: single && single.type === 'text' ? single.id : null, wasSelected: true };
      return;
    }
    if (!e.shiftKey) this.clearSelection();
    if (tool === 'lasso') this.mode = { type: 'lasso', poly: [[wx, wy]] };
    else this.mode = { type: 'marquee', x0: wx, y0: wy, x1: wx, y1: wy };
  }
  moveSelection(wx, wy) {
    const m = this.mode;
    const dx = wx - m.x0, dy = wy - m.y0;
    m.dx = dx; m.dy = dy;
    m.xform = [1, 0, 0, 1, dx, dy];
    this.text.previewTransform(this.selection, (el) => transformElement(el, (x, y) => [x + dx, y + dy]));
    this.requestRender();
  }
  endMove(m) {
    if (!m.xform || (Math.abs(m.dx) < 0.01 && Math.abs(m.dy) < 0.01)) { this.text.sync(true); this.requestRender(); return; }
    const map = new Map(this.selectedElements().map((e) => [e.id, transformElement(e, (x, y) => [x + m.dx, y + m.dy])]));
    this.replace(map, 'Move');
    this.text.sync(true);
  }
  moveResize(wx, wy, shift) {
    const m = this.mode, b = m.b;
    const h = m.handle;
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    if ([0, 6, 7].includes(h)) x1 = Math.min(wx, x2 - 4);
    if ([2, 3, 4].includes(h)) x2 = Math.max(wx, x1 + 4);
    if ([0, 1, 2].includes(h)) y1 = Math.min(wy, y2 - 4);
    if ([4, 5, 6].includes(h)) y2 = Math.max(wy, y1 + 4);
    let sx = (x2 - x1) / b.w, sy = (y2 - y1) / b.h;
    const onlyText = this.selectedElements().every((e) => e.type === 'text');
    const corner = [0, 2, 4, 6].includes(h);
    if ((shift || (corner && !onlyText && this.selectedElements().some((e) => e.type === 'image' || e.type === 'stroke'))) && corner) {
      const s = Math.max(sx, sy); sx = sy = s;
    }
    if (onlyText) sy = 1;
    const ax = [0, 6, 7].includes(h) ? b.x + b.w : b.x;
    const ay = [0, 1, 2].includes(h) ? b.y + b.h : b.y;
    m.sx = sx; m.sy = sy; m.ax = ax; m.ay = ay;
    m.xform = [sx, 0, 0, sy, ax - ax * sx, ay - ay * sy];
    const f = (x, y) => [ax + (x - ax) * sx, ay + (y - ay) * sy];
    this.text.previewTransform(this.selection, (el) => transformElement(el, f, sx, sy));
    this.requestRender();
  }
  endResize(m) {
    if (!m.xform) { this.requestRender(); return; }
    const f = (x, y) => [m.ax + (x - m.ax) * m.sx, m.ay + (y - m.ay) * m.sy];
    const map = new Map(this.selectedElements().map((e) => [e.id, transformElement(e, f, m.sx, m.sy)]));
    this.replace(map, 'Resize');
    this.text.sync(true);
  }
  endMarquee(m, add) {
    const rect = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
    if (rect.w * this.cam.zoom < 3 && rect.h * this.cam.zoom < 3) { this.requestUi(); return; }
    const touching = m.x1 < m.x0; // right-to-left drag selects anything it touches
    const ids = this.elements.filter((el) => { const b = this.boundsOf(el); return touching ? rectsIntersect(rect, b) : rectContains(rect, b); }).map((e) => e.id);
    this.setSelection(add ? [...this.selection, ...ids] : ids);
  }
  endLasso(m, add) {
    if (m.poly.length < 3) { this.requestUi(); return; }
    const poly = m.poly;
    const ids = this.elements.filter((el) => {
      if (el.type === 'stroke') {
        const pts = el.points; let inside = 0;
        const step = Math.max(1, Math.floor(pts.length / 24));
        let n = 0;
        for (let i = 0; i < pts.length; i += step) { n++; if (pointInPoly(pts[i][0], pts[i][1], poly)) inside++; }
        return inside / n >= 0.5;
      }
      const b = this.boundsOf(el);
      return pointInPoly(b.x + b.w / 2, b.y + b.h / 2, poly);
    }).map((e) => e.id);
    this.setSelection(add ? [...this.selection, ...ids] : ids);
  }
}

// Cut a stroke where the eraser segment a→b passes within r. Returns null if untouched.
function splitStroke(el, a, b, r) {
  // quick reject: the eraser path never comes near any segment
  const src = el.points;
  let near = false;
  for (let i = 0; i < src.length && !near; i++) {
    const p = src[i], q = src[i + 1] || p;
    if (segSegDist(a, b, p, q) <= r) near = true;
  }
  if (!near) return null;
  // densify so the cut lands exactly where the eraser passed
  const pts = [];
  const step = Math.max(r * 0.4, 0.5);
  for (let i = 0; i < src.length; i++) {
    const p = src[i];
    pts.push(p);
    const q = src[i + 1];
    if (!q) break;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.floor(d / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      pts.push([round2(p[0] + (q[0] - p[0]) * t), round2(p[1] + (q[1] - p[1]) * t), p[2] + (q[2] - p[2]) * t]);
    }
  }
  const keep = pts.map((p) => distToSeg(p[0], p[1], a[0], a[1], b[0], b[1]) > r);
  if (keep.every(Boolean)) return null;
  const pieces = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) cur.push(pts[i]);
    else { if (cur.length) pieces.push(cur); cur = []; }
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((p) => p.length > 1).map((points) => ({ ...el, id: uid(), points }));
}

// Element geometry + rendering. Elements are immutable plain objects, so
// expensive results (stroke outlines, bounds, hit polylines) are cached in
// WeakMaps keyed by the element itself and are freed automatically.
import { getStroke } from './vendor/perfect-freehand.mjs';
import { distToSeg, htmlToPlain } from './util.js';

const pathCache = new WeakMap();
const boundsCache = new WeakMap();
const polyCache = new WeakMap();
const imageCache = new Map();

export const DEFAULT_INK = '#1f2937';
export const DEFAULT_INK_DARK = '#ececec';

export function strokeOptions(el, last = true) {
  const hl = el.tool === 'highlighter';
  return {
    size: el.size,
    thinning: hl ? 0 : el.pr ? 0.6 : 0.45,
    smoothing: 0.62,
    streamline: el.sl ?? 0.45,
    simulatePressure: !hl && !el.pr,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last,
  };
}

export function outlinePath(outline) {
  const p = new Path2D();
  const n = outline.length;
  if (n < 2) return p;
  p.moveTo((outline[0][0] + outline[1][0]) / 2, (outline[0][1] + outline[1][1]) / 2);
  for (let i = 1; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  p.closePath();
  return p;
}

export function strokePath(el) {
  let p = pathCache.get(el);
  if (!p) {
    p = outlinePath(getStroke(el.points, strokeOptions(el)));
    pathCache.set(el, p);
  }
  return p;
}

export function livePath(points, el) {
  return outlinePath(getStroke(points, strokeOptions(el, false)));
}

// ------------------------------------------------------------------ shapes
function shapePoints(el) {
  const { x1, y1, x2, y2 } = el;
  const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  switch (el.type) {
    case 'rect': return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    case 'diamond': return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2], [x + w / 2, y]];
    case 'triangle': return [[x + w / 2, y], [x + w, y + h], [x, y + h], [x + w / 2, y]];
    case 'ellipse': {
      const pts = [], cx = x + w / 2, cy = y + h / 2;
      for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI * 2; pts.push([cx + Math.cos(t) * w / 2, cy + Math.sin(t) * h / 2]); }
      return pts;
    }
    case 'poly': return [...el.pts, el.pts[0]];
    case 'line': case 'arrow': return [[x1, y1], [x2, y2]];
  }
  return [];
}

export function hitPolyline(el) {
  let p = polyCache.get(el);
  if (!p) {
    if (el.type === 'stroke') p = el.points;
    else p = shapePoints(el);
    polyCache.set(el, p);
  }
  return p;
}

function arrowHead(el) {
  const { x1, y1, x2, y2 } = el;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(10, el.size * 4.2);
  const spread = 0.48;
  return [
    [x2 - Math.cos(ang - spread) * len, y2 - Math.sin(ang - spread) * len],
    [x2, y2],
    [x2 - Math.cos(ang + spread) * len, y2 - Math.sin(ang + spread) * len],
  ];
}

function shapePath(el) {
  let p = pathCache.get(el);
  if (p) return p;
  p = new Path2D();
  const { x1, y1, x2, y2 } = el;
  const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (el.type === 'rect') {
    const r = Math.min(el.radius ?? 6, w / 2, h / 2);
    p.roundRect(x, y, w, h, r);
  } else if (el.type === 'ellipse') {
    p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (el.type === 'line' || el.type === 'arrow') {
    p.moveTo(x1, y1); p.lineTo(x2, y2);
    if (el.type === 'arrow') { const [a, b, c] = arrowHead(el); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c[0], c[1]); }
  } else {
    const pts = shapePoints(el);
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
  }
  pathCache.set(el, p);
  return p;
}
export const isClosedShape = (el) => ['rect', 'ellipse', 'diamond', 'triangle', 'poly'].includes(el.type);
export const isShape = (el) => isClosedShape(el) || el.type === 'line' || el.type === 'arrow';

// ------------------------------------------------------------------ bounds
export function bounds(el, textHeight) {
  if (el.type === 'text') return { x: el.x, y: el.y, w: el.w, h: textHeight ?? el.h ?? 40 };
  let b = boundsCache.get(el);
  if (b) return b;
  if (el.type === 'image') b = { x: el.x, y: el.y, w: el.w, h: el.h };
  else {
    const pts = el.type === 'stroke' ? el.points : el.type === 'poly' ? el.pts : [[el.x1, el.y1], [el.x2, el.y2]];
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const q of pts) { if (q[0] < x1) x1 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[0] > x2) x2 = q[0]; if (q[1] > y2) y2 = q[1]; }
    let pad = (el.size || 2) / 2 + 1;
    if (el.type === 'arrow') pad += el.size * 4;
    b = { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }
  boundsCache.set(el, b);
  return b;
}

// ------------------------------------------------------------------ hit testing
export function hitTest(el, x, y, tol, textHeight) {
  const b = bounds(el, textHeight);
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol) return false;
  if (el.type === 'image' || el.type === 'text') return true;
  if (isClosedShape(el) && el.fill) {
    const ctx = hitCtx();
    if (ctx.isPointInPath(shapePath(el), x, y)) return true;
  }
  const pts = hitPolyline(el);
  const r = (el.size || 2) / 2 + tol;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r) return true;
  }
  if (el.type === 'arrow') {
    const h = arrowHead(el);
    if (distToSeg(x, y, h[0][0], h[0][1], h[1][0], h[1][1]) <= r || distToSeg(x, y, h[1][0], h[1][1], h[2][0], h[2][1]) <= r) return true;
  }
  return false;
}
let _hc = null;
function hitCtx() { if (!_hc) _hc = new OffscreenCanvas(1, 1).getContext('2d'); return _hc; }

// ------------------------------------------------------------------ images
export function getImage(src, onLoad) {
  let entry = imageCache.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, waiters: [] };
    img.onload = () => { entry.ready = true; entry.waiters.forEach((f) => f()); entry.waiters = []; };
    img.src = src;
    imageCache.set(src, entry);
  }
  if (!entry.ready && onLoad) entry.waiters.push(onLoad);
  return entry.ready ? entry.img : null;
}

// ------------------------------------------------------------------ drawing
export function mapColor(color, darkPaper) {
  if (!darkPaper) return color === DEFAULT_INK_DARK ? DEFAULT_INK : color;
  return color === DEFAULT_INK ? DEFAULT_INK_DARK : color;
}

export function renderElement(ctx, el, o = {}) {
  const dark = !!o.darkPaper;
  if (el.type === 'stroke') {
    const color = o.colorOverride || mapColor(el.color, dark);
    ctx.fillStyle = color;
    if (el.tool === 'highlighter') {
      ctx.globalAlpha = o.colorOverride ? 0 : 0.38;
      ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
      ctx.fill(strokePath(el));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      if (el.opacity != null && el.opacity < 1) ctx.globalAlpha = el.opacity;
      ctx.fill(strokePath(el));
      ctx.globalAlpha = 1;
    }
  } else if (el.type === 'image') {
    const img = getImage(el.src, o.onImageLoad);
    if (img) ctx.drawImage(img, el.x, el.y, el.w, el.h);
    else { ctx.fillStyle = dark ? '#2a2d33' : '#ececec'; ctx.fillRect(el.x, el.y, el.w, el.h); }
  } else if (el.type === 'text') {
    if (!o.drawText) return;
    const b = bounds(el, o.textHeight);
    if (el.sticky) { ctx.fillStyle = el.bg || '#fff3a3'; ctx.fillRect(b.x, b.y, b.w, b.h); }
    const fs = el.fs || 16;
    ctx.fillStyle = o.colorOverride || (el.sticky ? '#2b2b2b' : dark ? DEFAULT_INK_DARK : DEFAULT_INK);
    ctx.font = `${fs}px ${el.font === 'hand' ? 'Caveat' : 'system-ui, sans-serif'}`;
    ctx.textBaseline = 'top';
    const lines = htmlToPlain(el.html).split('\n');
    let y = b.y + (el.sticky ? 12 : 4);
    for (const line of lines) {
      if (y > b.y + b.h) break;
      ctx.fillText(line, b.x + (el.sticky ? 12 : 4), y, b.w - 8);
      y += fs * 1.4;
    }
  } else if (isShape(el)) {
    const color = o.colorOverride || mapColor(el.color, dark);
    const path = shapePath(el);
    if (el.fill && isClosedShape(el)) {
      ctx.fillStyle = el.fillColor || color;
      ctx.globalAlpha = el.fillColor ? 1 : 0.18;
      ctx.fill(path);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = el.size;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (el.dash) ctx.setLineDash([el.size * 3, el.size * 2.5]);
    ctx.stroke(path);
    if (el.dash) ctx.setLineDash([]);
  }
}

// Transform an element by an affine scale+translate (used to bake drags/resizes).
export function transformElement(el, f, sx = 1, sy = 1) {
  const s = Math.sqrt(Math.abs(sx * sy));
  switch (el.type) {
    case 'stroke':
      return { ...el, points: el.points.map((p) => { const [x, y] = f(p[0], p[1]); return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, p[2]]; }), size: el.size * s };
    case 'poly':
      return { ...el, pts: el.pts.map((p) => f(p[0], p[1])) };
    case 'image': {
      const [x, y] = f(el.x, el.y);
      return { ...el, x, y, w: el.w * sx, h: el.h * sy };
    }
    case 'text': {
      const [x, y] = f(el.x, el.y);
      return { ...el, x, y, w: Math.max(40, el.w * sx) };
    }
    default:
      return { ...el, ...remapXY(el, f) };
  }
}
function remapXY(el, f) {
  const [x1, y1] = f(el.x1, el.y1), [x2, y2] = f(el.x2, el.y2);
  return { x1, y1, x2, y2 };
}

// Render a set of elements into a fresh canvas (thumbnails, AI input).
export function renderToCanvas(elements, rect, scale, o = {}) {
  const w = Math.max(1, Math.ceil(rect.w * scale)), h = Math.max(1, Math.ceil(rect.h * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, w, h); }
  ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
  for (const el of elements) renderElement(ctx, el, o);
  return c;
}

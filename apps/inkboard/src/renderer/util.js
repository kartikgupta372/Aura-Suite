// Small shared helpers.
export const uid = (p = 'e') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round2 = (n) => Math.round(n * 100) / 100;

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.pending = () => t !== null;
  return d;
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

// Shortest distance between two segments (used by the eraser so fast swipes don't skip).
export function segSegDist(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distToSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
    distToSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    distToSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
    distToSeg(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}
function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
export function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const rectsIntersect = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const rectContains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export function unionRect(rects) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    if (r.x < x1) x1 = r.x; if (r.y < y1) y1 = r.y;
    if (r.x + r.w > x2) x2 = r.x + r.w; if (r.y + r.h > y2) y2 = r.y + r.h;
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function htmlToPlain(html) {
  return String(html || '')
    .replace(/<(br|\/div|\/p|\/li|\/h[1-6]|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Keep pasted / loaded HTML to a safe, Word-like subset.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'P', 'DIV', 'BR', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'MARK', 'SUB', 'SUP', 'HR', 'FONT', 'IMG']);
const STYLE_KEEP = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'font-size', 'font-family', 'text-align', 'line-height'];
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK', 'TITLE'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const n = attr.name.toLowerCase();
        if (n === 'style') {
          const kept = [];
          for (const k of STYLE_KEEP) { const v = child.style.getPropertyValue(k); if (v && !/url\(|expression/i.test(v)) kept.push(k + ':' + v); }
          if (kept.length) child.setAttribute('style', kept.join(';')); else child.removeAttribute('style');
        } else if (n === 'href' && child.tagName === 'A') {
          if (!/^(https?:|mailto:)/i.test(attr.value)) child.removeAttribute('href');
        } else if (n === 'src' && child.tagName === 'IMG') {
          if (!/^data:image\//i.test(attr.value)) child.remove();
        } else if (!['class', 'data-checked', 'colspan', 'rowspan', 'color', 'face', 'size'].includes(n)) {
          child.removeAttribute(attr.name);
        } else if (n === 'class') {
          const keep = attr.value.split(/\s+/).filter((c) => c === 'checklist');
          if (keep.length) child.setAttribute('class', keep.join(' ')); else child.removeAttribute('class');
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function toast(msg, kind = 'info', ms = 2600) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, ms);
}

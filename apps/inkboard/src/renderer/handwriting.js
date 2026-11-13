// The handwriting layer.
//  1. Every stroke is stabilised + pressure-smoothed as you write (ink.js).
//  2. "Neaten" (offline, instant): after you pause, each written line is
//     straightened, de-slanted, its letter heights evened out and its jitter
//     smoothed — it still looks like your handwriting, just tidier.
//  3. "Convert to text" (AI): the handwriting is sent to a vision model and
//     replaced by clean text set in a handwriting or print font. The original
//     ink is kept inside the text box so you can revert at any time.
import { uid, round2, clamp, unionRect, escapeHtml, toast } from './util.js';
import { bounds, renderToCanvas } from './ink.js';

// ------------------------------------------------------------------ shapes
// Recognise a held stroke as a clean line / rectangle / ellipse / triangle / polygon.
export function recognizeShape(points, zoom = 1) {
  const pts = points.map((p) => [p[0], p[1]]);
  if (pts.length < 5) return null;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const a = pts[0], b = pts[pts.length - 1];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  const w = x2 - x1, h = y2 - y1, diag = Math.hypot(w, h);
  if (L * zoom < 30) return null;

  if (d / L > 0.94) return { type: 'line', x1: round2(a[0]), y1: round2(a[1]), x2: round2(b[0]), y2: round2(b[1]) };

  const closed = d < Math.max(diag * 0.2, 12 / zoom);
  if (!closed) return null;

  const loop = pts.slice();
  const simp = rdp(loop, diag * 0.075);
  // drop the closing duplicate
  if (simp.length > 2 && Math.hypot(simp[0][0] - simp[simp.length - 1][0], simp[0][1] - simp[simp.length - 1][1]) < diag * 0.2) simp.pop();
  const corners = mergeClose(simp, diag * 0.12);

  // ellipse test: radial error against the bbox ellipse
  const cx = x1 + w / 2, cy = y1 + h / 2;
  let err = 0;
  for (const [x, y] of pts) {
    const nx = (x - cx) / (w / 2 || 1), ny = (y - cy) / (h / 2 || 1);
    err += Math.abs(Math.hypot(nx, ny) - 1);
  }
  err /= pts.length;

  if (corners.length === 3) return { type: 'poly', pts: corners.map(([x, y]) => [round2(x), round2(y)]) };
  if (corners.length === 4) {
    const axisAligned = corners.every((c, i) => {
      const n = corners[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(n[1] - c[1], n[0] - c[0])) % (Math.PI / 2);
      return ang < 0.22 || ang > Math.PI / 2 - 0.22;
    });
    if (axisAligned) return { type: 'rect', x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2), radius: 4 };
    if (err > 0.1) return { type: 'poly', pts: corners.map(([x, y]) => [round2(x), round2(y)]) };
  }
  if (err < 0.13) return { type: 'ellipse', x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2) };
  if (corners.length >= 5 && corners.length <= 8) return { type: 'poly', pts: corners.map(([x, y]) => [round2(x), round2(y)]) };
  return null;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perp(pts[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
  return [a, b];
}
function perp(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (!l) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / l;
}
function mergeClose(pts, tol) {
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > tol) out.push(p);
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
  return out;
}

// ------------------------------------------------------------------ grouping
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1)]; };

// Group strokes into text lines by vertical overlap.
export function groupLines(strokes) {
  const items = strokes.map((s) => ({ s, b: bounds(s) }));
  const hMed = median(items.map((i) => i.b.h).filter((h) => h > 2)) || 20;
  // big strokes first so dots / crosses attach to their letters' line
  items.sort((p, q) => q.b.h - p.b.h);
  const lines = [];
  for (const it of items) {
    const cy = it.b.y + it.b.h / 2;
    let best = null, bestScore = Infinity;
    for (const ln of lines) {
      const top = ln.y, bot = ln.y + ln.h;
      const ov = Math.min(bot, it.b.y + it.b.h) - Math.max(top, it.b.y);
      const near = it.b.x < ln.x + ln.w + hMed * 3 && it.b.x + it.b.w > ln.x - hMed * 3;
      if (!near) continue;
      const small = it.b.h < hMed * 0.45;
      const ok = ov > Math.min(ln.h, it.b.h) * 0.35 || (small && cy > top - hMed * 0.9 && cy < bot + hMed * 0.3);
      if (!ok) continue;
      const score = Math.abs(cy - (ln.y + ln.h / 2));
      if (score < bestScore) { bestScore = score; best = ln; }
    }
    if (best) {
      best.items.push(it);
      const r = unionRect([best, it.b]);
      Object.assign(best, r);
    } else lines.push({ ...it.b, items: [it] });
  }
  lines.sort((a, b) => a.y - b.y);
  for (const ln of lines) ln.items.sort((a, b) => a.b.x - b.b.x);
  return { lines, hMed };
}

// Cluster lines into blocks (paragraphs) that become one text box.
export function groupBlocks(lines, hMed) {
  const blocks = [];
  for (const ln of lines) {
    const prev = blocks[blocks.length - 1];
    const last = prev && prev.lines[prev.lines.length - 1];
    if (last && ln.y - (last.y + last.h) < hMed * 1.6 && Math.abs(ln.x - prev.x) < Math.max(prev.w, ln.w) * 0.6 + hMed * 2) {
      prev.lines.push(ln);
      Object.assign(prev, unionRect([prev, ln]));
    } else blocks.push({ ...unionRect([ln]), lines: [ln] });
  }
  return blocks;
}

// Is this group of strokes plausibly writing (vs a drawing)?
function looksLikeWriting(line, hMed) {
  if (line.h > hMed * 4) return false;
  if (line.items.length >= 3) return true;
  const s = line.items[0].s;
  if (line.w > line.h * 2.2) {
    // cursive word: lots of vertical direction changes
    let flips = 0, dir = 0;
    for (let i = 2; i < s.points.length; i += 2) {
      const dy = s.points[i][1] - s.points[i - 2][1];
      const d = Math.sign(dy);
      if (d && d !== dir) { flips++; dir = d; }
    }
    return flips >= 4;
  }
  return false;
}

// ------------------------------------------------------------------ neaten
// Returns Map(id -> new stroke) for the strokes it improved.
export function neatenStrokes(strokes) {
  const out = new Map();
  if (!strokes.length) return out;
  const { lines, hMed } = groupLines(strokes);
  for (const line of lines) {
    if (!looksLikeWriting(line, hMed)) continue;
    const ss = line.items.map((i) => i.s);
    const allPts = ss.flatMap((s) => s.points);
    if (allPts.length < 8) continue;

    // 1) baseline: robust fit through the lower edge of the ink, per column
    const binW = Math.max(hMed * 0.8, 6);
    const cols = new Map();
    for (const p of allPts) {
      const k = Math.floor((p[0] - line.x) / binW);
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(p[1]);
    }
    const samples = [];
    for (const [k, ys] of cols) samples.push([line.x + (k + 0.5) * binW, pct(ys, 0.8)]);
    let slope = 0;
    if (samples.length >= 3) {
      slope = fitSlope(samples);
      // refit without outliers (descenders)
      const icpt = meanY(samples) - slope * meanX(samples);
      const resid = samples.map(([x, y]) => Math.abs(y - (slope * x + icpt)));
      const lim = pct(resid, 0.7) * 1.5 + 0.5;
      const kept = samples.filter((_, i) => resid[i] <= lim);
      if (kept.length >= 3) slope = fitSlope(kept);
    }
    const angle = clamp(Math.atan(slope), -0.45, 0.45);
    const ox = line.x, oy = line.y + line.h;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const rot = (x, y) => [ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos];

    // 2) slant: average angle of long, mostly-vertical segments
    let sx = 0, sw = 0;
    for (const s of ss) {
      const p = s.points;
      for (let i = 3; i < p.length; i += 3) {
        const [ax, ay] = rot(p[i - 3][0], p[i - 3][1]), [bx, by] = rot(p[i][0], p[i][1]);
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < hMed * 0.18 || Math.abs(dy) < Math.abs(dx) * 1.4) continue;
        sx += (dx / dy) * len; sw += len;
      }
    }
    const shear = sw ? clamp(sx / sw, -0.6, 0.6) * 0.75 : 0;

    // baseline after rotation
    const rotatedLow = [];
    for (const p of allPts) rotatedLow.push(rot(p[0], p[1])[1]);
    const base = pct(rotatedLow, 0.8);

    // 3) words + height normalisation
    const words = [];
    for (const it of line.items) {
      const b = it.b;
      const w = words[words.length - 1];
      if (w && b.x < w.x2 + hMed * 0.55) { w.items.push(it); w.x2 = Math.max(w.x2, b.x + b.w); }
      else words.push({ items: [it], x1: b.x, x2: b.x + b.w });
    }
    const wordH = words.map((w) => {
      const ys = w.items.flatMap((i) => i.s.points.map((p) => rot(p[0], p[1])[1]));
      return Math.max(2, pct(ys, 0.85) - pct(ys, 0.15));
    });
    const target = median(wordH);
    const gaps = [];
    for (let i = 1; i < words.length; i++) gaps.push(words[i].x1 - words[i - 1].x2);
    const gapTarget = gaps.length ? clamp(median(gaps), hMed * 0.35, hMed * 1.4) : 0;

    let shiftX = 0;
    let prevRight = null;
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      const k = clamp(Math.pow(target / wordH[wi], 0.55), 0.8, 1.25);
      const left = w.x1;
      // even out the spacing between words a little
      if (prevRight !== null) {
        const g = w.x1 + shiftX - prevRight;
        shiftX += (gapTarget - g) * 0.45;
      }
      const tf = (x, y) => {
        let [rx, ry] = rot(x, y);
        rx = rx - (ry - base) * shear;            // de-slant around the baseline
        rx = left + (rx - left) * k;               // scale word about its baseline-left
        ry = base + (ry - base) * k;
        return [rx + shiftX, ry];
      };
      let right = -Infinity;
      for (const it of w.items) {
        const pts = smooth(it.s.points.map((p) => { const [x, y] = tf(p[0], p[1]); if (x > right) right = x; return [round2(x), round2(y), p[2]]; }));
        out.set(it.s.id, { ...it.s, points: pts, neat: 1 });
      }
      prevRight = right;
      shiftX += (w.x2 - w.x1) * (k - 1);
    }
  }
  return out;
}
function fitSlope(s) {
  const mx = meanX(s), my = meanY(s);
  let num = 0, den = 0;
  for (const [x, y] of s) { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); }
  return den ? num / den : 0;
}
const meanX = (s) => s.reduce((a, p) => a + p[0], 0) / s.length;
const meanY = (s) => s.reduce((a, p) => a + p[1], 0) / s.length;
function smooth(pts) {
  if (pts.length < 5) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    out.push([round2((a[0] + 2 * b[0] + c[0]) / 4), round2((a[1] + 2 * b[1] + c[1]) / 4), b[2]]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------ engine
export class Handwriting {
  constructor(board, getSettings) {
    this.board = board;
    this.getSettings = getSettings;
    this.pending = new Set();
    this.timer = null;
    board.on('inkAdded', (el) => this.onInk(el));
    board.on('inkStart', () => clearTimeout(this.timer));
    board.on('tool', () => this.flushSoon());
  }
  get mode() { return this.getSettings().handwritingMode || 'neaten'; }

  onInk(el) {
    if (this.mode === 'off' || el.tool !== 'pen') return;
    this.pending.add(el.id);
    clearTimeout(this.timer);
    const s = this.getSettings();
    this.timer = setTimeout(() => this.run(), this.mode === 'convert' ? s.convertDelay || 1600 : s.neatenDelay || 900);
  }
  flushSoon() { if (this.pending.size) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 150); } }

  takePending() {
    const ids = this.pending; this.pending = new Set();
    return this.board.elements.filter((e) => ids.has(e.id) && e.type === 'stroke');
  }

  async run() {
    const strokes = this.takePending();
    if (!strokes.length || this.board.mode) { if (strokes.length) strokes.forEach((s) => this.pending.add(s.id)); return; }
    if (this.mode === 'convert' && this.getSettings().hasAiKey) {
      const ok = await this.convert(strokes, { auto: true });
      if (ok) return;
    }
    this.neaten(strokes, { animate: true });
  }

  neaten(strokes, { animate = true, label = 'Neaten handwriting' } = {}) {
    const map = neatenStrokes(strokes);
    if (!map.size) return false;
    const board = this.board;
    if (!animate) { board.replace(map, label); return true; }
    const from = new Map(strokes.filter((s) => map.has(s.id)).map((s) => [s.id, s]));
    const t0 = performance.now(), D = 240;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / D);
      const e = 1 - Math.pow(1 - t, 3);
      for (const [id, a] of from) {
        const b = map.get(id);
        if (a.points.length !== b.points.length) continue;
        board.overrides.set(id, { ...a, points: a.points.map((p, i) => [p[0] + (b.points[i][0] - p[0]) * e, p[1] + (b.points[i][1] - p[1]) * e, p[2]]) });
      }
      board.requestRender();
      if (t < 1) requestAnimationFrame(step);
      else {
        board.overrides.clear();
        // only apply to strokes that still exist unchanged
        const live = new Map([...map].filter(([id]) => board.getById(id) === from.get(id)));
        board.replace(live, label);
      }
    };
    requestAnimationFrame(step);
    return true;
  }

  // Convert strokes to typed text with the AI model. Returns true on success.
  async convert(strokes, { auto = false } = {}) {
    const board = this.board;
    strokes = strokes.filter((s) => s.type === 'stroke' && s.tool !== 'highlighter');
    if (!strokes.length) return false;
    const { lines, hMed } = groupLines(strokes);
    const writing = auto ? lines.filter((l) => looksLikeWriting(l, hMed)) : lines;
    if (!writing.length) return false;
    const blocks = groupBlocks(writing, hMed);
    let any = false;
    await Promise.all(blocks.map(async (block) => {
      const ss = block.lines.flatMap((l) => l.items.map((i) => i.s));
      const rect = unionRect(ss.map((s) => bounds(s)));
      const busy = { ...rect };
      board.busy.push(busy); board.requestUi();
      try {
        const lineH = median(block.lines.map((l) => l.h)) || hMed;
        const scale = clamp(60 / lineH, 0.3, 4);
        const pad = 18 / scale;
        const r = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
        const s2 = Math.min(scale, 1568 / r.w, 1568 / r.h);
        const canvas = renderToCanvas(ss, r, s2, { background: '#ffffff', colorOverride: '#000000' });
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        const res = await window.inkAPI.ai.transcribe(base64);
        const text = (res.text || '').trim();
        if (!text) return;
        // abort if the ink changed while we waited
        if (!ss.every((s) => board.getById(s.id) === s)) return;
        any = true;
        this.placeText(text, ss, rect, lineH, block.lines.length);
      } catch (err) {
        if (!auto) toast(err.message || 'Could not convert handwriting', 'error', 4200);
        else this.lastError = err.message;
      } finally {
        board.busy.splice(board.busy.indexOf(busy), 1);
        board.requestUi();
      }
    }));
    if (auto && !any && this.lastError) { toast('AI: ' + this.lastError, 'error', 4200); this.lastError = null; }
    return any;
  }

  placeText(text, strokes, rect, lineH, nLines) {
    const board = this.board;
    const settings = this.getSettings();
    const hand = settings.convertFont !== 'print';
    const fs = Math.round(clamp(lineH * (hand ? 0.95 : 0.72), 12, 160));
    const html = text.split(/\n/).map((l) => '<div>' + (escapeHtml(l) || '<br>') + '</div>').join('');
    const ids = new Set(strokes.map((s) => s.id));

    // Continue an AI text box you were already writing into (same line or the next one).
    const prev = [...board.elements].reverse().find((e) => e.type === 'text' && e.ai && !e.sticky);
    if (prev && nLines === 1) {
      const pb = board.boundsOf(prev);
      const sameLine = rect.y < pb.y + pb.h && rect.y + rect.h > pb.y + pb.h - lineH * 1.4 && rect.x > pb.x && rect.x - (pb.x + pb.w) < lineH * 6;
      const nextLine = rect.y >= pb.y + pb.h - lineH * 0.6 && rect.y - (pb.y + pb.h) < lineH * 1.4 && Math.abs(rect.x - pb.x) < lineH * 4;
      if (sameLine || nextLine) {
        const joined = sameLine ? prev.html.replace(/<\/div>$/, ' ' + escapeHtml(text) + '</div>') : prev.html + html;
        const merged = { ...prev, html: joined, w: Math.max(prev.w, rect.x + rect.w - prev.x + fs * 2), ink: [...(prev.ink || []), ...strokes] };
        board.commit(board.elements.filter((e) => !ids.has(e.id)).map((e) => (e.id === prev.id ? merged : e)), { label: 'Convert handwriting' });
        return;
      }
    }
    const el = {
      id: uid(), type: 'text', ai: true,
      x: round2(rect.x - 4), y: round2(rect.y - fs * 0.25),
      w: round2(Math.max(rect.w * (hand ? 1.15 : 1.25) + fs * 2, fs * 6)), fs,
      html, font: hand ? 'hand' : 'sans', ink: strokes,
    };
    const next = [];
    let placed = false;
    for (const e of board.elements) {
      if (ids.has(e.id)) { if (!placed) { next.push(el); placed = true; } continue; }
      next.push(e);
    }
    if (!placed) next.push(el);
    board.commit(next, { label: 'Convert handwriting' });
  }

  // Put the original ink back for selected AI text boxes.
  revert(textEls) {
    const board = this.board;
    const ids = new Set(textEls.map((t) => t.id));
    const next = [];
    for (const e of board.elements) {
      if (ids.has(e.id) && e.ink) next.push(...e.ink);
      else next.push(e);
    }
    board.commit(next, { label: 'Revert to ink' });
  }
}

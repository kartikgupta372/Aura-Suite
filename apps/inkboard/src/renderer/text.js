// Word-style text boxes living on the whiteboard.
// Each text element is a real DOM node inside one transformed layer, so text
// stays crisp, selectable and spell-checked, and panning costs one CSS write.
import { uid, round2, sanitizeHtml } from './util.js';

const EMPTY = '<div><br></div>';

export function isEmptyHtml(html) {
  if (/<(img|hr|table)\b/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;|​|\s/g, '') === '';
}

export class TextLayer {
  constructor(board, layer) {
    this.board = board;
    this.layer = layer;
    this.nodes = new Map();
    this.heights = new Map();
    this.editingId = null;
    this.startHtml = '';
    this.createdEntry = null;
    this.ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const id = en.target.dataset.id;
        if (id) this.heights.set(id, en.target.offsetHeight);
      }
      this.board.requestUi();
    });
    this.bind();
  }

  heightOf(el) { return this.heights.get(el.id) ?? el.h ?? 40; }
  editingNode() { const n = this.editingId && this.nodes.get(this.editingId); return n ? n.firstChild : null; }
  isEditingTarget(t) { return !!(this.editingId && t && t.closest && t.closest('.tx.editing')); }
  nodeFromTarget(t) { const n = t && t.closest && t.closest('.tx'); return n ? n.dataset.id : null; }
  liveHtml(id) { return id === this.editingId ? this.editingNode().innerHTML : null; }

  // ------------------------------------------------------------ DOM sync
  sync(force = false) {
    const page = this.board.page;
    const seen = new Set();
    if (page) {
      let z = 1;
      for (const el of page.elements) {
        if (el.type !== 'text') continue;
        seen.add(el.id);
        let n = this.nodes.get(el.id);
        if (!n) { n = this.makeNode(el); this.nodes.set(el.id, n); this.layer.appendChild(n); force = true; }
        if (force || n.__el !== el) this.apply(n, el);
        n.style.zIndex = z++;
      }
    }
    for (const [id, n] of this.nodes) {
      if (!seen.has(id)) {
        if (id === this.editingId) this.editingId = null;
        this.ro.unobserve(n); n.remove(); this.nodes.delete(id); this.heights.delete(id);
      }
    }
  }
  makeNode(el) {
    const n = document.createElement('div');
    n.className = 'tx';
    n.dataset.id = el.id;
    const c = document.createElement('div');
    c.className = 'tx-content';
    c.spellcheck = true;
    n.appendChild(c);
    this.ro.observe(n);
    return n;
  }
  apply(n, el) {
    n.style.left = el.x + 'px';
    n.style.top = el.y + 'px';
    n.style.width = el.w + 'px';
    n.style.fontSize = (el.fs || 16) + 'px';
    n.style.color = el.color && !el.sticky ? el.color : '';
    n.classList.toggle('sticky', !!el.sticky);
    n.classList.toggle('ai', !!el.ai);
    if (el.sticky) n.style.setProperty('--sticky', el.bg || '#fff3a3'); else n.style.removeProperty('--sticky');
    n.dataset.font = el.font || 'sans';
    if (el.id !== this.editingId && n.__html !== el.html) { n.firstChild.innerHTML = el.html; n.__html = el.html; }
    n.__el = el;
  }
  previewTransform(ids, fn) {
    for (const id of ids) {
      const n = this.nodes.get(id); if (!n || !n.__el) continue;
      const t = fn(n.__el);
      n.style.left = t.x + 'px'; n.style.top = t.y + 'px'; n.style.width = t.w + 'px';
    }
  }

  // ------------------------------------------------------------ editing
  createAt(x, y, opts = {}) {
    const z = this.board.cam.zoom;
    const fs = Math.round(clampFs((opts.fs || 16) / z));
    const el = {
      id: uid(), type: 'text', x: round2(x), y: round2(y),
      w: round2((opts.sticky ? 230 : 380) / z), fs,
      html: opts.html || EMPTY,
      ...(opts.sticky ? { sticky: true, bg: opts.bg } : {}),
      ...(opts.font ? { font: opts.font } : {}),
    };
    this.endEdit();
    const entry = this.board.add([el], opts.sticky ? 'Sticky note' : 'Text');
    this.edit(el.id, { createdEntry: entry, end: true });
    return el;
  }

  edit(id, at = {}) {
    if (this.editingId === id) return;
    this.endEdit();
    const n = this.nodes.get(id);
    const el = this.board.getById(id);
    if (!n || !el) return;
    const c = n.firstChild;
    this.editingId = id;
    this.startHtml = el.html;
    this.createdEntry = at.createdEntry || null;
    c.contentEditable = 'true';
    n.classList.add('editing');
    this.board.clearSelection();
    c.focus({ preventScroll: true });
    try {
      document.execCommand('defaultParagraphSeparator', false, 'div');
      document.execCommand('styleWithCSS', false, false);
    } catch {}
    const sel = window.getSelection();
    let placed = false;
    if (at.clientX != null) {
      const r = document.caretRangeFromPoint(at.clientX, at.clientY);
      if (r && c.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); placed = true; }
    }
    if (!placed) {
      const r = document.createRange();
      r.selectNodeContents(c);
      if (!at.selectAll) r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
    this.board.emit('editstart', id);
  }

  endEdit() {
    const id = this.editingId;
    if (!id) return;
    const n = this.nodes.get(id);
    this.editingId = null;
    if (!n) return;
    const c = n.firstChild;
    c.contentEditable = 'false';
    n.classList.remove('editing');
    const sel = window.getSelection();
    if (sel.rangeCount && c.contains(sel.anchorNode)) sel.removeAllRanges();
    const html = tidy(c.innerHTML);
    const board = this.board;
    const el = board.getById(id);
    const created = this.createdEntry;
    this.createdEntry = null;
    board.emit('editend', id);
    if (!el) return;
    const h = board.history;
    const createdIsLast = created && h.undo[h.undo.length - 1] === created;
    if (isEmptyHtml(html)) {
      if (createdIsLast) { board.dropHistoryEntry(created); board.page.elements = created.before; board.afterElementsChanged(true); }
      else board.removeIds([id], 'Delete text');
      return;
    }
    n.__html = html;
    if (html === this.startHtml) return;
    const next = { ...el, html, h: n.offsetHeight };
    if (createdIsLast) {
      // Creating + typing is one undo step.
      board.page.elements = board.page.elements.map((e) => (e.id === id ? next : e));
      created.after = board.page.elements;
      board.afterElementsChanged();
    } else {
      board.replace(new Map([[id, next]]), 'Edit text');
    }
  }

  // ------------------------------------------------------------ behaviour
  bind() {
    const L = this.layer;
    // Checklist boxes are clickable whether or not the box is being edited.
    L.addEventListener('pointerdown', (e) => {
      const li = e.target.closest && e.target.closest('ul.checklist > li');
      if (!li) return;
      const r = li.getBoundingClientRect();
      const scale = r.width / li.offsetWidth || 1;
      if (e.clientX - r.left > 24 * scale) return;
      e.preventDefault(); e.stopPropagation();
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
      const node = li.closest('.tx');
      if (node.dataset.id !== this.editingId) {
        const el = this.board.getById(node.dataset.id);
        const html = node.firstChild.innerHTML;
        node.__html = html;
        this.board.replace(new Map([[el.id, { ...el, html }]]), 'Check item');
      } else {
        this.board.emit('textinput');
      }
    }, true);

    L.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const editing = this.isEditingTarget(a);
      if (!editing || e.ctrlKey || e.metaKey) { e.preventDefault(); window.inkAPI && window.inkAPI.app.openExternal(a.href); }
    });

    L.addEventListener('input', (e) => {
      if (!this.isEditingTarget(e.target)) return;
      if (e.inputType === 'insertText' && e.data) this.autoFormat(e.data);
      this.board.emit('textinput');
    });

    L.addEventListener('keydown', (e) => {
      if (!this.isEditingTarget(e.target)) return;
      this.onKey(e);
    });

    L.addEventListener('paste', (e) => {
      if (!this.isEditingTarget(e.target)) return;
      const dt = e.clipboardData;
      const file = [...(dt.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        const r = new FileReader();
        r.onload = () => document.execCommand('insertHTML', false, `<img src="${r.result}">`);
        r.readAsDataURL(file);
        return;
      }
      const html = dt.getData('text/html');
      if (html && !this.plainPaste) {
        e.preventDefault();
        document.execCommand('insertHTML', false, sanitizeHtml(html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, '')));
      } else if (this.plainPaste) {
        e.preventDefault();
        document.execCommand('insertText', false, dt.getData('text/plain'));
      }
      this.plainPaste = false;
    });
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const exec = (cmd, val) => { e.preventDefault(); document.execCommand(cmd, false, val); this.board.emit('textinput'); };
    if (k === 'Escape') {
      e.preventDefault();
      const id = this.editingId;
      this.endEdit();
      if (this.board.getById(id)) { this.board.setTool('select'); this.board.setSelection([id]); }
      return;
    }
    if (mod && e.shiftKey && (k === 'V' || k === 'v')) { this.plainPaste = true; return; }
    if (k === 'Tab') {
      e.preventDefault();
      const cell = closestIn(this.editingNode(), 'td,th');
      if (cell) return this.tableTab(cell, e.shiftKey);
      if (closestIn(this.editingNode(), 'li')) return exec(e.shiftKey ? 'outdent' : 'indent');
      if (!e.shiftKey) document.execCommand('insertText', false, ' ');
      return;
    }
    if (k === 'Enter' && !e.shiftKey) {
      // Enter on an empty checklist / list item leaves the list (Word behaviour).
      const li = closestIn(this.editingNode(), 'li');
      if (li && li.textContent.replace(/\u200b/g, '').trim() === '' && !li.querySelector('img')) {
        e.preventDefault();
        if (li.parentElement.closest('li')) document.execCommand('outdent');
        else exitList(li);
        this.board.emit('textinput');
        return;
      }
    }
    if (!mod) return;
    const K = k.toLowerCase();
    if (e.shiftKey && (k === '*' || K === '8')) return exec('insertUnorderedList');
    if (e.shiftKey && (k === '&' || K === '7')) return exec('insertOrderedList');
    if (e.shiftKey && (k === '(' || K === '9')) { e.preventDefault(); toggleChecklist(); this.board.emit('textinput'); return; }
    if (e.shiftKey && K === 'x') return exec('strikeThrough');
    if (e.altKey && ['1', '2', '3'].includes(K)) return exec('formatBlock', 'h' + K);
    if (e.altKey && K === '0') return exec('formatBlock', 'div');
    if (K === 'e') return exec('justifyCenter');
    if (K === 'l' && !e.shiftKey) return exec('justifyLeft');
    if (K === 'r') return exec('justifyRight');
    if (K === 'j') return exec('justifyFull');
    if (k === '\\' || k === ' ') return exec('removeFormat');
    if (k === '.' && e.shiftKey || k === '>') { e.preventDefault(); this.board.emit('fontstep', 1); return; }
    if (k === ',' && e.shiftKey || k === '<') { e.preventDefault(); this.board.emit('fontstep', -1); return; }
    if (k === ']') { e.preventDefault(); this.board.emit('fontstep', 1); return; }
    if (k === '[') { e.preventDefault(); this.board.emit('fontstep', -1); return; }
    if (K === 'k') { e.preventDefault(); this.board.emit('linkrequest'); return; }
    if (k === ';') { e.preventDefault(); document.execCommand('insertText', false, new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })); return; }
    if (k === '=' && !e.shiftKey) return exec('subscript');
    if ((k === '+' || k === '=') && e.shiftKey) return exec('superscript');
  }

  // Markdown-style shortcuts while typing: "# ", "- ", "1. ", "[] ", "> ", **bold**, `code`…
  autoFormat(ch) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const root = this.editingNode();
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) return;
    const before = node.data.slice(0, range.startOffset);
    const block = blockOf(node, root);
    const atStart = block && block !== root ? textBefore(block, node) === '' : isLineStart(node, root);

    const replaceBefore = (n) => {
      const r = document.createRange();
      r.setStart(node, range.startOffset - n); r.setEnd(node, range.startOffset);
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('delete');
    };

    if (ch === ' ' && atStart) {
      const m = before.match(/^(#{1,3}|[-*•]|1[.)]|\[ ?\]|\[x\]|>|---)\s$/);
      if (m && !closestIn(root, 'li')) {
        const t = m[1];
        replaceBefore(before.length);
        if (t[0] === '#') document.execCommand('formatBlock', false, 'h' + t.length);
        else if (t === '-' || t === '*' || t === '•') makeList(root, 'UL');
        else if (t.startsWith('1')) makeList(root, 'OL');
        else if (t[0] === '[') { const li = makeList(root, 'UL', 'checklist'); if (li && t === '[x]') li.dataset.checked = 'true'; }
        else if (t === '>') document.execCommand('formatBlock', false, 'blockquote');
        else if (t === '---') document.execCommand('insertHorizontalRule');
        return;
      }
    }
    // Inline marks: **bold**, *italic*, ~~strike~~, `code`
    const inline = [
      [/\*\*([^*\n]+)\*\*$/, 'b', 4], [/__([^_\n]+)__$/, 'b', 4], [/(?:^|[^*])\*([^*\s][^*\n]*)\*$/, 'i', 2],
      [/~~([^~\n]+)~~$/, 's', 4], [/`([^`\n]+)`$/, 'code', 2],
    ];
    for (const [re, tag, extra] of inline) {
      const m = before.match(re);
      if (!m) continue;
      replaceBefore(m[1].length + extra);
      document.execCommand('insertHTML', false, `<${tag}>${escapeText(m[1])}</${tag}>​`);
      return;
    }
    // Typographic helpers
    const subs = [['->', '→'], ['<-', '←'], ['=>', '⇒'], ['<=', '⇐'], ['!=', '≠'], ['+-', '±'], ['(c)', '©'], ['...', '…']];
    for (const [from, to] of subs) {
      if (before.endsWith(from)) { replaceBefore(from.length); document.execCommand('insertText', false, to); return; }
    }
    if (ch === ' ' && before.endsWith('-- ')) { replaceBefore(3); document.execCommand('insertText', false, '— '); }
  }

  tableTab(cell, back) {
    const cells = [...cell.closest('table').querySelectorAll('td,th')];
    let i = cells.indexOf(cell) + (back ? -1 : 1);
    if (i >= cells.length) { tableOp('row-below'); i = cells.length; }
    const all = [...cell.closest('table').querySelectorAll('td,th')];
    const target = all[Math.max(0, i)];
    if (!target) return;
    const r = document.createRange();
    r.selectNodeContents(target);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
}

// ------------------------------------------------------------------ helpers
function clampFs(v) { return Math.max(4, Math.min(400, v)); }
function escapeText(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

export function closestIn(root, selector) {
  const sel = window.getSelection();
  if (!root || !sel.rangeCount) return null;
  let n = sel.anchorNode;
  if (n && n.nodeType === 3) n = n.parentElement;
  const hit = n && n.closest ? n.closest(selector) : null;
  return hit && root.contains(hit) ? hit : null;
}
function blockOf(node, root) {
  let n = node.nodeType === 3 ? node.parentElement : node;
  while (n && n !== root && !/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|TD|TH)$/.test(n.tagName)) n = n.parentElement;
  return n;
}
function textBefore(block, node) {
  const r = document.createRange();
  r.setStart(block, 0); r.setEnd(node, 0);
  return r.toString().replace(/​/g, '');
}
// For text sitting directly in the editor root: is this text node the first thing on its line?
function isLineStart(node, root) {
  let n = node;
  while (n && n !== root) {
    const prev = n.previousSibling;
    if (prev) {
      if (prev.nodeType === 3 && prev.data.replace(/\u200b/g, '') === '') { n = prev; continue; }
      return prev.nodeType === 1 && /^(BR|DIV|P|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR)$/.test(prev.tagName);
    }
    n = n.parentNode;
  }
  return true;
}
function tidy(html) {
  return html.replace(/​/g, '').replace(/<span>([^<]*)<\/span>/g, '$1');
}

export function toggleChecklist() {
  const root = document.querySelector('.tx.editing .tx-content');
  const list = closestIn(root, 'ul,ol');
  if (list && list.classList.contains('checklist')) { document.execCommand('insertUnorderedList'); return; }
  if (list && list.tagName === 'UL') { list.classList.add('checklist'); return; }
  if (list && list.tagName === 'OL') {
    const ul = document.createElement('ul'); ul.className = 'checklist';
    while (list.firstChild) ul.appendChild(list.firstChild);
    list.replaceWith(ul);
    return;
  }
  if (!makeList(root, 'UL', 'checklist')) { document.execCommand('insertUnorderedList'); const l = closestIn(root, 'ul'); if (l) l.classList.add('checklist'); }
}

const BLOCK_RE = /^(DIV|P|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR|BR)$/;
function caretAt(node, offset) {
  const r = document.createRange(); r.setStart(node, offset); r.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
// Turn the caret's line into a brand-new list (never merges into a neighbouring list).
export function makeList(root, tag, cls) {
  const sel = window.getSelection();
  if (!root || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n === root) n = root.childNodes[sel.getRangeAt(0).startOffset] || root.lastChild;
  const list = document.createElement(tag);
  if (cls) list.className = cls;
  const li = document.createElement('li');
  list.appendChild(li);
  let block = n && (n.nodeType === 3 ? n.parentElement : n);
  while (block && block !== root && block.parentNode !== root) block = block.parentNode;
  if (!block || block === root) {
    root.appendChild(list);
  } else if (block.nodeType === 1 && /^(DIV|P)$/.test(block.tagName)) {
    while (block.firstChild) li.appendChild(block.firstChild);
    block.replaceWith(list);
  } else if (block.nodeType === 1 && BLOCK_RE.test(block.tagName) && block.tagName !== 'BR') {
    return null;
  } else {
    // inline content sitting directly in the root: gather the whole line
    let first = block, last = block;
    while (first.previousSibling && !(first.previousSibling.nodeType === 1 && BLOCK_RE.test(first.previousSibling.tagName))) first = first.previousSibling;
    while (last.nextSibling && !(last.nextSibling.nodeType === 1 && BLOCK_RE.test(last.nextSibling.tagName))) last = last.nextSibling;
    const trailingBr = last.nextSibling && last.nextSibling.nodeName === 'BR' ? last.nextSibling : null;
    if (block.nodeName === 'BR') { first = last = block; }
    root.insertBefore(list, first);
    let cur = first;
    while (cur) { const next = cur === last ? null : cur.nextSibling; li.appendChild(cur); cur = next; }
    if (trailingBr) trailingBr.remove();
  }
  [...li.querySelectorAll(':scope > br')].forEach((b) => { if (li.textContent.trim()) b.remove(); });
  if (!li.firstChild || (li.textContent.replace(/\u200b/g, '') === '' && !li.querySelector('br,img'))) { li.textContent = ''; li.appendChild(document.createElement('br')); }
  caretAt(li, 0);
  return li;
}
// Leave a list from an empty item: the item becomes a normal paragraph after the list.
function exitList(li) {
  const list = li.parentElement;
  const div = document.createElement('div');
  div.appendChild(document.createElement('br'));
  const after = [];
  for (let s = li.nextSibling; s; s = s.nextSibling) after.push(s);
  li.remove();
  if (after.length) {
    const tail = list.cloneNode(false);
    after.forEach((x) => tail.appendChild(x));
    list.after(tail);
  }
  list.after(div);
  if (!list.children.length) list.remove();
  caretAt(div, 0);
}

export function tableOp(op) {
  const root = document.querySelector('.tx.editing .tx-content');
  const cell = closestIn(root, 'td,th');
  if (!cell) return false;
  const row = cell.parentElement, table = cell.closest('table');
  const col = [...row.children].indexOf(cell);
  const newCell = () => { const td = document.createElement('td'); td.innerHTML = '<br>'; return td; };
  if (op === 'row-below' || op === 'row-above') {
    const tr = document.createElement('tr');
    for (let i = 0; i < row.children.length; i++) tr.appendChild(newCell());
    op === 'row-below' ? row.after(tr) : row.before(tr);
  } else if (op === 'col-right' || op === 'col-left') {
    for (const tr of table.querySelectorAll('tr')) {
      const ref = tr.children[col];
      if (ref) op === 'col-right' ? ref.after(newCell()) : ref.before(newCell());
    }
  } else if (op === 'del-row') {
    if (table.querySelectorAll('tr').length <= 1) table.remove(); else row.remove();
  } else if (op === 'del-col') {
    if (row.children.length <= 1) table.remove();
    else for (const tr of table.querySelectorAll('tr')) tr.children[col] && tr.children[col].remove();
  } else if (op === 'del-table') {
    table.remove();
  }
  return true;
}

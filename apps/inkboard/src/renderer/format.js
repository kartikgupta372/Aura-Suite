// The Word-style ribbon that appears while a text box is being edited.
import { toggleChecklist, tableOp, closestIn } from './text.js';

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];
export const TEXT_COLORS = ['#1f2937', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#6b7280'];
export const HILITE_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74', '#c4b5fd', 'transparent'];

export class FormatBar {
  constructor(el, board, app) {
    this.el = el;
    this.board = board;
    this.app = app;
    this.savedRange = null;
    this.fore = '#dc2626';
    this.hilite = '#fde047';
    this.bind();
  }
  get editor() { return this.board.text.editingNode(); }

  show() { this.el.classList.remove('hidden'); this.refresh(); }
  hide() { this.el.classList.add('hidden'); this.el.querySelector('#linkBox').classList.add('hidden'); }

  saveRange() {
    const s = window.getSelection();
    if (s.rangeCount && this.editor && this.editor.contains(s.anchorNode)) this.savedRange = s.getRangeAt(0).cloneRange();
  }
  restoreRange() {
    if (!this.editor) return;
    this.editor.focus({ preventScroll: true });
    if (this.savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(this.savedRange); }
  }

  bind() {
    const el = this.el;
    // Buttons must not steal focus from the text box.
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
      if (e.target.closest('select,input')) this.saveRange();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cmd]');
      if (!b || !this.editor) return;
      this.run(b.dataset.cmd, b);
    });
    el.querySelector('#fmtBlock').addEventListener('change', (e) => { this.restoreRange(); document.execCommand('formatBlock', false, e.target.value); this.changed(); });
    el.querySelector('#fmtFont').addEventListener('change', (e) => { this.restoreRange(); this.setFont(e.target.value); this.changed(); });
    const size = el.querySelector('#fmtSize');
    size.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.restoreRange(); this.setSize(parseFloat(size.value)); }
      if (e.key === 'Escape') { this.restoreRange(); }
      e.stopPropagation();
    });
    size.addEventListener('focus', () => size.select());
    const link = el.querySelector('#linkInput');
    link.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        let url = link.value.trim();
        this.restoreRange();
        if (url) {
          if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
          const sel = window.getSelection();
          if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/[<>&]/g, '')}</a>`);
          else document.execCommand('createLink', false, url);
        } else document.execCommand('unlink');
        el.querySelector('#linkBox').classList.add('hidden');
        this.changed();
      }
      if (e.key === 'Escape') { el.querySelector('#linkBox').classList.add('hidden'); this.restoreRange(); }
    });
    document.addEventListener('selectionchange', () => { if (this.editor) this.refresh(); });
    this.board.on('textinput', () => this.refresh());
    this.board.on('fontstep', (d) => this.stepSize(d));
    this.board.on('linkrequest', () => this.run('link'));
  }

  changed() { this.board.emit('textinput'); this.refresh(); }

  run(cmd, btn) {
    const ex = (c, v) => document.execCommand(c, false, v);
    switch (cmd) {
      case 'done': this.board.text.endEdit(); return;
      case 'size+': return this.stepSize(1);
      case 'size-': return this.stepSize(-1);
      case 'checklist': toggleChecklist(); break;
      case 'link': {
        this.saveRange();
        const box = this.el.querySelector('#linkBox');
        box.classList.remove('hidden');
        const a = closestIn(this.editor, 'a');
        const input = box.querySelector('input');
        input.value = a ? a.getAttribute('href') : '';
        input.focus();
        return;
      }
      case 'table': {
        const rows = 3, cols = 3;
        const row = '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
        ex('insertHTML', `<table><tbody>${row.repeat(rows)}</tbody></table><div><br></div>`);
        break;
      }
      case 'row-below': case 'col-right': case 'del-row': case 'del-col': tableOp(cmd); break;
      case 'foreColor': case 'hiliteColor': return this.colorMenu(cmd, btn);
      case 'removeFormat': ex('removeFormat'); ex('formatBlock', 'div'); break;
      default: ex(cmd);
    }
    this.changed();
  }

  colorMenu(cmd, btn) {
    this.saveRange();
    const colors = cmd === 'foreColor' ? TEXT_COLORS : HILITE_COLORS;
    const r = btn.getBoundingClientRect();
    this.app.swatchMenu(r.left, r.bottom + 6, colors, (c) => {
      this.restoreRange();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, c);
      document.execCommand('styleWithCSS', false, false);
      if (cmd === 'foreColor') { this.fore = c; this.el.querySelector('#foreBar').style.background = c; }
      else { this.hilite = c; this.el.querySelector('#hiliteBar').style.background = c === 'transparent' ? 'none' : c; }
      this.changed();
    }, true);
  }

  currentSize() {
    const s = window.getSelection();
    let n = s.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    if (!n || !this.editor || !this.editor.contains(n)) n = this.editor;
    return n ? parseFloat(getComputedStyle(n).fontSize) : 16;
  }
  stepSize(d) {
    const cur = this.currentSize();
    let next = d > 0 ? SIZES.find((s) => s > cur + 0.5) : [...SIZES].reverse().find((s) => s < cur - 0.5);
    if (!next) next = d > 0 ? cur * 1.25 : cur / 1.25;
    this.setSize(next);
  }
  setSize(px) {
    if (!px || !this.editor) return;
    px = Math.max(4, Math.min(400, Math.round(px)));
    const sel = window.getSelection();
    if (sel.isCollapsed) {
      // No selection: size the whole box (Word's "resize the paragraph" feel).
      const id = this.board.text.editingId;
      const node = this.board.text.nodes.get(id);
      const el = this.board.getById(id);
      if (el && node) {
        node.style.fontSize = px + 'px';
        this.board.page.elements = this.board.page.elements.map((e) => (e.id === id ? { ...e, fs: px } : e));
        node.__el = this.board.getById(id);
        this.board.emit('change');
      }
    } else {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      for (const f of this.editor.querySelectorAll('font[size="7"]')) {
        const span = document.createElement('span');
        span.style.fontSize = px + 'px';
        while (f.firstChild) span.appendChild(f.firstChild);
        span.querySelectorAll('[style*="font-size"]').forEach((c) => c.style.removeProperty('font-size'));
        f.replaceWith(span);
      }
      this.board.emit('textinput');
    }
    this.refresh();
  }
  setFont(font) {
    const sel = window.getSelection();
    const id = this.board.text.editingId;
    if (sel.isCollapsed || (this.editor && sel.toString() === this.editor.innerText)) {
      const node = this.board.text.nodes.get(id);
      node.dataset.font = font;
      this.board.page.elements = this.board.page.elements.map((e) => (e.id === id ? { ...e, font } : e));
      node.__el = this.board.getById(id);
      this.board.emit('change');
    } else {
      const fam = { sans: 'Segoe UI, system-ui, sans-serif', serif: 'Georgia, serif', mono: 'Consolas, monospace', hand: 'Caveat, cursive', print: 'Patrick Hand, cursive' }[font];
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('fontName', false, fam);
      document.execCommand('styleWithCSS', false, false);
    }
  }

  refresh() {
    const ed = this.editor;
    if (!ed) return;
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    for (const b of this.el.querySelectorAll('button[data-cmd]')) {
      const c = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].includes(c)) b.classList.toggle('on', q(c));
    }
    const inCheck = !!closestIn(ed, 'ul.checklist');
    this.el.querySelector('[data-cmd="checklist"]').classList.toggle('on', inCheck);
    if (inCheck) this.el.querySelector('[data-cmd="insertUnorderedList"]').classList.remove('on');
    let block = 'div';
    try { block = (document.queryCommandValue('formatBlock') || 'div').toLowerCase(); } catch {}
    const bs = this.el.querySelector('#fmtBlock');
    bs.value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(block) ? block : 'div';
    const id = this.board.text.editingId;
    const node = this.board.text.nodes.get(id);
    if (node) this.el.querySelector('#fmtFont').value = node.dataset.font || 'sans';
    const sizeInput = this.el.querySelector('#fmtSize');
    if (document.activeElement !== sizeInput) sizeInput.value = Math.round(this.currentSize());
    this.el.querySelector('#tableOps').classList.toggle('hidden', !closestIn(ed, 'td,th'));
    const words = (ed.innerText.match(/\S+/g) || []).length;
    const sel = window.getSelection();
    const selWords = sel && !sel.isCollapsed && ed.contains(sel.anchorNode) ? (sel.toString().match(/\S+/g) || []).length : 0;
    this.el.querySelector('#fmtWords').textContent = selWords ? `${selWords} of ${words} words` : `${words} word${words === 1 ? '' : 's'}`;
  }
}

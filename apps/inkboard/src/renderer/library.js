// Sidebar: the library folder on disk, shown as folders and notebooks.
import { toast } from './util.js';

const api = () => window.inkAPI;

export class Library {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.tree = null;
    this.expanded = new Set(JSON.parse(localStorage.getItem('ink.expanded') || '[]'));
    this.selectedFolder = null;
    this.filter = '';
    this.list = el.querySelector('#tree');
    this.bind();
  }

  async refresh() {
    try {
      this.tree = await api().lib.tree();
      if (!this.expanded.size) for (const c of this.tree.children) if (c.type === 'folder') this.expanded.add(c.path);
      this.render();
    } catch (e) { toast('Could not read library: ' + e.message, 'error'); }
  }

  saveExpanded() { localStorage.setItem('ink.expanded', JSON.stringify([...this.expanded])); }
  get targetFolder() {
    const active = this.app.activePath();
    return this.selectedFolder || (active ? parentDir(active) : null) || (this.tree && this.tree.root);
  }

  render() {
    if (!this.tree) return;
    if (this.renaming) { this.renderPending = true; return; }
    const rootName = this.tree.root.split(/[\\/]/).pop();
    this.el.querySelector('#libRootName').textContent = rootName;
    this.el.querySelector('#libRootName').title = this.tree.root;
    const frag = document.createDocumentFragment();
    const q = this.filter.toLowerCase();
    const match = (n) => !q || n.name.toLowerCase().includes(q) || (n.children || []).some(match);
    const walk = (nodes, depth, parent) => {
      for (const n of nodes) {
        if (!match(n)) continue;
        const row = document.createElement('div');
        row.className = 'tree-row ' + n.type;
        row.style.paddingLeft = 10 + depth * 14 + 'px';
        row.dataset.path = n.path;
        row.dataset.type = n.type;
        row.draggable = true;
        const open = this.expanded.has(n.path) || !!q;
        if (n.type === 'folder') {
          row.innerHTML = `<svg class="chev ${open ? 'open' : ''}"><use href="#i-chev"/></svg><svg class="ico"><use href="#i-folder"/></svg><span class="name"></span>`;
          if (this.selectedFolder === n.path) row.classList.add('sel-folder');
        } else {
          row.innerHTML = `<span class="chev-pad"></span><svg class="ico"><use href="#i-notebook"/></svg><span class="name"></span>`;
          if (this.app.isOpen(n.path)) row.classList.add('is-open');
          if (this.app.activePath() === n.path) row.classList.add('active');
        }
        row.querySelector('.name').textContent = n.name;
        row.title = n.path;
        frag.appendChild(row);
        if (n.type === 'folder' && open) {
          if (n.children.length) walk(n.children, depth + 1, n);
          else if (!q) {
            const empty = document.createElement('div');
            empty.className = 'tree-empty';
            empty.style.paddingLeft = 10 + (depth + 1) * 14 + 22 + 'px';
            empty.textContent = 'Empty folder';
            frag.appendChild(empty);
          }
        }
      }
    };
    walk(this.tree.children, 0, null);
    this.list.replaceChildren(frag);
    if (!this.list.children.length) {
      const d = document.createElement('div');
      d.className = 'tree-empty center';
      d.textContent = q ? 'No matches' : 'Your library is empty. Create a notebook to begin.';
      this.list.appendChild(d);
    }
  }

  find(p, nodes = this.tree ? this.tree.children : []) {
    for (const n of nodes) {
      if (n.path === p) return n;
      if (n.children) { const f = this.find(p, n.children); if (f) return f; }
    }
    return null;
  }

  bind() {
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('.tree-row'); if (!row) return;
      const p = row.dataset.path;
      if (row.dataset.type === 'folder') {
        this.expanded.has(p) ? this.expanded.delete(p) : this.expanded.add(p);
        this.selectedFolder = p;
        this.saveExpanded();
        this.render();
      } else {
        this.selectedFolder = parentDir(p);
        this.app.openFile(p);
      }
    });
    this.list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.tree-row');
      if (row && row.dataset.type === 'notebook') return;
      if (!row) this.selectedFolder = null;
    });
    this.list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.tree-row');
      this.contextMenu(e.clientX, e.clientY, row ? row.dataset.path : null, row ? row.dataset.type : 'root');
    });
    // drag & drop to move between folders
    this.list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.tree-row'); if (!row) return;
      e.dataTransfer.setData('text/ink-path', row.dataset.path);
      e.dataTransfer.effectAllowed = 'move';
    });
    this.list.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/ink-path')) return;
      e.preventDefault();
      this.list.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'));
      const row = e.target.closest('.tree-row.folder');
      (row || this.list).classList.add('drop');
    });
    this.list.addEventListener('dragleave', () => this.list.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop')));
    this.list.addEventListener('drop', async (e) => {
      const src = e.dataTransfer.getData('text/ink-path');
      this.list.classList.remove('drop');
      this.list.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'));
      if (!src) return;
      e.preventDefault();
      const row = e.target.closest('.tree-row.folder');
      const dest = row ? row.dataset.path : this.tree.root;
      if (parentDir(src) === dest) return;
      try {
        await this.app.flushAll();
        const np = await api().lib.move(src, dest);
        this.app.pathMoved(src, np);
        this.expanded.add(dest);
        await this.refresh();
      } catch (err) { toast(err.message, 'error'); }
    });

    this.el.querySelector('#newNotebookBtn').addEventListener('click', () => this.newNotebook());
    this.el.querySelector('#newFolderBtn').addEventListener('click', () => this.newFolder());
    this.el.querySelector('#libMenuBtn').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.contextMenu(r.left, r.bottom + 4, null, 'root');
    });
    const search = this.el.querySelector('#libSearch');
    search.addEventListener('input', () => { this.filter = search.value.trim(); this.render(); });
  }

  async newNotebook(parent = this.targetFolder) {
    try {
      const p = await api().lib.createNotebook(parent, 'Untitled notebook');
      if (parent) this.expanded.add(parent);
      await this.refresh();
      await this.app.openFile(p);
      this.startRename(p);
    } catch (e) { toast(e.message, 'error'); }
  }
  async newFolder(parent = this.targetFolder) {
    try {
      const p = await api().lib.createFolder(parent, 'New folder');
      if (parent) this.expanded.add(parent);
      this.expanded.add(p);
      this.selectedFolder = p;
      await this.refresh();
      this.startRename(p);
    } catch (e) { toast(e.message, 'error'); }
  }

  startRename(p) {
    const row = [...this.list.querySelectorAll('.tree-row')].find((r) => r.dataset.path === p);
    if (!row) return;
    const name = row.querySelector('.name');
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = name.textContent;
    name.replaceWith(input);
    input.focus(); input.select();
    this.renaming = true;
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      this.renaming = false;
      const v = input.value.trim();
      if (commit && v && v !== name.textContent) {
        try {
          await this.app.flushAll();
          const np = await api().lib.rename(p, v);
          this.app.pathMoved(p, np);
          if (this.selectedFolder === p) this.selectedFolder = np;
          if (this.expanded.has(p)) { this.expanded.delete(p); this.expanded.add(np); this.saveExpanded(); }
        } catch (e) { toast(e.message, 'error'); }
      }
      await this.refresh();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    input.addEventListener('blur', () => finish(true));
  }

  contextMenu(x, y, p, type) {
    const items = [];
    const folder = type === 'folder' ? p : type === 'notebook' ? parentDir(p) : this.tree && this.tree.root;
    if (type === 'notebook') {
      items.push({ label: 'Open', action: () => this.app.openFile(p) });
      items.push({ label: 'Rename', action: () => this.startRename(p) });
      items.push({ label: 'Duplicate', action: async () => { await this.app.flushAll(); await api().lib.duplicate(p); this.refresh(); } });
      items.push({ label: 'Show in folder', action: () => api().lib.reveal(p) });
      items.push('-');
      items.push({ label: 'Move to Recycle Bin', danger: true, action: () => this.remove(p, 'notebook') });
    } else {
      items.push({ label: 'New notebook here', action: () => this.newNotebook(folder) });
      items.push({ label: 'New folder here', action: () => this.newFolder(folder) });
      if (type === 'folder') {
        items.push('-');
        items.push({ label: 'Rename', action: () => this.startRename(p) });
        items.push({ label: 'Show in folder', action: () => api().lib.reveal(p) });
        items.push('-');
        items.push({ label: 'Move to Recycle Bin', danger: true, action: () => this.remove(p, 'folder') });
      } else {
        items.push('-');
        items.push({ label: 'Open notebook from anywhere…', action: () => this.app.openDialog() });
        items.push({ label: 'Show library in folder', action: () => api().lib.reveal(this.tree.root) });
        items.push({ label: 'Change library folder…', action: () => this.app.chooseLibrary() });
      }
    }
    this.app.menu(x, y, items);
  }

  async remove(p, type) {
    const n = this.find(p);
    const ok = await this.app.confirm(`Move ${type === 'folder' ? 'folder' : 'notebook'} “${n ? n.name : p}” to the Recycle Bin?`, type === 'folder' ? 'Everything inside it goes too. You can restore it from the Recycle Bin.' : 'You can restore it from the Recycle Bin.', 'Move to Recycle Bin');
    if (!ok) return;
    try {
      this.app.closePathsUnder(p);
      await api().lib.remove(p);
      if (this.selectedFolder && this.selectedFolder.startsWith(p)) this.selectedFolder = null;
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  }
}

export function parentDir(p) { return p.replace(/[\\/][^\\/]+$/, ''); }

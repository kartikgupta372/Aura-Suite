// Inkboard — preload: the only bridge between the page and the OS.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(name, ...args) {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld('inkAPI', {
  platform: process.platform,
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  lib: {
    root: () => call('lib:root'),
    chooseRoot: () => call('lib:chooseRoot'),
    tree: () => call('lib:tree'),
    createFolder: (parent, name) => call('lib:createFolder', parent, name),
    createNotebook: (parent, name) => call('lib:createNotebook', parent, name),
    rename: (p, name) => call('lib:rename', p, name),
    remove: (p) => call('lib:delete', p),
    move: (src, dest) => call('lib:move', src, dest),
    duplicate: (p) => call('lib:duplicate', p),
    reveal: (p) => call('lib:reveal', p),
    onChanged: (fn) => ipcRenderer.on('lib:changed', () => fn()),
  },
  file: {
    read: (p) => call('file:read', p),
    write: (p, text) => call('file:write', p, text),
    exists: (p) => call('file:exists', p),
    openDialog: () => call('file:openDialog'),
    saveAsDialog: (name) => call('file:saveAsDialog', name),
    openImages: () => call('file:openImageDialog'),
  },
  exporter: {
    pdf: (opts) => call('export:pdf', opts),
    png: (opts) => call('export:png', opts),
    assetUrl: (rel) => call('export:assetUrl', rel),
  },
  ai: {
    transcribe: (base64) => call('ai:transcribe', { base64 }),
  },
  app: {
    pendingOpen: () => call('app:pendingOpen'),
    setLastOpen: (paths) => call('app:setLastOpen', paths),
    toggleDevTools: () => call('app:toggleDevTools'),
    openExternal: (url) => call('app:openExternal', url),
    closeNow: () => call('app:closeNow'),
    onOpenFiles: (fn) => ipcRenderer.on('app:open-files', (_e, files) => fn(files)),
    onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  },
});

'use strict';
/* Working without Python. Two ways to get at the website's files:

   • Folder mode (Chrome, Edge, Brave): the editor opens your website folder with the File
     System Access API and saves straight into it.
   • Loaded mode (every browser, also iPad): you load a website folder or a .zip. Edits are kept
     in the editor (and in the browser, so closing the tab loses nothing). "Download site"
     gives you the whole site as a .zip, which you can load again later.

   sw.js (a service worker) shows the files in the editor frame and in Preview. */

const Local = (() => {
  const PAGE_RE = /^[a-z0-9][a-z0-9-]*\.html$/;
  const SKIP = /(^|\/)(\._[^/]*|\.DS_Store|__MACOSX|\.git|editor-backups|\.editor-backups|image-originals|\.image-originals|unused-files|\.unused-files)(\/|$)/;
  const MIME = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', xml: 'application/xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
    ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf', mp4: 'video/mp4', swf: 'application/x-shockwave-flash',
  };
  const mime = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const pad = n => String(n).padStart(2, '0');
  function stamp() {
    const d = new Date(), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return { day, time, compact: day.replace(/-/g, '') + '-' + time };
  }
  function split(path) {
    const parts = path.split('/').filter(s => s && s !== '.');
    if (!parts.length || parts.some(p => p === '..')) throw new Error('bad path');
    return parts;
  }
  const toBytes = async d => d instanceof Uint8Array ? d : typeof d === 'string' ? enc.encode(d) : new Uint8Array(await new Response(d).arrayBuffer());

  // the site is where the shallowest index.html is (a "docs" folder wins a tie)
  function findRoot(paths) {
    const idx = paths.filter(p => /(^|\/)index\.html$/i.test(p) && !SKIP.test(p))
      .map(p => ({ p, depth: p.split('/').length, docs: /(^|\/)docs\/index\.html$/i.test(p) }))
      .sort((a, b) => a.depth - b.depth || b.docs - a.docs);
    if (!idx.length) throw new Error('No index.html found. Choose the website folder (or a .zip of it).');
    return idx[0].p.slice(0, idx[0].p.length - 'index.html'.length);
  }

  /* Every store has three areas: "site" (what gets published), "originals" (image-originals:
     full-size photos and image edits) and "unused" (unused-files: files moved out of the site).
     The last two live next to the site folder, so they are never published. */
  const AREA_DIRS = { originals: 'image-originals', unused: 'unused-files' };
  const SITE_SKIP = /^(\.image-originals|\.unused-files|\.editor-backups|\.git)(\/|$)/;

  /* ---------------- storage: a folder on disk (Chrome, Edge, Brave) ---------------- */
  function folderStore(rootHandle, site, besideSite) {
    // besideSite: the folder that holds docs (website); null when the site folder itself was chosen
    const parent = besideSite || site, dot = besideSite ? '' : '.';
    const backupsName = dot + 'editor-backups';
    async function areaDir(area, create) {
      if (area === 'site') return site;
      return parent.getDirectoryHandle(dot + AREA_DIRS[area], { create: !!create });
    }
    async function dirFor(base, path, create) {
      const parts = split(path), name = parts.pop();
      let d = base;
      for (const x of parts) d = await d.getDirectoryHandle(x, { create: !!create });
      return { d, name };
    }
    async function fh(base, path, create) { const { d, name } = await dirFor(base, path, create); return d.getFileHandle(name, { create: !!create }); }
    async function writeTo(base, path, data) {
      const w = await (await fh(base, path, true)).createWritable();
      await w.write(data); await w.close();
    }
    async function walk(dir, prefix, out, skipSite) {
      for await (const [n, h] of dir.entries()) {
        const rel = prefix + n;
        if (n.startsWith('._') || n === '.DS_Store' || (skipSite && SITE_SKIP.test(rel))) continue;
        if (h.kind === 'directory') await walk(h, rel + '/', out, skipSite);
        else out.push({ path: rel, size: (await h.getFile()).size });
      }
      return out;
    }
    const self = {
      kind: 'folder', label: rootHandle.name,
      backupsLocation: rootHandle.name + '/' + backupsName,
      originalsLocation: rootHandle.name + '/' + dot + AREA_DIRS.originals,
      async topFiles() { const out = []; for await (const [n, h] of site.entries()) if (h.kind === 'file') out.push(n); return out; },
      async exists(p) { try { await fh(site, p); return true; } catch (e) { return false; } },
      async read(p) { return new Uint8Array(await (await (await fh(site, p)).getFile()).arrayBuffer()); },
      write: (p, data) => writeTo(site, p, data),
      async remove(p) { const { d, name } = await dirFor(site, p); await d.removeEntry(name); },
      async backup(p, label) {
        if (!(await self.exists(p))) return;
        const s = stamp();
        await writeTo(parent, `${backupsName}/${s.day}/${s.time}${label || ''}-${p}`, await self.read(p));
      },
      async listFiles(area) {
        let dir;
        try { dir = await areaDir(area); } catch (e) { return []; }
        return walk(dir, '', [], area === 'site');
      },
      async readFile(area, p) { return (await fh(await areaDir(area), p)).getFile(); },
      async writeFile(area, p, data) { await writeTo(await areaDir(area, true), p, data); },
      async hasFile(area, p) { try { await fh(await areaDir(area), p); return true; } catch (e) { return false; } },
      async moveFile(from, p, to) {
        const data = await self.readFile(from, p);
        await self.writeFile(to, p, data);
        const { d, name } = await dirFor(await areaDir(from), p);
        await d.removeEntry(name);
      },
    };
    return self;
  }

  /* ---------------- storage: loaded into the editor (every browser) ---------------- */
  function memoryStore(label, sources) {
    // sources: { site, originals, unused }: Map path -> { get: () => Promise<Blob|Uint8Array>, size }
    const AREAS = ['site', 'originals', 'unused'];
    const changed = {}, deleted = {};
    AREAS.forEach(a => { changed[a] = new Map(); deleted[a] = new Set(); if (!sources[a]) sources[a] = new Map(); });
    let sinceDownload = false;
    const key = 'site:' + label + ':' + sources.site.size;
    let persistTimer = null;
    const persist = () => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => saveSession(key, {
        changed: Object.fromEntries(AREAS.map(a => [a, [...changed[a].entries()]])),
        deleted: Object.fromEntries(AREAS.map(a => [a, [...deleted[a]]])),
      }).catch(() => {}), 600);
    };
    const toBlob = d => d instanceof Blob ? d : new Blob([d]);
    const self = {
      kind: 'memory', label, key,
      backupsLocation: '',
      originalsLocation: 'image-originals (in the downloaded .zip)',
      async topFiles() {
        const names = new Set([...sources.site.keys(), ...changed.site.keys()].filter(p => !p.includes('/')));
        deleted.site.forEach(d => names.delete(d));
        return [...names];
      },
      async hasFile(area, p) { return !deleted[area].has(p) && (changed[area].has(p) || sources[area].has(p)); },
      exists: p => self.hasFile('site', p),
      async readFile(area, p) {
        if (deleted[area].has(p)) throw new Error('not found');
        if (changed[area].has(p)) return changed[area].get(p);
        const src = sources[area].get(p); if (!src) throw new Error('not found');
        return toBlob(await src.get());
      },
      async read(p) { return toBytes(await self.readFile('site', p)); },
      async writeFile(area, p, data) { changed[area].set(p, toBlob(data)); deleted[area].delete(p); sinceDownload = true; persist(); },
      write: (p, data) => self.writeFile('site', p, data),
      async removeFile(area, p) { changed[area].delete(p); deleted[area].add(p); sinceDownload = true; persist(); },
      remove: p => self.removeFile('site', p),
      async moveFile(from, p, to) {
        // unused files simply stay out of the downloaded site (your loaded folder still has them)
        if (to !== 'unused') await self.writeFile(to, p, await self.readFile(from, p));
        await self.removeFile(from, p);
      },
      async listFiles(area) {
        const out = new Map();
        sources[area].forEach((v, p) => out.set(p, v.size || 0));
        changed[area].forEach((b, p) => out.set(p, b.size));
        deleted[area].forEach(p => out.delete(p));
        return [...out].map(([path, size]) => ({ path, size }));
      },
      notDownloaded: () => sinceDownload,
      async backup() { /* the downloaded zip is the save; nothing to back up */ },
      changeCount: () => AREAS.reduce((n, a) => n + changed[a].size + deleted[a].size, 0),
      restore(session) {
        const ch = Array.isArray(session.changed) ? { site: session.changed } : session.changed;
        const de = Array.isArray(session.deleted) ? { site: session.deleted } : session.deleted;
        AREAS.forEach(a => { (ch[a] || []).forEach(([p, b]) => changed[a].set(p, b)); (de[a] || []).forEach(p => deleted[a].add(p)); });
        sinceDownload = true;
      },
      forgetSession: () => dropSession(key),
      async exportZip(opts, onProgress) {
        // opts.leaveOut: Set of site paths to leave out (files no page uses)
        const z = new JSZip(), docs = z.folder('docs'), orig = z.folder(AREA_DIRS.originals);
        const leaveOut = (opts && opts.leaveOut) || new Set();
        for (const { path } of await self.listFiles('site')) {
          if (leaveOut.has(path)) continue;
          const data = changed.site.has(path) ? changed.site.get(path) : sources.site.get(path).get();
          docs.file(path, data, { compression: /\.(html?|css|js|json|svg|txt|xml)$/i.test(path) ? 'DEFLATE' : 'STORE' });
        }
        for (const { path } of await self.listFiles('originals')) {
          const data = changed.originals.has(path) ? changed.originals.get(path) : sources.originals.get(path).get();
          orig.file(path, data, { compression: /\.json$/i.test(path) ? 'DEFLATE' : 'STORE' });
        }
        const blob = await z.generateAsync({ type: 'blob', streamFiles: true }, m => onProgress && onProgress(m.percent));
        sinceDownload = false;
        return blob;
      },
    };
    return self;
  }

  /* browser storage for unsaved work in loaded mode (and the remembered folder) */
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('site-editor', 2);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('handles')) r.result.createObjectStore('handles');
        if (!r.result.objectStoreNames.contains('sessions')) r.result.createObjectStore('sessions');
      };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction(mode === 'handles' || mode === 'handles-w' ? 'handles' : 'sessions', mode.endsWith('-w') ? 'readwrite' : 'readonly');
        const q = fn(tx.objectStore(tx.objectStoreNames[0]));
        tx.oncomplete = () => resolve(q && q.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  const saveSession = (key, data) => idb('sessions-w', st => st.put(Object.assign({ time: Date.now() }, data), key));
  const loadSession = key => idb('sessions', st => st.get(key)).catch(() => null);
  const dropSession = key => idb('sessions-w', st => st.delete(key)).catch(() => null);
  function sessionCount(sess) {
    if (!sess) return 0;
    const n = x => Array.isArray(x) ? x.length : Object.values(x || {}).reduce((t, v) => t + v.length, 0);
    return n(sess.changed) + n(sess.deleted);
  }

  /* ---------------- shared logic ---------------- */
  let store = null;

  const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function inertScripts(html) {                    // same as server.py: scripts stay off while editing
    const low = html.toLowerCase();
    let out = '', last = 0, i = 0;
    for (;;) {
      const s = low.indexOf('<script', i);
      if (s < 0) break;
      const c = low.indexOf('<!--', i);
      if (c >= 0 && c < s) { const e = low.indexOf('-->', c + 4); if (e < 0) break; i = e + 3; continue; }
      if (!/[\s>/]/.test(low[s + 7] || '')) { i = s + 7; continue; }
      let j = s + 7, q = null;
      for (; j < html.length; j++) {
        const ch = html[j];
        if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
      }
      const tag = html.slice(s, j + 1);
      if (!/data-ed-type/.test(tag)) {
        let attrs = tag.slice(7, -1), orig = '';
        const tm = /\stype\s*=\s*(["'])(.*?)\1/i.exec(attrs);
        if (tm) { orig = tm[2]; attrs = attrs.slice(0, tm.index) + attrs.slice(tm.index + tm[0].length); }
        out += html.slice(last, s) + `<script data-ed-type="${escAttr(orig)}" type="text/x-inert"${attrs}>`;
        last = j + 1;
      }
      const end = low.indexOf('</script', j + 1);
      i = end < 0 ? html.length : end + 8;
    }
    return out + html.slice(last);
  }

  // the menu is repeated in every page (same as server.py)
  const UL_RE = /(<ul class="wsite-menu-default">)([\s\S]*?)(<\/ul>)/g;
  const FLY_RE = /(initPublishedFlyoutMenus\(\s*)(\[[\s\S]*?\])(\s*,\s*)"([^"]*)"/g;
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const readText = async p => dec.decode(await store.read(p));

  async function menu() {
    const html = await readText('index.html');
    FLY_RE.lastIndex = 0;
    const m = FLY_RE.exec(html);
    if (m) return JSON.parse(m[2]).map(i => ({ id: String(i.id || ''), title: i.title || '', url: i.url || '', target: i.target || '' }));
    const ul = new DOMParser().parseFromString(html, 'text/html').querySelector('ul.wsite-menu-default');
    return ul ? [...ul.querySelectorAll(':scope > li')].map(li => {
      const a = li.querySelector('a');
      return { id: (li.id || '').replace(/\D/g, ''), title: (a ? a.textContent : '').trim(), url: a ? a.getAttribute('href') || '' : '', target: '' };
    }) : [];
  }
  function menuLi(item, active) {
    const target = item.target ? `\n\t\ttarget="${escHtml(item.target)}"` : '';
    return `<li id="${active ? 'active' : 'pg' + item.id}" class="wsite-menu-item-wrap">\n\t<a\n\t\thref="${escHtml(item.url)}"${target}\n\t\tclass="wsite-menu-item"\n\t\t>\n\t\t${escHtml(item.title)}\n\t</a>\n\t\n</li>`;
  }
  function applyMenu(html, items, page) {
    html = html.replace(UL_RE, (all, a, inner, b) => {
      if (inner.includes('<ul')) throw new Error('sub-menus are not supported');
      return a + '\n' + items.map(i => menuLi(i, i.url === page)).join('\n') + '\n' + b;
    });
    const current = (items.find(i => i.url === page) || {}).id || '';
    const data = items.map(i => ({ id: i.id, title: i.title, url: i.url, target: i.target || '', nav_menu: false, nonclickable: false }));
    return html.replace(FLY_RE, (all, a, arr, sep) => a + JSON.stringify(data) + sep + `"${current}"`);
  }
  async function saveMenu(items) {
    const clean = [];
    for (const i of items) {
      const url = String(i.url || '').trim();
      if (!url) continue;
      clean.push({
        id: String(i.id || '').replace(/\D/g, '') || String(Date.now()) + String(clean.length).padStart(4, '0'),
        title: String(i.title || '').trim() || 'Page', url, target: i.target ? '_blank' : '',
      });
    }
    for (const p of await pages()) {
      const old = await readText(p.file);
      const neu = applyMenu(old, clean, p.file);
      if (neu !== old) { await store.backup(p.file, '-menu'); await store.write(p.file, neu); }
    }
    return clean;
  }

  async function pages() {
    const out = [];
    for (const name of await store.topFiles()) {
      if (!/\.html$/i.test(name) || name.startsWith('.')) continue;
      const m = /<title>([\s\S]*?)<\/title>/i.exec(await readText(name));
      const t = m ? new DOMParser().parseFromString(m[1], 'text/html').documentElement.textContent.trim() : name;
      out.push({ file: name, title: t || name });
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
  }
  async function savePage(page, html, create) {
    if (!PAGE_RE.test(page)) throw new Error('bad page name');
    const has = await store.exists(page);
    if (create && has) throw new Error(`A page called ${page} already exists.`);
    if (!create && !has) throw new Error('page not found');
    await store.backup(page);
    await store.write(page, html);
    return { ok: true, page };
  }
  async function upload(name, blob) {
    const m = /^(.*?)(\.[^.]+)?$/.exec(name.split('/').pop());
    const ext = (m[2] || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf'].includes(ext)) throw new Error('Only images (jpg, png, gif, webp, svg) or pdf.');
    const stem = (m[1] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'image';
    const path = `uploads/editor/${stem}-${stamp().compact}${ext}`;
    await store.write(path, blob);
    return path;
  }
  async function deletePage(page) {
    if (!PAGE_RE.test(page) || page === 'index.html' || !(await store.exists(page))) throw new Error('This page cannot be deleted.');
    await store.backup(page, '-deleted');
    await store.remove(page);
    await saveMenu((await menu()).filter(i => i.url !== page));
    return { ok: true };
  }

  /* ---------------- opening ---------------- */
  const canOpenFolder = () => !!window.showDirectoryPicker;
  const rememberName = n => { try { localStorage.setItem('site-editor-folder', n); } catch (e) { /* ignore */ } };
  const lastFolderName = () => { try { return localStorage.getItem('site-editor-folder'); } catch (e) { return null; } };

  async function useFolderHandle(h) {
    const exists = async (base, p) => { try { const parts = split(p), n = parts.pop(); let d = base; for (const x of parts) d = await d.getDirectoryHandle(x); await d.getFileHandle(n); return true; } catch (e) { return false; } };
    let s;
    if (await exists(h, 'index.html')) s = folderStore(h, h, null);
    else if (await exists(h, 'docs/index.html')) s = folderStore(h, await h.getDirectoryHandle('docs'), h);
    else throw new Error(`“${h.name}” has no index.html and no docs/index.html. Choose the website folder.`);
    store = s;
    rememberName(h.name);
    idb('handles-w', st => st.put(h, 'folder')).catch(() => null);
  }
  async function openFolder() {
    await useFolderHandle(await window.showDirectoryPicker({ id: 'site-editor', mode: 'readwrite' }));
  }
  async function reopenFolder() {
    // read only when asked, so a browser problem here can never block the start screen
    const h = await idb('handles', st => st.get('folder')).catch(() => null);
    if (!h) throw new Error('The last folder is not remembered any more. Choose it again.');
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
        (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to the folder was not given.');
    await useFolderHandle(h);
  }

  // split loaded files into the three areas; the site root is where index.html is
  function sortIntoAreas(items) {        // items: [{ path, get, size }]
    const root = findRoot(items.map(i => i.path));
    // 'website/docs/' -> next to it in 'website/'; a site loaded without a parent folder keeps them inside, hidden
    const beside = root.replace(/[^/]+\/$/, '');
    const where = area => root === '' ? '.' + AREA_DIRS[area] + '/' : beside + AREA_DIRS[area] + '/';
    const pre = { originals: where('originals'), unused: where('unused') };
    const sources = { site: new Map(), originals: new Map(), unused: new Map() };
    for (const it of items) {
      for (const area of ['originals', 'unused']) {
        if (it.path.startsWith(pre[area])) { sources[area].set(it.path.slice(pre[area].length), it); it.done = true; }
      }
      if (!it.done && it.path.startsWith(root)) {
        const rel = it.path.slice(root.length);
        if (!SITE_SKIP.test(rel)) sources.site.set(rel, it);
      }
    }
    return { root, sources };
  }
  // a folder chosen with the ordinary file picker (all browsers): read-only, kept in memory
  function loadFileList(files) {
    const items = [...files].map(f => ({ path: f.webkitRelativePath || f.name, size: f.size, get: async () => f }))
      .filter(i => !/(^|\/)(\._[^/]*|\.DS_Store|\.git|__MACOSX)(\/|$)/.test(i.path));
    const { root, sources } = sortIntoAreas(items);
    store = memoryStore(root.replace(/\/$/, '') || (items[0] ? items[0].path.split('/')[0] : 'website'), sources);
    return store;
  }
  async function loadZip(file) {
    const z = await JSZip.loadAsync(file);
    const items = Object.values(z.files).filter(e => !e.dir && !/(^|\/)(\._[^/]*|\.DS_Store|__MACOSX)(\/|$)/.test(e.name))
      .map(e => ({ path: e.name, size: (e._data && e._data.uncompressedSize) || 0, get: () => e.async('uint8array') }));
    const { sources } = sortIntoAreas(items);
    store = memoryStore(file.name.replace(/\.zip$/i, ''), sources);
    return store;
  }

  /* ---------------- the service worker asks for files ---------------- */
  async function serve(rel, edit) {
    try {
      let bytes = await store.read(rel || 'index.html');
      if (edit && /\.html?$/i.test(rel)) bytes = enc.encode(inertScripts(dec.decode(bytes)));
      bytes = bytes.slice();   // own buffer, so it can be handed over
      return { status: 200, type: mime(rel), body: bytes.buffer };
    } catch (e) {
      return { status: 404, type: 'text/plain; charset=utf-8', body: enc.encode('Not found: ' + rel).buffer };
    }
  }
  // true: a service worker shows the site's files; false: none available (for example when the editor
  // is opened from disk), and the editor builds the pages itself
  let swReady = null;
  function init() {
    if (swReady) return swReady;
    if (location.protocol === 'file:' || !('serviceWorker' in navigator)) return (swReady = Promise.resolve(false));
    navigator.serviceWorker.onmessage = async e => {
      if (!e.data || e.data.type !== 'site-file' || !e.ports[0]) return;
      if (!store) { e.ports[0].postMessage({ status: 503, type: 'text/plain', body: enc.encode('No site open').buffer }); return; }
      const r = await serve(e.data.rel, e.data.edit);
      e.ports[0].postMessage(r, [r.body]);
    };
    swReady = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => true).catch(() => false);
    return swReady;
  }

  return {
    init, canOpenFolder, openFolder, reopenFolder, lastFolderName, loadFileList, loadZip, inertScripts,
    store: () => store,
    pending: async () => (store && store.kind === 'memory' ? loadSession(store.key) : null),
    sessionCount,
    // files in the three areas
    listFiles: area => store.listFiles(area),
    readFile: (area, p) => store.readFile(area, p),
    writeFile: (area, p, data) => store.writeFile(area, p, data),
    hasFile: (area, p) => store.hasFile(area, p),
    moveFile: (from, p, to) => store.moveFile(from, p, to),
    originalsLocation: () => store ? store.originalsLocation : '',
    // the editor backend
    name: 'local',
    pages, readText, savePage, upload, menu, saveMenu, deletePage,
    backupsLocation: () => store ? store.backupsLocation : '',
  };
})();

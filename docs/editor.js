'use strict';
/* Site editor: point, click, drag and type on the real pages. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const frame = $('#frame'), wrap = $('#frameWrap');
/* Where things are on a page. Weebly sites use Weebly's markup; sites made from a template
   (themes/) mark their parts with data-se="…" and describe themselves in assets/site-editor.json. */
const WEEBLY = {
  theme: false,
  containers: '.wsite-section-elements, td.wsite-multicol-col',
  section: '.wsite-section-wrap',
  sectionsRoot: '#wsite-content',
  column: 'td.wsite-multicol-col',
  cols: '.wsite-multicol',
  text: '.wsite-button-inner, .paragraph, .wsite-content-title, h1, h2, h3, h4, h5, h6, blockquote',
  buttonText: '.wsite-button-inner',
  noEdit: '.nav, .logo, .mobile-nav, form, .wcustomhtml',
  menuArea: '.nav, .logo, .hamburger, .mobile-nav',
  siteArea: '',
  noDrop: '.nav, .mobile-nav, .dusk-header',
  isFixed: el => !!el.closest('.wsite-header-elements'),
  sectionBlocks: s => s.querySelector('.wsite-section-elements'),
  sectionStyleEl: s => s.querySelector('.wsite-section') || s,
};
function themeProfile(cfg) {
  const a = cfg.areas || {};
  const join = (...x) => x.filter(Boolean).join(', ');
  return {
    theme: true,
    containers: '[data-se~="blocks"], [data-se~="col"]',
    section: '[data-se~="section"]',
    sectionsRoot: '[data-se~="sections"]',
    column: '[data-se~="col"]',
    cols: '[data-se~="cols"]',
    text: 'p, h1, h2, h3, h4, h5, h6, blockquote, .date, ol, ul:not(.actions):not(.icons):not([data-se]), a.button',
    buttonText: 'a.button',
    noEdit: join('[data-se~="menu"], [data-se~="lock"], form, .se-embed', a.menu, a.site),
    menuArea: a.menu || '[data-se~="menu"]',
    siteArea: a.site || '',
    noDrop: join('[data-se~="menu"]', a.noDrop),
    isFixed: el => el.matches('[data-se~="fixed"]'),
    sectionBlocks: s => s.matches('[data-se~="blocks"]') ? s : s.querySelector('[data-se~="blocks"]'),
    sectionStyleEl: s => s,
  };
}
let P = WEEBLY, CFG = null;   // CFG: assets/site-editor.json of a template site
const PLACEHOLDER_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="100%" height="100%" fill="#ebe7dd"/>' +
  '<text x="50%" y="50%" font-family="sans-serif" font-size="22" fill="#8a8578" text-anchor="middle">Click to choose an image</text></svg>');

let doc = null, win = null, page = 'index.html', pagesList = [], menuCache = null;
let selected = null, hovered = null, editing = null, editStart = '';
let dirty = false, undoStack = [], redoStack = [], savedRange = null;
let drag = null, lastPointer = null, suppressClick = false, statusTimer = null;
let B = null;   // where pages are read and saved: ServerB (Python) or Local (folder / loaded site)

/* ---------------- server ---------------- */
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {} };
  if (o.method === 'POST') o.headers['X-Editor'] = '1';
  if (opts.json !== undefined) { o.body = JSON.stringify(opts.json); o.headers['Content-Type'] = 'application/json'; }
  if (opts.body !== undefined) o.body = opts.body;
  const r = await fetch(path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}

// Python server mode (server.py)
const ServerB = {
  name: 'server',
  pages: () => api('__api/pages'),
  readText: async f => { const r = await fetch('site/' + encodeURIComponent(f) + '?t=' + Date.now()); if (!r.ok) throw new Error('Cannot read ' + f); return r.text(); },
  savePage: (page, html, create) => api('__api/save', { method: 'POST', json: { page, html, create: !!create } }),
  upload: async (name, blob) => (await api('__api/upload?name=' + encodeURIComponent(name), { method: 'POST', body: blob })).path,
  menu: () => api('__api/menu'),
  saveMenu: items => api('__api/menu', { method: 'POST', json: items }),
  deletePage: page => api('__api/delete-page', { method: 'POST', json: { page } }),
  backupsLocation: () => 'editor-backups next to the site folder',
  originalsLocation: () => 'image-originals next to the site folder',
  listFiles: area => api('__api/files?area=' + area),
  async readFile(area, p) {
    const r = await fetch('__api/file?area=' + area + '&path=' + encodeURIComponent(p) + '&t=' + Date.now());
    if (!r.ok) throw new Error('not found: ' + p);
    return r.blob();
  },
  writeFile: (area, p, data) => api('__api/file?area=' + area + '&path=' + encodeURIComponent(p), { method: 'POST', body: data }),
  async hasFile(area, p) { const r = await fetch('__api/file?area=' + area + '&path=' + encodeURIComponent(p), { method: 'HEAD' }); return r.ok; },
  moveFile: (from, p, to, newPath) => api('__api/move', { method: 'POST', json: { from, to, path: p, to_path: newPath || '' } }),
};

let statusSticky = false;   // a message that stays until something else happens (not replaced when a page finishes loading)
function status(msg, sticky) {
  const s = $('#status');
  clearTimeout(statusTimer);
  statusSticky = !!sticky;
  s.textContent = msg; s.className = '';
  if (!sticky) statusTimer = setTimeout(showSaveState, 2600);
}
function showSaveState() {
  statusSticky = false;
  const s = $('#status');
  s.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  s.className = dirty ? 'dirty' : '';
}
function setDirty(v) { dirty = v; showSaveState(); $('#btnSave').disabled = !v; }

/* ---------------- pages ---------------- */
async function refreshPages() {
  pagesList = await B.pages();
  const sel = $('#pageSel');
  sel.innerHTML = pagesList.map(p => `<option value="${esc(p.file)}">${esc(p.title)} (${esc(p.file)})</option>`).join('');
  sel.value = page;
}

async function switchPage(name) {
  if (name === page && doc) return;
  if (!(await confirmLeave())) { $('#pageSel').value = page; return; }
  loadPage(name);
}

let loadToken = 0;
function loadPage(name) {
  page = name; selected = hovered = editing = null; undoStack = []; redoStack = [];
  doc = null; setDirty(false); updateUndo(); renderInspector();
  $('#pageSel').value = name;
  try { history.replaceState(null, '', '#' + name); } catch (e) { /* not allowed for files on disk in some browsers */ }
  const token = ++loadToken;
  if (!blobMode) { frame.src = 'site/' + encodeURIComponent(name) + '?edit=1&t=' + Date.now(); return; }
  // opened from disk: no service worker, so the page is built here with in-browser addresses
  resetBlobs();
  B.readText(name).then(html => blobifyPage(Local.inertScripts(html))).then(html => {
    if (token !== loadToken) return;
    frame.removeAttribute('src');
    frame.srcdoc = html;
  }).catch(e => status('Cannot open ' + name + ': ' + e.message, true));
}

/* ---------------- opened from disk (file://): no service worker ----------------
   Every image, style sheet and font gets an in-browser (blob:) address. Saving turns those
   addresses back into the normal paths, so the saved page is exactly as with the other modes. */
let blobMode = false;
const blobCache = new Map(), blobBack = new Map();
const MIME_BY_EXT = { css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject' };
const isLocalRef = r => r && !/^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/|#|about:)/i.test(r.trim());
function resetBlobs() {
  // released a little later: the page still on screen may ask for a font or picture until the next one shows
  const old = [...blobCache.values()];
  setTimeout(() => old.forEach(p => p.then(u => u && URL.revokeObjectURL(u))), 10000);
  blobCache.clear(); blobBack.clear();
}
function unBlob(s) { return blobBack.size ? String(s).replace(/blob:[^"'()\s<>&]+/g, u => blobBack.get(u) || u) : s; }
// key: the reference exactly as written (so saving gives it back unchanged); base: folder it is relative to
function blobFor(ref, base) {
  const key = (base || '') + '|' + ref;
  if (blobCache.has(key)) return blobCache.get(key);
  const path = resolveRef(base === '.' ? '' : (base || ''), ref);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const prom = (async () => {
    let blob = await B.readFile('site', path);
    if (ext === 'css') blob = new Blob([await rewriteCss(await blob.text(), path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')], { type: 'text/css' });
    else if (MIME_BY_EXT[ext] && blob.type !== MIME_BY_EXT[ext]) blob = new Blob([blob], { type: MIME_BY_EXT[ext] });
    const u = URL.createObjectURL(blob);
    if (!base) blobBack.set(u, ref);
    return u;
  })().catch(() => null);
  blobCache.set(key, prom);
  return prom;
}
async function replaceAsync(text, re, fn) {
  const parts = [], jobs = [];
  let last = 0;
  for (const m of text.matchAll(re)) { parts.push(text.slice(last, m.index)); const i = parts.length; parts.push(m[0]); jobs.push(fn(m).then(v => { parts[i] = v; })); last = m.index + m[0].length; }
  parts.push(text.slice(last));
  await Promise.all(jobs);
  return parts.join('');
}
const CSS_URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, CSS_IMPORT_RE = /@import\s+(["'])([^"']+)\1/gi;
async function rewriteCss(css, base) {
  css = await replaceAsync(css, CSS_URL_RE, async m => { if (!isLocalRef(m[2])) return m[0]; const u = await blobFor(m[2], base || '.'); return u ? `url("${u}")` : m[0]; });
  return replaceAsync(css, CSS_IMPORT_RE, async m => { if (!isLocalRef(m[2])) return m[0]; const u = await blobFor(m[2], base || '.'); return u ? `@import "${u}"` : m[0]; });
}
// in a page (and in style attributes): references are relative to the page, and are given back when saving
const rewriteStyleText = t => replaceAsync(t, CSS_URL_RE, async m => { if (!isLocalRef(m[2])) return m[0]; const u = await blobFor(m[2], ''); return u ? `url("${u}")` : m[0]; });
const RES_SEL = 'img[src], script[src], source[src], video[src], audio[src], embed[src], input[src], link[href]';
async function blobifyEl(el) {
  const jobs = [];
  const attr = el.matches('link') ? 'href' : 'src';
  if (el.matches(RES_SEL) && isLocalRef(el.getAttribute(attr)) && !(el.matches('link') && !/stylesheet|icon/i.test(el.getAttribute('rel') || ''))) {
    const v = el.getAttribute(attr);
    jobs.push(blobFor(v, '').then(u => { if (u && el.getAttribute(attr) === v) el.setAttribute(attr, u); }));
  }
  if (el.matches('video[poster]') && isLocalRef(el.getAttribute('poster'))) { const v = el.getAttribute('poster'); jobs.push(blobFor(v, '').then(u => u && el.setAttribute('poster', u))); }
  const st = el.getAttribute && el.getAttribute('style');
  if (st && /url\(/i.test(st)) jobs.push(rewriteStyleText(st).then(t => { if (t !== st && el.getAttribute('style') === st) el.setAttribute('style', t); }));
  if (el.matches('style') && /url\(|@import/i.test(el.textContent)) { const t0 = el.textContent; jobs.push(rewriteStyleText(t0).then(t => { if (t !== t0) el.textContent = t; })); }
  await Promise.all(jobs);
}
async function blobifyPage(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  await Promise.all([...d.querySelectorAll(RES_SEL + ', [style], style, video[poster]')].map(blobifyEl));
  return doctypeOf(d) + '\n' + leadingComments(d) + d.documentElement.outerHTML;
}
// images and backgrounds the editor adds while you work get the same treatment
function watchFrame() {
  const mo = new win.MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { if (isEl(m.target) && !m.target.closest('[data-editor]')) blobifyEl(m.target); continue; }
      m.addedNodes.forEach(n => { if (!isEl(n)) return; blobifyEl(n); n.querySelectorAll(RES_SEL + ', [style], style').forEach(blobifyEl); });
    }
  });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href', 'style', 'poster'] });
}

async function confirmLeave() {
  if (!dirty) return true;
  const r = await modal('Unsaved changes', `<p>Save your changes to <b>${esc(page)}</b> first?</p>`,
    [['cancel', 'Cancel'], ['discard', "Don't save"], ['save', 'Save', 'primary']]);
  if (r === 'save') return save();
  return r === 'discard';
}

frame.addEventListener('load', () => {
  if (blobMode && !frame.hasAttribute('srcdoc')) return;
  try { doc = frame.contentDocument; win = frame.contentWindow; } catch (e) { return; }
  if (!doc || !doc.body) return;
  setupDoc();
});

function setupDoc() {
  const st = doc.createElement('style');
  st.setAttribute('data-editor', '1');
  st.textContent = `
    html { scroll-behavior: auto !important; }
    [contenteditable] { outline: none; cursor: text; caret-color: #2f7de1; }
    a { cursor: default; }
    img { -webkit-user-drag: none; }
    [data-ed-empty] { min-height: 70px; outline: 2px dashed rgba(47,125,225,.45); outline-offset: -4px; position: relative; }
    td[data-ed-empty] { height: 70px; }
    [data-ed-empty]::before { content: 'Drop elements here'; position: absolute; left: 0; right: 0; top: 24px; text-align: center; color: #7a8ba0; font: 13px sans-serif; }
  `;
  doc.head.appendChild(st);
  // Weebly's inline onclick handlers expect this; harmless while editing
  try { win.lightboxLoaded = false; } catch (e) { /* ignore */ }

  doc.addEventListener('mousedown', onFrameMouseDown, true);
  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('dblclick', onFrameDblClick, true);
  doc.addEventListener('mousemove', e => onPointerMove(e.clientX, e.clientY, e), true);
  doc.addEventListener('mouseup', e => onPointerUp(e.clientX, e.clientY), true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('submit', e => e.preventDefault(), true);
  doc.addEventListener('dragstart', e => e.preventDefault(), true);
  doc.addEventListener('paste', onPaste, true);
  doc.addEventListener('input', () => { if (editing) setDirty(true); });
  doc.addEventListener('selectionchange', () => {
    const s = win.getSelection();
    if (editing && s.rangeCount && editing.contains(s.anchorNode)) { savedRange = s.getRangeAt(0).cloneRange(); updateTextBarState(); }
  });
  doc.addEventListener('mouseleave', () => { hovered = null; });
  if (P.theme) applyViewFixes();
  if (blobMode) watchFrame();
  markEmpty();
  loadedShared = P.theme ? sharedRegions(serialize()) : null;
  outside = null;
  checkOutside(doc).then(r => { if (doc && r.doc === doc) { outside = r.hosts; if (!selected && !editing) renderInspector(); } }).catch(() => {});
  renderInspector();
  if (!statusSticky) showSaveState();
}

/* Template sites: things the theme's scripts normally do on the live site (they don't run while
   editing), done here only for the editor's view. Nothing of this is saved. */
let removedBodyClasses = [];
function applyViewFixes() {
  const v = (CFG && CFG.view) || {};
  removedBodyClasses = (v.removeBodyClass || []).filter(c => doc.body.classList.contains(c));
  removedBodyClasses.forEach(c => doc.body.classList.remove(c));
  (v.inject || []).forEach(x => {
    const into = doc.querySelector(x.into); if (!into) return;
    const t = doc.createElement('template'); t.innerHTML = x.html;
    [...t.content.children].forEach(n => { n.setAttribute('data-editor', '1'); into.appendChild(n); });
  });
}

/* Parts marked <!-- se:shared name --> … <!-- /se:shared name --> are the same on every page
   (header, footer, …). When one changes on a page, saving copies it to the other pages. */
let loadedShared = null;
const SHARED_RE = /<!-- se:shared ([\w-]+) -->([\s\S]*?)<!-- \/se:shared \1 -->/g;
function sharedRegions(html) { const m = new Map(); for (const x of String(html).matchAll(SHARED_RE)) m.set(x[1], x[2]); return m; }
function replaceShared(html, name, content) {
  const re = new RegExp('(<!-- se:shared ' + name + ' -->)[\\s\\S]*?(<!-- \\/se:shared ' + name + ' -->)', 'g');
  return html.replace(re, (all, a, b) => a + content + b);
}
// which shared part an element is in (null if none)
function sharedNameOf(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    for (let n = e.previousSibling; n; n = n.previousSibling) {
      if (n.nodeType === 8) { const m = /^ (\/?)se:shared ([\w-]+) $/.exec(n.data); if (m) { if (m[1]) break; return m[2]; } }
    }
  }
  return null;
}
async function copySharedToPages(regions, skipPage) {
  let n = 0;
  for (const p of pagesList) {
    if (p.file === skipPage) continue;
    let t; try { t = await B.readText(p.file); } catch (e) { continue; }
    const old = t;
    for (const [k, v] of regions) t = replaceShared(t, k, v);
    if (t !== old) { await B.savePage(p.file, t); n++; }
  }
  return n;
}

/* ---------------- structure helpers ---------------- */
const isEl = n => n && n.nodeType === 1;
const isContainer = el => isEl(el) && el.matches(P.containers);
const isSection = el => isEl(el) && el.matches(P.section);
const isHeaderSection = el => isSection(el) && P.isFixed(el);
const isColumn = el => isEl(el) && el.matches(P.column);
const innerSection = s => P.sectionStyleEl(s);
const realKids = c => [...c.children].filter(ch => !/^(SCRIPT|STYLE|LINK)$/.test(ch.tagName));

function blockOf(el) {
  for (let e = isEl(el) ? el : el && el.parentElement; e && e !== doc.body; e = e.parentElement) {
    if (e.closest(P.menuArea) || (P.siteArea && e.closest(P.siteArea))) return null;
    if (isContainer(e.parentElement)) return e;
    if (isSection(e)) return e;
  }
  return null;
}

function typeOf(b) {
  if (!b) return null;
  if (isSection(b)) return 'section';
  if (isColumn(b)) return 'column';
  if (b.dataset.seType && LABELS[b.dataset.seType]) return b.dataset.seType;
  if (b.matches('.wsite-spacer, .se-spacer')) return 'spacer';
  if (b.matches('h1,h2,h3,h4,h5,h6')) return 'title';
  if (b.matches('.paragraph')) return 'text';
  if (P.theme && b.matches('p, blockquote, ul:not(.actions):not(.icons), ol')) return 'text';
  if (b.matches(P.cols) || b.querySelector(P.cols)) return 'columns';
  if (b.matches('form') || b.querySelector('form')) return 'form';
  if (b.matches('.se-embed') || b.querySelector('.wcustomhtml')) return 'embed';
  if (b.querySelector('a.wsite-button') || (P.theme && b.matches('ul.actions'))) return 'button';
  if (b.matches('hr') || b.querySelector('hr.styled-hr')) return 'divider';
  if (b.querySelector('.paragraph') && b.querySelector('img')) return 'imagetext';
  if (b.matches('img') || b.querySelector('.wsite-image, img')) return 'image';
  if (b.querySelector('.paragraph, h2')) return 'box';
  return 'element';
}
const LABELS = {
  section: 'Section', column: 'Column', spacer: 'Spacer', title: 'Title', text: 'Text', columns: 'Columns',
  form: 'Form', embed: 'Embed code', button: 'Button', divider: 'Divider', imagetext: 'Image + text',
  image: 'Image', box: 'Box', element: 'Element', project: 'Project card',
};

function parentSelectable(e) {
  if (!e || isSection(e)) return null;
  if (isColumn(e)) return blockOf(e.closest(P.cols));
  const c = e.parentElement;
  if (isColumn(c)) return c;
  return c ? c.closest(P.section) : null;
}
function chainOf(e) { const out = []; for (let x = e; x; x = parentSelectable(x)) out.unshift(x); return out; }

function editableFor(target) {
  if (!isEl(target)) target = target && target.parentElement;
  if (!target || target.closest(P.noEdit)) return null;
  return target.closest(P.text);
}

function markEmpty() {
  if (!doc) return;
  $$('[data-ed-empty]', doc).forEach(n => n.removeAttribute('data-ed-empty'));
  $$(P.containers, doc).forEach(c => { if (!realKids(c).length) c.setAttribute('data-ed-empty', '1'); });
}

/* ---------------- selection & text editing ---------------- */
function select(el) {
  if (editing && (!el || !el.contains(editing))) endEdit();
  selected = el || null;
  renderInspector();
}
function deselect() { if (editing) endEdit(); selected = null; renderInspector(); }

function startEdit(el, x, y) {
  if (editing === el) return;
  if (editing) endEdit();
  pushUndo();
  editing = el; editStart = el.innerHTML;
  el.setAttribute('contenteditable', 'true');
  el.focus({ preventScroll: true });
  if (x != null) {
    const r = caretRange(x, y);
    if (r && el.contains(r.startContainer)) { const s = win.getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  savedRange = null;
  renderTextBar();
}
function caretRange(x, y) {
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y); if (!p) return null;
    const r = doc.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r;
  }
  return null;
}
function endEdit() {
  const el = editing; if (!el) return;
  editing = null;
  el.removeAttribute('contenteditable');
  if (el.innerHTML === editStart) { undoStack.pop(); updateUndo(); } else setDirty(true);
  try { win.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
  $('#textBar').style.display = 'none';
  renderInspector();
}

/* ---------------- undo ---------------- */
function snapshot() {
  const m = doc.querySelector('meta[name="description"]');
  return { body: doc.body.innerHTML, title: doc.title, desc: m ? m.getAttribute('content') : null };
}
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; updateUndo(); }
function restoreSnap(s) {
  const y = win.scrollY;
  selected = hovered = editing = null;
  doc.body.innerHTML = s.body; doc.title = s.title; setDescription(s.desc);
  markEmpty(); win.scrollTo(0, y); setDirty(true); renderInspector();
}
function undo() { if (editing) endEdit(); if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); updateUndo(); }
function redo() { if (editing) endEdit(); if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); updateUndo(); }
function updateUndo() { $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length; }

function mutate(fn) {
  if (editing) endEdit();
  pushUndo();
  const r = fn();
  setDirty(true); markEmpty(); renderInspector();
  return r;
}

/* ---------------- frame events ---------------- */
function onFrameMouseDown(e) {
  if (e.button !== 0) return;
  if (editing && editing.contains(e.target)) return;
  if (editing) endEdit();
  const b = blockOf(e.target);
  if (b && b === selected && !isColumn(b) && !isHeaderSection(b)) {
    drag = { el: b, kind: isSection(b) ? 'section' : 'block', sx: e.clientX, sy: e.clientY, active: false, inFrame: true };
    e.preventDefault();
  }
}

function onFrameClick(e) {
  if (editing && editing.contains(e.target)) { if (e.target.closest('a')) e.preventDefault(); return; }
  e.preventDefault(); e.stopPropagation();
  if (suppressClick) { suppressClick = false; return; }
  if (e.target.closest(P.menuArea)) { if (editing) endEdit(); selected = null; renderInspector('menu'); return; }
  if (P.siteArea && e.target.closest(P.siteArea)) { if (editing) endEdit(); selected = null; renderInspector('site'); return; }
  const b = blockOf(e.target);
  if (!b) { deselect(); return; }
  const ed = editableFor(e.target);
  if (ed && !ed.matches(P.buttonText)) { select(b); startEdit(ed, e.clientX, e.clientY); return; }
  select(b);
}

function onFrameDblClick(e) {
  e.preventDefault();
  const b = blockOf(e.target); if (!b) return;
  const ed = editableFor(e.target);
  if (ed) { select(b); startEdit(ed, e.clientX, e.clientY); return; }
  if (e.target.tagName === 'IMG') { select(b); openImageEditor({ kind: 'img', img: e.target }); }
}

function onPaste(e) {
  if (!editing) return;
  e.preventDefault();
  const text = (e.clipboardData || win.clipboardData).getData('text/plain');
  const html = esc(text).replace(/\r?\n/g, '<br>');
  doc.execCommand('insertHTML', false, html);
}

function onKey(e) {
  const mod = e.metaKey || e.ctrlKey, k = (e.key || '').toLowerCase();
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (!$('#modal').hidden) return;
  if (editing) {
    if (e.key === 'Escape') { e.preventDefault(); const el = editing; endEdit(); select(blockOf(el) || selected); return; }
    if (e.key === 'Enter' && editing.matches(P.buttonText)) { e.preventDefault(); endEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      const s = win.getSelection();
      const inList = s.anchorNode && (isEl(s.anchorNode) ? s.anchorNode : s.anchorNode.parentElement).closest('li');
      if (!inList) { e.preventDefault(); if (!doc.execCommand('insertLineBreak')) doc.execCommand('insertHTML', false, '<br><br>'); }
    }
    return;
  }
  const t = e.target;
  if (t && t.ownerDocument === document && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (!selected) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && canRemove(selected)) { e.preventDefault(); removeBlock(selected); }
  else if (e.key === 'Escape') deselect();
}
document.addEventListener('keydown', onKey);

/* ---------------- drag & drop ---------------- */
function frameXY(clientX, clientY, fromParent) {
  if (!fromParent) return { x: clientX, y: clientY };
  const r = frame.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function onPointerMove(cx, cy, e, fromParent) {
  if (!doc) return;
  const p = frameXY(cx, cy, fromParent);
  lastPointer = p;
  if (drag) {
    if (!drag.active && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 6) startDrag();
    if (drag.active) {
      if (e) e.preventDefault();
      drag.target = findDrop(p.x, p.y);
      const g = $('#ghost'), fr = frame.getBoundingClientRect();
      g.style.left = (fr.left + p.x + 14) + 'px'; g.style.top = (fr.top + p.y + 10) + 'px';
    }
    return;
  }
  if (!fromParent) {
    const t = e && e.target;
    hovered = t ? blockOf(t) : null;
  }
}

function startDrag() {
  drag.active = true;
  document.body.classList.add('dragging');
  if (drag.el && editing) endEdit();
  const g = $('#ghost');
  g.textContent = drag.type ? 'Add ' + (PALETTE_NAMES[drag.type] || drag.type) : 'Move ' + LABELS[typeOf(drag.el)];
  g.style.display = 'block';
  try { win.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
}

function onPointerUp(cx, cy, fromParent) {
  if (!drag) return;
  const d = drag; drag = null;
  document.body.classList.remove('dragging');
  $('#ghost').style.display = 'none';
  if (!d.active) {
    if (d.type) addElement(d.type);      // a click on a palette item
    return;
  }
  suppressClick = !fromParent;
  setTimeout(() => { suppressClick = false; }, 300);
  const t = d.target;
  if (!t) return;
  if (d.el && (t.before === d.el || t.before === d.el.nextElementSibling && t.container === d.el.parentElement)) return;
  mutate(() => {
    const node = d.el || createBlock(d.type);
    t.container.insertBefore(node, t.before);
    selected = node;
    return node;
  });
  if (d.type) afterAdd(selected, d.type);
}

document.addEventListener('mousemove', e => onPointerMove(e.clientX, e.clientY, e, true));
document.addEventListener('mouseup', e => onPointerUp(e.clientX, e.clientY, true));

function findDrop(x, y) {
  const vw = win.innerWidth, vh = win.innerHeight;
  x = Math.max(2, Math.min(vw - 3, x)); y = Math.max(2, Math.min(vh - 3, y));
  const kind = drag.kind;
  if (kind === 'section') {
    const main = doc.querySelector(P.sectionsRoot);
    return main ? slotIn(main, realKids(main).filter(isSection), y) : null;
  }
  let el = doc.elementFromPoint(x, y);
  if (!el) return null;
  if (drag.el && drag.el.contains(el)) el = drag.el.parentElement;
  for (let e = el; e && e !== doc.documentElement; e = e.parentElement) {
    if (e.closest && e.closest(P.noDrop)) return null;
    if (isContainer(e)) return slotIn(e, realKids(e), y);
    if (isSection(e)) {
      const c = P.sectionBlocks(e);
      if (c) return slotIn(c, realKids(c), y);
    }
  }
  return null;
}

function slotIn(container, kids, y) {
  const list = kids.filter(k => k !== drag.el);
  for (const k of list) {
    const r = k.getBoundingClientRect();
    if (r.height === 0) continue;
    if (y < r.top + r.height / 2) return { container, before: k, lineY: r.top };
  }
  const last = [...list].reverse().find(k => k.getBoundingClientRect().height > 0);
  const cr = container.getBoundingClientRect();
  return { container, before: null, lineY: last ? last.getBoundingClientRect().bottom : cr.top + 6 };
}

// palette
const PALETTE_NAMES = {};
$$('.pal').forEach(b => {
  PALETTE_NAMES[b.dataset.type] = b.lastChild.textContent.trim();
  b.addEventListener('mousedown', e => {
    if (e.button !== 0 || !doc) return;
    e.preventDefault();
    const p = frameXY(e.clientX, e.clientY, true);
    drag = { type: b.dataset.type, kind: b.dataset.type === 'section' ? 'section' : 'block', sx: p.x, sy: p.y, active: false };
  });
});

function addElement(type) {
  if (!doc) return;
  let container, before = null;
  if (type === 'section') {
    container = doc.querySelector(P.sectionsRoot);
    const sec = selected && (isSection(selected) ? selected : selected.closest(P.section));
    if (sec && sec.parentElement === container) before = sec.nextElementSibling;
  } else if (selected && isSection(selected)) {
    container = P.sectionBlocks(selected);
  } else if (selected && isColumn(selected)) {
    container = selected;
  } else if (selected && selected.parentElement && isContainer(selected.parentElement)) {
    container = selected.parentElement; before = selected.nextElementSibling;
  } else {
    // nothing selected: add to the end of the section in view
    const root = doc.querySelector(P.sectionsRoot);
    const secs = root ? realKids(root).filter(isSection) : [];
    const mid = win.innerHeight / 2;
    const sec = secs.find(s => { const r = s.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || secs[0];
    container = sec && P.sectionBlocks(sec);
  }
  if (!container) return;
  const node = mutate(() => { const n = createBlock(type); container.insertBefore(n, before); selected = n; return n; });
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  afterAdd(node, type);
}

function afterAdd(node, type) {
  renderInspector();
  if (type === 'image') { const img = node.matches('img') ? node : node.querySelector('img'); if (img) replaceImage(img, true); }
  else if (type === 'title' || type === 'text') setTimeout(() => { startEdit(node); selectAllIn(node); }, 50);
}
function selectAllIn(el) { const r = doc.createRange(); r.selectNodeContents(el); const s = win.getSelection(); s.removeAllRanges(); s.addRange(r); }

/* ---------------- element templates (Weebly markup, so the theme styles them) ---------------- */
function colsHtml(contents, widths) {
  const n = contents.length;
  const tds = contents.map((c, i) => `<td class="wsite-multicol-col" style="width:${widths ? widths[i] : (100 / n)}%; padding:0 15px;">${c}</td>`).join('');
  return `<div><div class="wsite-multicol"><div class="wsite-multicol-table-wrap" style="margin:0 -15px;"><table class="wsite-multicol-table"><tbody class="wsite-multicol-tbody"><tr class="wsite-multicol-tr">${tds}</tr></tbody></table></div></div></div>`;
}
const T = {
  title: () => '<h2 class="wsite-content-title">New title</h2>',
  text: () => '<div class="paragraph">Write your text here.</div>',
  image: () => `<div><div class="wsite-image wsite-image-border-none " style="padding-top:10px;padding-bottom:10px;margin-left:0;margin-right:0;text-align:center"><a><img src="${PLACEHOLDER_IMG}" alt="Picture" style="width:auto;max-width:100%"></a><div style="display:block;font-size:90%"></div></div></div>`,
  button: () => '<div style="text-align:center;"><div style="height: 10px; overflow: hidden;"></div><a class="wsite-button wsite-button-large wsite-button-highlight" href="index.html"><span class="wsite-button-inner">Button text</span></a><div style="height: 10px; overflow: hidden;"></div></div>',
  spacer: () => '<div class="wsite-spacer" style="height:50px;"></div>',
  divider: () => '<div><div style="height: 20px; overflow: hidden; width: 100%;"></div><hr class="styled-hr" style="width:100%;"><div style="height: 20px; overflow: hidden; width: 100%;"></div></div>',
  columns2: () => colsHtml(['<div class="paragraph">Left column</div>', '<div class="paragraph">Right column</div>']),
  columns3: () => colsHtml(['<div class="paragraph">Column one</div>', '<div class="paragraph">Column two</div>', '<div class="paragraph">Column three</div>']),
  imagetext: () => colsHtml([T.image(), '<h2 class="wsite-content-title">Title</h2><div class="paragraph">Write your text here.</div>'], [45, 55]),
  embed: () => '<div><div class="wcustomhtml" style="width:100%; overflow-y:hidden;"><div class="paragraph" style="text-align:center;">Embed code: paste your HTML in the settings panel on the right.</div></div></div>',
  section: () => '<div class="wsite-section-wrap"><div class="wsite-section wsite-body-section"><div class="wsite-section-content"><div class="container"><div class="wsite-section-elements"><div class="wsite-spacer" style="height:40px;"></div><h2 class="wsite-content-title" style="text-align:center;">New section</h2><div class="paragraph" style="text-align:center;">Write your text here.</div><div class="wsite-spacer" style="height:40px;"></div></div></div></div></div></div>',
};
function themeElement(type) {
  const h = CFG && CFG.elements && CFG.elements[type];
  return h ? h.split('{{placeholder}}').join(PLACEHOLDER_IMG) : null;
}
function createBlock(type) {
  const t = doc.createElement('template');
  t.innerHTML = (P.theme ? themeElement(type) : T[type]()).trim();
  return t.content.firstElementChild;
}

/* ---------------- block actions ---------------- */
const canRemove = el => el && !isColumn(el) && !isHeaderSection(el);
function siblingBlock(el, dir) {
  let s = el;
  do { s = dir < 0 ? s.previousElementSibling : s.nextElementSibling; } while (s && /^(SCRIPT|STYLE|LINK)$/.test(s.tagName));
  if (s && isSection(el) && !isSection(s)) return null;
  return s;
}
function moveBlock(el, dir) {
  const s = siblingBlock(el, dir); if (!s) return;
  mutate(() => { dir < 0 ? s.before(el) : s.after(el); selected = el; });
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function duplicateBlock(el) { mutate(() => { const c = el.cloneNode(true); c.removeAttribute('contenteditable'); el.after(c); selected = c; }); }
function removeBlock(el) {
  if (!canRemove(el)) return;
  const label = LABELS[typeOf(el)];
  mutate(() => { el.remove(); selected = null; });
  status(label + ' deleted. Undo with ⌘Z');
}

/* ---------------- overlay ---------------- */
function place(box, r, fr) {
  box.style.display = 'block';
  box.style.left = (fr.left + r.left) + 'px'; box.style.top = (fr.top + r.top) + 'px';
  box.style.width = Math.max(0, r.width) + 'px'; box.style.height = Math.max(0, r.height) + 'px';
}
function frameOffset() { return { left: frame.offsetLeft, top: frame.offsetTop, width: frame.offsetWidth, height: frame.offsetHeight }; }

function tick() {
  requestAnimationFrame(tick);
  try {
    if (drag && drag.active && lastPointer && doc) {
      const h = win.innerHeight;
      if (lastPointer.y < 50) win.scrollBy(0, -14); else if (lastPointer.y > h - 50) win.scrollBy(0, 14);
      drag.target = findDrop(lastPointer.x, lastPointer.y);
    }
    drawOverlay();
  } catch (e) { /* page is reloading */ }
}

function drawOverlay() {
  const hb = $('#hoverBox'), sb = $('#selBox'), bar = $('#selBar'), tb = $('#textBar'), line = $('#dropLine'), zone = $('#dropZone');
  if (!doc || !doc.body) { [hb, sb, bar, tb, line, zone].forEach(x => { x.style.display = 'none'; }); return; }
  const fr = frameOffset();
  if (selected && !doc.contains(selected)) selected = null;
  if (hovered && !doc.contains(hovered)) hovered = null;

  if (hovered && hovered !== selected && !(drag && drag.active)) {
    place(hb, hovered.getBoundingClientRect(), fr);
    hb.firstChild.textContent = LABELS[typeOf(hovered)];
  } else hb.style.display = 'none';

  if (selected && !(drag && drag.active)) {
    const r = selected.getBoundingClientRect();
    place(sb, r, fr);
    bar.style.display = 'flex';
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = fr.top + r.top - bh - 6;
    if (top < 4) top = Math.min(fr.top + r.bottom + 6, fr.top + fr.height - bh - 4);
    if (top < 4) top = 4;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(4, Math.min(fr.left + r.left, fr.left + fr.width - bw - 4)) + 'px';
  } else { sb.style.display = 'none'; bar.style.display = 'none'; }

  if (editing) {
    const r = editing.getBoundingClientRect();
    tb.style.display = 'flex';
    const bh = tb.offsetHeight, bw = tb.offsetWidth;
    let top = fr.top + r.top - bh - 8;
    const selTop = bar.style.display === 'flex' ? parseFloat(bar.style.top) : null;
    if (selTop !== null && Math.abs(top - selTop) < bh + 4) top = selTop - bh - 4;
    if (top < 4) top = fr.top + r.bottom + 8;
    tb.style.top = Math.min(top, fr.top + fr.height - bh - 4) + 'px';
    tb.style.left = Math.max(4, Math.min(fr.left + r.left, fr.left + fr.width - bw - 4)) + 'px';
  } else tb.style.display = 'none';

  if (drag && drag.active && drag.target) {
    const t = drag.target, cr = t.container.getBoundingClientRect();
    line.style.display = 'block';
    line.style.left = (fr.left + cr.left) + 'px'; line.style.width = cr.width + 'px';
    line.style.top = (fr.top + t.lineY - 2) + 'px';
    place(zone, cr, fr);
  } else { line.style.display = 'none'; zone.style.display = 'none'; }
}

/* selection toolbar */
function renderSelBar() {
  const bar = $('#selBar');
  if (!selected) { bar.innerHTML = ''; return; }
  const chain = chainOf(selected);
  const crumbs = chain.map((el, i) => `<button class="crumb ${el === selected ? 'cur' : ''}" data-i="${i}" title="Select ${LABELS[typeOf(el)]}">${LABELS[typeOf(el)]}</button>`).join('<span class="crumb">›</span>');
  const movable = !isColumn(selected) && !isHeaderSection(selected);
  bar.innerHTML = (movable ? '<button class="handle" title="Drag to move">⠿</button>' : '') + crumbs +
    (movable ? `<span class="divider"></span>
      <button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button>
      <button data-a="dup" title="Duplicate">⧉</button><button data-a="del" title="Delete">🗑</button>` : '');
  bar.querySelectorAll('.crumb[data-i]').forEach(b => b.onclick = () => select(chain[+b.dataset.i]));
  bar.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const el = selected;
    ({ up: () => moveBlock(el, -1), down: () => moveBlock(el, 1), dup: () => duplicateBlock(el), del: () => removeBlock(el) })[b.dataset.a]();
  });
  const h = bar.querySelector('.handle');
  if (h) h.onmousedown = e => {
    e.preventDefault();
    const p = frameXY(e.clientX, e.clientY, true);
    drag = { el: selected, kind: isSection(selected) ? 'section' : 'block', sx: p.x, sy: p.y, active: false };
  };
}

/* text toolbar */
function renderTextBar() {
  const tb = $('#textBar');
  const simple = editing && editing.matches(P.buttonText);
  tb.innerHTML = simple ? '<button data-done="1">Done</button>' : `
    <button data-c="bold" title="Bold"><b>B</b></button>
    <button data-c="italic" title="Italic"><i>I</i></button>
    <button data-c="underline" title="Underline"><u>U</u></button>
    <select data-size title="Text size">
      <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option>
      <option value="4">Large</option><option value="5">Larger</option><option value="6">Huge</option>
    </select>
    <label class="colorbtn" title="Text colour">A<span class="sw"></span><input type="color" data-color value="#8d7824"></label>
    <span class="divider"></span>
    <button data-c="justifyLeft" title="Align left">⇤</button>
    <button data-c="justifyCenter" title="Centre">≡</button>
    <button data-c="justifyRight" title="Align right">⇥</button>
    <span class="divider"></span>
    <button data-c="insertUnorderedList" title="Bulleted list">•</button>
    <button data-c="insertOrderedList" title="Numbered list">1.</button>
    <button data-link="1" title="Link">🔗</button>
    <button data-c="unlink" title="Remove link">⛓̸</button>
    <button data-c="removeFormat" title="Clear formatting">✕</button>
    <span class="divider"></span>
    <button data-done="1" title="Finish editing (Esc)">Done</button>`;
  tb.onmousedown = e => { if (!e.target.closest('select, input, label')) e.preventDefault(); };
  tb.querySelectorAll('[data-c]').forEach(b => b.onclick = () => cmd(b.dataset.c));
  const size = tb.querySelector('[data-size]');
  if (size) size.onchange = () => { if (size.value) cmd('fontSize', size.value); size.value = ''; };
  const color = tb.querySelector('[data-color]');
  if (color) color.oninput = () => { tb.querySelector('.sw').style.background = color.value; cmd('foreColor', color.value); };
  const link = tb.querySelector('[data-link]');
  if (link) link.onclick = editLink;
  tb.querySelector('[data-done]').onclick = () => { const el = editing; endEdit(); select(blockOf(el) || selected); };
  updateTextBarState();
}
function restoreRange() {
  if (!editing) return;
  editing.focus({ preventScroll: true });
  if (savedRange) { const s = win.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
}
function cmd(name, val) {
  restoreRange();
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand(name, false, val);
  setDirty(true); updateTextBarState();
}
function updateTextBarState() {
  if (!editing) return;
  $$('#textBar [data-c]').forEach(b => {
    try { b.classList.toggle('on', doc.queryCommandState(b.dataset.c)); } catch (e) { /* ignore */ }
  });
}
async function editLink() {
  restoreRange();
  const s = win.getSelection();
  const node = s.anchorNode && (isEl(s.anchorNode) ? s.anchorNode : s.anchorNode.parentElement);
  const existing = node && node.closest('a');
  const range = savedRange && savedRange.cloneRange();
  if (!existing && (!range || range.collapsed)) { status('Select some text first, then add the link.'); return; }
  const res = await linkDialog(existing ? existing.getAttribute('href') : '', existing ? existing.target === '_blank' : false);
  if (!res) { restoreRange(); return; }
  if (range) { savedRange = range; }
  restoreRange();
  let a = existing;
  if (!a) {
    doc.execCommand('createLink', false, res.url);
    const s2 = win.getSelection();
    const n2 = s2.anchorNode && (isEl(s2.anchorNode) ? s2.anchorNode : s2.anchorNode.parentElement);
    a = n2 && (n2.closest('a') || (n2.querySelector && n2.querySelector('a[href="' + CSS.escape(res.url) + '"]')));
  }
  if (a) {
    a.setAttribute('href', res.url);
    if (res.newTab) a.setAttribute('target', '_blank'); else a.removeAttribute('target');
  }
  setDirty(true);
}

/* ---------------- inspector ---------------- */
function renderInspector(mode) {
  renderSelBar();
  const ins = $('#inspector');
  if (!doc) { ins.innerHTML = '<p class="hint">Loading…</p>'; return; }
  if (mode === 'menu') {
    ins.innerHTML = `<h2>Menu</h2><p class="sub">The menu appears on every page.</p>
      <p>Rename, reorder, add or remove menu items and pages in <b>Pages &amp; menu</b>.</p>
      <div class="actions"><button class="primary" id="goMenu">Open Pages &amp; menu</button></div>`;
    if (P.theme) $('#goMenu').insertAdjacentHTML('afterend', '<button id="goSite">Site settings (social links)</button>');
    $('#goMenu').onclick = openPagesDialog;
    if ($('#goSite')) $('#goSite').onclick = openSiteSettings;
    return;
  }
  if (mode === 'site') { siteInspector(ins); return; }
  if (!selected) {
    ins.innerHTML = `<h2>${esc(doc.title || page)}</h2><p class="sub">${esc(page)}</p>
      <ul class="tips">
        <li><b>Click</b> any element to select it. Click text to start typing.</li>
        <li><b>Drag</b> elements from the left onto the page, or click one to add it below the selected element.</li>
        <li><b>Move</b> a selected element by dragging it (or its ⠿ handle), or with ↑ ↓.</li>
        <li>Use the labels above a selection (Section › Columns › …) to select what's around it, such as a section to change its background.</li>
        <li><kbd>⌘Z</kbd> undo · <kbd>⌘S</kbd> save · <kbd>Delete</kbd> removes the selected element.</li>
      </ul>
      <div class="actions"><button id="goSettings">Page settings</button><button id="goPages">Pages &amp; menu</button>${P.theme ? '<button id="goSite">Site settings</button>' : ''}</div>` + outsideNote();
    if ($('#goTplFiles')) $('#goTplFiles').onclick = () => refreshTemplateFiles();
    $('#goSettings').onclick = openPageSettings; $('#goPages').onclick = openPagesDialog;
    if ($('#goSite')) $('#goSite').onclick = openSiteSettings;
    return;
  }
  const type = typeOf(selected), el = selected;
  const insp = INSPECTORS[type] || INSPECTORS.element;
  ins.innerHTML = `<h2>${LABELS[type]}</h2><p class="sub">${esc(SUBS[type] || '')}</p><div id="insBody"></div>`;
  insp(el, $('#insBody'));
  if (type !== 'section' && type !== 'column') appendBlockActions(el, $('#insBody'));
  if (type !== 'column') appendAdvanced(el, $('#insBody'));
}
const SUBS = {
  section: 'A full-width band of the page with its own background.',
  title: 'Click the title on the page to change its words.',
  text: 'Click the text on the page to type. Select words to make them bold, coloured, linked…',
  imagetext: 'Click the text to type; double-click the picture to replace it.',
  box: 'Click its text on the page to edit it.',
  columns: 'Elements side by side. Drag elements into a column.',
  column: 'One column. Drag elements into it.',
  embed: 'Your own HTML, such as a sign-up form or video.',
  form: '',
};

function field(label, html) { return `<div class="fld"><span class="lbl">${label}</span>${html}</div>`; }
function choice(name, opts, cur) {
  return `<div class="choice" data-name="${name}">` + opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('') + '</div>';
}
function onChoice(root, name, fn) {
  const c = root.querySelector(`.choice[data-name="${name}"]`); if (!c) return;
  c.querySelectorAll('button').forEach(b => b.onclick = () => {
    c.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v);
  });
}
const ALIGN = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
function alignOf(el) { const a = (el.style.textAlign || win.getComputedStyle(el).textAlign || 'left'); return a === 'start' ? 'left' : a === 'justify' ? 'left' : a; }

// edits from the inspector: one undo step per field change
function live(fn) { let first = true; return v => { if (first) { pushUndo(); first = false; } fn(v); setDirty(true); markEmpty(); }; }

function pageOptions(cur) {
  const opts = pagesList.map(p => `<option value="${esc(p.file)}" ${p.file === cur ? 'selected' : ''}>${esc(p.title)}</option>`).join('');
  const isPage = pagesList.some(p => p.file === cur);
  return `<select data-k="linkpage">${opts}<option value="__url" ${isPage ? '' : 'selected'}>Other web address…</option></select>`;
}
function linkFields(href, target) {
  const isPage = pagesList.some(p => p.file === href);
  return field('Link to', pageOptions(href)) +
    `<div class="fld" data-k="urlrow" ${isPage ? 'hidden' : ''}><input type="url" data-k="url" placeholder="https://…" value="${esc(isPage ? '' : (href || ''))}"></div>` +
    `<div class="fld"><label class="row"><input type="checkbox" data-k="newtab" ${target === '_blank' ? 'checked' : ''}> Open in a new tab</label></div>`;
}
function bindLink(root, apply) {
  const sel = root.querySelector('[data-k=linkpage]'), url = root.querySelector('[data-k=url]'), row = root.querySelector('[data-k=urlrow]'), nt = root.querySelector('[data-k=newtab]');
  const fire = live(() => apply(sel.value === '__url' ? url.value.trim() : sel.value, nt.checked));
  sel.onchange = () => { row.hidden = sel.value !== '__url'; if (sel.value !== '__url') fire(); else url.focus(); };
  url.onchange = fire; nt.onchange = fire;
}

const INSPECTORS = {
  section(el, root) {
    const inner = innerSection(el) || el;
    const cs = win.getComputedStyle(inner);
    const hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
    const isHeader = isHeaderSection(el);
    root.innerHTML =
      field('Background image', `<div class="thumb" style="${hasImg ? `background-image:${esc(cs.backgroundImage)}` : ''}">${hasImg ? '' : 'No image'}</div>
        <div class="actions">${hasImg ? '<button data-k="bgedit" class="primary">Edit image</button>' : ''}<button data-k="bgimg">${hasImg ? 'Replace image' : 'Add image'}</button>${hasImg ? '<button data-k="bgren">Rename…</button><button data-k="bgnone">Remove</button>' : ''}</div>
        ${hasImg ? `<p class="hint" style="margin:6px 0 0">${esc(sitePathOf(inner.style.backgroundImage || cs.backgroundImage) || '')}</p>` : ''}`) +
      field('Background colour', `<div class="row"><input type="color" data-k="bgcolor" value="${rgbToHex(cs.backgroundColor) || '#ffffff'}"><button data-k="bgclear">No colour</button></div>`) +
      (hasImg ? field('Image position', choice('pos', [['50% 0%', 'Top'], ['50% 50%', 'Middle'], ['50% 100%', 'Bottom']], posKey(inner.style.backgroundPosition))) : '') +
      (isHeader && !P.theme ? field('Height', `<div class="row"><input type="range" min="150" max="900" step="10" data-k="h" value="${parseInt(inner.style.height) || inner.offsetHeight}"><span data-k="hv">${parseInt(inner.style.height) || inner.offsetHeight}px</span></div>`) : '') +
      (isHeader ? `<p class="hint">${P.theme ? (sharedNameOf(el) ? 'This part is the same on every page: changes here are copied to all pages when you save.' : 'This part of the page cannot be moved or deleted.') : 'This is the page banner. It cannot be moved or deleted.'}</p>` :
        `<div class="actions">
          <button data-k="up">↑ Move up</button><button data-k="down">↓ Move down</button>
          <button data-k="dup">Duplicate</button><button data-k="add">+ Section below</button>
          <button data-k="del" class="danger">Delete section</button></div>`);
    const q = k => root.querySelector(`[data-k=${k}]`);
    if (q('bgedit')) q('bgedit').onclick = () => openImageEditor({ kind: 'bg', el: inner, section: el });
    if (q('bgren')) q('bgren').onclick = () => renameImage(sitePathOf(inner.style.backgroundImage || cs.backgroundImage));
    q('bgimg').onclick = async () => {
      const path = await pickAndUpload('bg'); if (!path) return;
      mutate(() => {
        inner.style.backgroundImage = `url("${path}")`;
        inner.style.backgroundRepeat = 'no-repeat';
        inner.style.backgroundSize = 'cover';
        if (!inner.style.backgroundPosition || /undefined/.test(inner.style.backgroundPosition)) inner.style.backgroundPosition = '50% 50%';
        inner.classList.add('wsite-section-bg-image');
        selected = el;
      });
    };
    if (q('bgnone')) q('bgnone').onclick = () => mutate(() => { inner.style.backgroundImage = 'none'; inner.classList.remove('wsite-section-bg-image'); selected = el; });
    q('bgcolor').oninput = live(() => { inner.style.backgroundColor = q('bgcolor').value; });
    q('bgcolor').onchange = () => renderInspector();
    q('bgclear').onclick = () => mutate(() => { inner.style.backgroundColor = 'transparent'; selected = el; });
    onChoice(root, 'pos', live(v => { inner.style.backgroundPosition = v; }));
    if (q('h')) q('h').oninput = live(() => { inner.style.height = q('h').value + 'px'; q('hv').textContent = q('h').value + 'px'; });
    if (!isHeader) {
      q('up').onclick = () => moveBlock(el, -1); q('down').onclick = () => moveBlock(el, 1);
      q('dup').onclick = () => duplicateBlock(el); q('del').onclick = () => removeBlock(el);
      q('add').onclick = () => { selected = el; addElement('section'); };
    }
  },

  title(el, root) { textInspector(el, root); },
  text(el, root) { textInspector(el, root); },
  box(el, root) { root.innerHTML = '<div class="actions"><button data-k="edit">Edit text</button></div>'; root.querySelector('[data-k=edit]').onclick = () => { const t = el.querySelector(P.text); if (t) startEdit(t); }; },
  imagetext(el, root) { INSPECTORS.image(el, root); },

  image(el, root) {
    const img = el.matches('img') ? el : el.querySelector('img');
    if (!img) { root.innerHTML = ''; return; }
    const holder = img.closest('.wsite-image, .image') || el;
    const a = img.closest('a');
    const cap = P.theme ? null : holder.querySelector(':scope > div[style*="font-size:90%"], :scope > div[style*="font-size: 90%"]');
    const clickOpts = P.theme ? [['link', 'Open link'], ['none', 'Nothing']] : [['zoom', 'Enlarge'], ['link', 'Open link'], ['none', 'Nothing']];
    const mode = !a || !a.getAttribute('href') ? 'none' : (/lightbox/i.test((a.getAttribute('onclick') || '') + (a.getAttribute('rel') || '') + a.className) ? 'zoom' : 'link');
    // a Weebly picture that text wraps around: a floated box that holds the picture. Size and side are set on the box.
    const fl = !P.theme && img.closest('span[style*="float"]');
    const pusher = fl && fl.previousElementSibling && fl.previousElementSibling.classList.contains('imgPusher') ? fl.previousElementSibling : null;
    const w = fl ? (parseInt(fl.style.width) || parseInt(img.style.width) || 50) : /%$/.test(img.style.width) ? parseInt(img.style.width) : 100;
    root.innerHTML =
      field('Picture', `<div class="thumb" style="background-image:url('${esc(img.src)}');background-size:contain"></div><div class="actions"><button data-k="edit" class="primary">Edit image</button><button data-k="rep">Replace image</button><button data-k="ren">Rename…</button></div>
        <p class="hint" style="margin:6px 0 0">${esc(sitePathOf(img.getAttribute('src')) || '')}</p>`) +
      field('Description (alt text)', `<input type="text" data-k="alt" value="${esc(img.getAttribute('alt') || '')}" placeholder="What is in the picture?">`) +
      field('Size', `<div class="row"><input type="range" min="10" max="100" data-k="w" value="${w}"><span data-k="wv">${fl || (img.style.width && img.style.width !== 'auto') ? w + '%' : 'original'}</span><button data-k="wauto">Original</button></div>`) +
      field('Align', choice('align', fl ? [['left', 'Left, text on the right'], ['right', 'Right, text on the left']] : ALIGN, fl ? (fl.style.cssFloat === 'left' ? 'left' : 'right') : P.theme ? imgAlignOf(img) : alignOf(holder))) +
      (cap ? field('Caption', `<input type="text" data-k="cap" value="${esc(cap.textContent.trim())}">`) : '') +
      field('When clicked', choice('click', clickOpts, mode)) +
      `<div data-k="linkbox" ${mode === 'link' ? '' : 'hidden'}>${linkFields(mode === 'link' ? a.getAttribute('href') : '', a && a.target)}</div>`;
    const q = k => root.querySelector(`[data-k=${k}]`);
    q('rep').onclick = () => replaceImage(img);
    q('ren').onclick = () => renameImage(sitePathOf(img.getAttribute('src')));
    q('edit').onclick = () => openImageEditor({ kind: 'img', img });
    q('alt').oninput = live(() => img.setAttribute('alt', q('alt').value));
    q('w').oninput = live(() => {
      if (fl) { fl.style.width = q('w').value + '%'; img.style.width = '100%'; img.style.boxSizing = 'border-box'; img.style.margin = '0'; img.style.maxWidth = '100%'; }
      else { img.style.width = q('w').value + '%'; img.style.maxWidth = '100%'; }
      q('wv').textContent = q('w').value + '%';
    });
    q('wauto').onclick = () => mutate(() => { if (fl) fl.style.width = ''; img.style.width = 'auto'; img.style.maxWidth = '100%'; selected = el; });
    onChoice(root, 'align', live(v => {
      // template sites show pictures as blocks: they are placed with their margins, not text alignment
      if (fl) {   // the text follows: it wraps on the other side
        if (!fl.style.width || fl.style.width === 'auto') { fl.style.width = w + '%'; img.style.width = '100%'; img.style.boxSizing = 'border-box'; img.style.margin = '0'; }
        fl.style.cssFloat = v; fl.style.clear = v;
        fl.style.marginLeft = v === 'right' ? '15px' : '0'; fl.style.marginRight = v === 'left' ? '15px' : '0';
        if (pusher) pusher.style.cssFloat = v;
      }
      else if (P.theme) { img.style.marginLeft = v === 'left' ? '' : 'auto'; img.style.marginRight = v === 'center' ? 'auto' : ''; }
      else holder.style.textAlign = v;
    }));
    if (cap) q('cap').oninput = live(() => { cap.textContent = q('cap').value; });
    // the image's <a> (created only when a click behaviour is actually set)
    const getLink = () => img.closest('a') || (() => {
      const n = doc.createElement('a');
      if (P.theme && img.parentElement && img.parentElement.matches('.image')) { const h = img.parentElement; n.className = h.className; h.replaceWith(n); n.appendChild(img); return n; }
      img.before(n); n.appendChild(img); return n;
    })();
    onChoice(root, 'click', live(v => {
      q('linkbox').hidden = v !== 'link';
      const link = getLink();
      link.removeAttribute('onclick'); link.removeAttribute('rel'); link.classList.remove('w-fancybox'); link.removeAttribute('target');
      if (link.getAttribute('class') === '') link.removeAttribute('class');
      if (v === 'zoom') { link.setAttribute('href', img.getAttribute('src').split('?')[0]); link.setAttribute('rel', 'lightbox'); link.setAttribute('onclick', 'if (!lightboxLoaded) return false'); }
      else if (v === 'none') link.removeAttribute('href');
      else if (!link.getAttribute('href')) link.setAttribute('href', 'index.html');
    }));
    bindLink(root, (href, nt) => { const link = getLink(); link.setAttribute('href', href); if (nt) link.setAttribute('target', '_blank'); else link.removeAttribute('target'); });
  },

  button(el, root) {
    if (P.theme) { themeButtons(el, root); return; }
    const a = el.querySelector('a.wsite-button'), inner = a.querySelector('.wsite-button-inner') || a;
    const style = a.classList.contains('wsite-button-highlight') ? 'highlight' : 'normal';
    const size = a.classList.contains('wsite-button-large') ? 'large' : 'small';
    root.innerHTML = field('Button text', `<input type="text" data-k="txt" value="${esc(inner.textContent.trim())}">`) +
      linkFields(a.getAttribute('href') || '', a.getAttribute('target')) +
      field('Style', choice('style', [['highlight', 'Filled'], ['normal', 'Outline']], style)) +
      field('Size', choice('size', [['large', 'Large'], ['small', 'Normal']], size)) +
      field('Align', choice('align', ALIGN, alignOf(el)));
    const q = k => root.querySelector(`[data-k=${k}]`);
    q('txt').oninput = live(() => { inner.textContent = q('txt').value; });
    bindLink(root, (href, nt) => { a.setAttribute('href', href); if (nt) a.setAttribute('target', '_blank'); else a.removeAttribute('target'); });
    onChoice(root, 'style', live(v => { a.classList.toggle('wsite-button-highlight', v === 'highlight'); a.classList.toggle('wsite-button-normal', v !== 'highlight'); }));
    onChoice(root, 'size', live(v => { a.classList.toggle('wsite-button-large', v === 'large'); a.classList.toggle('wsite-button-small', v !== 'large'); }));
    onChoice(root, 'align', live(v => { el.style.textAlign = v; }));
  },

  spacer(el, root) {
    const h = parseInt(el.style.height) || el.offsetHeight;
    root.innerHTML = field('Height', `<div class="row"><input type="range" min="0" max="400" step="5" data-k="h" value="${h}"><input type="number" min="0" max="2000" data-k="hn" value="${h}"> px</div>`);
    const r = root.querySelector('[data-k=h]'), n = root.querySelector('[data-k=hn]');
    const set = live(v => { el.style.height = v + 'px'; r.value = v; n.value = v; });
    r.oninput = () => set(r.value); n.oninput = () => set(n.value);
  },

  divider(el, root) { root.innerHTML = '<p class="hint">A thin line in the theme’s style.</p>'; },

  columns(el, root) {
    if (P.theme) { themeColumns(el, root); return; }
    const tr = el.querySelector('.wsite-multicol-tr');
    const tds = [...tr.children].filter(isColumn);
    const pad = parseInt(tds[0] && tds[0].style.paddingLeft) || 15;
    root.innerHTML = field('Column widths (%)', `<div class="row">${tds.map((td, i) => `<input type="number" min="5" max="95" data-i="${i}" value="${Math.round(parseFloat(td.style.width) || 100 / tds.length)}">`).join('')}</div>`) +
      `<div class="actions"><button data-k="eq">Equal widths</button><button data-k="addc">+ Column</button><button data-k="rmc" ${tds.length < 2 ? 'disabled' : ''}>− Last column</button></div>` +
      field('Space between columns', `<div class="row"><input type="range" min="0" max="40" data-k="pad" value="${pad}"><span data-k="pv">${pad * 2}px</span></div>`) +
      field('Height', `<label class="row"><input type="checkbox" data-k="eqh" ${el.classList.contains('se-equal') ? 'checked' : ''}> Equal height boxes</label>
        <p class="hint">Coloured boxes in the columns all end on the same line (on a phone they stack as usual). The space under the boxes is made equal too.</p>`);
    root.querySelector('[data-k=eqh]').onchange = e => mutate(() => { setEqualHeight(el, e.target.checked, tds); selected = el; });
    const setW = live(ws => tds.forEach((td, i) => { td.style.width = ws[i] + '%'; }));
    root.querySelectorAll('[data-i]').forEach(inp => inp.onchange = () => {
      const ws = [...root.querySelectorAll('[data-i]')].map(x => +x.value || 1);
      const sum = ws.reduce((a, b) => a + b, 0);
      setW(ws.map(w => (w * 100 / sum).toFixed(3)));
    });
    root.querySelector('[data-k=eq]').onclick = () => mutate(() => { tds.forEach(td => { td.style.width = (100 / tds.length) + '%'; }); selected = el; });
    root.querySelector('[data-k=addc]').onclick = () => mutate(() => {
      const td = doc.createElement('td'); td.className = 'wsite-multicol-col';
      td.style.cssText = `width:${100 / (tds.length + 1)}%; padding:0 ${pad}px;`;
      tr.appendChild(td); [...tr.children].filter(isColumn).forEach(c => { c.style.width = (100 / (tds.length + 1)) + '%'; });
      selected = el;
    });
    root.querySelector('[data-k=rmc]').onclick = () => mutate(() => {
      const last = tds[tds.length - 1], prev = tds[tds.length - 2];
      while (last.firstChild) prev.appendChild(last.firstChild);
      last.remove();
      const left = [...tr.children].filter(isColumn);
      left.forEach(c => { c.style.width = (100 / left.length) + '%'; });
      selected = el;
    });
    const pr = root.querySelector('[data-k=pad]'), wrapEl = el.querySelector('.wsite-multicol-table-wrap');
    pr.oninput = live(() => {
      tds.forEach(td => { td.style.padding = `0 ${pr.value}px`; });
      if (wrapEl) wrapEl.style.margin = `0 -${pr.value}px`;
      root.querySelector('[data-k=pv]').textContent = pr.value * 2 + 'px';
    });
  },

  column(el, root) {
    if (P.theme) { root.innerHTML = '<p class="hint">One column. Drag elements into it. Select the Columns (above) to change how many there are.</p>'; return; }
    root.innerHTML = field('Width (%)', `<input type="number" min="5" max="95" data-k="w" value="${Math.round(parseFloat(el.style.width) || 50)}">`) +
      '<p class="hint">The other columns keep their widths; use the Columns settings to balance them.</p>';
    const w = root.querySelector('[data-k=w]');
    w.onchange = live(() => { el.style.width = w.value + '%'; });
  },

  embed(el, root) {
    const box = el.querySelector('.wcustomhtml') || el;
    root.innerHTML = '<p class="hint">Scripts in embed code only run in Preview and on the live site, not while editing.</p>' +
      field('HTML', `<textarea data-k="code" spellcheck="false">${esc(unBlob(unInert(box.innerHTML.trim())))}</textarea>`) +
      '<div class="actions"><button class="primary" data-k="apply">Apply</button></div>';
    root.querySelector('[data-k=apply]').onclick = () => mutate(() => { box.innerHTML = root.querySelector('[data-k=code]').value; selected = el; });
  },

  form(el, root) {
    if (P.theme) { root.innerHTML = '<div class="note"><b>A form needs a form service</b> (for example Formspree or a MailerLite form) to send messages; GitHub Pages cannot do that by itself. Paste the service’s code in an Embed code element.</div>'; return; }
    root.innerHTML = `<div class="note"><b>This is a Weebly contact form.</b> It sends messages through Weebly's servers,
      so it will stop working once the site is no longer on Weebly. Replace it with a form service
      (for example Formspree or a MailerLite form) using an Embed code element.</div>`;
  },

  element(el, root) { root.innerHTML = '<p class="hint">Use “Edit HTML” below to change this element.</p>'; },
};

/* "Equal height boxes" on a Weebly columns block: the class se-equal plus a style block inside the block itself
   (so it travels with it). Without it a coloured box is only as tall as its own text. Needs :has() (all current browsers;
   in an older one the boxes just stay as they were). Below 768px the columns stack as before. */
const EQUAL_CSS = `@media screen and (min-width: 768px) {
.wsite-multicol.se-equal .wsite-multicol-table, .wsite-multicol.se-equal .wsite-multicol-tbody { display: block; width: 100%; }
.wsite-multicol.se-equal .wsite-multicol-tr { display: flex; align-items: stretch; }
.wsite-multicol.se-equal .wsite-multicol-col { display: flex; flex-direction: column; box-sizing: border-box; }
.wsite-multicol.se-equal .wsite-multicol-col > div:has(.colored-box),
.wsite-multicol.se-equal .wsite-multicol-col > div:has(.colored-box) > div,
.wsite-multicol.se-equal .platform-element-contents:has(.colored-box),
.wsite-multicol.se-equal .colored-box { display: flex; flex-direction: column; flex: 1 1 auto; }
.wsite-multicol.se-equal .colored-box-content { float: none; flex: 1 1 auto; }
}`;
function setEqualHeight(el, on, tds) {
  el.classList.toggle('se-equal', on);
  let st = [...el.children].find(c => c.matches && c.matches('style[data-se-equal]'));
  if (on && !st) { st = doc.createElement('style'); st.setAttribute('data-se-equal', ''); st.textContent = EQUAL_CSS; el.appendChild(st); }
  if (!on && st) st.remove();
  if (!on) return;
  // the spacer at the bottom of each column counts too: make them the same height, or the boxes still end at different lines
  const last = tds.map(td => { const l = td.lastElementChild; return l && l.classList.contains('wsite-spacer') ? l : null; });
  const h = Math.max(0, ...last.filter(Boolean).map(sp => parseInt(sp.style.height) || 0));
  if (!h) return;
  tds.forEach((td, i) => {
    if (last[i]) last[i].style.height = h + 'px';
    else { const sp = doc.createElement('div'); sp.className = 'wsite-spacer'; sp.style.height = h + 'px'; td.appendChild(sp); }
  });
}

function textInspector(el, root) {
  root.innerHTML = field('Align', choice('align', [...ALIGN, ['justify', 'Justify']], (el.style.textAlign || 'left'))) +
    (el.matches('h1,h2,h3,h4,h5,h6,.paragraph') || (P.theme && el.matches('p')) ? field('Type', choice('kind', [['title', 'Title'], ['text', 'Text']], el.matches('.paragraph, p') ? 'text' : 'title')) : '') +
    '<div class="actions"><button data-k="edit" class="primary">Edit text</button></div>';
  onChoice(root, 'align', live(v => { el.style.textAlign = v; }));
  onChoice(root, 'kind', v => mutate(() => {
    const n = doc.createElement(v === 'title' ? 'h2' : P.theme ? 'p' : 'div');
    if (!P.theme) n.className = v === 'title' ? 'wsite-content-title' : 'paragraph';
    if (el.getAttribute('style')) n.setAttribute('style', el.getAttribute('style'));
    n.innerHTML = el.innerHTML; el.replaceWith(n); selected = n;
  }));
  root.querySelector('[data-k=edit]').onclick = () => { startEdit(el); };
}

function appendBlockActions(el, root) {
  const div = document.createElement('div');
  div.className = 'actions';
  div.innerHTML = '<button data-k="up">↑ Up</button><button data-k="down">↓ Down</button><button data-k="dup">Duplicate</button><button data-k="del" class="danger">Delete</button>';
  div.querySelector('[data-k=up]').onclick = () => moveBlock(el, -1);
  div.querySelector('[data-k=down]').onclick = () => moveBlock(el, 1);
  div.querySelector('[data-k=dup]').onclick = () => duplicateBlock(el);
  div.querySelector('[data-k=del]').onclick = () => removeBlock(el);
  root.appendChild(div);
}

function appendAdvanced(el, root) {
  const det = document.createElement('details');
  det.className = 'adv';
  det.innerHTML = '<summary>Edit HTML (advanced)</summary><textarea spellcheck="false"></textarea><div class="actions"><button class="primary">Apply HTML</button></div>';
  const ta = det.querySelector('textarea');
  det.addEventListener('toggle', () => { if (det.open) ta.value = unBlob(unInert(el.outerHTML)); });
  det.querySelector('button').onclick = () => {
    const t = doc.createElement('template');
    t.innerHTML = ta.value.trim();
    const nodes = [...t.content.childNodes];
    if (!nodes.length) { status('Nothing to apply.'); return; }
    mutate(() => {
      const first = t.content.firstElementChild;
      el.replaceWith(...nodes);
      selected = first && first.isConnected ? (isSection(first) || isContainer(first.parentElement) ? first : blockOf(first)) : null;
    });
  };
  root.appendChild(det);
}

/* ---------------- privacy: does the page load anything from other websites? ----------------
   When a visitor opens a page, everything it loads from another website (fonts, scripts, forms,
   pictures, videos) tells that website the visitor's IP address. The page panel lists them. While
   editing, the editor blocks them (see EDIT_POLICY in local-backend.js and server.py). */
let outside = null;   // Map host -> Set of what
const isOutside = u => /^\s*(https?:)?\/\//i.test(u || '');
const hostOf = u => { try { return new URL(u.trim().replace(/^\/\//, 'https://')).host; } catch (e) { return u; } };
async function checkOutside(d) {
  const hosts = new Map();
  const add = (u, what) => { const h = hostOf(u); if (!hosts.has(h)) hosts.set(h, new Set()); hosts.get(h).add(what); };
  const cssRefs = (text, what) => {
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) if (isOutside(m[1])) add(m[1], what);
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) if (isOutside(m[1])) add(m[1], what);
  };
  const KIND = { SCRIPT: 'script', LINK: 'style or font', IFRAME: 'embedded page', IMG: 'picture', SOURCE: 'video or sound', VIDEO: 'video', AUDIO: 'sound', EMBED: 'embedded file', OBJECT: 'embedded file', INPUT: 'picture' };
  d.querySelectorAll('script[src], link[href], iframe[src], img[src], source[src], video[src], video[poster], audio[src], embed[src], object[data], input[src]').forEach(el => {
    if (el.closest('[data-editor]')) return;
    if (el.tagName === 'LINK' && !/stylesheet|icon|preload|prefetch|preconnect|dns-prefetch|manifest/i.test(el.getAttribute('rel') || '')) return;
    for (const a of ['src', 'href', 'poster', 'data']) { const v = el.getAttribute(a); if (v && isOutside(v)) add(v, KIND[el.tagName] || 'file'); }
  });
  d.querySelectorAll('[style]').forEach(el => cssRefs(el.getAttribute('style'), 'picture'));
  d.querySelectorAll('style:not([data-editor])').forEach(el => cssRefs(el.textContent, 'style or font'));
  // the page's own style sheets (and the ones they import)
  const seen = new Set(), queue = [];
  d.querySelectorAll('link[rel~="stylesheet"][href]').forEach(l => { const h = unBlob(l.getAttribute('href')); if (!isOutside(h)) queue.push(resolveRef('', h)); });
  while (queue.length) {
    const p = queue.shift(); if (!p || seen.has(p) || seen.size > 40) continue; seen.add(p);
    let text; try { text = await (await B.readFile('site', p)).text(); } catch (e) { continue; }
    cssRefs(text, 'style or font (' + p + ')');
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) if (!isOutside(m[1])) queue.push(resolveRef(dir, m[1]));
  }
  return { doc: d, hosts };
}
function outsideNote() {
  if (!outside || !outside.size) return outside ? '<p class="hint">✓ This page loads nothing from other websites.</p>' : '';
  const fromTemplate = P.theme && [...outside.values()].some(s => [...s].some(w => /\(assets\//.test(w)));
  return `<div class="note"><b>This page loads things from other websites</b>, so visitors' browsers tell them they are here (their IP address):
    <ul class="tips">${[...outside].map(([h, w]) => `<li><b>${esc(h)}</b>: ${esc([...w].join(', '))}</li>`).join('')}</ul>
    While you edit, the editor blocks them. Remove or replace the element that loads them${fromTemplate ? ', or update the template files (newer templates load nothing from other websites)' : ''}.
    ${fromTemplate ? '<div class="actions"><button id="goTplFiles">Update the template’s files</button></div>' : ''}</div>`;
}

/* images: see images.js */
function imgAlignOf(img) {
  if (img.style.marginLeft !== 'auto') return 'left';
  return img.style.marginRight === 'auto' ? 'center' : 'right';
}

/* ---------------- saving ---------------- */
function doctypeOf(d) {
  const dt = d.doctype;
  if (!dt) return '<!DOCTYPE html>';
  return '<!DOCTYPE ' + dt.name + (dt.publicId ? ` PUBLIC "${dt.publicId}"` : '') + (dt.systemId ? ` "${dt.systemId}"` : '') + '>';
}

function serialize() {
  const c = doc.documentElement.cloneNode(true);
  const body = c.querySelector('body');
  if (body) removedBodyClasses.forEach(k => body.classList.add(k));
  c.querySelectorAll('[data-editor]').forEach(n => n.remove());
  c.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  c.querySelectorAll('[data-ed-empty]').forEach(n => n.removeAttribute('data-ed-empty'));
  c.querySelectorAll('script[data-ed-type]').forEach(s => {
    const t = s.getAttribute('data-ed-type');
    s.removeAttribute('data-ed-type');
    if (t) s.setAttribute('type', t); else s.removeAttribute('type');
  });
  return doctypeOf(doc) + '\n' + leadingComments(doc) + unBlob(c.outerHTML) + '\n';
}
// comments before <html> (such as a template's credit) are kept
function leadingComments(d) {
  let out = '';
  for (const n of d.childNodes) { if (n === d.documentElement) break; if (n.nodeType === 8) out += '<!--' + n.data + '-->\n'; }
  return out;
}

function unInert(html) {
  return html.replace(/<script data-ed-type="([^"]*)" type="text\/x-inert"/g, (m, t) => t ? `<script type="${t}"` : '<script');
}

async function save() {
  if (!doc) return false;
  if (editing) endEdit();
  if (doc.querySelector('img[src^="data:image/svg+xml"]')) status('Note: an image placeholder is still on the page.');
  try {
    $('#btnSave').disabled = true;
    const html = serialize();
    if (/blob:/.test(html)) throw new Error('the page still contains a temporary image address. Reload the page and try again.');
    await B.savePage(page, html);
    setDirty(false);
    let dateNote = '';
    try { const d = typeof syncProjectDate === 'function' ? await syncProjectDate() : ''; if (d) dateNote = ' The project card on the overview now shows ' + d + '.'; } catch (e) { dateNote = ' (The date on the project card could not be updated: ' + e.message + ')'; }
    if (P.theme && loadedShared) {
      const now = sharedRegions(html), changed = new Map([...now].filter(([k, v]) => loadedShared.get(k) !== v));
      loadedShared = now;
      if (changed.size) {
        status('Copying ' + [...changed.keys()].join(', ') + ' to the other pages…', true);
        const n = await copySharedToPages(changed, page);
        if (n) { status('Saved. The ' + [...changed.keys()].join(', ') + ' changed on ' + n + ' other page' + (n === 1 ? '' : 's') + ' too.' + dateNote); if (isLoaded()) updateDownload(); refreshPages().catch(() => {}); return true; }
      }
    }
    if (isLoaded()) { status('Saved in the editor. Use “Download site” to keep it.' + dateNote); updateDownload(); }
    else status('Saved ' + page + '.' + dateNote);
    refreshPages().catch(() => {});
    return true;
  } catch (e) {
    $('#btnSave').disabled = false;
    status('Save failed: ' + e.message, true);
    return false;
  }
}

/* ---------------- page settings ---------------- */
function setDescription(v) {
  let m = doc.querySelector('meta[name="description"]');
  if (v === null || v === undefined || v === '') { if (m) m.remove(); return; }
  if (!m) { m = doc.createElement('meta'); m.setAttribute('name', 'description'); doc.head.appendChild(m); }
  m.setAttribute('content', v);
}
async function openPageSettings() {
  if (!doc) return;
  const m = doc.querySelector('meta[name="description"]');
  const r = await modal('Page settings', `
    ${field('Title in the browser tab and search results', `<input type="text" id="psTitle" value="${esc(doc.title)}">`)}
    ${field('Description for search engines (one or two sentences)', `<textarea id="psDesc" style="min-height:80px;font-family:inherit;font-size:14px">${esc(m ? m.getAttribute('content') : '')}</textarea>`)}
    <p class="hint">File: ${esc(page)}. To change the name in the menu, use Pages &amp; menu.</p>`,
  [['cancel', 'Cancel'], ['ok', 'Apply', 'primary']], () => ({ title: $('#psTitle').value, desc: $('#psDesc').value.trim() }));
  if (!r || r.value !== 'ok') return;
  mutate(() => { doc.title = r.data.title; setDescription(r.data.desc); });
}

/* ---------------- pages & menu ---------------- */
async function openPagesDialog() {
  await refreshPages();
  const menu = (await B.menu()).map(i => ({ ...i }));
  const state = { menu };
  const body = document.createElement('div');
  const draw = () => {
    const pageOpts = cur => pagesList.map(p => `<option value="${esc(p.file)}" ${p.file === cur ? 'selected' : ''}>${esc(p.file)}</option>`).join('') +
      `<option value="__url" ${pagesList.some(p => p.file === cur) ? '' : 'selected'}>Web address…</option>`;
    body.innerHTML = `<div class="sec-title">Menu (shown on every page)</div>` +
      state.menu.map((it, i) => `<div class="menurow" data-i="${i}">
          <input type="text" data-k="title" value="${esc(it.title)}" aria-label="Menu label">
          <select data-k="url">${pageOpts(it.url)}</select>
          <div class="ctl"><button data-k="up" ${i ? '' : 'disabled'} title="Move up">↑</button><button data-k="down" ${i < state.menu.length - 1 ? '' : 'disabled'} title="Move down">↓</button><button data-k="rm" title="Remove from menu">✕</button></div>
          ${pagesList.some(p => p.file === it.url) ? '' : `<input class="ext" type="url" data-k="ext" placeholder="https://…" value="${esc(it.url)}">`}
        </div>`).join('') +
      `<div class="actions" style="margin-top:8px"><button data-k="addItem">+ Menu item</button></div>
      <div class="sec-title">Pages</div>` +
      pagesList.map(p => `<div class="pagerow"><span class="nm">${esc(p.title)} <span class="fn">${esc(p.file)}${state.menu.some(m => m.url === p.file) ? '' : ' · not in menu'}</span></span>
          <button data-open="${esc(p.file)}">Edit</button><button data-dup="${esc(p.file)}">Duplicate</button>
          ${p.file === 'index.html' ? '' : `<button class="danger" data-del="${esc(p.file)}">Delete</button>`}</div>`).join('') +
      `<div class="actions" style="margin-top:10px"><button class="primary" data-k="newPage">+ New page</button></div>`;
    body.querySelectorAll('.menurow').forEach(row => {
      const i = +row.dataset.i, it = state.menu[i];
      row.querySelector('[data-k=title]').oninput = e => { it.title = e.target.value; };
      row.querySelector('[data-k=url]').onchange = e => { it.url = e.target.value === '__url' ? 'https://' : e.target.value; draw(); };
      const ext = row.querySelector('[data-k=ext]'); if (ext) ext.oninput = e => { it.url = e.target.value; it.target = '_blank'; };
      row.querySelector('[data-k=up]').onclick = () => { state.menu.splice(i - 1, 0, state.menu.splice(i, 1)[0]); draw(); };
      row.querySelector('[data-k=down]').onclick = () => { state.menu.splice(i + 1, 0, state.menu.splice(i, 1)[0]); draw(); };
      row.querySelector('[data-k=rm]').onclick = () => { state.menu.splice(i, 1); draw(); };
    });
    body.querySelector('[data-k=addItem]').onclick = () => {
      const notIn = pagesList.find(p => !state.menu.some(m => m.url === p.file));
      state.menu.push({ id: '', title: notIn ? notIn.title : 'New item', url: notIn ? notIn.file : 'index.html', target: '' }); draw();
    };
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => closeModal({ value: 'open', file: b.dataset.open }));
    body.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => closeModal({ value: 'dup', file: b.dataset.dup }));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => closeModal({ value: 'del', file: b.dataset.del }));
    body.querySelector('[data-k=newPage]').onclick = () => closeModal({ value: 'new' });
  };
  draw();
  const r = await modal('Pages & menu', body, [['cancel', 'Close'], ['savemenu', 'Save menu', 'primary']]);
  if (!r) return;
  const act = r.value || r;
  if (act === 'savemenu') return saveMenu(state.menu);
  if (act === 'open') return switchPage(r.file);
  if (act === 'dup') return newPageDialog(r.file, true);
  if (act === 'new') return newPageDialog(page, false);
  if (act === 'del') return deletePage(r.file);
}

async function saveMenu(menu) {
  if (!(await confirmLeaveForSiteChange())) return;
  try {
    await B.saveMenu(menu.filter(m => m.url && m.url !== 'https://'));
    status('Menu updated on all pages.');
    loadPage(page);
  } catch (e) { status('Menu not saved: ' + e.message, true); }
}

async function confirmLeaveForSiteChange() {
  if (!dirty) return true;
  const r = await modal('Save first?', '<p>This changes every page, so your unsaved changes on this page need saving first.</p>',
    [['cancel', 'Cancel'], ['save', 'Save and continue', 'primary']]);
  return r === 'save' && await save();
}

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'page';
}

async function newPageDialog(fromFile, duplicate) {
  const r = await modal(duplicate ? 'Duplicate page' : 'New page', `
    ${field('Page name', `<input type="text" id="npTitle" value="${duplicate ? esc((pagesList.find(p => p.file === fromFile) || {}).title || '') + ' copy' : ''}" placeholder="For example: Workshops">`)}
    ${duplicate ? `<p class="hint">Copies everything on ${esc(fromFile)}.</p>` : `<p class="hint">Starts with the same banner and style as <b>${esc(fromFile)}</b> and one empty section.</p>`}
    <label class="row"><input type="checkbox" id="npMenu" checked> Add to the menu</label>`,
  [['cancel', 'Cancel'], ['ok', 'Create page', 'primary']], () => ({ title: $('#npTitle').value.trim(), menu: $('#npMenu').checked }));
  if (!r || r.value !== 'ok' || !r.data.title) return;
  if (!(await confirmLeaveForSiteChange())) return;
  try {
    let file = slugify(r.data.title) + '.html', n = 2;
    while (pagesList.some(p => p.file === file)) file = slugify(r.data.title) + '-' + (n++) + '.html';
    const src = await B.readText(fromFile);
    const d = new DOMParser().parseFromString(src, 'text/html');
    d.title = P.theme ? r.data.title + (CFG.site && CFG.site.name ? ' | ' + CFG.site.name : '') : r.data.title;
    if (!duplicate) {
      if (P.theme) themePageBody(d, fillTpl((CFG.newPage && CFG.newPage.main) || CFG.elements.section, { title: r.data.title }));
      else { const main = d.getElementById('wsite-content'); if (main) main.innerHTML = T.section().replace('New section', esc(r.data.title)); }
    }
    await B.savePage(file, docHtml(src, d), true);
    const menu = await B.menu();
    if (r.data.menu) menu.push({ id: '', title: r.data.title, url: file, target: '' });
    await B.saveMenu(menu);
    await refreshPages();
    loadPage(file);
    status('Page created: ' + file);
  } catch (e) { status('Could not create the page: ' + e.message, true); }
}

async function linksTo(file) {
  // links to this page in page content (the menu is updated automatically)
  const out = [];
  for (const p of pagesList) {
    if (p.file === file) continue;
    let html = '';
    try { html = await B.readText(p.file); } catch (e) { continue; }
    html = html.replace(/<ul class="wsite-menu-default">[\s\S]*?<\/ul>/g, '').replace(/initPublishedFlyoutMenus\([\s\S]*?\);/g, '').replace(/<ul[^>]*data-se="menu"[^>]*>[\s\S]*?<\/ul>/g, '');
    const n = (html.match(new RegExp('href=["\']' + file.replace(/[.]/g, '\\.') + '(#[^"\']*)?["\']', 'g')) || []).length;
    if (n) out.push(`${p.title} (${n})`);
  }
  return out;
}

async function deletePage(file) {
  const links = await linksTo(file).catch(() => []);
  const where = B.backupsLocation();
  const r = await modal('Delete page?', `<p>Delete <b>${esc(file)}</b> and remove it from the menu?${where ? ` A copy is kept in <i>${esc(where)}</i>.` : ''}</p>` +
    (links.length ? `<div class="note">Buttons or links on these pages still point to it and will stop working: <b>${esc(links.join(', '))}</b>. Change them after deleting.</div>` : ''),
    [['cancel', 'Cancel'], ['del', 'Delete page', 'primary']]);
  if (r !== 'del') return;
  if (file !== page && !(await confirmLeaveForSiteChange())) return;
  try {
    await B.deletePage(file);
    await refreshPages();
    if (file === page) { dirty = false; loadPage('index.html'); } else loadPage(page);
    status('Deleted ' + file);
  } catch (e) { status('Could not delete: ' + e.message, true); }
}

/* ---------------- link dialog ---------------- */
async function linkDialog(href, newTab) {
  const isPage = pagesList.some(p => p.file === href);
  const r = await modal('Link', `
    ${field('Link to', `<select id="lkPage">${pagesList.map(p => `<option value="${esc(p.file)}" ${p.file === href ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="__url" ${isPage ? '' : 'selected'}>Web address, email or phone…</option></select>`)}
    <div class="fld" id="lkRow" ${isPage ? 'hidden' : ''}><input type="url" id="lkUrl" value="${esc(isPage ? '' : (href || ''))}" placeholder="https://…  or  mailto:you@example.com"></div>
    <label class="row"><input type="checkbox" id="lkNew" ${newTab ? 'checked' : ''}> Open in a new tab</label>`,
  [['cancel', 'Cancel'], ['ok', 'Apply', 'primary']], () => {
    const p = $('#lkPage').value;
    return { url: p === '__url' ? $('#lkUrl').value.trim() : p, newTab: $('#lkNew').checked };
  }, () => { $('#lkPage').onchange = () => { $('#lkRow').hidden = $('#lkPage').value !== '__url'; }; });
  if (!r || r.value !== 'ok' || !r.data.url) return null;
  return r.data;
}

/* ---------------- modal ---------------- */
let modalResolve = null;
function modal(title, body, buttons, collect, onOpen) {
  return new Promise(resolve => {
    const m = $('#modal');
    $('h2', m).textContent = title;
    const b = $('.body', m); b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
    const btns = $('.btns', m); btns.innerHTML = '';
    for (const [v, label, cls] of buttons) {
      const x = document.createElement('button');
      x.textContent = label; if (cls) x.className = cls;
      x.onclick = () => closeModal(collect && v !== 'cancel' ? { value: v, data: collect() } : v);
      btns.appendChild(x);
    }
    modalResolve = resolve;
    m.hidden = false;
    if (onOpen) onOpen();
    const first = b.querySelector('input, textarea, select');
    if (first) first.focus();
  });
}
function closeModal(v) { $('#modal').hidden = true; const r = modalResolve; modalResolve = null; if (r) r(v === 'cancel' ? null : v); }
$('#modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal('cancel');
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = $('#modal .btns .primary'); if (p) p.click(); }
});

/* ---------------- utils ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function rgbToHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
  if (!m || m[4] === '0') return null;
  return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('');
}
function posKey(p) { p = (p || '').trim(); if (/0%$|top/.test(p) && !/100%/.test(p)) return '50% 0%'; if (/100%|bottom/.test(p)) return '50% 100%'; return '50% 50%'; }

/* ---------------- top bar ---------------- */
$('#pageSel').onchange = e => switchPage(e.target.value);
$('#btnSave').onclick = save;
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnPages').onclick = openPagesDialog;
$('#btnImages').onclick = () => openOptimise();
$('#btnPageSettings').onclick = openPageSettings;
$('#btnPreview').onclick = async () => {
  if (dirty) {
    const r = await modal('Preview', '<p>Preview shows the saved page. Save your changes first?</p>', [['cancel', 'Cancel'], ['skip', 'Preview without saving'], ['save', 'Save and preview', 'primary']]);
    if (!r) return;
    if (r === 'save' && !(await save())) return;
  }
  if (!blobMode) { window.open('site/' + encodeURIComponent(page), '_blank'); return; }
  // opened from disk: a one-off copy with in-browser addresses (links to other pages don't work there)
  // (written into a blank tab of the editor itself: a page opened from disk may only use its own in-browser addresses)
  const w = window.open('', '_blank');
  if (!w) { status('The browser blocked the preview window. Allow pop-ups for the editor.', true); return; }
  const html = await blobifyPage(await B.readText(page));
  w.document.open(); w.document.write(html); w.document.close();
};
$('#vDesk').onclick = () => { wrap.classList.remove('mobile'); $('#vDesk').classList.add('on'); $('#vMob').classList.remove('on'); };
$('#vMob').onclick = () => { wrap.classList.add('mobile'); $('#vMob').classList.add('on'); $('#vDesk').classList.remove('on'); };
window.addEventListener('beforeunload', e => { if (dirty || (isLoaded() && Local.store().notDownloaded())) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- start ---------------- */
const isLoaded = () => B === Local && Local.store() && Local.store().kind === 'memory';

async function isServer() {
  if (location.protocol === 'file:') return false;
  try { const r = await fetch('__api/pages', { cache: 'no-store' }); return r.ok && /json/.test(r.headers.get('content-type') || ''); }
  catch (e) { return false; }
}

function updateDownload() {
  const b = $('#btnDownload');
  b.hidden = !isLoaded();
  if (!b.hidden) b.classList.toggle('primary', Local.store().notDownloaded());
}

async function startEditing() {
  $('#start').hidden = true;
  const f = $('#btnFolder');
  if (B === Local) { f.hidden = false; f.textContent = (isLoaded() ? '📦 ' : '📁 ') + Local.store().label; }
  updateDownload();
  if (isLoaded()) {
    const sess = await Local.pending();
    const n = Local.sessionCount(sess);
    if (n) {
      const r = await modal('Unsaved work found', `<p>You have <b>${n}</b> changed file${n === 1 ? '' : 's'} for this site from
        ${esc(new Date(sess.time).toLocaleString())} that were not downloaded. Continue with them?</p>`,
      [['cancel', 'Start fresh'], ['restore', 'Continue with my changes', 'primary']]);
      if (r === 'restore') Local.store().restore(sess); else await Local.store().forgetSession();
      updateDownload();
    }
  }
  await loadSiteConfig();
  try { await refreshPages(); } catch (e) { status('Cannot read the pages: ' + e.message, true); return; }
  const want = decodeURIComponent(location.hash.slice(1));
  loadPage(pagesList.some(p => p.file === want) ? want : (pagesList.some(p => p.file === 'index.html') ? 'index.html' : pagesList[0].file));
}

async function showStart() {
  $('#start').hidden = false;
  const msg = $('#startMsg');
  msg.textContent = '';
  blobMode = !(await Local.init());     // no service worker (opened from disk): pages are shown another way
  $('#optFolder').hidden = !Local.canOpenFolder();
  const last = Local.lastFolderName(), reo = $('#btnReopen');
  reo.hidden = !(last && Local.canOpenFolder());
  if (last) reo.textContent = 'Open “' + last + '” again';
  const go = async fn => {
    msg.textContent = '';
    try { await fn(); B = Local; await startEditing(); }
    catch (e) { if (e.name !== 'AbortError') msg.textContent = e.message; }
  };
  reo.onclick = () => go(() => Local.reopenFolder());
  const lib = await Local.libraryInfo();
  $('#optContinue').hidden = !lib;
  if (lib) {
    $('#btnContinue').textContent = 'Continue with “' + lib.label + '”';
    $('#contInfo').textContent = lib.count + ' files, copied into this browser on ' + new Date(lib.time).toLocaleString() +
      '. Changes you made but did not download are offered when it opens. Download site is still the real save.';
  }
  $('#btnContinue').onclick = () => go(() => Local.loadLibrary());
  $('#btnForgetLib').onclick = async () => { await Local.forgetLibrary(); $('#optContinue').hidden = true; };
  if (!showStart.dropBound) {
    showStart.dropBound = true;
    const st = $('#start');
    ['dragenter', 'dragover'].forEach(t => st.addEventListener(t, e => { e.preventDefault(); st.classList.add('drop'); }));
    st.addEventListener('dragleave', e => { if (e.target === st) st.classList.remove('drop'); });
    st.addEventListener('drop', e => {
      e.preventDefault(); st.classList.remove('drop');
      const dt = e.dataTransfer, files = [...dt.files];
      const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);   // read now: items expire after the event
      go(async () => { $('#startMsg').textContent = 'Reading the dropped site…'; await Local.loadDropped(entries, files); });
    });
  }
  $('#btnChoose').onclick = () => go(() => Local.openFolder());
  $('#btnLoadFolder').onclick = () => { $('#inFolder').value = ''; $('#inFolder').click(); };
  $('#btnLoadZip').onclick = () => { $('#inZip').value = ''; $('#inZip').click(); };
  $('#inFolder').onchange = () => { const fl = $('#inFolder').files; if (fl.length) go(async () => { msg.textContent = 'Reading ' + fl.length + ' files…'; Local.loadFileList(fl); }); };
  $('#inZip').onchange = () => { const z = $('#inZip').files[0]; if (z) go(async () => { msg.textContent = 'Opening ' + z.name + '…'; await Local.loadZip(z); }); };
}

async function downloadWhole() {
  if (!isLoaded()) return;
  if (dirty && !(await save())) return;
  const b = $('#btnDownload');
  b.disabled = true;
  try {
    const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    status('Checking which files the pages use…', true);
    const scan = await scanSite();
    const unusedSize = scan.unused.reduce((t, f) => t + f.size, 0);
    let leaveOut = new Set();
    if (scan.unused.length) {
      const r = await modal('Download site', `<p>The zip contains a <b>docs</b> folder (the site) and an <b>image-originals</b> folder (your original photos and image edits).
        Put both in your website folder, replacing the old docs folder.</p>
        <label class="row"><input type="checkbox" id="dlLeave" checked> Leave out ${scan.unused.length} files no page uses (${fmtSize(unusedSize)})</label>`,
      [['cancel', 'Cancel'], ['ok', 'Download', 'primary']], () => ({ leave: $('#dlLeave').checked }));
      if (!r || r.value !== 'ok') { b.disabled = false; showSaveState(); return; }
      if (r.data.leave) leaveOut = new Set(scan.unused.map(f => f.path));
    }
    const blob = await Local.store().exportZip({ leaveOut }, pct => { status('Making the zip… ' + Math.round(pct) + '%', true); });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'website-' + day + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    status('Downloaded ' + a.download + ' (' + (blob.size / 1048576).toFixed(0) + ' MB). Put its docs and image-originals folders in your website folder.', true);
    updateDownload();
  } catch (e) { status('Download failed: ' + e.message, true); }
  b.disabled = false;
}
// Download site: the whole site, or only what changed since the site was loaded
async function downloadSite() {
  if (!isLoaded()) return;
  if (dirty && !(await save())) return;
  const n = Local.store().changeCount();
  if (!n) return downloadWhole();
  const r = await modal('Download site', `<p>What do you want to download?</p>
    <label class="row"><input type="radio" name="dlKind" value="whole" checked> <span><b>The whole site</b> as one .zip. Safest: you replace your website's <b>docs</b> folder with it.</span></label>
    <label class="row"><input type="radio" name="dlKind" value="changes"> <span><b>Only the changes</b> (about ${n} file${n === 1 ? '' : 's'} changed since you loaded the site). A much smaller .zip, but you have to put the files in place yourself; the next window explains how.</span></label>`,
  [['cancel', 'Cancel'], ['ok', 'Download', 'primary']], () => ({ kind: ($('input[name=dlKind]:checked') || {}).value }));
  if (!r || r.value !== 'ok') return;
  return r.data.kind === 'changes' ? downloadChanges() : downloadWhole();
}

async function downloadChanges() {
  const b = $('#btnDownload');
  b.disabled = true;
  try {
    const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const { blob, put, gone } = await Local.store().exportChanges(pct => { status('Making the zip… ' + Math.round(pct) + '%', true); });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'website-changes-' + day + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    const list = (arr, max) => '<ul style="max-height:130px;overflow:auto;margin:4px 0 8px;padding-left:20px;font-size:12.5px">' +
      arr.slice(0, max).map(p => '<li>' + esc(p) + '</li>').join('') + (arr.length > max ? '<li>… and ' + (arr.length - max) + ' more</li>' : '') + '</ul>';
    await modal('Put the changes in place yourself', `<p><b>${esc(a.download)}</b> is in your downloads (${fmtSize(blob.size)}). It holds only the ${put.length} file${put.length === 1 ? '' : 's'} you changed.
      The editor cannot write into your folder in this browser, so:</p>
      <ol style="padding-left:20px;margin:6px 0">
        <li>Open the .zip so you get a <b>docs</b> folder (and maybe an <b>image-originals</b> folder).</li>
        <li>Drag them into your website folder <b>while holding the Option key</b> and choose <b>Merge</b>.</li>
        <li><b>Do not choose Replace</b>: that would delete every file that is not in this zip.</li>
      </ol>
      ${put.length ? '<p style="margin:6px 0 0">Files in the zip:</p>' + list(put, 30) : ''}
      ${gone.length ? '<p style="margin:6px 0 0"><b>Delete these yourself</b> (you removed them in the editor):</p>' + list(gone, 30) : ''}
      <p style="margin:6px 0 0">The same instructions are in the zip, in <i>READ ME - changes.txt</i>.</p>`,
    [['ok', 'Done', 'primary']]);
    status('Downloaded ' + a.download + '. Merge its folders into your website folder.', true);
    updateDownload();
  } catch (e) { status('Download failed: ' + e.message, true); }
  b.disabled = false;
}
$('#btnDownload').onclick = downloadSite;

$('#btnFolder').onclick = async () => {
  if (!(await confirmLeave())) return;
  if (isLoaded() && Local.store().notDownloaded()) {
    const r = await modal('Not downloaded yet', '<p>Your changes to this site are kept in the browser, but have not been downloaded. Switch site anyway?</p>',
      [['cancel', 'Cancel'], ['go', 'Switch site', 'primary']]);
    if (r !== 'go') return;
  }
  dirty = false; doc = null; CFG = null; P = WEEBLY; frame.removeAttribute('srcdoc'); frame.src = 'about:blank'; selected = null; renderInspector(); resetBlobs();
  $('#btnFolder').hidden = true; $('#btnDownload').hidden = true;
  showStart();
};

(async function init() {
  requestAnimationFrame(tick);
  if (await isServer()) { B = ServerB; await startEditing(); return; }
  showStart();
})();

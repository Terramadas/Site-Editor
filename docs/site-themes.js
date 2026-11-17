'use strict';
/* Sites made from a template (themes/): site settings, buttons and columns in the template's
   style, project cards, "New project" and "New website". Weebly sites don't use any of this. */

/* ---------------- the site's own settings (assets/site-editor.json) ---------------- */
const SITE_CONFIG = 'assets/site-editor.json';

async function loadSiteConfig() {
  CFG = null; P = WEEBLY;
  try {
    const b = await B.readFile('site', SITE_CONFIG);
    CFG = JSON.parse(await b.text());
    P = themeProfile(CFG);
  } catch (e) { /* no config: a Weebly site */ }
  $$('.pal').forEach(b => { b.hidden = P.theme && !themeElement(b.dataset.type); });
  $('#btnSite').hidden = !P.theme;
  $('#palProject').hidden = !(P.theme && CFG.project && CFG.project.card);
}
async function saveSiteConfig() {
  await B.writeFile('site', SITE_CONFIG, new Blob([JSON.stringify(CFG, null, 1)], { type: 'application/json' }));
}

// {{key}} -> value (made safe for HTML); <!--se:if key-->…<!--/se:if--> only when the value is set
function fillTpl(tpl, values) {
  return String(tpl)
    .replace(/<!--se:if (\w+)-->([\s\S]*?)<!--\/se:if-->/g, (m, k, inner) => (values[k] ? inner : ''))
    .replace(/\{\{([a-z]\w*)\}\}/g, (m, k) => esc(values[k] == null ? '' : values[k]));
}

// a whole page as text: what was before <html> (doctype, the template's credit) is kept as it was
function docHtml(src, d) {
  const i = src.search(/<html[\s>]/i);
  return (i > 0 ? src.slice(0, i) : doctypeOf(d) + '\n') + d.documentElement.outerHTML + '\n';
}

// a new page: same header, menu and footer as the page it is made from, with new content
function themePageBody(d, mainHtml) {
  const root = d.querySelector(P.sectionsRoot);
  if (root) root.innerHTML = '\n' + mainHtml.replace(/\s+$/, '') + '\n\t\t\t';
  const np = CFG.newPage || {};
  (np.remove || []).forEach(sel => d.querySelectorAll(sel).forEach(n => n.remove()));
  (np.removeClass || []).forEach(([sel, cls]) => d.querySelectorAll(sel).forEach(n => { n.classList.remove(cls); if (!n.getAttribute('class')) n.removeAttribute('class'); }));
  const active = (CFG.menu && CFG.menu.activeClass) || 'active';
  d.querySelectorAll('[data-se~="menu"] > li.' + active).forEach(li => { li.classList.remove(active); if (!li.getAttribute('class')) li.removeAttribute('class'); });
}

function uniquePageName(title) {
  let file = slugify(title) + '.html', n = 2;
  while (pagesList.some(p => p.file === file)) file = slugify(title) + '-' + (n++) + '.html';
  return file;
}
const todayText = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/* ---------------- buttons (ul.actions > li > a.button) ---------------- */
function themeButtons(el, root) {
  const list = el.matches('ul.actions') ? el : el.querySelector('ul.actions');
  if (!list) { root.innerHTML = ''; return; }
  const btns = [...list.querySelectorAll(':scope > li > a.button')];
  root.innerHTML = btns.map((a, i) => `<div class="btnbox" data-i="${i}">
      ${field('Button ' + (btns.length > 1 ? i + 1 : '') + ' text', `<div class="row"><input type="text" data-k="txt" value="${esc(a.textContent.trim())}">${btns.length > 1 ? '<button data-k="rm" title="Remove this button">✕</button>' : ''}</div>`)}
      ${linkFields(a.getAttribute('href') || '', a.getAttribute('target'))}
      ${field('Style', choice('style' + i, [['primary', 'Filled'], ['normal', 'Outline']], a.classList.contains('primary') ? 'primary' : 'normal'))}
    </div>`).join('') +
    `<div class="actions"><button data-k="add">+ Button</button></div>` +
    field('Size', choice('size', [['large', 'Large'], ['normal', 'Normal']], btns[0] && btns[0].classList.contains('large') ? 'large' : 'normal')) +
    field('Align', choice('align', [['left', 'Left'], ['special', 'Centre']], list.classList.contains('special') ? 'special' : 'left'));
  root.querySelectorAll('.btnbox').forEach(box => {
    const a = btns[+box.dataset.i];
    const t = box.querySelector('[data-k=txt]');
    t.oninput = live(() => {
      // keep an icon (it's in the class) and change only the words
      a.textContent = t.value;
    });
    bindLink(box, (href, nt) => { a.setAttribute('href', href); if (nt) a.setAttribute('target', '_blank'); else a.removeAttribute('target'); });
    onChoice(box, 'style' + box.dataset.i, live(v => a.classList.toggle('primary', v === 'primary')));
    const rm = box.querySelector('[data-k=rm]');
    if (rm) rm.onclick = () => mutate(() => { a.closest('li').remove(); selected = el; });
  });
  root.querySelector('[data-k=add]').onclick = () => mutate(() => {
    const li = doc.createElement('li');
    li.innerHTML = '<a href="index.html" class="button">Button text</a>';
    if (btns[0] && btns[0].classList.contains('large')) li.firstChild.classList.add('large');
    list.appendChild(li); selected = el;
  });
  onChoice(root, 'size', live(v => list.querySelectorAll('a.button').forEach(a => a.classList.toggle('large', v === 'large'))));
  onChoice(root, 'align', live(v => list.classList.toggle('special', v === 'special')));
}

/* ---------------- columns (the template's 12-part grid) ---------------- */
function themeColumns(el, root) {
  const row = el.matches(P.cols) ? el : el.querySelector(P.cols);
  const cols = [...row.children].filter(isColumn);
  const spanOf = c => +((/(?:^|\s)col-(\d+)(?:\s|$)/.exec(c.className) || [])[1] || Math.round(12 / cols.length));
  const stack = cols.every(c => /(?:^|\s)col-12-small(?:\s|$)/.test(c.className));
  const spans = cols.map(spanOf);
  const widths = cols.length === 2 ? (spans[0] > spans[1] ? 'left' : spans[0] < spans[1] ? 'right' : 'equal') : 'equal';
  root.innerHTML = field('Number of columns', choice('n', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(cols.length))) +
    (cols.length === 2 ? field('Widths', choice('w', [['equal', 'Equal'], ['left', 'Wide left'], ['right', 'Wide right']], widths)) : '') +
    `<div class="fld"><label class="row"><input type="checkbox" data-k="stack" ${stack ? 'checked' : ''}> On phones, put the columns under each other</label></div>`;
  const setClasses = (list, sp, st) => list.forEach((c, i) => {
    c.className = c.className.replace(/(?:^|\s)col-\d+(?:-[a-z]+)?(?=\s|$)/g, '').trim();
    c.classList.add('col-' + sp[i]);
    if (st) c.classList.add('col-12-small');
  });
  onChoice(root, 'n', v => mutate(() => {
    const n = +v;
    let list = [...row.children].filter(isColumn);
    while (list.length < n) { const c = doc.createElement('div'); c.setAttribute('data-se', 'col'); row.appendChild(c); list.push(c); }
    while (list.length > n) { const last = list.pop(), prev = list[list.length - 1]; while (last.firstChild) prev.appendChild(last.firstChild); last.remove(); }
    setClasses(list, list.map(() => Math.floor(12 / n)), root.querySelector('[data-k=stack]').checked);
    selected = el;
  }));
  onChoice(root, 'w', live(v => setClasses(cols, v === 'left' ? [8, 4] : v === 'right' ? [4, 8] : [6, 6], root.querySelector('[data-k=stack]').checked)));
  root.querySelector('[data-k=stack]').onchange = live(() => setClasses(cols, cols.map(spanOf), root.querySelector('[data-k=stack]').checked));
}

/* ---------------- project cards ---------------- */
INSPECTORS.project = (el, root) => {
  const img = el.querySelector('img');
  const date = el.querySelector('.date');
  const head = el.querySelector('h1, h2, h3');
  const titleLink = head && head.querySelector('a');
  const pageHref = titleLink ? titleLink.getAttribute('href') || '' : '';
  const gh = el.querySelector('a.fa-github');
  root.innerHTML =
    field('Picture', img ? `<div class="thumb" style="background-image:url('${esc(img.src)}');background-size:cover"></div>
      <div class="actions"><button data-k="edit" class="primary">Edit image</button><button data-k="rep">Replace image</button></div>` : '<p class="hint">No picture.</p>') +
    field('Title', `<input type="text" data-k="title" value="${esc(head ? head.textContent.trim() : '')}">`) +
    (date ? field('Date', `<input type="text" data-k="date" value="${esc(date.textContent.trim())}">`) : '') +
    field('Project page', `<select data-k="page">${pagesList.map(p => `<option value="${esc(p.file)}" ${p.file === pageHref ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select>`) +
    field('GitHub address', `<input type="url" data-k="gh" placeholder="https://github.com/you/project (empty: no button)" value="${esc(gh ? gh.getAttribute('href') : '')}">`) +
    '<p class="hint">Click the short text on the card to change it.</p>' +
    `<div class="actions"><button data-k="open" ${pagesList.some(p => p.file === pageHref) ? '' : 'disabled'}>Open the project page</button></div>`;
  const q = k => root.querySelector(`[data-k=${k}]`);
  if (img) { q('edit').onclick = () => openImageEditor({ kind: 'img', img }); q('rep').onclick = () => replaceImage(img); }
  q('title').oninput = live(() => { (titleLink || head).textContent = q('title').value; if (img) img.setAttribute('alt', q('title').value); });
  if (date) q('date').oninput = live(() => { date.textContent = q('date').value; });
  q('page').onchange = live(() => {
    const old = pageHref, neu = q('page').value;
    el.querySelectorAll('a').forEach(a => { if (a.getAttribute('href') === old && a !== gh) a.setAttribute('href', neu); });
  });
  q('gh').onchange = () => mutate(() => {
    const url = q('gh').value.trim();
    let a = el.querySelector('a.fa-github');
    if (!url) { if (a) (a.closest('li') || a).remove(); }
    else if (a) a.setAttribute('href', url);
    else {
      let list = el.querySelector('ul.actions');
      if (!list) { list = doc.createElement('ul'); list.className = 'actions special'; el.appendChild(list); }
      const li = doc.createElement('li');
      li.innerHTML = '<a class="button icon brands fa-github">GitHub</a>';
      li.firstChild.setAttribute('href', url);
      list.appendChild(li);
    }
    selected = el;
  });
  q('open').onclick = () => switchPage(q('page').value);
};
SUBS.project = 'A project on the overview page. Click its text to type.';

async function newProjectDialog() {
  if (!doc || !P.theme || !CFG.project) return;
  let picture = null;
  const r = await modal('New project', `
    ${field('Project name', '<input type="text" id="prName" placeholder="For example: Solar water heater">')}
    ${field('Date', `<input type="text" id="prDate" value="${esc(todayText())}">`)}
    ${field('Short description (on the card)', '<textarea id="prText" style="min-height:70px;font-family:inherit;font-size:14px" placeholder="One or two sentences."></textarea>')}
    ${field('GitHub address (optional)', '<input type="url" id="prGh" placeholder="https://github.com/you/project">')}
    ${field('Picture', '<div class="row"><button id="prPic">Choose picture…</button><span id="prPicName" class="hint">none yet (you can add it later)</span></div>')}
    <p class="hint">Makes a page for the project and puts its card at the top of ${esc(CFG.project.listPage || 'index.html')}.</p>`,
  [['cancel', 'Cancel'], ['ok', 'Create project', 'primary']],
  () => ({ title: $('#prName').value.trim(), date: $('#prDate').value.trim(), text: $('#prText').value.trim(), github: $('#prGh').value.trim() }),
  () => { $('#prPic').onclick = async () => { const f = await pickFile('image/*'); if (f) { picture = f; $('#prPicName').textContent = f.name; } }; });
  if (!r || r.value !== 'ok') return;
  if (!r.data.title) { status('A project needs a name.'); return; }
  if (!(await confirmLeaveForSiteChange())) return;
  try {
    status('Making the project page…', true);
    const listPage = CFG.project.listPage || 'index.html';
    const file = uniquePageName(r.data.title);
    let image = '';
    if (picture) image = await addImage(picture, 'content');
    else if (await B.hasFile('site', 'images/project-placeholder.jpg')) image = 'images/project-placeholder.jpg';
    const vals = Object.assign({}, r.data, { page: file, image });
    const src = await B.readText(listPage);
    const d = new DOMParser().parseFromString(src, 'text/html');
    d.title = r.data.title + (CFG.site && CFG.site.name ? ' | ' + CFG.site.name : '');
    const m = d.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', r.data.text || r.data.title);
    themePageBody(d, fillTpl(CFG.project.page, vals));
    await B.savePage(file, docHtml(src, d), true);
    // the card goes first in the list
    const list = new RegExp('<[a-z]+\\b[^>]*\\bdata-se-list="' + (CFG.project.list || 'projects') + '"[^>]*>', 'i');
    const lm = list.exec(src);
    if (lm) {
      const at = lm.index + lm[0].length;
      await B.savePage(listPage, src.slice(0, at) + '\n' + fillTpl(CFG.project.card, vals).replace(/\s+$/, '') + src.slice(at));
    }
    await refreshPages();
    loadPage(file);
    status(lm ? `Project created: ${file}, with its card on ${listPage}.` : `Project page created: ${file}. (No project list found on ${listPage} for the card.)`);
    if (isLoaded()) updateDownload();
  } catch (e) { status('Could not create the project: ' + e.message, true); }
}
$('#palProject').onclick = newProjectDialog;

/* ---------------- site settings: name, social links, copyright, background ---------------- */
const SOCIAL = [
  ['github', 'GitHub', 'brands fa-github', 'https://github.com/you'],
  ['mastodon', 'Mastodon', 'brands fa-mastodon', 'https://mastodon.social/@you'],
  ['youtube', 'YouTube', 'brands fa-youtube', 'https://youtube.com/@you'],
  ['instagram', 'Instagram', 'brands fa-instagram', 'https://instagram.com/you'],
  ['facebook', 'Facebook', 'brands fa-facebook-f', 'https://facebook.com/you'],
  ['linkedin', 'LinkedIn', 'brands fa-linkedin-in', 'https://linkedin.com/in/you'],
  ['twitter', 'X / Twitter', 'brands fa-twitter', 'https://x.com/you'],
  ['email', 'Email', 'solid fa-envelope', 'you@example.com'],
];

function siteInspector(ins) {
  const th = CFG.theme || {};
  ins.innerHTML = `<h2>Site</h2><p class="sub">The site name, social links, copyright line and background are the same on every page.</p>
    <div class="actions"><button class="primary" id="goSite">Site settings</button></div>
    <p class="hint">Template: <b>${esc(th.name || '')}</b> by ${esc(th.by || '')} (${esc(th.licence || '')}). Its licence asks for the link to ${esc((CFG.credit && CFG.credit.name) || th.by || '')} at the bottom of the page, so the editor always keeps it.</p>`;
  $('#goSite').onclick = openSiteSettings;
}

function sharedFromSettings(s) {
  const sh = CFG.shared || {}, out = new Map();
  if (sh.header) out.set('header', fillTpl(sh.header, { name: s.name }));
  if (sh.copyright) {
    // the credit link is part of the template and is always put back
    out.set('copyright', fillTpl(sh.copyright, { copyright: s.copyright, credit: s.credit || 'Template by' }));
  }
  if (sh.social && sh.socialItem) {
    const items = SOCIAL.filter(([k]) => s.social && s.social[k]).map(([k, label, icon]) => {
      let url = s.social[k].trim();
      if (k === 'email' && !/^mailto:/i.test(url)) url = 'mailto:' + url;
      return fillTpl(sh.socialItem, { url, icon, label });
    }).join('');
    out.set('social', sh.social.split('{{items}}').join(items));
  }
  return out;
}

async function openSiteSettings() {
  if (!doc || !P.theme) return;
  const s = JSON.parse(JSON.stringify(CFG.site || {}));
  s.social = s.social || {};
  let bgFile = null, bgReset = false;
  const credit = CFG.credit || { name: (CFG.theme && CFG.theme.by) || '', url: '' };
  const r = await modal('Site settings', `
    ${field('Site name (top of every page)', `<input type="text" id="ssName" value="${esc(s.name || '')}">`)}
    <div class="sec-title">Social links</div>
    <p class="hint" style="margin-top:0">Shown as icons in the menu bar. Leave empty to hide.</p>
    ${SOCIAL.map(([k, label, , ph]) => `<div class="fld"><span class="lbl">${label}</span><input type="${k === 'email' ? 'text' : 'url'}" data-social="${k}" value="${esc(s.social[k] || '')}" placeholder="${esc(ph)}"></div>`).join('')}
    <div class="sec-title">Bottom of the page</div>
    ${field('Copyright line (after ©)', `<input type="text" id="ssCopy" value="${esc(s.copyright || '')}">`)}
    ${field('Template credit', `<div class="row"><input type="text" id="ssCredit" value="${esc(s.credit || 'Template by')}" style="flex:1"> <a href="${esc(credit.url)}" target="_blank" rel="noopener">${esc(credit.name)}</a></div>`)}
    <p class="hint">The words are yours to choose; the link to ${esc(credit.name)} stays, because the template's licence (${esc((CFG.theme && CFG.theme.licence) || '')}) asks for it.</p>
    ${CFG.background ? `<div class="sec-title">Background picture</div>
      <div class="row"><button id="ssBg">Choose picture…</button>${s.background ? '<button id="ssBgReset">Use the template’s picture</button>' : ''}<span id="ssBgName" class="hint">${esc(s.background || 'the template’s picture')}</span></div>` : ''}`,
  [['cancel', 'Cancel'], ['ok', 'Apply to all pages', 'primary']],
  () => {
    s.name = $('#ssName').value.trim() || s.name;
    s.copyright = $('#ssCopy').value.trim();
    s.credit = $('#ssCredit').value.trim() || 'Template by';
    $$('[data-social]').forEach(i => { const v = i.value.trim(); if (v) s.social[i.dataset.social] = v; else delete s.social[i.dataset.social]; });
    return s;
  },
  () => {
    const b = $('#ssBg'); if (b) b.onclick = async () => { const f = await pickFile('image/*'); if (f) { bgFile = f; bgReset = false; $('#ssBgName').textContent = f.name; } };
    const rb = $('#ssBgReset'); if (rb) rb.onclick = () => { bgFile = null; bgReset = true; $('#ssBgName').textContent = 'the template’s picture'; };
  });
  if (!r || r.value !== 'ok') return;
  if (!(await confirmLeaveForSiteChange())) return;
  try {
    status('Updating every page…', true);
    const oldName = (CFG.site && CFG.site.name) || '';
    if (bgFile || bgReset) {
      const path = bgFile ? await addImage(bgFile, 'bg') : '';
      s.background = path;
      const css = '/* Your own additions to the template\'s style. The site editor writes the background picture here. */\n' +
        (path ? CFG.background.css.split('{{path}}').join(path) : '');
      await B.writeFile('site', CFG.background.file, new Blob([css], { type: 'text/css' }));
    }
    const regions = sharedFromSettings(s);
    let n = 0;
    for (const p of pagesList) {
      let t = await B.readText(p.file);
      const old = t;
      for (const [k, v] of regions) t = replaceShared(t, k, v);
      if (oldName && s.name !== oldName) {
        // a heading that is exactly the old name (such as the big title on the home page) follows too
        t = t.split('<h1>' + esc(oldName) + '</h1>').join('<h1>' + esc(s.name) + '</h1>');
        t = t.replace(/<title>([^<]*)<\/title>/i, (m, ti) => {
          const e = esc(oldName), ne = esc(s.name);
          if (ti.trim() === e) return '<title>' + ne + '</title>';
          if (ti.endsWith(' | ' + e)) return '<title>' + ti.slice(0, -e.length) + ne + '</title>';
          return m;
        });
      }
      if (t !== old) { await B.savePage(p.file, t); n++; }
    }
    CFG.site = s;
    await saveSiteConfig();
    await refreshPages();
    loadPage(page);
    status(`Site settings applied (${n} page${n === 1 ? '' : 's'} changed).`);
    if (isLoaded()) updateDownload();
  } catch (e) { status('Site settings not applied: ' + e.message, true); }
}
$('#btnSite').onclick = openSiteSettings;

/* ---------------- New website (start screen) ---------------- */
function loadThemeBundle(id) {
  const have = window.SITE_EDITOR_THEME_DATA && window.SITE_EDITOR_THEME_DATA[id];
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'themes/' + encodeURIComponent(id) + '.js';
    s.onload = () => { const t = window.SITE_EDITOR_THEME_DATA && window.SITE_EDITOR_THEME_DATA[id]; t ? resolve(t) : reject(new Error('The template ' + id + ' is empty.')); };
    s.onerror = () => reject(new Error('The template ' + id + ' was not found (themes/' + id + '.js).'));
    document.head.appendChild(s);
  });
}

// the template's files with the new site's name, tagline… filled in
function siteFilesFrom(theme, v) {
  const year = String(new Date().getFullYear());
  const vals = { SITE_NAME: v.name, TAGLINE: v.tagline, COPYRIGHT: year + ' ' + (v.author || v.name), DATE: todayText(), YEAR: year };
  const files = new Map();
  for (const [path, f] of Object.entries(theme.files)) {
    if (f.b !== undefined) {
      const bin = atob(f.b), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      files.set(path, bytes);
      continue;
    }
    let t = f.t;
    if (/\.html?$/i.test(path)) t = t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vals ? esc(vals[k]) : m));
    else if (/\.json$/i.test(path)) t = t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vals ? JSON.stringify(vals[k]).slice(1, -1) : m));
    files.set(path, t);
  }
  return files;
}

async function newWebsiteDialog() {
  const themes = window.SITE_EDITOR_THEMES || [];
  if (!themes.length) { $('#startMsg').textContent = 'No templates found (themes/index.js is missing).'; return; }
  const canFolder = Local.canOpenFolder();
  const r = await modal('New website', `
    <div class="sec-title" style="margin-top:0">Template</div>
    ${themes.map((t, i) => `<label class="themepick"><input type="radio" name="nwTheme" value="${esc(t.id)}" ${i ? '' : 'checked'}>
      <span><b>${esc(t.name)}</b> <span class="hint">by ${esc(t.by)} · ${esc(t.licence)}</span><br><span class="hint">${esc(t.description)}</span></span></label>`).join('')}
    <div class="sec-title">Your site</div>
    ${field('Site name', '<input type="text" id="nwName" placeholder="For example: Off-grid tinkering">')}
    ${field('Tagline (under the name on the home page)', '<input type="text" id="nwTag" placeholder="For example: Projects for a life off the grid">')}
    ${field('Your name (for the copyright line)', '<input type="text" id="nwAuthor">')}
    <div class="sec-title">Where</div>
    ${canFolder ? `<label class="themepick"><input type="radio" name="nwWhere" value="folder" checked><span><b>In a folder on this computer</b><br>
      <span class="hint">Choose an empty folder (for example a new “website” folder). The site goes in its <b>docs</b> folder, ready for GitHub Desktop and GitHub Pages.</span></span></label>` : ''}
    <label class="themepick"><input type="radio" name="nwWhere" value="memory" ${canFolder ? '' : 'checked'}><span><b>In the editor</b><br>
      <span class="hint">Works in every browser. When you are done, <b>Download site</b> gives you the whole site as a .zip.</span></span></label>`,
  [['cancel', 'Cancel'], ['ok', 'Create website', 'primary']],
  () => ({
    theme: (document.querySelector('input[name=nwTheme]:checked') || {}).value,
    name: $('#nwName').value.trim(), tagline: $('#nwTag').value.trim(), author: $('#nwAuthor').value.trim(),
    where: (document.querySelector('input[name=nwWhere]:checked') || {}).value,
  }));
  if (!r || r.value !== 'ok') return;
  const v = r.data, msg = $('#startMsg');
  if (!v.name) { msg.textContent = 'A website needs a name.'; return; }
  try {
    msg.textContent = 'Preparing the template…';
    const theme = await loadThemeBundle(v.theme);
    const files = siteFilesFrom(theme, v);
    await Local.createSite(slugify(v.name), files, v.where === 'folder');
    msg.textContent = '';
    B = Local;
    await startEditing();
    status(v.where === 'folder' ? 'Your new website is ready. Everything you save goes straight into the folder.' : 'Your new website is ready. Use Download site to keep it.', true);
  } catch (e) { msg.textContent = e.name === 'AbortError' ? '' : e.message; }
}
$('#btnNew').onclick = newWebsiteDialog;

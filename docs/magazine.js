'use strict';
/* Magazine issues, for a Weebly site that has a gallery page.

   The gallery page marks where its cards go with the comments
       <!-- se:issues -->  …cards…  <!-- /se:issues -->
   "＋ New magazine issue" then makes, in one go:
     • the issue page (cover, contents, price, buy button),
     • an unlisted download page (random name, hidden from search engines),
     • the PDF, in files/magazine/ (optional: it can be added later),
     • the issue's card on the gallery page (newest first, three to a row).
   The names of the download page and the PDF must not be public, so they are not written on the
   gallery page: they are kept in issues.json in the "originals" area (image-originals/ next to the
   site folder), which is never published. "Magazine issues…" lists the issues and lets you add or
   replace a PDF, set the Stripe link and see the address to give Stripe for "after payment".
   Everything is made of the editor's normal elements, so every page can be edited as usual. */

const ISSUES_FILE = 'issues.json';
const ISSUE_COLS = 3;
const ISSUE_START = 'se:issues', ISSUE_END = '/se:issues';
let issuesPage = null;          // the gallery page (file name), or null on a site without one

const issueToken = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
const issueEnt = s => [...s].map(c => '&#' + c.charCodeAt(0) + ';').join('');

async function loadIssues() {
  try {
    const j = JSON.parse(await (await B.readFile('originals', ISSUES_FILE)).text());
    return { site: j.site || '', issues: Array.isArray(j.issues) ? j.issues : [] };
  } catch (e) { return { site: '', issues: [] }; }
}
async function saveIssues(data) {
  await B.writeFile('originals', ISSUES_FILE, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

async function findIssuesPage() {
  const list = await B.pages();
  const ordered = list.filter(p => /magazine/i.test(p.file)).concat(list.filter(p => !/magazine/i.test(p.file)));
  for (const p of ordered) {
    try { if ((await B.readText(p.file)).includes('<!-- ' + ISSUE_START + ' -->')) return p.file; } catch (e) { /* skip */ }
  }
  return null;
}

async function updateIssueButtons() {
  issuesPage = null;
  $('#palIssue').hidden = $('#palIssues').hidden = true;
  if (P.theme) return;
  issuesPage = await findIssuesPage();
  $('#palIssue').hidden = $('#palIssues').hidden = !issuesPage;
}

/* ---------------- the pieces, as HTML ---------------- */
const issueImage = (src, alt, href) => `<div><div class="wsite-image wsite-image-border-none " style="padding-top:10px;padding-bottom:10px;margin-left:0;margin-right:0;text-align:center"><a${href ? ` href="${esc(href)}"` : ''}><img src="${esc(src)}" alt="${esc(alt)}" style="width:auto;max-width:100%"></a><div style="display:block;font-size:90%"></div></div></div>`;
const issueButton = (href, label, size, extra, align) => `<div style="text-align:${align || 'center'};"><div style="height: 10px; overflow: hidden;"></div><a class="wsite-button wsite-button-${size} wsite-button-highlight" href="${esc(href)}"${extra || ''}><span class="wsite-button-inner">${esc(label)}</span></a><div style="height: 10px; overflow: hidden;"></div></div>`;

function issueCardTd(iss, cover) {
  return `<td class="wsite-multicol-col" data-issue="${esc(iss.page)}" style="width:${(100 / ISSUE_COLS).toFixed(2)}%; padding:0 15px;">` +
    issueImage(cover, iss.name, iss.page) +
    `<h2 class="wsite-content-title" style="text-align:center;">${esc(iss.name)}</h2>` +
    (iss.date ? `<div class="paragraph" style="text-align:center;"><strong>${esc(iss.date)}</strong></div>` : '') +
    (iss.theme ? `<div class="paragraph" style="text-align:center;">${esc(iss.theme)}</div>` : '') +
    issueButton(iss.page, 'see inside', 'small') + `</td>`;
}
function issueRows(tds) {
  const emptyTd = `<td class="wsite-multicol-col" style="width:${(100 / ISSUE_COLS).toFixed(2)}%; padding:0 15px;"></td>`;
  let out = '';
  for (let i = 0; i < tds.length; i += ISSUE_COLS) {
    const row = tds.slice(i, i + ISSUE_COLS);
    while (row.length < ISSUE_COLS) row.push(emptyTd);
    out += `<div><div class="wsite-multicol"><div class="wsite-multicol-table-wrap" style="margin:0 -15px;"><table class="wsite-multicol-table"><tbody class="wsite-multicol-tbody"><tr class="wsite-multicol-tr">${row.join('')}</tr></tbody></table></div></div></div>\n`;
  }
  return out;
}
function issueMarkers(d) {
  const w = d.createTreeWalker(d.body, NodeFilter.SHOW_COMMENT);
  let a = null, b = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.data.trim(); if (t === ISSUE_START) a = n; else if (t === ISSUE_END) b = n; }
  return a && b && a.parentNode === b.parentNode ? { a, b } : null;
}
// put a new card first and lay all cards out again, three to a row. Returns false if the page has no markers.
function rebuildGallery(d, newTd) {
  const m = issueMarkers(d);
  if (!m) return false;
  const tds = [];
  for (let n = m.a.nextSibling; n && n !== m.b;) {
    const next = n.nextSibling;
    if (n.nodeType === 1) n.querySelectorAll('td[data-issue]').forEach(td => tds.push(td.outerHTML));
    n.remove();
    n = next;
  }
  const t = d.createElement('template');
  t.innerHTML = '\n' + issueRows((newTd ? [newTd] : []).concat(tds));
  m.b.parentNode.insertBefore(t.content, m.b);
  return true;
}

function issueBuyBlock(iss) {
  const inner = iss.stripe
    ? issueButton(iss.stripe, 'buy' + (iss.price ? ' – ' + iss.price : ''), 'large', ' target="_blank" rel="noopener"', 'left') +
      `<div class="paragraph" style="text-align:left;"><font size="2">You pay on Stripe's secure page. Nothing is sent to Stripe until you click. You can download the PDF right after paying.</font></div>`
    : `<div class="paragraph" style="text-align:left;"><em>${iss.date ? 'Available in ' + esc(iss.date) + '.' : 'Coming soon.'}</em></div>`;
  return `<div data-issue-buy="1">${inner}</div>`;
}
function issueContentsHtml(text) {
  const items = String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const [head, ...rest] = line.split('|');
    return `<li><font color="#3f3f3f"><strong>${esc(head.trim())}</strong>${rest.length && rest.join('|').trim() ? `<br />&rarr; ${esc(rest.join('|').trim())}` : ''}</font></li>`;
  });
  return items.length ? `<div class="paragraph"><ul>${items.join('')}</ul></div>` : '<div class="paragraph">Contents follow soon.</div>';
}
function issueSection(cls, inner) {
  return `<div class="wsite-section-wrap"><div class="${cls}"><div class="wsite-section-content"><div class="container"><div class="wsite-section-elements">${inner}</div></div></div></div></div>`;
}
function issuePageHtml(iss, cover, cls, galleryFile) {
  const head = `<div class="wsite-spacer" style="height:20px;"></div><h2 class="wsite-content-title" style="text-align:center;">${esc(iss.name)}</h2>` +
    ((iss.date || iss.theme) ? `<div class="paragraph" style="text-align:center;">${esc([iss.date, iss.theme].filter(Boolean).join(' – '))}</div>` : '');
  const right = `<h2 class="wsite-content-title">Content</h2>${iss.contentsHtml || issueContentsHtml(iss.contents)}<div class="wsite-spacer" style="height:20px;"></div>${issueBuyBlock(iss)}`;
  const foot = `<div class="wsite-spacer" style="height:30px;"></div><div><div style="height: 20px; overflow: hidden; width: 100%;"></div><hr class="styled-hr" style="width:100%;"><div style="height: 20px; overflow: hidden; width: 100%;"></div></div>` +
    issueButton(galleryFile, 'all issues', 'small') + `<div class="wsite-spacer" style="height:50px;"></div>`;
  return issueSection(cls, head + colsHtml([issueImage(cover, iss.name), right], [45, 55]) + foot);
}
function issueDownloadHtml(iss, cls) {
  const mail = 'info@terramadas.org';
  return issueSection(cls,
    `<div class="wsite-spacer" style="height:40px;"></div><h2 class="wsite-content-title" style="text-align:center;">Thank you!</h2>` +
    `<div class="paragraph" style="text-align:center;">Your payment went through. Here is ${esc(iss.name)} of the magazine.</div>` +
    `<div class="wsite-spacer" style="height:30px;"></div>` +
    issueButton(iss.pdf, 'download the pdf', 'large', ' download') +
    `<div class="wsite-spacer" style="height:30px;"></div>` +
    `<div class="paragraph" style="text-align:center;">Please keep this page for yourself, so that the magazine stays a small, shared thing. If the download does not work, write to us at <a href="${issueEnt('mailto:' + mail)}">${issueEnt(mail)}</a>.</div>` +
    `<div class="wsite-spacer" style="height:50px;"></div>`);
}

// a new page with the header, menu and style of the gallery page and different content
function issuePageFrom(src, title, mainHtml, noindex) {
  const d = new DOMParser().parseFromString(src, 'text/html');
  const main = d.getElementById('wsite-content');
  if (!main) throw new Error('the gallery page has no content area');
  main.innerHTML = '\n' + mainHtml + '\n';
  d.title = title;
  const desc = d.querySelector('meta[name="description"]'); if (desc) desc.remove();
  if (noindex && !d.querySelector('meta[name="robots"]')) {
    const m = d.createElement('meta'); m.setAttribute('name', 'robots'); m.setAttribute('content', 'noindex, nofollow');
    d.head.appendChild(m);
  }
  return docHtml(src, d);
}
function issueSectionClass(src) {
  const d = new DOMParser().parseFromString(src, 'text/html');
  const s = d.querySelector('#wsite-content .wsite-section');
  return (s ? s.className : 'wsite-section wsite-body-section').replace(/\bwsite-section-bg-image\b/g, '').replace(/\s+/g, ' ').trim();
}
const issueRedirect = (data, iss) => (data.site || '').replace(/\/+$/, '') + '/' + iss.download;
const issueUnique = base => { let f = base + '.html', n = 2; while (pagesList.some(p => p.file === f)) f = base + '-' + (n++) + '.html'; return f; };

/* ---------------- ＋ New magazine issue ---------------- */
async function newIssueDialog() {
  if (!issuesPage) return;
  const data = await loadIssues();
  const st = { cover: null, pdf: null };
  const r = await modal('New magazine issue', `
    ${field('Name', `<input type="text" id="isName" value="Issue ${data.issues.length + 1}">`)}
    ${field('Month and year', '<input type="text" id="isDate" placeholder="For example: March \'27">')}
    ${field('One line about this issue (on its card)', '<input type="text" id="isTheme" placeholder="For example: living the seasons on the land">')}
    ${field('Cover picture', '<div class="row"><button id="isCover">Choose picture…</button><span id="isCoverName" class="hint">none yet</span></div>')}
    ${field('Contents, one per line: title | short description', '<textarea id="isContents" style="min-height:110px;font-family:inherit;font-size:14px" placeholder="The Terramadas Tales | existential musings inspired by nature"></textarea>')}
    ${field('Price (shown on the buy button)', '<input type="text" id="isPrice" placeholder="For example: 5 €">')}
    ${field('Stripe Payment Link (leave empty until the issue is for sale)', '<input type="url" id="isStripe" placeholder="https://buy.stripe.com/…">')}
    ${field('The PDF (can be added later)', '<div class="row"><button id="isPdf">Choose PDF…</button><span id="isPdfName" class="hint">none yet</span></div>')}
    ${field('Website address (to work out the address for Stripe)', `<input type="url" id="isSite" value="${esc(data.site || localStorage.getItem('se-issue-site') || 'https://terramadas.org')}">`)}
    <p class="hint">Makes the issue page, a hidden download page with the PDF, and the card on ${esc(issuesPage)}. Nothing is public until you upload the site.</p>`,
  [['cancel', 'Cancel'], ['ok', 'Create issue', 'primary']],
  () => ({
    name: $('#isName').value.trim(), date: $('#isDate').value.trim(), theme: $('#isTheme').value.trim(), contents: $('#isContents').value,
    price: $('#isPrice').value.trim(), stripe: $('#isStripe').value.trim(), site: $('#isSite').value.trim(),
  }),
  () => {
    $('#isCover').onclick = async () => { const f = await pickFile('image/*'); if (f) { st.cover = f; $('#isCoverName').textContent = f.name; } };
    $('#isPdf').onclick = async () => { const f = await pickFile('application/pdf,.pdf'); if (f) { st.pdf = f; $('#isPdfName').textContent = f.name; } };
  });
  if (!r || r.value !== 'ok') return;
  const v = r.data;
  if (!v.name) { status('An issue needs a name.'); return; }
  if (!st.cover) { status('An issue needs a cover picture.'); return; }
  if (v.stripe && !/^https:\/\//i.test(v.stripe)) { status('The Stripe link should start with https://'); return; }
  if (st.pdf && new TextDecoder().decode(new Uint8Array(await st.pdf.slice(0, 5).arrayBuffer())) !== '%PDF-') { status('That file is not a PDF.'); return; }
  if (!(await confirmLeaveForSiteChange())) return;
  try {
    status('Making the issue…', true);
    await refreshPages();
    const slug = slugify(v.name), token = issueToken();
    if (data.issues.some(i => i.slug === slug)) throw new Error('There is already an issue called ' + v.name + '.');
    const iss = { slug, name: v.name, date: v.date, theme: v.theme, contents: v.contents, price: v.price, stripe: v.stripe,
      page: issueUnique('magazine-' + slug), download: 'download-' + slug + '-' + token + '.html', pdf: 'files/magazine/' + slug + '-' + token + '.pdf' };
    const cover = await addImage(st.cover, 'content');
    if (st.pdf) await B.writeFile('site', iss.pdf, st.pdf);
    const src = await B.readText(issuesPage), cls = issueSectionClass(src);
    await B.savePage(iss.page, issuePageFrom(src, iss.name + ' – Magazine', issuePageHtml(iss, cover, cls, issuesPage), false), true);
    await B.savePage(iss.download, issuePageFrom(src, iss.name + ' – Download', issueDownloadHtml(iss, cls), true), true);
    const d = new DOMParser().parseFromString(src, 'text/html');
    if (!rebuildGallery(d, issueCardTd(iss, cover))) throw new Error('the gallery markers are missing on ' + issuesPage);
    await B.savePage(issuesPage, docHtml(src, d));
    data.site = v.site || data.site; data.issues.push(iss);
    await saveIssues(data);
    try { localStorage.setItem('se-issue-site', data.site); } catch (e) { /* ignore */ }
    await refreshPages();
    await switchPage(issuesPage);
    if (isLoaded()) updateDownload();
    status('Issue created: ' + iss.name);
    await issueCreatedDialog(data, iss, !!st.pdf);
  } catch (e) { status('Could not make the issue: ' + e.message, true); }
}

async function copyText(inp) {
  try { await navigator.clipboard.writeText(inp.value); return true; } catch (e) { inp.select(); try { return document.execCommand('copy'); } catch (e2) { return false; } }
}
async function issueCreatedDialog(data, iss, hasPdf) {
  const url = issueRedirect(data, iss);
  await modal('Issue created', `
    <p><b>${esc(iss.name)}</b> is ready: the issue page <i>${esc(iss.page)}</i> and its card on ${esc(issuesPage)}.</p>
    ${field('In Stripe, under After payment, redirect buyers to this address', `<div class="row"><input type="text" id="isUrl" readonly value="${esc(url)}" style="flex:1"><button id="isCopy">Copy</button></div>`)}
    <ul>
      ${hasPdf ? '' : `<li>The PDF is still to come: <b>Magazine issues…</b> → <b>PDF…</b>.</li>`}
      ${iss.stripe ? '' : `<li>No Stripe link yet: the issue page says it is coming. Add it with <b>Magazine issues…</b> → <b>Stripe link…</b>.</li>`}
      <li>The download page is not linked anywhere and hidden from search engines. Anyone who has its address can use it.</li>
    </ul>`,
  [['ok', 'Done', 'primary']], null,
  () => { $('#isCopy').onclick = async () => { $('#isCopy').textContent = (await copyText($('#isUrl'))) ? 'Copied' : 'Select and copy'; }; });
}

/* ---------------- Magazine issues… ---------------- */
async function issuesDialog() {
  if (!issuesPage) return;
  for (;;) {
    const data = await loadIssues();
    const rows = [];
    for (const iss of data.issues) rows.push({ iss, pdf: await B.hasFile('site', iss.pdf).catch(() => false) });
    const body = document.createElement('div');
    body.innerHTML = (rows.length ? '' : '<p class="hint">No issues made with the editor yet.</p>') + rows.map((x, i) => `
      <div class="pagerow" style="flex-wrap:wrap"><span class="nm">${esc(x.iss.name)}${x.iss.date ? ' · ' + esc(x.iss.date) : ''}
        <span class="fn">${x.iss.stripe ? 'for sale' : 'no Stripe link yet'} · PDF ${x.pdf ? 'in place' : '<b>missing</b>'}</span></span>
        <button data-a="page" data-i="${i}">Issue page</button><button data-a="dl" data-i="${i}">Download page</button>
        <button data-a="pdf" data-i="${i}">PDF…</button><button data-a="stripe" data-i="${i}">Stripe link…</button><button data-a="url" data-i="${i}">Address for Stripe</button>
      </div>`).join('');
    body.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => closeModal({ value: 'act', a: b.dataset.a, i: +b.dataset.i }));
    const r = await modal('Magazine issues', body, [['cancel', 'Close']]);
    if (!r || r.value !== 'act') return;
    const iss = data.issues[r.i];
    if (r.a === 'page') return switchPage(iss.page);
    if (r.a === 'dl') return switchPage(iss.download);
    if (r.a === 'url') { await issueCreatedDialogUrl(data, iss); continue; }
    if (r.a === 'pdf') {
      const f = await pickFile('application/pdf,.pdf');
      if (!f) continue;
      if (new TextDecoder().decode(new Uint8Array(await f.slice(0, 5).arrayBuffer())) !== '%PDF-') { status('That file is not a PDF.'); continue; }
      try { await B.writeFile('site', iss.pdf, f); status('PDF in place for ' + iss.name + '.'); if (isLoaded()) updateDownload(); } catch (e) { status('Could not save the PDF: ' + e.message, true); }
      continue;
    }
    if (r.a === 'stripe') {
      const s = await modal('Stripe link for ' + iss.name, `${field('Stripe Payment Link', `<input type="url" id="stLink" value="${esc(iss.stripe || '')}" placeholder="https://buy.stripe.com/…">`)}
        ${field('Price (on the button)', `<input type="text" id="stPrice" value="${esc(iss.price || '')}">`)}
        <p class="hint">Empty link = the issue page says "Available in …" instead of showing a buy button.</p>`,
      [['cancel', 'Cancel'], ['ok', 'Save', 'primary']], () => ({ link: $('#stLink').value.trim(), price: $('#stPrice').value.trim() }));
      if (!s || s.value !== 'ok') continue;
      if (s.data.link && !/^https:\/\//i.test(s.data.link)) { status('The Stripe link should start with https://'); continue; }
      if (!(await confirmLeaveForSiteChange())) continue;
      try {
        iss.stripe = s.data.link; iss.price = s.data.price;
        const src = await B.readText(iss.page), d = new DOMParser().parseFromString(src, 'text/html');
        const box = d.querySelector('[data-issue-buy]');
        if (!box) throw new Error('the buy button area is not on ' + iss.page + ' any more. Add the button there by hand.');
        box.outerHTML = issueBuyBlock(iss);
        await B.savePage(iss.page, docHtml(src, d));
        await saveIssues(data);
        status('Saved.'); if (isLoaded()) updateDownload();
        if (page === iss.page) loadPage(iss.page);
      } catch (e) { status('Could not save: ' + e.message, true); }
    }
  }
}
async function issueCreatedDialogUrl(data, iss) {
  await modal('Address for Stripe', `<p>In Stripe, open the Payment Link for ${esc(iss.name)} → <b>After payment</b> → redirect to this address:</p>
    <div class="row"><input type="text" id="isUrl" readonly value="${esc(issueRedirect(data, iss))}" style="flex:1"><button id="isCopy">Copy</button></div>
    <p class="hint">The website address comes from when the issue was made. Anyone who has this address can open the download page.</p>`,
  [['ok', 'Close', 'primary']], null,
  () => { $('#isCopy').onclick = async () => { $('#isCopy').textContent = (await copyText($('#isUrl'))) ? 'Copied' : 'Select and copy'; }; });
}

$('#palIssue').onclick = newIssueDialog;
$('#palIssues').onclick = issuesDialog;

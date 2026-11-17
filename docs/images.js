'use strict';
/* Images.
   The published site only gets optimised JPEGs (PNG when an image needs transparency), at the
   size they are shown. The untouched original goes to image-originals/ next to the site, and
   image-originals/edits.json remembers, for every optimised file, its original and the edits
   (crop, rotation, colour…). Editing again always starts from the original, so quality never
   degrades. Re-saving through a canvas also removes camera data such as GPS location. */

const IMG_QUALITY = 82;          // JPEG quality 0–100
const IMG_CONTENT_MAX = 1600;    // images on the page (sharp on Retina at ~800 px wide)
const IMG_BG_MAX = 2400;         // full-width section backgrounds
const EDITS_FILE = 'edits.json';
const RASTER = /\.(jpe?g|png|webp)$/i;

/* ---------------- helpers ---------------- */
const imgStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const slugName = n => (n.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)) || 'image';
const extOf = n => ((/\.([a-z0-9]+)$/i.exec(n) || [])[1] || '').toLowerCase();
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const sitePathOf = url => {                       // "http://…/site/uploads/x.jpg?123" -> "uploads/x.jpg"
  let u = String(url || '').trim().replace(/^url\((.*)\)$/i, '$1').replace(/^["']|["']$/g, '').replace(/&quot;/g, '');
  if (/^blob:/.test(u)) u = unBlob(u);                 // opened from disk
  const i = u.indexOf('/site/');
  if (/^[a-z]+:/i.test(u)) { if (i < 0) return null; u = u.slice(i + 6); }
  u = u.split(/[?#]/)[0];
  try { u = decodeURIComponent(u); } catch (e) { /* keep */ }
  return u.replace(/^\.?\//, '');
};

async function loadEdits() {
  try { return JSON.parse(await (await B.readFile('originals', EDITS_FILE)).text()) || {}; } catch (e) { return {}; }
}
async function saveEdits(map) {
  await B.writeFile('originals', EDITS_FILE, new Blob([JSON.stringify(map, null, 1)], { type: 'application/json' }));
}

async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* older Safari */ }
  const url = URL.createObjectURL(blob);
  try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const srcW = s => s.naturalWidth || s.width, srcH = s => s.naturalHeight || s.height;
const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const defaultRecipe = () => ({ rot: 0, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 }, bright: 0, contrast: 0, sat: 0 });
const orientedSize = (w, h, rot) => (rot % 180 ? [h, w] : [w, h]);

// the image rotated/flipped, at a scale
function drawOriented(src, r, scale) {
  const [W, H] = orientedSize(srcW(src), srcH(src), r.rot);
  const c = newCanvas(W * scale, H * scale), ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(r.flipH ? -1 : 1, r.flipV ? -1 : 1);       // flip as seen on screen
  ctx.rotate(r.rot * Math.PI / 180);
  const w = srcW(src) * scale, h = srcH(src) * scale;
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}
// good-quality downscaling: halve in steps, then the last step
function scaleTo(canvas, sx, sy, sw, sh, w, h) {
  let cur = canvas, cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 >= w && ch / 2 >= h) {
    const half = newCanvas(cw / 2, ch / 2), hc = half.getContext('2d');
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(cur, cx, cy, cw, ch, 0, 0, half.width, half.height);
    cur = half; cx = 0; cy = 0; cw = half.width; ch = half.height;
  }
  const out = newCanvas(w, h), oc = out.getContext('2d');
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(cur, cx, cy, cw, ch, 0, 0, out.width, out.height);
  return out;
}
function adjust(canvas, r) {
  if (!r.bright && !r.contrast && !r.sat) return canvas;
  const ctx = canvas.getContext('2d'), id = ctx.getImageData(0, 0, canvas.width, canvas.height), d = id.data;
  const b = r.bright * 2.55, c = r.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c)), s = 1 + r.sat / 100;
  for (let i = 0; i < d.length; i += 4) {
    let R = d[i] + b, G = d[i + 1] + b, Bl = d[i + 2] + b;
    R = f * (R - 128) + 128; G = f * (G - 128) + 128; Bl = f * (Bl - 128) + 128;
    const g = 0.299 * R + 0.587 * G + 0.114 * Bl;
    d[i] = g + (R - g) * s; d[i + 1] = g + (G - g) * s; d[i + 2] = g + (Bl - g) * s;   // clamped by the array
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}
function hasAlpha(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
  return false;
}
// the final image: oriented, cropped, at most maxW wide (never enlarged), colour-adjusted
function renderImage(src, r, maxW) {
  const full = drawOriented(src, r, 1);
  const cx = r.crop.x * full.width, cy = r.crop.y * full.height, cw = r.crop.w * full.width, ch = r.crop.h * full.height;
  const scale = Math.min(1, maxW / cw);
  return adjust(scaleTo(full, cx, cy, cw, ch, Math.round(cw * scale), Math.round(ch * scale)), r);
}
function encodeImage(canvas, png, quality) {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not save the image'))),
    png ? 'image/png' : 'image/jpeg', (quality || IMG_QUALITY) / 100));
}
async function canDecode(blob) { try { const s = await decodeImage(blob); if (s.close) s.close(); return true; } catch (e) { return false; } }

/* ---------------- adding images ---------------- */
function pickFile(accept) {
  return new Promise(resolve => {
    const inp = $('#fileIn');
    inp.accept = accept || 'image/*';
    inp.value = '';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// Keep the original in image-originals, put an optimised version in the site. Returns the site path.
async function addImage(file, purpose) {
  status('Adding ' + file.name + '…', true);
  const ext = extOf(file.name);
  if (!/^(jpe?g|png|webp|heic|heif)$/.test(ext) || !(await canDecode(file))) {
    if (/^(heic|heif)$/.test(ext)) throw new Error('This browser cannot read HEIC photos. Export the photo as JPEG first (or use Safari).');
    return B.upload(file.name, file);           // gif, svg, pdf: used as they are
  }
  const stem = slugName(file.name), st = imgStamp();
  const original = `${stem}-${st}.${ext}`;
  await B.writeFile('originals', original, file);
  const src = await decodeImage(file);
  const recipe = defaultRecipe(), width = purpose === 'bg' ? IMG_BG_MAX : IMG_CONTENT_MAX;
  const canvas = renderImage(src, recipe, width);
  const png = ext !== 'jpg' && ext !== 'jpeg' && hasAlpha(canvas);
  const blob = await encodeImage(canvas, png, IMG_QUALITY);
  const path = `uploads/editor/${stem}-${st}.${png ? 'png' : 'jpg'}`;
  await B.writeFile('site', path, blob);
  const edits = await loadEdits();
  edits[path] = { original, recipe, width, quality: IMG_QUALITY };
  await saveEdits(edits);
  status(`Image added (${canvas.width} × ${canvas.height}, ${fmtSize(blob.size)}).`);
  return path;
}

async function pickAndUpload(purpose) {
  const f = await pickFile('image/*,.pdf');
  if (!f) return null;
  try { return await addImage(f, purpose); } catch (e) { status('Could not add the image: ' + e.message, true); return null; }
}

async function replaceImage(img, isNew) {
  const path = await pickAndUpload('content');
  if (!path) {
    if (isNew && img.getAttribute('src') === PLACEHOLDER_IMG) status('Double-click the placeholder to choose an image.');
    return;
  }
  mutate(() => { setImageSrc(img, path); selected = blockOf(img) || selected; });
}

function setImageSrc(img, path) {
  img.setAttribute('src', path);
  img.removeAttribute('srcset');
  const a = img.closest('a');
  if (a && /lightbox/i.test((a.getAttribute('onclick') || '') + (a.getAttribute('rel') || '') + a.className)) a.setAttribute('href', path);
}
function setBackground(inner, path) {
  inner.style.backgroundImage = `url("${path}")`;
  inner.style.backgroundRepeat = 'no-repeat';
  inner.style.backgroundSize = 'cover';
  if (!inner.style.backgroundPosition || /undefined/.test(inner.style.backgroundPosition)) inner.style.backgroundPosition = '50% 50%';
  inner.classList.add('wsite-section-bg-image');
}

/* ---------------- the image editor ---------------- */
const ASPECTS = [['free', 'Free'], ['orig', 'Original'], ['16:9', '16:9'], ['3:2', '3:2'], ['4:3', '4:3'], ['1:1', 'Square'], ['3:1', 'Banner 3:1'], ['2:3', 'Portrait 2:3']];

// how wide (in pixels) the image should be, from where it is shown
function suggestedWidth(target) {
  if (target.kind === 'bg') return IMG_BG_MAX;
  // the share of the page width it takes, on a desktop page about 1200 px wide, doubled for sharp (Retina) screens
  const el = target.img, w = el.getBoundingClientRect().width, vw = doc.documentElement.clientWidth || 1200;
  let px = Math.ceil(Math.min(1, w / vw) * 1200 * 2 / 100) * 100;
  const a = el.closest('a');
  if (a && /lightbox/i.test((a.getAttribute('onclick') || '') + (a.getAttribute('rel') || '') + a.className)) px = Math.max(px, IMG_CONTENT_MAX);
  return Math.max(400, Math.min(IMG_BG_MAX, px));
}

async function openImageEditor(target) {
  // target: { kind: 'img', img } or { kind: 'bg', el: .wsite-section, section }
  if (!doc) return;
  if (editing) endEdit();
  const current = target.kind === 'img' ? sitePathOf(target.img.getAttribute('src')) : sitePathOf(target.el.style.backgroundImage || win.getComputedStyle(target.el).backgroundImage);
  if (!current || !RASTER.test(current)) { status('This image cannot be edited here (only JPEG, PNG and WebP). Use Replace.'); return; }
  status('Opening the image…', true);
  let edits, entry, origBlob, curBlob;
  try {
    edits = await loadEdits();
    entry = edits[current];
    curBlob = await B.readFile('site', current);
    if (entry) { try { origBlob = await B.readFile('originals', entry.original); } catch (e) { entry = null; } }
    if (!origBlob) origBlob = curBlob;
  } catch (e) { status('Could not open the image: ' + e.message, true); return; }
  let src;
  try { src = await decodeImage(origBlob); } catch (e) { status('This browser cannot read the image.', true); return; }
  showSaveState();

  const st = {
    r: entry ? JSON.parse(JSON.stringify(entry.recipe)) : defaultRecipe(),
    aspect: 'free', width: entry ? entry.width : suggestedWidth(target), quality: entry ? entry.quality : IMG_QUALITY,
  };
  const suggested = suggestedWidth(target);
  // a small copy for a fast preview
  const pScale = Math.min(1, 1400 / Math.max(srcW(src), srcH(src)));
  const small = drawOriented(src, { rot: 0, flipH: false, flipV: false }, pScale);

  const box = document.createElement('div');
  box.id = 'imgEd';
  box.innerHTML = `
    <div class="ie-stage"><div class="ie-holder"><canvas class="ie-canvas"></canvas><div class="ie-crop">
      ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<span class="h ${h}" data-h="${h}"></span>`).join('')}</div></div></div>
    <aside class="ie-side">
      <h2>Edit image</h2>
      <p class="sub">${entry ? 'Starting from the original photo.' : 'The current picture becomes the original; it is kept in image-originals.'}</p>
      <div class="fld"><span class="lbl">Crop</span><div class="ie-aspects">${ASPECTS.map(([v, l]) => `<button data-a="${v}" class="${v === 'free' ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="fld"><span class="lbl">Rotate and flip</span><div class="row">
        <button data-t="rl" title="Rotate left">⟲ Left</button><button data-t="rr" title="Rotate right">⟳ Right</button>
        <button data-t="fh" title="Flip horizontally">⇋</button><button data-t="fv" title="Flip vertically">⇵</button></div></div>
      ${['bright:Brightness', 'contrast:Contrast', 'sat:Saturation'].map(x => { const [k, l] = x.split(':'); return `<div class="fld"><span class="lbl">${l} <span data-v="${k}"></span></span><input type="range" min="-100" max="100" data-s="${k}"></div>`; }).join('')}
      <div class="fld"><span class="lbl">Width on the site</span><div class="row"><input type="number" min="100" max="6000" step="50" data-k="w"> px
        <button data-k="wauto" title="Size for where it is shown">Auto (${suggested})</button></div></div>
      <div class="fld"><span class="lbl">Quality <span data-v="q"></span></span><input type="range" min="50" max="95" data-k="q"></div>
      <p class="ie-info" data-k="info">…</p>
      <div class="actions"><button data-k="reset">Reset</button><button data-k="replace">Use another image…</button></div>
      <div class="btns"><button data-k="cancel">Cancel</button><button class="primary" data-k="apply">Apply</button></div>
    </aside>`;
  document.body.appendChild(box);
  const q = s => box.querySelector(s);
  const canvas = q('.ie-canvas'), cropEl = q('.ie-crop'), holder = q('.ie-holder');

  let view = null;   // oriented preview canvas
  function redrawBase() {
    view = adjust(drawOriented(small, { rot: st.r.rot, flipH: st.r.flipH, flipV: st.r.flipV }, 1), st.r);
    const stage = q('.ie-stage'), maxW = stage.clientWidth - 40, maxH = stage.clientHeight - 40;
    const k = Math.min(maxW / view.width, maxH / view.height, 2);
    canvas.width = view.width; canvas.height = view.height;
    canvas.style.width = Math.round(view.width * k) + 'px'; canvas.style.height = Math.round(view.height * k) + 'px';
    canvas.getContext('2d').drawImage(view, 0, 0);
    holder.style.width = canvas.style.width; holder.style.height = canvas.style.height;
    drawCrop();
  }
  function drawCrop() {
    const c = st.r.crop;
    cropEl.style.left = (c.x * 100) + '%'; cropEl.style.top = (c.y * 100) + '%';
    cropEl.style.width = (c.w * 100) + '%'; cropEl.style.height = (c.h * 100) + '%';
    scheduleInfo();
  }
  const orientedWH = () => orientedSize(srcW(src), srcH(src), st.r.rot);
  function aspectValue() {
    if (st.aspect === 'free') return null;
    if (st.aspect === 'orig') { const [W, H] = orientedWH(); return W / H; }
    const [a, b] = st.aspect.split(':').map(Number); return a / b;
  }
  function applyAspect() {
    const ar = aspectValue(); if (!ar) return;
    const [W, H] = orientedWH();
    let w = 1, h = (W / ar) / H;                 // in fractions of the image
    if (h > 1) { h = 1; w = (H * ar) / W; }
    const c = st.r.crop, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    st.r.crop = { w, h, x: Math.min(Math.max(cx - w / 2, 0), 1 - w), y: Math.min(Math.max(cy - h / 2, 0), 1 - h) };
  }

  // crop dragging
  cropEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    cropEl.setPointerCapture(e.pointerId);
    const h = e.target.dataset.h || 'move', rect = holder.getBoundingClientRect(), start = { ...st.r.crop }, sx = e.clientX, sy = e.clientY;
    const [W, H] = orientedWH(), ar = aspectValue();
    const move = ev => {
      const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height, min = 0.03;
      let { x, y, w, h: hh } = start;
      if (h === 'move') { x = Math.min(Math.max(x + dx, 0), 1 - w); y = Math.min(Math.max(y + dy, 0), 1 - hh); }
      else {
        if (h.includes('w')) { const nx = Math.min(Math.max(x + dx, 0), x + w - min); w += x - nx; x = nx; }
        if (h.includes('e')) w = Math.min(Math.max(w + dx, min), 1 - x);
        if (h.includes('n')) { const ny = Math.min(Math.max(y + dy, 0), y + hh - min); hh += y - ny; y = ny; }
        if (h.includes('s')) hh = Math.min(Math.max(hh + dy, min), 1 - y);
        if (ar) {                                       // keep the shape
          const byW = (w * W / ar) / H;
          if (h === 'n' || h === 's') { w = (hh * H * ar) / W; } else { hh = byW; }
          if (x + w > 1) { w = 1 - x; hh = (w * W / ar) / H; }
          if (y + hh > 1) { hh = 1 - y; w = (hh * H * ar) / W; }
          if (h.includes('n')) y = start.y + start.h - hh;
          if (h.includes('w')) x = start.x + start.w - w;
          x = Math.max(0, x); y = Math.max(0, y);
        }
      }
      st.r.crop = { x, y, w, h: hh };
      drawCrop();
    };
    const up = () => { cropEl.removeEventListener('pointermove', move); cropEl.removeEventListener('pointerup', up); };
    cropEl.addEventListener('pointermove', move); cropEl.addEventListener('pointerup', up);
  });

  // controls
  box.querySelectorAll('.ie-aspects button').forEach(b => b.onclick = () => {
    box.querySelectorAll('.ie-aspects button').forEach(x => x.classList.toggle('on', x === b));
    st.aspect = b.dataset.a;
    if (st.aspect === 'free') return;
    applyAspect(); drawCrop();
  });
  box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t, r = st.r;
    if (t === 'rr' || t === 'rl') {
      const dir = t === 'rr' ? 1 : -1;
      r.rot = (r.rot + (dir > 0 ? 90 : 270)) % 360;
      r.crop = { x: 0, y: 0, w: 1, h: 1 };          // the picture changes shape: start the crop again
    }
    if (t === 'fh') { r.flipH = !r.flipH; r.crop = { ...r.crop, x: 1 - r.crop.x - r.crop.w }; }
    if (t === 'fv') { r.flipV = !r.flipV; r.crop = { ...r.crop, y: 1 - r.crop.y - r.crop.h }; }
    applyAspect(); redrawBase();
  });
  let slideTimer = null;
  box.querySelectorAll('[data-s]').forEach(inp => {
    const k = inp.dataset.s;
    inp.value = st.r[k];
    q(`[data-v=${k}]`).textContent = st.r[k];
    inp.oninput = () => { st.r[k] = +inp.value; q(`[data-v=${k}]`).textContent = inp.value; clearTimeout(slideTimer); slideTimer = setTimeout(redrawBase, 30); };
  });
  const wIn = q('[data-k=w]'), qIn = q('[data-k=q]');
  wIn.value = st.width; qIn.value = st.quality; q('[data-v=q]').textContent = st.quality;
  wIn.oninput = () => { st.width = Math.max(100, +wIn.value || suggested); scheduleInfo(); };
  q('[data-k=wauto]').onclick = () => { st.width = suggested; wIn.value = suggested; scheduleInfo(); };
  qIn.oninput = () => { st.quality = +qIn.value; q('[data-v=q]').textContent = qIn.value; scheduleInfo(); };
  q('[data-k=reset]').onclick = () => {
    st.r = defaultRecipe(); st.aspect = 'free';
    box.querySelectorAll('.ie-aspects button').forEach(x => x.classList.toggle('on', x.dataset.a === 'free'));
    box.querySelectorAll('[data-s]').forEach(i => { i.value = 0; q(`[data-v=${i.dataset.s}]`).textContent = 0; });
    redrawBase();
  };

  // result size, worked out a moment after each change
  let infoTimer = null, infoRun = 0;
  function scheduleInfo() {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(async () => {
      const run = ++infoRun;
      try {
        const out = renderImage(src, st.r, st.width);
        const blob = await encodeImage(out, needsPng(out), st.quality);
        if (run !== infoRun) return;
        q('[data-k=info]').innerHTML = `Result: <b>${out.width} × ${out.height}</b> px, about <b>${fmtSize(blob.size)}</b>` +
          ` <span class="muted">(now ${fmtSize(curBlob.size)})</span>` + (out.width < st.width ? '<br><span class="muted">Smaller than the width you asked for: images are never enlarged.</span>' : '');
      } catch (e) { q('[data-k=info]').textContent = ''; }
    }, 350);
  }
  const origPng = /png|webp/i.test(origBlob.type || extOf(entry ? entry.original : current));
  const needsPng = c => origPng && hasAlpha(c);

  const close = () => { box.remove(); window.removeEventListener('resize', redrawBase); if (src.close) src.close(); };
  window.addEventListener('resize', redrawBase);
  q('[data-k=cancel]').onclick = close;
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  q('[data-k=replace]').onclick = async () => {
    close();
    const path = await pickAndUpload(target.kind === 'bg' ? 'bg' : 'content');
    if (!path) return;
    mutate(() => { if (target.kind === 'img') setImageSrc(target.img, path); else setBackground(target.el, path); selected = target.section || blockOf(target.img) || selected; });
  };
  q('[data-k=apply]').onclick = async () => {
    const btn = q('[data-k=apply]'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const stem = slugName(current.split('/').pop()).replace(/-\d{8}-\d{6}$/, ''), stp = imgStamp();
      let original = entry && entry.original;
      if (!original) {                               // first edit: keep what is there now as the original
        original = current;
        if (!(await B.hasFile('originals', original))) await B.writeFile('originals', original, curBlob);
      }
      const out = renderImage(src, st.r, st.width);
      const png = needsPng(out);
      const blob = await encodeImage(out, png, st.quality);
      const path = `uploads/editor/${stem}-${stp}.${png ? 'png' : 'jpg'}`;
      await B.writeFile('site', path, blob);
      const all = await loadEdits();
      all[path] = { original, recipe: st.r, width: st.width, quality: st.quality };
      await saveEdits(all);
      close();
      mutate(() => {
        if (target.kind === 'img') setImageSrc(target.img, path); else setBackground(target.el, path);
        selected = target.section || blockOf(target.img) || selected;
      });
      status(`Image saved: ${out.width} × ${out.height} px, ${fmtSize(blob.size)}. Save the page to keep it.`);
    } catch (e) { btn.disabled = false; btn.textContent = 'Apply'; status('Could not save the image: ' + e.message, true); }
  };
  if (entry && st.aspect === 'free') { /* keep the saved crop */ }
  requestAnimationFrame(redrawBase);
}

/* ---------------- whole site: what is used, optimise, clean up ---------------- */
const decodeEnt = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function resolveRef(baseDir, ref) {
  ref = decodeEnt(String(ref)).trim().replace(/^['"]|['"]$/g, '');
  if (!ref || /^(#|data:|mailto:|tel:|javascript:|[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return null;
  ref = ref.split(/[?#]/)[0];
  try { ref = decodeURIComponent(ref); } catch (e) { /* keep */ }
  const out = ref.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const seg of ref.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return out.join('/');
}

async function scanSite(onProgress) {
  const files = await B.listFiles('site');
  const sizes = new Map(files.map(f => [f.path, f.size]));
  const used = new Set(), kinds = new Map();
  const queue = files.filter(f => /\.html$/i.test(f.path) && !f.path.includes('/')).map(f => f.path);
  queue.forEach(p => used.add(p));
  const seen = new Set();
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    let text;
    try { text = await (await B.readFile('site', p)).text(); } catch (e) { continue; }
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const found = [];
    if (/\.html?$/i.test(p)) for (const m of text.matchAll(/\b(src|href|data-src|poster)\s*=\s*["']([^"']+)["']/gi)) found.push([m[1].toLowerCase() === 'href' ? 'zoom' : 'img', m[2]]);
    for (const m of text.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) found.push(['bg', m[1].replace(/&quot;/g, '')]);
    for (const [k, ref] of found) {
      const r = resolveRef(dir, ref);
      if (!r || !sizes.has(r)) continue;
      if (!used.has(r)) { used.add(r); if (/\.(css|html?)$/i.test(r)) queue.push(r); }
      if (RASTER.test(r) || /\.gif$/i.test(r)) { if (!kinds.has(r)) kinds.set(r, new Set()); kinds.get(r).add(k); }
    }
    if (onProgress) onProgress(seen.size);
  }
  // only files under uploads/ are treated as removable; theme and script files always stay
  const unused = files.filter(f => !used.has(f.path) && f.path.startsWith('uploads/'));
  return { files, sizes, used, kinds, unused };
}

async function openOptimise() {
  if (!doc) return;
  if (!(await confirmLeaveForSiteChange())) return;
  const body = document.createElement('div');
  body.innerHTML = '<p class="hint" data-k="prog">Looking at every page…</p>';
  const done = modal('Images', body, [['cancel', 'Close']]);
  const prog = body.querySelector('[data-k=prog]');
  let scan;
  try { scan = await scanSite(n => { prog.textContent = `Looking at every page… (${n} files read)`; }); }
  catch (e) { prog.textContent = 'Could not read the site: ' + e.message; return; }
  const edits = await loadEdits();
  const total = scan.files.reduce((t, f) => t + f.size, 0);
  const unusedSize = scan.unused.reduce((t, f) => t + f.size, 0);
  const imgs = [...scan.kinds.keys()].filter(p => RASTER.test(p) && p.startsWith('uploads/')).sort();
  const rows = [];
  const urls = [];
  body.innerHTML = `
    <p><b>${scan.files.length}</b> files, ${fmtSize(total)}. Pages use <b>${scan.used.size}</b>${scan.unused.length ?
      `; <b>${scan.unused.length}</b> uploaded files (${fmtSize(unusedSize)}) are not used by any page` : ', and every uploaded file is used'}.</p>
    <div class="sec-title">Images on the pages</div>
    <p class="hint" data-k="prog">Checking ${imgs.length} images…</p>
    <div class="optlist"></div>
    <div class="actions" style="margin-top:10px"><button class="primary" data-k="opt" disabled>Optimise selected images</button></div>
    <div class="sec-title">Files no page uses</div>
    <p class="hint">${scan.unused.length ? `These ${scan.unused.length} files (${fmtSize(unusedSize)}) are Weebly originals, thumbnails and leftovers.
      ${isLoaded() ? 'They are already left out when you download the site; moving them makes that permanent for this session.' :
      `Moving puts them in <i>unused-files</i> next to the site, so they are not published but not lost either.`}` : 'Nothing to clean up.'}</p>
    ${scan.unused.length ? `<div class="actions"><button data-k="unused">Move ${scan.unused.length} unused files out of the site</button></div>` : ''}
    <p class="hint" data-k="done"></p>`;
  const list = body.querySelector('.optlist'), p2 = body.querySelector('[data-k=prog]');
  // check each image: its size now, and after optimising
  for (let i = 0; i < imgs.length; i++) {
    const path = imgs[i], k = scan.kinds.get(path);
    if (!$('#modal') || $('#modal').hidden) break;           // closed meanwhile
    p2.textContent = `Checking images… ${i + 1} / ${imgs.length}`;
    const width = k.has('bg') ? IMG_BG_MAX : IMG_CONTENT_MAX;
    const row = { path, width, size: scan.sizes.get(path), use: k.has('bg') ? 'background' : k.has('img') ? 'on page' : 'enlarged view' };
    try {
      const blob = await B.readFile('site', path);
      const s = await decodeImage(blob);
      row.w = srcW(s); row.h = srcH(s);
      const out = renderImage(s, defaultRecipe(), width);
      row.png = /png|webp/i.test(extOf(path)) && hasAlpha(out);
      row.after = (await encodeImage(out, row.png, IMG_QUALITY)).size;
      row.ow = out.width; row.oh = out.height;
      if (s.close) s.close();
      const u = URL.createObjectURL(blob); urls.push(u); row.thumb = u;
    } catch (e) { row.error = true; }
    row.gain = row.error ? 0 : row.size - row.after;
    row.pick = !row.error && row.after < row.size * 0.9;
    rows.push(row);
    const el = document.createElement('label');
    el.className = 'optrow';
    el.innerHTML = `<input type="checkbox" ${row.pick ? 'checked' : ''} ${row.error ? 'disabled' : ''}>
      <span class="ot" style="background-image:url('${row.thumb || ''}')"></span>
      <span class="on"><b>${esc(path.split('/').pop())}</b><br><span class="muted">${row.use}${row.w ? ` · ${row.w} × ${row.h}` : ''}${edits[path] ? ' · edited' : ''}</span></span>
      <span class="os">${fmtSize(row.size)}${row.error ? '' : ` → <b>${fmtSize(Math.min(row.after, row.size))}</b>`}</span>`;
    el.querySelector('input').onchange = e => { row.pick = e.target.checked; updateBtn(); };
    list.appendChild(el);
  }
  const updateBtn = () => {
    const picked = rows.filter(r => r.pick), gain = picked.reduce((t, r) => t + Math.max(0, r.gain), 0);
    const b = body.querySelector('[data-k=opt]');
    b.disabled = !picked.length;
    b.textContent = picked.length ? `Optimise ${picked.length} images (saves about ${fmtSize(gain)})` : 'Nothing to optimise';
  };
  p2.textContent = rows.some(r => r.pick) ? 'Ticked images get smaller without visible loss. Their originals are kept in image-originals.' : 'All images are already a good size.';
  updateBtn();

  body.querySelector('[data-k=opt]').onclick = async e => {
    const btn = e.target; btn.disabled = true;
    const picked = rows.filter(r => r.pick), all = await loadEdits(), renamed = [];
    let n = 0, saved = 0;
    for (const r of picked) {
      btn.textContent = `Optimising ${++n} / ${picked.length}…`;
      try {
        const cur = await B.readFile('site', r.path);
        const entry = all[r.path];
        let srcBlob = cur, recipe = defaultRecipe(), original = r.path;
        if (entry) { try { srcBlob = await B.readFile('originals', entry.original); recipe = entry.recipe; original = entry.original; } catch (er) { /* use current */ } }
        else if (!(await B.hasFile('originals', original))) await B.writeFile('originals', original, cur);
        const s = await decodeImage(srcBlob);
        const out = renderImage(s, recipe, r.width);
        if (s.close) s.close();
        const png = r.png;
        const blob = await encodeImage(out, png, IMG_QUALITY);
        if (blob.size >= cur.size) continue;
        let path = r.path;
        if (!png && !/\.jpe?g$/i.test(path)) {      // PNG/WebP without transparency becomes a JPEG
          path = path.replace(/\.[a-z]+$/i, '.jpg');
          if (await B.hasFile('site', path)) path = path.replace(/\.jpg$/, '-' + imgStamp() + '.jpg');
          renamed.push([r.path, path]);
        }
        await B.writeFile('site', path, blob);
        all[path] = { original, recipe, width: r.width, quality: IMG_QUALITY };
        saved += cur.size - blob.size;
      } catch (er) { /* skip this one */ }
    }
    if (renamed.length) {                              // point the pages at the new names
      for (const pg of pagesList) {
        let html = await B.readText(pg.file), changed = false;
        for (const [from, to] of renamed) { if (html.includes(from)) { html = html.split(from).join(to); changed = true; } }
        if (changed) await B.savePage(pg.file, html);
      }
      for (const [from] of renamed) { try { await B.moveFile('site', from, 'unused'); } catch (er) { /* ignore */ } }
    }
    await saveEdits(all);
    body.querySelector('[data-k=done]').textContent = `Done: ${n} images optimised, ${fmtSize(saved)} smaller.`;
    btn.textContent = 'Optimised';
    loadPage(page);
  };
  const ub = body.querySelector('[data-k=unused]');
  if (ub) ub.onclick = async () => {
    ub.disabled = true;
    let n = 0;
    for (const f of scan.unused) {
      ub.textContent = `Moving ${++n} / ${scan.unused.length}…`;
      try { await B.moveFile('site', f.path, 'unused'); } catch (e) { /* skip */ }
    }
    ub.textContent = `Moved ${n} files`;
    body.querySelector('[data-k=done]').textContent = isLoaded() ? 'Unused files will not be in the downloaded site.' : 'Unused files are now in unused-files, next to the site.';
    if (isLoaded()) updateDownload();
  };
  await done;
  urls.forEach(u => URL.revokeObjectURL(u));
}

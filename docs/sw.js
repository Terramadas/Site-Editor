/* Site editor service worker: serves the files of the website folder you opened in the
   editor (local-folder mode). Requests for  <editor>/site/...  are answered by the editor
   tab, which has permission to read the folder. Nothing is cached or sent anywhere. */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const prefix = new URL('site/', self.registration.scope).pathname;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return;
  e.respondWith(serve(url, prefix));
});

function ask(client, msg) {
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('timeout')), 4000);
    ch.port1.onmessage = ev => { clearTimeout(timer); resolve(ev.data); };
    client.postMessage(msg, [ch.port2]);
  });
}

async function serve(url, prefix) {
  let rel;
  try { rel = decodeURIComponent(url.pathname.slice(prefix.length)); } catch (e) { rel = ''; }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const editors = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(c => !new URL(c.url).pathname.startsWith(prefix));
  for (const c of editors) {
    try {
      const r = await ask(c, { type: 'site-file', rel, edit: url.searchParams.has('edit') });
      if (r && r.status !== 503) {
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store' } });
      }
    } catch (e) { /* try the next editor tab */ }
  }
  return new Response('<p style="font:16px sans-serif;padding:2em">Open the Site editor and choose the website folder to see this page.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Mettu works offline after the first visit. Shared files (Android share sheet → installed PWA) arrive here.
const SHELL = 'mettu-shell-v2-wide';
const FILES = ['./', 'index.html', 'styles.css', 'kolam/tokens.css', 'kolam/kolam.css', 'i18n.js', 'audio.js', 'lookup.js', 'store.js', 'native.js', 'app.js', 'manifest.json', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== 'mettu-share').map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const f = form.get('audio');
      if (f && f.size) {
        const c = await caches.open('mettu-share');
        await c.put('shared-file', new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'Shared audio') } }));
        return Response.redirect('./#/?shared=1', 303);
      }
      const link = form.get('url') || form.get('text') || '';
      return Response.redirect('./#/find?link=' + encodeURIComponent(String(link).slice(0, 500)), 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(u.host)) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(s => s.put(e.request, c)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});

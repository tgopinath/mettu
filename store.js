// My tones: saved in IndexedDB on this device only.
const Store = (() => {
  let dbp;
  const db = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('mettu', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tones', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('tones', mode); const s = t.objectStore('tones'); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
  return {
    all: async () => (await tx('readonly', s => s.getAll())).sort((a, b) => b.created - a.created),
    get: id => tx('readonly', s => s.get(id)),
    put: tone => tx('readwrite', s => s.put(tone)),
    remove: id => tx('readwrite', s => s.delete(id)),
  };
})();

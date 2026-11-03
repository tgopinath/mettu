// Bridge to the Android app's native plugin (MettuNative). On the web every call falls back gracefully.
const Native = (() => {
  const cap = () => window.Capacitor;
  const available = () => !!(cap()?.isNativePlatform?.() && (cap().isPluginAvailable?.('MettuNative') ?? true));
  const call = (method, opts = {}) => {
    const c = cap();
    if (c?.nativePromise) return c.nativePromise('MettuNative', method, opts);
    return c.Plugins.MettuNative[method](opts);
  };
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const fromB64 = (s, type) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

  return {
    available,
    onShared(cb) { try { cap().Plugins.MettuNative.addListener('shared', cb); } catch {} },
    // kind: ringtone | notification | alarm | contact
    async setTone(blob, { title, fileName, kind, contactUri }) {
      return call('setTone', { data: await b64(blob), mime: blob.type, title, fileName, kind, contactUri });
    },
    pickContact: () => call('pickContact'),
    async playRing(blob) { return call('playRing', { data: await b64(blob), mime: blob.type }); },
    stopRing: () => call('stopRing').catch(() => {}),
    ringVolume: () => call('ringVolume'),
    openSoundSettings: () => call('openSoundSettings'),
    openWriteSettings: () => call('openWriteSettings'),
    async takeShared() {
      if (!available()) return null;
      const r = await call('getShared').catch(() => null);
      if (!r) return null;
      return { error: r.error || '', file: r.data ? new File([fromB64(r.data, r.mime || 'audio/*')], r.name || 'Shared audio', { type: r.mime || '' }) : null, text: r.text || '' };
    },
  };
})();

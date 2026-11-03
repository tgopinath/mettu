// Mettu audio engine: decode, analyse (quiet points, onsets, beats), render (trim, fade, level) and encode.
// Everything runs in the browser; no audio ever leaves the device.
const Audio2 = (() => {
  let ctx;
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  const SR = 44100;

  async function decode(arrayBuffer) {
    const buf = await ac().decodeAudioData(arrayBuffer.slice(0));
    if (!buf.duration || buf.duration < 1) throw new Error('too-short');
    return buf;
  }

  // Mono mix, downsampled by `step` with peak-preserving abs max, for drawing.
  function mono(buf) {
    const n = buf.length, out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return out;
  }

  // ---------- analysis ----------
  // Frames of ~11.6 ms. Returns envelopes plus snap candidates.
  function analyse(buf) {
    const x = mono(buf), sr = buf.sampleRate;
    const hop = Math.round(sr * 0.0116), frames = Math.floor(x.length / hop);
    const rms = new Float32Array(frames), hf = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0, h = 0; const o = f * hop;
      for (let i = 1; i < hop; i++) { const v = x[o + i]; s += v * v; const d = v - x[o + i - 1]; h += d * d; }
      rms[f] = Math.sqrt(s / hop); hf[f] = Math.sqrt(h / hop);
    }
    const fdur = hop / sr;
    const db = Array.from(rms, v => 20 * Math.log10(v + 1e-7));
    // Smoothed loudness (≈60 ms) for quiet points.
    const sm = smooth(db, 5);
    const sorted = [...sm].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)], p90 = sorted[Math.floor(sorted.length * 0.9)];
    const quietLimit = Math.min(p25, p90 - 12);
    const quiet = [];
    const R = Math.round(0.15 / fdur);
    for (let f = R; f < frames - R; f++) {
      if (sm[f] > quietLimit) continue;
      let isMin = true;
      for (let k = f - R; k <= f + R && isMin; k++) if (sm[k] < sm[f]) isMin = false;
      if (isMin && (!quiet.length || (f - quiet[quiet.length - 1].f) * fdur > 0.25)) quiet.push({ f, t: f * fdur, depth: p90 - sm[f] });
    }
    // Onset strength: rectified rise in high-frequency log energy.
    const lh = Array.from(hf, v => Math.log(1 + 1000 * v));
    const flux = new Float32Array(frames);
    for (let f = 1; f < frames; f++) flux[f] = Math.max(0, lh[f] - lh[f - 1]);
    const onsets = [];
    const W = Math.round(0.4 / fdur), minGap = Math.round(0.1 / fdur);
    let last = -1e9;
    for (let f = 1; f < frames - 1; f++) {
      if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
      let m = 0, c = 0;
      for (let k = Math.max(0, f - W); k < Math.min(frames, f + W); k++) { m += flux[k]; c++; }
      m /= c;
      if (flux[f] > m * 1.6 + 0.05 && f - last > minGap) { onsets.push({ t: f * fdur, s: flux[f] }); last = f; }
    }
    // Tempo by autocorrelation of onset strength (60–180 BPM, mild preference near 110).
    let best = 0, bestLag = 0;
    const lo = Math.round(60 / 180 / fdur), hi = Math.round(60 / 60 / fdur);
    const N = Math.min(frames, Math.round(120 / fdur));
    const start = Math.max(0, Math.floor((frames - N) / 2));
    for (let lag = lo; lag <= hi; lag++) {
      let s = 0;
      for (let f = start; f < start + N - lag; f++) s += flux[f] * flux[f + lag];
      const bpm = 60 / (lag * fdur), w = Math.exp(-Math.pow(Math.log2(bpm / 110), 2) / 0.8);
      s *= w;
      if (s > best) { best = s; bestLag = lag; }
    }
    let bpm = bestLag ? 60 / (bestLag * fdur) : 0;
    // Confidence: peak vs. mean autocorrelation.
    let mean = 0, cnt = 0;
    for (let lag = lo; lag <= hi; lag += 3) { let s = 0; for (let f = start; f < start + N - lag; f += 2) s += flux[f] * flux[f + lag]; mean += s * 2; cnt++; }
    mean /= cnt || 1;
    const conf = mean ? best / mean : 0;
    let beats = [];
    if (bestLag && conf > 1.25 && onsets.length > 8) {
      let bestPhase = 0, bestSum = -1;
      for (let ph = 0; ph < bestLag; ph++) {
        let s = 0; for (let f = ph; f < frames; f += bestLag) s += flux[f];
        if (s > bestSum) { bestSum = s; bestPhase = ph; }
      }
      for (let f = bestPhase; f < frames; f += bestLag) beats.push(f * fdur);
    } else bpm = 0;
    return { fdur, db: sm, quiet, onsets, beats, bpm: Math.round(bpm), duration: buf.duration };
  }

  function smooth(a, r) {
    const p = new Float64Array(a.length + 1);
    for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i];
    return Array.from(a, (_, i) => { const lo = Math.max(0, i - r), hi = Math.min(a.length, i + r + 1); return (p[hi] - p[lo]) / (hi - lo); });
  }

  // Nearest snap target to t within `range` seconds. Quiet points win ties for starts/ends.
  function snap(an, t, range, kind) {
    let bestT = t, bestD = range, src = null;
    const tryT = (x, bias, s) => { const d = Math.abs(x - t) * bias; if (d < bestD) { bestD = d; bestT = x; src = s; } };
    for (const q of an.quiet) tryT(q.t, 0.7, 'quiet');
    for (const b of an.beats) tryT(b, 1, 'beat');
    for (const o of an.onsets) tryT(Math.max(0, o.t - (kind === 'start' ? 0.02 : 0)), 1.1, 'onset');
    return { t: bestT, src };
  }

  // The best part: loud early (calls are answered within ~10 s), loud overall, starting on a quiet point or beat.
  function bestPart(an, len) {
    const { db, fdur, duration } = an;
    if (duration <= len) return { start: 0, end: duration };
    const pref = new Float64Array(db.length + 1);
    for (let i = 0; i < db.length; i++) pref[i + 1] = pref[i] + Math.max(db[i], -60);
    const avg = (a, b) => { const fa = Math.max(0, Math.round(a / fdur)), fb = Math.min(db.length, Math.round(b / fdur)); return fb > fa ? (pref[fb] - pref[fa]) / (fb - fa) : -60; };
    const cands = [...an.quiet.map(q => q.t), ...an.beats.filter((_, i) => i % 4 === 0), ...an.onsets.map(o => o.t)];
    for (let t = 0; t < duration - len; t += 1) cands.push(t);
    let best = { start: 0, score: -1e9 };
    for (const s of cands) {
      if (s < 0 || s + len > duration) continue;
      const intro = s < duration * 0.06 ? 3 : 0;
      const score = 0.55 * avg(s + 0.5, s + Math.min(10, len)) + 0.45 * avg(s, s + len) - intro;
      if (score > best.score) best = { start: s, score };
    }
    const end = snap(an, best.start + len, 0.6, 'end').t;
    return { start: best.start, end: Math.min(duration, Math.max(best.start + 3, end)) };
  }

  // ---------- loudness (EBU R128 / BS.1770 style, approximate) ----------
  async function lufs(buf) {
    if (buf.duration < 0.5) return -70;
    const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
    const src = off.createBufferSource(); src.buffer = buf;
    const shelf = off.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681.97; shelf.gain.value = 4;
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5;
    src.connect(shelf).connect(hp).connect(off.destination); src.start();
    const k = await off.startRendering();
    const block = Math.round(0.4 * k.sampleRate), stepN = Math.round(block / 4);
    const z = [];
    for (let o = 0; o + block <= k.length; o += stepN) {
      let s = 0;
      for (let c = 0; c < k.numberOfChannels; c++) { const d = k.getChannelData(c); for (let i = o; i < o + block; i++) s += d[i] * d[i]; }
      z.push(s / block);
    }
    const L = v => -0.691 + 10 * Math.log10(v + 1e-12);
    let g = z.filter(v => L(v) > -70);
    if (!g.length) return -70;
    const rel = L(g.reduce((a, b) => a + b, 0) / g.length) - 10;
    g = g.filter(v => L(v) > rel);
    return L(g.reduce((a, b) => a + b, 0) / (g.length || 1));
  }

  function peak(buf) {
    let p = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; } }
    return p;
  }

  function slice(buf, start, end) {
    const sr = buf.sampleRate, a = Math.floor(start * sr), b = Math.min(buf.length, Math.floor(end * sr));
    const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
    return out;
  }

  // Look-ahead peak limiter (5 ms), so "Loud" really gets loud without clipping.
  function limit(src, gain, ceiling) {
    const sr = src.sampleRate, n = src.length, ch = src.numberOfChannels, la = Math.max(1, Math.round(0.005 * sr));
    const d = [...Array(ch)].map((_, c) => src.getChannelData(c));
    const req = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < ch; c++) { const v = Math.abs(d[c][i]); if (v > m) m = v; } const p = m * gain; req[i] = p > ceiling ? ceiling / p : 1; }
    // sliding minimum over [i-la, i+la], then a box average over the same span: never above what a peak needs
    const mn = new Float32Array(n), q = new Int32Array(n); let h = 0, tl = 0;
    for (let i = 0, j = 0; i < n; i++) {
      for (; j < n && j <= i + la; j++) { while (tl > h && req[q[tl - 1]] >= req[j]) tl--; q[tl++] = j; }
      while (q[h] < i - la) h++;
      mn[i] = req[q[h]];
    }
    const env = new Float32Array(n); let acc = 0; const W = 2 * la + 1;
    for (let i = 0; i < Math.min(n, la); i++) acc += mn[i];
    for (let i = 0; i < n; i++) { if (i + la < n) acc += mn[i + la]; if (i - la - 1 >= 0) acc -= mn[i - la - 1]; const lo = Math.max(0, i - la), hi = Math.min(n - 1, i + la); env[i] = acc / (hi - lo + 1); }
    const rel = 1 - Math.exp(-1 / (0.08 * sr)); let e = 1;
    const out = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
    const o = [...Array(ch)].map((_, c) => out.getChannelData(c));
    for (let i = 0; i < n; i++) {
      e = env[i] < e ? env[i] : e + (env[i] - e) * rel;
      const g = gain * e;
      for (let c = 0; c < ch; c++) { let v = d[c][i] * g; if (v > ceiling) v = ceiling; else if (v < -ceiling) v = -ceiling; o[c][i] = v; }
    }
    return out;
  }

  // Render the final tone. opts: { start, end, fadeIn, fadeOut, target (LUFS or null) }
  async function render(buf, o) {
    const len = o.end - o.start;
    const part = slice(buf, o.start, o.end);
    const before = await lufs(part);
    const ch = Math.min(2, buf.numberOfChannels);
    const off = new OfflineAudioContext(ch, Math.ceil(len * SR), SR);
    const src = off.createBufferSource(); src.buffer = part;
    const g = off.createGain();
    const fi = Math.min(o.fadeIn || 0, len / 2), fo = Math.min(o.fadeOut || 0, len / 2);
    g.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
    if (fi > 0) g.gain.linearRampToValueAtTime(1, fi);
    g.gain.setValueAtTime(1, Math.max(fi, len - fo));
    if (fo > 0) g.gain.linearRampToValueAtTime(0, len);
    src.connect(g).connect(off.destination); src.start();
    const faded = await off.startRendering();
    const ceiling = Math.pow(10, -1 / 20);
    let gain = 1, out, after;
    if (o.target != null && before > -60) {
      gain = Math.min(16, Math.pow(10, (o.target - before) / 20));
      for (let i = 0; i < 6; i++) {
        out = limit(faded, gain, ceiling); after = await lufs(out);
        if (Math.abs(after - o.target) < 0.4 || gain >= 16) break;
        gain = Math.min(16, gain * Math.pow(10, (o.target - after) * 1.6 / 20));
      }
    } else {
      const p = peak(faded);
      out = p > ceiling ? limit(faded, 1, ceiling) : faded;
      after = await lufs(out);
    }
    const p = peak(out);
    return { buffer: out, before, after, peakDb: 20 * Math.log10(p + 1e-9) };
  }

  // ---------- encoding ----------
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
    const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([dv.buffer], { type: 'audio/wav' });
  }

  let lameP;
  const loadLame = () => lameP ||= new Promise((res, rej) => {
    if (window.lamejs) return res(window.lamejs);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    s.onload = () => res(window.lamejs); s.onerror = () => { lameP = null; rej(new Error('mp3-encoder')); };
    document.head.append(s);
  });

  async function mp3(buf, kbps = 160) {
    const lame = await loadLame();
    const ch = Math.min(2, buf.numberOfChannels);
    const enc = new lame.Mp3Encoder(ch, buf.sampleRate, kbps);
    const toI16 = d => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const v = Math.max(-1, Math.min(1, d[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
    const L = toI16(buf.getChannelData(0)), Rr = ch > 1 ? toI16(buf.getChannelData(1)) : null;
    const parts = [], B = 1152;
    for (let i = 0; i < L.length; i += B) {
      const m = Rr ? enc.encodeBuffer(L.subarray(i, i + B), Rr.subarray(i, i + B)) : enc.encodeBuffer(L.subarray(i, i + B));
      if (m.length) parts.push(new Uint8Array(m));
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // ---------- the built-in sample ----------
  // A 48-second piece made in the app (no licence questions): soft intro, a beat, a bright hook, a pause, the hook again.
  async function sample() {
    const dur = 48, off = new OfflineAudioContext(2, dur * SR, SR);
    const master = off.createGain(); master.gain.value = 0.5; master.connect(off.destination);
    const bpm = 96, beat = 60 / bpm;
    const note = (f, t, d, type = 'triangle', v = 0.25, pan = 0) => {
      const o = off.createOscillator(), g = off.createGain(), p = off.createStereoPanner();
      o.type = type; o.frequency.value = f; p.pan.value = pan;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(p).connect(master); o.start(t); o.stop(t + d + 0.05);
    };
    const kick = t => { const o = off.createOscillator(), g = off.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(master); o.start(t); o.stop(t + 0.35); };
    const noiseBuf = off.createBuffer(1, SR * 0.2, SR); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const tap = (t, v = 0.25) => { const s = off.createBufferSource(), f = off.createBiquadFilter(), g = off.createGain(); s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 5000; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); s.connect(f).connect(g).connect(master); s.start(t); };
    // Mayamalavagowla-flavoured scale on C: S r G M P d N S
    const S = 261.63, sc = [1, 16 / 15, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 15 / 8, 2].map(r => S * r);
    // Intro: drone + slow phrase (0–8 s)
    for (let t = 0; t < 8; t += 2) note(S / 2, t, 2.2, 'sine', 0.12);
    [0, 2, 4, 3, 2, 1, 0].forEach((d, i) => note(sc[d], 0.5 + i * 1.05, 1.1, 'sine', 0.16));
    // Groove + hook A (8–24 s), pause (24–25.5 s), hook B louder (25.5–44 s), tail
    const hook = [4, 5, 4, 2, 3, 2, 1, 0, 2, 4, 7, 6, 5, 4, 2, 4];
    const section = (t0, t1, v) => {
      for (let t = t0, b = 0; t < t1 - 0.01; t += beat, b++) {
        kick(t); tap(t + beat / 2, 0.18); if (b % 2) tap(t + beat * 0.75, 0.1);
        note(sc[hook[b % hook.length]] * 2, t, beat * 0.9, 'sawtooth', v * 0.35, -0.2);
        note(sc[hook[b % hook.length]], t, beat * 0.9, 'triangle', v, 0.2);
        if (b % 4 === 0) note(S / 2 * (b % 8 ? 4 / 3 : 1), t, beat * 4, 'sine', 0.2);
      }
    };
    section(8, 24, 0.22);
    section(25.5, 44, 0.3);
    for (let t = 44; t < 47.5; t += 1.5) note(S / 2, t, 1.6, 'sine', 0.1);
    note(S, 44.2, 3, 'sine', 0.14);
    return off.startRendering();
  }

  // Microphone recording (MediaRecorder), returns a Blob.
  async function record(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const an = ac().createAnalyser(); an.fftSize = 512;
    ac().createMediaStreamSource(stream).connect(an);
    const arr = new Uint8Array(an.fftSize); let raf;
    const tick = () => { an.getByteTimeDomainData(arr); let m = 0; for (const v of arr) m = Math.max(m, Math.abs(v - 128)); onLevel?.(m / 128); raf = requestAnimationFrame(tick); };
    tick(); rec.start(250);
    return { stop: () => new Promise(r => { rec.onstop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); r(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); }; rec.stop(); }) };
  }

  return { ac, decode, analyse, snap, bestPart, lufs, render, wav, mp3, sample, record, slice, peak };
})();

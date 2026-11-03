// Mettu app: routing, screens, waveform editor, ring test, tones.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = 'k-icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt = (s, dec = 1) => { const k = 10 ** dec; s = Math.round(Math.max(0, s) * k) / k; const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`; };
const store = { get(k, d) { try { const v = localStorage.getItem('mettu.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('mettu.' + k, JSON.stringify(v)); } catch {} } };
const isAndroid = /Android/i.test(navigator.userAgent), isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const APK = 'https://github.com/tgopinath/mettu/releases/latest/download/mettu.apk';
const RING_SECONDS = 25;

const S = {
  buf: null, an: null, fileName: '', sel: { start: 0, end: 30 }, len: store.get('len', 30), snap: store.get('snap', true),
  fadeIn: store.get('fadeIn', 0.3), fadeOut: store.get('fadeOut', 1.5), level: store.get('level', 'std'), loop: false, step: 'trim',
  view: null, rendered: null, renderKey: '', toneName: '', caller: '', shared: null, lookup: null,
};
const LEVELS = { off: null, soft: -18, std: -14, loud: -10 };

// ---------- shell ----------
const NAV = [['make', '#/', 'make'], ['find', '#/find', 'search'], ['tones', '#/tones', 'tones'], ['about', '#/about', 'info']];
function shell() {
  document.documentElement.lang = LANG;
  const route = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'make';
  const cur = route === 'edit' ? 'make' : route;
  const label = { make: t('navMake'), find: t('navFind'), tones: t('navTones'), about: t('navAbout') };
  const links = NAV.map(([k, href, ic]) => `<a href="${href}" ${cur === k ? 'aria-current="page"' : ''}><span class="k-pip">${icon(ic)}</span><span>${label[k]}</span></a>`).join('');
  $('#bottomnav').innerHTML = links;
  $('#topnav').innerHTML = NAV.map(([k, href, ic]) => `<a href="${href}" ${cur === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label[k]}</span></a>`).join('');
  const lb = $('#langBtn'); lb.textContent = t('langSwitch'); lb.setAttribute('aria-label', t('langLabel')); lb.lang = LANG === 'en' ? 'ta' : 'en';
}
$('#langBtn').onclick = () => { LANG = LANG === 'en' ? 'ta' : 'en'; store.set('lang', LANG); try { localStorage.setItem('mettu.lang', LANG); } catch {} route(); };

function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'k-toast';
  el.innerHTML = `${icon('check')}<span class="k-toast-text">${esc(msg)}</span>${action ? `<button class="k-btn k-btn-ghost" type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { action.run(); el.remove(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), action ? 7000 : 3800);
}
const say = msg => { $('#live').textContent = ''; setTimeout(() => ($('#live').textContent = msg), 30); };

function dialog(html, onMount) {
  const d = $('#dlg');
  d.innerHTML = html;
  d.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => d.close()));
  onMount?.(d);
  if (!d.open) d.showModal();
  return d;
}

// ---------- playback ----------
let player = null;
function stopAll() {
  if (player) { try { player.src.onended = null; player.src.stop(); } catch {} cancelAnimationFrame(player.raf); player = null; }
  $$('[data-playing]').forEach(b => { b.removeAttribute('data-playing'); const l = b.querySelector('.lbl'); if (l) l.textContent = b.dataset.idle || t('play'); const u = b.querySelector('use'); if (u) u.setAttribute('href', '#i-play'); });
  drawDetail(); drawOverview();
}
function playBuffer(buf, { offset = 0, duration, loop = false, btn, onTick, base = 0 } = {}) {
  stopAll();
  const ac = Audio2.ac(); ac.resume();
  const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
  if (loop) { src.loop = true; src.loopStart = offset; src.loopEnd = offset + (duration ?? buf.duration); src.start(0, offset); }
  else src.start(0, offset, duration);
  const t0 = ac.currentTime;
  player = { src, raf: 0, pos: () => { const el = ac.currentTime - t0; const d = duration ?? buf.duration - offset; return base + (loop ? el % d : Math.min(el, d)); } };
  if (btn) { btn.dataset.playing = '1'; const l = btn.querySelector('.lbl'); if (l) l.textContent = t('stop'); const u = btn.querySelector('use'); if (u) u.setAttribute('href', '#i-stop'); }
  const tick = () => { onTick?.(player.pos()); drawDetail(); drawOverview(); if (player) player.raf = requestAnimationFrame(tick); };
  tick();
  src.onended = () => stopAll();
}
const toggle = (btn, fn) => () => (btn.dataset.playing ? stopAll() : fn());

// ---------- loading audio ----------
async function loadFile(file, nameOverride) {
  stopAll();
  const main = $('#main');
  main.innerHTML = `<section class="wrap loading" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p class="body-lg" id="loadMsg">${t('loading')}</p></section>`;
  try {
    const buf = await Audio2.decode(await file.arrayBuffer());
    $('#loadMsg') && ($('#loadMsg').textContent = t('analysing'));
    await new Promise(r => setTimeout(r, 30));
    openBuffer(buf, nameOverride || file.name || 'Audio');
  } catch (e) {
    console.warn(e);
    main.innerHTML = `<section class="wrap"><div class="k-alert k-alert-danger" role="alert">${icon('alert')}<div><b class="k-alert-title">${t(e.message === 'too-short' ? 'tooShort' : 'badFile')}</b></div></div><p><a class="k-btn k-btn-outline" href="#/">${t('back')}</a></p></section>`;
  }
}
function openBuffer(buf, name) {
  S.buf = buf; S.an = Audio2.analyse(buf); S.fileName = name;
  S.mono = monoPeaks(buf);
  S.toneName = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').slice(0, 40);
  const len = Math.min(S.len, buf.duration);
  S.sel = Audio2.bestPart(S.an, len);
  S.step = 'trim'; S.rendered = null; S.renderKey = ''; S.view = null;
  if (location.hash.startsWith('#/edit')) route(); else location.hash = '#/edit';
}
// Peak pyramid for fast waveform drawing: [min,max] per 256 samples.
function monoPeaks(buf) {
  const B = 256, n = Math.ceil(buf.length / B), mn = new Float32Array(n), mx = new Float32Array(n);
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let lo = 1, hi = -1;
    for (let j = i * B, e = Math.min(buf.length, j + B); j < e; j++) { let v = 0; for (const d of chans) v += d[j]; v /= chans.length; if (v < lo) lo = v; if (v > hi) hi = v; }
    mn[i] = lo; mx[i] = hi;
  }
  return { B, mn, mx, sr: buf.sampleRate };
}

$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); };
document.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', e => { document.body.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); loadFile(f); } });

async function useSample() {
  stopAll();
  $('#main').innerHTML = `<section class="wrap loading" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p class="body-lg">${t('analysing')}</p></section>`;
  openBuffer(await Audio2.sample(), LANG === 'ta' ? 'மெட்டு மாதிரி இசை' : 'Mettu sample tune');
}

async function startRecording() {
  let rec = null, stopped = false, timer;
  const d = dialog(`<h2 class="k-dialog-title">${t('recTitle')}</h2><p class="k-dialog-body">${t('recHint')}</p>
    <div class="rec-meter" aria-hidden="true"><i id="recLvl"></i></div><p class="mono rec-time" id="recTime">0:00</p>
    <div class="k-dialog-actions"><button class="k-btn k-btn-outline" id="recCancel" type="button">${t('recCancel')}</button><button class="k-btn k-btn-primary" id="recStop" type="button" disabled>${icon('stop')}<span>${t('recStop')}</span></button></div>`);
  const halt = () => { if (stopped) return null; stopped = true; clearInterval(timer); return rec ? rec.stop() : null; };
  d.onclose = () => halt();
  $('#recCancel').onclick = () => { halt(); d.close(); };
  try {
    rec = await Audio2.record(v => { const el = $('#recLvl'); if (el) el.style.transform = `scaleX(${Math.min(1, v * 1.6)})`; });
    if (stopped) { rec.stop(); return; }
    const t0 = Date.now();
    $('#recStop').disabled = false;
    $('#recStop').onclick = async () => {
      const blob = await halt(); d.close();
      if (blob?.size) loadFile(new File([blob], (LANG === 'ta' ? 'பதிவு ' : 'Recording ') + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), { type: blob.type }));
    };
    timer = setInterval(() => { const s = (Date.now() - t0) / 1000; $('#recTime').textContent = fmt(s, 0); if (s >= 60) $('#recStop').click(); }, 250);
  } catch (e) {
    stopped = true;
    $('.k-dialog-body', d).innerHTML = `<span class="k-error">${icon('alert')}${t('recDenied')}</span>`;
    $('.rec-meter', d)?.remove(); $('#recTime')?.remove(); $('#recStop')?.remove();
  }
}

// ---------- screens ----------
function stepper(active) {
  const steps = [['bring', t('stepBring')], ['trim', t('stepTrim')], ['shape', t('stepShape')], ['test', t('stepTest')], ['set', t('stepSet')]];
  return `<ol class="stepper">${steps.map(([k, l], i) => `<li class="${k === active ? 'on' : ''}"><span>${i + 1}</span>${l}</li>`).join('')}</ol>`;
}

async function screenMake() {
  const tones = await Store.all().catch(() => []);
  $('#main').innerHTML = `
  <section class="wrap hero">
    <p class="kicker">${t('heroK')}</p>
    <h1 class="display">${t('heroH')}</h1>
    <p class="body-lg lead">${t('heroP')}</p>
    ${stepper('bring')}
  </section>
  <section class="wrap">
    ${S.shared ? `<div class="k-card shared-card"><div class="k-list-text"><span class="caption">${t('sharedK')}</span><b>${esc(S.shared.name)}</b></div><button class="k-btn k-btn-primary" id="openShared" type="button">${t('sharedOpen')}</button></div>` : ''}
    <div class="intake">
      <button class="pick primary" id="pickFile" type="button">${icon('file', 'k-icon pick-ic')}<span><b>${t('pickFile')}</b><small>${t('pickFileSub')}</small></span></button>
      <button class="pick" id="pickRec" type="button">${icon('mic', 'k-icon pick-ic')}<span><b>${t('record')}</b><small>${t('recordSub')}</small></span></button>
      <button class="pick" id="pickSample" type="button">${icon('spark', 'k-icon pick-ic')}<span><b>${t('sample')}</b><small>${t('sampleSub')}</small></span></button>
    </div>
    <p class="drop-hint body-sm">${t('drop')}</p>
  </section>
  <section class="wrap">
    <form class="k-card link-card" id="linkForm">
      <div><h2 class="heading-3">${t('linkH')}</h2><p class="body-sm muted">${t('linkP')}</p></div>
      <div class="link-row"><label class="k-sr-only" for="linkIn">${t('linkPh')}</label>
        <div class="k-input-group grow">${icon('link')}<input class="k-input" id="linkIn" type="url" inputmode="url" placeholder="${t('linkPh')}" autocomplete="off"></div>
        <button class="k-btn k-btn-secondary-solid" type="submit">${t('find')}</button></div>
    </form>
  </section>
  ${tones.length ? `<section class="wrap"><div class="sec-head"><h2 class="heading-2">${t('recent')}</h2><a href="#/tones">${t('seeAll')}</a></div>${toneList(tones.slice(0, 3))}</section>` : ''}`;
  $('#pickFile').onclick = () => $('#fileIn').click();
  $('#pickRec').onclick = startRecording;
  $('#pickSample').onclick = useSample;
  if (S.shared) $('#openShared').onclick = () => { const f = S.shared; S.shared = null; loadFile(f); };
  $('#linkForm').onsubmit = e => { e.preventDefault(); const v = $('#linkIn').value.trim(); if (v) { S.pendingLink = v; location.hash = '#/find'; } };
  wireTones(tones);
}

// ---------- editor ----------
function screenEdit() {
  if (!S.buf) { location.hash = '#/'; return; }
  const an = S.an, len = S.sel.end - S.sel.start;
  const lvl = k => `<button class="k-tab" role="radio" aria-checked="${S.level === k}" aria-selected="${S.level === k}" data-level="${k}" type="button">${t({ off: 'levelOff', soft: 'levelSoft', std: 'levelStd', loud: 'levelLoud' }[k])}</button>`;
  const stepNames = { trim: t('stepTrim'), shape: t('stepShape'), test: t('stepTest') };
  $('#main').innerHTML = `
  <section class="wrap editor">
    <div class="ed-head">
      <div class="ed-title"><h1 class="heading-2" title="${esc(S.fileName)}">${esc(S.fileName)}</h1>
        <p class="body-sm muted"><span class="mono">${fmt(S.buf.duration, 0)}</span> · ${an.bpm ? `<span class="k-badge k-badge-secondary">${t('bpm', { n: an.bpm })}</span>` : `<span class="k-badge">${t('noBeat')}</span>`}</p></div>
      <button class="k-btn k-btn-ghost k-btn-sm" id="changeFile" type="button">${t('changeFile')}</button>
    </div>
    <div class="k-tabs steps" role="tablist" aria-label="${t('stepTrim')}, ${t('stepShape')}, ${t('stepTest')}">
      ${['trim', 'shape', 'test'].map((k, i) => `<button class="k-tab" role="tab" id="tab-${k}" aria-controls="panel" aria-selected="${S.step === k}" data-step="${k}" type="button"><span class="n">${i + 2}</span>${stepNames[k]}</button>`).join('')}
    </div>

    <div class="wave-card k-card">
      <div class="overview" id="overview"><canvas id="ovCanvas" aria-hidden="true"></canvas><div class="ov-win" id="ovWin" role="slider" tabindex="0" aria-label="${t('overviewLabel')}"></div></div>
      <div class="detail" id="detail">
        <canvas id="dtCanvas" aria-hidden="true"></canvas>
        <div class="handle start" id="hStart" role="slider" tabindex="0" aria-label="${t('handleStart')}"><i></i></div>
        <div class="handle end" id="hEnd" role="slider" tabindex="0" aria-label="${t('handleEnd')}"><i></i></div>
        <div class="snap-flag" id="snapFlag" hidden></div>
      </div>
      <div class="legend body-sm"><span><i class="lg-quiet"></i>${t('legendQuiet')}</span>${an.beats.length ? `<span><i class="lg-beat"></i>${t('legendBeat')}</span>` : ''}<span><i class="lg-ring"></i>${t('legendRing')}</span></div>
      <div class="times">
        ${timeCtl('start')}
        <div class="len-read"><span class="caption">${t('length')}</span><b class="mono" id="lenRead">${fmt(len)}</b></div>
        ${timeCtl('end')}
      </div>
      <div class="play-row"><button class="k-btn k-btn-primary" id="playCut" type="button" data-idle="${t('playFromStart')}">${icon('play')}<span class="lbl">${t('playFromStart')}</span></button></div>
    </div>

    <div class="panel" id="panel" role="tabpanel" aria-labelledby="tab-${S.step}">
      <div class="pane" data-pane="trim" ${S.step !== 'trim' ? 'hidden' : ''}>
        <div class="row-wrap">
          <div class="k-field"><span class="k-label" id="lenLbl">${t('length')}</span>
            <div class="k-tabs" role="radiogroup" aria-labelledby="lenLbl">${[15, 20, 30, 40].map(n => `<button class="k-tab" role="radio" aria-checked="${Math.round(len) === n}" aria-selected="${Math.round(len) === n}" data-len="${n}" type="button" ${n > S.buf.duration + 0.5 ? 'disabled' : ''}>${t('seconds', { n })}</button>`).join('')}</div></div>
          <button class="k-btn k-btn-secondary" id="bestBtn" type="button">${icon('wand')}<span>${t('best')}</span></button>
        </div>
        <label class="k-switch"><span class="k-check-text"><b>${t('snap')}</b><small>${t('snapHelp')}</small></span><input type="checkbox" id="snapIn" ${S.snap ? 'checked' : ''}><span class="k-switch-track"></span></label>
        <p class="body-sm muted hint">${t('trimHint')}</p>
      </div>
      <div class="pane" data-pane="shape" ${S.step !== 'shape' ? 'hidden' : ''}>
        <div class="grid2">
          ${slider('fadeIn', t('fadeIn'), 0, 3, 0.1)}
          ${slider('fadeOut', t('fadeOut'), 0, 5, 0.1)}
        </div>
        <div class="k-field"><span class="k-label" id="lvlLbl">${t('level')}</span>
          <div class="k-tabs" role="radiogroup" aria-labelledby="lvlLbl">${['off', 'soft', 'std', 'loud'].map(lvl).join('')}</div>
          <p class="k-help">${t('levelHelp')}</p>
          <p class="meter mono" id="meter" aria-live="polite">${t('measuring')}</p></div>
        <div class="row-wrap">
          <label class="k-switch inline"><span>${t('loop')}</span><input type="checkbox" id="loopIn" ${S.loop ? 'checked' : ''}><span class="k-switch-track"></span></label>
          <button class="k-btn k-btn-outline" id="previewBtn" type="button" data-idle="${t('preview')}">${icon('play')}<span class="lbl">${t('preview')}</span></button>
        </div>
      </div>
      <div class="pane" data-pane="test" ${S.step !== 'test' ? 'hidden' : ''}>
        <h2 class="heading-3">${t('testH')}</h2>
        <p class="body muted">${t('testP')}</p>
        <p class="body-sm" id="loopNote"></p>
        <div class="row-wrap end">
          <div class="k-field grow"><label class="k-label" for="callerIn">${t('callerName')}</label><input class="k-input" id="callerIn" value="${esc(S.caller || t('callerDefault'))}" maxlength="30"></div>
          <button class="k-btn k-btn-accent k-btn-lg" id="ringBtn" type="button">${icon('phone')}<span>${t('ringIt')}</span></button>
        </div>
        <p class="k-help" id="volNote">${Native.available() ? '' : t('webVolume')}</p>
      </div>
    </div>

    <form class="save-bar k-card" id="saveForm">
      <div class="k-field grow"><label class="k-label" for="nameIn">${t('toneName')}</label><input class="k-input" id="nameIn" value="${esc(S.toneName)}" maxlength="40" required></div>
      <div class="save-actions">
        ${S.step !== 'test' ? `<button class="k-btn k-btn-outline" id="nextBtn" type="button">${t('next')}${icon('next')}</button>` : ''}
        <button class="k-btn k-btn-primary" type="submit">${icon('check')}<span>${t('saveTone')}</span></button>
      </div>
    </form>
  </section>`;

  $('#changeFile').onclick = () => { stopAll(); location.hash = '#/'; };
  $$('[data-step]').forEach(b => (b.onclick = () => setStep(b.dataset.step)));
  $('.steps').onkeydown = e => {
    const keys = ['trim', 'shape', 'test'], i = keys.indexOf(S.step);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setStep(keys[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]); $(`#tab-${S.step}`).focus(); }
  };
  $('#nextBtn') && ($('#nextBtn').onclick = () => setStep(S.step === 'trim' ? 'shape' : 'test'));
  $$('[data-len]').forEach(b => (b.onclick = () => {
    const n = +b.dataset.len; S.len = n; store.set('len', n);
    let s = S.sel.start, e = Math.min(S.buf.duration, s + n);
    if (e - s < n) s = Math.max(0, e - n);
    if (S.snap) e = Audio2.snap(S.an, e, 0.5, 'end').t;
    setSel(s, e, true);
  }));
  $('#bestBtn').onclick = () => { const b = Audio2.bestPart(S.an, Math.min(S.len, S.buf.duration)); setSel(b.start, b.end, true); say(t('bestDone')); toast(t('bestDone')); };
  $('#snapIn').onchange = e => { S.snap = e.target.checked; store.set('snap', S.snap); };
  $('#playCut').onclick = toggle($('#playCut'), () => S.step === 'trim' ? playBuffer(S.buf, { offset: S.sel.start, duration: S.sel.end - S.sel.start, btn: $('#playCut'), base: S.sel.start }) : playRendered($('#playCut')));
  ['fadeIn', 'fadeOut'].forEach(k => { const el = $('#' + k); el.oninput = () => { S[k] = +el.value; store.set(k, S[k]); $(`#${k}Out`).textContent = t('seconds', { n: S[k].toFixed(1) }); drawDetail(); scheduleRender(); }; });
  $$('[data-level]').forEach(b => (b.onclick = () => { S.level = b.dataset.level; store.set('level', S.level); $$('[data-level]').forEach(x => { x.setAttribute('aria-checked', x === b); x.setAttribute('aria-selected', x === b); }); scheduleRender(); }));
  $('#loopIn').onchange = e => (S.loop = e.target.checked);
  $('#previewBtn').onclick = toggle($('#previewBtn'), () => playRendered($('#previewBtn')));
  $('#callerIn').oninput = e => (S.caller = e.target.value);
  $('#ringBtn').onclick = ringTest;
  $('#nameIn').oninput = e => (S.toneName = e.target.value);
  $('#saveForm').onsubmit = e => { e.preventDefault(); saveTone(); };

  setupWave();
  updateTimes();
  if (S.step !== 'trim') scheduleRender(0);
  updateTestNotes();
}
function timeCtl(w) {
  const lbl = w === 'start' ? t('start') : t('end');
  return `<div class="time-ctl ${w}"><span class="caption">${lbl}</span><div class="nudge">
    <button class="k-iconbtn" data-nudge="${w}" data-d="-0.1" type="button" aria-label="${t('nudgeBack', { w: lbl })}">${icon('back')}</button>
    <b class="mono" id="${w}Read">0:00.0</b>
    <button class="k-iconbtn" data-nudge="${w}" data-d="0.1" type="button" aria-label="${t('nudgeFwd', { w: lbl })}">${icon('next')}</button></div></div>`;
}
function slider(k, label, min, max, step) {
  return `<div class="k-field"><div class="sl-head"><label class="k-label" for="${k}">${label}</label><span class="mono" id="${k}Out">${t('seconds', { n: S[k].toFixed(1) })}</span></div>
    <input class="range" type="range" id="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"></div>`;
}
function setStep(k) {
  stopAll(); S.step = k;
  $$('[data-step]').forEach(b => b.setAttribute('aria-selected', b.dataset.step === k));
  $$('[data-pane]').forEach(p => (p.hidden = p.dataset.pane !== k));
  $('#panel').setAttribute('aria-labelledby', 'tab-' + k);
  const nb = $('#nextBtn');
  if (nb) nb.hidden = k === 'test';
  if (k !== 'trim') scheduleRender(0);
  updateTestNotes(); drawDetail();
}
function updateTestNotes() {
  const len = S.sel.end - S.sel.start, n = $('#loopNote');
  if (n) n.textContent = len < RING_SECONDS - 1 ? t('shortLoop', { n: Math.round(len), r: Math.ceil(RING_SECONDS / len) }) : '';
  if (Native.available() && $('#volNote')) Native.ringVolume().then(v => { if ($('#volNote')) $('#volNote').textContent = t('nativeVolume', { n: Math.round((v.level ?? 0) * 100) }) + (v.mode && v.mode !== 'normal' ? ' ' + t('silentNote') : ''); }).catch(() => {});
}

// Selection changes keep the detail view stable while dragging, then re-frame.
function setSel(s, e, reframe) {
  const d = S.buf.duration;
  s = Math.max(0, Math.min(s, d - 1)); e = Math.max(s + 1, Math.min(e, d));
  S.sel = { start: s, end: e };
  if (reframe || !S.view) frameView();
  updateTimes(); drawOverview(); drawDetail();
  S.rendered = null;
  if (S.step !== 'trim') scheduleRender();
  updateTestNotes();
}
function frameView() {
  const len = S.sel.end - S.sel.start, pad = Math.max(1.5, len * 0.12), d = S.buf.duration;
  let a = S.sel.start - pad, b = Math.max(S.sel.end, Math.min(d, S.sel.start + RING_SECONDS)) + pad;
  if (a < 0) { b -= a; a = 0; } if (b > d) { a = Math.max(0, a - (b - d)); b = d; }
  S.view = { a, b };
}
function updateTimes() {
  const { start, end } = S.sel, len = end - start;
  $('#startRead') && ($('#startRead').textContent = fmt(start));
  $('#endRead') && ($('#endRead').textContent = fmt(end));
  $('#lenRead') && ($('#lenRead').textContent = fmt(len));
  for (const [id, v, lo, hi] of [['hStart', start, 0, end - 1], ['hEnd', end, start + 1, S.buf.duration]]) {
    const h = $('#' + id); if (!h) continue;
    h.setAttribute('aria-valuemin', lo.toFixed(1)); h.setAttribute('aria-valuemax', hi.toFixed(1)); h.setAttribute('aria-valuenow', v.toFixed(1)); h.setAttribute('aria-valuetext', fmt(v));
  }
  const ow = $('#ovWin'); if (ow) { ow.setAttribute('aria-valuemin', 0); ow.setAttribute('aria-valuemax', S.buf.duration.toFixed(0)); ow.setAttribute('aria-valuenow', start.toFixed(1)); ow.setAttribute('aria-valuetext', `${fmt(start)} – ${fmt(end)}`); }
  $$('[data-len]').forEach(b => { const on = Math.abs(len - +b.dataset.len) < 0.6; b.setAttribute('aria-checked', on); b.setAttribute('aria-selected', on); });
  positionHandles();
}

// ---------- waveform drawing ----------
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function sizeCanvas(c) {
  const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}
function drawPeaks(g, a, b, w, h, top, color, colorSel) {
  const P = S.mono, spb = P.B / P.sr, mid = top + h / 2;
  for (let x = 0; x < w; x++) {
    const t0 = a + (x / w) * (b - a), t1 = a + ((x + 1) / w) * (b - a);
    let i0 = Math.floor(t0 / spb), i1 = Math.max(i0 + 1, Math.floor(t1 / spb));
    let lo = 0, hi = 0;
    for (let i = i0; i < i1 && i < P.mn.length; i++) { if (P.mn[i] < lo) lo = P.mn[i]; if (P.mx[i] > hi) hi = P.mx[i]; }
    const inSel = t1 > S.sel.start && t0 < S.sel.end;
    g.fillStyle = inSel ? colorSel : color;
    const y0 = mid - hi * h * 0.48, y1 = mid - lo * h * 0.48;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}
function drawOverview() {
  const c = $('#ovCanvas'); if (!c || !S.buf) return;
  const { g, w, h } = sizeCanvas(c), d = S.buf.duration;
  g.clearRect(0, 0, w, h);
  drawPeaks(g, 0, d, w, h, 0, css('--line-strong'), css('--primary'));
  if (player) { const x = (player.pos() / d) * w; g.fillStyle = css('--ink'); g.fillRect(x, 0, 1.5, h); }
  const win = $('#ovWin');
  win.style.left = (S.sel.start / d) * 100 + '%';
  win.style.width = Math.max(0.8, ((S.sel.end - S.sel.start) / d) * 100) + '%';
}
function drawDetail() {
  const c = $('#dtCanvas'); if (!c || !S.buf || !S.view) return;
  const { g, w, h } = sizeCanvas(c), { a, b } = S.view, X = t => ((t - a) / (b - a)) * w;
  g.clearRect(0, 0, w, h);
  const top = 18, wh = h - 36;
  // selection band
  g.fillStyle = css('--primary-soft'); g.fillRect(X(S.sel.start), 0, X(S.sel.end) - X(S.sel.start), h);
  drawPeaks(g, a, b, w, wh, top, css('--line-strong'), css('--primary'));
  // fades (Shape step)
  if (S.step !== 'trim') {
    const fi = Math.min(S.fadeIn, (S.sel.end - S.sel.start) / 2), fo = Math.min(S.fadeOut, (S.sel.end - S.sel.start) / 2);
    g.strokeStyle = css('--secondary'); g.lineWidth = 2; g.beginPath();
    g.moveTo(X(S.sel.start), top + wh); g.lineTo(X(S.sel.start + fi), top + 2); g.lineTo(X(S.sel.end - fo), top + 2); g.lineTo(X(S.sel.end), top + wh); g.stroke();
  }
  // beats (bottom ticks) and quiet points (top markers)
  g.fillStyle = css('--ink-muted');
  for (const bt of S.an.beats) if (bt >= a && bt <= b) g.fillRect(X(bt) - 0.5, h - 10, 1, 8);
  g.fillStyle = css('--secondary');
  for (const q of S.an.quiet) if (q.t >= a && q.t <= b) { const x = X(q.t); g.beginPath(); g.moveTo(x - 4, 3); g.lineTo(x + 4, 3); g.lineTo(x, 10); g.closePath(); g.fill(); }
  // ring marker: 25 s after the start
  const ring = S.sel.start + RING_SECONDS;
  if (ring <= b) { g.strokeStyle = css('--accent'); g.setLineDash([4, 3]); g.lineWidth = 2; g.beginPath(); g.moveTo(X(ring), 12); g.lineTo(X(ring), h - 12); g.stroke(); g.setLineDash([]); }
  if (player) { const p = player.pos(); if (p >= a && p <= b) { g.fillStyle = css('--ink'); g.fillRect(X(p) - 1, 0, 2, h); } }
}
function positionHandles() {
  if (!S.view) return;
  const { a, b } = S.view, pct = t => ((t - a) / (b - a)) * 100;
  $('#hStart') && ($('#hStart').style.left = pct(S.sel.start) + '%');
  $('#hEnd') && ($('#hEnd').style.left = pct(S.sel.end) + '%');
}
function flagSnap(src, el) {
  const f = $('#snapFlag'); if (!f || !src) return;
  const msg = t({ quiet: 'snappedQuiet', beat: 'snappedBeat', onset: 'snappedOnset' }[src]);
  f.textContent = msg; f.hidden = false; f.style.left = el.style.left;
  clearTimeout(f._t); f._t = setTimeout(() => (f.hidden = true), 1400);
  say(msg);
}

function setupWave() {
  frameView(); drawOverview(); drawDetail(); positionHandles();
  const det = $('#detail'), ov = $('#overview');
  const timeAt = (el, x, a, b) => { const r = el.getBoundingClientRect(); return a + ((x - r.left) / r.width) * (b - a); };
  // detail: drag handles or the selection body; tap elsewhere moves the nearest handle
  let drag = null;
  det.onpointerdown = e => {
    if (e.button) return;
    const tt = timeAt(det, e.clientX, S.view.a, S.view.b);
    const hs = e.target.closest('.handle');
    const which = hs ? (hs.id === 'hStart' ? 'start' : 'end') : (tt > S.sel.start && tt < S.sel.end ? 'body' : (Math.abs(tt - S.sel.start) < Math.abs(tt - S.sel.end) ? 'start' : 'end'));
    drag = { which, t0: tt, sel: { ...S.sel } };
    det.setPointerCapture(e.pointerId);
    if (which !== 'body') move(e);
    e.preventDefault();
  };
  const move = e => {
    if (!drag) return;
    const tt = timeAt(det, e.clientX, S.view.a, S.view.b);
    if (drag.which === 'start') setSel(Math.min(tt, S.sel.end - 1), S.sel.end);
    else if (drag.which === 'end') setSel(S.sel.start, Math.max(tt, S.sel.start + 1));
    else { const dt = tt - drag.t0, len = drag.sel.end - drag.sel.start; let s = Math.max(0, Math.min(S.buf.duration - len, drag.sel.start + dt)); setSel(s, s + len); }
  };
  det.onpointermove = move;
  det.onpointerup = det.onpointercancel = () => {
    if (!drag) return;
    const w = drag.which; drag = null;
    if (S.snap) {
      if (w === 'start' || w === 'body') { const r = Audio2.snap(S.an, S.sel.start, 0.25, 'start'); const len = S.sel.end - S.sel.start; setSel(r.t, w === 'body' ? r.t + len : S.sel.end); flagSnap(r.src, $('#hStart')); }
      if (w === 'end') { const r = Audio2.snap(S.an, S.sel.end, 0.25, 'end'); setSel(S.sel.start, r.t); flagSnap(r.src, $('#hEnd')); }
    }
    setTimeout(() => { frameView(); positionHandles(); drawDetail(); }, 350);
  };
  // overview: drag the window, or tap to centre it there
  let od = null;
  ov.onpointerdown = e => {
    const d = S.buf.duration, tt = timeAt(ov, e.clientX, 0, d), len = S.sel.end - S.sel.start;
    if (!(tt >= S.sel.start && tt <= S.sel.end)) { const s = Math.max(0, Math.min(d - len, tt - len / 2)); setSel(s, s + len, true); }
    od = { t0: tt, s0: S.sel.start }; ov.setPointerCapture(e.pointerId); e.preventDefault();
  };
  ov.onpointermove = e => { if (!od) return; const d = S.buf.duration, len = S.sel.end - S.sel.start; const s = Math.max(0, Math.min(d - len, od.s0 + timeAt(ov, e.clientX, 0, d) - od.t0)); setSel(s, s + len, true); };
  ov.onpointerup = ov.onpointercancel = () => { if (!od) return; od = null; if (S.snap) { const len = S.sel.end - S.sel.start, r = Audio2.snap(S.an, S.sel.start, 0.4, 'start'); setSel(r.t, r.t + len, true); } };
  // keyboard: arrows 0.1 s, shift 1 s, Home/End
  const key = (which) => e => {
    const step = e.shiftKey ? 1 : 0.1, len = S.sel.end - S.sel.start;
    let d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -5, PageUp: 5 }[e.key];
    if (e.key === 'Home') d = -1e9; if (e.key === 'End') d = 1e9;
    if (d == null) return;
    e.preventDefault();
    if (which === 'start') setSel(Math.min(S.sel.start + d, S.sel.end - 1), S.sel.end, true);
    else if (which === 'end') setSel(S.sel.start, Math.max(S.sel.start + 1, S.sel.end + d), true);
    else { const s = Math.max(0, Math.min(S.buf.duration - len, S.sel.start + d)); setSel(s, s + len, true); }
  };
  $('#hStart').onkeydown = key('start'); $('#hEnd').onkeydown = key('end'); $('#ovWin').onkeydown = key('body');
  $$('[data-nudge]').forEach(b => (b.onclick = () => { const d = +b.dataset.d; b.dataset.nudge === 'start' ? setSel(Math.min(S.sel.start + d, S.sel.end - 1), S.sel.end, true) : setSel(S.sel.start, S.sel.end + d, true); }));
}
addEventListener('resize', () => { drawOverview(); drawDetail(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { drawOverview(); drawDetail(); });

// ---------- render (Shape) ----------
let renderTimer, renderJob = null;
function scheduleRender(delay = 250) {
  clearTimeout(renderTimer);
  const m = $('#meter'); if (m) m.textContent = t('measuring');
  renderTimer = setTimeout(doRender, delay);
}
function renderOpts() { return { start: S.sel.start, end: S.sel.end, fadeIn: S.fadeIn, fadeOut: S.fadeOut, target: LEVELS[S.level] }; }
// Always resolves with the render for the current settings; concurrent calls share one job.
function doRender() {
  const o = renderOpts(), key = JSON.stringify(o);
  if (S.rendered && S.renderKey === key) return Promise.resolve(S.rendered);
  if (renderJob?.key === key) return renderJob.p;
  const p = Audio2.render(S.buf, o).then(r => {
    if (renderJob?.key === key) {
      S.rendered = r; S.renderKey = key;
      const m = $('#meter');
      if (m) m.textContent = t('measured', { a: r.before.toFixed(1), b: r.after.toFixed(1), p: r.peakDb.toFixed(1) });
    }
    return r;
  });
  renderJob = { key, p };
  return p;
}
async function playRendered(btn) {
  const r = await doRender();
  playBuffer(r.buffer, { loop: S.loop, btn, base: S.sel.start });
}

// ---------- ring test ----------
async function ringTest() {
  stopAll();
  const r = await doRender();
  const name = ($('#callerIn')?.value || t('callerDefault')).trim();
  const call = $('#call');
  const native = Native.available();
  call.innerHTML = `<div class="call-inner" role="dialog" aria-modal="true" aria-labelledby="callName">
    <p class="call-k">${t('incoming')}</p>
    <div class="call-avatar" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</div>
    <h2 class="call-name" id="callName">${esc(name)}</h2>
    <p class="call-sub">${t('mobile')}</p>
    <div class="call-tone">${icon('tones')}<span>${esc(S.toneName || 'Mettu')}</span></div>
    <div class="call-prog"><i id="callBar"></i></div><p class="call-time mono" id="callTime"></p>
    <div class="call-actions">
      <button class="call-btn decline" id="callDecline" type="button">${icon('phone-off')}<span>${t('decline')}</span></button>
      <button class="call-btn answer" id="callAnswer" type="button">${icon('phone')}<span>${t('answer')}</span></button>
    </div></div>`;
  call.hidden = false; document.body.classList.add('calling');
  const opener = document.activeElement;
  $('#callAnswer').focus();
  const t0 = performance.now();
  let raf, done = false, wav;
  const end = (missed) => {
    if (done) return; done = true;
    cancelAnimationFrame(raf); stopAll(); if (native) Native.stopRing(); navigator.vibrate?.(0);
    call.hidden = true; document.body.classList.remove('calling'); call.innerHTML = '';
    opener?.focus?.();
    if (missed) toast(t('missed'));
  };
  if (native) { wav = Audio2.wav(r.buffer); Native.playRing(wav).catch(() => playBuffer(r.buffer, { loop: true })); }
  else playBuffer(r.buffer, { loop: true });
  navigator.vibrate?.([700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700, 1300, 700]);
  const tick = () => {
    const el = (performance.now() - t0) / 1000;
    if (!$('#callBar')) return;
    $('#callBar').style.transform = `scaleX(${Math.min(1, el / RING_SECONDS)})`;
    $('#callTime').textContent = t('ringingFor', { a: fmt(el, 0) });
    if (el >= RING_SECONDS) return end(true);
    raf = requestAnimationFrame(tick);
  };
  tick();
  $('#callDecline').onclick = () => end(false);
  $('#callAnswer').onclick = () => end(false);
  call.onkeydown = e => {
    if (e.key === 'Escape') end(false);
    if (e.key === 'Tab') { const f = [$('#callDecline'), $('#callAnswer')]; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? 1 : 1)) % 2].focus(); }
  };
}

// ---------- save + tones ----------
async function saveTone() {
  const r = await doRender();
  const name = ($('#nameIn').value || S.toneName || 'Tone').trim();
  const tone = { id: Date.now().toString(36), name, created: Date.now(), duration: r.buffer.duration, lufs: +r.after.toFixed(1), source: S.fileName, blob: Audio2.wav(r.buffer) };
  await Store.put(tone);
  toast(t('saved'), { label: t('setAs'), run: () => setDialog(tone) });
  say(t('saved'));
  location.hash = '#/tones';
}

function toneList(tones) {
  return `<ul class="k-list tones">${tones.map(x => `<li class="k-list-item tone" data-id="${x.id}">
    <button class="k-iconbtn k-iconbtn-filled" data-act="play" type="button" aria-label="${t('play')} ${esc(x.name)}">${icon('play')}</button>
    <div class="k-list-text"><b>${esc(x.name)}</b><small><span class="mono">${fmt(x.duration, 0)}</span> · <span class="mono">${x.lufs} LUFS</span></small></div>
    <button class="k-btn k-btn-secondary k-btn-sm" data-act="set" type="button">${Native.available() ? t('setAs') : t('download')}</button>
    <button class="k-iconbtn" data-act="more" type="button" aria-label="${t('rename')}, ${t('del')}: ${esc(x.name)}" aria-haspopup="dialog">${icon('edit')}</button>
  </li>`).join('')}</ul>`;
}
function wireTones(tones) {
  $$('.tone').forEach(li => {
    const tone = tones.find(x => x.id === li.dataset.id);
    const pb = li.querySelector('[data-act=play]');
    pb.onclick = async () => {
      if (pb.dataset.playing) return stopAll();
      const buf = await Audio2.ac().decodeAudioData(await tone.blob.arrayBuffer());
      playBuffer(buf, { btn: pb });
    };
    li.querySelector('[data-act=set]').onclick = () => setDialog(tone);
    li.querySelector('[data-act=more]').onclick = () => moreDialog(tone);
  });
}
async function screenTones() {
  const tones = await Store.all().catch(() => []);
  $('#main').innerHTML = `<section class="wrap page"><h1 class="heading-1">${t('tonesH')}</h1><p class="body muted">${t('tonesP')}</p>
    ${tones.length ? toneList(tones) : `<div class="empty k-card">${icon('tones', 'k-icon empty-ic')}<p>${t('tonesEmpty')}</p><a class="k-btn k-btn-primary" href="#/">${t('makeOne')}</a></div>`}</section>`;
  wireTones(tones);
}
const safeName = s => (s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'mettu-tone').slice(0, 40);
async function asMp3(tone) {
  if (tone.mp3) return tone.mp3;
  const buf = await Audio2.ac().decodeAudioData(await tone.blob.arrayBuffer());
  tone.mp3 = await Audio2.mp3(buf);
  Store.put(tone).catch(() => {});
  return tone.mp3;
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function download(tone, kind) {
  try { const b = kind === 'mp3' ? await asMp3(tone) : tone.blob; saveBlob(b, `${safeName(tone.name)}.${kind}`); }
  catch { saveBlob(tone.blob, `${safeName(tone.name)}.wav`); }
}

function setDialog(tone) {
  if (Native.available()) {
    const opt = (k, ic, l) => `<button class="k-list-item" data-kind="${k}" type="button">${icon(ic)}<span class="k-list-text"><b>${l}</b></span>${icon('next')}</button>`;
    dialog(`<h2 class="k-dialog-title">${t('setAs')}</h2><p class="k-dialog-body">${esc(tone.name)}</p>
      <div class="k-list set-list">${opt('ringtone', 'phone', t('setRingtone'))}${opt('notification', 'bell', t('setNotification'))}${opt('alarm', 'alarm', t('setAlarm'))}${opt('contact', 'user', t('setContact'))}</div>
      <div class="k-dialog-actions"><button class="k-btn k-btn-outline" data-close type="button">${t('cancel')}</button></div>`, d => {
      d.querySelectorAll('[data-kind]').forEach(b => (b.onclick = () => setNative(tone, b.dataset.kind)));
    });
    return;
  }
  const androidFirst = !isIOS;
  const aSteps = `<section><h3 class="heading-3">${icon('android')} ${t('androidSteps')}</h3><ol><li>${t('androidS1')}</li><li>${t('androidS2')}</li><li>${t('androidS3')}</li></ol><p class="body-sm">${t('androidApp')} <a href="${APK}">${t('getApk')}</a></p></section>`;
  const iSteps = `<section><h3 class="heading-3">${t('iosSteps')}</h3><ol><li>${t('iosS1')}</li><li>${t('iosS2')}</li><li>${t('iosS3')}</li></ol></section>`;
  dialog(`<h2 class="k-dialog-title">${t('webSetH')}</h2><p class="k-dialog-body">${t('webSetP')}</p>
    <div class="dl-row"><button class="k-btn k-btn-primary" data-dl="mp3" type="button">${icon('download')}<span>${t('downloadMp3')}</span></button><button class="k-btn k-btn-outline" data-dl="wav" type="button">${icon('download')}<span>${t('downloadWav')}</span></button></div>
    <div class="how">${androidFirst ? aSteps + iSteps : iSteps + aSteps}</div>
    <div class="k-dialog-actions"><button class="k-btn k-btn-outline" data-close type="button">${t('close')}</button></div>`, d => {
    d.querySelectorAll('[data-dl]').forEach(b => (b.onclick = async () => { b.disabled = true; await download(tone, b.dataset.dl); b.disabled = false; }));
  });
}
async function setNative(tone, kind) {
  const d = $('#dlg');
  const body = d.querySelector('.k-dialog-body');
  body.textContent = t('encoding');
  try {
    let contact;
    if (kind === 'contact') { contact = await Native.pickContact(); if (!contact?.uri) { body.textContent = tone.name; return; } }
    let file; try { file = await asMp3(tone); } catch { file = tone.blob; }
    const ext = file.type === 'audio/mpeg' ? 'mp3' : 'wav';
    const r = await Native.setTone(file, { title: tone.name, fileName: `${safeName(tone.name)}.${ext}`, kind, contactUri: contact?.uri });
    if (r?.status === 'needs-permission') {
      dialog(`<h2 class="k-dialog-title">${t('permH')}</h2><p class="k-dialog-body">${t('permP')}</p><div class="k-dialog-actions"><button class="k-btn k-btn-outline" data-close type="button">${t('cancel')}</button><button class="k-btn k-btn-primary" id="permGo" type="button">${t('permOpen')}</button></div>`,
        dd => { dd.querySelector('#permGo').onclick = () => { Native.openWriteSettings?.(); dd.close(); }; });
      return;
    }
    if (r?.status === 'contacts-denied') { body.textContent = t('contactsDenied'); return; }
    d.close();
    const k = { ringtone: 'kindRingtone', notification: 'kindNotification', alarm: 'kindAlarm' }[kind];
    toast(kind === 'contact' ? t('setDoneContact', { n: contact.name || '' }) : t('setDone', { k: t(k) }));
  } catch (e) { body.textContent = t('setFailed', { e: e.message || e }); }
}
function moreDialog(tone) {
  dialog(`<h2 class="k-dialog-title">${esc(tone.name)}</h2>
    <div class="k-field"><label class="k-label" for="renameIn">${t('rename')}</label><input class="k-input" id="renameIn" value="${esc(tone.name)}" maxlength="40"></div>
    <div class="dl-row">${Native.available() ? `<button class="k-btn k-btn-outline k-btn-sm" id="saveList" type="button">${icon('download')}<span>${t('saveToList')}</span></button>` : `<button class="k-btn k-btn-outline k-btn-sm" data-dl="mp3" type="button">${icon('download')}<span>MP3</span></button><button class="k-btn k-btn-outline k-btn-sm" data-dl="wav" type="button">${icon('download')}<span>WAV</span></button>`}</div>
    <div class="k-dialog-actions spread"><button class="k-btn k-btn-ghost danger" id="delBtn" type="button">${icon('trash')}<span>${t('del')}</span></button>
    <span><button class="k-btn k-btn-outline" data-close type="button">${t('cancel')}</button> <button class="k-btn k-btn-primary" id="renameOk" type="button">${t('ok')}</button></span></div>`, d => {
    d.querySelectorAll('[data-dl]').forEach(b => (b.onclick = () => download(tone, b.dataset.dl)));
    const sl = d.querySelector('#saveList');
    if (sl) sl.onclick = async () => { sl.disabled = true; try { let file; try { file = await asMp3(tone); } catch { file = tone.blob; } await Native.setTone(file, { title: tone.name, fileName: `${safeName(tone.name)}.${file.type === 'audio/mpeg' ? 'mp3' : 'wav'}`, kind: 'save' }); d.close(); toast(t('savedToList')); } catch (e) { sl.disabled = false; toast(t('setFailed', { e: e.message || e })); } };
    d.querySelector('#renameOk').onclick = async () => { tone.name = d.querySelector('#renameIn').value.trim() || tone.name; await Store.put(tone); d.close(); route(); };
    d.querySelector('#delBtn').onclick = () => {
      dialog(`<h2 class="k-dialog-title">${t('del')}</h2><p class="k-dialog-body">${t('delConfirm', { n: esc(tone.name) })}</p><div class="k-dialog-actions"><button class="k-btn k-btn-outline" data-close type="button">${t('cancel')}</button><button class="k-btn k-btn-danger" id="delOk" type="button">${t('del')}</button></div>`,
        dd => { dd.querySelector('#delOk').onclick = async () => { await Store.remove(tone.id); dd.close(); route(); }; });
    };
  });
}

// ---------- find a song ----------
function screenFind() {
  const fromShare = (location.hash.match(/[?&]link=([^&]*)/) || [])[1];
  const pending = S.pendingLink || (fromShare ? (decodeURIComponent(fromShare).match(/https?:\/\/\S+/) || [''])[0] : ''); S.pendingLink = '';
  $('#main').innerHTML = `<section class="wrap page">
    <h1 class="heading-1">${t('findH')}</h1><p class="body muted lead-sm">${t('findP')}</p>
    <form class="link-row" id="findForm"><label class="k-sr-only" for="findIn">${t('linkPh')}</label>
      <div class="k-input-group grow">${icon('link')}<input class="k-input" id="findIn" type="url" inputmode="url" placeholder="https://youtu.be/…" value="${esc(pending)}" autocomplete="off"></div>
      <button class="k-btn k-btn-primary" type="submit">${icon('search')}<span>${t('find')}</span></button></form>
    <p class="body-sm">${t('example')}: <button class="linkish" id="exYT" type="button">YouTube · Why This Kolaveri Di</button> · <button class="linkish" id="exIG" type="button">Instagram reel</button></p>
    <div id="findOut" aria-live="polite"></div></section>`;
  const run = v => { $('#findIn').value = v; identify(v); };
  $('#findForm').onsubmit = e => { e.preventDefault(); identify($('#findIn').value); };
  $('#exYT').onclick = () => run('https://www.youtube.com/watch?v=YR12Z8f1Dh8');
  $('#exIG').onclick = () => run('https://www.instagram.com/reel/C0000000000/');
  if (pending) identify(pending);
}
async function identify(raw) {
  const out = $('#findOut');
  const p = Lookup.parse(raw);
  const alert = (cls, ic, title, body = '') => `<div class="k-alert ${cls}" role="status">${icon(ic)}<div><b class="k-alert-title">${title}</b>${body ? `<span class="k-alert-body">${body}</span>` : ''}</div></div>`;
  const manual = `<form class="link-row manual" id="manualForm"><label class="k-sr-only" for="manualIn">${t('typeName')}</label><input class="k-input grow" id="manualIn" placeholder="${t('typeName')}"><button class="k-btn k-btn-secondary-solid" type="submit">${t('search')}</button></form>`;
  const wireManual = () => { const f = $('#manualForm'); if (f) f.onsubmit = async e => { e.preventDefault(); const v = $('#manualIn').value.trim(); if (!v) return; const m = Lookup.rank(await Lookup.itunes(v), v); showResult({ source: null, song: m[0]?.song || v, artist: m[0]?.artist || '', matches: m, extra: [] }); }; };
  if (p.kind === 'instagram') { out.innerHTML = alert('k-alert-warning', 'info', t('igH'), t('igP')) + manual; wireManual(); return; }
  if (p.kind === 'store') { out.innerHTML = alert('', 'info', t('storeLink')) + `<p><a class="k-btn k-btn-outline" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.host)} ${icon('external')}</a></p>`; return; }
  if (p.kind === 'spotify-short') { out.innerHTML = alert('k-alert-warning', 'info', t('spotifyShort')); return; }
  if (p.kind !== 'youtube' && p.kind !== 'spotify') { out.innerHTML = alert('k-alert-warning', 'alert', t('invalid')) + manual; wireManual(); return; }
  if (!navigator.onLine) { out.innerHTML = alert('k-alert-warning', 'alert', t('offline')); return; }
  out.innerHTML = `<div class="k-card skeleton" aria-busy="true"><div></div><div></div><div></div></div>`;
  try { showResult(await Lookup.identify(raw)); }
  catch (e) { out.innerHTML = alert('k-alert-danger', 'alert', t('notFound')) + manual; wireManual(); }
}
function showResult(r) {
  const out = $('#findOut'), m = r.matches || [], top = m[0];
  const song = top?.hit || !r.source ? top?.song || r.song : r.song;
  const artist = r.artist || top?.artist || '';
  out.innerHTML = `<article class="k-card result">
    <div class="res-head">${(top?.art || r.thumb) ? `<img src="${esc(top?.art || r.thumb)}" alt="" width="96" height="96" referrerpolicy="no-referrer">` : ''}
      <div>${r.source ? `<span class="k-badge k-badge-primary">${t('foundOn', { s: r.source })}</span>` : ''}
      <h2 class="heading-2">${esc(r.song || song)}</h2>${artist ? `<p class="body">${esc(artist)}</p>` : ''}
      ${r.extra?.length ? `<p class="body-sm muted">${t('titleWords')}: ${esc(r.extra.join(' · '))}</p>` : ''}</div></div>
    ${top ? `<div class="match"><span class="caption">${t('likely')}</span><p class="body"><b>${esc(top.song)}</b> · ${esc(top.artist)}${top.album ? ` <span class="muted">· ${esc(top.album)}${top.year ? ', ' + top.year : ''}</span>` : ''}</p>
      ${top.store ? `<p><a class="k-btn k-btn-outline k-btn-sm" href="${esc(top.store)}" target="_blank" rel="noopener">${t('buy')} ${icon('external')}</a> <span class="body-sm muted">${t('buyNote')}</span></p>` : ''}
      ${m.length > 1 ? `<details><summary class="body-sm">${t('otherMatches')} (${m.length - 1})</summary><ul class="body-sm">${m.slice(1).map(x => `<li>${esc(x.song)} · ${esc(x.artist)}${x.store ? ` · <a href="${esc(x.store)}" target="_blank" rel="noopener">iTunes</a>` : ''}</li>`).join('')}</ul></details>` : ''}</div>`
      : `<p class="body-sm muted">${t('noMatch')}</p>`}
    <div><h3 class="heading-3">${t('getIt')}</h3>
      <div class="stores">${Lookup.stores(r.song || song, artist).map(s => `<a class="store" href="${esc(s.url)}" target="_blank" rel="noopener"><span>${s.name}</span>${icon('external')}</a>`).join('')}</div></div>
    <p class="k-help">${t('drmNote')}</p>
    <button class="k-btn k-btn-primary" id="bringIn" type="button">${icon('file')}<span>${t('bringIn')}</span></button>
  </article>`;
  $('#bringIn').onclick = () => $('#fileIn').click();
}

// ---------- about ----------
function screenAbout() {
  const sec = (h, p, ic) => `<section class="k-card about-sec">${icon(ic, 'k-icon about-ic')}<div><h2 class="heading-3">${t(h)}</h2><p class="body">${t(p)}</p></div></section>`;
  $('#main').innerHTML = `<section class="wrap page about">
    <h1 class="heading-1">${t('aboutH')}</h1><p class="body-lg muted">${t('aboutP')}</p>
    ${sec('howH', 'howP', 'logo')}${sec('privacyH', 'privacyP', 'shield')}${sec('whyH', 'whyP', 'info')}${sec('androidH', 'androidP', 'android')}${sec('permsH', 'permsP', 'check')}${sec('creditsH', 'creditsP', 'tones')}
    <p class="body-sm muted">${t('madeBy')}${Native.available() ? '' : ` · <a href="${APK}">${t('getApk')}</a>`}</p></section>`;
}

// ---------- shared files (web share target + Android share sheet) ----------
async function checkShared() {
  let f = null;
  if (/[?&]shared=1/.test(location.hash) && 'caches' in window) {
    const c = await caches.open('mettu-share'), r = await c.match('shared-file');
    if (r) { f = new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'Shared audio'), { type: r.headers.get('content-type') || '' }); await c.delete('shared-file'); }
    history.replaceState(null, '', '#/');
  }
  if (!f) {
    const n = await Native.takeShared().catch(() => null);
    if (n?.error) toast(t('badFile'));
    if (n?.file) f = n.file;
    else if (n?.text) { const link = (n.text.match(/https?:\/\/\S+/) || [])[0]; if (link) { S.pendingLink = link; if (location.hash.startsWith('#/find')) screenFind(); else location.hash = '#/find'; } }
  }
  if (f) loadFile(f);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Native.available()) checkShared(); });
if (Native.available()) Native.onShared(() => checkShared());

// ---------- router ----------
function route() {
  shell();
  const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'make';
  if (r !== 'edit') stopAll();
  ({ make: screenMake, edit: screenEdit, tones: screenTones, find: screenFind, about: screenAbout }[r] || screenMake)();
  if (r !== 'edit') scrollTo(0, 0);
}
addEventListener('hashchange', () => { route(); $('#main').focus({ preventScroll: true }); });
route();
checkShared();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

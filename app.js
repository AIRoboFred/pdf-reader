// PDF Reader — private read-aloud for PDFs in Google Drive.
// Data flow: Google Drive (read-only) -> this device. No backend, no secrets.
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const MOCK_SPEECH = params.has('mockspeech');
const UNTAGGED = '__untagged__';
const ALL = '__all__';
const isStandalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------------------------------------------------------------- storage
const NS = DEMO ? 'pdfr-demo:' : 'pdfr:'; // demo data never mixes with the real library
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} },
  del(k) { localStorage.removeItem(NS + k); },
};
const idb = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DEMO ? 'pdf-reader-demo' : 'pdf-reader', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => {
    const t = db.transaction('docs', mode); const req = fn(t.objectStore('docs'));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
    put: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => null),
    clear: () => tx('readwrite', (s) => s.clear()).catch(() => null),
  };
})();

// ---------------------------------------------------------------- UI helpers
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function setStatus(msg) { $('#status').textContent = msg || ''; }

// ---------------------------------------------------------------- theme
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('#theme-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
  store.set('theme', t);
}

// ================================================================ AUTH
const auth = {
  token: null, tokenClient: null, gisReady: null,
  init() {
    // 1) Redirect flow return: #access_token=...&state=...
    if (location.hash.includes('access_token=')) {
      const h = new URLSearchParams(location.hash.slice(1));
      const ok = h.get('state') && h.get('state') === store.get('oauthState');
      store.del('oauthState');
      if (ok) this.save(h.get('access_token'), Number(h.get('expires_in') || 3600));
      history.replaceState(null, '', location.pathname + location.search + (store.get('returnHash') || ''));
      store.del('returnHash');
    } else if (location.hash.includes('error=')) {
      const h = new URLSearchParams(location.hash.slice(1));
      toast('Google sign-in: ' + h.get('error')); history.replaceState(null, '', location.pathname + location.search);
    }
    const saved = store.get('auth');
    if (saved && saved.exp > Date.now() + 60_000) this.token = saved.token;
    if (this.mode() === 'gis') this.loadGis();
  },
  mode() {
    if (CONFIG.AUTH_MODE === 'gis' || CONFIG.AUTH_MODE === 'redirect') return CONFIG.AUTH_MODE;
    return isStandalone ? 'redirect' : 'gis';
  },
  configured() { return CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.startsWith('PASTE_'); },
  save(token, expiresIn) {
    this.token = token;
    store.set('auth', { token, exp: Date.now() + expiresIn * 1000 });
    store.set('consented', true);
  },
  clear() { this.token = null; store.del('auth'); },
  loadGis() {
    return this.gisReady ||= new Promise((res, rej) => {
      const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: '' });
      s.onload = () => {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.CLIENT_ID, scope: CONFIG.SCOPE,
          callback: (r) => {
            if (r.error) { toast('Sign-in failed: ' + r.error); return; }
            this.save(r.access_token, Number(r.expires_in || 3600));
            app.onSignedIn();
          },
          error_callback: (e) => { if (e && e.type !== 'popup_closed') toast('Sign-in problem: ' + (e.message || e.type)); },
        });
        res();
      };
      s.onerror = () => rej(new Error('Could not load Google sign-in'));
      document.head.append(s);
    });
  },
  // Must be called from a click handler (popup blockers / iOS).
  signIn() {
    if (!this.configured()) { toast('Add your OAuth CLIENT_ID to config.js first (see SETUP.md).', 5000); return; }
    if (this.mode() === 'redirect') return this.redirect();
    if (!this.tokenClient) { toast('Loading Google sign-in… tap again in a second.'); this.loadGis(); return; }
    this.tokenClient.requestAccessToken({ prompt: store.get('consented') ? '' : 'consent', login_hint: CONFIG.LOGIN_HINT || undefined });
  },
  redirect() {
    const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
    store.set('oauthState', state); store.set('returnHash', location.hash);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID, redirect_uri: CONFIG.REDIRECT_URI || (location.origin + location.pathname),
      response_type: 'token', scope: CONFIG.SCOPE, include_granted_scopes: 'true', state,
      ...(CONFIG.LOGIN_HINT ? { login_hint: CONFIG.LOGIN_HINT } : {}),
    });
    location.assign(u.toString());
  },
  signOut() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.clear(); store.del('consented');
  },
};

// ================================================================ DATA SOURCE (Drive or demo)
class AuthError extends Error {}
const API = 'https://www.googleapis.com/drive/v3/files';
async function gfetch(url) {
  if (!auth.token) throw new AuthError('signed out');
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + auth.token } });
  if (r.status === 401) { auth.clear(); throw new AuthError('expired'); }
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error.message; } catch {} throw new Error(`Drive ${r.status}: ${m}`); }
  return r;
}
const source = DEMO ? {
  _d: null,
  async _load() { return this._d ||= await (await fetch('demo/demo-drive.json')).json(); },
  async manifest() { return structuredClone((await this._load()).manifest); },
  async listPdfs() { return (await this._load()).files.map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime })); },
  async pdfBytes(id) { const f = (await this._load()).files.find((x) => x.id === id); return (await fetch(f.path)).arrayBuffer(); },
} : {
  async manifest() {
    let id = CONFIG.MANIFEST_ID;
    if (!id) {
      const q = encodeURIComponent(`name='library.json' and '${CONFIG.FOLDER_ID}' in parents and trashed=false`);
      const j = await (await gfetch(`${API}?q=${q}&fields=files(id)&orderBy=modifiedTime%20desc&pageSize=1`)).json();
      id = j.files?.[0]?.id; if (!id) return { version: 1, tags: [], items: [] };
    }
    return (await gfetch(`${API}/${id}?alt=media`)).json();
  },
  async listPdfs() {
    const out = []; let pageToken = '';
    const q = encodeURIComponent(`'${CONFIG.FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`);
    do {
      const j = await (await gfetch(`${API}?q=${q}&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=1000&orderBy=name${pageToken ? '&pageToken=' + pageToken : ''}`)).json();
      out.push(...j.files); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  },
  async pdfBytes(id) { return (await gfetch(`${API}/${id}?alt=media`)).arrayBuffer(); },
};

// ================================================================ LIBRARY
const lib = { tags: [], items: [], filter: store.get('filter', ALL), query: '' };

function mergeLibrary(manifest, files) {
  const byId = new Map(files.map((f) => [f.id, f]));
  const items = [];
  const seen = new Set();
  for (const it of manifest.items || []) {
    const f = byId.get(it.fileId);
    if (!f && !DEMO && files.length) continue; // file deleted/moved out of folder
    seen.add(it.fileId);
    items.push({ id: it.fileId, name: it.name || f?.name?.replace(/\.pdf$/i, '') || it.fileId, tags: it.tags || [], added: it.added, pages: it.pages, modifiedTime: f?.modifiedTime || '' });
  }
  for (const f of files) if (!seen.has(f.id)) items.push({ id: f.id, name: f.name.replace(/\.pdf$/i, ''), tags: [], added: f.modifiedTime?.slice(0, 10), modifiedTime: f.modifiedTime });
  const tags = [...new Set([...(manifest.tags || []), ...items.flatMap((i) => i.tags)])];
  return { tags, items };
}

async function loadLibrary() {
  setStatus('Loading library…');
  try {
    const [manifest, files] = await Promise.all([source.manifest(), source.listPdfs()]);
    Object.assign(lib, mergeLibrary(manifest, files));
    store.set('libCache', { tags: lib.tags, items: lib.items, at: Date.now() });
    setStatus('');
  } catch (e) {
    const cached = store.get('libCache');
    if (cached) Object.assign(lib, { tags: cached.tags, items: cached.items });
    if (e instanceof AuthError) { showSignin(e.message === 'expired' ? 'Your session expired. Sign in again to refresh.' : ''); setStatus(cached ? 'Showing your library from the last sync.' : ''); }
    else setStatus((cached ? 'Offline? Showing last synced library. ' : '') + e.message);
  }
  renderLibrary();
}

function renderLibrary() {
  // chips
  const chips = $('#tag-chips'); chips.replaceChildren();
  const count = (t) => t === ALL ? lib.items.length : t === UNTAGGED ? lib.items.filter((i) => !i.tags.length).length : lib.items.filter((i) => i.tags.includes(t)).length;
  const chipDefs = [[ALL, 'All'], ...lib.tags.map((t) => [t, t])];
  if (count(UNTAGGED)) chipDefs.push([UNTAGGED, 'Untagged']);
  if (!chipDefs.some(([k]) => k === lib.filter)) lib.filter = ALL;
  for (const [key, label] of chipDefs) {
    chips.append(el('button', { class: 'chip', 'aria-pressed': String(lib.filter === key), 'data-tag': key,
      onclick: () => { lib.filter = key; store.set('filter', key); renderLibrary(); } }, label, el('span', { class: 'count', text: String(count(key)) })));
  }
  // list
  const q = lib.query.trim().toLowerCase();
  const match = (i) => !q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q));
  const list = $('#library-list'); list.replaceChildren();
  let groups;
  if (lib.filter === ALL) {
    groups = lib.tags.map((t) => [t, lib.items.filter((i) => i.tags.includes(t))]);
    groups.push(['Untagged', lib.items.filter((i) => !i.tags.length)]);
  } else if (lib.filter === UNTAGGED) groups = [['Untagged', lib.items.filter((i) => !i.tags.length)]];
  else groups = [[lib.filter, lib.items.filter((i) => i.tags.includes(lib.filter))]];
  let shown = 0;
  for (const [title, items] of groups) {
    const vis = items.filter(match).sort((a, b) => a.name.localeCompare(b.name));
    if (!vis.length) continue;
    list.append(el('h2', { class: 'group-h', text: title }));
    for (const it of vis) { list.append(docCard(it)); shown++; }
  }
  if (!shown) {
    list.append(el('div', { class: 'empty' }, lib.items.length
      ? 'No PDFs match.'
      : (auth.token || DEMO ? 'No PDFs yet. Add PDFs to the “PDF Reader Library” folder in Google Drive.' : '')));
  }
}

function docCard(it) {
  const pos = store.get('pos:' + it.id);
  const pages = it.pages || store.get('meta:' + it.id)?.pages;
  const pct = pos && pos.n ? Math.round((pos.i / pos.n) * 100) : 0;
  const meta = el('div', { class: 'doc-meta' });
  if (it.tags.length) it.tags.forEach((t) => meta.append(el('span', { class: 'tag', text: t })));
  else meta.append(el('span', { class: 'tag untagged', text: 'untagged' }));
  if (pages) meta.append(el('span', { text: `${pages} pages` }));
  if (pct) meta.append(el('span', { text: pct >= 99 ? 'Finished' : `${pct}% read` }));
  return el('button', { class: 'doc', 'data-id': it.id, onclick: () => (location.hash = '#/doc/' + encodeURIComponent(it.id)) },
    el('div', { class: 'doc-ico', text: 'PDF' }),
    el('div', { class: 'doc-main' }, el('div', { class: 'doc-name', text: it.name }), meta,
      pct ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null));
}

function showSignin(note = '') {
  const card = $('#signin-card');
  if (DEMO) { card.hidden = true; return; }
  card.hidden = !!auth.token;
  $('#signin-note').textContent = note || (auth.configured() ? '' : 'Setup needed: put your OAuth client ID in config.js (see SETUP.md).');
}

// ================================================================ PDF TEXT EXTRACTION
let pdfjsPromise;
function pdfjs() {
  return pdfjsPromise ||= import('./vendor/pdfjs/pdf.min.js').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return m;
  });
}

const PAGE_NUM_RE = /^\s*(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?\s*$/i;
async function extractParagraphs(bytes, onProgress) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href }).promise;
  const paras = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = []; let cur = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const x = it.transform[4], y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      if (!it.str.length && !it.hasEOL) continue;
      if (!cur || Math.abs(y - cur.y) > h * 0.5) { if (cur) lines.push(cur); cur = { y, h, x0: x, x1: x, text: '' }; }
      if (it.str) {
        if (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && x - cur.x1 > h * 0.12) cur.text += ' ';
        cur.text += it.str; cur.x1 = x + (it.width || 0); cur.h = Math.max(cur.h, h);
      }
      if (it.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
    const clean = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text && !PAGE_NUM_RE.test(l.text));
    const maxW = Math.max(1, ...clean.map((l) => l.x1 - l.x0));
    let para = null, prev = null;
    const flush = () => { if (para && para.text.trim()) paras.push(para); para = null; };
    for (const l of clean) {
      let brk = !para;
      if (prev && para) {
        const gap = prev.y - l.y;
        if (gap < 0 || gap > Math.max(prev.h, l.h) * 1.75) brk = true;
        else if (Math.abs(l.h - prev.h) > prev.h * 0.18) brk = true;
        else if (/[.!?:"”)]$/.test(prev.text) && (prev.x1 - prev.x0) < maxW * 0.72) brk = true;
      }
      if (brk) { flush(); para = { page: p, text: l.text, h: l.h }; }
      else if (/[A-Za-z]-$/.test(para.text) && /^[a-z]/.test(l.text)) para.text = para.text.slice(0, -1) + l.text;
      else para.text += ' ' + l.text;
      prev = l;
    }
    flush();
    page.cleanup?.();
  }
  // headings: short, larger than body text, no terminal punctuation
  const hs = paras.map((x) => x.h).sort((a, b) => a - b); const body = hs[Math.floor(hs.length / 2)] || 10;
  const out = paras.map((x) => ({ page: x.page, text: x.text, heading: x.h > body * 1.12 && x.text.length < 140 && !/[.!?]$/.test(x.text) }));
  const n = pdf.numPages; pdf.destroy();
  return { pages: n, paragraphs: out };
}

// Sentence segmentation + chunking (short utterances avoid iOS/Chrome cutoffs).
const MAX_CHUNK = 220;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
function splitSentences(text) {
  let parts = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : (text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*)\s*|[^.!?]+$/g) || [text]);
  parts = parts.map((s) => s.trim()).filter(Boolean);
  const merged = [];
  for (const s of parts) {
    const last = merged[merged.length - 1];
    // re-join false splits after common abbreviations / very short fragments
    if (last && (s.length < 4 || /\b(e\.g|i\.e|vs|Mr|Mrs|Ms|Dr|Inc|Co|Ltd|St|No|Fig|approx)\.$/i.test(last))) merged[merged.length - 1] = last + ' ' + s;
    else merged.push(s);
  }
  return merged.flatMap(chunk);
}
function chunk(s) {
  if (s.length <= MAX_CHUNK) return [s];
  const out = []; let rest = s;
  while (rest.length > MAX_CHUNK) {
    const win = rest.slice(0, MAX_CHUNK);
    let cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf(': '), win.lastIndexOf(' — '), win.lastIndexOf(' – '));
    if (cut < MAX_CHUNK * 0.4) cut = win.lastIndexOf(' ');
    if (cut < 20) cut = MAX_CHUNK;
    out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}
function buildSentences(paragraphs) {
  const sents = []; const paraStart = [];
  paragraphs.forEach((p, pi) => {
    paraStart.push(sents.length);
    for (const t of splitSentences(p.text)) sents.push({ p: pi, page: p.page, text: t });
  });
  return { sents, paraStart };
}

// ================================================================ SPEECH
let synth = window.speechSynthesis;
if (MOCK_SPEECH || !synth) synth = installMockSpeech();
window.__ttsLog = [];

const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Deranged|Hysterical|Pipe Organ)\b/i;
function voiceScore(v) {
  let s = 0; const n = (v.name + ' ' + v.voiceURI).toLowerCase();
  if (/^en[-_]us/i.test(v.lang)) s += 30; else if (/^en/i.test(v.lang)) s += 15; else return -100;
  if (n.includes('premium')) s += 25; else if (n.includes('enhanced')) s += 18;
  if (n.includes('siri')) s += 12;
  if (/google us english/.test(n)) s += 10; else if (/natural|neural|online/.test(n)) s += 14;
  if (/samantha|ava|zoe|evan|nathan|allison|susan|tom|aaron|nicky/.test(n)) s += 4;
  if (v.localService) s += 2;
  if (NOVELTY.test(v.name) || /eloquence|com\.apple\.speech\.synthesis/.test(n)) s -= 40;
  return s;
}
const speech = {
  voices: [], voice: null,
  rate: store.get('rate', 1),
  loadVoices() {
    const all = synth.getVoices() || [];
    this.voices = all.filter((v) => /^en/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
    const want = store.get('voiceURI');
    this.voice = this.voices.find((v) => v.voiceURI === want) || this.voices[0] || null;
    renderVoices();
  },
  setVoice(uri) { this.voice = this.voices.find((v) => v.voiceURI === uri) || null; store.set('voiceURI', uri); renderVoices(); },
  utter(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice?.lang || 'en-US';
    if (this.voice) try { u.voice = this.voice; } catch {}
    u.rate = this.rate; u.pitch = 1; u.volume = 1;
    return u;
  },
};

const player = {
  doc: null, sents: [], paraStart: [], idx: 0, playing: false, gen: 0, watchdog: 0, errs: 0,
  load(doc, sents, paraStart) {
    this.stop(); Object.assign(this, { doc, sents, paraStart });
    const pos = store.get('pos:' + doc.id);
    this.idx = pos && pos.i < sents.length ? pos.i : 0;
    highlight(this.idx, true);
  },
  // IMPORTANT (iOS): play() must be reachable synchronously from a tap handler the first time.
  play(i = this.idx) {
    if (!this.sents.length) return;
    this.idx = Math.max(0, Math.min(i, this.sents.length - 1));
    this.playing = true; updatePlayBtn(); wake.on();
    this.speakCurrent();
  },
  speakCurrent() {
    const g = ++this.gen; const s = this.sents[this.idx];
    clearTimeout(this.watchdog);
    if (!s) return this.finish();
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume();
    const u = speech.utter(s.text);
    u.onend = () => { if (g === this.gen && this.playing) { this.errs = 0; this.next(); } };
    u.onerror = (e) => {
      if (g !== this.gen) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed') { this.pause(); toast('Tap ▶ to start reading.'); return; }
      console.warn('speech error', e.error);
      if (++this.errs >= 3) { this.pause(); this.errs = 0; toast('Speech engine error (' + e.error + '). Try another voice.'); return; }
      if (this.playing) this.next();
    };
    highlight(this.idx);
    window.__ttsLog.push({ i: this.idx, text: s.text, rate: u.rate, voice: u.voice?.name || null, t: Date.now() });
    synth.speak(u);
    // Watchdog: some engines occasionally never fire onend. Advance only if truly idle.
    const est = (s.text.length / (14 * speech.rate)) * 1000 + 4000;
    const check = () => {
      if (g !== this.gen || !this.playing) return;
      if (synth.speaking || synth.pending) this.watchdog = setTimeout(check, 1500); else this.next();
    };
    this.watchdog = setTimeout(check, est);
  },
  next() { if (this.idx >= this.sents.length - 1) return this.finish(); this.idx++; this.save(); this.speakCurrent(); },
  finish() { this.idx = this.sents.length - 1; this.save(true); this.pause(); toast('Finished 🎉'); },
  pause() {
    this.playing = false; this.gen++; clearTimeout(this.watchdog);
    // We cancel instead of synth.pause(): pause/resume is unreliable on iOS Safari & Chrome.
    // Resume restarts the current sentence, which is barely noticeable.
    if (synth.speaking || synth.pending) synth.cancel();
    updatePlayBtn(); wake.off(); this.save();
  },
  stop() { if (this.doc) this.pause(); },
  toggle() { this.playing ? this.pause() : this.play(); },
  jump(i) {
    this.idx = Math.max(0, Math.min(i, this.sents.length - 1)); this.save();
    if (this.playing) this.speakCurrent(); else highlight(this.idx, true);
  },
  sentence(d) { this.jump(this.idx + d); },
  paragraph(d) {
    const cur = this.sents[this.idx]?.p ?? 0;
    if (d > 0) { const n = this.paraStart[cur + 1]; if (n != null) this.jump(n); }
    else {
      const start = this.paraStart[cur];
      // like a music player: first press -> start of this paragraph, second -> previous one
      this.jump(this.idx > start ? start : (this.paraStart[cur - 1] ?? 0));
    }
  },
  save(done = false) {
    if (!this.doc) return;
    store.set('pos:' + this.doc.id, { i: done ? this.sents.length : this.idx, n: this.sents.length, t: Date.now() });
    $('#doc-progress').style.width = (this.sents.length ? (this.idx / Math.max(1, this.sents.length - 1)) * 100 : 0) + '%';
  },
};

// Screen Wake Lock (iOS 16.4+/18.4+ in Home Screen apps, Chrome): keeps the screen from locking, which would stop speech.
const wake = {
  lock: null,
  async on() { if (!store.get('wake', true) || !('wakeLock' in navigator) || this.lock) return; try { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => (this.lock = null)); } catch {} },
  off() { this.lock?.release().catch(() => {}); this.lock = null; },
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !player.playing) return;
  wake.on();
  // iOS suspends speech when the screen locks / app is backgrounded. Try to continue; if the
  // engine refuses (no user gesture), the onerror handler drops to paused with a hint.
  setTimeout(() => { if (player.playing && !synth.speaking && !synth.pending) { toast('Resumed after screen lock'); player.speakCurrent(); } }, 400);
});

// ================================================================ READER VIEW
let follow = store.get('follow', true);
let userScrolledAt = 0;
function highlight(i, force = false) {
  const prev = document.querySelector('.s.cur'); prev?.classList.remove('cur');
  document.querySelector('p.cur-p')?.classList.remove('cur-p');
  const span = document.querySelector(`.s[data-i="${i}"]`);
  if (!span) return;
  span.classList.add('cur'); span.parentElement.classList.add('cur-p');
  const s = player.sents[i];
  $('#doc-sub').textContent = `Page ${s.page} of ${player.doc.pages} · ${Math.round((i / Math.max(1, player.sents.length - 1)) * 100)}%`;
  if ((follow && Date.now() - userScrolledAt > 4000) || force) {
    const r = span.getBoundingClientRect();
    const playerTop = document.querySelector('.player').getBoundingClientRect().top;
    if (force || r.top < 90 || r.bottom > playerTop - 20) span.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
  }
  player.save();
}
['touchmove', 'wheel'].forEach((ev) => window.addEventListener(ev, () => (userScrolledAt = Date.now()), { passive: true }));

function updatePlayBtn() {
  $('#ico-play').toggleAttribute('hidden', player.playing); $('#ico-pause').toggleAttribute('hidden', !player.playing);
  $('#btn-play').setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
}

async function openDoc(id) {
  showView('reader');
  const it = lib.items.find((x) => x.id === id) || { id, name: 'Document', tags: [] };
  $('#doc-title').textContent = it.name; $('#doc-sub').textContent = '';
  const body = $('#doc-text');
  body.replaceChildren(el('div', { class: 'loading' }, el('div', { class: 'spinner' }), el('div', { id: 'load-msg', text: 'Opening…' })));
  $('#btn-play').disabled = true;
  try {
    let cached = await idb.get(id);
    if (!cached || (it.modifiedTime && cached.modifiedTime !== it.modifiedTime) || cached.v !== 2) {
      $('#load-msg').textContent = 'Downloading from Drive…';
      const bytes = await source.pdfBytes(id);
      const r = await extractParagraphs(bytes, (p, n) => { const m = $('#load-msg'); if (m) m.textContent = `Extracting text · page ${p} of ${n}`; });
      cached = { v: 2, modifiedTime: it.modifiedTime || '', ...r };
      idb.put(id, cached);
    }
    if (location.hash !== '#/doc/' + encodeURIComponent(id)) return; // user navigated away
    store.set('meta:' + id, { pages: cached.pages });
    if (!cached.paragraphs.length) { body.replaceChildren(el('div', { class: 'loading', text: 'This PDF has no selectable text (it is probably a scanned image). OCR is not supported yet.' })); return; }
    const { sents, paraStart } = buildSentences(cached.paragraphs);
    renderDoc(cached, sents);
    player.load({ id, name: it.name, pages: cached.pages }, sents, paraStart);
    $('#btn-play').disabled = false;
    window.__docReady = { id, sentences: sents.length, paragraphs: cached.paragraphs.length, pages: cached.pages };
  } catch (e) {
    console.error(e);
    if (e instanceof AuthError) { body.replaceChildren(el('div', { class: 'loading' }, 'Sign in to open this PDF. ', el('button', { class: 'btn primary', onclick: () => auth.signIn(), text: 'Sign in with Google' }))); return; }
    body.replaceChildren(el('div', { class: 'loading', text: 'Could not open this PDF: ' + e.message }));
  }
}

function renderDoc(doc, sents) {
  const body = $('#doc-text'); const frag = document.createDocumentFragment();
  let lastPage = 0, pEl = null, lastP = -1;
  sents.forEach((s, i) => {
    if (s.p !== lastP) {
      const para = doc.paragraphs[s.p];
      if (para.page !== lastPage) { if (lastPage) frag.append(el('div', { class: 'page-mark', text: 'Page ' + para.page })); lastPage = para.page; }
      pEl = el('p', { class: para.heading ? 'h' : null }); frag.append(pEl); lastP = s.p;
    }
    pEl.append(el('span', { class: 's', 'data-i': String(i), text: s.text }), ' ');
  });
  body.replaceChildren(frag);
}
// Tap a sentence -> read from there (a tap is a user gesture, so this also satisfies iOS).
$('#doc-text').addEventListener('click', (e) => {
  const s = e.target.closest('.s'); if (!s) return;
  if (window.getSelection()?.toString()) return;
  player.play(Number(s.dataset.i));
});

// ================================================================ SETTINGS / VOICES
function renderVoices() {
  const sel = $('#voice-select'); sel.replaceChildren();
  if (!speech.voices.length) sel.append(el('option', { text: 'Default voice' }));
  const good = speech.voices.filter((v) => voiceScore(v) > 0), other = speech.voices.filter((v) => voiceScore(v) <= 0);
  const label = (v) => `${v.name} (${v.lang})`;
  const add = (parent, v) => parent.append(el('option', { value: v.voiceURI, text: label(v), ...(speech.voice === v ? { selected: '' } : {}) }));
  if (good.length) { const g = el('optgroup', { label: 'Recommended' }); good.forEach((v) => add(g, v)); sel.append(g); }
  if (other.length) { const g = el('optgroup', { label: 'Other English voices' }); other.forEach((v) => add(g, v)); sel.append(g); }
  $('#voice-name').textContent = speech.voice ? speech.voice.name.replace(/\s*\(.*\)$/, '') + (/(premium|enhanced)/i.test(speech.voice.name + speech.voice.voiceURI) && !/(premium|enhanced)/i.test(speech.voice.name) ? ' ✦' : '') : 'Default voice';
}
function setRate(r) {
  speech.rate = Math.round(Number(r) * 100) / 100; store.set('rate', speech.rate);
  for (const id of ['#speed', '#speed2']) $(id).value = speech.rate;
  $('#speed-val').textContent = $('#speed-val2').textContent = speech.rate.toFixed(2) + '×';
}
let rateTimer;
function onRateInput(e) { setRate(e.target.value); clearTimeout(rateTimer); rateTimer = setTimeout(() => { if (player.playing) player.speakCurrent(); }, 250); }
function openSheet() {
  $('#acct-status').textContent = DEMO ? 'Demo mode (no Google account)' : auth.token ? 'Signed in to Google Drive (read-only)' : 'Not signed in';
  $('#btn-signout').hidden = DEMO || !auth.token;
  $('#sheet').hidden = $('#sheet-backdrop').hidden = false;
}
function closeSheet() { $('#sheet').hidden = $('#sheet-backdrop').hidden = true; }

// ================================================================ ROUTING
function showView(v) { $('#view-library').hidden = v !== 'library'; $('#view-reader').hidden = v !== 'reader'; window.scrollTo(0, 0); }
function route() {
  const m = location.hash.match(/^#\/doc\/(.+)$/);
  if (m) openDoc(decodeURIComponent(m[1]));
  else { player.stop(); showView('library'); renderLibrary(); }
}

const app = {
  onSignedIn() { showSignin(); loadLibrary(); },
};

// ================================================================ BOOT
function bind() {
  $('#btn-signin').onclick = () => auth.signIn();
  $('#btn-refresh').onclick = () => (auth.token || DEMO ? loadLibrary() : auth.signIn());
  $('#btn-settings').onclick = $('#btn-settings2').onclick = $('#btn-voice').onclick = openSheet;
  $('#btn-sheet-close').onclick = $('#sheet-backdrop').onclick = closeSheet;
  $('#search').oninput = (e) => { lib.query = e.target.value; renderLibrary(); };
  $('#btn-back').onclick = () => { player.stop(); location.hash = '#/'; };
  $('#btn-play').onclick = () => player.toggle();
  $('#btn-prev-sent').onclick = () => player.sentence(-1);
  $('#btn-next-sent').onclick = () => player.sentence(1);
  $('#btn-prev-para').onclick = () => player.paragraph(-1);
  $('#btn-next-para').onclick = () => player.paragraph(1);
  $('#speed').oninput = $('#speed2').oninput = onRateInput;
  $('#voice-select').onchange = (e) => { speech.setVoice(e.target.value); if (player.playing) player.speakCurrent(); };
  $('#btn-voice-test').onclick = () => { player.pause(); synth.cancel(); const u = speech.utter('This is how I sound reading your documents.'); window.__ttsLog.push({ preview: true, voice: u.voice?.name || null }); synth.speak(u); };
  $('#wake-toggle').checked = store.get('wake', true);
  $('#wake-toggle').onchange = (e) => { store.set('wake', e.target.checked); e.target.checked && player.playing ? wake.on() : wake.off(); };
  $('#follow-toggle').checked = follow;
  $('#follow-toggle').onchange = (e) => { follow = e.target.checked; store.set('follow', follow); };
  document.querySelectorAll('#theme-seg button').forEach((b) => (b.onclick = () => applyTheme(b.dataset.theme)));
  $('#btn-signout').onclick = () => { auth.signOut(); closeSheet(); lib.items = []; lib.tags = []; store.del('libCache'); showSignin(); renderLibrary(); };
  $('#btn-clear-cache').onclick = async () => { await idb.clear(); toast('Cached text cleared'); };
  // keyboard (desktop / iPad keyboard)
  document.addEventListener('keydown', (e) => {
    if ($('#view-reader').hidden || e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') e.shiftKey ? player.paragraph(1) : player.sentence(1);
    else if (e.key === 'ArrowLeft') e.shiftKey ? player.paragraph(-1) : player.sentence(-1);
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => player.save());
}

function boot() {
  applyTheme(store.get('theme', 'auto'));
  bind(); setRate(speech.rate);
  speech.loadVoices();
  synth.addEventListener?.('voiceschanged', () => speech.loadVoices());
  // Safari sometimes populates voices late without firing the event.
  [250, 1000, 2500].forEach((ms) => setTimeout(() => { if (!speech.voices.length) speech.loadVoices(); }, ms));
  auth.init();
  const cached = store.get('libCache');
  if (cached && !DEMO) Object.assign(lib, { tags: cached.tags, items: cached.items });
  showSignin();
  if (DEMO || auth.token) loadLibrary(); else renderLibrary();
  route();
  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && secure && !params.has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__app = { lib, player, speech, auth, synth: () => synth };
}

// ---------------------------------------------------------------- mock speech (tests / no-TTS browsers)
function installMockSpeech() {
  const voices = [
    { name: 'Albert', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.Albert', localService: true, default: false },
    { name: 'Daniel', lang: 'en-GB', voiceURI: 'com.apple.voice.compact.en-GB.Daniel', localService: true, default: false },
    { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true, default: true },
    { name: 'Ava (Enhanced)', lang: 'en-US', voiceURI: 'com.apple.voice.enhanced.en-US.Ava', localService: true, default: false },
    { name: 'Zoe (Premium)', lang: 'en-US', voiceURI: 'com.apple.voice.premium.en-US.Zoe', localService: true, default: false },
    { name: 'Thomas', lang: 'fr-FR', voiceURI: 'com.apple.voice.compact.fr-FR.Thomas', localService: true, default: false },
  ];
  const m = new EventTarget();
  let q = [], timer = null;
  Object.assign(m, {
    speaking: false, pending: false, paused: false, _spoken: [],
    getVoices: () => voices,
    speak(u) { q.push(u); m.pending = true; if (!m.speaking) run(); },
    cancel() { clearTimeout(timer); const was = q; q = []; m.speaking = m.pending = false; was.forEach((u) => u.onerror?.({ error: 'interrupted' })); },
    pause() { m.paused = true; }, resume() { m.paused = false; },
  });
  function run() {
    const u = q[0]; if (!u) { m.speaking = m.pending = false; return; }
    m.speaking = true; m.pending = q.length > 1; m._spoken.push(u.text); u.onstart?.({});
    timer = setTimeout(() => { q.shift(); m.speaking = false; u.onend?.({}); if (!m.speaking) { if (q.length) run(); else m.pending = false; } }, Math.max(80, u.text.length * 4 / (u.rate || 1)));
  }
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.rate = 1; this.voice = null; this.lang = ''; } };
  return m;
}

boot();

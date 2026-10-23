// Headless Chrome UI test for the EPUB Reader (demo mode + mocked Drive). Run with a static server on :8765
// serving pdf-reader/:  cd epub/tests && npm i && node e2e.mjs   (writes ../screenshots/)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const ROOT = process.env.ROOT || 'http://localhost:8765/';
const BASE = ROOT + 'epub/';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
const results = []; const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const errors = [];
async function newPage(dark = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return page;
}
const shot = (page, n) => page.screenshot({ path: SHOTS + n + '.png' });

// 1. Library
let page = await newPage();
await page.goto(BASE + '?demo=1&mockspeech=1&nosw', { waitUntil: 'networkidle0' });
await page.waitForSelector('.doc');
const docs = await page.$$eval('.doc-name', (els) => els.map((e) => e.textContent));
ok('library lists both demo EPUBs', docs.length === 2, docs.join(' | '));
const chips = await page.$$eval('.chip', (els) => els.map((e) => e.textContent));
ok('same 7 tags as the PDF app + Untagged', chips.join(',') === 'All2,Business plans0,Industry reports0,Research papers0,Technical docs0,Summaries0,Books1,Financial0,Untagged1', chips.join(','));
await shot(page, '01-library-light');
await page.click('.chip[data-tag="Books"]'); await sleep(150);
let names = await page.$$eval('.doc-name', (els) => els.map((e) => e.textContent));
ok('tag filter "Books"', names.length === 1 && /Yellow Wallpaper/.test(names[0]), names.join('|'));
await page.click('.chip[data-tag="__all__"]');

// 2. Open an EPUB 2 (NCX) book
await page.click('.doc[data-id="demo-alice"]');
await page.waitForFunction(() => window.__docReady, { timeout: 20000 });
const ready = await page.evaluate(() => window.__docReady);
ok('EPUB opened and parsed', ready.chapters === 17 && ready.sentences > 500, JSON.stringify(ready));
const marks = await page.$$eval('.ch-mark', (e) => e.map((x) => x.textContent));
ok('chapter dividers in spine order', marks[4] === 'CHAPTER I. Down the Rabbit-Hole' && marks[15] === 'CHAPTER XII. Alice’s Evidence', marks.slice(3, 7).join(' | '));
ok('voice picker prefers en-US Premium voice', /Zoe/.test(await page.$eval('#voice-name', (e) => e.textContent)));

// chapter picker
await page.click('#btn-chapters'); await sleep(300);
const chapList = await page.$$eval('.chap .chap-t', (e) => e.map((x) => x.textContent));
ok('chapter picker lists all chapters', chapList.length === 17 && chapList[4] === 'CHAPTER I. Down the Rabbit-Hole', chapList.length + ' items');
await page.click('.chap[data-ch="4"]'); await sleep(300);
let st = await page.evaluate(() => ({ idx: window.__app.player.idx, s: window.__app.player.sents[window.__app.player.idx] }));
ok('picking a chapter jumps to its first sentence', st.s.ch === 4 && /CHAPTER I/.test(st.s.text), JSON.stringify(st.s));
ok('subtitle shows chapter', /CHAPTER I\. Down the Rabbit-Hole · 5\/17/.test(await page.$eval('#doc-sub', (e) => e.textContent)));
await page.click('#btn-next-sent'); await page.click('#btn-next-sent');
await shot(page, '02-reader-light');

// 3. Speech
await page.click('#btn-play'); await sleep(1500);
st = await page.evaluate(() => ({ log: window.__ttsLog, idx: window.__app.player.idx, playing: window.__app.player.playing, cur: document.querySelector('.s.cur')?.dataset.i }));
ok('speech issued on Play and advances', st.log.length >= 2 && st.playing && String(st.idx) === st.cur, `${st.log.length} utterances, first: "${st.log[0]?.text.slice(0, 60)}"`);
ok('utterances ≤220 chars', st.log.every((x) => x.text.length <= 220));
await shot(page, '03-reader-playing');
await page.evaluate(() => window.__app.player.pause());
const b4 = await page.evaluate(() => window.__app.player.idx);
await page.click('#btn-next-para');
const ap = await page.evaluate(() => window.__app.player.idx);
ok('next paragraph', ap > b4);
await page.click('#btn-next-sent'); await page.click('#btn-prev-sent');
ok('sentence skip fwd/back', (await page.evaluate(() => window.__app.player.idx)) === ap);
await page.click('#btn-chapters'); await sleep(200);
await shot(page, '04-chapter-picker');
await page.click('#btn-next-ch'); await sleep(200);
st = await page.evaluate(() => window.__app.player.sents[window.__app.player.idx]);
ok('next chapter button', st.ch === 5 && /CHAPTER II/.test(st.text), st.text);
await page.click('#btn-next-sent'); await page.click('#btn-next-sent'); // mid-chapter II
await page.click('#btn-chapters'); await sleep(200); await page.click('#btn-prev-ch'); await sleep(100);
let st1 = await page.evaluate(() => window.__app.player.sents[window.__app.player.idx]);
await page.click('#btn-chapters'); await sleep(200); await page.click('#btn-prev-ch'); await sleep(100);
st = await page.evaluate(() => window.__app.player.sents[window.__app.player.idx]);
ok('prev chapter: 1st press → start of current, 2nd → previous chapter', st1.ch === 5 && /CHAPTER II/.test(st1.text) && st.ch === 4 && /CHAPTER I\./.test(st.text), st1.text + ' → ' + st.text);
await page.$eval('#speed', (e) => { e.value = '1.5'; e.dispatchEvent(new Event('input')); });
await page.click('#btn-play'); await sleep(400);
ok('speed 1.5× applied', (await page.evaluate(() => window.__ttsLog.at(-1).rate)) === 1.5);
await page.click('#btn-play');
await page.evaluate(() => window.__app.player.chapterStep(1)); await page.click('#btn-next-sent'); await page.click('#btn-next-sent');
const saved = await page.evaluate(() => ({ idx: window.__app.player.idx, pos: JSON.parse(localStorage.getItem('epubr-demo:pos:demo-alice')) }));
ok('position saved per book in localStorage (epubr: namespace)', saved.pos && saved.pos.i === saved.idx && saved.pos.ch === 5, JSON.stringify(saved.pos));
await page.click('#btn-settings2'); await sleep(250);
await shot(page, '05-settings-sheet');
await page.click('#btn-sheet-close');
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__docReady, { timeout: 20000 });
ok('position restored after reload', (await page.evaluate(() => window.__app.player.idx)) === saved.idx);
// second book has its own position
await page.goto(BASE + '?demo=1&mockspeech=1&nosw#/doc/demo-yellow', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__docReady?.id === 'demo-yellow', { timeout: 20000 });
ok('EPUB 3 (nav doc) book opens at its own start', (await page.evaluate(() => window.__app.player.idx)) === 0 && (await page.evaluate(() => window.__docReady.chapters)) === 3);
await page.goto(BASE + '?demo=1&mockspeech=1&nosw#/', { waitUntil: 'networkidle0' });
await page.waitForSelector('.doc .bar');
ok('library shows progress + chapter count', (await page.$$eval('.doc-meta', (e) => e.map((x) => x.textContent))).some((t) => /17 chapters/.test(t)));
await shot(page, '06-library-progress');
await page.close();

// 4. Dark mode
page = await newPage(true);
await page.goto(BASE + '?demo=1&mockspeech=1&nosw', { waitUntil: 'networkidle0' });
await page.waitForSelector('.doc'); await shot(page, '07-library-dark');
await page.click('.doc[data-id="demo-yellow"]'); await page.waitForFunction(() => window.__docReady);
await page.click('#btn-chapters'); await sleep(150); await page.click('.chap[data-ch="1"]'); await sleep(200);
await page.click('#btn-play'); await sleep(1200); await page.click('#btn-play');
await shot(page, '08-reader-dark');
await page.close();

// 5. Signed out
page = await newPage();
await page.goto(BASE + '?nosw', { waitUntil: 'networkidle0' }); await sleep(400);
ok('signed-out view shows Google sign-in card, configured client id', await page.$eval('#signin-card', (e) => !e.hidden) && (await page.$eval('#signin-note', (e) => e.textContent)) === '');
await shot(page, '09-signin');
await page.close();

// 6. Real Drive code path against a mocked Drive API
page = await newPage();
const buf = fs.readFileSync(new URL('../demo/yellow-wallpaper.epub', import.meta.url));
const reqs = [];
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('https://accounts.google.com/gsi/client')) return r.respond({ contentType: 'text/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}}),revoke(){}}}}' });
  if (u.startsWith('https://www.googleapis.com/drive/v3/files')) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'authorization' } });
    reqs.push({ u: decodeURIComponent(u), auth: r.headers()['authorization'] });
    if (u.includes('MANIFEST2?alt=media')) return r.respond({ headers: cors, contentType: 'application/json', body: JSON.stringify({ version: 1, tags: ['Books'], items: [{ fileId: 'E1', name: 'Yellow Wallpaper (manifest)', tags: ['Books'], added: '2026-10-23', chapters: 3 }] }) });
    if (decodeURIComponent(u).includes("name='library.json'")) return r.respond({ headers: cors, contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'MANIFEST2' }] }) });
    if (u.includes('/files?q=')) return r.respond({ headers: cors, contentType: 'application/json', body: JSON.stringify({ files: [
      { id: 'E1', name: 'yw.epub', mimeType: 'application/epub+zip', modifiedTime: '2026-10-23T00:00:00Z' },
      { id: 'E2', name: 'Some Other Book.epub', mimeType: 'application/octet-stream', modifiedTime: '2026-10-23T00:00:00Z' },
      { id: 'J1', name: 'library.json', mimeType: 'application/json', modifiedTime: '2026-10-23T00:00:00Z' }] }) });
    if (u.includes('/E1?alt=media')) return r.respond({ headers: cors, contentType: 'application/epub+zip', body: buf });
    return r.respond({ status: 404, headers: cors, body: '{}' });
  }
  r.continue();
});
await page.evaluateOnNewDocument(() => localStorage.setItem('epubr:auth', JSON.stringify({ token: 'FAKE_TOKEN', exp: Date.now() + 3600e3 })));
await page.goto(BASE + '?nosw&mockspeech=1', { waitUntil: 'networkidle0' });
await page.waitForSelector('.doc');
const dn = await page.$$eval('.doc-name', (e) => e.map((x) => x.textContent));
ok('Drive mode: newest library.json + folder listing merged; non-EPUB files ignored', dn.join('|') === 'Yellow Wallpaper (manifest)|Some Other Book', dn.join('|'));
ok('Drive mode: Bearer token; queries scoped to the EPUB folder; newest manifest first',
  reqs.every((d) => d.auth === 'Bearer FAKE_TOKEN') && reqs.some((d) => d.u.includes("'1KJNdHYCIrMNNdJavORBLXMJIJCHz000a' in parents") && d.u.includes('orderBy=modifiedTime desc')));
await page.click('.doc[data-id="E1"]');
await page.waitForFunction(() => window.__docReady, { timeout: 20000 });
ok('Drive mode: EPUB downloaded via alt=media and parsed', (await page.evaluate(() => window.__docReady.chapters)) === 3);
await page.evaluate(() => localStorage.clear());
await page.close();

// 7. PWA: own scope, own cache, no CDN, PDF app unaffected
page = await newPage();
await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(1500);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && { scope: r.scope, script: (r.active || r.installing || r.waiting).scriptURL }; });
const caches_ = await page.evaluate(async () => caches.keys());
const mf = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
ok('service worker scoped to /epub/', sw && sw.scope === BASE && sw.script === BASE + 'sw.js', JSON.stringify(sw));
ok("cache named 'epubr-v1'", caches_.includes('epubr-v1'), caches_.join(','));
ok('manifest: own name/scope/start_url', mf.name === 'EPUB Reader' && mf.scope === './' && mf.start_url === './' && mf.display === 'standalone');
await page.goto(ROOT, { waitUntil: 'networkidle0' }); await sleep(1500);
const both = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope), caches: await caches.keys(), title: document.title }));
ok('PDF app still loads with its own SW; EPUB cache survives', both.title === 'PDF Reader' && both.regs.includes(ROOT) && both.regs.includes(BASE) && both.caches.includes('epubr-v1'), JSON.stringify(both));
await page.goto(BASE + '?demo=1&mockspeech=1#/doc/demo-yellow', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__docReady, { timeout: 20000 });
const ext = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(location.origin) && !n.startsWith('https://accounts.google.com/gsi/')));
ok('no CDN requests besides Google sign-in (JSZip bundled)', ext.length === 0, ext.join(','));
await page.close();

const relevant = errors.filter((e) => !/accounts\.google\.com|gsi|favicon|404/i.test(e));
ok('no page errors', relevant.length === 0, relevant.slice(0, 5).join(' || '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

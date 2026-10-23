// Parser test: runs epub-parse.js in headless Chrome against real EPUB files (no Google sign-in needed).
// Usage: (static server on :8765 serving pdf-reader/) node parse-test.mjs file1.epub [file2.epub ...]
// Files are injected through request interception, so they never need to be inside the served folder.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:8765/epub/';
const files = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setRequestInterception(true);
page.on('request', (r) => {
  const m = r.url().match(/\/__book\/(\d+)$/);
  if (m) return r.respond({ status: 200, contentType: 'application/epub+zip', body: fs.readFileSync(files[+m[1]]) });
  r.continue();
});
await page.goto(BASE + '?demo=1&mockspeech=1&nosw', { waitUntil: 'networkidle0' });
let fail = 0;
const ok = (n, c, x = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const summaries = [];
for (let i = 0; i < files.length; i++) {
  const t0 = Date.now();
  const r = await page.evaluate(async (u) => {
    try {
      const b = await window.__parseEpubUrl(u);
      const counts = b.chapters.map((c, i) => b.paragraphs.filter((p) => p.ch === i).length);
      return { title: b.title, author: b.author, chapters: b.chapters.map((c, i) => ({ ...c, paras: counts[i], first: b.paragraphs[c.p]?.text.slice(0, 90) })),
        nParas: b.paragraphs.length, chars: b.paragraphs.reduce((a, p) => a + p.text.length, 0),
        monotonicCh: b.paragraphs.every((p, j) => j === 0 || p.ch >= b.paragraphs[j - 1].ch),
        startsMatch: b.chapters.every((c, i) => b.paragraphs[c.p]?.ch === i),
        increasing: b.chapters.every((c, i) => i === 0 || c.p > b.chapters[i - 1].p),
        sample: b.paragraphs.slice(0, 3).map((p) => p.text.slice(0, 100)) };
    } catch (e) { return { error: e.message }; }
  }, BASE + '__book/' + i);
  const ms = Date.now() - t0;
  console.log(`\n=== ${path.basename(files[i])} (${(fs.statSync(files[i]).size / 1e6).toFixed(2)} MB, parsed in ${ms} ms)`);
  if (r.error) { ok('parse', false, r.error); continue; }
  console.log(`title: ${r.title}\nauthor: ${r.author}\nparagraphs: ${r.nParas}, characters: ${r.chars}, chapters: ${r.chapters.length}`);
  for (const [k, c] of r.chapters.entries()) console.log(`  ${String(k + 1).padStart(3)}. ${'  '.repeat(c.depth)}${c.title}  [${c.paras} ¶]  “${c.first}”`);
  ok('has text', r.nParas > 0 && r.chars > 1000);
  ok('chapters in order, each starts at its own first paragraph', r.monotonicCh && r.startsMatch && r.increasing);
  summaries.push({ file: path.basename(files[i]), title: r.title, author: r.author, chapters: r.chapters.length, paragraphs: r.nParas, chars: r.chars, ms, chapterTitles: r.chapters.map((c) => c.title) });
}
ok('no page errors', !errors.length, errors.join(' | '));
fs.writeFileSync(new URL('./parse-results.json', import.meta.url), JSON.stringify(summaries, null, 1));
await browser.close();
process.exit(fail ? 1 : 0);

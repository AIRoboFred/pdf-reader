# PDF Reader (private read-aloud PWA)

Mobile-first static web app. It reads PDFs from Fred's private Google Drive folder
"PDF Reader Library" and reads them aloud with the browser's built-in speech engine.

- **Setup / deploy:** see [SETUP.md](SETUP.md)
- **Config:** `config.js` (CLIENT_ID, FOLDER_ID, scope, auth mode)
- **Demo:** `index.html?demo=1` (add `&mockspeech=1` to fake TTS)
- **Tests:** `python3 -m http.server 8765` then `cd tests && npm i puppeteer-core && node e2e.mjs`

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | UI (dark/light, safe-area aware, iOS Home Screen meta) |
| `app.js` | Auth (GIS token client + redirect fallback), Drive reads, library/tag UI, PDF.js extraction, sentence chunking, speech player |
| `config.js` | Public config (no secrets) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline shell, installable) |
| `vendor/pdfjs/` | PDF.js 4.10.38 legacy build, bundled locally (Apache-2.0) |
| `demo/` | Sample PDFs + mock Drive data for `?demo=1` |
| `.htaccess` | MIME types / caching for Apache/LiteSpeed hosts (Hostinger) |
| `tests/e2e.mjs` | Headless Chrome test (390×844) that writes `screenshots/` |

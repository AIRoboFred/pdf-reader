// EPUB -> readable text, in spine order, split into chapters from the book's own table of contents.
// Pure browser code (DOMParser + JSZip). No network, no eval. Used by app.js and by tests.
//
// Result: { v, title, author, chapters: [{ title, depth, p }], paragraphs: [{ ch, text, heading }] }
//   chapters[i].p = index of the chapter's first paragraph; paragraphs[j].ch = chapter index.

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote',
  'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure', 'figcaption', 'section', 'article',
  'aside', 'header', 'footer', 'main', 'nav', 'address', 'center', 'hr', 'body', 'hgroup', 'details', 'summary']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'noscript', 'template', 'rt', 'rp', 'img', 'image',
  'video', 'audio', 'object', 'iframe', 'input', 'button', 'select', 'textarea', 'link', 'meta']);
const HEAD = /^h[1-6]$/;

const lname = (n) => (n.localName || n.nodeName || '').toLowerCase();
const attr = (n, a) => n.getAttribute?.(a) ?? null;
const epubType = (n) => (attr(n, 'epub:type') || n.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '');
const norm = (s) => s.replace(/\u00ad/g, '').replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]+/g, ' ').trim();

function skippable(n) {
  const t = lname(n);
  if (SKIP.has(t)) return true;
  const et = epubType(n), role = attr(n, 'role') || '', cls = attr(n, 'class') || '';
  if (/\b(pagebreak|noteref)\b/.test(et) || /doc-(pagebreak|noteref)/.test(role)) return true;
  if (/(^|\s)(pagenum|page-?number|pgnum)(\s|$)/i.test(cls)) return true; // Gutenberg "[Pg 12]" markers
  if (attr(n, 'hidden') != null || attr(n, 'aria-hidden') === 'true' && t !== 'span') return true;
  return false;
}

function resolvePath(base, href) {
  try {
    const u = new URL(href, 'http://epub.local/' + base);
    return decodeURIComponent(u.pathname.slice(1));
  } catch { return href; }
}
function splitHref(base, href) {
  const i = href.indexOf('#');
  const path = resolvePath(base, i >= 0 ? href.slice(0, i) : href);
  const frag = i >= 0 ? decodeURIComponent(href.slice(i + 1)) : '';
  return { path, frag };
}

function parseXml(text, type = 'application/xhtml+xml') {
  const P = globalThis.DOMParser;
  let doc = new P().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) {
    // Not well-formed XML (e.g. HTML entities without a DTD) -> fall back to the forgiving HTML parser.
    doc = new P().parseFromString(text.replace(/^\s*<\?xml[^>]*>/, ''), 'text/html');
  }
  return doc;
}
const byTag = (root, name) => [...root.getElementsByTagName('*')].filter((e) => lname(e) === name);
const firstTag = (root, name) => byTag(root, name)[0] || null;

export async function parseEpub(bytes, JSZip, onProgress) {
  const zip = await JSZip.loadAsync(bytes);
  const fileMap = new Map(Object.keys(zip.files).map((k) => [k, k]));
  const lower = new Map(Object.keys(zip.files).map((k) => [k.toLowerCase(), k]));
  const find = (p) => fileMap.get(p) || fileMap.get(encodeURI(p)) || lower.get(p.toLowerCase()) || null;
  const read = async (p) => { const k = find(p); if (!k) throw new Error('Missing file in EPUB: ' + p); return zip.file(k).async('string'); };

  if (find('META-INF/encryption.xml')) {
    const enc = await read('META-INF/encryption.xml');
    // Font obfuscation is harmless; anything else means DRM-protected content we cannot read.
    const datas = (enc.match(/<(?:\w+:)?CipherReference[^>]*URI="([^"]+)"/g) || []).map((m) => m.match(/URI="([^"]+)"/)[1]);
    if (datas.some((u) => !/\.(otf|ttf|woff2?)$/i.test(u))) throw new Error('This EPUB is DRM-protected, so its text cannot be read.');
  }

  // 1) container.xml -> OPF
  const container = parseXml(await read('META-INF/container.xml'), 'application/xml');
  const rootfile = firstTag(container, 'rootfile');
  const opfPath = rootfile && attr(rootfile, 'full-path');
  if (!opfPath) throw new Error('Not a valid EPUB (no rootfile in container.xml).');
  const opf = parseXml(await read(opfPath), 'application/xml');

  const meta = (name) => norm(firstTag(opf, name)?.textContent || '');
  const title = meta('title');
  const author = byTag(opf, 'creator').map((c) => norm(c.textContent)).filter(Boolean);

  // 2) manifest + spine
  const manifest = new Map();
  for (const it of byTag(opf, 'item')) {
    manifest.set(attr(it, 'id'), { href: resolvePath(opfPath, attr(it, 'href') || ''), type: attr(it, 'media-type') || '', props: attr(it, 'properties') || '' });
  }
  const spineEl = firstTag(opf, 'spine');
  const spine = byTag(opf, 'itemref')
    .filter((r) => attr(r, 'linear') !== 'no')
    .map((r) => manifest.get(attr(r, 'idref')))
    .filter((m) => m && /html|xml/i.test(m.type) && !/ncx/i.test(m.type));
  if (!spine.length) throw new Error('This EPUB has no readable chapters.');

  // 3) table of contents: EPUB 3 nav document, else EPUB 2 NCX
  let toc = [];
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  if (navItem && find(navItem.href)) {
    try {
      const nav = parseXml(await read(navItem.href));
      const navs = byTag(nav, 'nav');
      const tocNav = navs.find((n) => /\btoc\b/.test(epubType(n))) || navs[0];
      if (tocNav) {
        for (const a of byTag(tocNav, 'a')) {
          const href = attr(a, 'href'); if (!href) continue;
          let depth = 0; for (let p = a.parentNode; p && p !== tocNav; p = p.parentNode) if (lname(p) === 'ol' || lname(p) === 'ul') depth++;
          toc.push({ title: norm(a.textContent), depth: Math.max(0, depth - 1), ...splitHref(navItem.href, href) });
        }
      }
    } catch (e) { toc = []; }
  }
  if (!toc.length) {
    const ncxItem = manifest.get(spineEl && attr(spineEl, 'toc')) || [...manifest.values()].find((m) => /ncx/i.test(m.type));
    if (ncxItem && find(ncxItem.href)) {
      try {
        const ncx = parseXml(await read(ncxItem.href), 'application/xml');
        const walk = (parent, depth) => {
          for (const np of [...parent.children].filter((c) => lname(c) === 'navpoint')) {
            const label = [...np.children].find((c) => lname(c) === 'navlabel');
            const content = [...np.children].find((c) => lname(c) === 'content');
            const src = content && attr(content, 'src');
            if (src) toc.push({ title: norm(label?.textContent || ''), depth, ...splitHref(ncxItem.href, src) });
            walk(np, depth + 1);
          }
        };
        const navMap = firstTag(ncx, 'navmap'); if (navMap) walk(navMap, 0);
      } catch (e) { toc = []; }
    }
  }

  // 4) walk spine docs in order, emitting paragraphs; TOC targets start new chapters
  const markers = new Map(); // path -> [{frag, t}]
  toc.forEach((t, i) => { if (!markers.has(t.path)) markers.set(t.path, []); markers.get(t.path).push({ ...t, i }); });
  const fired = new Set();
  const chapters = []; const paragraphs = [];
  let ch = -1;
  const startChapter = (t) => { if (fired.has(t.i)) return; fired.add(t.i); chapters.push({ title: t.title || 'Untitled', depth: t.depth || 0, p: paragraphs.length }); ch = chapters.length - 1; };

  for (let si = 0; si < spine.length; si++) {
    onProgress?.(si + 1, spine.length);
    const item = spine[si];
    if (!find(item.href)) continue;
    const doc = parseXml(await read(item.href), /html/i.test(item.type) && !/xhtml/i.test(item.type) ? 'text/html' : 'application/xhtml+xml');
    const body = firstTag(doc, 'body') || doc.documentElement;
    const ms = markers.get(item.href) || [];
    const ids = new Set();
    for (const e of body.getElementsByTagName('*')) { const id = attr(e, 'id'); if (id) ids.add(id); }
    // markers for the whole file, or for an anchor that doesn't exist, fire at the top of the file
    const byId = new Map();
    for (const m of ms) { if (m.frag && ids.has(m.frag)) { if (!byId.has(m.frag)) byId.set(m.frag, []); byId.get(m.frag).push(m); } else startChapter(m); }

    const docStart = paragraphs.length;
    // no usable TOC -> one chapter per spine document (named after its first heading below)
    if (!toc.length) { chapters.push({ title: '', depth: 0, p: paragraphs.length, auto: true }); ch = chapters.length - 1; }
    let buf = '', heading = false, headDepth = 0;
    const flush = () => {
      const text = norm(buf); buf = '';
      if (text && /[\p{L}\p{N}]/u.test(text)) {
        if (ch < 0) { chapters.push({ title: '', depth: 0, p: paragraphs.length, auto: true }); ch = 0; }
        paragraphs.push({ ch, text, heading: heading && text.length < 200 });
      }
      heading = headDepth > 0;
    };
    const walk = (node) => {
      for (let n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 || n.nodeType === 4) { if (n.nodeValue) { buf += n.nodeValue; if (headDepth && /\S/.test(n.nodeValue)) heading = true; } continue; }
        if (n.nodeType !== 1) continue;
        const id = attr(n, 'id');
        if (id && byId.has(id)) { flush(); for (const m of byId.get(id)) startChapter(m); }
        if (skippable(n)) continue;
        const t = lname(n);
        if (t === 'br') { buf += ' '; continue; }
        if (BLOCK.has(t)) {
          flush();
          const isH = HEAD.test(t) || attr(n, 'role') === 'heading';
          if (isH) headDepth++;
          heading = headDepth > 0;
          walk(n);
          flush();
          if (isH) headDepth--;
          heading = headDepth > 0;
        } else walk(n);
      }
    };
    walk(body); flush();

    // name auto chapters (text before the first TOC target, or no TOC) after their first heading or the doc title
    chapters.forEach((c, i) => {
      if (!c.auto || c.title) return;
      const end = chapters[i + 1]?.p ?? paragraphs.length;
      if (end <= c.p) return;
      const h = paragraphs.slice(c.p, end).find((p) => p.heading);
      c.title = (h?.text || norm(firstTag(doc, 'title')?.textContent || '') || 'Beginning').slice(0, 120);
    });
  }

  let out = chapters.filter((c, i) => (chapters[i + 1]?.p ?? paragraphs.length) > c.p); // drop chapters with no text
  // remap paragraph -> chapter index after dropping empties
  const remap = new Map(); let k = -1;
  chapters.forEach((c, i) => { if (out.includes(c)) k = out.indexOf(c); remap.set(i, Math.max(0, k)); });
  for (const p of paragraphs) p.ch = remap.get(p.ch) ?? 0;
  out = out.map(({ title, depth, p }) => ({ title, depth, p }));
  if (!out.length && paragraphs.length) out = [{ title: title || 'Text', depth: 0, p: 0 }];
  // normalise depth so the shallowest level is 0
  const minD = Math.min(...out.map((c) => c.depth)); if (minD > 0) out.forEach((c) => (c.depth -= minD));
  return { v: 1, title, author: author.join(', '), chapters: out, paragraphs };
}

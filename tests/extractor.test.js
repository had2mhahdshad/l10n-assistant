'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractTextSegments, extractLanguageInfo, discoverTargetUrl, extractNonTranslatable, mergeNonTranslatable } = require('../src/lib/extractor');

const HTML = `<!doctype html><html lang="en">
<head>
  <title>Acme — Project management</title>
  <meta name="description" content="Ship projects faster" />
  <link rel="alternate" hreflang="ja" href="https://acme.com/ja" />
  <link rel="alternate" hreflang="de" href="https://acme.com/de" />
  <script>var untranslated = "should not appear";</script>
  <style>.x{color:red}</style>
</head>
<body>
  <h1>Create a new workspace</h1>
  <p>Welcome <b>back</b> to your dashboard</p>
  <button>Save changes</button>
  <input placeholder="Search projects" />
  <a href="/ja/">日本語</a>
  <a href="/de/">Deutsch</a>
</body></html>`;

test('extracts visible text and skips script/style', () => {
  const segs = extractTextSegments(HTML);
  const texts = segs.map((s) => s.text);
  assert.ok(texts.includes('Create a new workspace'));
  assert.ok(texts.includes('Save changes'));
  assert.ok(texts.includes('Search projects')); // placeholder attribute
  assert.ok(texts.some((t) => t.includes('Acme — Project management')));
  assert.ok(!texts.some((t) => t.includes('should not appear')));
  assert.ok(!texts.some((t) => t.includes('color:red')));
});

test('extracts language info: html lang, hreflang, switcher', () => {
  const info = extractLanguageInfo(HTML, 'https://acme.com/');
  assert.strictEqual(info.htmlLang, 'en');
  assert.strictEqual(info.hreflangs.length, 2);
  assert.ok(info.hreflangs.some((h) => h.lang === 'ja' && h.url === 'https://acme.com/ja'));
  assert.ok(info.switcher.some((s) => s.lang.toLowerCase() === 'ja'));
});

test('discovers target url via hreflang first', () => {
  const r = discoverTargetUrl(HTML, 'https://acme.com/', 'ja');
  assert.strictEqual(r.url, 'https://acme.com/ja');
  assert.strictEqual(r.via, 'hreflang');
});

test('returns null instead of guessing when no target exists', () => {
  const r = discoverTargetUrl('<html><body><p>Hello</p></body></html>', 'https://acme.com/', 'fr');
  assert.strictEqual(r.url, null);
  assert.strictEqual(r.via, null);
});

// ── non-translatable content inventory ──────────────────────────────────

const NT_HTML = `<!doctype html><html lang="en"><body>
  <img src="/a.png"><img src="/b.png" alt="Screenshot">
  <iframe src="https://widget.example/embed"></iframe>
  <canvas id="c"></canvas>
  <video src="/v.mp4"></video>
  <svg><text>vector label</text></svg>
  <span translate="no">Acme™</span>
  <p class="notranslate">Do not translate</p>
  <p>Normal translatable copy</p>
</body></html>`;

test('extracts non-translatable inventory by element type', () => {
  const nt = extractNonTranslatable(NT_HTML);
  assert.equal(nt.images, 2);
  assert.equal(nt.imagesWithoutAlt, 1);
  assert.equal(nt.iframes, 1);
  assert.equal(nt.canvas, 1);
  assert.equal(nt.videos, 1);
  assert.equal(nt.svgs, 1);
  assert.equal(nt.noTranslateMarked, 2);
});

test('plain text pages report zero non-translatable content', () => {
  const nt = extractNonTranslatable('<html><body><p>Just words</p></body></html>');
  for (const k of Object.keys(nt)) assert.equal(nt[k], 0, k);
});

test('mergeNonTranslatable sums pages and tolerates nulls', () => {
  const merged = mergeNonTranslatable([
    { images: 2, imagesWithoutAlt: 1, iframes: 0, canvas: 0, videos: 0, svgs: 0, noTranslateMarked: 0 },
    null,
    { images: 1, imagesWithoutAlt: 0, iframes: 3, canvas: 1, videos: 0, svgs: 2, noTranslateMarked: 1 },
  ]);
  assert.equal(merged.images, 3);
  assert.equal(merged.iframes, 3);
  assert.equal(merged.canvas, 1);
  assert.equal(merged.svgs, 2);
});

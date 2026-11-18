'use strict';
// Font recommendation & config generation — pure function tests.

const test = require('node:test');
const assert = require('node:assert');
const fonts = require('../src/lib/fonts');
const { CATALOG } = require('../src/data/fontCatalog');

const cfg = {
  fonts: { enabled: true, defaultFontDisplay: 'swap', cdnCacheSeconds: 31536000, catalog: CATALOG, tiers: {} },
  commerce: { currency: 'CNY', quoteNote: '' },
};

test('ja requires latin+kana+cjk and only recommends fonts that cover them', () => {
  const r = fonts.recommend('ja', cfg);
  assert.deepStrictEqual(r.requiredScripts, ['latin', 'kana', 'cjk']);
  assert.strictEqual(r.keepCurrentFont, false);
  assert.ok(r.recommendations.some((f) => f.id === 'noto-sans-jp'));
  assert.ok(r.recommendations.every((f) => fonts.covers(f, r.requiredScripts)));
});

test('de and fr get keep-your-Latin-font advice instead of a forced font', () => {
  for (const lang of ['de', 'fr']) {
    const r = fonts.recommend(lang, cfg);
    assert.strictEqual(r.keepCurrentFont, true);
    assert.ok(r.keepCurrentFontReason.length > 10);
  }
});

test('script coverage refuses a Latin-only font for Japanese', () => {
  const inter = CATALOG.find((f) => f.id === 'inter');
  assert.strictEqual(fonts.covers(inter, ['latin', 'kana', 'cjk']), false);
});

test('no font binary is offered unless the license allows redistribution', () => {
  for (const f of CATALOG) {
    const pub = fonts.publicFont(f);
    assert.strictEqual(pub.fileAvailable, f.license.allowRedistribution === true && f.packagable === true);
  }
});

test('online config css: legal @import reference, swap, no preload tag, system fallback', () => {
  const jp = CATALOG.find((f) => f.id === 'noto-sans-jp');
  const out = fonts.buildConfigCss('ja', jp, cfg);
  assert.ok(out.css.includes('@import'));
  assert.ok(out.css.includes('display=swap') || out.css.includes('font-display: swap'));
  assert.ok(!/<link[^>]*preload/i.test(out.css));
  assert.ok(out.css.includes('Meiryo') || out.css.includes('system-ui'));
  assert.strictEqual(out.filename, 'font-config-ja.css');
  assert.strictEqual(out.requiresBinary, false);
});

test('self-host config uses a relative woff2 path and font-display swap', () => {
  const tpl = CATALOG.find((f) => f.id === 'self-host-template');
  const out = fonts.buildConfigCss('de', tpl, cfg);
  assert.ok(out.css.includes('url("../fonts/self-host-template.woff2") format("woff2")'));
  assert.ok(out.css.includes('font-display: swap'));
  assert.strictEqual(out.requiresBinary, true);
});

test('system font config has no @font-face and makes no network request', () => {
  const sys = CATALOG.find((f) => f.id === 'system-sans');
  const out = fonts.buildConfigCss('en', sys, cfg);
  assert.ok(!out.css.includes('@font-face'));
  assert.ok(!out.css.includes('@import'));
  assert.ok(out.css.includes('--l10n-font-en'));
});

test('localization package separates locales, styles and fonts; JSON stays font-free', () => {
  const jp = CATALOG.find((f) => f.id === 'noto-sans-jp');
  const built = fonts.buildConfigCss('ja', jp, cfg);
  const files = fonts.buildLocalizationPackage({
    locales: [{ locale: 'ja', content: '{"a":"1"}' }],
    fontConfigs: [{ font: fonts.publicFont(jp), config: built }],
    manifest: { lockedStrings: 3 },
    cfg,
  });
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('localization-package/locales/ja.json'));
  assert.ok(paths.includes('localization-package/styles/font-config-ja.css'));
  assert.ok(paths.includes('localization-package/styles/font-config.css'));
  assert.ok(paths.includes('localization-package/fonts/README.md'));
  assert.ok(paths.includes('localization-package/translation-manifest.json'));
  const json = files.find((f) => f.path.endsWith('ja.json')).content;
  assert.ok(!json.includes('font-face'));
  assert.ok(!paths.some((p) => /\.(woff2?|ttf|otf)$/.test(p)));
});

test('font config normalises locales and rejects CSS-breaking input', () => {
  assert.strictEqual(fonts.normalizeLocale('zh-CN'), 'zh');
  assert.strictEqual(fonts.normalizeLocale('ja-JP'), 'ja');
  const evil = { ...CATALOG[1], family: 'x { } <script>' };
  const out = fonts.buildConfigCss('en', evil, cfg);
  assert.ok(!out.css.includes('<script>'));
  assert.ok(!out.css.includes('{ } <'));
});

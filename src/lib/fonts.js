'use strict';
// Font Recommendation & Integration (MVP).
//
// Stage-one scope, deliberately narrow:
//   - recommend fonts for ONE selected target locale
//   - generate a standalone CSS config file + integration notes
//   - link out to the upstream font service / source
//   NO online preview, NO dynamic subsetting, NO font CDN, NO auto code edits.
//
// All commercial / legal data (catalog, licenses, links, tiers, prices) comes
// from runtime settings. A font BINARY is only ever offered when its license
// explicitly allows redistribution AND the catalog marks it packagable.

const { LANGUAGE_SCRIPTS, SAMPLE_CHARS, LATIN_SUFFICIENT, LANGUAGE_NOTES } = require('../data/fontCatalog');

function normalizeLocale(lang) {
  const l = String(lang || 'en').trim().toLowerCase();
  if (l === 'zh-cn' || l === 'zh-hans' || l === 'zh') return 'zh';
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('fr')) return 'fr';
  return l.split('-')[0];
}

function requiredScripts(lang) {
  return LANGUAGE_SCRIPTS[normalizeLocale(lang)] || ['latin'];
}

/** A font is eligible only if it actually covers every script the locale needs. */
function covers(font, scripts) {
  const have = Array.isArray(font.scripts) ? font.scripts : [];
  return scripts.every((s) => have.includes(s));
}

/** License gate. Bundling/downloading is stricter than recommending. */
function licenseAllows(font, usage) {
  const lic = font.license || {};
  if (usage === 'recommend' || usage === 'config') return true;
  if (usage === 'download' || usage === 'package') {
    return font.packagable === true && lic.allowRedistribution === true;
  }
  return false;
}

function publicFont(font) {
  const lic = font.license || {};
  return {
    id: font.id,
    name: font.name,
    family: font.family,
    style: font.style,
    useCase: font.useCase,
    provider: font.provider,
    scripts: font.scripts,
    tier: font.tier,
    woff2: !!font.woff2,
    unicodeRange: font.unicodeRange || null,
    license: {
      name: lic.name || 'Unknown',
      url: lic.url || '',
      scope: lic.scope || '',
      allowRedistribution: !!lic.allowRedistribution,
    },
    sourceUrl: font.sourceUrl || '',
    // A jump link to the upstream source is always allowed; a BINARY is not.
    downloadUrl: font.downloadUrl || '',
    cssUrl: font.cssUrl || '',
    // Only true when we may actually hand out a font file (never in MVP seed).
    fileAvailable: licenseAllows(font, 'package'),
    notes: font.notes || '',
  };
}

/**
 * Recommend fonts for one target locale.
 * German/French explicitly get "keep your existing Latin font" advice instead
 * of being pushed a separate locale-specific font.
 */
function recommend(lang, cfg, tier = 'free') {
  const fonts = cfg.fonts || {};
  const commerce = cfg.commerce || {};
  const norm = normalizeLocale(lang);
  const scripts = requiredScripts(lang);
  const requestedTier = tier === 'typography-pack' ? 'typography-pack' : 'free';

  const all = Array.isArray(fonts.catalog) ? fonts.catalog : [];
  const eligible = all.filter((f) => covers(f, scripts) && licenseAllows(f, 'recommend'));
  const visible = requestedTier === 'typography-pack'
    ? eligible
    : eligible.filter((f) => (f.tier || 'free') === 'free');

  // System stack first (zero network cost), then online webfonts, then templates.
  const order = { system: 0, online: 1, 'self-host': 2 };
  const sorted = visible.slice().sort((a, b) => (order[a.provider] ?? 9) - (order[b.provider] ?? 9));

  return {
    lang: norm,
    requestedLang: String(lang || ''),
    requiredScripts: scripts,
    sampleChars: SAMPLE_CHARS[norm] || '',
    keepCurrentFont: LATIN_SUFFICIENT.includes(norm),
    keepCurrentFontReason: LANGUAGE_NOTES[norm] || '',
    note: LANGUAGE_NOTES[norm] || '',
    recommendations: sorted.map(publicFont),
    tiers: fonts.tiers || {},
    currency: commerce.currency || 'CNY',
    paymentEnabled: !!commerce.paymentEnabled,
    // No fabricated case studies, no "AI-certified" claims.
    disclaimerKeys: ['font.notPreview', 'font.notBundled', 'font.licenseCheck'],
  };
}

function findFont(fontId, cfg) {
  const all = (cfg.fonts && cfg.fonts.catalog) || [];
  return all.find((f) => f.id === String(fontId || '')) || null;
}

function cssSafe(s) {
  return String(s || '').replace(/[\r\n{}<>]/g, ' ').trim();
}

/**
 * Build a standalone CSS config for one locale + chosen font.
 * Returns { filename, css, fontId, lang, provider, license, requiresBinary, integration }.
 *
 * Rules enforced:
 *   - font-display: swap (configurable), never `block`
 *   - WOFF2 only for webfonts
 *   - unicode-range emitted when the font provides subsets
 *   - NO <link rel=preload>, NO @font-face for system stacks
 *   - every declaration ends in a system fallback (load-failure safe)
 */
function buildConfigCss(lang, font, cfg) {
  const norm = normalizeLocale(lang);
  const fonts = cfg.fonts || {};
  const display = ['swap', 'optional', 'fallback', 'auto'].includes(fonts.defaultFontDisplay)
    ? fonts.defaultFontDisplay : 'swap';
  const cache = Number(fonts.cdnCacheSeconds) || 31536000;
  const lic = font.license || {};
  const family = cssSafe(font.family);
  const varName = `--l10n-font-${norm.replace(/[^a-z0-9]/gi, '-')}`;
  const fileName = `font-config-${norm}.css`;

  const head = [
    `/* ${fileName} — generated by L10N ASSISTANT */`,
    `/* Target locale: ${norm} | Font: ${cssSafe(font.name)} | Provider: ${font.provider} */`,
    `/* License: ${cssSafe(lic.name || 'Unknown')}${lic.url ? ' — ' + lic.url : ''} */`,
    `/* No font binary is bundled with this configuration. */`,
    `/* CDN responses are cacheable (~${cache}s). Do not preload every locale: */`,
    `/* load this stylesheet ONLY on pages that render ${norm} content. */`,
    ``,
  ];

  let body = '';
  let requiresBinary = false;

  if (font.provider === 'online') {
    const url = font.cssUrl || '';
    if (url) {
      body += `@import url('${url}');\n\n`;
      head.push(`/* Faster alternative: <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin> */`);
      head.push(`/* then <link rel="stylesheet" href="${url}"> — stylesheet is non-blocking with display=swap. */`);
      head.push(``);
    } else {
      // Legal online reference fallback: declare the family, rely on the
      // service stylesheet the integrator adds; never invent an URL.
      body += `/* Add the provider's stylesheet link; no URL is configured for this font. */\n\n`;
    }
  } else if (font.provider === 'self-host') {
    requiresBinary = true;
    const rel = `../fonts/${font.id}.woff2`;
    const ur = font.unicodeRange ? `  unicode-range: ${cssSafe(font.unicodeRange)};\n` : '';
    body += [
      `@font-face {`,
      `  font-family: "${cssSafe(font.name)}";`,
      `  src: url("${rel}") format("woff2");`,
      `  font-style: normal;`,
      `  font-weight: 400 700; /* adjust to the weights you actually ship */`,
      `  font-display: ${display};`,
      ur + `}`,
      ``,
      `/* Place ${font.id}.woff2 at fonts/ and CONFIRM your license permits`,
      `   webfont embedding. This package intentionally contains no binary. */`,
      ``,
    ].join('\n');
  } else {
    // System stack: no request at all, guaranteed fallback.
    body += `/* System font stack — zero network cost, always available. */\n\n`;
  }

  body += [
    `:root { ${varName}: ${family}; }`,
    ``,
    `[lang="${norm}"], .l10n-${norm} {`,
    `  font-family: var(${varName});`,
    `}`,
    ``,
    `/* Load-failure fallback is already inside the font-family stack. */`,
    `/* Text renders immediately; the webfont swaps in when ready (${display}). */`,
    ``,
  ].join('\n');

  const css = head.join('\n') + body;
  return {
    filename: fileName,
    css,
    fontId: font.id,
    fontName: font.name,
    lang: norm,
    provider: font.provider,
    license: { name: lic.name || 'Unknown', url: lic.url || '' },
    requiresBinary,
    fontDisplay: display,
    woff2: !!font.woff2,
    integration: integrationSteps(font, fileName, cfg),
  };
}

/** Short, honest integration notes (bilingual, developer-facing). */
function integrationSteps(font, fileName, cfg) {
  const commerce = cfg.commerce || {};
  const lic = font.license || {};
  const lines = [
    `1. Copy styles/${fileName} into your project and load it ONLY on pages showing this locale:`,
    `   <link rel="stylesheet" href="/styles/${fileName}">`,
    `2. Add the locale attribute on the container: <html lang="..."> or class="l10n-...".`,
    `3. Do NOT add <link rel="preload"> for every locale. Only the selected locale is configured.`,
    `4. font-display: swap keeps text visible; a system fallback is present if the webfont fails.`,
  ];
  if (font.provider === 'online' && font.cssUrl) {
    lines.push(`5. Webfont is served by the upstream provider (${font.cssUrl}). Check its cache/CORS policy.`);
  }
  if (font.provider === 'self-host') {
    lines.push(`5. Supply your own WOFF2 at fonts/${font.id}.woff2. No binary is included in this package.`);
  }
  lines.push(`6. License: ${lic.name || 'Unknown'}${lic.url ? ' — ' + lic.url : ''}. ${lic.scope || ''}`);
  lines.push(`   Keep the license notice if you redistribute the font.`);
  lines.push(`7. Font files and JSON translation files are managed, downloaded and licensed SEPARATELY.`);
  lines.push(`8. ${commerce.quoteNote || 'Pricing is quoted separately.'}`);
  lines.push(``, `说明：字体配置与翻译 JSON 分开管理；默认不预加载、不阻塞正文；加载失败自动回退系统字体。`);
  return lines.join('\n');
}

/** Human-readable font folder note: no binaries unless explicitly licensed. */
function buildFontsReadme(fonts, cfg) {
  const commerce = cfg.commerce || {};
  const lines = [
    `# fonts/`,
    ``,
    `This folder does NOT contain font binaries in this release.`,
    `A font file is only bundled when its license explicitly permits`,
    `redistribution and the admin catalog marks it as packagable.`,
    ``,
  ];
  for (const f of fonts) {
    lines.push(`## ${f.name} (${f.id})`);
    lines.push(`- License: ${f.license?.name || 'Unknown'}${f.license?.url ? ' — ' + f.license.url : ''}`);
    lines.push(`- Scope: ${f.license?.scope || 'n/a'}`);
    lines.push(`- Provider: ${f.provider}`);
    if (f.sourceUrl) lines.push(`- Source: ${f.sourceUrl}`);
    if (f.downloadUrl) lines.push(`- Official download (verify license): ${f.downloadUrl}`);
    if (f.cssUrl) lines.push(`- Stylesheet: ${f.cssUrl}`);
    lines.push(`- redistributable: ${f.license?.allowRedistribution ? 'yes' : 'no'}`);
    lines.push(``);
  }
  lines.push(`---`, commerce.quoteNote || 'Pricing is quoted separately.', ``);
  return lines.join('\n');
}

/**
 * Build the virtual file tree for `localization-package/`.
 * @param {object} args
 *   locales   [{ locale, content (JSON string) }]
 *   fonts     [{ font, config }] (config from buildConfigCss)
 *   manifest  object (translation coverage / quota)
 *   cfg       runtime config
 * @returns [{ path, content }]
 */
function buildLocalizationPackage({ locales = [], fontConfigs = [], manifest = null, cfg = {} }, prefix = 'localization-package') {
  const files = [];
  for (const loc of locales) {
    files.push({ path: `${prefix}/locales/${loc.locale}.json`, content: loc.content });
  }
  // Only licensed-and-packagable fonts could ever add a binary here. The MVP
  // catalog has none, so fonts/ holds a README instead of fabricated assets.
  const fontRecords = fontConfigs.map((fc) => fc.font).filter(Boolean);
  files.push({ path: `${prefix}/fonts/README.md`, content: buildFontsReadme(fontRecords, cfg) });

  const styles = [];
  for (const fc of fontConfigs) {
    const css = fc.config.css;
    files.push({ path: `${prefix}/styles/${fc.config.filename}`, content: css });
    styles.push(fc.config.filename);
  }
  if (styles.length) {
    // One aggregate entry point that @imports only the selected locales.
    const agg = [
      `/* font-config.css — aggregate for selected locales only */`,
      ...styles.map((s) => `@import url('./${s}');`),
      ``,
    ].join('\n');
    files.push({ path: `${prefix}/styles/font-config.css`, content: agg });
  }

  if (manifest) {
    files.push({ path: `${prefix}/translation-manifest.json`, content: JSON.stringify(manifest, null, 2) + '\n' });
  }

  const readme = [
    `# localization-package`,
    ``,
    `Generated by L10N ASSISTANT. Translation files and font resources are`,
    `deliberately SEPARATE: locales/ holds JSON, styles/ holds CSS config,`,
    `fonts/ holds only assets whose license permits redistribution.`,
    ``,
    `## Contents`,
    `- locales/<lang>.json — translated locale files (structure preserved)`,
    `- styles/font-config*.css — CSS for the selected target locale(s) only`,
    `- fonts/README.md — license, source and official download links`,
    ...(manifest ? ['- translation-manifest.json — which strings were translated within the Free quota'] : []),
    ``,
    `## Integration`,
    ...(fontConfigs[0] ? fontConfigs[0].config.integration.split('\n') : ['No font configuration selected; JSON download only.']),
    ``,
    `## Honest limits`,
    `- Website URL extraction is NOT your project source code and is NOT a full-site crawl.`,
    `- The generated JSON is a neutral standard shape, not a guarantee of compatibility with any i18n framework.`,
    `- Strings beyond the Free quota are left as ORIGINAL SOURCE TEXT; see translation-manifest.json.`,
    `- AI translation is not a substitute for professional human review.`,
    ``,
    (cfg.commerce && cfg.commerce.quoteNote) || 'Pricing is quoted separately.',
    ``,
  ].join('\n');
  files.push({ path: `${prefix}/README.md`, content: readme });
  return files;
}

module.exports = {
  normalizeLocale, requiredScripts, covers, licenseAllows, publicFont,
  recommend, findFont, buildConfigCss, buildFontsReadme, buildLocalizationPackage,
};

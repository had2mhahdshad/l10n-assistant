'use strict';
// HTML text extraction + language-version discovery (hreflang, switchers,
// common language path prefixes). Static parsing only — no JS execution.

const cheerio = require('cheerio');
const { URL } = require('url');

const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'de', 'fr'];
const LANG_NAMES = {
  en: 'English', zh: 'Chinese (Simplified)', 'zh-CN': 'Chinese (Simplified)',
  ja: 'Japanese', de: 'German', fr: 'French',
};

const SKIP_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe'];

/**
 * Extract visible UI text segments from an HTML page.
 * Returns [{ text, tag, context, path }] — `path` is a structural DOM path
 * (tag + sibling index) used to align source/target segments across locales.
 */
function extractTextSegments(html) {
  const $ = cheerio.load(html);
  $(SKIP_TAGS.join(',')).remove();
  const segments = [];
  const seen = new Set();

  function domPath(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.type === 'tag' && depth < 12) {
      const tag = node.tagName.toLowerCase();
      let idx = 1;
      let sib = node.prev;
      while (sib) {
        if (sib.type === 'tag' && sib.tagName === node.tagName) idx++;
        sib = sib.prev;
      }
      parts.unshift(`${tag}:${idx}`);
      node = node.parent;
      depth++;
    }
    return parts.join('>');
  }

  $('body *').each((_, el) => {
    const $el = $(el);
    const basePath = domPath(el);
    // Only elements that directly contain text (avoid double counting parents).
    const directText = $el.contents()
      .filter((__, n) => n.type === 'text')
      .map((__, n) => n.data)
      .get()
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (directText && directText.length >= 2 && /[\p{L}]/u.test(directText)) {
      const tag = el.tagName ? el.tagName.toLowerCase() : 'span';
      const key = `${tag}:${directText}`;
      if (!seen.has(key) && segments.length < 500) {
        seen.add(key);
        segments.push({ text: directText, tag, context: tag, path: basePath });
      }
    }
    // Attributes that commonly carry UI copy.
    for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = ($el.attr(attr) || '').trim();
      if (v && v.length >= 2 && /[\p{L}]/u.test(v)) {
        const key = `@${attr}:${v}`;
        if (!seen.has(key) && segments.length < 500) {
          seen.add(key);
          const tag = el.tagName?.toLowerCase() || 'attr';
          segments.push({ text: v, tag, context: `${tag}[@${attr}]`, path: `${basePath}@${attr}` });
        }
      }
    }
  });

  const title = ($('title').first().text() || '').trim();
  if (title) segments.unshift({ text: title, tag: 'title', context: 'title' });
  const metaDesc = ($('meta[name="description"]').attr('content') || '').trim();
  if (metaDesc) segments.push({ text: metaDesc, tag: 'meta', context: 'meta[name=description]' });

  return segments;
}

/** Parse <html lang>, hreflang alternates, and og:locale. */
function extractLanguageInfo(html, pageUrl) {
  const $ = cheerio.load(html);
  const htmlLang = ($('html').attr('lang') || $('html').attr('xml:lang') || '').trim() || null;

  const hreflangs = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hreflang = ($(el).attr('hreflang') || '').trim();
    const href = ($(el).attr('href') || '').trim();
    if (hreflang && href) {
      try {
        hreflangs.push({ lang: hreflang, url: new URL(href, pageUrl).toString() });
      } catch { /* skip */ }
    }
  });

  // Heuristic language-switcher links: /ja/..., /de/..., ?lang=fr etc.
  const switcher = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;
    try {
      const abs = new URL(href, pageUrl);
      const m = abs.pathname.match(/^\/(en|zh(?:-CN)?|ja|de|fr)(?=\/|$)/i);
      const q = abs.searchParams.get('lang') || abs.searchParams.get('locale');
      const lang = m ? m[1] : (q && SUPPORTED_LANGS.includes(q.toLowerCase()) ? q : null);
      if (lang) switcher.push({ lang, url: abs.toString() });
    } catch { /* skip */ }
  });

  return { htmlLang, hreflangs, switcher };
}

/**
 * Discover the URL of the target-language version of a page.
 * Priority: hreflang > language switcher > nothing (never guess).
 */
function discoverTargetUrl(html, pageUrl, targetLang) {
  const norm = (l) => (l || '').toLowerCase().split('-')[0];
  const want = norm(targetLang);
  const info = extractLanguageInfo(html, pageUrl);

  const fromHreflang = info.hreflangs.find((h) => norm(h.lang) === want);
  if (fromHreflang) return { url: fromHreflang.url, via: 'hreflang', info };

  const fromSwitcher = info.switcher.find((s) => norm(s.lang) === want);
  if (fromSwitcher) return { url: fromSwitcher.url, via: 'language-switcher', info };

  return { url: null, via: null, info };
}

/**
 * Inventory page content that CANNOT be covered by text-based translation.
 * These elements are either non-text (images, canvas, video), isolated
 * documents (iframes), or explicitly opted out (translate="no", .notranslate).
 * The checker must surface them honestly instead of silently skipping them.
 */
function extractNonTranslatable(html) {
  const $ = cheerio.load(html);
  const images = $('img').get();
  return {
    images: images.length,
    imagesWithoutAlt: images.filter((el) => !($(el).attr('alt') || '').trim()).length,
    iframes: $('iframe').length,
    canvas: $('canvas').length,
    videos: $('video, audio').length,
    svgs: $('svg').length,
    noTranslateMarked: $('[translate="no"], .notranslate').length,
  };
}

function mergeNonTranslatable(list) {
  const total = { images: 0, imagesWithoutAlt: 0, iframes: 0, canvas: 0, videos: 0, svgs: 0, noTranslateMarked: 0 };
  for (const item of list) {
    if (!item) continue;
    for (const k of Object.keys(total)) total[k] += item[k] || 0;
  }
  return total;
}

module.exports = { extractTextSegments, extractLanguageInfo, discoverTargetUrl, extractNonTranslatable, mergeNonTranslatable, SUPPORTED_LANGS, LANG_NAMES };

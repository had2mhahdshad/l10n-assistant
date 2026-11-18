'use strict';
// Website URL → normalised source JSON for AI Translation.
//
// Honesty contract (surfaced verbatim in the API/UI):
//   - Only publicly accessible pages within the page limit are fetched.
//   - This is TEXT EXTRACTION from rendered HTML, NOT recovery of the
//     project's source code or its original i18n resource files.
//   - The generated JSON is a neutral standard shape; it is NOT guaranteed
//     to be compatible with any specific i18n framework.
//   - Non-text content (images, canvas, video, iframes, translate="no")
//     is inventoried separately and never translated.

const cheerio = require('cheerio');
const { crawl, validateUrl } = require('./scanner');
const { extractTextSegments, extractNonTranslatable, mergeNonTranslatable } = require('./extractor');
const config = require('../config');

/** Strip nodes the site explicitly asked not to translate before extraction. */
function stripNoTranslate(html) {
  const $ = cheerio.load(html);
  $('[translate="no"], .notranslate, [data-no-translate="true"]').remove();
  return $.html();
}

/**
 * @param {string} startUrl
 * @param {object} opts { maxPages }
 * @returns {Promise<{ json, meta }>}
 */
async function urlToJson(startUrl, opts = {}) {
  const maxPages = Math.max(1, Math.min(opts.maxPages || 3, config.scan.maxPages));

  // SSRF validation happens before any network I/O (crawl re-validates each
  // hop too; this first check gives a clean client-facing error).
  const check = await validateUrl(startUrl);
  if (!check.ok) {
    const err = new Error(`URL rejected by security policy: ${check.reason}`);
    err.status = 400;
    err.clientMessage = `This URL cannot be scanned (${check.reason}). Only publicly accessible http(s) pages are supported.`;
    throw err;
  }

  const result = await crawl(startUrl, {
    maxPages,
    maxDepth: 1,
    sameOriginOnly: config.scan.sameOriginOnly,
    timeoutMs: config.scan.timeoutMs,
    maxBodyBytes: config.scan.maxBodyBytes,
    userAgent: config.scan.userAgent,
  });

  if (!result.pages.length) {
    const err = new Error('No accessible HTML pages could be scanned.');
    err.status = 422;
    err.clientMessage = 'No publicly accessible HTML page could be scanned at this URL. Check the address or upload a JSON file instead.';
    throw err;
  }

  const pages = [];
  const nonTranslatableList = [];
  let segmentCount = 0;

  for (let i = 0; i < result.pages.length; i++) {
    const page = result.pages[i];
    const cleanHtml = stripNoTranslate(page.html);
    const segments = extractTextSegments(cleanHtml);
    nonTranslatableList.push(extractNonTranslatable(page.html));

    const segmentMap = {};
    segments.forEach((seg, j) => {
      // Stable, order-preserving keys. Cheerio already de-duplicates by
      // tag+text; this suffix keeps every extracted string addressable.
      segmentMap[`s_${String(j + 1).padStart(4, '0')}`] = seg.text;
    });
    segmentCount += segments.length;

    pages.push({
      // `url` is deliberately kept: jsonParser classifies it as non-translatable
      // (url$ key hint + http(s) value), so it survives export untouched.
      url: page.url,
      segments: segmentMap,
    });
  }

  const json = { pages };

  const meta = {
    startUrl,
    scannedPages: result.pages.length,
    failedPages: result.failed.length,
    discoveredPages: result.coverage.discoveredPages,
    maxPages,
    maxDepth: 1,
    segmentCount,
    nonTranslatable: mergeNonTranslatable(nonTranslatableList),
    failed: result.failed,
    // Structured limitation keys — copy is localised by the route, never here.
    limitations: [
      'url.notFullSite',
      'url.notSourceCode',
      'url.frameworkCompat',
      'url.pageLimit',
    ],
    // Machine-readable flags for the front end.
    complete: false,
    isSourceCode: false,
    frameworkCompatibleGuarantee: false,
  };

  return { json, meta };
}

module.exports = { urlToJson, stripNoTranslate };

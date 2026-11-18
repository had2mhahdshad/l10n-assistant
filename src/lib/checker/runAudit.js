'use strict';
// Localization Checker engine.
//
// Two independent entry modes:
//   1. website — crawl publicly accessible pages within limits
//   2. json    — full content audit on user-uploaded locale JSON
//
// Honesty contract (enforced here):
//   - never claims whole-site coverage
//   - dimensions without enough data => Not Evaluated (null), never free 100
//   - UI length findings are estimates, labeled as such
//   - free report shows full issue COUNTS but only a configurable number of
//     complete examples; never ships full fixed translations

const { crawl, safeFetch, validateUrl } = require('../scanner');
const { extractTextSegments, discoverTargetUrl, extractNonTranslatable, mergeNonTranslatable } = require('../extractor');
const rules = require('./rules');
const { computeScore, severityDistribution, typeDistribution } = require('./scorer');
const { reviewPairs } = require('../ai/translate');
const { parseTranslatable, verifyStructure } = require('../jsonParser');
const { isResidue, detectLanguage } = require('../languageDetect');

/**
 * Run a website audit. Throws with .clientMessage for user-facing errors.
 */
async function runWebsiteAudit({ websiteUrl, targetUrl, sourceLanguage, targetLanguage }, db, jobId) {
  const v = await validateUrl(websiteUrl);
  if (!v.ok) throw clientError(`The URL could not be scanned (${v.reason}). Only publicly accessible http(s) pages are supported.`);

  // 1. Crawl source site within limits.
  const result = await crawl(websiteUrl, {});
  if (result.pages.length === 0) {
    throw clientError(`No publicly accessible pages could be fetched from ${websiteUrl}. ${result.failed[0] ? `First error: ${result.failed[0].error}` : ''}`);
  }

  // 2. Resolve target-language version.
  let resolvedTargetUrl = targetUrl || null;
  let targetVia = targetUrl ? 'user-provided' : null;
  if (!resolvedTargetUrl) {
    const discovery = discoverTargetUrl(result.pages[0].html, result.pages[0].url, targetLanguage);
    if (discovery.url) {
      resolvedTargetUrl = discovery.url;
      targetVia = discovery.via;
    } else {
      // Do NOT assume a target version exists.
      throw clientError(
        'Could not auto-detect a ' + targetLanguage + ' version of this site (checked hreflang and language switchers). ' +
        'Please provide the target-language URL explicitly, or use "Upload JSON for a Complete Content Audit".',
        { needsTargetUrl: true, coverage: result.coverage }
      );
    }
  }

  // 3. Fetch target page(s). Mirror same-origin crawl for target if it shares
  // the source origin (common for /ja/ style routing); otherwise fetch single page.
  const targetCheck = await validateUrl(resolvedTargetUrl);
  if (!targetCheck.ok) throw clientError(`Target language URL could not be scanned (${targetCheck.reason}).`);

  let targetPages;
  if (sameHost(websiteUrl, resolvedTargetUrl)) {
    const t = await crawl(resolvedTargetUrl, { maxPages: Math.max(1, result.pages.length) });
    targetPages = t.pages;
  } else {
    const res = await safeFetch(resolvedTargetUrl, {});
    targetPages = res.html ? [{ url: res.finalUrl || resolvedTargetUrl, status: res.status, html: res.html, links: [], depth: 0 }] : [];
    if (res.error) {
      throw clientError(`Target language page is not accessible (${res.error}). Provide a publicly accessible target URL.`);
    }
  }

  // 4. Extract segments.
  const srcSegments = result.pages.flatMap((p) =>
    extractTextSegments(p.html).map((s) => ({ ...s, pageUrl: p.url })));
  const tgtSegments = targetPages.flatMap((p) =>
    extractTextSegments(p.html).map((s) => ({ ...s, pageUrl: p.url })));

  // 5. Align segments by DOM structure. Only credible alignments yield pairs;
  // pairwise dimensions stay Not Evaluated when alignment is not possible.
  const { pairs, alignedPages } = buildPairs(result.pages, targetPages);
  const pairsUsable = alignedPages >= 1 && pairs.length >= 5;
  const evaluated = {
    accuracy: pairsUsable,
    naturalness: tgtSegments.length >= 5,
    terminology: pairsUsable,
    placeholders: true, // syntax sanity can always run on target segments
    uiLength: pairsUsable,
  };

  // 6. Rule checks.
  let issues = [];
  issues = issues.concat(rules.checkMissingTranslation(tgtSegments, sourceLanguage, targetLanguage));
  issues = issues.concat(checkPlaceholderSyntax(tgtSegments));

  // Alignment confidence guard: pairwise rules are only trustworthy when a
  // plausible share of aligned pairs is flagged. If nearly everything is
  // "wrong", the pages are not truly corresponding — report Not Evaluated
  // instead of a misleading wall of false positives.
  const notes = [];
  const density = (list) => (pairs.length ? list.length / pairs.length : 0);

  if (evaluated.terminology) {
    const termIssues = rules.checkTerminologyConsistency(pairs);
    if (density(termIssues) > 0.25) {
      evaluated.terminology = false;
      notes.push('Terminology consistency marked Not Evaluated: source/target page structures do not align closely enough for a reliable cross-page comparison.');
    } else issues = issues.concat(termIssues);
  }
  if (evaluated.uiLength) {
    const lenIssues = rules.checkUiLengthRisk(pairs, targetLanguage);
    if (density(lenIssues) > 0.4) {
      evaluated.uiLength = false;
      notes.push('UI length risk marked Not Evaluated: too many aligned pairs show implausible expansion, indicating unreliable segment alignment rather than genuine overflow risk.');
    } else issues = issues.concat(lenIssues);
  }
  issues = issues.concat(rules.checkCultural(pairs.length ? pairs : tgtSegments.map((s) => ({ source: '', translation: s.text, pageUrl: s.pageUrl })), targetLanguage));

  // 7. AI review.
  //    - with pairs: semantic accuracy + naturalness review on a sample
  //    - without pairs: standalone naturalness review of target segments
  let aiDegraded = false;
  const samplePairs = sample(pairs, 30);
  if (samplePairs.length >= 1 && evaluated.accuracy) {
    const r = await reviewPairs(samplePairs.map((p, i) => ({ id: i, source: p.source, translation: p.translation, pageUrl: p.pageUrl })), { sourceLang: sourceLanguage, targetLang: targetLanguage });
    aiDegraded = aiDegraded || r.degraded;
    if (!r.degraded && r.issues.length / samplePairs.length > 0.6) {
      evaluated.accuracy = false;
      notes.push('Translation accuracy marked Not Evaluated: the AI reviewer flagged an implausible share of the aligned sample, which usually means the page pairs do not correspond.');
    } else {
      issues = issues.concat(r.issues.map((it) => ({ ...it, pageUrl: samplePairs[Number(String(it.id).replace('ai-', '')) - 1]?.pageUrl || it.pageUrl })));
    }
  } else if (evaluated.naturalness) {
    const tgtSample = sample(tgtSegments.filter((s) => detectLanguage(s.text).lang === norm(targetLanguage)), 25);
    if (tgtSample.length) {
      const r = await reviewPairs(tgtSample.map((s, i) => ({ id: i, source: '(standalone target-language text)', translation: s.text, pageUrl: s.pageUrl })), { sourceLang: sourceLanguage, targetLang: targetLanguage });
      aiDegraded = aiDegraded || r.degraded;
      issues = issues.concat(r.issues);
    } else {
      evaluated.naturalness = false;
    }
  }
  if (aiDegraded) {
    // AI unavailable: never hand out free perfect scores for AI dimensions.
    evaluated.accuracy = false;
    evaluated.naturalness = false;
  }

  const sampleSize = tgtSegments.length;
  const score = computeScore(issues, evaluated, {
    accuracy: pairs.length,
    naturalness: tgtSegments.length,
    terminology: pairs.length,
    placeholders: tgtSegments.length,
    uiLength: pairs.length,
    default: Math.max(sampleSize, 1),
  });

  // Content that text-based translation can never cover (images, iframes…).
  const nonTranslatable = mergeNonTranslatable(
    result.pages.map((p) => extractNonTranslatable(p.html || ''))
  );

  return {
    scannedPages: result.pages.length,
    failedPages: result.failed.length,
    discoveredPages: result.coverage.discoveredPages,
    failedList: result.failed,
    coverageNote: result.coverage.note + (notes.length ? ' ' + notes.join(' ') : ''),
    targetUrl: resolvedTargetUrl,
    targetVia,
    sampleSize,
    issues,
    score,
    nonTranslatable,
  };
}

/**
 * Run a JSON content audit (complete content check on uploaded files).
 * scope note: validates file CONTENT, not the live rendered website.
 */
async function runJsonAudit({ sourceJson, targetJson, sourceLanguage, targetLanguage }) {
  const sourceEntries = parseTranslatable(sourceJson).filter((e) => e.type === 'string');
  const srcStrings = sourceEntries.filter((e) => e.translatable);

  let pairs = [];
  let structuralProblems = [];
  if (targetJson) {
    structuralProblems = verifyStructure(sourceJson, targetJson);
    const targetEntries = parseTranslatable(targetJson).filter((e) => e.type === 'string');
    const mapT = new Map(targetEntries.map((e) => [e.key, e.value]));
    pairs = srcStrings.map((e) => ({ source: e.value, translation: mapT.get(e.key) ?? '', pageUrl: '(uploaded JSON)', context: e.key }));
  }

  const evaluated = {
    accuracy: !!targetJson && pairs.length > 0,
    naturalness: true,
    terminology: pairs.length > 0,
    placeholders: true,
    uiLength: pairs.length > 0,
  };

  let issues = [];
  // residue / missing translation within target file
  if (targetJson) {
    for (const p of pairs) {
      if (!p.translation.trim()) {
        issues.push({ id: `rule-mt-${p.context}`, source: 'rule', issueType: 'missing_translation', severity: 'high', sourceText: p.source, currentTranslation: '', context: p.context, suggestion: 'No translation exists for this key.' });
      } else if (isResidue(p.translation, sourceLanguage, targetLanguage)) {
        issues.push({ id: `rule-res-${p.context}`, source: 'rule', issueType: 'missing_translation', severity: 'high', sourceText: p.source, currentTranslation: p.translation, context: p.context, suggestion: 'This value still appears to be in the source language.' });
      }
    }
    issues = issues.concat(rules.checkPlaceholderIntegrity(pairs));
    issues = issues.concat(rules.checkTerminologyConsistency(pairs));
    issues = issues.concat(rules.checkUiLengthRisk(pairs, targetLanguage));
    issues = issues.concat(rules.checkCultural(pairs, targetLanguage));
    for (const p of structuralProblems) {
      issues.push({ id: `rule-struct-${p.path}`, source: 'rule', issueType: 'placeholder', severity: 'high', context: p.path, suggestion: `Structure problem: ${p.type}`, reason: JSON.stringify(p) });
    }
  } else {
    // single-file audit: residue in target language file (user uploads their
    // localized file) — check for leftover source-language strings.
    const residueSegs = srcStrings.filter((e) => isResidue(e.value, sourceLanguage, targetLanguage));
    for (const e of residueSegs) {
      issues.push({ id: `rule-res2-${e.key}`, source: 'rule', issueType: 'missing_translation', severity: 'high', sourceText: e.value, currentTranslation: e.value, context: e.key, suggestion: 'This string still appears to be in the source language.' });
    }
    evaluated.terminology = false;
    evaluated.uiLength = false;
    evaluated.accuracy = false;
  }

  // AI review on sample.
  let aiDegraded = false;
  if (evaluated.accuracy && pairs.length) {
    const r = await reviewPairs(sample(pairs, 30).map((p, i) => ({ id: i, source: p.source, translation: p.translation })), { sourceLang: sourceLanguage, targetLang: targetLanguage });
    aiDegraded = r.degraded;
    issues = issues.concat(r.issues);
  } else if (!targetJson) {
    const tgtSample = sample(srcStrings.filter((e) => detectLanguage(e.value).lang === norm(targetLanguage)), 25);
    if (tgtSample.length) {
      const r = await reviewPairs(tgtSample.map((s, i) => ({ id: i, source: '(standalone target-language text)', translation: s.value })), { sourceLang: sourceLanguage, targetLang: targetLanguage });
      aiDegraded = r.degraded;
      issues = issues.concat(r.issues);
    } else {
      evaluated.naturalness = false;
    }
  }
  if (aiDegraded) { evaluated.accuracy = false; evaluated.naturalness = false; }

  const sampleSize = targetJson ? pairs.length : srcStrings.length;
  const score = computeScore(issues, evaluated, {
    accuracy: pairs.length,
    naturalness: sampleSize,
    terminology: pairs.length,
    placeholders: Math.max(pairs.length, srcStrings.length),
    uiLength: pairs.length,
    default: Math.max(sampleSize, 1),
  });

  return {
    scannedPages: 0,
    failedPages: 0,
    discoveredPages: 0,
    failedList: [],
    coverageNote: 'JSON content audit covers the uploaded file(s) only. It does not verify the actual rendered website layout.',
    targetUrl: null,
    targetVia: 'json-upload',
    sampleSize,
    issues,
    score,
    nonTranslatable: null, // uploaded JSON is pure text — everything is translatable
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

/**
 * Align source/target segments by identical DOM path (tag + sibling index).
 * Only structurally corresponding nodes are paired — a page pair with too few
 * aligned nodes is discarded entirely rather than guessed at, because
 * misaligned pairs would produce misleading "issues".
 */
function buildPairs(sourcePages, targetPages) {
  const pairs = [];
  const seenSource = new Set();
  let alignedPages = 0;

  const count = Math.min(sourcePages.length, targetPages.length);
  for (let i = 0; i < count; i++) {
    const a = new Map(extractTextSegments(sourcePages[i].html).map((s) => [s.path, s]));
    const b = extractTextSegments(targetPages[i].html);
    let aligned = 0;
    const pagePairs = [];
    for (const tb of b) {
      const sa = a.get(tb.path);
      if (!sa) continue;
      aligned++;
      pagePairs.push({
        source: sa.text,
        translation: tb.text,
        pageUrl: targetPages[i].url,
        context: tb.context,
      });
    }
    // Credibility gate: require a minimum absolute and relative alignment.
    const share = b.length ? aligned / b.length : 0;
    if (aligned < 5 || share < 0.5) continue;
    alignedPages++;
    for (const p of pagePairs) {
      // De-duplicate exact repeats (nav/footer copy) but KEEP cases where the
      // same source text got different translations — that is real signal for
      // the terminology consistency check.
      const k = `${p.source.trim().toLowerCase()}||${p.translation.trim().toLowerCase()}`;
      if (seenSource.has(k)) continue;
      seenSource.add(k);
      pairs.push(p);
    }
  }
  return { pairs, alignedPages };
}

function checkPlaceholderSyntax(segments) {
  const issues = [];
  for (const s of segments) {
    const t = s.text;
    const open = (t.match(/\{/g) || []).length;
    const close = (t.match(/\}/g) || []).length;
    if (open !== close) {
      issues.push({
        id: `rule-phs-${issues.length}`, source: 'rule', issueType: 'placeholder', severity: 'medium',
        currentTranslation: t, pageUrl: s.pageUrl, context: s.context,
        suggestion: 'Unbalanced braces detected — a template variable may be broken in the rendered page.',
      });
    }
    if (/__PH_\d+__/.test(t)) {
      issues.push({
        id: `rule-phl-${issues.length}`, source: 'rule', issueType: 'placeholder', severity: 'high',
        currentTranslation: t, pageUrl: s.pageUrl, context: s.context,
        suggestion: 'Raw placeholder sentinel leaked into visible page text.',
      });
    }
  }
  return issues;
}

function sample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function norm(l) { return (l || '').toLowerCase().split('-')[0]; }
function sameHost(a, b) { try { return new URL(a).host === new URL(b).host; } catch { return false; } }

function clientError(message, extra = {}) {
  const e = new Error(message);
  e.clientMessage = message;
  e.status = 422;
  Object.assign(e, extra);
  return e;
}

module.exports = { runWebsiteAudit, runJsonAudit, severityDistribution, typeDistribution };

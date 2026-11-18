'use strict';
// Deterministic rule-based localization checks.
// Each check returns issues: { issueType, severity, sourceText?, currentTranslation?, suggestion?, pageUrl?, context? }

const { isResidue, detectLanguage } = require('../languageDetect');
const { verifyPlaceholders, verifyHtml, verifyUrls } = require('../placeholder');

let seq = 0;
function issue(fields) {
  return { id: `rule-${++seq}`, source: 'rule', ...fields };
}

/**
 * A. Missing translation — target page segments still in source language.
 * Attribute-only text (alt/title) is downgraded: it is a genuine gap but far
 * less visible than untranslated navigation or buttons.
 * @param segmentsTarget [{text, context, pageUrl}]
 */
function looksLikeUiCopy(text) {
  const t = String(text).trim();
  if (t.length < 4) return false;
  if (/^[\w.+-]+@[\w-]+/.test(t)) return false;
  // URL / path fragments and domain-like junk scraped from breadcrumbs
  if (/https?:\/\//i.test(t)) return false;
  if (/\b[\w-]+\.(com|net|org|io|co|jp|de|fr|cn)\b/i.test(t)) return false;
  if (/^[\w./-]+\/[\w./-]*$/.test(t)) return false;
  if (/^[\d\s.,:;|/\\-]+$/.test(t)) return false;
  return true;
}

function isAttributeContext(context) {
  return /\[@(alt|title|aria-label|placeholder)\]$/i.test(String(context || ''));
}

function checkMissingTranslation(segmentsTarget, sourceLang, targetLang) {
  const issues = [];
  for (const seg of segmentsTarget) {
    if (!looksLikeUiCopy(seg.text)) continue;
    if (isResidue(seg.text, sourceLang, targetLang)) {
      const attr = isAttributeContext(seg.context);
      issues.push(issue({
        issueType: 'missing_translation',
        severity: attr ? 'low' : 'high',
        currentTranslation: seg.text,
        context: seg.context,
        pageUrl: seg.pageUrl,
        suggestion: attr
          ? 'Non-visible text (alt/title) is still in the source language — accessibility and SEO impact only.'
          : 'This text still appears in the source language and likely was never translated.',
      }));
    }
  }
  return issues;
}

/**
 * D. Terminology consistency — same source term translated differently.
 * @param pairs [{source, translation, pageUrl}]
 */
function checkTerminologyConsistency(pairs) {
  const issues = [];
  const norm = (s) => String(s).trim().toLowerCase();
  const bySource = new Map();
  for (const p of pairs) {
    const k = norm(p.source);
    if (!k || k.length < 3) continue;
    if (!bySource.has(k)) bySource.set(k, new Map());
    const variants = bySource.get(k);
    const t = norm(p.translation);
    if (!variants.has(t)) variants.set(t, []);
    variants.get(t).push(p);
  }
  for (const [source, variants] of bySource) {
    if (variants.size > 1) {
      const renderings = [...variants.keys()];
      issues.push(issue({
        issueType: 'terminology',
        severity: 'medium',
        sourceText: [...variants.values()][0][0].source,
        currentTranslation: renderings.join('  /  '),
        suggestion: `The same source text is translated ${variants.size} different ways across pages. Pick one canonical rendering.`,
      }));
    }
  }
  return issues;
}

/**
 * E. Placeholder / HTML / URL integrity on translation pairs.
 */
function checkPlaceholderIntegrity(pairs) {
  const issues = [];
  for (const p of pairs) {
    const vph = verifyPlaceholders(p.source, p.translation);
    if (!vph.ok) {
      issues.push(issue({
        issueType: 'placeholder',
        severity: 'high',
        sourceText: p.source,
        currentTranslation: p.translation,
        pageUrl: p.pageUrl,
        suggestion: vph.missing.length
          ? `Dynamic variables lost in translation: ${vph.missing.join(', ')}`
          : `Unexpected variables introduced: ${vph.extra.join(', ')}`,
      }));
    }
    const vh = verifyHtml(p.source, p.translation);
    if (!vh.ok) {
      issues.push(issue({
        issueType: 'html_integrity',
        severity: 'high',
        sourceText: p.source,
        currentTranslation: p.translation,
        pageUrl: p.pageUrl,
        suggestion: 'HTML tag structure differs between source and translation — markup may be broken.',
      }));
    }
    const vu = verifyUrls(p.source, p.translation);
    if (!vu.ok) {
      issues.push(issue({
        issueType: 'url_change',
        severity: 'medium',
        sourceText: p.source,
        currentTranslation: p.translation,
        pageUrl: p.pageUrl,
        suggestion: `URLs changed in translation: ${[...vu.changed, ...vu.added].join(', ')}`,
      }));
    }
  }
  return issues;
}

/**
 * F. UI length risk — ESTIMATION ONLY. Text length expansion ratio per
 * language family. Never presented as real render verification.
 */
const EXPANSION_THRESHOLD = { ja: 1.6, de: 1.35, fr: 1.35, default: 1.5 };
const SHORT_UI_TAGS = new Set(['button', 'a', 'label', 'title', 'h1', 'h2', 'h3', 'th', 'option']);

function checkUiLengthRisk(pairs, targetLang) {
  const issues = [];
  const norm = (l) => (l || '').toLowerCase().split('-')[0];
  const threshold = EXPANSION_THRESHOLD[norm(targetLang)] || EXPANSION_THRESHOLD.default;
  for (const p of pairs) {
    const src = String(p.source || '');
    const dst = String(p.translation || '');
    if (!src || !dst) continue;
    // visual width estimate: CJK chars count ~2x latin width
    const width = (s) => [...s].reduce((w, c) => w + (/[⺀-鿿豈-﫿＀-￯]/.test(c) ? 2 : 1), 0);
    const ratio = width(dst) / Math.max(1, width(src));
    const isShortUi = p.context && SHORT_UI_TAGS.has(String(p.context).toLowerCase());
    if ((isShortUi && ratio > threshold * 0.8) || ratio > threshold) {
      issues.push(issue({
        issueType: 'ui_length',
        severity: ratio > threshold * 1.4 ? 'medium' : 'low',
        sourceText: src,
        currentTranslation: dst,
        pageUrl: p.pageUrl,
        context: p.context,
        suggestion: `Text expands ~${Math.round(ratio * 100)}% vs source (risk estimate only — not a rendering test). Check for overflow in ${isShortUi ? 'compact UI elements' : 'layouts'}.`,
      }));
    }
  }
  return issues;
}

/**
 * G. Cultural localization — date/number/currency formats, units.
 */
const CULTURAL_PATTERNS = [
  { re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, kind: 'US-style date (MM/DD/YYYY)', severity: 'low' },
  { re: /\$\s?\d/, kind: 'US dollar amount — confirm intended currency', severity: 'low' },
  { re: /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, kind: '12-hour clock format', severity: 'low' },
  { re: /\b\d+(\.\d+)?\s?(ft|feet|inch(?:es)?|mi|miles|lb|lbs|oz)\b/i, kind: 'imperial units', severity: 'low' },
];

function checkCultural(pairs, targetLang) {
  const issues = [];
  const norm = (l) => (l || '').toLowerCase().split('-')[0];
  const tgt = norm(targetLang);
  if (!['ja', 'de', 'fr', 'zh'].includes(tgt)) return issues;
  for (const p of pairs) {
    const text = String(p.translation || '');
    for (const c of CULTURAL_PATTERNS) {
      if (c.re.test(text)) {
        issues.push(issue({
          issueType: 'cultural',
          severity: c.severity,
          sourceText: p.source,
          currentTranslation: text,
          pageUrl: p.pageUrl,
          suggestion: `Possible localization gap: ${c.kind} found in ${tgt} content. Verify format matches target market conventions.`,
        }));
        break; // one cultural flag per segment is enough
      }
    }
  }
  return issues;
}

module.exports = {
  checkMissingTranslation,
  checkTerminologyConsistency,
  checkPlaceholderIntegrity,
  checkUiLengthRisk,
  checkCultural,
};

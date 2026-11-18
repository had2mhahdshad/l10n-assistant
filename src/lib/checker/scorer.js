'use strict';
// Localization Quality Score — 0..100, weighted across five dimensions.
//
//   Translation Accuracy   30%   (AI semantic review + rule-based gaps)
//   Naturalness            25%   (AI semantic review)
//   Terminology            15%   (rule-based + glossary)
//   Placeholder Integrity  20%   (programmatic, rule-based)
//   UI Length Risk         10%   (rule-based estimation)
//
// Scoring model — issue RATE based, not raw issue count, so a large site with
// 18 problems in 2,900 samples is not scored like a small file with 18 of 20:
//
//   weightedIssues = high×1 + medium×0.5 + low×0.25
//   rate           = weightedIssues / samples(dimension)
//   penalty        = min(100, rate × 200 + min(15, weightedIssues × 1.5))
//   score          = max(0, 100 − penalty)
//
// Rules:
//   - Dimensions without enough data are null ("Not Evaluated") — never a
//     default perfect score.
//   - The overall score renormalizes weights over evaluated dimensions only.
//   - The score is an assistive reference, NOT a professional review verdict.

const DIMENSIONS = {
  accuracy: { weight: 0.30, label: 'Translation Accuracy' },
  naturalness: { weight: 0.25, label: 'Naturalness' },
  terminology: { weight: 0.15, label: 'Terminology' },
  placeholders: { weight: 0.20, label: 'Placeholder Integrity' },
  uiLength: { weight: 0.10, label: 'UI Length Risk' },
};

const SEVERITY_WEIGHT = { high: 1, medium: 0.5, low: 0.25 };

// Model constants (exported so tests assert the documented behaviour).
const SCORE_MODEL = { rateFactor: 200, countUnit: 1.5, absoluteCap: 15 };

// Map issue types to dimensions.
const ISSUE_DIMENSION = {
  missing_translation: 'accuracy',
  semantic_error: 'accuracy',
  grammar: 'naturalness',
  unnatural: 'naturalness',
  spelling: 'naturalness',
  terminology: 'terminology',
  placeholder: 'placeholders',
  html_integrity: 'placeholders',
  url_change: 'placeholders',
  ui_length: 'uiLength',
  cultural: 'naturalness',
};

/**
 * @param {Array} issues  [{ issueType, severity }]
 * @param {Object} evaluated  { accuracy: bool, ... } false => Not Evaluated
 * @param {Number|Object} samples  total samples, or per-dimension counts
 *        { accuracy: 500, naturalness: 2900, terminology: 500, ... , default: n }
 */
function computeScore(issues, evaluated, samples = 0, overrides = null) {
  // Admin-configurable rules are injected as overrides; the module stays a
  // pure function so existing tests and callers keep their default behaviour.
  const dims = overrides?.dimensions || DIMENSIONS;
  const sevW = overrides?.severityWeight || SEVERITY_WEIGHT;
  const model = overrides?.model || SCORE_MODEL;
  const issueDim = overrides?.issueDimension || ISSUE_DIMENSION;

  const samplesFor = (dim) =>
    typeof samples === 'number' ? samples : (samples[dim] ?? samples.default ?? 0);

  const counts = {};
  for (const dim of Object.keys(dims)) counts[dim] = 0;

  for (const issue of issues) {
    const dim = issueDim[issue.issueType];
    if (!dim || !(dim in counts)) continue;
    counts[dim] += sevW[issue.severity] ?? sevW.low;
  }

  const dimensions = {};
  for (const [dim, meta] of Object.entries(dims)) {
    if (evaluated[dim] === false) {
      dimensions[dim] = { score: null, label: meta.label, weight: meta.weight, evaluated: false };
      continue;
    }
    const n = Math.max(1, samplesFor(dim));
    const weighted = counts[dim];
    const rate = weighted / n;
    const penalty = Math.min(
      100,
      rate * model.rateFactor + Math.min(model.absoluteCap, weighted * model.countUnit),
    );
    dimensions[dim] = {
      score: Math.max(0, Math.round(100 - penalty)),
      label: meta.label,
      weight: meta.weight,
      evaluated: true,
    };
  }

  let weightSum = 0, acc = 0;
  for (const dim of Object.keys(dimensions)) {
    const d = dimensions[dim];
    if (!d.evaluated) continue;
    weightSum += d.weight;
    acc += d.score * d.weight;
  }
  const overall = weightSum > 0 ? Math.round(acc / weightSum) : null;

  return { overall, dimensions };
}

/** Severity distribution helper. */
function severityDistribution(issues) {
  const dist = { high: 0, medium: 0, low: 0 };
  for (const i of issues) dist[i.severity] = (dist[i.severity] || 0) + 1;
  return dist;
}

/** Issue-type distribution helper. */
function typeDistribution(issues) {
  const dist = {};
  for (const i of issues) dist[i.issueType] = (dist[i.issueType] || 0) + 1;
  return dist;
}

module.exports = { computeScore, severityDistribution, typeDistribution, DIMENSIONS, ISSUE_DIMENSION, SCORE_MODEL };

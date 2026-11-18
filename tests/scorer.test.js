'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeScore, SCORE_MODEL } = require('../src/lib/checker/scorer');

const ALL_EVAL = { accuracy: true, naturalness: true, terminology: true, placeholders: true, uiLength: true };

test('no issues with full data scores 100', () => {
  const r = computeScore([], ALL_EVAL, 50);
  assert.strictEqual(r.overall, 100);
  for (const d of Object.values(r.dimensions)) assert.strictEqual(d.score, 100);
});

test('issue-rate model matches the documented formula', () => {
  const issues = [
    { issueType: 'missing_translation', severity: 'high' },  // accuracy w=1
    { issueType: 'semantic_error', severity: 'medium' },     // accuracy w=.5
    { issueType: 'terminology', severity: 'low' },           // terminology w=.25
    { issueType: 'placeholder', severity: 'high' },          // placeholders w=1
  ];
  const samples = 30;
  const r = computeScore(issues, ALL_EVAL, samples);

  const expected = (weighted) => {
    const rate = weighted / samples;
    return Math.max(0, Math.round(100 - Math.min(100, rate * SCORE_MODEL.rateFactor + Math.min(SCORE_MODEL.absoluteCap, weighted * SCORE_MODEL.countUnit))));
  };
  assert.strictEqual(r.dimensions.accuracy.score, expected(1.5));
  assert.strictEqual(r.dimensions.terminology.score, expected(0.25));
  assert.strictEqual(r.dimensions.placeholders.score, expected(1));
  assert.strictEqual(r.dimensions.naturalness.score, 100);

  // Mirror the implementation exactly, including weight renormalization.
  let weightSum = 0, acc = 0;
  for (const d of Object.values(r.dimensions)) { weightSum += d.weight; acc += d.score * d.weight; }
  assert.strictEqual(r.overall, Math.round(acc / weightSum));
});

test('large sites are not punished for small absolute issue counts', () => {
  // 18 high-severity gaps across ~2,900 inspected samples: real but minor rate.
  const issues = Array.from({ length: 18 }, () => ({ issueType: 'missing_translation', severity: 'high' }));
  const r = computeScore(issues, ALL_EVAL, { accuracy: 2900, naturalness: 2900, terminology: 2900, placeholders: 2900, uiLength: 2900 });
  assert.ok(r.dimensions.accuracy.score >= 80, `expected >= 80, got ${r.dimensions.accuracy.score}`);

  // Same 18 issues in a 20-string file must be catastrophic.
  const small = computeScore(issues, ALL_EVAL, 20);
  assert.ok(small.dimensions.accuracy.score <= 20, `expected <= 20, got ${small.dimensions.accuracy.score}`);
});

test('per-dimension sample sizes are respected', () => {
  const issues = [{ issueType: 'ui_length', severity: 'medium' }];
  const r = computeScore(issues, ALL_EVAL, { uiLength: 10, accuracy: 500, naturalness: 500, terminology: 500, placeholders: 500 });
  assert.ok(r.dimensions.uiLength.score < 95); // 1 issue in 10 length samples must cost points
  assert.strictEqual(r.dimensions.accuracy.score, 100);
});

test('unverifiable dimensions are Not Evaluated, weights renormalize', () => {
  const issues = [{ issueType: 'placeholder', severity: 'high' }];
  const r = computeScore(issues, { ...ALL_EVAL, accuracy: false, naturalness: false }, 10);
  assert.strictEqual(r.dimensions.accuracy.score, null);
  assert.strictEqual(r.dimensions.accuracy.evaluated, false);
  const ph = r.dimensions.placeholders.score;
  const expected = Math.round((100 * 0.15 + ph * 0.2 + 100 * 0.1) / 0.45);
  assert.strictEqual(r.overall, expected);
});

test('nothing evaluated gives null overall, never a free 100', () => {
  const r = computeScore([], { accuracy: false, naturalness: false, terminology: false, placeholders: false, uiLength: false }, 0);
  assert.strictEqual(r.overall, null);
});

test('severity ordering is monotonic', () => {
  const mk = (sev) => computeScore([{ issueType: 'missing_translation', severity: sev }], ALL_EVAL, 20).dimensions.accuracy.score;
  assert.ok(mk('high') < mk('medium'));
  assert.ok(mk('medium') < mk('low'));
  assert.ok(mk('low') < 100);
});

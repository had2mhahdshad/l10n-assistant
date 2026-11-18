'use strict';
// Per-job Free+Paid quota planner — pure function tests.

const test = require('node:test');
const assert = require('node:assert');
const { planQuota, snapshot } = require('../src/lib/translationQuota');

const CFG = {
  quota: { freeUrlPagesPerJob: 3, freeJsonStringsPerJob: 100, freeJsonCharsPerJob: 20000 },
  translation: { mvpUrlPageLimit: 3 },
};

const strings = (n, chars = 40) => Array.from({ length: n }, (_, i) => ({ key: 'k' + i, chars }));

test('grants strings per locale and locks the remainder', () => {
  const plan = planQuota({ sourceType: 'json', locales: ['ja', 'de'], strings: strings(150) }, CFG);
  assert.strictEqual(plan.granted.stringsPerLocale, 100);
  assert.strictEqual(plan.locked.stringsPerLocale, 50);
  assert.strictEqual(plan.usedUnits, 200);          // 100 × 2 locales, metered separately
  assert.strictEqual(plan.locked.units, 100);
  assert.strictEqual(plan.paywall, true);
  assert.strictEqual(plan.freeUnitsRemaining, 0);
  assert.strictEqual(plan.perLocale[0].grantedStrings, 100);
  assert.strictEqual(plan.perLocale[1].grantedStrings, 100);
});

test('character cap truncates independently of the string cap', () => {
  const cfg = { quota: { freeUrlPagesPerJob: 3, freeJsonStringsPerJob: 100, freeJsonCharsPerJob: 100 }, translation: { mvpUrlPageLimit: 3 } };
  const plan = planQuota({ sourceType: 'json', locales: ['ja'], strings: strings(10, 30) }, cfg);
  assert.strictEqual(plan.granted.stringsPerLocale, 3);  // 3×30=90 ≤ 100, 4×30=120 > 100
  assert.strictEqual(plan.locked.stringsPerLocale, 7);
});

test('URL page limit caps scanned pages and reports unscanned pages honestly', () => {
  const plan = planQuota({ sourceType: 'url', locales: ['ja'], strings: strings(10), pages: 2, discoveredPages: 7 }, CFG);
  assert.strictEqual(plan.granted.pages, 2);
  assert.strictEqual(plan.locked.pages, 5);
  assert.strictEqual(plan.paywall, true);
});

test('page limit never exceeds the MVP hard ceiling', () => {
  const cfg = { quota: { freeUrlPagesPerJob: 99, freeJsonStringsPerJob: 100, freeJsonCharsPerJob: 0 }, translation: { mvpUrlPageLimit: 3 } };
  const plan = planQuota({ sourceType: 'url', locales: ['ja'], strings: strings(5), pages: 50, discoveredPages: 50 }, cfg);
  assert.strictEqual(plan.limits.pages, 3);
  assert.strictEqual(plan.granted.pages, 3);
});

test('account-level cap further trims granted units only when configured', () => {
  const plan = planQuota({ sourceType: 'json', locales: ['ja'], strings: strings(10) }, { ...CFG, accountRemaining: 4 });
  assert.strictEqual(plan.usedUnits, 4);
  assert.strictEqual(plan.locked.units, 6);
});

test('small jobs inside the Free quota are fully granted (no paywall)', () => {
  const plan = planQuota({ sourceType: 'json', locales: ['ja', 'de'], strings: strings(6) }, CFG);
  assert.strictEqual(plan.paywall, false);
  assert.strictEqual(plan.locked.units, 0);
  assert.strictEqual(plan.usedUnits, 12);
});

test('granted keys are per locale and locked keys are de-duplicated', () => {
  const plan = planQuota({ sourceType: 'json', locales: ['ja', 'de'], strings: strings(105) }, CFG);
  assert.strictEqual(plan.grantedKeysByLocale.ja.length, 100);
  assert.strictEqual(plan.grantedKeysByLocale.de.length, 100);
  assert.strictEqual(plan.locked.keyCount, 5);
});

test('snapshot omits raw key lists and is JSON-safe', () => {
  const snap = snapshot(planQuota({ sourceType: 'json', locales: ['ja'], strings: strings(5) }, CFG));
  assert.ok(!('grantedKeysByLocale' in snap));
  assert.ok(!('keys' in snap.locked) || !snap.locked.keys);
  JSON.stringify(snap);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTranslatable, rebuildJson, verifyStructure, stats } = require('../src/lib/jsonParser');

const SAMPLE = {
  nav: { home: 'Home', pricing: 'Pricing' },
  cta: { start: 'Get started', save: 'Save' },
  meta: { version: 3, beta: true, docsUrl: 'https://docs.example.com', icon: 'star.svg' },
  list: ['First item', 'Second item'],
  empty: null,
  greeting: 'Hello {name}',
};

test('parses nested JSON, keeps non-strings untranslatable', () => {
  const entries = parseTranslatable(SAMPLE);
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  assert.strictEqual(byKey['nav.home'].translatable, true);
  assert.strictEqual(byKey['cta.save'].translatable, true);
  assert.strictEqual(byKey['meta.version'].translatable, false);
  assert.strictEqual(byKey['meta.beta'].translatable, false);
  assert.strictEqual(byKey['meta.docsUrl'].translatable, false); // URL
  assert.strictEqual(byKey['meta.icon'].translatable, false);     // asset path
  assert.strictEqual(byKey['list.0'].translatable, true);
  assert.strictEqual(byKey['empty'].translatable, false);
  assert.deepStrictEqual(byKey['greeting'].placeholders, ['{name}']);
});

test('respects user ignore rules', () => {
  const entries = parseTranslatable(SAMPLE, { ignoreRules: [/^cta\./] });
  assert.strictEqual(entries.find((e) => e.key === 'cta.start').translatable, false);
  assert.strictEqual(entries.find((e) => e.key === 'nav.home').translatable, true);
});

test('rebuildJson preserves structure, order and types', () => {
  const translations = { 'nav.home': 'ホーム', 'list.0': '最初の項目' };
  const out = rebuildJson(SAMPLE, translations);
  assert.deepStrictEqual(Object.keys(out), Object.keys(SAMPLE));
  assert.deepStrictEqual(Object.keys(out.nav), ['home', 'pricing']);
  assert.strictEqual(out.nav.home, 'ホーム');
  assert.strictEqual(out.nav.pricing, 'Pricing'); // untouched
  assert.strictEqual(out.meta.version, 3);
  assert.strictEqual(out.meta.beta, true);
  assert.strictEqual(out.empty, null);
  assert.deepStrictEqual(out.list, ['最初の項目', 'Second item']);
  assert.deepStrictEqual(verifyStructure(SAMPLE, out), []);
});

test('verifyStructure detects mismatches', () => {
  const bad = { nav: { home: 'x' }, cta: {}, meta: {}, list: ['a'], empty: null, greeting: 'y' };
  const problems = verifyStructure(SAMPLE, bad);
  const types = problems.map((p) => p.type);
  assert.ok(types.includes('missing-node'));
  assert.ok(types.includes('array-length-mismatch'));
});

test('stats counts translatable strings', () => {
  const s = stats(parseTranslatable(SAMPLE));
  assert.strictEqual(s.totalStrings, 9);
  assert.strictEqual(s.translatable, 7);
});

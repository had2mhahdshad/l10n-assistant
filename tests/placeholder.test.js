'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  extractPlaceholders, maskPlaceholders, unmaskPlaceholders,
  verifyPlaceholders, verifyHtml, verifyUrls, registerPattern,
} = require('../src/lib/placeholder');

test('extracts all supported placeholder syntaxes', () => {
  const text = 'Hello {name}, you have {{count}} items and ${total} credits. Use %s or %d or :code. Visit https://a.com/x?y=1 <b>bold</b> [link](https://l.com)';
  const tokens = extractPlaceholders(text).map((p) => p.token);
  for (const expected of ['{name}', '{{count}}', '${total}', '%s', '%d', ':code', 'https://a.com/x?y=1', '<b>', '</b>', '[link](https://l.com)']) {
    assert.ok(tokens.includes(expected), `missing ${expected}`);
  }
});

test('mask/unmask roundtrip preserves every token', () => {
  const text = 'Welcome {user}, click <a href="https://x.com">here</a> to get %d points.';
  const { text: masked, tokens } = maskPlaceholders(text);
  assert.ok(!masked.includes('{user}'));
  assert.ok(masked.includes('__PH_'));
  const restored = unmaskPlaceholders(masked, tokens);
  assert.strictEqual(restored, text);
});

test('verifyPlaceholders detects loss and additions', () => {
  const bad = verifyPlaceholders('Hi {name}, you have {count} items', 'Hi {name}');
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.missing, ['{count}']);
  const extra = verifyPlaceholders('Hi {name}', 'Hi {name} {other}');
  assert.strictEqual(extra.ok, false);
  assert.deepStrictEqual(extra.extra, ['{other}']);
  const good = verifyPlaceholders('Hi {name}', 'Hola {name}');
  assert.strictEqual(good.ok, true);
});

test('verifyHtml checks tag sequences', () => {
  assert.strictEqual(verifyHtml('Click <b>here</b> now', 'Haz clic <b>aquí</b>').ok, true);
  assert.strictEqual(verifyHtml('Click <b>here</b> now', 'Haz clic aquí').ok, false);
});

test('verifyUrls detects changed urls', () => {
  assert.strictEqual(verifyUrls('see https://a.com/x', 'voir https://a.com/x').ok, true);
  const r = verifyUrls('see https://a.com/x', 'voir https://a.com/other');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.changed, ['https://a.com/x']);
});

test('registerPattern extends recognition', () => {
  registerPattern('rails-style', /%\{[a-z_]+\}/g);
  const tokens = extractPlaceholders('Hello %{username}').map((p) => p.token);
  assert.ok(tokens.includes('%{username}'));
});

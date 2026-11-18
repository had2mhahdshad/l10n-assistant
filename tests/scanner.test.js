'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isPrivateIp, validateUrl, extractLinks, sameOrigin } = require('../src/lib/scanner');

test('blocks private/loopback/reserved IPs', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.strictEqual(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.10']) {
    assert.strictEqual(isPrivateIp(ip), false, ip);
  }
});

test('validateUrl rejects non-http protocols', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://x.com', 'gopher://x.com', 'javascript:alert(1)']) {
    const r = await validateUrl(u);
    assert.strictEqual(r.ok, false, u);
  }
});

test('validateUrl rejects localhost and literal private IPs', async () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data']) {
    const r = await validateUrl(u);
    assert.strictEqual(r.ok, false, u);
  }
});

test('validateUrl rejects hostnames resolving to private ranges', async () => {
  const r = await validateUrl('http://localhost.localdomain/');
  assert.strictEqual(r.ok, false);
});

test('validateUrl accepts public https urls', async () => {
  const r = await validateUrl('https://example.com/page');
  assert.strictEqual(r.ok, true);
});

test('extractLinks resolves and filters links', () => {
  const html = '<a href="/about">A</a><a href="https://other.com/x">B</a><a href="mailto:a@b.c">M</a><a href="#frag">F</a><a href="/img.png">I</a>';
  const links = extractLinks(html, 'https://example.com/dir/page');
  assert.ok(links.includes('https://example.com/about'));
  assert.ok(links.includes('https://other.com/x'));
  assert.ok(!links.some((l) => l.startsWith('mailto:')));
  assert.strictEqual(sameOrigin('https://example.com/about', new URL('https://example.com/')), true);
  assert.strictEqual(sameOrigin('https://other.com/x', new URL('https://example.com/')), false);
});

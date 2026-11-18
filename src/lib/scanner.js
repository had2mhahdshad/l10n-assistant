'use strict';
// SSRF-safe website scanner.
//
// Protections:
//   - http/https only
//   - DNS resolution checked against private/loopback/reserved ranges
//   - cloud metadata IPs explicitly blocked (169.254.169.254 etc.)
//   - every redirect target is re-validated before following
//   - request timeout, max body size, page count, crawl depth limits
//   - same-origin only by default
//   - no JavaScript execution, no cookies, no auth bypass
//
// The scanner only fetches publicly accessible pages and never claims
// complete website coverage.

const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
]);

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    return (
      n === '::1' || n === '::' ||
      n.startsWith('fc') || n.startsWith('fd') ||         // unique local
      n.startsWith('fe80') ||                             // link local
      n.startsWith('::ffff:') && isPrivateIp(n.slice(7))  // v4 mapped
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||      // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224                          // multicast/reserved
  );
}

async function resolveHost(hostname) {
  const { address } = await dns.lookup(hostname);
  return address;
}

/**
 * Validate a URL string for safe fetching.
 * Returns { ok, url?, reason? }. Resolves DNS and blocks private targets.
 */
async function validateUrl(raw, { resolve = true } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-protocol' };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'empty-host' };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blocked-hostname' };

  // Literal IP in the URL?
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: 'private-ip' };
    return { ok: true, url };
  }
  if (resolve) {
    try {
      const ip = await resolveHost(host);
      if (isPrivateIp(ip)) return { ok: false, reason: 'resolves-to-private-ip', ip };
    } catch {
      return { ok: false, reason: 'dns-failure' };
    }
  }
  return { ok: true, url };
}

/**
 * Fetch one page with SSRF protection, redirect re-validation, timeout
 * and response size cap. Returns { url, status, html?, error? }.
 */
async function safeFetch(rawUrl, opts = {}) {
  const {
    timeoutMs = 10000,
    maxBodyBytes = 1024 * 1024,
    maxRedirects = 5,
    userAgent = 'L10nAssistantBot/0.1',
  } = opts;

  let current = rawUrl;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const v = await validateUrl(current);
    if (!v.ok) return { url: current, error: `blocked:${v.reason}` };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(v.url.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-language': 'en',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return { url: current, status: res.status, error: 'redirect-without-location' };
        current = new URL(loc, v.url).toString();
        continue; // loop re-validates the new target
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return { url: current, status: res.status, error: `non-html:${contentType.split(';')[0] || 'unknown'}` };
      }

      // Read body with hard size cap.
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBodyBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      return { url: current, finalUrl: v.url.toString(), status: res.status, html, truncated };
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timeout' : `fetch-error:${err.message}`;
      return { url: current, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
  return { url: current, error: 'too-many-redirects' };
}

/**
 * Crawl a site within strict limits. Starts from startUrl, follows same-origin
 * links up to maxDepth / maxPages. Never claims complete coverage.
 *
 * Returns {
 *   pages: [{ url, status, html, links }],
 *   failed: [{ url, error }],
 *   coverage: { scannedPages, discoveredPages, maxPages, maxDepth, complete: false }
 * }
 */
async function crawl(startUrl, opts = {}) {
  const {
    maxPages = 10,
    maxDepth = 2,
    sameOriginOnly = true,
    ...fetchOpts
  } = opts;

  const start = new URL(startUrl);
  const visited = new Set();
  const queue = [{ url: start.toString(), depth: 0 }];
  const pages = [];
  const failed = [];
  const discovered = new Set([start.toString()]);

  while (queue.length && pages.length + failed.length < maxPages) {
    const { url, depth } = queue.shift();
    const norm = normalizeUrl(url);
    if (visited.has(norm)) continue;
    visited.add(norm);

    const res = await safeFetch(url, fetchOpts);
    if (res.error) {
      failed.push({ url, error: res.error });
      continue;
    }
    const links = extractLinks(res.html, res.finalUrl || url)
      .filter((l) => !sameOriginOnly || sameOrigin(l, start))
      .filter((l) => isHtmlLike(l));
    pages.push({ url: res.finalUrl || url, status: res.status, html: res.html, links, depth });

    if (depth < maxDepth && pages.length + failed.length + queue.length < maxPages * 2) {
      for (const l of links) {
        const n = normalizeUrl(l);
        if (!visited.has(n) && !discovered.has(n)) {
          discovered.add(n);
          if (queue.length + pages.length + failed.length < maxPages) {
            queue.push({ url: l, depth: depth + 1 });
          }
        }
      }
    }
  }

  return {
    pages,
    failed,
    coverage: {
      scannedPages: pages.length,
      failedPages: failed.length,
      discoveredPages: discovered.size,
      maxPages,
      maxDepth,
      complete: false, // by contract: never claim full-site coverage
      note: 'Scan covers publicly accessible pages within crawl limits only. It does not guarantee complete website coverage.',
    },
  };
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

function sameOrigin(u, base) {
  try {
    return new URL(u).origin === base.origin;
  } catch {
    return false;
  }
}

function isHtmlLike(u) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    return !/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|json|xml|txt|pdf|zip|gz|mp[34]|webm|woff2?|ttf|eot|avif)(\?|$)/.test(p);
  } catch {
    return false;
  }
}

/** Extract href links from HTML without executing anything. */
function extractLinks(html, baseUrl) {
  const out = new Set();
  const re = /<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') out.add(abs.toString());
    } catch { /* skip malformed */ }
  }
  return [...out];
}

module.exports = { validateUrl, isPrivateIp, safeFetch, crawl, extractLinks, sameOrigin };

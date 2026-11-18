'use strict';
// Per-job Free + Paid quota planner for AI Translation.
//
// This is a PURE function (no DB access) so it can be unit-tested and reused
// by the admin preview. All limits come from runtime config — nothing here is
// hardcoded.
//
// Billing dimensions:
//   URL  : pages actually fetched + translatable strings / characters
//   JSON : translatable string count + source character count
//   Multi-locale: EVERY locale is metered SEPARATELY — no bundle discount.
//
// Contract: exceeding the Free quota NEVER blocks the job. The free portion is
// translated and downloadable; everything beyond it is reported as locked so
// the UI can show used / remaining / untranslated content and an unlock entry.

/**
 * @param {object} input
 *   sourceType      'json' | 'url'
 *   locales         string[]  target locales
 *   strings         [{ key, chars }] translatable entries in source order
 *   pages           number    URL: pages actually fetched
 *   discoveredPages number    URL: pages discovered (for honest coverage note)
 * @param {object} cfg
 *   quota           { freeUrlPagesPerJob, freeJsonStringsPerJob, freeJsonCharsPerJob }
 *   translation     { mvpUrlPageLimit }
 *   accountRemaining number|null  optional legacy account-level cap
 */
function planQuota(input = {}, cfg = {}) {
  const {
    sourceType = 'json',
    locales = [],
    strings = [],
    pages = 0,
    discoveredPages = 0,
  } = input;
  const { quota: q = {}, translation: t = {}, accountRemaining = null } = cfg;

  const localeCount = Math.max(1, locales.length);
  const stringLimit = Math.max(0, Number(q.freeJsonStringsPerJob) || 0);
  const rawCharLimit = Number(q.freeJsonCharsPerJob) || 0;
  const charLimit = rawCharLimit > 0 ? rawCharLimit : Infinity;
  const pageLimit = Math.max(1, Math.min(
    Number(q.freeUrlPagesPerJob) || 0,
    Number(t.mvpUrlPageLimit) || 0,
  ) || 1);

  const charsOf = new Map(strings.map((s) => [s.key, Number(s.chars) || 0]));
  const totalStrings = strings.length;
  const totalChars = strings.reduce((n, s) => n + (Number(s.chars) || 0), 0);

  // URL jobs only fetch within the limit; locked pages are reported as an
  // unknown remainder (we never invent a count for pages we did not crawl).
  const grantedPages = sourceType === 'url' ? Math.min(pages, pageLimit) : 0;
  const unscannedPages = sourceType === 'url'
    ? Math.max(0, discoveredPages - grantedPages) : 0;

  // Grant strings PER LOCALE, honouring both the string and character caps.
  const perLocale = locales.map((locale) => {
    let grantedChars = 0;
    const grantedKeys = [];
    const lockedKeys = [];
    for (const s of strings) {
      const c = charsOf.get(s.key) || 0;
      const withinStrings = grantedKeys.length < stringLimit;
      const withinChars = grantedChars + c <= charLimit;
      if (withinStrings && withinChars) {
        grantedKeys.push(s.key);
        grantedChars += c;
      } else {
        lockedKeys.push(s.key);
      }
    }
    return { locale, grantedKeys, lockedKeys, grantedChars };
  });

  // Optional legacy account-level cap (default off). Applied across locales
  // in order; anything trimmed moves back into the locked set.
  const capUnits = (accountRemaining !== null && Number.isFinite(accountRemaining))
    ? Math.max(0, Math.floor(accountRemaining)) : Infinity;
  let grantedUnits = 0;
  for (const pl of perLocale) {
    const allow = Math.min(pl.grantedKeys.length, Math.max(0, capUnits - grantedUnits));
    if (allow < pl.grantedKeys.length) {
      const moved = pl.grantedKeys.splice(allow);
      pl.lockedKeys.unshift(...moved);
      pl.grantedChars = pl.grantedKeys.reduce((n, k) => n + (charsOf.get(k) || 0), 0);
    }
    grantedUnits += allow;
  }

  const freeUnits = stringLimit * localeCount;
  const requestedUnits = totalStrings * localeCount;
  const lockedUnits = Math.max(0, requestedUnits - grantedUnits);
  const lockedKeys = [];
  const seen = new Set();
  for (const pl of perLocale) {
    for (const k of pl.lockedKeys) if (!seen.has(k)) { seen.add(k); lockedKeys.push(k); }
  }

  const maxGranted = perLocale.reduce((n, p) => Math.max(n, p.grantedKeys.length), 0);
  const maxGrantedChars = perLocale.reduce((n, p) => Math.max(n, p.grantedChars), 0);
  const maxLocked = perLocale.reduce((n, p) => Math.max(n, p.lockedKeys.length), 0);

  return {
    sourceType,
    localeCount,
    limits: {
      stringsPerLocale: stringLimit,
      charsPerLocale: Number.isFinite(charLimit) ? charLimit : 0,
      pages: pageLimit,
    },
    requested: {
      stringsPerLocale: totalStrings,
      charsPerLocale: totalChars,
      pages,
      units: requestedUnits,
    },
    granted: {
      stringsPerLocale: maxGranted,
      charsPerLocale: maxGrantedChars,
      pages: grantedPages,
      units: grantedUnits,
    },
    locked: {
      stringsPerLocale: maxLocked,
      units: lockedUnits,
      pages: unscannedPages,
      keys: lockedKeys.slice(0, 50),
      keyCount: lockedKeys.length,
    },
    // Display helpers for the workspace.
    usedUnits: grantedUnits,
    freeUnitsRemaining: Math.max(0, freeUnits - grantedUnits),
    freeUnits,
    paywall: lockedUnits > 0 || unscannedPages > 0,
    perLocale: perLocale.map((p) => ({
      locale: p.locale,
      grantedStrings: p.grantedKeys.length,
      lockedStrings: p.lockedKeys.length,
      grantedChars: p.grantedChars,
    })),
    // Keys the job is actually allowed to translate, per locale.
    grantedKeysByLocale: Object.fromEntries(perLocale.map((p) => [p.locale, p.grantedKeys])),
  };
}

/** Compact snapshot persisted on the job row; safe to send to the browser. */
function snapshot(plan) {
  return {
    sourceType: plan.sourceType,
    limits: plan.limits,
    requested: plan.requested,
    granted: plan.granted,
    locked: { units: plan.locked.units, stringsPerLocale: plan.locked.stringsPerLocale, pages: plan.locked.pages },
    usedUnits: plan.usedUnits,
    freeUnitsRemaining: plan.freeUnitsRemaining,
    paywall: plan.paywall,
    perLocale: plan.perLocale,
  };
}

module.exports = { planQuota, snapshot };

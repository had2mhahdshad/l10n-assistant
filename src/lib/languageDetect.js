'use strict';
// Lightweight script/character based language detection.
// Good enough for the supported set: en, zh-CN, ja, de, fr.
// Not a substitute for full CLD — used for residue detection and sanity checks.

const RANGES = {
  ja: /[぀-ヿ㐀-䶿一-鿿]/,           // hiragana/katakana (+ shared kanji)
  jaKana: /[぀-ゟ゠-ヿ]/,             // kana only (distinguishes ja from zh)
  zh: /[一-鿿]/,                     // CJK unified ideographs
  latin: /[A-Za-z]/,
  deChars: /[äöüÄÖÜß]/,
  frChars: /[àâäçéèêëîïôöùûüÿœæ]/i,
  frWords: /\b(le|la|les|des|une|un|et|est|pour|vous|nous|avec|dans|votre|notre|sur|par|une|être|avoir)\b/i,
  deWords: /\b(der|die|das|und|ist|für|mit|nicht|sie|wir|ihre?|ein|eine|einen|auf|zu|den|dem)\b/i,
  enWords: /\b(the|and|is|for|with|you|your|we|our|to|of|in|on|create|new|get|start)\b/i,
};

function detectScript(text) {
  const t = String(text);
  const counts = { ja: 0, zh: 0, latin: 0, other: 0 };
  for (const ch of t) {
    if (/[぀-ゟ゠-ヿ]/.test(ch)) counts.ja++;
    else if (/[一-鿿]/.test(ch)) counts.zh++;
    else if (/[a-zA-Z]/.test(ch)) counts.latin++;
    else if (!/\s|\d|\p{P}/u.test(ch)) counts.other++;
  }
  return counts;
}

/**
 * Detect probable language of a text snippet.
 * Returns { lang, confidence } where lang ∈ en|zh|ja|de|fr|unknown.
 */
function detectLanguage(text) {
  const t = String(text).trim();
  if (!t) return { lang: 'unknown', confidence: 0 };
  const counts = detectScript(t);
  const letters = counts.ja + counts.zh + counts.latin;
  if (letters === 0) return { lang: 'unknown', confidence: 0 };

  if (counts.ja > 0) return { lang: 'ja', confidence: Math.min(1, counts.ja / letters + 0.5) };
  if (counts.zh > 0 && counts.latin === 0) return { lang: 'zh', confidence: 0.9 };
  if (counts.zh > 0) return { lang: 'zh', confidence: 0.6 };

  // Latin script: distinguish de / fr / en
  let de = 0, fr = 0, en = 0;
  if (RANGES.deChars.test(t)) de += 2;
  if (RANGES.deWords.test(t)) de += 1.5;
  if (RANGES.frChars.test(t)) fr += 2;
  if (RANGES.frWords.test(t)) fr += 1.5;
  if (RANGES.enWords.test(t)) en += 1.5;

  const max = Math.max(de, fr, en);
  if (max === 0) return { lang: 'en', confidence: 0.35 }; // latin, no signal — assume en weakly
  const lang = max === de ? 'de' : max === fr ? 'fr' : 'en';
  return { lang, confidence: Math.min(0.95, 0.4 + max / 5) };
}

/**
 * Detect "untranslated residue": text that appears to be in the SOURCE
 * language while the page/entry is supposed to be in TARGET language.
 */
function isResidue(text, sourceLang, targetLang) {
  const d = detectLanguage(text);
  if (d.lang === 'unknown') return false;
  const norm = (l) => (l || '').toLowerCase().split('-')[0];
  const src = norm(sourceLang), tgt = norm(targetLang);
  if (!src || !tgt || src === tgt) return false;
  return d.lang === src && d.confidence >= 0.5 && String(text).trim().split(/\s+/).length >= 2;
}

module.exports = { detectLanguage, detectScript, isResidue };

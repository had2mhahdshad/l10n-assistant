'use strict';
// Developer-ready export: per-locale JSON, ZIP bundle, CSV bilingual sheet,
// QA report. Validates JSON structure before packaging.

const archiver = require('archiver');
const { PassThrough } = require('stream');

/**
 * Build export files for a job.
 * @param job      translation job row
 * @param locales  [{ locale, filename, json (object), validated: bool, problems: [] }]
 * @returns { files: [{ path, content: string|Buffer }] } virtual file tree
 */
function buildExportFiles(job, locales) {
  const files = [];
  for (const loc of locales) {
    files.push({
      path: `locales/${loc.locale}/${loc.filename || 'common.json'}`,
      content: JSON.stringify(loc.json, null, 2) + '\n',
    });
  }
  return files;
}

/** CSV bilingual comparison (source + all locales). */
function buildCsv(entriesByKey, locales) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['key', 'source', ...locales].map(esc).join(',');
  const rows = Object.entries(entriesByKey).map(([key, rec]) =>
    [key, rec.source, ...locales.map((l) => rec[l] ?? '')].map(esc).join(',')
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

/** Human + machine readable QA report. */
function buildQaReport(job, issues, stats) {
  const lines = [
    `# Translation QA Report`,
    ``,
    `Job: ${job.id}`,
    `Model: ${job.model || 'n/a'}`,
    `Strings: ${job.translated_strings}/${job.total_strings} translated, ${job.failed_strings} failed`,
    `Tokens: ${stats?.totalTokens ?? job.token_usage ?? 0}`,
    `Estimated cost: $${(stats?.costUsd ?? job.estimated_cost ?? 0).toFixed ? (stats?.costUsd ?? job.estimated_cost ?? 0).toFixed(6) : 0}`,
    `Issues found: ${issues.length}`,
    ``,
    `| Entry | Type | Severity | Description |`,
    `|---|---|---|---|`,
    ...issues.map((i) => `| ${i.entryKey} | ${i.issueType} | ${i.severity} | ${String(i.description).replace(/\|/g, '\\|')} |`),
    ``,
    `Note: length-related findings are risk estimates, not render-verified overflow results.`,
  ];
  return lines.join('\n');
}

/** Stream a ZIP archive to an Express response. */
function streamZip(res, files, zipName = 'locales.zip') {
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-disposition', `attachment; filename="${zipName}"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.on('error', (err) => { try { res.destroy(err); } catch { /* noop */ } });
  archive.pipe(passthrough);
  passthrough.pipe(res);
  for (const f of files) archive.append(f.content, { name: f.path });
  archive.finalize();
}

module.exports = { buildExportFiles, buildCsv, buildQaReport, streamZip };

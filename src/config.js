'use strict';
// Central configuration. All values come from environment variables with
// safe development defaults. AI keys are server-side only.
const path = require('path');

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const root = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`,
  dbPath: path.resolve(root, process.env.DATABASE_PATH || './data/app.db'),

  ai: {
    provider: (process.env.AI_PROVIDER || 'mock').toLowerCase(), // 'mock' | 'openai'
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 60000),
    maxRetries: int(process.env.AI_MAX_RETRIES, 2),
  },

  scan: {
    maxPages: int(process.env.SCAN_MAX_PAGES, 10),
    maxDepth: int(process.env.SCAN_MAX_DEPTH, 2),
    timeoutMs: int(process.env.SCAN_TIMEOUT_MS, 10000),
    maxBodyBytes: int(process.env.SCAN_MAX_BODY_BYTES, 1024 * 1024),
    sameOriginOnly: (process.env.SCAN_SAME_ORIGIN_ONLY || 'true') !== 'false',
    userAgent: 'L10nAssistantBot/0.1 (+localization quality checker)',
  },

  quota: {
    // 0 = unlimited. The free checker is intentionally NOT capped by default;
    // an admin can still set a limit in /admin/settings if needed.
    anonAuditDaily: int(process.env.FREE_AUDIT_DAILY_LIMIT_ANON, 0),
    userAuditMonthly: int(process.env.FREE_AUDIT_MONTHLY_LIMIT_USER, 0),
    freeTranslateStrings: int(process.env.FREE_TRANSLATE_STRINGS, 100),
    translateBatchSize: int(process.env.TRANSLATE_BATCH_SIZE, 20),
    freeReportFullExamples: int(process.env.FREE_REPORT_FULL_EXAMPLES, 3),
  },

  adminToken: process.env.ADMIN_TOKEN || 'change-me-in-production',
  cookieSecret: process.env.COOKIE_SECRET || '',
};

module.exports = config;

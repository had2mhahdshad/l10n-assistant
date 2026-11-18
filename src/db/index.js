'use strict';
// SQLite (node:sqlite) database layer + schema migrations.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const MIGRATIONS = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE audit_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        anon_id TEXT,
        website_url TEXT NOT NULL,
        target_url TEXT,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',   -- pending|running|completed|failed
        error TEXT,
        scanned_pages INTEGER DEFAULT 0,
        failed_pages INTEGER DEFAULT 0,
        discovered_pages INTEGER DEFAULT 0,
        coverage_note TEXT,
        localization_score REAL,
        score_dimensions TEXT,                    -- JSON
        issue_count INTEGER DEFAULT 0,
        severity_dist TEXT,                       -- JSON
        type_dist TEXT,                           -- JSON
        sample_size INTEGER DEFAULT 0,
        ai_degraded INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE audit_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_job_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        source_text TEXT,
        current_translation TEXT,
        suggestion TEXT,
        reason TEXT,
        page_url TEXT,
        context TEXT,
        source TEXT NOT NULL DEFAULT 'rule',      -- rule|ai
        FOREIGN KEY (audit_job_id) REFERENCES audit_jobs(id)
      );
      CREATE INDEX idx_audit_issues_job ON audit_issues(audit_job_id);

      CREATE TABLE human_service_leads (
        id TEXT PRIMARY KEY,
        audit_job_id TEXT,
        email TEXT NOT NULL,
        product_name TEXT,
        target_languages TEXT,                    -- JSON array
        service_type TEXT,
        estimated_word_count INTEGER,
        description TEXT,
        needs_human_review INTEGER DEFAULT 0,
        audit_context TEXT,                       -- JSON snapshot from report
        status TEXT NOT NULL DEFAULT 'new',       -- new|contacted|quoted|won|lost
        created_at TEXT NOT NULL
      );

      CREATE TABLE translation_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        anon_id TEXT,
        project_name TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_languages TEXT NOT NULL,           -- JSON array
        product_type TEXT,
        context TEXT,
        style TEXT,
        extra_requirements TEXT,
        brand_terms TEXT,                         -- JSON array
        created_at TEXT NOT NULL
      );

      CREATE TABLE translation_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        anon_id TEXT,
        source_file TEXT,                         -- original JSON, JSON string
        filename TEXT DEFAULT 'common.json',
        status TEXT NOT NULL DEFAULT 'pending',   -- pending|translating|completed|failed
        total_strings INTEGER DEFAULT 0,
        translated_strings INTEGER DEFAULT 0,
        failed_strings INTEGER DEFAULT 0,
        model TEXT,
        token_usage INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES translation_projects(id)
      );

      CREATE TABLE translation_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        key TEXT NOT NULL,
        path TEXT,                                -- JSON array path
        source_text TEXT,
        translated_text TEXT,
        manually_edited INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',   -- pending|translating|completed|needs_review|approved|failed|skipped
        review_status TEXT,                       -- null|reviewed
        qa_flags TEXT,                            -- JSON array
        modified_at TEXT,
        UNIQUE (job_id, locale, key),
        FOREIGN KEY (job_id) REFERENCES translation_jobs(id)
      );
      CREATE INDEX idx_entries_job ON translation_entries(job_id, locale);

      CREATE TABLE glossaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        locale TEXT NOT NULL,
        description TEXT,
        FOREIGN KEY (project_id) REFERENCES translation_projects(id)
      );

      CREATE TABLE quality_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        entry_id INTEGER,
        entry_key TEXT,
        locale TEXT,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT,
        suggestion TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES translation_jobs(id)
      );
      CREATE INDEX idx_quality_job ON quality_issues(job_id);
    `,
  },
  {
    id: 2,
    name: 'share_tokens',
    // Read-only share links: an owner can hand a report / workspace to a
    // colleague without giving away their session. Write operations still
    // require ownership — a share token never grants edit rights.
    sql: `
      ALTER TABLE audit_jobs ADD COLUMN share_token TEXT;
      ALTER TABLE translation_jobs ADD COLUMN share_token TEXT;
      CREATE UNIQUE INDEX idx_audit_share ON audit_jobs(share_token);
      CREATE UNIQUE INDEX idx_job_share ON translation_jobs(share_token);
      UPDATE audit_jobs SET share_token = lower(hex(randomblob(16))) WHERE share_token IS NULL;
      UPDATE translation_jobs SET share_token = lower(hex(randomblob(16))) WHERE share_token IS NULL;
    `,
  },
];

let dbInstance = null;

function getDb(dbPath = config.dbPath) {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  backfillShareTokens(db);
  dbInstance = db;
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`);
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec(m.sql);
    db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)')
      .run(m.id, m.name, new Date().toISOString());
  }
}

/** Safety net: any job without a share token gets one (cheap, idempotent). */
function backfillShareTokens(db) {
  for (const t of ['audit_jobs', 'translation_jobs']) {
    try {
      db.exec(`UPDATE ${t} SET share_token = lower(hex(randomblob(16))) WHERE share_token IS NULL`);
    } catch { /* column absent on very old schemas — migration handles it */ }
  }
}

function closeDb() {
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
}

/** test helper: fresh in-memory db */
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  backfillShareTokens(db);
  return db;
}

module.exports = { getDb, migrate, closeDb, createTestDb, MIGRATIONS };

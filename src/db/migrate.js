'use strict';
// Run migrations standalone: npm run migrate
const { getDb, closeDb } = require('./index');
const db = getDb();
const rows = db.prepare('SELECT id, name, applied_at FROM _migrations ORDER BY id').all();
console.log('Applied migrations:');
for (const r of rows) console.log(`  #${r.id} ${r.name} (${r.applied_at})`);
closeDb();

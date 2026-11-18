'use strict';
// L10N Assistant — application entrypoint.

const path = require('path');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db');
const anonMiddleware = require('./middleware/anon');
const { pickLang, translator } = require('./lib/i18n');
const pagesRoutes = require('./routes/pages');
const auditRoutes = require('./routes/audit');
const translateRoutes = require('./routes/translate');
const leadRoutes = require('./routes/leads');
const settingsRoutes = require('./routes/settings');
const fontRoutes = require('./routes/fonts');

function createApp() {
  const db = getDb();
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(anonMiddleware);

  // Security headers (no arbitrary script execution assumptions).
  app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'same-origin');
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  app.use(pagesRoutes);
  app.use(auditRoutes(db));
  app.use(translateRoutes(db));
  app.use(leadRoutes(db));
  app.use(settingsRoutes(db));
  app.use(fontRoutes(db));

  app.get('/api/health', (req, res) => res.json({ ok: true, ai: config.ai.provider }));

  // JSON 404 for API, HTML 404 otherwise.
  app.use((req, res) => {
    const T = translator(pickLang(req));
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: T('err.notFound') });
    res.status(404).send(`<h1 style="font-family:monospace;padding:40px">${T('err.page404')} <a href="/">${T('err.backHome')}</a></h1>`);
  });

  // Error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || 'Internal error.' });
  });

  return { app, db };
}

if (require.main === module) {
  const { app } = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`L10N Assistant listening on http://localhost:${config.port} (env: ${config.env}, ai: ${config.ai.provider})`);
  });
}

module.exports = { createApp };

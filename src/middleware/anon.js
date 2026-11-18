'use strict';
// Anonymous identity middleware: assigns a stable device id cookie.
const { resolveAnonId } = require('../lib/quota');

module.exports = function anonMiddleware(req, res, next) {
  const { anonId, setCookie } = resolveAnonId(req);
  req.anonId = anonId;
  req.userId = null; // auth lands in Phase 4; hook point kept explicit
  if (setCookie) res.setHeader('set-cookie', setCookie);
  next();
};

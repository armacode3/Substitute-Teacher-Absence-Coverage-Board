const express = require('express');
const path = require('path');
const { createDb } = require('./db');
const { createCoverageService } = require('./coverage');
const { HttpError, reject } = require('./errors');
const { bodyObject, userId, pathId, timestamp, windowTimes, reason } = require('./validation');

function createApp(dbPath, options = {}) {
  const app = express();
  const db = createDb(dbPath);
  const coverage = createCoverageService(db, options);

  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.locals.db = db;

  app.get('/api/users', (req, res) => {
    const { role } = req.query;
    if (role !== undefined && !['teacher', 'substitute'].includes(role)) {
      reject(400, 'INVALID_ROLE', 'role must be teacher or substitute.');
    }
    res.json(coverage.listUsers(role));
  });

  app.get('/api/absences', (req, res) => res.json(coverage.list()));

  app.post('/api/absences', (req, res) => {
    const body = bodyObject(req.body);
    const result = coverage.create({
      teacherId: userId(body.teacher_id, 'teacher_id'),
      ...windowTimes(body),
      reasons: reason(body.reason)
    });
    res.status(result.created ? 201 : 200).json({
      ...result.absence,
      operation: result.operation,
      removed_absence_ids: result.removedAbsenceIds
    });
  });

  app.post('/api/absences/:id/claim', (req, res) => {
    const body = bodyObject(req.body);
    res.json(coverage.claim({
      absenceId: pathId(req.params.id),
      substituteId: userId(body.substitute_id, 'substitute_id'),
      ...windowTimes(body)
    }));
  });

  app.post('/api/assignments/:id/cancel', (req, res) => {
    const body = bodyObject(req.body);
    res.json(coverage.cancel({
      assignmentId: pathId(req.params.id),
      substituteId: userId(body.substitute_id, 'substitute_id')
    }));
  });

  app.post('/api/absences/:id/return-early', (req, res) => {
    const body = bodyObject(req.body);
    res.json(coverage.returnEarly({
      absenceId: pathId(req.params.id),
      teacherId: userId(body.teacher_id, 'teacher_id'),
      end: body.end_time === undefined ? undefined : timestamp(body.end_time, 'end_time')
    }));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } }));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'JSON bodies must not exceed 32 KiB.' } });
    }
    if (typeof error.code === 'string' && /^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(error.code)) {
      return res.set('Retry-After', '1').status(503).json({ error: { code: 'DATABASE_BUSY', message: 'Database busy. Refresh before retrying.' } });
    }
    console.error('Unexpected API error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred; no partial changes were committed.' } });
  });

  return app;
}

module.exports = { createApp };

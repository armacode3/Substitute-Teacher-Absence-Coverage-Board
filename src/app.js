const express = require('express');
const path = require('path');
const { createDb } = require('./db');

function createApp(dbPath) {
  const app = express();
  const db = createDb(dbPath);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.locals.db = db;

  app.get('/api/users', (req, res) => {
    const { role } = req.query;
    let users;
    if (role) {
      users = db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id').all(role);
    } else {
      users = db.prepare('SELECT * FROM users ORDER BY id').all();
    }
    res.json(users);
  });

  // =========================================================================
  // TODO: Implement Absence & Sub Coverage API Endpoints below
  // - GET /api/absences
  // - POST /api/absences
  // - POST /api/absences/:id/claim
  // =========================================================================

  return app;
}

module.exports = { createApp };

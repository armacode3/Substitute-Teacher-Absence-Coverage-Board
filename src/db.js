const Database = require('better-sqlite3');
const path = require('path');

function createDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'school.db');
  const db = new Database(resolvedPath, { timeout: 1000 });

  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('teacher', 'substitute'))
    );

    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      start_time INTEGER NOT NULL CHECK(typeof(start_time) = 'integer' AND start_time BETWEEN -8640000000000000 AND 8640000000000000),
      end_time INTEGER NOT NULL CHECK(typeof(end_time) = 'integer' AND end_time BETWEEN -8640000000000000 AND 8640000000000000 AND end_time > start_time),
      reasons TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons) AND json_type(reasons) = 'array')
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE RESTRICT,
      substitute_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      start_time INTEGER NOT NULL CHECK(typeof(start_time) = 'integer' AND start_time BETWEEN -8640000000000000 AND 8640000000000000),
      end_time INTEGER NOT NULL CHECK(typeof(end_time) = 'integer' AND end_time BETWEEN -8640000000000000 AND 8640000000000000 AND end_time > start_time)
    );

    CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      substitute_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      expires_at INTEGER CHECK(expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at BETWEEN -8640000000000000 AND 8640000000000000)),
      UNIQUE(substitute_id, name)
    );

    CREATE INDEX IF NOT EXISTS absences_teacher_start ON absences(teacher_id, start_time);
    CREATE INDEX IF NOT EXISTS assignments_absence_start ON assignments(absence_id, start_time);
    CREATE INDEX IF NOT EXISTS assignments_substitute_start ON assignments(substitute_id, start_time);
  `);

  const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (count === 0) {
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    const seedUsers = [
      ['Alice Henderson (Math)', 'alice@oakridge.edu', 'teacher'],
      ['Marcus Vance (Science)', 'marcus@oakridge.edu', 'teacher'],
      ['Elena Rostova (History)', 'elena@oakridge.edu', 'teacher'],
      ['David Kim (Sub)', 'dkim@oakridge.edu', 'substitute'],
      ['Sarah Jenkins (Sub)', 'sjenkins@oakridge.edu', 'substitute']
    ];
    const insertMany = db.transaction((users) => {
      for (const u of users) insertUser.run(u);
    });
    insertMany(seedUsers);
  }

  return db;
}

module.exports = { createDb };

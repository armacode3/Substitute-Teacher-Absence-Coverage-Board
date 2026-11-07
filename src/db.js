const Database = require('better-sqlite3');
const path = require('path');

function createDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'school.db');
  const db = new Database(resolvedPath);

  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('teacher', 'substitute'))
    );

    -- TODO: Add your absences / shift coverage table(s) here
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

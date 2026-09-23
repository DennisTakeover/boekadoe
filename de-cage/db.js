const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function openDb(file = process.env.DB_FILE || path.join(__dirname, 'data', 'cage.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 5,        -- zelfinschatting 1-10, bepaalt start-rating
      side TEXT NOT NULL DEFAULT 'beide',      -- links / rechts / beide
      bio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Een speeldag (bijv. dinsdagavond 20:00, 3 banen)
    CREATE TABLE IF NOT EXISTS play_days (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,          -- YYYY-MM-DD
      time TEXT NOT NULL DEFAULT '20:00',
      courts INTEGER NOT NULL DEFAULT 3,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attendance (
      day_id INTEGER NOT NULL REFERENCES play_days(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (day_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      day_id INTEGER NOT NULL REFERENCES play_days(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      court INTEGER NOT NULL,
      a1 INTEGER NOT NULL REFERENCES users(id),
      a2 INTEGER NOT NULL REFERENCES users(id),
      b1 INTEGER NOT NULL REFERENCES users(id),
      b2 INTEGER NOT NULL REFERENCES users(id),
      score_a INTEGER,
      score_b INTEGER,
      score_by INTEGER REFERENCES users(id),
      score_at TEXT
    );

    -- Spelers geven een wedstrijd 1-5 sterren (hoe leuk / hoe gelijkwaardig)
    CREATE TABLE IF NOT EXISTS match_ratings (
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (match_id, user_id)
    );
  `);
  return db;
}

module.exports = { openDb };

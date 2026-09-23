const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

// Lokaal: een SQLite-bestand in data/. Online (Vercel): een Turso-database via
// TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Dezelfde SQL werkt op beide.
function openDb(url = process.env.TURSO_DATABASE_URL) {
  if (!url) {
    const file = process.env.DB_FILE || path.join(__dirname, 'data', 'cage.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    url = `file:${file}`;
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  const exec = (sql, args) => client.execute({ sql, args });
  const db = {
    client,
    all: async (sql, ...args) => (await exec(sql, args)).rows,
    get: async (sql, ...args) => (await exec(sql, args)).rows[0],
    run: async (sql, ...args) => {
      const r = await exec(sql, args);
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    ready: null,
  };
  db.ready = migrate(client);
  return db;
}

// Tabellen die later worden verwijderd ruimen we in de code zelf op (geen
// ON DELETE CASCADE), omdat foreign keys niet op elke Turso-verbinding aan staan.
async function migrate(client) {
  await client.executeMultiple(`
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
      user_id INTEGER NOT NULL,
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
      day_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (day_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      day_id INTEGER NOT NULL,
      round INTEGER NOT NULL,
      court INTEGER NOT NULL,
      a1 INTEGER NOT NULL,
      a2 INTEGER NOT NULL,
      b1 INTEGER NOT NULL,
      b2 INTEGER NOT NULL,
      score_a INTEGER,
      score_b INTEGER,
      score_by INTEGER,
      score_at TEXT
    );
    CREATE INDEX IF NOT EXISTS matches_day ON matches(day_id, round);

    -- Spelers geven een wedstrijd 1-5 sterren (hoe leuk / hoe gelijkwaardig)
    CREATE TABLE IF NOT EXISTS match_ratings (
      match_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (match_id, user_id)
    );
  `);
}

module.exports = { openDb };

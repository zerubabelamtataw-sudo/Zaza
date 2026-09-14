// ============================================================
// ZA BINGO — DATABASE (SQLite)
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');

let db;

function initDB() {
  db = new Database(path.join(__dirname, 'bingo.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Players table
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT 'Player',
      phone TEXT DEFAULT '',
      balance REAL DEFAULT 100,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      registration_date TEXT DEFAULT (datetime('now'))
    )
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_method TEXT DEFAULT '',
      description TEXT DEFAULT '',
      date TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Game history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      room_name TEXT NOT NULL,
      result TEXT NOT NULL,
      prize REAL DEFAULT 0,
      cartela_indices TEXT DEFAULT '',
      date TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  console.log('✅ Database initialized');
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };
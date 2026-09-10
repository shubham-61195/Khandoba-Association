const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'ledger.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','partner')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('expense','received')),
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  entry_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// Seed a default admin account on first run only.
const adminExists = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
if (!adminExists) {
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin@123';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,?)`)
    .run('admin', hash, 'CEO / Admin', 'admin');
  console.log('----------------------------------------------------');
  console.log('પ્રથમ વખત ચાલી રહ્યું છે. Admin login બન્યું છે:');
  console.log('   username: admin');
  console.log('   password:', defaultPassword);
  console.log('પહેલા લોગિનમાં જ પાસવર્ડ બદલી નાખો.');
  console.log('----------------------------------------------------');
}

module.exports = db;

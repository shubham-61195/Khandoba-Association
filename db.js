const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is missing. Set it to your Postgres connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','partner')),
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('expense','received')),
      company_id INTEGER NOT NULL REFERENCES companies(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount NUMERIC NOT NULL,
      entry_date DATE NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin@123';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'admin')`,
      ['admin', hash, 'CEO / Admin']
    );
    console.log('----------------------------------------------------');
    console.log('પ્રથમ વખત ચાલી રહ્યું છે. Admin login બન્યું છે:');
    console.log('   username: admin');
    console.log('   password:', defaultPassword);
    console.log('પહેલા લોગિનમાં જ પાસવર્ડ બદલી નાખો.');
    console.log('----------------------------------------------------');
  }
}

module.exports = { pool, init };

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'લોગિન જરૂરી છે' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: 'પરવાનગી નથી' });
      }
      next();
    } catch (e) {
      return res.status(401).json({ error: 'સેશન સમાપ્ત થયું, ફરી લોગિન કરો' });
    }
  };
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'સર્વર ભૂલ, ફરી પ્રયત્ન કરો' });
  });
}

// ---------- AUTH ----------
app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [(username || '').trim()]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'યુઝરનેમ અથવા પાસવર્ડ ખોટા છે' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
}));

app.post('/api/change-password', auth(), asyncRoute(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'ઓછામાં ઓછા 6 અક્ષરનો પાસવર્ડ રાખો' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
}));

// ---------- ADMIN: USER MANAGEMENT ----------
app.get('/api/users', auth('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, created_at FROM users ORDER BY id');
  res.json(rows);
}));

app.post('/api/users', auth('admin'), asyncRoute(async (req, res) => {
  const { display_name } = req.body;
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: 'નામ નાખો' });
  let username = display_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  let finalUsername = username;
  let n = 1;
  while (true) {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [finalUsername]);
    if (rows.length === 0) break;
    finalUsername = `${username}${n++}`;
  }
  const password = genPassword();
  const hash = bcrypt.hashSync(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'partner') RETURNING id`,
    [finalUsername, hash, display_name.trim()]
  );
  res.json({ id: rows[0].id, username: finalUsername, password, display_name: display_name.trim() });
}));

app.delete('/api/users/:id', auth('admin'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'મળ્યું નહીં' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admin ડિલીટ ના થાય' });
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
}));

// ---------- COMPANIES ----------
app.get('/api/companies', auth(), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM companies ORDER BY name');
  res.json(rows);
}));

app.post('/api/companies', auth(), asyncRoute(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'નામ નાખો' });
  try {
    const { rows } = await pool.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [name.trim()]);
    res.json({ id: rows[0].id, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'આ કંપની પહેલેથી છે' });
  }
}));

app.delete('/api/companies/:id', auth(), asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM companies WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- ENTRIES ----------
app.get('/api/entries', auth(), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT e.id, e.type, e.amount, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.note,
           c.id as company_id, c.name as company_name,
           u.id as user_id, u.display_name as user_name
    FROM entries e
    JOIN companies c ON c.id = e.company_id
    JOIN users u ON u.id = e.user_id
    ORDER BY e.entry_date DESC, e.id DESC
  `);
  res.json(rows);
}));

app.post('/api/entries', auth(), asyncRoute(async (req, res) => {
  const { type, company_id, user_id, amount, entry_date, note } = req.body;
  if (!['expense', 'received'].includes(type)) return res.status(400).json({ error: 'ખોટો પ્રકાર' });
  if (!company_id || !user_id || !amount || amount <= 0 || !entry_date) {
    return res.status(400).json({ error: 'બધી વિગત ભરો' });
  }
  const effectiveUserId = req.user.role === 'admin' ? user_id : req.user.id;
  const { rows } = await pool.query(
    `INSERT INTO entries (type, company_id, user_id, amount, entry_date, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [type, company_id, effectiveUserId, amount, entry_date, note || null]
  );
  res.json({ id: rows[0].id });
}));

app.delete('/api/entries/:id', auth(), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM entries WHERE id = $1', [id]);
  const entry = rows[0];
  if (!entry) return res.status(404).json({ error: 'મળ્યું નહીં' });
  if (req.user.role !== 'admin' && entry.user_id !== req.user.id) {
    return res.status(403).json({ error: 'ફક્ત પોતાની નોંધ જ ડિલીટ કરી શકાય' });
  }
  await pool.query('DELETE FROM entries WHERE id = $1', [id]);
  res.json({ ok: true });
}));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Ledger server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Database init failed:', err);
    process.exit(1);
  });

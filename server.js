const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

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

// ---------- AUTH ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'યુઝરનેમ અથવા પાસવર્ડ ખોટા છે' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
});

app.post('/api/change-password', auth(), (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'ઓછામાં ઓછા 6 અક્ષરનો પાસવર્ડ રાખો' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// ---------- ADMIN: USER MANAGEMENT ----------
app.get('/api/users', auth('admin'), (req, res) => {
  const users = db.prepare(`SELECT id, username, display_name, role, created_at FROM users ORDER BY id`).all();
  res.json(users);
});

app.post('/api/users', auth('admin'), (req, res) => {
  const { display_name } = req.body;
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: 'નામ નાખો' });
  let username = display_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  let finalUsername = username;
  let n = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername)) {
    finalUsername = `${username}${n++}`;
  }
  const password = genPassword();
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,'partner')`)
    .run(finalUsername, hash, display_name.trim());
  res.json({ id: info.lastInsertRowid, username: finalUsername, password, display_name: display_name.trim() });
});

app.delete('/api/users/:id', auth('admin'), (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'મળ્યું નહીં' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admin ડિલીટ ના થાય' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- COMPANIES ----------
app.get('/api/companies', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY name').all());
});

app.post('/api/companies', auth(), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'નામ નાખો' });
  try {
    const info = db.prepare('INSERT INTO companies (name) VALUES (?)').run(name.trim());
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'આ કંપની પહેલેથી છે' });
  }
});

app.delete('/api/companies/:id', auth(), (req, res) => {
  db.prepare('DELETE FROM companies WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- ENTRIES ----------
app.get('/api/entries', auth(), (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.type, e.amount, e.entry_date, e.note,
           c.id as company_id, c.name as company_name,
           u.id as user_id, u.display_name as user_name
    FROM entries e
    JOIN companies c ON c.id = e.company_id
    JOIN users u ON u.id = e.user_id
    ORDER BY e.entry_date DESC, e.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/entries', auth(), (req, res) => {
  const { type, company_id, user_id, amount, entry_date, note } = req.body;
  if (!['expense', 'received'].includes(type)) return res.status(400).json({ error: 'ખોટો પ્રકાર' });
  if (!company_id || !user_id || !amount || amount <= 0 || !entry_date) {
    return res.status(400).json({ error: 'બધી વિગત ભરો' });
  }
  // partners can only log entries under their own name; admin can log for anyone
  const effectiveUserId = req.user.role === 'admin' ? user_id : req.user.id;
  const info = db.prepare(`INSERT INTO entries (type, company_id, user_id, amount, entry_date, note) VALUES (?,?,?,?,?,?)`)
    .run(type, company_id, effectiveUserId, amount, entry_date, note || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/entries/:id', auth(), (req, res) => {
  const id = Number(req.params.id);
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'મળ્યું નહીં' });
  if (req.user.role !== 'admin' && entry.user_id !== req.user.id) {
    return res.status(403).json({ error: 'ફક્ત પોતાની નોંધ જ ડિલીટ કરી શકાય' });
  }
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Ledger server running on port ${PORT}`));

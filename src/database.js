'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'nvr.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER DEFAULT 554,
      username TEXT,
      password TEXT,
      rtsp_path TEXT DEFAULT '/Streaming/Channels/101',
      brand TEXT DEFAULT 'generic',
      category TEXT DEFAULT 'default',
      lat REAL,
      lng REAL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ptz_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL,
      preset_number INTEGER NOT NULL,
      name TEXT,
      FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#58a6ff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO categories (name, color) VALUES ('default', '#8b949e');

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'viewer' CHECK(role IN ('admin','operator','viewer')),
      permissions TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      force_password_change INTEGER DEFAULT 1,
      login_attempts INTEGER DEFAULT 0,
      locked_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT DEFAULT 'system',
      last_login DATETIME,
      last_login_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      ip TEXT,
      user_agent TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS license_plates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_text  TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 0,
      detected_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plates_text ON license_plates(plate_text);
    CREATE INDEX IF NOT EXISTS idx_plates_ts   ON license_plates(detected_at);
  `);

  // Seed default admin (password: admin1234, must change on first login)
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin1234', 12);
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, permissions, is_active, force_password_change, created_by)
      VALUES ('admin', 'Administrator', ?, 'admin', '{}', 1, 1, 'system')
    `).run(hash);
    console.log('[DB] Default admin created — login: admin / admin1234');
  }
}

// Camera CRUD
function getAllCameras() {
  return getDb().prepare('SELECT * FROM cameras ORDER BY category, name').all();
}

function getCameraById(id) {
  return getDb().prepare('SELECT * FROM cameras WHERE id = ?').get(id);
}

function createCamera(data) {
  const stmt = getDb().prepare(`
    INSERT INTO cameras (name, ip, port, username, password, rtsp_path, brand, category, lat, lng, enabled)
    VALUES (@name, @ip, @port, @username, @password, @rtsp_path, @brand, @category, @lat, @lng, @enabled)
  `);
  const result = stmt.run(data);
  return getCameraById(result.lastInsertRowid);
}

function updateCamera(id, data) {
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE cameras SET ${fields} WHERE id = @id`).run({ ...data, id });
  return getCameraById(id);
}

function deleteCamera(id) {
  getDb().prepare('DELETE FROM cameras WHERE id = ?').run(id);
}

function getCategories() {
  // Merge categories table with any camera categories not yet in the table
  const rows = getDb().prepare(`
    SELECT c.name, c.color,
      COUNT(cam.id) as camera_count,
      SUM(CASE WHEN cam.enabled = 1 THEN 1 ELSE 0 END) as enabled_count
    FROM categories c
    LEFT JOIN cameras cam ON cam.category = c.name
    GROUP BY c.name, c.color
    UNION
    SELECT cam.category as name, '#58a6ff' as color,
      COUNT(cam.id) as camera_count,
      SUM(CASE WHEN cam.enabled = 1 THEN 1 ELSE 0 END) as enabled_count
    FROM cameras cam
    WHERE cam.category NOT IN (SELECT name FROM categories)
    GROUP BY cam.category
    ORDER BY name
  `).all();
  return rows;
}

function getCategoryNames() {
  return getDb().prepare('SELECT DISTINCT category FROM cameras ORDER BY category').all().map(r => r.category);
}

function getCamerasByCategory(categoryName) {
  return getDb().prepare('SELECT * FROM cameras WHERE category = ? AND enabled = 1').all(categoryName);
}

function createCategory(name, color = '#58a6ff') {
  getDb().prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)').run(name, color);
  return getDb().prepare('SELECT * FROM categories WHERE name = ?').get(name);
}

function updateCategory(name, data) {
  if (data.color) {
    getDb().prepare('UPDATE categories SET color = ? WHERE name = ?').run(data.color, name);
  }
  if (data.newName && data.newName !== name) {
    getDb().prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)').run(
      data.newName,
      data.color || '#58a6ff'
    );
    getDb().prepare('UPDATE cameras SET category = ? WHERE category = ?').run(data.newName, name);
    getDb().prepare('DELETE FROM categories WHERE name = ?').run(name);
    return getDb().prepare('SELECT * FROM categories WHERE name = ?').get(data.newName);
  }
  return getDb().prepare('SELECT * FROM categories WHERE name = ?').get(name);
}

function deleteCategory(name) {
  if (name === 'default') return;
  getDb().prepare('UPDATE cameras SET category = ? WHERE category = ?').run('default', name);
  getDb().prepare('DELETE FROM categories WHERE name = ?').run(name);
}

function ensureCategoryExists(name) {
  if (!name || name === 'default') return;
  getDb().prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)').run(name, '#58a6ff');
}

// PTZ Presets
function getPresets(cameraId) {
  return getDb().prepare('SELECT * FROM ptz_presets WHERE camera_id = ? ORDER BY preset_number').all(cameraId);
}

function savePreset(cameraId, presetNumber, name) {
  const existing = getDb().prepare('SELECT id FROM ptz_presets WHERE camera_id = ? AND preset_number = ?').get(cameraId, presetNumber);
  if (existing) {
    getDb().prepare('UPDATE ptz_presets SET name = ? WHERE id = ?').run(name, existing.id);
  } else {
    getDb().prepare('INSERT INTO ptz_presets (camera_id, preset_number, name) VALUES (?, ?, ?)').run(cameraId, presetNumber, name);
  }
}

function deletePreset(cameraId, presetNumber) {
  getDb().prepare('DELETE FROM ptz_presets WHERE camera_id = ? AND preset_number = ?').run(cameraId, presetNumber);
}

// ── User CRUD ────────────────────────────────────────────────
function getAllUsers() {
  return getDb().prepare(
    'SELECT id,username,display_name,role,permissions,is_active,force_password_change,created_at,created_by,last_login,last_login_ip FROM users ORDER BY role,username'
  ).all();
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function createUser(data) {
  const stmt = getDb().prepare(`
    INSERT INTO users (username, display_name, password_hash, role, permissions, is_active, force_password_change, created_by)
    VALUES (@username, @display_name, @password_hash, @role, @permissions, @is_active, @force_password_change, @created_by)
  `);
  const r = stmt.run(data);
  return getUserById(r.lastInsertRowid);
}

function updateUser(id, data) {
  const allowed = ['display_name','role','permissions','is_active','force_password_change'];
  const fields = Object.keys(data).filter(k => allowed.includes(k)).map(k => `${k} = @${k}`).join(', ');
  if (!fields) return getUserById(id);
  getDb().prepare(`UPDATE users SET ${fields} WHERE id = @id`).run({ ...data, id });
  return getUserById(id);
}

function updateUserPassword(id, hash) {
  getDb().prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?').run(hash, id);
}

function updateLoginAttempts(id, attempts, lockedUntil) {
  getDb().prepare('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, id);
}

function updateLastLogin(id, ip) {
  getDb().prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, last_login_ip = ?, login_attempts = 0, locked_until = NULL WHERE id = ?').run(ip, id);
}

function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ── Audit Logs ───────────────────────────────────────────────
function createAuditLog(data) {
  getDb().prepare(`
    INSERT INTO audit_logs (user_id, username, action, resource, ip, user_agent, details)
    VALUES (@user_id, @username, @action, @resource, @ip, @user_agent, @details)
  `).run(data);
}

function getAuditLogs({ limit = 200, offset = 0, username = null, action = null } = {}) {
  let q = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (username) { q += ' AND username LIKE ?'; params.push(`%${username}%`); }
  if (action)   { q += ' AND action LIKE ?';   params.push(`%${action}%`); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return getDb().prepare(q).all(...params);
}

// ── Session CRUD (for SQLiteStore) ───────────────────────────
function sessionGet(sid) {
  return getDb().prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
}
function sessionSet(sid, data, expires) {
  getDb().prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)').run(sid, data, expires);
}
function sessionDestroy(sid) {
  getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}
function sessionCleanup() {
  getDb().prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
}
function sessionGetAll() {
  return getDb().prepare('SELECT data FROM sessions WHERE expires > ?').all(Date.now());
}
function sessionDestroyAll() {
  getDb().prepare('DELETE FROM sessions').run();
}

// ── License Plates (circular buffer, max 10 000 rows) ────────
const MAX_PLATES = 10000;
const TRIM_BATCH = 200;   // delete this many oldest when limit reached

function saveLicensePlate({ plate_text, confidence, detected_at }) {
  const d = getDb();
  const count = d.prepare('SELECT COUNT(*) as c FROM license_plates').get().c;
  if (count >= MAX_PLATES) {
    d.prepare(
      'DELETE FROM license_plates WHERE id IN (SELECT id FROM license_plates ORDER BY id ASC LIMIT ?)'
    ).run(TRIM_BATCH);
  }
  const r = d.prepare(
    'INSERT INTO license_plates (plate_text, confidence, detected_at) VALUES (?, ?, ?)'
  ).run(plate_text, confidence || 0, detected_at);
  return { id: r.lastInsertRowid, plate_text, confidence, detected_at };
}

function getRecentPlate(plate_text, seconds) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  return getDb().prepare(
    'SELECT id FROM license_plates WHERE plate_text = ? AND detected_at > ? ORDER BY id DESC LIMIT 1'
  ).get(plate_text, since);
}

function getLicensePlates({ limit = 100, offset = 0, search = '', date = '' } = {}) {
  const d = getDb();
  let q = 'SELECT * FROM license_plates WHERE 1=1';
  const params = [];
  if (search) { q += ' AND plate_text LIKE ?';   params.push(`%${search}%`); }
  if (date)   { q += ' AND detected_at LIKE ?';  params.push(`${date}%`); }
  q += ' ORDER BY detected_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return d.prepare(q).all(...params);
}

function getLicensePlateStats() {
  const d = getDb();
  const today = new Date().toISOString().slice(0, 10);
  return {
    total:  d.prepare('SELECT COUNT(*) as c FROM license_plates').get().c,
    today:  d.prepare('SELECT COUNT(*) as c FROM license_plates WHERE detected_at LIKE ?').get(`${today}%`).c,
    unique: d.prepare('SELECT COUNT(DISTINCT plate_text) as c FROM license_plates').get().c,
    max:    MAX_PLATES
  };
}

function clearLicensePlates() {
  const d = getDb();
  d.prepare('DELETE FROM license_plates').run();
  d.prepare("DELETE FROM sqlite_sequence WHERE name='license_plates'").run();
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getAllCameras, getCameraById, createCamera, updateCamera, deleteCamera,
  getCategories, getCategoryNames, getCamerasByCategory,
  createCategory, updateCategory, deleteCategory, ensureCategoryExists,
  getPresets, savePreset, deletePreset,
  getAllUsers, getUserById, getUserByUsername, createUser, updateUser,
  updateUserPassword, updateLoginAttempts, updateLastLogin, deleteUser,
  createAuditLog, getAuditLogs,
  sessionGet, sessionSet, sessionDestroy, sessionCleanup, sessionGetAll, sessionDestroyAll,
  saveLicensePlate, getRecentPlate, getLicensePlates, getLicensePlateStats, clearLicensePlates,
  closeDb
};

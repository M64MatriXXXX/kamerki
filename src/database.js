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
  `);
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

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getAllCameras,
  getCameraById,
  createCamera,
  updateCamera,
  deleteCamera,
  getCategories,
  getCategoryNames,
  getCamerasByCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  ensureCategoryExists,
  getPresets,
  savePreset,
  deletePreset,
  closeDb
};

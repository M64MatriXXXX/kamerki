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
  const rows = getDb().prepare('SELECT DISTINCT category FROM cameras ORDER BY category').all();
  return rows.map(r => r.category);
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
  getPresets,
  savePreset,
  deletePreset,
  closeDb
};

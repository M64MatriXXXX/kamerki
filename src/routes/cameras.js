'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/cameras
router.get('/', (req, res) => {
  try {
    const cameras = db.getAllCameras();
    // Don't expose passwords in list
    const safe = cameras.map(c => ({ ...c, password: c.password ? '***' : '' }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras
router.post('/', (req, res) => {
  try {
    const { name, ip, port, username, password, rtsp_path, brand, category, lat, lng, enabled } = req.body;
    if (!name || !ip) return res.status(400).json({ error: 'name and ip are required' });

    const camera = db.createCamera({
      name: name.trim(),
      ip: ip.trim(),
      port: parseInt(port) || 554,
      username: username || '',
      password: password || '',
      rtsp_path: rtsp_path || '/Streaming/Channels/101',
      brand: brand || 'generic',
      category: category || 'default',
      lat: lat !== undefined && lat !== '' ? parseFloat(lat) : null,
      lng: lng !== undefined && lng !== '' ? parseFloat(lng) : null,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1
    });
    res.status(201).json(camera);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id
router.get('/:id', (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    res.json(camera);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cameras/:id
router.put('/:id', (req, res) => {
  try {
    const existing = db.getCameraById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    const allowed = ['name', 'ip', 'port', 'username', 'password', 'rtsp_path', 'brand', 'category', 'lat', 'lng', 'enabled'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'port') data[key] = parseInt(req.body[key]) || 554;
        else if (key === 'lat' || key === 'lng') data[key] = req.body[key] !== '' ? parseFloat(req.body[key]) : null;
        else if (key === 'enabled') data[key] = req.body[key] ? 1 : 0;
        else data[key] = req.body[key];
      }
    }

    // Don't overwrite password if placeholder sent
    if (data.password === '***') delete data.password;

    const updated = db.updateCamera(req.params.id, data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', (req, res) => {
  try {
    const existing = db.getCameraById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });
    db.deleteCamera(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories
router.get('/meta/categories', (req, res) => {
  try {
    res.json(db.getCategories());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

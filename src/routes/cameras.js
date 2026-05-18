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

    const cat = (category || 'default').trim();
    db.ensureCategoryExists(cat);
    const camera = db.createCamera({
      name: name.trim(),
      ip: ip.trim(),
      port: parseInt(port) || 554,
      username: username || '',
      password: password || '',
      rtsp_path: rtsp_path || '',
      brand: brand || 'generic',
      category: cat,
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

// POST /api/cameras/import — bulk import
router.post('/import', (req, res) => {
  try {
    const { cameras, skipDuplicates = true, defaultCategory = 'default' } = req.body;
    if (!Array.isArray(cameras) || !cameras.length)
      return res.status(400).json({ error: 'Brak danych do importu' });

    const existingIPs = new Set(db.getAllCameras().map(c => c.ip));
    let imported = 0, skipped = 0, errors = [];

    for (const cam of cameras) {
      try {
        if (!cam.ip) { skipped++; continue; }
        if (skipDuplicates && existingIPs.has(cam.ip.trim())) { skipped++; continue; }
        const cat = (cam.category || defaultCategory || 'default').trim();
        db.ensureCategoryExists(cat);
        db.createCamera({
          name:      (cam.name || cam.ip).trim(),
          ip:        cam.ip.trim(),
          port:      parseInt(cam.port) || 554,
          username:  cam.username || '',
          password:  cam.password || '',
          rtsp_path: cam.rtsp_path || '',
          brand:     cam.brand || 'hikvision',
          category:  cat,
          lat:       cam.lat != null && cam.lat !== '' ? parseFloat(cam.lat) : null,
          lng:       cam.lng != null && cam.lng !== '' ? parseFloat(cam.lng) : null,
          enabled:   cam.enabled !== undefined ? (cam.enabled ? 1 : 0) : 1
        });
        existingIPs.add(cam.ip.trim());
        imported++;
      } catch (e) {
        errors.push({ ip: cam.ip, error: e.message });
      }
    }

    res.json({ success: true, imported, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

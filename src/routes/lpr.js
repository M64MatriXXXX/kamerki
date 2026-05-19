'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../database');
const lprManager = require('../lprManager');

// GET /api/lpr/status
router.get('/status', (req, res) => {
  try {
    res.json({
      ...lprManager.getStatus(),
      stats: db.getLicensePlateStats()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lpr/start
router.post('/start', (req, res) => {
  try {
    const { cameraId, interval } = req.body;
    if (!cameraId) return res.status(400).json({ error: 'cameraId is required' });

    const cam = db.getCameraById(parseInt(cameraId));
    if (!cam) return res.status(404).json({ error: 'Camera not found' });

    const auth = cam.username
      ? `${encodeURIComponent(cam.username)}:${encodeURIComponent(cam.password || '')}@`
      : '';
    const rtspPath = cam.rtsp_path || '/stream1';
    const rtspUrl = `rtsp://${auth}${cam.ip}:${cam.port || 554}${rtspPath}`;

    lprManager.start(rtspUrl, parseFloat(interval) || 1.5);
    res.json({ success: true, camera: cam.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lpr/stop
router.post('/stop', (req, res) => {
  lprManager.stop();
  res.json({ success: true });
});

// GET /api/lpr/plates?limit=100&offset=0&search=&date=
router.get('/plates', (req, res) => {
  try {
    const { limit = 100, offset = 0, search = '', date = '' } = req.query;
    res.json(db.getLicensePlates({
      limit:  Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
      search, date
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/lpr/stats
router.get('/stats', (req, res) => {
  try { res.json(db.getLicensePlateStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/lpr/plates  — clear all records
router.delete('/plates', (req, res) => {
  try {
    db.clearLicensePlates();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

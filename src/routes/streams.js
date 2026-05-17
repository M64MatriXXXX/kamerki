'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../database');
const streamManager = require('../streamManager');

// POST /api/cameras/:id/stream/start
router.post('/start', async (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    if (!camera.enabled) return res.status(400).json({ error: 'Camera is disabled' });

    const result = await streamManager.startStream(camera);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/stream/stop
router.post('/stop', (req, res) => {
  try {
    streamManager.stopStream(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/status
router.get('/status', (req, res) => {
  try {
    const status = streamManager.getStatus(req.params.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

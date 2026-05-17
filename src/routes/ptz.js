'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../database');
const { ptzMove, ptzStop, ptzGotoPreset, ptzSavePreset } = require('../ptzController');

// POST /api/cameras/:id/ptz/move
router.post('/move', async (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const { direction, speed } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction is required' });

    await ptzMove(camera, direction, speed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/ptz/stop
router.post('/stop', async (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    await ptzStop(camera, req.body.direction);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/ptz/presets
router.get('/presets', (req, res) => {
  try {
    const presets = db.getPresets(req.params.id);
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/ptz/preset/save
router.post('/preset/save', async (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const { presetNumber, name } = req.body;
    if (!presetNumber) return res.status(400).json({ error: 'presetNumber is required' });

    // Save to camera hardware
    try {
      await ptzSavePreset(camera, presetNumber);
    } catch (ptzErr) {
      console.warn(`[PTZ] Hardware preset save failed: ${ptzErr.message}`);
    }

    // Save to DB
    db.savePreset(req.params.id, presetNumber, name || `Preset ${presetNumber}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/ptz/preset/goto
router.post('/preset/goto', async (req, res) => {
  try {
    const camera = db.getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const { presetNumber } = req.body;
    if (!presetNumber) return res.status(400).json({ error: 'presetNumber is required' });

    await ptzGotoPreset(camera, presetNumber);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id/ptz/preset/:number
router.delete('/preset/:number', (req, res) => {
  try {
    db.deletePreset(req.params.id, req.params.number);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

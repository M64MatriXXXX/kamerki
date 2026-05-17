'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const streamManager = require('./src/streamManager');
const db = require('./src/database');

const PORT = process.env.PORT || 3000;
const HLS_DIR = process.env.HLS_DIR || path.join(os.tmpdir(), 'nvr-streams');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Track active category in memory
let activeCategory = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// HLS stream serving
app.use('/streams', (req, res) => {
  const filePath = path.join(HLS_DIR, req.path);
  if (!filePath.startsWith(HLS_DIR)) return res.status(403).send('Forbidden');

  if (req.path.endsWith('.m3u8'))    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  else if (req.path.endsWith('.ts')) res.setHeader('Content-Type', 'video/MP2T');

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ── Camera routes ────────────────────────────────────────────
app.use('/api/cameras', require('./src/routes/cameras'));

const streamRouter = require('./src/routes/streams');
const ptzRouter    = require('./src/routes/ptz');
app.use('/api/cameras/:id/stream', streamRouter);
app.use('/api/cameras/:id/ptz',    ptzRouter);

// ── Category routes ──────────────────────────────────────────

// GET /api/categories — list with stats
app.get('/api/categories', (req, res) => {
  try { res.json(db.getCategories()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/categories/active — currently active category
app.get('/api/categories/active', (req, res) => {
  res.json({ activeCategory });
});

// POST /api/categories — create new category
app.post('/api/categories', (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const cat = db.createCategory(name.trim(), color || '#58a6ff');
    res.status(201).json(cat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/categories/:name — rename or change color
app.put('/api/categories/:name', (req, res) => {
  try {
    const cat = db.updateCategory(req.params.name, req.body);
    // If renamed and it was the active category, update activeCategory
    if (req.body.newName && activeCategory === req.params.name) {
      activeCategory = req.body.newName;
    }
    res.json(cat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/categories/:name — delete (reassigns cameras to default)
app.delete('/api/categories/:name', (req, res) => {
  try {
    if (req.params.name === 'default') return res.status(400).json({ error: 'Cannot delete default category' });
    db.deleteCategory(req.params.name);
    if (activeCategory === req.params.name) {
      activeCategory = null;
      io.emit('category_activated', null);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/categories/activate — activate category (start its cameras, stop others)
app.post('/api/categories/activate', async (req, res) => {
  try {
    const { category } = req.body; // null = deactivate all (on-demand mode)
    activeCategory = category || null;

    const allCameras = db.getAllCameras();

    if (!activeCategory) {
      // Deactivate mode — stop all streams, revert to on-demand
      streamManager.shutdown();
      io.emit('category_activated', null);
      return res.json({ success: true, activeCategory: null });
    }

    // Stop cameras NOT in the active category
    const toStop = allCameras.filter(c => c.category !== activeCategory);
    for (const cam of toStop) {
      streamManager.stopStream(cam.id);
    }

    // Start enabled cameras IN the active category
    const toStart = allCameras.filter(c => c.category === activeCategory && c.enabled);
    io.emit('category_activated', activeCategory);

    res.json({ success: true, activeCategory, starting: toStart.length });

    // Start streams async after response
    for (const cam of toStart) {
      const st = streamManager.getStatus(cam.id);
      if (st.status === 'running') continue;
      streamManager.startStream(cam).catch(err => {
        console.error(`[Category] Failed to start camera ${cam.id}: ${err.message}`);
      });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream statuses
app.get('/api/streams/status', (req, res) => {
  res.json(streamManager.getAllStatuses());
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Socket.io ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  const watchedCameras = new Set();

  // Send current state to new client
  socket.emit('category_activated', activeCategory);

  socket.on('watch_camera', async (cameraId) => {
    cameraId = parseInt(cameraId);
    const camera = db.getCameraById(cameraId);
    if (!camera) { socket.emit('stream_error', cameraId, 'Camera not found'); return; }
    if (!camera.enabled) { socket.emit('stream_error', cameraId, 'Camera is disabled'); return; }

    watchedCameras.add(cameraId);
    streamManager.addViewer(cameraId, socket.id);

    const currentStatus = streamManager.getStatus(cameraId);
    if (currentStatus.status === 'running') { socket.emit('stream_ready', cameraId); return; }

    try {
      socket.emit('stream_starting', cameraId);
      await streamManager.startStream(camera);
      socket.emit('stream_ready', cameraId);
    } catch (err) {
      socket.emit('stream_error', cameraId, err.message);
    }
  });

  socket.on('unwatch_camera', (cameraId) => {
    cameraId = parseInt(cameraId);
    watchedCameras.delete(cameraId);
    streamManager.removeViewer(cameraId, socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    streamManager.removeViewerFromAll(socket.id);
  });
});

// Stream manager events → broadcast
streamManager.on('stream_ready',   (id)      => { io.emit('stream_ready', id); io.emit('camera_status', id, 'streaming'); });
streamManager.on('stream_error',   (id, err) => { io.emit('stream_error', id, err); io.emit('camera_status', id, 'error'); });
streamManager.on('stream_stopped', (id)      => { io.emit('camera_status', id, 'stopped'); });

// Init
fs.mkdirSync(HLS_DIR, { recursive: true });

server.listen(PORT, () => {
  console.log(`[NVR] Server running on http://localhost:${PORT}`);
  console.log(`[NVR] HLS streams at /streams/{cameraId}/index.m3u8`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  console.log('[NVR] Shutting down...');
  streamManager.shutdown();
  db.closeDb();
  server.close(() => { console.log('[NVR] Server closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}

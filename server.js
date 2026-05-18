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
const {
  sessionMiddleware, requireAuth, requirePermission,
  auditLog, setupAuthRoutes
} = require('./src/auth');

const PORT    = process.env.PORT    || 3000;
const HLS_DIR = process.env.HLS_DIR || path.join(os.tmpdir(), 'nvr-streams');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Track active category in memory
let activeCategory = null;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

// Session must be before requireAuth
app.use(sessionMiddleware);

// Auth routes (login/logout/me — before requireAuth so login page works)
setupAuthRoutes(app);

// Static files — login.html served directly, index.html only after auth
app.use('/css',    express.static(path.join(__dirname, 'public', 'css')));
app.use('/js',     express.static(path.join(__dirname, 'public', 'js')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// HLS streams — protected
app.use('/streams', requireAuth, (req, res) => {
  const filePath = path.join(HLS_DIR, req.path);
  if (!filePath.startsWith(HLS_DIR)) return res.status(403).send('Forbidden');
  if (req.path.endsWith('.m3u8'))    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  else if (req.path.endsWith('.ts')) res.setHeader('Content-Type', 'video/MP2T');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ── API routes (all protected) ────────────────────────────────
app.use('/api', requireAuth);

// Camera routes
app.use('/api/cameras', require('./src/routes/cameras'));
const streamRouter = require('./src/routes/streams');
const ptzRouter    = require('./src/routes/ptz');
app.use('/api/cameras/:id/stream', streamRouter);
app.use('/api/cameras/:id/ptz',    ptzRouter);

// ── Category routes ───────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  try { res.json(db.getCategories()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/categories/active', (req, res) => {
  res.json({ activeCategory });
});

app.post('/api/categories', requirePermission('manage_categories'), (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const cat = db.createCategory(name.trim(), color || '#58a6ff');
    auditLog(req, 'CREATE_CATEGORY', 'categories', { name });
    res.status(201).json(cat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/categories/:name', requirePermission('manage_categories'), (req, res) => {
  try {
    const cat = db.updateCategory(req.params.name, req.body);
    if (req.body.newName && activeCategory === req.params.name) activeCategory = req.body.newName;
    auditLog(req, 'UPDATE_CATEGORY', 'categories', { name: req.params.name });
    res.json(cat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:name', requirePermission('manage_categories'), (req, res) => {
  try {
    if (req.params.name === 'default') return res.status(400).json({ error: 'Cannot delete default category' });
    db.deleteCategory(req.params.name);
    if (activeCategory === req.params.name) { activeCategory = null; io.emit('category_activated', null); }
    auditLog(req, 'DELETE_CATEGORY', 'categories', { name: req.params.name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories/activate', requirePermission('manage_categories'), async (req, res) => {
  try {
    const { category } = req.body;
    activeCategory = category || null;
    const allCameras = db.getAllCameras();
    if (!activeCategory) {
      streamManager.shutdown();
      io.emit('category_activated', null);
      return res.json({ success: true, activeCategory: null });
    }
    allCameras.filter(c => c.category !== activeCategory).forEach(c => streamManager.stopStream(c.id));
    const toStart = allCameras.filter(c => c.category === activeCategory && c.enabled);
    io.emit('category_activated', activeCategory);
    res.json({ success: true, activeCategory, starting: toStart.length });
    for (const cam of toStart) {
      if (streamManager.getStatus(cam.id).status === 'running') continue;
      streamManager.startStream(cam).catch(e => console.error(`[Category] ${cam.id}: ${e.message}`));
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream statuses
app.get('/api/streams/status', (req, res) => {
  res.json(streamManager.getAllStatuses());
});

// Stop all running streams
app.post('/api/streams/stop-all', requirePermission('manage_categories'), (req, res) => {
  try {
    streamManager.shutdown();
    auditLog(req, 'STOP_ALL_STREAMS', 'streams', {});
    io.emit('streams_stopped_all');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SPA fallback (protected) ──────────────────────────────────
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Socket.io (session-aware) ─────────────────────────────────
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess?.userId) { socket.disconnect(true); return; }

  console.log(`[Socket] ${sess.username} connected (${socket.id})`);
  const watchedCameras = new Set();
  const inProgress = new Set();

  socket.emit('category_activated', activeCategory);

  socket.on('watch_camera', async (cameraId) => {
    cameraId = parseInt(cameraId);
    if (isNaN(cameraId) || inProgress.has(cameraId)) return;
    inProgress.add(cameraId);
    try {
      const camera = db.getCameraById(cameraId);
      if (!camera) { socket.emit('stream_error', cameraId, 'Camera not found'); return; }
      if (!camera.enabled) { socket.emit('stream_error', cameraId, 'Camera is disabled'); return; }
      watchedCameras.add(cameraId);
      streamManager.addViewer(cameraId, socket.id);
      const st = streamManager.getStatus(cameraId);
      if (st.status === 'running') { socket.emit('stream_ready', cameraId); return; }
      socket.emit('stream_starting', cameraId);
      await streamManager.startStream(camera);
      socket.emit('stream_ready', cameraId);
    } catch (err) {
      socket.emit('stream_error', cameraId, err.message);
    } finally {
      inProgress.delete(cameraId);
    }
  });

  socket.on('unwatch_camera', (cameraId) => {
    cameraId = parseInt(cameraId);
    watchedCameras.delete(cameraId);
    streamManager.removeViewer(cameraId, socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] ${sess.username} disconnected (${socket.id})`);
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
  console.log(`[NVR] Default login: admin / admin1234`);
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

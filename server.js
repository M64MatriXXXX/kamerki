'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const streamManager = require('./src/streamManager');
const db = require('./src/database');

const PORT = process.env.PORT || 3000;
const HLS_DIR = process.env.HLS_DIR || '/tmp/nvr-streams';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// HLS stream serving
app.use('/streams', (req, res, next) => {
  const filePath = path.join(HLS_DIR, req.path);
  // Security: ensure path is within HLS_DIR
  if (!filePath.startsWith(HLS_DIR)) {
    return res.status(403).send('Forbidden');
  }

  if (req.path.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  } else if (req.path.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/MP2T');
  }

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }

  res.sendFile(filePath);
});

// API Routes
app.use('/api/cameras', require('./src/routes/cameras'));

// Mount stream and ptz routes with camera id param
const streamRouter = require('./src/routes/streams');
const ptzRouter = require('./src/routes/ptz');
app.use('/api/cameras/:id/stream', streamRouter);
app.use('/api/cameras/:id/ptz', ptzRouter);

// Categories endpoint
app.get('/api/categories', (req, res) => {
  try {
    res.json(db.getCategories());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream statuses
app.get('/api/streams/status', (req, res) => {
  res.json(streamManager.getAllStatuses());
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  const watchedCameras = new Set();

  socket.on('watch_camera', async (cameraId) => {
    cameraId = parseInt(cameraId);
    const camera = db.getCameraById(cameraId);
    if (!camera) {
      socket.emit('stream_error', cameraId, 'Camera not found');
      return;
    }
    if (!camera.enabled) {
      socket.emit('stream_error', cameraId, 'Camera is disabled');
      return;
    }

    watchedCameras.add(cameraId);
    streamManager.addViewer(cameraId, socket.id);

    const currentStatus = streamManager.getStatus(cameraId);
    if (currentStatus.status === 'running') {
      socket.emit('stream_ready', cameraId);
      return;
    }

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

// Stream manager events -> broadcast to all clients
streamManager.on('stream_ready', (cameraId) => {
  io.emit('stream_ready', cameraId);
  io.emit('camera_status', cameraId, 'streaming');
});

streamManager.on('stream_error', (cameraId, error) => {
  io.emit('stream_error', cameraId, error);
  io.emit('camera_status', cameraId, 'error');
});

streamManager.on('stream_stopped', (cameraId) => {
  io.emit('camera_status', cameraId, 'stopped');
});

// Ensure HLS dir exists
fs.mkdirSync(HLS_DIR, { recursive: true });

// Start server
server.listen(PORT, () => {
  console.log(`[NVR] Server running on http://localhost:${PORT}`);
  console.log(`[NVR] HLS streams at /streams/{cameraId}/index.m3u8`);
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('[NVR] Shutting down...');
  streamManager.shutdown();
  db.closeDb();
  server.close(() => {
    console.log('[NVR] Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

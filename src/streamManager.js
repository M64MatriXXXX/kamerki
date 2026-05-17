'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const HLS_DIR = process.env.HLS_DIR || '/tmp/nvr-streams';
const VIEWER_TIMEOUT_MS = parseInt(process.env.VIEWER_TIMEOUT || '30000', 10);

class StreamManager extends EventEmitter {
  constructor() {
    super();
    // Map<cameraId, {process, viewers: Set<socketId>, lastViewerLeft: Date, status, startTime}>
    this.streams = new Map();
    this.timeouts = new Map();
  }

  _getStreamDir(cameraId) {
    return path.join(HLS_DIR, String(cameraId));
  }

  _ensureDir(cameraId) {
    const dir = this._getStreamDir(cameraId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  _buildRtspUrl(camera) {
    const auth = camera.username
      ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password || '')}@`
      : '';
    const rtspPath = camera.rtsp_path || '/Streaming/Channels/101';
    return `rtsp://${auth}${camera.ip}:${camera.port || 554}${rtspPath}`;
  }

  startStream(camera) {
    const cameraId = camera.id;

    // If stream already running, return immediately
    if (this.streams.has(cameraId)) {
      const stream = this.streams.get(cameraId);
      if (stream.status === 'running') {
        return Promise.resolve({ hlsUrl: `/streams/${cameraId}/index.m3u8` });
      }
    }

    return new Promise((resolve, reject) => {
      const dir = this._ensureDir(cameraId);
      const hlsPath = path.join(dir, 'index.m3u8');
      const segmentPattern = path.join(dir, '%03d.ts');
      const rtspUrl = this._buildRtspUrl(camera);

      // Clean up old segments
      try {
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
            try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
          }
        });
      } catch (_) {}

      const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-hls_time', '2',
        '-hls_list_size', '3',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segmentPattern,
        '-f', 'hls',
        hlsPath
      ];

      const proc = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const streamInfo = {
        process: proc,
        viewers: new Set(),
        lastViewerLeft: null,
        status: 'starting',
        startTime: new Date(),
        cameraId
      };

      this.streams.set(cameraId, streamInfo);
      this.emit('stream_starting', cameraId);

      let resolved = false;
      let errorOutput = '';

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;

        // Detect when HLS output starts
        if (!resolved && (text.includes('Opening') || text.includes('index.m3u8'))) {
          // Wait a moment for the first segment
        }
      });

      // Poll for HLS file creation
      const checkInterval = setInterval(() => {
        if (fs.existsSync(hlsPath)) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            streamInfo.status = 'running';
            this.emit('stream_ready', cameraId);
            resolve({ hlsUrl: `/streams/${cameraId}/index.m3u8` });
          }
        }
      }, 500);

      // Timeout if stream doesn't start
      const startTimeout = setTimeout(() => {
        clearInterval(checkInterval);
        if (!resolved) {
          resolved = true;
          if (!fs.existsSync(hlsPath)) {
            streamInfo.status = 'error';
            this.emit('stream_error', cameraId, 'Stream failed to start');
            reject(new Error('Stream failed to start within timeout'));
          } else {
            streamInfo.status = 'running';
            this.emit('stream_ready', cameraId);
            resolve({ hlsUrl: `/streams/${cameraId}/index.m3u8` });
          }
        }
      }, 15000);

      proc.on('error', (err) => {
        clearInterval(checkInterval);
        clearTimeout(startTimeout);
        streamInfo.status = 'error';
        this.streams.delete(cameraId);
        this.emit('stream_error', cameraId, err.message);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on('close', (code) => {
        clearInterval(checkInterval);
        clearTimeout(startTimeout);
        this.streams.delete(cameraId);
        this._clearTimeout(cameraId);
        if (streamInfo.status !== 'error') {
          streamInfo.status = 'stopped';
        }
        this.emit('stream_stopped', cameraId);
        if (!resolved) {
          resolved = true;
          reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput.slice(-500)}`));
        }
      });
    });
  }

  stopStream(cameraId) {
    this._clearTimeout(cameraId);
    const stream = this.streams.get(cameraId);
    if (!stream) return;

    stream.status = 'stopping';
    try {
      stream.process.kill('SIGTERM');
      setTimeout(() => {
        try { stream.process.kill('SIGKILL'); } catch (_) {}
      }, 3000);
    } catch (_) {}

    this.streams.delete(cameraId);
    this.emit('stream_stopped', cameraId);

    // Clean up HLS files
    const dir = this._getStreamDir(cameraId);
    try {
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
        }
      });
    } catch (_) {}
  }

  addViewer(cameraId, socketId) {
    const stream = this.streams.get(cameraId);
    if (stream) {
      stream.viewers.add(socketId);
      this._clearTimeout(cameraId);
    }
  }

  removeViewer(cameraId, socketId) {
    const stream = this.streams.get(cameraId);
    if (stream) {
      stream.viewers.delete(socketId);
      stream.lastViewerLeft = new Date();

      if (stream.viewers.size === 0) {
        this._scheduleStop(cameraId);
      }
    }
  }

  removeViewerFromAll(socketId) {
    for (const [cameraId, stream] of this.streams) {
      if (stream.viewers.has(socketId)) {
        this.removeViewer(cameraId, socketId);
      }
    }
  }

  _scheduleStop(cameraId) {
    this._clearTimeout(cameraId);
    const timeout = setTimeout(() => {
      const stream = this.streams.get(cameraId);
      if (stream && stream.viewers.size === 0) {
        console.log(`[StreamManager] No viewers for camera ${cameraId}, stopping stream`);
        this.stopStream(cameraId);
      }
    }, VIEWER_TIMEOUT_MS);
    this.timeouts.set(cameraId, timeout);
  }

  _clearTimeout(cameraId) {
    if (this.timeouts.has(cameraId)) {
      clearTimeout(this.timeouts.get(cameraId));
      this.timeouts.delete(cameraId);
    }
  }

  getStatus(cameraId) {
    const stream = this.streams.get(cameraId);
    if (!stream) return { status: 'stopped', viewers: 0 };
    return {
      status: stream.status,
      viewers: stream.viewers.size,
      startTime: stream.startTime,
      hlsUrl: `/streams/${cameraId}/index.m3u8`
    };
  }

  getAllStatuses() {
    const result = {};
    for (const [cameraId, stream] of this.streams) {
      result[cameraId] = {
        status: stream.status,
        viewers: stream.viewers.size,
        startTime: stream.startTime
      };
    }
    return result;
  }

  shutdown() {
    console.log('[StreamManager] Shutting down all streams...');
    for (const [cameraId] of this.streams) {
      this.stopStream(cameraId);
    }
  }
}

module.exports = new StreamManager();

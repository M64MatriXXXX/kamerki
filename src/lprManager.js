'use strict';

const { spawn }    = require('child_process');
const path         = require('path');
const EventEmitter = require('events');
const db           = require('./database');

const DETECTOR_PATH  = path.join(__dirname, 'lpr', 'detector.py');
const DEDUPE_MS      = 5 * 60 * 1000;  // 5 minutes — same physical car window
const FUZZY_DIST     = 2;              // Levenshtein ≤ 2 → treat as same plate

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

class LPRManager extends EventEmitter {
  constructor() {
    super();
    this.proc        = null;
    this.running     = false;
    this.status      = 'stopped';
    this.statusMsg   = '';
    this.rtspUrl     = null;
    this.cameraId    = null;
    this.lastFrameTs = null;
    this._buf        = '';
    // In-memory recent plates cache: text → {confidence, ts}
    this._recentPlates = new Map();
  }

  start(rtspUrl, cameraId = null) {
    if (this.running && this.rtspUrl === rtspUrl) return;
    if (this.running) this.stop();

    this.rtspUrl  = rtspUrl;
    this.cameraId = cameraId;
    this.running  = true;
    this._buf     = '';
    this._recentPlates.clear();
    this._setStatus('initializing', 'Starting detector...');

    console.log(`[LPR] Spawning detector for camera ${cameraId}`);

    try {
      this.proc = spawn('python3', [DETECTOR_PATH, rtspUrl], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      this._setStatus('error', `Spawn failed: ${e.message}`);
      this.running = false;
      return;
    }

    this.proc.stdout.on('data', (chunk) => {
      this._buf += chunk.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) !== -1) {
        const line = this._buf.slice(0, nl).trim();
        this._buf = this._buf.slice(nl + 1);
        if (!line) continue;
        try { this._handleMsg(JSON.parse(line)); } catch (_) {}
      }
    });

    this.proc.stderr.on('data', (d) => {
      const t = d.toString().trim();
      if (t) console.error('[LPR stderr]', t.slice(0, 200));
    });

    this.proc.on('exit', (code) => {
      this.running = false;
      this.proc    = null;
      this._setStatus('stopped', `Process exited (code ${code})`);
    });

    this.proc.on('error', (e) => {
      this.running = false;
      this.proc    = null;
      this._setStatus('error', e.message);
    });
  }

  stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      const p = this.proc;
      setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, 3000);
      this.proc = null;
    }
    this.running = false;
    this._recentPlates.clear();
    this._setStatus('stopped');
  }

  getStatus() {
    return {
      running:     this.running,
      status:      this.status,
      statusMsg:   this.statusMsg,
      rtspUrl:     this.rtspUrl,
      cameraId:    this.cameraId,
      lastFrameTs: this.lastFrameTs
    };
  }

  _setStatus(status, msg = '') {
    this.status    = status;
    this.statusMsg = msg;
    this.emit('status', { status, msg });
  }

  // Returns the cached plate text that fuzzy-matches, or null
  _fuzzyMatch(text) {
    const now = Date.now();
    for (const [cached, entry] of this._recentPlates) {
      if (now - entry.ts > DEDUPE_MS) {
        this._recentPlates.delete(cached);
        continue;
      }
      if (levenshtein(text, cached) <= FUZZY_DIST) return cached;
    }
    return null;
  }

  _handleMsg(msg) {
    if (msg.status) {
      const s = msg.status;
      if (['initializing','connecting','connected','running','error','reconnecting','ready'].includes(s)) {
        this._setStatus(s, msg.msg || '');
      }
    }

    if (Array.isArray(msg.detections) && msg.detections.length > 0) {
      const saved = [];
      for (const det of msg.detections) {
        if (!det.text) continue;
        try {
          // Fuzzy in-memory check first (fast, catches variants like NEL vs EL)
          const match = this._fuzzyMatch(det.text);
          if (match) {
            // Update timestamp so the window extends while car is still in view
            const entry = this._recentPlates.get(match);
            if (entry && det.confidence > entry.confidence) {
              // Better reading — update cache but don't save again to DB
              this._recentPlates.set(match, { confidence: det.confidence, ts: entry.ts });
            }
            continue;
          }

          // New unique plate — save to DB
          const rec = db.saveLicensePlate({
            plate_text:  det.text,
            confidence:  det.confidence,
            detected_at: new Date().toISOString()
          });
          this._recentPlates.set(det.text, { confidence: det.confidence, ts: Date.now() });
          saved.push(rec);
        } catch (e) {
          console.error('[LPR] DB error:', e.message);
        }
      }
      if (saved.length > 0) this.emit('plates_saved', saved);
    }
  }
}

module.exports = new LPRManager();

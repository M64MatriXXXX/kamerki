'use strict';

const { spawn }      = require('child_process');
const path           = require('path');
const EventEmitter   = require('events');
const db             = require('./database');

const DETECTOR_PATH  = path.join(__dirname, 'lpr', 'detector.py');
const DEDUPE_SECONDS = 60;   // don't re-record same plate within this window

class LPRManager extends EventEmitter {
  constructor() {
    super();
    this.proc       = null;
    this.running    = false;
    this.status     = 'stopped';   // stopped|initializing|connecting|connected|running|error|reconnecting
    this.statusMsg  = '';
    this.rtspUrl    = null;
    this.interval   = 1.5;
    this.lastFrameTs = null;
    this._buf       = '';
  }

  start(rtspUrl, intervalSec = 1.5) {
    if (this.running && this.rtspUrl === rtspUrl) return;
    if (this.running) this.stop();

    this.rtspUrl  = rtspUrl;
    this.interval = intervalSec;
    this.running  = true;
    this._buf     = '';
    this._setStatus('initializing', 'Starting detector...');

    const args = ['python3', DETECTOR_PATH, rtspUrl, String(intervalSec)];
    console.log(`[LPR] Spawning: ${args.join(' ')}`);

    try {
      this.proc = spawn('python3', [DETECTOR_PATH, rtspUrl, String(intervalSec)], {
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
      console.log(`[LPR] Process exited code=${code}`);
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
    this._setStatus('stopped');
  }

  getStatus() {
    return {
      running:     this.running,
      status:      this.status,
      statusMsg:   this.statusMsg,
      rtspUrl:     this.rtspUrl,
      interval:    this.interval,
      lastFrameTs: this.lastFrameTs
    };
  }

  _setStatus(status, msg = '') {
    this.status    = status;
    this.statusMsg = msg;
    this.emit('status', { status, msg });
  }

  _handleMsg(msg) {
    // Status updates
    if (msg.status) {
      const s = msg.status;
      if (['initializing','connecting','connected','running','error','reconnecting','ready'].includes(s)) {
        this._setStatus(s, msg.msg || '');
      }
    }

    // Annotated frame
    if (msg.frame) {
      this.lastFrameTs = new Date().toISOString();
      this.emit('frame', {
        frame:      msg.frame,
        detections: msg.detections || [],
        ts:         msg.ts || Date.now() / 1000
      });
    }

    // Save new plates (with deduplication)
    if (Array.isArray(msg.detections) && msg.detections.length > 0) {
      const saved = [];
      for (const det of msg.detections) {
        if (!det.text) continue;
        try {
          const recent = db.getRecentPlate(det.text, DEDUPE_SECONDS);
          if (!recent) {
            const rec = db.saveLicensePlate({
              plate_text:  det.text,
              confidence:  det.confidence,
              detected_at: new Date().toISOString()
            });
            saved.push(rec);
          }
        } catch (e) {
          console.error('[LPR] DB error:', e.message);
        }
      }
      if (saved.length > 0) this.emit('plates_saved', saved);
    }
  }
}

module.exports = new LPRManager();

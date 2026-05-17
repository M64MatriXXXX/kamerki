'use strict';

/* ============================================================
   NVR Pro — Main App Module
   ============================================================ */

// Global state
window.NVR = {
  socket: null,
  cameras: [],
  streamStatuses: {},
  currentPage: 'dashboard',
  pages: {}
};

/* ============================================================
   Toast notifications
   ============================================================ */
window.NVR.toast = (function () {
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

  return function toast(type, title, msg, duration = 3500) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(100%)';
      el.style.transition = 'all .25s ease';
      setTimeout(() => el.remove(), 260);
    }, duration);
  };
})();

/* ============================================================
   API helpers
   ============================================================ */
window.NVR.api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
  async post(path, data) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
  async put(path, data) {
    const r = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  }
};

/* ============================================================
   Camera store
   ============================================================ */
window.NVR.loadCameras = async function () {
  try {
    const cameras = await NVR.api.get('/api/cameras');
    NVR.cameras = cameras;
    return cameras;
  } catch (err) {
    console.error('[NVR] Failed to load cameras:', err);
    return [];
  }
};

/* ============================================================
   Camera modal (shared by Dashboard and Camera List)
   ============================================================ */
window.NVR.cameraModal = (function () {
  const overlay = document.getElementById('cameraModal');
  const titleEl = document.getElementById('modalTitle');
  const form    = document.getElementById('cameraForm');
  const saveBtn = document.getElementById('modalSave');
  const cancelBtn = document.getElementById('modalCancel');
  const closeBtn  = document.getElementById('modalClose');

  let onSaveCallback = null;

  function getFormData() {
    return {
      name:      document.getElementById('fName').value.trim(),
      ip:        document.getElementById('fIp').value.trim(),
      port:      parseInt(document.getElementById('fPort').value) || 554,
      username:  document.getElementById('fUsername').value,
      password:  document.getElementById('fPassword').value,
      rtsp_path: document.getElementById('fRtspPath').value.trim(),
      brand:     document.getElementById('fBrand').value,
      category:  document.getElementById('fCategory').value.trim() || 'default',
      lat:       document.getElementById('fLat').value !== '' ? parseFloat(document.getElementById('fLat').value) : null,
      lng:       document.getElementById('fLng').value !== '' ? parseFloat(document.getElementById('fLng').value) : null,
      enabled:   parseInt(document.getElementById('fEnabled').value)
    };
  }

  function setFormData(camera) {
    document.getElementById('cameraId').value   = camera.id || '';
    document.getElementById('fName').value      = camera.name || '';
    document.getElementById('fIp').value        = camera.ip || '';
    document.getElementById('fPort').value      = camera.port || 554;
    document.getElementById('fUsername').value  = camera.username || '';
    document.getElementById('fPassword').value  = camera.password === '***' ? '' : (camera.password || '');
    document.getElementById('fRtspPath').value  = camera.rtsp_path || '/Streaming/Channels/101';
    document.getElementById('fBrand').value     = camera.brand || 'generic';
    document.getElementById('fCategory').value  = camera.category || 'default';
    document.getElementById('fLat').value       = camera.lat != null ? camera.lat : '';
    document.getElementById('fLng').value       = camera.lng != null ? camera.lng : '';
    document.getElementById('fEnabled').value   = camera.enabled !== undefined ? String(camera.enabled) : '1';
  }

  function refreshCategoryList() {
    NVR.api.get('/api/categories').then(cats => {
      const dl = document.getElementById('categoryList');
      dl.innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');
    }).catch(() => {});
  }

  function open(camera, onSave) {
    onSaveCallback = onSave || null;
    if (camera) {
      titleEl.textContent = 'Edit Camera';
      setFormData(camera);
    } else {
      titleEl.textContent = 'Add Camera';
      form.reset();
      document.getElementById('cameraId').value = '';
      document.getElementById('fPort').value = '554';
      document.getElementById('fRtspPath').value = '/Streaming/Channels/101';
      document.getElementById('fBrand').value = 'generic';
      document.getElementById('fEnabled').value = '1';
    }
    refreshCategoryList();
    overlay.classList.add('open');
    document.getElementById('fName').focus();
  }

  function close() {
    overlay.classList.remove('open');
  }

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  saveBtn.addEventListener('click', async () => {
    const id = document.getElementById('cameraId').value;
    const data = getFormData();

    if (!data.name || !data.ip) {
      NVR.toast('error', 'Validation Error', 'Name and IP are required');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      let camera;
      if (id) {
        camera = await NVR.api.put(`/api/cameras/${id}`, data);
        NVR.toast('success', 'Camera Updated', camera.name);
      } else {
        camera = await NVR.api.post('/api/cameras', data);
        NVR.toast('success', 'Camera Added', camera.name);
      }
      close();
      await NVR.loadCameras();
      if (onSaveCallback) onSaveCallback(camera);
    } catch (err) {
      NVR.toast('error', 'Save Failed', err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Camera';
    }
  });

  return { open, close };
})();

/* ============================================================
   Socket.io connection
   ============================================================ */
function initSocket() {
  const socket = io({ transports: ['websocket', 'polling'] });
  NVR.socket = socket;

  const dot  = document.querySelector('#connectionStatus .status-dot');
  const text = document.querySelector('#connectionStatus .status-text');

  socket.on('connect', () => {
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
    NVR.toast('success', 'Connected', 'Real-time updates active', 2000);
  });

  socket.on('disconnect', () => {
    dot.className = 'status-dot offline';
    text.textContent = 'Disconnected';
  });

  socket.on('connect_error', () => {
    dot.className = 'status-dot connecting';
    text.textContent = 'Reconnecting...';
  });

  socket.on('camera_status', (cameraId, status) => {
    NVR.streamStatuses[cameraId] = status;
    // Notify all registered listeners
    NVR._statusListeners.forEach(fn => fn(cameraId, status));
  });

  socket.on('stream_ready', (cameraId) => {
    NVR.streamStatuses[cameraId] = 'streaming';
    NVR._streamReadyListeners.forEach(fn => fn(cameraId));
  });

  socket.on('stream_error', (cameraId, error) => {
    NVR.streamStatuses[cameraId] = 'error';
    NVR._streamErrorListeners.forEach(fn => fn(cameraId, error));
  });

  socket.on('stream_starting', (cameraId) => {
    NVR.streamStatuses[cameraId] = 'starting';
    NVR._statusListeners.forEach(fn => fn(cameraId, 'starting'));
  });
}

NVR._statusListeners      = [];
NVR._streamReadyListeners = [];
NVR._streamErrorListeners = [];

/* ============================================================
   HLS Player helper
   ============================================================ */
window.NVR.createPlayer = function (videoEl, cameraId) {
  const url = `/streams/${cameraId}/index.m3u8`;

  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 0,
      maxBufferLength: 10,
      liveSyncDurationCount: 2
    });
    hls.loadSource(url);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn(`[HLS] Fatal error for camera ${cameraId}:`, data);
        hls.destroy();
      }
    });
    return hls;
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = url;
    videoEl.play().catch(() => {});
    return null;
  }
  return null;
};

/* ============================================================
   Router
   ============================================================ */
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  cameras:   'Cameras',
  map:       'Map View',
  settings:  'Settings'
};

function navigateTo(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update page visibility
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Update title
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page];

  NVR.currentPage = page;

  // Init page if needed
  const initFn = NVR.pages[page];
  if (initFn) initFn();

  // Clear topbar actions then let page re-render them
  document.getElementById('topbarActions').innerHTML = '';
  const renderFn = NVR.pagesRenderTopbar && NVR.pagesRenderTopbar[page];
  if (renderFn) renderFn();
}

/* ============================================================
   App init
   ============================================================ */
async function initApp() {
  // Sidebar toggle
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });

  // Nav links
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Load initial data
  await NVR.loadCameras();

  // Init socket
  initSocket();

  // Navigate to current hash or default
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

/* ============================================================
   Settings Page
   ============================================================ */
NVR.pages.settings = function initSettings() {
  const page = document.getElementById('page-settings');
  page.innerHTML = '';

  const content = document.createElement('div');
  content.className = 'settings-content';

  content.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-header">Server Information</div>
      <div class="settings-row">
        <div>
          <div class="settings-label">HLS Stream Directory</div>
          <div class="settings-desc">Where FFmpeg writes HLS segments</div>
        </div>
        <code class="settings-val">/tmp/nvr-streams</code>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Stream Idle Timeout</div>
          <div class="settings-desc">FFmpeg stops after this period with no viewers</div>
        </div>
        <code class="settings-val">30 seconds</code>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">HLS Segment Duration</div>
          <div class="settings-desc">Each video chunk duration</div>
        </div>
        <code class="settings-val">2 seconds</code>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">Camera Statistics</div>
      <div class="settings-row" id="settingsCamCount">
        <div>
          <div class="settings-label">Total Cameras</div>
          <div class="settings-desc">Cameras registered in the database</div>
        </div>
        <code class="settings-val" id="settingsTotal">—</code>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Enabled Cameras</div>
          <div class="settings-desc">Cameras available for streaming</div>
        </div>
        <code class="settings-val" id="settingsEnabled">—</code>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Active Streams</div>
          <div class="settings-desc">Currently running FFmpeg processes</div>
        </div>
        <code class="settings-val" id="settingsStreaming">—</code>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">Supported Hardware</div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Hikvision</div>
          <div class="settings-desc">PTZ via ISAPI REST — http://IP/ISAPI/PTZCtrl/channels/1/continuous</div>
        </div>
        <span class="settings-val" style="color:var(--success)">Supported</span>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Dahua</div>
          <div class="settings-desc">PTZ via CGI — http://IP/cgi-bin/ptz.cgi</div>
        </div>
        <span class="settings-val" style="color:var(--success)">Supported</span>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Generic RTSP</div>
          <div class="settings-desc">Any camera with RTSP stream (no PTZ)</div>
        </div>
        <span class="settings-val" style="color:var(--accent)">Stream only</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">About</div>
      <div class="settings-row">
        <div>
          <div class="settings-label">NVR Pro</div>
          <div class="settings-desc">Web-based Network Video Recorder — Ełk, Poland</div>
        </div>
        <code class="settings-val">v1.0.0</code>
      </div>
    </div>
  `;

  page.appendChild(content);

  // Populate stats
  const total     = NVR.cameras.length;
  const enabled   = NVR.cameras.filter(c => c.enabled).length;
  const streaming = Object.values(NVR.streamStatuses).filter(s => s === 'streaming').length;

  const el = id => document.getElementById(id);
  if (el('settingsTotal'))     el('settingsTotal').textContent     = total;
  if (el('settingsEnabled'))   el('settingsEnabled').textContent   = enabled;
  if (el('settingsStreaming'))  el('settingsStreaming').textContent = streaming;
};

// Wait for all scripts to load
window.addEventListener('load', initApp);

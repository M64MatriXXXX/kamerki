'use strict';

/* ============================================================
   NVR Pro — Main App Module
   ============================================================ */

// Global state
window.NVR = {
  socket: null,
  cameras: [],
  streamStatuses: {},
  activeCategory: null,
  currentPage: 'dashboard',
  currentUser: null,
  pages: {}
};

const PAGE_TITLES_MAP = {
  dashboard: 'Dashboard',
  cameras:   'Cameras',
  map:       'Map View',
  settings:  'Settings',
  admin:     'Panel Administratora'
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
    document.getElementById('fRtspPath').value  = camera.rtsp_path != null ? camera.rtsp_path : '';
    document.getElementById('fBrand').value     = camera.brand || 'generic';
    document.getElementById('fCategory').value  = camera.category || 'default';
    document.getElementById('fLat').value       = camera.lat != null ? camera.lat : '';
    document.getElementById('fLng').value       = camera.lng != null ? camera.lng : '';
    document.getElementById('fEnabled').value   = camera.enabled !== undefined ? String(camera.enabled) : '1';
  }

  function refreshCategoryList() {
    NVR.api.get('/api/categories').then(cats => {
      const dl = document.getElementById('categoryList');
      dl.innerHTML = cats.map(c => `<option value="${c.name}"></option>`).join('');
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
      document.getElementById('fRtspPath').value = '';
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

  socket.on('category_activated', (categoryName) => {
    // Only update which streams are running on the server — never change this client's view
    NVR.activeCategory = categoryName;
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
      // Stay as close to live edge as possible
      liveSyncDurationCount:      1,    // target: 1 segment behind live
      liveMaxLatencyDurationCount: 2,   // max: 2 segments behind live
      // Buffer limits — keep small for live/PTZ use
      maxBufferLength:   2,
      maxMaxBufferLength: 4,
      backBufferLength:  0,
      // Catch up faster when lagging behind live
      maxLiveSyncPlaybackRate: 2,
      // Don't wait long for fragments
      fragLoadingTimeOut:    8000,
      manifestLoadingTimeOut: 5000,
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
const PAGE_TITLES = PAGE_TITLES_MAP;

function navigateTo(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';

  // Update desktop nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update page visibility
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Update title
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page];

  NVR.currentPage = page;

  // Close sidebar on mobile after navigation
  document.body.classList.remove('sidebar-open');

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
  // Load current user info
  try {
    NVR.currentUser = await NVR.api.get('/api/auth/me');
  } catch (e) {
    window.location.href = '/login';
    return;
  }

  // Populate sidebar user info
  const avatarEl = document.getElementById('sidebarAvatar');
  const nameEl   = document.getElementById('sidebarUsername');
  const roleEl   = document.getElementById('sidebarRole');
  const roleLabels = { admin: 'Administrator', operator: 'Operator', viewer: 'Przeglądający' };

  if (avatarEl && NVR.currentUser) {
    const initials = (NVR.currentUser.displayName || NVR.currentUser.username)[0].toUpperCase();
    const colors   = ['#1f6feb','#388bfd','#3fb950','#d29922','#f85149','#bc8cff'];
    let h = 0;
    for (const c of (NVR.currentUser.username || '')) h = (h * 31 + c.charCodeAt(0)) % colors.length;
    avatarEl.textContent   = initials;
    avatarEl.style.background = colors[Math.abs(h)];
    nameEl.textContent     = NVR.currentUser.displayName || NVR.currentUser.username;
    roleEl.textContent     = roleLabels[NVR.currentUser.role] || NVR.currentUser.role;
  }

  // Show admin nav link for admins
  if (NVR.currentUser?.role === 'admin') {
    document.querySelectorAll('.nav-admin').forEach(el => el.style.display = '');
  }

  // Logout button
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Desktop sidebar toggle
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });

  // Sidebar backdrop (mobile) — click to close
  document.getElementById('sidebarBackdrop').addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
  });

  // Desktop nav links
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Bottom nav links (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Mobile swipe-right-from-edge to open sidebar
  initSwipeGestures();

  // Load initial data
  await NVR.loadCameras();

  // Init socket
  initSocket();

  // Navigate to current hash or default
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

/* ============================================================
   Swipe gestures (mobile sidebar)
   ============================================================ */
function initSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // Only horizontal swipes (more horizontal than vertical)
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (Math.abs(dx) < 50) return;

    // Swipe right from left edge → open sidebar
    if (dx > 0 && touchStartX < 30) {
      document.body.classList.add('sidebar-open');
    }
    // Swipe left → close sidebar
    if (dx < 0 && document.body.classList.contains('sidebar-open')) {
      document.body.classList.remove('sidebar-open');
    }
  }, { passive: true });
}

/* ============================================================
   Settings Page
   ============================================================ */
NVR.pages.settings = async function initSettings() {
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

    <div class="settings-section" id="settingsCategoriesSection">
      <div class="settings-section-header" style="display:flex;justify-content:space-between;align-items:center">
        <span>Zarządzanie Kategoriami</span>
        <button class="btn btn-sm btn-primary" id="settingsAddCatBtn">+ Nowa kategoria</button>
      </div>
      <div id="settingsCatList"><div style="padding:14px 18px;color:var(--text-dim);font-size:13px">Ładowanie...</div></div>
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

  // Populate categories list
  loadSettingsCategories();

  document.getElementById('settingsAddCatBtn').addEventListener('click', () => {
    openSettingsCatModal(null);
  });

  // Populate stats
  const total     = NVR.cameras.length;
  const enabled   = NVR.cameras.filter(c => c.enabled).length;
  const streaming = Object.values(NVR.streamStatuses).filter(s => s === 'streaming').length;

  const el = id => document.getElementById(id);
  if (el('settingsTotal'))     el('settingsTotal').textContent     = total;
  if (el('settingsEnabled'))   el('settingsEnabled').textContent   = enabled;
  if (el('settingsStreaming'))  el('settingsStreaming').textContent = streaming;
};

/* ============================================================
   Settings — Category Management
   ============================================================ */
async function loadSettingsCategories() {
  const list = document.getElementById('settingsCatList');
  if (!list) return;
  try {
    const cats = await NVR.api.get('/api/categories');
    if (!cats.length) {
      list.innerHTML = '<div style="padding:14px 18px;color:var(--text-dim);font-size:13px">Brak kategorii</div>';
      return;
    }
    list.innerHTML = cats.map(cat => `
      <div class="settings-row" id="cat-row-${CSS.escape(cat.name)}">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="cat-color-dot" style="background:${escHtml(cat.color)};width:12px;height:12px;border-radius:50%;display:inline-block;flex-shrink:0"></span>
          <div>
            <div class="settings-label">${escHtml(cat.name)}</div>
            <div class="settings-desc">${cat.camera_count || 0} kamer, ${cat.enabled_count || 0} aktywnych</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${cat.name !== 'default' ? `
            <button class="btn btn-sm btn-secondary" data-cat-edit="${escHtml(cat.name)}">Edytuj</button>
            <button class="btn btn-sm btn-danger"    data-cat-del="${escHtml(cat.name)}">Usuń</button>
          ` : '<span style="font-size:11px;color:var(--text-dim)">domyślna</span>'}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-cat-edit]').forEach(btn => {
      btn.addEventListener('click', () => openSettingsCatModal(btn.dataset.catEdit));
    });
    list.querySelectorAll('[data-cat-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteSettingsCat(btn.dataset.catDel));
    });
  } catch (err) {
    list.innerHTML = `<div style="padding:14px 18px;color:var(--danger);font-size:13px">Błąd: ${escHtml(err.message)}</div>`;
  }
}

function openSettingsCatModal(existingName) {
  const old = document.getElementById('settingsCatModal');
  if (old) old.remove();

  const COLORS = ['#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#ff7b72','#79c0ff','#56d364'];

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'settingsCatModal';
  modal.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header">
        <h2>${existingName ? 'Edytuj kategorię' : 'Nowa kategoria'}</h2>
        <button class="modal-close" id="sCatClose">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Nazwa</label>
          <input type="text" id="sCatName" value="${escHtml(existingName || '')}" placeholder="np. Parking" />
        </div>
        <div class="form-group" style="margin-top:14px">
          <label>Kolor</label>
          <div class="color-picker-row">
            ${COLORS.map(c => `<button class="color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="sCatCancel">Anuluj</button>
        <button class="btn btn-primary" id="sCatSave">Zapisz</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  let selectedColor = COLORS[0];
  modal.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });
  modal.querySelector(`[data-color="${COLORS[0]}"]`).classList.add('selected');

  const close = () => modal.remove();
  modal.querySelector('#sCatClose').addEventListener('click', close);
  modal.querySelector('#sCatCancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelector('#sCatSave').addEventListener('click', async () => {
    const name = document.getElementById('sCatName').value.trim();
    if (!name) { NVR.toast('error', 'Błąd', 'Podaj nazwę'); return; }
    try {
      if (existingName) {
        await NVR.api.put(`/api/categories/${encodeURIComponent(existingName)}`, { newName: name, color: selectedColor });
        NVR.toast('success', 'Zaktualizowano', name);
      } else {
        await NVR.api.post('/api/categories', { name, color: selectedColor });
        NVR.toast('success', 'Dodano', name);
      }
      close();
      loadSettingsCategories();
    } catch (err) { NVR.toast('error', 'Błąd', err.message); }
  });
}

async function deleteSettingsCat(name) {
  if (!confirm(`Usunąć kategorię "${name}"? Wszystkie jej kamery zostaną przeniesione do "default".`)) return;
  try {
    await NVR.api.del(`/api/categories/${encodeURIComponent(name)}`);
    NVR.toast('success', 'Usunięto', name);
    loadSettingsCategories();
  } catch (err) { NVR.toast('error', 'Błąd', err.message); }
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Wait for all scripts to load
window.addEventListener('load', initApp);

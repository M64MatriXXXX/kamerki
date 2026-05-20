'use strict';

/* ============================================================
   AI Page — License Plate Recognition
   ============================================================ */
(function () {

  let currentStatus = 'stopped';
  let statsInterval = null;
  let plateOffset   = 0;
  const PAGE_SIZE   = 50;

  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  async function initAI() {
    const page = document.getElementById('page-ai');
    page.innerHTML = `
      <div class="ai-wrap">

        <!-- Top control bar -->
        <div class="ai-topbar">
          <div class="ai-stats-row" id="aiStats">
            <div class="ai-stat"><span class="ai-stat-val" id="statTotal">—</span><span class="ai-stat-lbl">Łącznie</span></div>
            <div class="ai-stat"><span class="ai-stat-val" id="statToday">—</span><span class="ai-stat-lbl">Dzisiaj</span></div>
            <div class="ai-stat"><span class="ai-stat-val" id="statUnique">—</span><span class="ai-stat-lbl">Unikalne</span></div>
            <div class="ai-stat"><span class="ai-stat-val" id="statMax" style="color:var(--text-dim)">/ 10 000</span><span class="ai-stat-lbl">Limit</span></div>
          </div>
          <div class="ai-controls">
            <div class="ai-status-badge" id="aiStatusBadge">
              <span class="status-dot offline"></span>
              <span id="aiStatusText">Zatrzymano</span>
            </div>
            <button class="btn btn-sm btn-secondary" id="aiSettingsBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Ustawienia
            </button>
            <button class="btn btn-sm btn-primary" id="aiToggleBtn">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Start
            </button>
          </div>
        </div>

        <!-- Settings panel (collapsible) -->
        <div class="ai-settings-panel hidden" id="aiSettingsPanel">
          <div class="ai-settings-inner">
            <div class="form-group">
              <label>Kamera</label>
              <select id="aiCameraSelect">
                <option value="">— Wybierz kamerę —</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Main 2-panel layout -->
        <div class="ai-body">

          <!-- Left: annotated AI live view -->
          <div class="ai-live-panel">
            <div class="ai-panel-header">
              <span class="ai-panel-title">Podgląd AI</span>
              <span class="ai-fps-badge" id="aiFpsBadge" style="font-size:11px;color:var(--text-dim)"></span>
            </div>
            <div class="ai-live-view" id="aiLiveView">
              <div class="ai-placeholder" id="aiPlaceholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:52px;height:52px;opacity:.25">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                  <circle cx="8" cy="9" r="1.5" fill="currentColor" stroke="none" opacity=".5"/>
                  <path d="M5 13l3-3 3 3 4-5 4 5"/>
                </svg>
                <p>Uruchom detekcję aby zobaczyć podgląd</p>
              </div>
              <img id="aiLiveImg" style="display:none;width:100%;height:100%;object-fit:contain;background:#000" alt="AI detection view"/>
            </div>
          </div>

          <!-- Right: plate log -->
          <div class="ai-log-panel">
            <div class="ai-panel-header">
              <span class="ai-panel-title">Dziennik tablic</span>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="text" id="plateSearch" placeholder="Szukaj..." class="search-input" style="width:120px;padding:4px 8px;font-size:12px"/>
                <input type="date" id="plateDate" class="search-input" style="width:130px;padding:4px 8px;font-size:12px"/>
                <button class="btn btn-sm btn-secondary" id="plateRefreshBtn" title="Odśwież">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                </button>
                <button class="btn btn-sm btn-danger" id="plateClearBtn" title="Wyczyść wszystko">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </div>
            <div class="ai-log-body" id="aiLogBody">
              <div style="padding:24px;color:var(--text-dim);text-align:center;font-size:13px">Ładowanie...</div>
            </div>
            <div class="ai-log-footer" id="aiLogFooter" style="display:none">
              <button class="btn btn-sm btn-secondary" id="plateLoadMore">Załaduj więcej</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Populate camera dropdown
    try {
      const cameras = await NVR.api.get('/api/cameras');
      const sel = document.getElementById('aiCameraSelect');
      cameras.filter(c => c.enabled).forEach(c => {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = `${c.name} (${c.ip})`;
        sel.appendChild(opt);
      });
      const ai = cameras.find(c => c.ip === '172.26.64.19');
      if (ai) sel.value = String(ai.id);
    } catch (_) {}

    await refreshStatus();
    loadPlates(true);
    statsInterval = setInterval(refreshStats, 30000);

    document.getElementById('aiToggleBtn').addEventListener('click', onToggle);
    document.getElementById('aiSettingsBtn').addEventListener('click', () => {
      document.getElementById('aiSettingsPanel').classList.toggle('hidden');
    });
    document.getElementById('plateRefreshBtn').addEventListener('click', () => loadPlates(true));
    document.getElementById('plateClearBtn').addEventListener('click', onClearPlates);
    document.getElementById('plateLoadMore').addEventListener('click', () => loadPlates(false));

    let searchTimer;
    document.getElementById('plateSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadPlates(true), 400);
    });
    document.getElementById('plateDate').addEventListener('change', () => loadPlates(true));

    NVR.socket.on('lpr_frame',        onLprFrame);
    NVR.socket.on('lpr_plates_saved', onPlatesSaved);
    NVR.socket.on('lpr_status',       onLprStatus);
  }

  /* ----------------------------------------------------------
     Cleanup
  ---------------------------------------------------------- */
  function cleanupAI() {
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
    NVR.socket.off('lpr_frame',        onLprFrame);
    NVR.socket.off('lpr_plates_saved', onPlatesSaved);
    NVR.socket.off('lpr_status',       onLprStatus);
  }

  /* ----------------------------------------------------------
     Socket handlers
  ---------------------------------------------------------- */
  let _lastFrameTs = 0;

  function onLprFrame(data) {
    const img = document.getElementById('aiLiveImg');
    const ph  = document.getElementById('aiPlaceholder');
    if (!img) return;

    if (data.frame) {
      img.src = `data:image/jpeg;base64,${data.frame}`;
      if (img.style.display === 'none') {
        img.style.display = 'block';
        if (ph) ph.style.display = 'none';
      }
      // Show FPS indicator
      const now = Date.now();
      if (_lastFrameTs) {
        const fps = (1000 / (now - _lastFrameTs)).toFixed(1);
        const badge = document.getElementById('aiFpsBadge');
        if (badge) badge.textContent = `${fps} FPS`;
      }
      _lastFrameTs = now;
    }
  }

  function onPlatesSaved(plates) {
    if (!Array.isArray(plates)) return;
    const body = document.getElementById('aiLogBody');
    if (!body) return;
    const frag = document.createDocumentFragment();
    plates.forEach(p => frag.appendChild(buildPlateRow(p)));
    body.insertBefore(frag, body.firstChild);
    refreshStats();
  }

  function onLprStatus(s) {
    if (!s) return;
    updateStatusBadge(s.status);
    currentStatus = s.status;
    updateToggleBtn();
    if (s.status === 'stopped') {
      // Hide live image when stopped
      const img = document.getElementById('aiLiveImg');
      const ph  = document.getElementById('aiPlaceholder');
      if (img) img.style.display = 'none';
      if (ph)  ph.style.display  = 'flex';
      const badge = document.getElementById('aiFpsBadge');
      if (badge) badge.textContent = '';
    }
    if (s.status === 'error' && s.msg) {
      NVR.toast('error', 'LPR Błąd', s.msg.slice(0, 120));
    }
  }

  /* ----------------------------------------------------------
     Status
  ---------------------------------------------------------- */
  async function refreshStatus() {
    try {
      const st = await NVR.api.get('/api/lpr/status');
      currentStatus = st.status;
      updateStatusBadge(st.status);
      updateToggleBtn();
      updateStats(st.stats);
    } catch (_) {}
  }

  async function refreshStats() {
    try { updateStats(await NVR.api.get('/api/lpr/stats')); } catch (_) {}
  }

  function updateStats(s) {
    if (!s) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statTotal',  s.total ?? '—');
    set('statToday',  s.today ?? '—');
    set('statUnique', s.unique ?? '—');
  }

  function updateStatusBadge(status) {
    const badge = document.getElementById('aiStatusBadge');
    const text  = document.getElementById('aiStatusText');
    if (!badge || !text) return;
    const dot = badge.querySelector('.status-dot');
    const map = {
      stopped:      { cls: 'offline',    label: 'Zatrzymano' },
      initializing: { cls: 'connecting', label: 'Inicjalizacja...' },
      connecting:   { cls: 'connecting', label: 'Łączenie...' },
      connected:    { cls: 'connecting', label: 'Połączono' },
      running:      { cls: 'online',     label: 'Aktywna detekcja' },
      reconnecting: { cls: 'connecting', label: 'Ponowne łączenie...' },
      error:        { cls: 'offline',    label: 'Błąd' },
      ready:        { cls: 'connecting', label: 'Gotowy' }
    };
    const info = map[status] || map.stopped;
    dot.className    = `status-dot ${info.cls}`;
    text.textContent = info.label;
  }

  function updateToggleBtn() {
    const btn = document.getElementById('aiToggleBtn');
    if (!btn) return;
    const isRunning = ['initializing','connecting','connected','running','reconnecting','ready'].includes(currentStatus);
    btn.className = `btn btn-sm ${isRunning ? 'btn-danger' : 'btn-primary'}`;
    btn.innerHTML = isRunning
      ? `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Stop`
      : `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start`;
  }

  /* ----------------------------------------------------------
     Start / Stop
  ---------------------------------------------------------- */
  async function onToggle() {
    const isRunning = ['initializing','connecting','connected','running','reconnecting','ready'].includes(currentStatus);
    if (isRunning) {
      try {
        await NVR.api.post('/api/lpr/stop', {});
        currentStatus = 'stopped';
        updateStatusBadge('stopped');
        updateToggleBtn();
      } catch (e) { NVR.toast('error', 'Błąd', e.message); }
      return;
    }

    const cameraId = document.getElementById('aiCameraSelect')?.value;
    if (!cameraId) {
      document.getElementById('aiSettingsPanel').classList.remove('hidden');
      NVR.toast('warning', 'Brak kamery', 'Wybierz kamerę z listy');
      return;
    }

    try {
      await NVR.api.post('/api/lpr/start', { cameraId: parseInt(cameraId) });
      currentStatus = 'initializing';
      updateStatusBadge('initializing');
      updateToggleBtn();
      NVR.toast('info', 'LPR', 'Uruchamianie detekcji...');
    } catch (e) { NVR.toast('error', 'Błąd', e.message); }
  }

  /* ----------------------------------------------------------
     Plate log
  ---------------------------------------------------------- */
  async function loadPlates(reset) {
    if (reset) plateOffset = 0;
    const search = document.getElementById('plateSearch')?.value || '';
    const date   = document.getElementById('plateDate')?.value   || '';
    const body   = document.getElementById('aiLogBody');
    if (!body) return;

    if (reset) body.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:13px;text-align:center">Ładowanie...</div>';

    try {
      const rows = await NVR.api.get(
        `/api/lpr/plates?limit=${PAGE_SIZE}&offset=${plateOffset}&search=${encodeURIComponent(search)}&date=${date}`
      );
      if (reset) body.innerHTML = '';
      if (!rows.length && reset) {
        body.innerHTML = '<div style="padding:24px;color:var(--text-dim);text-align:center;font-size:13px">Brak zapisanych tablic</div>';
        document.getElementById('aiLogFooter').style.display = 'none';
        return;
      }
      const frag = document.createDocumentFragment();
      rows.forEach(p => frag.appendChild(buildPlateRow(p)));
      body.appendChild(frag);
      plateOffset += rows.length;
      const footer = document.getElementById('aiLogFooter');
      if (footer) footer.style.display = rows.length < PAGE_SIZE ? 'none' : 'flex';
      await refreshStats();
    } catch (e) {
      body.innerHTML = `<div style="padding:24px;color:var(--danger);font-size:13px">Błąd: ${escHtml(e.message)}</div>`;
    }
  }

  function buildPlateRow(p) {
    const conf    = Math.round((p.confidence || 0) * 100);
    const confCls = conf >= 80 ? 'conf-high' : conf >= 55 ? 'conf-mid' : 'conf-low';
    const dt      = new Date(p.detected_at);
    const dateStr = dt.toLocaleDateString('pl-PL');
    const timeStr = dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = document.createElement('div');
    row.className = 'plate-row';
    row.innerHTML = `
      <div class="plate-number">${escHtml(p.plate_text)}</div>
      <div class="plate-meta">
        <span class="plate-conf ${confCls}">${conf}%</span>
        <span class="plate-time">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-1px;opacity:.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${dateStr} ${timeStr}
        </span>
      </div>
    `;
    return row;
  }

  async function onClearPlates() {
    if (!confirm('Usunąć wszystkie zapisane tablice rejestracyjne?')) return;
    try {
      await NVR.api.del('/api/lpr/plates');
      NVR.toast('success', 'Wyczyszczono', 'Baza tablic usunięta');
      loadPlates(true);
    } catch (e) { NVR.toast('error', 'Błąd', e.message); }
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ----------------------------------------------------------
     Register page
  ---------------------------------------------------------- */
  NVR.pages.ai = initAI;
  NVR.pagesCleanup = NVR.pagesCleanup || {};
  NVR.pagesCleanup.ai = cleanupAI;

  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.ai = function () {
    document.getElementById('topbarActions').innerHTML = '';
  };

})();

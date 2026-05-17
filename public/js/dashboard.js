'use strict';

/* ============================================================
   Dashboard — Camera Grid View
   ============================================================ */
(function () {

  let gridCols   = 2;
  let hlsPlayers = {}; // cameraId -> Hls instance
  let streamModal = null;

  /* ----------------------------------------------------------
     Topbar — layout selector + add button
  ---------------------------------------------------------- */
  function renderTopbar() {
    const el = document.getElementById('topbarActions');
    el.innerHTML = `
      <div class="layout-selector">
        <button class="layout-btn ${gridCols===1?'active':''}" data-cols="1">1×1</button>
        <button class="layout-btn ${gridCols===2?'active':''}" data-cols="2">2×2</button>
        <button class="layout-btn ${gridCols===3?'active':''}" data-cols="3">3×3</button>
        <button class="layout-btn ${gridCols===4?'active':''}" data-cols="4">4×4</button>
      </div>
      <button class="btn btn-primary btn-sm" id="dashAddCamera">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Camera
      </button>
    `;

    el.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        gridCols = parseInt(btn.dataset.cols);
        renderTopbar();
        renderGrid();
      });
    });

    document.getElementById('dashAddCamera').addEventListener('click', () => {
      NVR.cameraModal.open(null, () => {
        renderGrid();
      });
    });
  }

  /* ----------------------------------------------------------
     Render Grid
  ---------------------------------------------------------- */
  function renderGrid() {
    const page = document.getElementById('page-dashboard');

    // Ensure scrollable content wrapper exists
    let content = page.querySelector('.dashboard-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'dashboard-content';
      page.appendChild(content);
    }

    if (!NVR.cameras.length) {
      content.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <h3>No Cameras Yet</h3>
          <p>Add your first camera to start monitoring.</p>
          <button class="btn btn-primary mt-2" id="emptyAddBtn">Add Camera</button>
        </div>
      `;
      content.querySelector('#emptyAddBtn').addEventListener('click', () => {
        NVR.cameraModal.open(null, renderGrid);
      });
      return;
    }

    const grid = document.createElement('div');
    grid.className = `camera-grid grid-${gridCols}`;

    NVR.cameras.forEach(cam => {
      const tile = buildTile(cam);
      grid.appendChild(tile);
    });

    content.innerHTML = '';
    content.appendChild(grid);
  }

  /* ----------------------------------------------------------
     Build a single camera tile
  ---------------------------------------------------------- */
  function buildTile(cam) {
    const tile = document.createElement('div');
    tile.className = 'camera-tile';
    tile.dataset.cameraId = cam.id;

    const statusInfo = getStatusInfo(cam);

    tile.innerHTML = `
      <div class="tile-video-wrap" data-camera-id="${cam.id}">
        <video muted playsinline autoplay></video>
        <div class="tile-overlay" id="overlay-${cam.id}">
          <div class="spinner"></div>
          <span>Loading stream...</span>
        </div>
      </div>
      <div class="tile-info">
        <div class="tile-name" title="${escHtml(cam.name)}">${escHtml(cam.name)}</div>
        <div class="tile-meta">
          ${cam.category !== 'default' ? `<span class="chip">${escHtml(cam.category)}</span>` : ''}
          <span class="tile-badge badge-${statusInfo.cls}" id="badge-${cam.id}">${statusInfo.label}</span>
          ${cam.enabled ? `
            <button class="tile-btn-play" data-id="${cam.id}" title="Open fullscreen">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          ` : ''}
          ${(cam.brand === 'hikvision' || cam.brand === 'dahua') ? `
            <button class="tile-btn-ptz" data-id="${cam.id}" title="PTZ Control">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;

    // Auto-start stream if enabled
    if (cam.enabled) {
      startTileStream(cam, tile);
    } else {
      const overlay = tile.querySelector(`#overlay-${cam.id}`);
      overlay.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4">
          <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <span>Disabled</span>
      `;
    }

    // Fullscreen button
    tile.addEventListener('click', e => {
      const btn = e.target.closest('.tile-btn-play');
      if (btn) {
        e.stopPropagation();
        openStreamModal(parseInt(btn.dataset.id));
      }
      const ptzBtn = e.target.closest('.tile-btn-ptz');
      if (ptzBtn) {
        e.stopPropagation();
        openStreamModal(parseInt(ptzBtn.dataset.id), true);
      }
    });

    return tile;
  }

  /* ----------------------------------------------------------
     Start stream in tile
  ---------------------------------------------------------- */
  async function startTileStream(cam, tile) {
    const overlay = tile.querySelector(`#overlay-${cam.id}`);
    const video   = tile.querySelector('video');
    const badge   = document.getElementById(`badge-${cam.id}`);

    overlay.innerHTML = `<div class="spinner"></div><span>Starting...</span>`;
    overlay.classList.remove('hidden');

    // Tell server we're watching
    NVR.socket.emit('watch_camera', cam.id);

    // Wait for stream_ready
    const handleReady = (cameraId) => {
      if (cameraId !== cam.id) return;
      overlay.classList.add('hidden');
      if (badge) { badge.className = 'tile-badge badge-streaming'; badge.textContent = 'Live'; }

      // Start HLS player
      if (hlsPlayers[cam.id]) {
        try { hlsPlayers[cam.id].destroy(); } catch (_) {}
      }
      hlsPlayers[cam.id] = NVR.createPlayer(video, cam.id);
    };

    const handleError = (cameraId, error) => {
      if (cameraId !== cam.id) return;
      overlay.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style="font-size:11px;max-width:120px">${escHtml(error || 'Stream error')}</span>
      `;
      if (badge) { badge.className = 'tile-badge badge-error'; badge.textContent = 'Error'; }
    };

    NVR._streamReadyListeners.push(handleReady);
    NVR._streamErrorListeners.push(handleError);
  }

  /* ----------------------------------------------------------
     Status helpers
  ---------------------------------------------------------- */
  function getStatusInfo(cam) {
    if (!cam.enabled) return { cls: 'disabled', label: 'Disabled' };
    const st = NVR.streamStatuses[cam.id];
    if (st === 'streaming') return { cls: 'streaming', label: 'Live' };
    if (st === 'starting')  return { cls: 'starting',  label: 'Starting' };
    if (st === 'error')     return { cls: 'error',     label: 'Error' };
    return { cls: 'stopped', label: 'Idle' };
  }

  /* ----------------------------------------------------------
     Stream modal (fullscreen with PTZ)
  ---------------------------------------------------------- */
  function openStreamModal(cameraId, showPtz = false) {
    const cam = NVR.cameras.find(c => c.id === cameraId);
    if (!cam) return;

    // Cleanup old modal
    closeStreamModal();

    const overlay = document.createElement('div');
    overlay.className = 'stream-modal-overlay';
    overlay.id = 'streamModalOverlay';

    const hasPtz = cam.brand === 'hikvision' || cam.brand === 'dahua';

    overlay.innerHTML = `
      <div class="stream-modal">
        <div class="stream-modal-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:700;font-size:15px">${escHtml(cam.name)}</span>
            <span class="chip">${escHtml(cam.brand)}</span>
            ${cam.category !== 'default' ? `<span class="chip">${escHtml(cam.category)}</span>` : ''}
          </div>
          <button class="modal-close" id="streamModalClose">&times;</button>
        </div>
        <div class="stream-modal-body">
          <div class="stream-video-area">
            <video id="streamModalVideo" muted playsinline autoplay controls></video>
            <div class="tile-overlay" id="streamModalOverlayInner">
              <div class="spinner"></div>
              <span>Connecting to stream...</span>
            </div>
          </div>
          ${hasPtz ? `<div class="stream-side-panel" id="streamSidePanel"></div>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const video   = overlay.querySelector('#streamModalVideo');
    const innerOv = overlay.querySelector('#streamModalOverlayInner');

    overlay.querySelector('#streamModalClose').addEventListener('click', closeStreamModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeStreamModal(); });

    // Socket events
    let modalHls = null;

    function handleReady(id) {
      if (id !== cameraId) return;
      innerOv.classList.add('hidden');
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
      modalHls = NVR.createPlayer(video, cameraId);
    }

    function handleError(id, err) {
      if (id !== cameraId) return;
      innerOv.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escHtml(err || 'Stream failed')}</span>
      `;
    }

    NVR._streamReadyListeners.push(handleReady);
    NVR._streamErrorListeners.push(handleError);

    NVR.socket.emit('watch_camera', cameraId);

    // Check if stream already running
    if (NVR.streamStatuses[cameraId] === 'streaming') {
      handleReady(cameraId);
    }

    // PTZ panel
    if (hasPtz) {
      const sidePanel = overlay.querySelector('#streamSidePanel');
      if (sidePanel) {
        NVR.ptzControl.render(sidePanel, cam);
      }
    }

    overlay._cleanup = function () {
      NVR.socket.emit('unwatch_camera', cameraId);
      const ri = NVR._streamReadyListeners.indexOf(handleReady);
      if (ri !== -1) NVR._streamReadyListeners.splice(ri, 1);
      const ei = NVR._streamErrorListeners.indexOf(handleError);
      if (ei !== -1) NVR._streamErrorListeners.splice(ei, 1);
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
    };

    streamModal = overlay;
  }

  function closeStreamModal() {
    const overlay = document.getElementById('streamModalOverlay');
    if (overlay) {
      if (overlay._cleanup) overlay._cleanup();
      overlay.classList.remove('open');
      setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 250);
    }
    streamModal = null;
  }

  /* ----------------------------------------------------------
     Page init
  ---------------------------------------------------------- */
  function initDashboard() {
    renderTopbar();
    renderGrid();
  }

  NVR.pages.dashboard = initDashboard;
  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.dashboard = renderTopbar;

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

})();

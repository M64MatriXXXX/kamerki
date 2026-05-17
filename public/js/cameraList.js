'use strict';

/* ============================================================
   Camera List Page
   ============================================================ */
(function () {

  let filterText  = '';
  let filterCat   = '';
  let filterBrand = '';

  /* ----------------------------------------------------------
     Topbar
  ---------------------------------------------------------- */
  function renderTopbar() {
    const el = document.getElementById('topbarActions');
    el.innerHTML = `
      <button class="btn btn-primary btn-sm" id="listAddCamera">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Camera
      </button>
    `;
    document.getElementById('listAddCamera').addEventListener('click', () => {
      NVR.cameraModal.open(null, () => renderPage());
    });
  }

  /* ----------------------------------------------------------
     Render Page
  ---------------------------------------------------------- */
  function renderPage() {
    const page = document.getElementById('page-cameras');
    page.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'list-content';

    // Filter bar
    const uniqueCats = [...new Set(NVR.cameras.map(c => c.category).filter(Boolean))].sort();
    const uniqueBrands = [...new Set(NVR.cameras.map(c => c.brand).filter(Boolean))].sort();

    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    filterBar.innerHTML = `
      <input type="text" class="search-input" id="camSearch" placeholder="Search cameras..." value="${escHtml(filterText)}" />
      <select class="filter-select" id="camFilterCat">
        <option value="">All Categories</option>
        ${uniqueCats.map(c => `<option value="${escHtml(c)}" ${filterCat===c?'selected':''}>${escHtml(c)}</option>`).join('')}
      </select>
      <select class="filter-select" id="camFilterBrand">
        <option value="">All Brands</option>
        ${uniqueBrands.map(b => `<option value="${escHtml(b)}" ${filterBrand===b?'selected':''}>${escHtml(b)}</option>`).join('')}
      </select>
      <span class="text-muted" id="camCount" style="font-size:12px;margin-left:4px"></span>
    `;

    filterBar.querySelector('#camSearch').addEventListener('input', e => {
      filterText = e.target.value;
      rebuildTable();
    });
    filterBar.querySelector('#camFilterCat').addEventListener('change', e => {
      filterCat = e.target.value;
      rebuildTable();
    });
    filterBar.querySelector('#camFilterBrand').addEventListener('change', e => {
      filterBrand = e.target.value;
      rebuildTable();
    });

    content.appendChild(filterBar);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.id = 'cameraTableWrap';
    content.appendChild(tableWrap);

    page.appendChild(content);
    rebuildTable();
  }

  /* ----------------------------------------------------------
     Rebuild Table
  ---------------------------------------------------------- */
  function rebuildTable() {
    const wrap = document.getElementById('cameraTableWrap');
    if (!wrap) return;

    const cameras = filterCameras();
    document.getElementById('camCount').textContent = `${cameras.length} of ${NVR.cameras.length}`;

    if (!NVR.cameras.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <h3>No Cameras</h3>
          <p>Click "Add Camera" to add your first camera.</p>
        </div>
      `;
      return;
    }

    if (!cameras.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <h3>No Results</h3>
          <p>No cameras match your filter.</p>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>IP Address</th>
            <th>Brand</th>
            <th>Category</th>
            <th>Status</th>
            <th>Stream</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody id="cameraTableBody"></tbody>
      </table>
    `;

    const tbody = document.getElementById('cameraTableBody');
    cameras.forEach(cam => {
      const tr = document.createElement('tr');
      const streamSt = NVR.streamStatuses[cam.id] || 'stopped';
      const streamPillHtml = getStreamPillHtml(streamSt, cam.enabled);

      tr.innerHTML = `
        <td class="td-name">${escHtml(cam.name)}</td>
        <td class="td-ip">${escHtml(cam.ip)}:${cam.port}</td>
        <td><span class="chip">${escHtml(cam.brand || 'generic')}</span></td>
        <td>${escHtml(cam.category || 'default')}</td>
        <td>
          <span class="status-pill ${cam.enabled ? 'pill-enabled' : 'pill-disabled'}">
            <span class="dot"></span>
            ${cam.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </td>
        <td id="stream-pill-${cam.id}">${streamPillHtml}</td>
        <td>
          <div class="td-actions" style="justify-content:flex-end">
            ${cam.enabled ? `<button class="btn btn-sm btn-secondary" data-action="stream" data-id="${cam.id}">View</button>` : ''}
            <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${cam.id}">Edit</button>
            <button class="btn btn-sm btn-danger"    data-action="delete" data-id="${cam.id}">Delete</button>
          </div>
        </td>
      `;

      tr.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', handleAction);
      });

      tbody.appendChild(tr);
    });
  }

  /* ----------------------------------------------------------
     Stream pill HTML
  ---------------------------------------------------------- */
  function getStreamPillHtml(status, enabled) {
    if (!enabled) return `<span class="status-pill pill-disabled"><span class="dot"></span>Off</span>`;
    if (status === 'streaming') return `<span class="status-pill pill-streaming"><span class="dot"></span>Live</span>`;
    if (status === 'starting')  return `<span class="status-pill" style="background:rgba(210,153,34,.12);color:#d29922"><span class="dot" style="background:#d29922"></span>Starting</span>`;
    if (status === 'error')     return `<span class="status-pill" style="background:rgba(248,81,73,.12);color:#f85149"><span class="dot" style="background:#f85149"></span>Error</span>`;
    return `<span class="status-pill pill-disabled"><span class="dot"></span>Idle</span>`;
  }

  /* ----------------------------------------------------------
     Actions
  ---------------------------------------------------------- */
  async function handleAction(e) {
    const action = this.dataset.action;
    const id     = parseInt(this.dataset.id);
    const cam    = NVR.cameras.find(c => c.id === id);
    if (!cam) return;

    if (action === 'edit') {
      // Fetch full camera (with password cleared by server)
      try {
        const full = await NVR.api.get(`/api/cameras/${id}`);
        NVR.cameraModal.open(full, () => {
          NVR.loadCameras().then(renderPage);
        });
      } catch (err) {
        NVR.toast('error', 'Load Error', err.message);
      }
    }

    if (action === 'delete') {
      if (!confirm(`Delete camera "${cam.name}"? This cannot be undone.`)) return;
      try {
        await NVR.api.del(`/api/cameras/${id}`);
        NVR.toast('success', 'Deleted', cam.name);
        await NVR.loadCameras();
        renderPage();
      } catch (err) {
        NVR.toast('error', 'Delete Failed', err.message);
      }
    }

    if (action === 'stream') {
      openQuickStream(cam);
    }
  }

  /* ----------------------------------------------------------
     Quick stream popup
  ---------------------------------------------------------- */
  function openQuickStream(cam) {
    // Navigate to dashboard and open the stream modal
    const hasPtz = cam.brand === 'hikvision' || cam.brand === 'dahua';

    const overlay = document.createElement('div');
    overlay.className = 'stream-modal-overlay';
    overlay.id = 'quickStreamOverlay';

    overlay.innerHTML = `
      <div class="stream-modal">
        <div class="stream-modal-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:700;font-size:15px">${escHtml(cam.name)}</span>
            <span class="chip">${escHtml(cam.brand)}</span>
          </div>
          <button class="modal-close" id="quickStreamClose">&times;</button>
        </div>
        <div class="stream-modal-body">
          <div class="stream-video-area">
            <video id="quickStreamVideo" muted playsinline autoplay controls></video>
            <div class="tile-overlay" id="quickStreamOverlayInner">
              <div class="spinner"></div>
              <span>Connecting...</span>
            </div>
          </div>
          ${hasPtz ? `<div class="stream-side-panel" id="quickStreamPtz"></div>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const video   = overlay.querySelector('#quickStreamVideo');
    const innerOv = overlay.querySelector('#quickStreamOverlayInner');
    let   modalHls = null;

    function handleReady(id) {
      if (id !== cam.id) return;
      innerOv.classList.add('hidden');
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
      modalHls = NVR.createPlayer(video, cam.id);
    }

    function handleError(id, err) {
      if (id !== cam.id) return;
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
    NVR.socket.emit('watch_camera', cam.id);

    if (NVR.streamStatuses[cam.id] === 'streaming') handleReady(cam.id);

    if (hasPtz) {
      const ptzPanel = overlay.querySelector('#quickStreamPtz');
      if (ptzPanel) NVR.ptzControl.render(ptzPanel, cam);
    }

    function cleanup() {
      NVR.socket.emit('unwatch_camera', cam.id);
      const ri = NVR._streamReadyListeners.indexOf(handleReady);
      if (ri !== -1) NVR._streamReadyListeners.splice(ri, 1);
      const ei = NVR._streamErrorListeners.indexOf(handleError);
      if (ei !== -1) NVR._streamErrorListeners.splice(ei, 1);
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
      overlay.classList.remove('open');
      setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 250);
    }

    overlay.querySelector('#quickStreamClose').addEventListener('click', cleanup);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });

    // Update stream pill
    function statusUpdate(id, status) {
      if (id !== cam.id) return;
      const pill = document.getElementById(`stream-pill-${cam.id}`);
      if (pill) pill.innerHTML = getStreamPillHtml(status, cam.enabled);
    }
    NVR._statusListeners.push(statusUpdate);
    overlay._cleanupStatus = () => {
      const i = NVR._statusListeners.indexOf(statusUpdate);
      if (i !== -1) NVR._statusListeners.splice(i, 1);
    };
    const origCleanup = cleanup;
    overlay.cleanup = function () { origCleanup(); overlay._cleanupStatus(); };
  }

  /* ----------------------------------------------------------
     Filter
  ---------------------------------------------------------- */
  function filterCameras() {
    const q = filterText.toLowerCase();
    return NVR.cameras.filter(cam => {
      if (filterCat && cam.category !== filterCat) return false;
      if (filterBrand && cam.brand !== filterBrand) return false;
      if (q && !cam.name.toLowerCase().includes(q) && !cam.ip.includes(q)) return false;
      return true;
    });
  }

  /* ----------------------------------------------------------
     Page init
  ---------------------------------------------------------- */
  function initCameras() {
    renderTopbar();
    renderPage();

    // Update stream pills on status changes
    NVR._statusListeners.push((cameraId, status) => {
      if (NVR.currentPage !== 'cameras') return;
      const pill = document.getElementById(`stream-pill-${cameraId}`);
      const cam  = NVR.cameras.find(c => c.id === cameraId);
      if (pill && cam) pill.innerHTML = getStreamPillHtml(status, cam.enabled);
    });
  }

  NVR.pages.cameras = initCameras;
  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.cameras = renderTopbar;

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Expose NVR.api locally
  const NVR = window.NVR;

})();

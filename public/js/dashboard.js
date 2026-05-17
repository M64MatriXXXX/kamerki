'use strict';

/* ============================================================
   Dashboard — Camera Grid View
   ============================================================ */
(function () {

  let gridCols     = 2;
  let hlsPlayers   = {};
  let filterCat    = null; // null = show all

  /* ----------------------------------------------------------
     Topbar
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
      NVR.cameraModal.open(null, async () => {
        await NVR.loadCameras();
        renderCategoryBar();
        renderGrid();
      });
    });
  }

  /* ----------------------------------------------------------
     Category Bar
  ---------------------------------------------------------- */
  async function renderCategoryBar() {
    const page = document.getElementById('page-dashboard');
    let bar = page.querySelector('.category-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'category-bar';
      page.insertBefore(bar, page.firstChild);
    }

    let categories = [];
    try { categories = await NVR.api.get('/api/categories'); } catch (_) {}

    const active = NVR.activeCategory;

    bar.innerHTML = `
      <div class="cat-bar-inner">
        <span class="cat-bar-label">Kategorie:</span>
        <div class="cat-bar-buttons">
          <button class="cat-btn ${active === null ? 'cat-btn-all-active' : ''}" data-cat="__all__">
            Wszystkie
          </button>
          ${categories.map(cat => `
            <button class="cat-btn ${active === cat.name ? 'cat-btn-active' : ''}"
              data-cat="${escHtml(cat.name)}"
              style="--cat-color:${escHtml(cat.color || '#58a6ff')}">
              <span class="cat-dot" style="background:${escHtml(cat.color || '#58a6ff')}"></span>
              ${escHtml(cat.name)}
              <span class="cat-count">${cat.enabled_count || 0}</span>
            </button>
          `).join('')}
          <button class="cat-btn cat-btn-add" id="catAddBtn" title="Dodaj kategorię">+</button>
        </div>
        ${active !== null ? `
          <button class="cat-deactivate-btn" id="catDeactivateBtn" title="Wyłącz wszystkie streamy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            Wyłącz wszystkie
          </button>
        ` : ''}
      </div>
    `;

    // All cameras button
    bar.querySelector('[data-cat="__all__"]').addEventListener('click', async () => {
      filterCat = null;
      await NVR.loadCameras();
      renderCategoryBar();
      renderGrid();
    });

    // Category buttons
    bar.querySelectorAll('[data-cat]:not([data-cat="__all__"])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat;
        await activateCategory(cat);
      });
    });

    // Deactivate button
    const deactivateBtn = bar.querySelector('#catDeactivateBtn');
    if (deactivateBtn) {
      deactivateBtn.addEventListener('click', async () => {
        await activateCategory(null);
      });
    }

    // Add category button
    bar.querySelector('#catAddBtn').addEventListener('click', () => openAddCategoryModal());
  }

  /* ----------------------------------------------------------
     Activate category
  ---------------------------------------------------------- */
  async function activateCategory(categoryName) {
    try {
      const result = await NVR.api.post('/api/categories/activate', { category: categoryName });
      NVR.activeCategory = result.activeCategory;
      filterCat = result.activeCategory;

      if (categoryName) {
        NVR.toast('success', 'Kategoria aktywna', `Uruchamianie kamer: ${categoryName}`);
      } else {
        NVR.toast('info', 'Tryb na żądanie', 'Wszystkie streamy zatrzymane');
      }

      await NVR.loadCameras();
      renderCategoryBar();
      renderGrid();
    } catch (err) {
      NVR.toast('error', 'Błąd', err.message);
    }
  }

  /* ----------------------------------------------------------
     Add Category Modal
  ---------------------------------------------------------- */
  function openAddCategoryModal() {
    const existing = document.getElementById('addCatModal');
    if (existing) existing.remove();

    const COLORS = ['#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#ff7b72','#79c0ff','#56d364'];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'addCatModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <h2>Nowa Kategoria</h2>
          <button class="modal-close" id="addCatClose">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Nazwa kategorii</label>
            <input type="text" id="newCatName" placeholder="np. Ulica Słowackiego" autofocus />
          </div>
          <div class="form-group" style="margin-top:14px">
            <label>Kolor</label>
            <div class="color-picker-row">
              ${COLORS.map(c => `
                <button class="color-swatch ${c==='#58a6ff'?'selected':''}" data-color="${c}"
                  style="background:${c}" title="${c}"></button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="addCatCancel">Anuluj</button>
          <button class="btn btn-primary" id="addCatSave">Zapisz</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let selectedColor = '#58a6ff';
    modal.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        selectedColor = sw.dataset.color;
      });
    });

    const close = () => modal.remove();
    modal.querySelector('#addCatClose').addEventListener('click', close);
    modal.querySelector('#addCatCancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#addCatSave').addEventListener('click', async () => {
      const name = document.getElementById('newCatName').value.trim();
      if (!name) { NVR.toast('error', 'Błąd', 'Podaj nazwę kategorii'); return; }
      try {
        await NVR.api.post('/api/categories', { name, color: selectedColor });
        NVR.toast('success', 'Dodano', name);
        close();
        renderCategoryBar();
      } catch (err) {
        NVR.toast('error', 'Błąd', err.message);
      }
    });

    document.getElementById('newCatName').focus();
  }

  /* ----------------------------------------------------------
     Render Grid
  ---------------------------------------------------------- */
  function renderGrid() {
    const page = document.getElementById('page-dashboard');
    let content = page.querySelector('.dashboard-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'dashboard-content';
      page.appendChild(content);
    }

    const cameras = filterCat
      ? NVR.cameras.filter(c => c.category === filterCat)
      : NVR.cameras;

    if (!NVR.cameras.length) {
      content.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <h3>Brak kamer</h3>
          <p>Dodaj pierwszą kamerę aby zacząć monitoring.</p>
          <button class="btn btn-primary mt-2" id="emptyAddBtn">Dodaj kamerę</button>
        </div>`;
      content.querySelector('#emptyAddBtn').addEventListener('click', () => {
        NVR.cameraModal.open(null, async () => {
          await NVR.loadCameras();
          renderCategoryBar();
          renderGrid();
        });
      });
      return;
    }

    if (filterCat && !cameras.length) {
      content.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <h3>Brak kamer w kategorii</h3>
          <p>Kategoria "${escHtml(filterCat)}" nie ma żadnych kamer.</p>
        </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = `camera-grid grid-${gridCols}`;
    cameras.forEach(cam => grid.appendChild(buildTile(cam)));

    content.innerHTML = '';
    content.appendChild(grid);
  }

  /* ----------------------------------------------------------
     Build camera tile
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
          <span>Ładowanie strumienia...</span>
        </div>
      </div>
      <div class="tile-info">
        <button class="tile-btn-edit" data-id="${cam.id}" title="Edytuj kamerę">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <div class="tile-name" title="${escHtml(cam.name)}">${escHtml(cam.name)}</div>
        <div class="tile-meta">
          ${cam.category !== 'default' ? `<span class="chip">${escHtml(cam.category)}</span>` : ''}
          <span class="tile-badge badge-${statusInfo.cls}" id="badge-${cam.id}">${statusInfo.label}</span>
          ${cam.enabled ? `
            <button class="tile-btn-play" data-id="${cam.id}" title="Otwórz pełny ekran">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>` : ''}
          ${(cam.brand === 'hikvision' || cam.brand === 'dahua') ? `
            <button class="tile-btn-ptz" data-id="${cam.id}" title="Sterowanie PTZ">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
            </button>` : ''}
        </div>
      </div>
    `;

    if (cam.enabled) {
      startTileStream(cam, tile);
    } else {
      const overlay = tile.querySelector(`#overlay-${cam.id}`);
      overlay.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4">
          <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <span>Wyłączona</span>`;
    }

    tile.addEventListener('click', e => {
      const editBtn = e.target.closest('.tile-btn-edit');
      const playBtn = e.target.closest('.tile-btn-play');
      const ptzBtn  = e.target.closest('.tile-btn-ptz');
      if (editBtn) {
        e.stopPropagation();
        NVR.api.get(`/api/cameras/${cam.id}`).then(full => {
          NVR.cameraModal.open(full, async () => {
            await NVR.loadCameras();
            renderCategoryBar();
            renderGrid();
          });
        }).catch(err => NVR.toast('error', 'Błąd', err.message));
      }
      if (playBtn) { e.stopPropagation(); openStreamModal(parseInt(playBtn.dataset.id)); }
      if (ptzBtn)  { e.stopPropagation(); openStreamModal(parseInt(ptzBtn.dataset.id), true); }
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

    overlay.innerHTML = `<div class="spinner"></div><span>Łączenie...</span>`;
    overlay.classList.remove('hidden');

    NVR.socket.emit('watch_camera', cam.id);

    const handleReady = (cameraId) => {
      if (cameraId !== cam.id) return;
      overlay.classList.add('hidden');
      if (badge) { badge.className = 'tile-badge badge-streaming'; badge.textContent = 'Na żywo'; }
      if (hlsPlayers[cam.id]) { try { hlsPlayers[cam.id].destroy(); } catch (_) {} }
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
        <span style="font-size:11px;max-width:120px">${escHtml(error || 'Błąd strumienia')}</span>`;
      if (badge) { badge.className = 'tile-badge badge-error'; badge.textContent = 'Błąd'; }
    };

    NVR._streamReadyListeners.push(handleReady);
    NVR._streamErrorListeners.push(handleError);
  }

  /* ----------------------------------------------------------
     Stream modal (fullscreen + PTZ)
  ---------------------------------------------------------- */
  function openStreamModal(cameraId, showPtz = false) {
    const cam = NVR.cameras.find(c => c.id === cameraId);
    if (!cam) return;

    if (document.getElementById('streamModalOverlay')) closeStreamModal();

    const overlay = document.createElement('div');
    overlay.className = 'stream-modal-overlay';
    overlay.id = 'streamModalOverlay';

    const hasPtz = cam.brand === 'hikvision' || cam.brand === 'dahua';
    const isMobile = window.innerWidth <= 768;

    overlay.innerHTML = `
      <div class="stream-modal">
        <div class="stream-modal-header">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span style="font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(cam.name)}</span>
            <span class="chip" style="flex-shrink:0">${escHtml(cam.brand)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${hasPtz && isMobile ? `
              <button class="btn btn-sm btn-secondary" id="streamPtzToggle" title="Sterowanie PTZ">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
                </svg>
                PTZ
              </button>` : ''}
            <button class="modal-close" id="streamModalClose">&times;</button>
          </div>
        </div>
        <div class="stream-modal-body">
          <div class="stream-video-area">
            <video id="streamModalVideo" muted playsinline autoplay controls></video>
            <div class="tile-overlay" id="streamModalOverlayInner">
              <div class="spinner"></div><span>Łączenie...</span>
            </div>
          </div>
          ${hasPtz ? `<div class="stream-side-panel${isMobile && !showPtz ? ' hidden' : ''}" id="streamSidePanel"></div>` : ''}
        </div>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const video   = overlay.querySelector('#streamModalVideo');
    const innerOv = overlay.querySelector('#streamModalOverlayInner');
    let modalHls  = null;

    // PTZ toggle button (mobile)
    const ptzToggleBtn = overlay.querySelector('#streamPtzToggle');
    if (ptzToggleBtn) {
      ptzToggleBtn.addEventListener('click', () => {
        const panel = overlay.querySelector('#streamSidePanel');
        if (!panel) return;
        const hidden = panel.classList.toggle('hidden');
        ptzToggleBtn.classList.toggle('btn-primary', !hidden);
        ptzToggleBtn.classList.toggle('btn-secondary', hidden);
      });
    }

    function handleReady(id) {
      if (id !== cameraId) return;
      innerOv.classList.add('hidden');
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
      modalHls = NVR.createPlayer(video, cameraId);
    }

    function handleError(id, err) {
      if (id !== cameraId) return;
      innerOv.innerHTML = `<span>${escHtml(err || 'Błąd strumienia')}</span>`;
    }

    NVR._streamReadyListeners.push(handleReady);
    NVR._streamErrorListeners.push(handleError);
    NVR.socket.emit('watch_camera', cameraId);

    if (NVR.streamStatuses[cameraId] === 'streaming') handleReady(cameraId);

    if (hasPtz) {
      const sidePanel = overlay.querySelector('#streamSidePanel');
      if (sidePanel) NVR.ptzControl.render(sidePanel, cam);
    }

    // Swipe down to close (mobile)
    initSwipeDownClose(overlay.querySelector('.stream-modal'), closeStreamModal);

    overlay._cleanup = function () {
      NVR.socket.emit('unwatch_camera', cameraId);
      [NVR._streamReadyListeners, NVR._streamErrorListeners].forEach(arr => {
        [handleReady, handleError].forEach(fn => { const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1); });
      });
      if (modalHls) { try { modalHls.destroy(); } catch (_) {} }
    };

    overlay.querySelector('#streamModalClose').addEventListener('click', closeStreamModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeStreamModal(); });
  }

  /* Swipe down on modal header to close */
  function initSwipeDownClose(modalEl, closeFn) {
    if (!modalEl) return;
    const header = modalEl.querySelector('.stream-modal-header');
    if (!header) return;

    let startY = 0;
    header.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    header.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > 60) closeFn();
    }, { passive: true });
  }

  function closeStreamModal() {
    const overlay = document.getElementById('streamModalOverlay');
    if (overlay) {
      if (overlay._cleanup) overlay._cleanup();
      overlay.classList.remove('open');
      setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 250);
    }
  }

  /* ----------------------------------------------------------
     Status helpers
  ---------------------------------------------------------- */
  function getStatusInfo(cam) {
    if (!cam.enabled) return { cls: 'disabled', label: 'Wyłączona' };
    const st = NVR.streamStatuses[cam.id];
    if (st === 'streaming') return { cls: 'streaming', label: 'Na żywo' };
    if (st === 'starting')  return { cls: 'starting',  label: 'Start...' };
    if (st === 'error')     return { cls: 'error',     label: 'Błąd' };
    return { cls: 'stopped', label: 'Czeka' };
  }

  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  async function initDashboard() {
    await NVR.loadCameras();
    renderTopbar();
    renderCategoryBar();
    renderGrid();
  }

  // React to category activation from server (other clients or on connect)
  NVR._categoryListeners = NVR._categoryListeners || [];
  NVR._categoryListeners.push(async (cat) => {
    if (NVR.currentPage !== 'dashboard') return;
    filterCat = cat;
    await NVR.loadCameras();
    renderCategoryBar();
    renderGrid();
  });

  NVR.pages.dashboard = initDashboard;
  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.dashboard = renderTopbar;

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

})();

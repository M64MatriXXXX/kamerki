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
      <button class="btn btn-secondary btn-sm" id="listImportBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Importuj
      </button>
      <button class="btn btn-primary btn-sm" id="listAddCamera">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Dodaj kamerę
      </button>
    `;
    document.getElementById('listAddCamera').addEventListener('click', () => {
      NVR.cameraModal.open(null, () => renderPage());
    });
    document.getElementById('listImportBtn').addEventListener('click', openImportModal);
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
     Import Modal (XLSX / CSV)
  ---------------------------------------------------------- */
  function openImportModal() {
    const old = document.getElementById('importModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'importModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:760px">
        <div class="modal-header">
          <h2>Import kamer z pliku</h2>
          <button class="modal-close" id="importClose">&times;</button>
        </div>
        <div class="modal-body">
          <!-- Step 1: file picker -->
          <div id="importStep1">
            <div class="import-dropzone" id="importDropzone">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;color:var(--text-dim)">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div style="margin-top:10px;font-weight:600">Przeciągnij plik lub kliknij aby wybrać</div>
              <div style="font-size:12px;color:var(--text-dim);margin-top:4px">Obsługiwane formaty: .xlsx, .csv, .txt</div>
              <input type="file" id="importFile" accept=".xlsx,.csv,.txt" style="display:none"/>
            </div>
            <div style="margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px">
              <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Oczekiwany format kolumn</div>
              <table style="font-size:12px;width:100%;border-collapse:collapse">
                <tr style="color:var(--accent)">
                  <td style="padding:3px 10px 3px 0;font-weight:700">Kolumna A</td>
                  <td style="padding:3px 10px 3px 0;font-weight:700">Kolumna B</td>
                  <td style="padding:3px 0;font-weight:700">Kolumna C</td>
                </tr>
                <tr style="color:var(--text-muted)">
                  <td style="padding:3px 10px 3px 0">IP kamery</td>
                  <td style="padding:3px 10px 3px 0">login:hasło <em>lub</em> nazwa</td>
                  <td style="padding:3px 0">Nazwa kamery (opcjonalnie)</td>
                </tr>
                <tr style="color:var(--text-dim);font-style:italic">
                  <td style="padding:3px 10px 3px 0">172.26.7.19</td>
                  <td style="padding:3px 10px 3px 0">admin:Helios2n</td>
                  <td style="padding:3px 0">Słowackiego Promil</td>
                </tr>
              </table>
            </div>
          </div>

          <!-- Step 2: preview -->
          <div id="importStep2" style="display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px">
              <div id="importSummary" style="font-size:13px;color:var(--text-dim)"></div>
              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <label style="font-size:13px;display:flex;align-items:center;gap:6px">
                  <input type="checkbox" id="importSkipDup" checked style="accent-color:var(--accent)"/>
                  Pomiń istniejące IP
                </label>
                <div style="display:flex;align-items:center;gap:6px;font-size:13px">
                  <label style="white-space:nowrap">Domyślna kategoria:</label>
                  <input type="text" id="importDefCat" placeholder="default" list="importCatList"
                    style="width:140px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px"/>
                  <datalist id="importCatList"></datalist>
                </div>
              </div>
            </div>
            <div style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
              <table id="importPreviewTable" style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                  <tr style="position:sticky;top:0;background:var(--card);z-index:1">
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">✓</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">IP</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">Login</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">Hasło</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">Nazwa kamery</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)">Kategoria</th>
                  </tr>
                </thead>
                <tbody id="importPreviewBody"></tbody>
              </table>
            </div>
          </div>

          <!-- Step 3: result -->
          <div id="importStep3" style="display:none;text-align:center;padding:30px 0">
            <div id="importResultIcon" style="font-size:48px;margin-bottom:12px">✓</div>
            <div id="importResultText" style="font-size:16px;font-weight:700;margin-bottom:6px"></div>
            <div id="importResultSub" style="font-size:13px;color:var(--text-dim)"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="importCancelBtn">Anuluj</button>
          <button class="btn btn-primary" id="importDoBtn" style="display:none">Importuj</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let parsedRows = [];
    const existingIPs = new Set(NVR.cameras.map(c => c.ip));

    const close = () => modal.remove();
    modal.querySelector('#importClose').addEventListener('click', close);
    modal.querySelector('#importCancelBtn').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Populate category datalist
    NVR.api.get('/api/categories').then(cats => {
      const dl = modal.querySelector('#importCatList');
      dl.innerHTML = cats.map(c => `<option value="${escHtml(c.name)}"></option>`).join('');
    }).catch(() => {});

    // Dropzone click
    const dropzone = modal.querySelector('#importDropzone');
    const fileInput = modal.querySelector('#importFile');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) processFile(fileInput.files[0]);
    });

    function processFile(file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const XLSX = window.XLSX;
          let rows = [];

          if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          } else {
            // CSV / TXT
            const text = new TextDecoder().decode(e.target.result);
            const sep = text.includes('\t') ? '\t' : ',';
            rows = text.split('\n').filter(l => l.trim()).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
          }

          parsedRows = parseRows(rows);
          showPreview();
        } catch (err) {
          NVR.toast('error', 'Błąd parsowania', err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function parseRows(rows) {
      return rows.map(row => {
        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();
        const col2 = String(row[2] || '').trim();

        if (!col0 || !/^\d+\.\d+\.\d+\.\d+$/.test(col0)) return null; // not a valid IP

        let username = '', password = '', name = '';

        if (col1.includes(':')) {
          // col1 = "login:hasło"
          const idx = col1.indexOf(':');
          username = col1.slice(0, idx);
          password = col1.slice(idx + 1);
          name = col2 || col0;
        } else if (col1) {
          // col1 = nazwa (brak loginu)
          name = col1;
        } else {
          name = col0;
        }

        return { ip: col0, username, password, name: name || col0, enabled: true, _checked: true };
      }).filter(Boolean);
    }

    function showPreview() {
      modal.querySelector('#importStep1').style.display = 'none';
      modal.querySelector('#importStep2').style.display = '';
      modal.querySelector('#importDoBtn').style.display = '';

      renderPreviewTable();
    }

    function renderPreviewTable() {
      const tbody  = modal.querySelector('#importPreviewBody');
      const dupIPs = existingIPs;

      tbody.innerHTML = parsedRows.map((row, i) => {
        const isDup = dupIPs.has(row.ip);
        return `
          <tr style="${isDup ? 'opacity:.5' : ''}" data-i="${i}">
            <td style="padding:6px 10px">
              <input type="checkbox" data-check="${i}" ${row._checked ? 'checked' : ''} ${isDup ? 'disabled title="Duplikat IP"' : ''} style="accent-color:var(--accent)"/>
            </td>
            <td style="padding:6px 10px;font-family:monospace;color:var(--accent)">${escHtml(row.ip)}</td>
            <td style="padding:6px 10px;color:var(--text-dim)">${escHtml(row.username || '—')}</td>
            <td style="padding:6px 10px;color:var(--text-dim)">${row.password ? '••••••' : '—'}</td>
            <td style="padding:6px 10px">
              <input type="text" value="${escHtml(row.name)}" data-name="${i}"
                style="background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text);font-size:12px;padding:2px 6px;width:100%"
                onfocus="this.style.borderColor='var(--border)'"
                onblur="this.style.borderColor='transparent'"/>
            </td>
            <td style="padding:6px 10px">
              <input type="text" value="${escHtml(row.category || '')}" placeholder="default" data-cat="${i}"
                style="background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text-dim);font-size:12px;padding:2px 6px;width:90px"
                onfocus="this.style.borderColor='var(--border)'"
                onblur="this.style.borderColor='transparent'"/>
            </td>
          </tr>
        `;
      }).join('');

      // Live edit name/category
      tbody.querySelectorAll('[data-name]').forEach(inp => {
        inp.addEventListener('change', () => { parsedRows[parseInt(inp.dataset.name)].name = inp.value; });
      });
      tbody.querySelectorAll('[data-cat]').forEach(inp => {
        inp.addEventListener('change', () => { parsedRows[parseInt(inp.dataset.cat)].category = inp.value; });
      });
      tbody.querySelectorAll('[data-check]').forEach(cb => {
        cb.addEventListener('change', () => { parsedRows[parseInt(cb.dataset.check)]._checked = cb.checked; updateSummary(); });
      });

      updateSummary();
    }

    function updateSummary() {
      const checked = parsedRows.filter(r => r._checked).length;
      const dups    = parsedRows.filter(r => existingIPs.has(r.ip)).length;
      modal.querySelector('#importSummary').innerHTML =
        `Znaleziono <strong>${parsedRows.length}</strong> kamer · zaznaczono <strong>${checked}</strong>` +
        (dups ? ` · <span style="color:var(--warning)">${dups} duplikatów IP</span>` : '');
    }

    // Import button
    modal.querySelector('#importDoBtn').addEventListener('click', async () => {
      const skipDuplicates = modal.querySelector('#importSkipDup').checked;
      const defaultCategory = modal.querySelector('#importDefCat').value.trim() || 'default';
      const toImport = parsedRows
        .filter(r => r._checked)
        .map(r => ({ ...r, category: r.category || defaultCategory }));

      if (!toImport.length) { NVR.toast('warning', 'Brak zaznaczonych', 'Zaznacz przynajmniej jedną kamerę'); return; }

      const btn = modal.querySelector('#importDoBtn');
      btn.disabled = true; btn.textContent = 'Importowanie...';

      try {
        const res = await NVR.api.post('/api/cameras/import', { cameras: toImport, skipDuplicates, defaultCategory });

        modal.querySelector('#importStep2').style.display = 'none';
        modal.querySelector('#importStep3').style.display = '';
        btn.style.display = 'none';
        modal.querySelector('#importCancelBtn').textContent = 'Zamknij';

        modal.querySelector('#importResultIcon').textContent = res.errors?.length ? '⚠️' : '✅';
        modal.querySelector('#importResultText').textContent = `Zaimportowano ${res.imported} kamer`;
        modal.querySelector('#importResultSub').innerHTML =
          `Pominięto: ${res.skipped} · Błędy: ${res.errors?.length || 0}` +
          (res.errors?.length ? `<br><span style="color:var(--danger)">${res.errors.map(e => e.ip + ': ' + e.error).join('<br>')}</span>` : '');

        await NVR.loadCameras();
        renderPage();
      } catch (e) {
        NVR.toast('error', 'Błąd importu', e.message);
        btn.disabled = false; btn.textContent = 'Importuj';
      }
    });
  }

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

})();

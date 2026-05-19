'use strict';

/* ============================================================
   Map View — Leaflet + OpenStreetMap
   ============================================================ */
(function () {

  const ELK_LAT = 53.8278;
  const ELK_LNG = 22.3729;

  let map        = null;
  let markers    = {}; // cameraId -> L.Marker
  let initialized = false;

  /* ----------------------------------------------------------
     Init page
  ---------------------------------------------------------- */
  function initMap() {
    const page = document.getElementById('page-map');
    page.innerHTML = '';

    const mapDiv = document.createElement('div');
    mapDiv.className = 'map-page';
    mapDiv.innerHTML = '<div id="leafletMap"></div>';
    page.appendChild(mapDiv);

    if (!initialized) {
      createMap();
      initialized = true;
      // Delay invalidateSize so the browser finishes layout (incl. bottom nav)
      requestAnimationFrame(() => setTimeout(() => map && map.invalidateSize(), 50));
    } else {
      // Re-insert map into DOM
      document.getElementById('leafletMap').appendChild(map.getContainer());
      requestAnimationFrame(() => map.invalidateSize());
    }

    placeMarkers();
    renderTopbar();
  }

  /* ----------------------------------------------------------
     Create Leaflet map
  ---------------------------------------------------------- */
  function createMap() {
    map = L.map('leafletMap', {
      center: [ELK_LAT, ELK_LNG],
      zoom: 14,
      zoomControl: true
    });

    // Dark-ish tile layer (CartoDB Dark)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);
  }

  /* ----------------------------------------------------------
     Place / update markers
  ---------------------------------------------------------- */
  function placeMarkers() {
    if (!map) return;

    // Remove old markers not in camera list
    const currentIds = new Set(NVR.cameras.map(c => c.id));
    Object.keys(markers).forEach(id => {
      if (!currentIds.has(parseInt(id))) {
        map.removeLayer(markers[id]);
        delete markers[id];
      }
    });

    NVR.cameras.forEach(cam => {
      if (cam.lat == null || cam.lng == null) return;
      updateMarker(cam);
    });
  }

  function updateMarker(cam) {
    const status  = getCameraMarkerStatus(cam);
    const icon    = buildIcon(status);

    if (markers[cam.id]) {
      markers[cam.id].setLatLng([cam.lat, cam.lng]);
      markers[cam.id].setIcon(icon);
    } else {
      const marker = L.marker([cam.lat, cam.lng], {
        icon,
        title: cam.name,
        draggable: true
      });

      marker.on('dragend', async (e) => {
        const latlng = e.target.getLatLng();
        try {
          await NVR.api.put(`/api/cameras/${cam.id}`, {
            lat: parseFloat(latlng.lat.toFixed(6)),
            lng: parseFloat(latlng.lng.toFixed(6))
          });
          // Update local camera data
          const c = NVR.cameras.find(c2 => c2.id === cam.id);
          if (c) { c.lat = latlng.lat; c.lng = latlng.lng; }
          NVR.toast('success', 'Position Saved', cam.name);
        } catch (err) {
          NVR.toast('error', 'Save Failed', err.message);
        }
      });

      marker.bindPopup(() => buildPopup(cam), { maxWidth: 240 });
      marker.addTo(map);
      markers[cam.id] = marker;
    }
  }

  /* ----------------------------------------------------------
     Build marker icon
  ---------------------------------------------------------- */
  function buildIcon(status) {
    const cls = {
      online:    'cm-online',
      offline:   'cm-offline',
      streaming: 'cm-streaming',
      disabled:  'cm-disabled'
    }[status] || 'cm-offline';

    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>`;

    const html = `<div class="cam-marker"><div class="cam-marker-inner ${cls}">${svg}</div></div>`;

    return L.divIcon({
      html,
      className: '',
      iconSize:  [32, 32],
      iconAnchor:[16, 16],
      popupAnchor:[0, -18]
    });
  }

  /* ----------------------------------------------------------
     Build popup content
  ---------------------------------------------------------- */
  function buildPopup(cam) {
    const el = document.createElement('div');
    el.className = 'map-popup';

    const status = getCameraMarkerStatus(cam);

    el.innerHTML = `
      <div class="popup-name">${escHtml(cam.name)}</div>
      <div class="popup-meta">
        ${escHtml(cam.ip)}:${cam.port} &bull; ${escHtml(cam.brand)} &bull;
        <span style="color:${statusColor(status)}">${status}</span>
      </div>
      <div style="font-size:11px;color:#666;margin-bottom:8px">
        ${cam.lat.toFixed(5)}, ${cam.lng.toFixed(5)}
      </div>
      <div class="popup-actions">
        ${cam.enabled ? `<button class="popup-btn" id="popupStream-${cam.id}">View Stream</button>` : ''}
        <button class="popup-btn" id="popupEdit-${cam.id}" style="background:#30363d">Edit</button>
      </div>
    `;

    // Bind after next tick so element is in DOM
    setTimeout(() => {
      const streamBtn = document.getElementById(`popupStream-${cam.id}`);
      const editBtn   = document.getElementById(`popupEdit-${cam.id}`);

      if (streamBtn) {
        streamBtn.addEventListener('click', () => {
          openMapStream(cam);
        });
      }
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          NVR.api.get(`/api/cameras/${cam.id}`).then(full => {
            NVR.cameraModal.open(full, async () => {
              await NVR.loadCameras();
              placeMarkers();
            });
          }).catch(err => NVR.toast('error', 'Error', err.message));
        });
      }
    }, 0);

    return el;
  }

  /* ----------------------------------------------------------
     Open stream from map popup
  ---------------------------------------------------------- */
  function openMapStream(cam) {
    const hasPtz = cam.brand === 'hikvision' || cam.brand === 'dahua';

    const overlay = document.createElement('div');
    overlay.className = 'stream-modal-overlay';
    overlay.id = 'mapStreamOverlay';

    overlay.innerHTML = `
      <div class="stream-modal">
        <div class="stream-modal-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:700;font-size:15px">${escHtml(cam.name)}</span>
            <span class="chip">${escHtml(cam.brand)}</span>
          </div>
          <button class="modal-close" id="mapStreamClose">&times;</button>
        </div>
        <div class="stream-modal-body">
          <div class="stream-video-area">
            <video id="mapStreamVideo" muted playsinline autoplay controls></video>
            <div class="tile-overlay" id="mapStreamOverlayInner">
              <div class="spinner"></div>
              <span>Connecting...</span>
            </div>
          </div>
          ${hasPtz ? `<div class="stream-side-panel" id="mapStreamPtz"></div>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const video   = overlay.querySelector('#mapStreamVideo');
    const innerOv = overlay.querySelector('#mapStreamOverlayInner');
    let   hlsInst = null;

    function handleReady(id) {
      if (id !== cam.id) return;
      innerOv.classList.add('hidden');
      if (hlsInst) { try { hlsInst.destroy(); } catch (_) {} }
      hlsInst = NVR.createPlayer(video, cam.id);
    }
    function handleError(id, err) {
      if (id !== cam.id) return;
      innerOv.innerHTML = `<span>${escHtml(err||'Stream failed')}</span>`;
    }

    NVR._streamReadyListeners.push(handleReady);
    NVR._streamErrorListeners.push(handleError);
    NVR.socket.emit('watch_camera', cam.id);

    if (NVR.streamStatuses[cam.id] === 'streaming') handleReady(cam.id);

    if (hasPtz) {
      const panel = overlay.querySelector('#mapStreamPtz');
      if (panel) NVR.ptzControl.render(panel, cam);
    }

    function cleanup() {
      NVR.socket.emit('unwatch_camera', cam.id);
      [NVR._streamReadyListeners, NVR._streamErrorListeners].forEach(arr => {
        [handleReady, handleError].forEach(fn => {
          const i = arr.indexOf(fn);
          if (i !== -1) arr.splice(i, 1);
        });
      });
      if (hlsInst) { try { hlsInst.destroy(); } catch (_) {} }
      overlay.classList.remove('open');
      setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 250);
    }

    overlay.querySelector('#mapStreamClose').addEventListener('click', cleanup);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
  }

  /* ----------------------------------------------------------
     Topbar: center / refresh
  ---------------------------------------------------------- */
  function renderTopbar() {
    const el = document.getElementById('topbarActions');
    el.innerHTML = `
      <button class="btn btn-secondary btn-sm" id="mapCenter">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
        Center Map
      </button>
      <button class="btn btn-secondary btn-sm" id="mapRefresh">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Refresh
      </button>
    `;

    document.getElementById('mapCenter').addEventListener('click', () => {
      if (map) map.setView([ELK_LAT, ELK_LNG], 14, { animate: true });
    });

    document.getElementById('mapRefresh').addEventListener('click', async () => {
      await NVR.loadCameras();
      placeMarkers();
    });
  }

  /* ----------------------------------------------------------
     Status listeners
  ---------------------------------------------------------- */
  NVR._statusListeners.push((cameraId, status) => {
    if (!map) return;
    const cam = NVR.cameras.find(c => c.id === cameraId);
    if (cam) updateMarker(cam);
  });

  NVR._streamReadyListeners.push((cameraId) => {
    if (!map) return;
    const cam = NVR.cameras.find(c => c.id === cameraId);
    if (cam) updateMarker(cam);
  });

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function getCameraMarkerStatus(cam) {
    if (!cam.enabled) return 'disabled';
    const st = NVR.streamStatuses[cam.id];
    if (st === 'streaming') return 'streaming';
    return 'online';
  }

  function statusColor(status) {
    return { online:'#3fb950', offline:'#8b949e', streaming:'#58a6ff', disabled:'#f85149' }[status] || '#8b949e';
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  /* ----------------------------------------------------------
     Register page
  ---------------------------------------------------------- */
  NVR.pages.map = initMap;
  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.map = renderTopbar;

})();

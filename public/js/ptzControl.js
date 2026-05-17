'use strict';

/* ============================================================
   PTZ Control Panel
   ============================================================ */
window.NVR = window.NVR || {};

NVR.ptzControl = (function () {

  /* ----------------------------------------------------------
     Render PTZ panel into a container element
  ---------------------------------------------------------- */
  function render(container, cam) {
    container.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'ptz-panel';
    panel.dataset.cameraId = cam.id;

    panel.innerHTML = `
      <div class="ptz-title">PTZ Control — ${escHtml(cam.brand)}</div>

      <!-- D-Pad -->
      <div class="ptz-dpad">
        ${dpadBtn('up_left',    arrowSvg('↖'))}
        ${dpadBtn('up',         arrowSvg('↑'))}
        ${dpadBtn('up_right',   arrowSvg('↗'))}
        ${dpadBtn('left',       arrowSvg('←'))}
        ${dpadBtn('stop',       stopSvg(), 'center')}
        ${dpadBtn('right',      arrowSvg('→'))}
        ${dpadBtn('down_left',  arrowSvg('↙'))}
        ${dpadBtn('down',       arrowSvg('↓'))}
        ${dpadBtn('down_right', arrowSvg('↘'))}
      </div>

      <!-- Zoom -->
      <div class="ptz-zoom">
        <button class="ptz-zoom-btn" data-zoom="out" title="Zoom Out">−</button>
        <span class="ptz-zoom-label">ZOOM</span>
        <button class="ptz-zoom-btn" data-zoom="in" title="Zoom In">+</button>
      </div>

      <!-- Speed -->
      <div class="ptz-speed">
        <label>Speed</label>
        <input type="range" class="ptz-speed-slider" min="1" max="100" value="50" />
        <span class="ptz-speed-val">50</span>
      </div>

      <!-- Presets -->
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--text-muted);margin-bottom:8px">Presets</div>
        <div class="ptz-presets" id="presets-${cam.id}">
          <span style="font-size:11px;color:var(--text-dim)">Loading...</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input type="number" class="ptz-preset-num" placeholder="#" min="1" max="255"
            style="width:52px;padding:4px 6px;font-size:12px" />
          <input type="text" class="ptz-preset-name" placeholder="Name"
            style="flex:1;padding:4px 8px;font-size:12px" />
          <button class="btn btn-sm btn-secondary ptz-save-preset" title="Save Preset">Save</button>
        </div>
      </div>
    `;

    container.appendChild(panel);

    // Bind events
    bindDpad(panel, cam);
    bindZoom(panel, cam);
    bindSpeed(panel);
    bindPresets(panel, cam);

    // Load presets from server
    loadPresets(panel, cam);
  }

  /* ----------------------------------------------------------
     D-Pad buttons HTML helpers
  ---------------------------------------------------------- */
  function dpadBtn(dir, iconHtml, extraClass = '') {
    return `<button class="ptz-btn ${extraClass}" data-dir="${dir}" title="${dir}">${iconHtml}</button>`;
  }

  function arrowSvg(char) {
    return `<span style="font-size:18px;line-height:1">${char}</span>`;
  }

  function stopSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>`;
  }

  /* ----------------------------------------------------------
     Bind D-Pad: mousedown/touchstart → move, mouseup/touchend → stop
  ---------------------------------------------------------- */
  function bindDpad(panel, cam) {
    panel.querySelectorAll('.ptz-btn').forEach(btn => {
      const dir = btn.dataset.dir;

      const startMove = async (e) => {
        e.preventDefault();
        btn.classList.add('active');

        if (dir === 'stop') {
          sendStop(cam, null);
          return;
        }
        const speed = getSpeed(panel);
        try {
          await NVR.api.post(`/api/cameras/${cam.id}/ptz/move`, { direction: dir, speed });
        } catch (err) {
          NVR.toast('error', 'PTZ Error', err.message);
        }
      };

      const stopMove = async (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        if (dir !== 'stop') {
          sendStop(cam, dir);
        }
      };

      btn.addEventListener('mousedown', startMove);
      btn.addEventListener('touchstart', startMove, { passive: false });
      btn.addEventListener('mouseup', stopMove);
      btn.addEventListener('mouseleave', stopMove);
      btn.addEventListener('touchend', stopMove);
      btn.addEventListener('touchcancel', stopMove);
    });
  }

  /* ----------------------------------------------------------
     Zoom buttons
  ---------------------------------------------------------- */
  function bindZoom(panel, cam) {
    panel.querySelectorAll('.ptz-zoom-btn').forEach(btn => {
      const dir = btn.dataset.zoom === 'in' ? 'zoom_in' : 'zoom_out';
      const speed = () => getSpeed(panel);

      const startZoom = async (e) => {
        e.preventDefault();
        btn.classList.add('active');
        try {
          await NVR.api.post(`/api/cameras/${cam.id}/ptz/move`, { direction: dir, speed: speed() });
        } catch (err) {
          NVR.toast('error', 'PTZ Error', err.message);
        }
      };

      const stopZoom = async (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        sendStop(cam, dir);
      };

      btn.addEventListener('mousedown', startZoom);
      btn.addEventListener('touchstart', startZoom, { passive: false });
      btn.addEventListener('mouseup', stopZoom);
      btn.addEventListener('mouseleave', stopZoom);
      btn.addEventListener('touchend', stopZoom);
      btn.addEventListener('touchcancel', stopZoom);
    });
  }

  /* ----------------------------------------------------------
     Speed slider
  ---------------------------------------------------------- */
  function bindSpeed(panel) {
    const slider = panel.querySelector('.ptz-speed-slider');
    const valEl  = panel.querySelector('.ptz-speed-val');
    if (!slider || !valEl) return;

    slider.addEventListener('input', () => {
      valEl.textContent = slider.value;
    });
  }

  function getSpeed(panel) {
    const slider = panel.querySelector('.ptz-speed-slider');
    return slider ? parseInt(slider.value) : 50;
  }

  /* ----------------------------------------------------------
     Stop helper
  ---------------------------------------------------------- */
  async function sendStop(cam, direction) {
    try {
      await NVR.api.post(`/api/cameras/${cam.id}/ptz/stop`, { direction });
    } catch (err) {
      // Silently ignore stop errors (camera may have already stopped)
      console.warn('[PTZ] Stop failed:', err.message);
    }
  }

  /* ----------------------------------------------------------
     Presets
  ---------------------------------------------------------- */
  function bindPresets(panel, cam) {
    panel.querySelector('.ptz-save-preset').addEventListener('click', async () => {
      const numInput  = panel.querySelector('.ptz-preset-num');
      const nameInput = panel.querySelector('.ptz-preset-name');
      const num  = parseInt(numInput.value);
      const name = nameInput.value.trim() || `Preset ${num}`;

      if (!num || num < 1 || num > 255) {
        NVR.toast('warning', 'Invalid', 'Preset number must be 1-255');
        return;
      }

      try {
        await NVR.api.post(`/api/cameras/${cam.id}/ptz/preset/save`, { presetNumber: num, name });
        NVR.toast('success', 'Preset Saved', name);
        numInput.value  = '';
        nameInput.value = '';
        loadPresets(panel, cam);
      } catch (err) {
        NVR.toast('error', 'Save Failed', err.message);
      }
    });
  }

  async function loadPresets(panel, cam) {
    const container = panel.querySelector(`#presets-${cam.id}`);
    if (!container) return;

    try {
      const presets = await NVR.api.get(`/api/cameras/${cam.id}/ptz/presets`);

      if (!presets.length) {
        container.innerHTML = '<span style="font-size:11px;color:var(--text-dim)">No presets saved</span>';
        return;
      }

      container.innerHTML = '';
      presets.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.title = `Go to ${preset.name}`;
        btn.innerHTML = `${escHtml(preset.name)} <span style="opacity:.5;font-size:10px">#${preset.preset_number}</span>`;

        btn.addEventListener('click', async () => {
          try {
            await NVR.api.post(`/api/cameras/${cam.id}/ptz/preset/goto`, { presetNumber: preset.preset_number });
            NVR.toast('success', 'Preset', `Going to ${preset.name}`);
          } catch (err) {
            NVR.toast('error', 'PTZ Error', err.message);
          }
        });

        btn.addEventListener('contextmenu', async (e) => {
          e.preventDefault();
          if (!confirm(`Delete preset "${preset.name}"?`)) return;
          try {
            await NVR.api.del(`/api/cameras/${cam.id}/ptz/preset/${preset.preset_number}`);
            NVR.toast('success', 'Deleted', preset.name);
            loadPresets(panel, cam);
          } catch (err) {
            NVR.toast('error', 'Delete Failed', err.message);
          }
        });

        container.appendChild(btn);
      });
    } catch (err) {
      container.innerHTML = `<span style="font-size:11px;color:var(--danger)">Error: ${escHtml(err.message)}</span>`;
    }
  }

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  return { render };

})();

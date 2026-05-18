'use strict';

/* ============================================================
   Admin Panel
   ============================================================ */
(function () {

  const PERMISSIONS = [
    { key: 'edit_cameras',       label: 'Edycja kamer',      desc: 'Dodawanie, edycja i usuwanie kamer' },
    { key: 'ptz',                label: 'Sterowanie PTZ',    desc: 'Obracanie kamerami PTZ' },
    { key: 'manage_categories',  label: 'Zarządzanie kategoriami', desc: 'Dodawanie i usuwanie kategorii' },
    { key: 'view_logs',          label: 'Podgląd logów',     desc: 'Dostęp do dziennika zdarzeń' }
  ];

  let adminTab = 'users';

  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  async function initAdmin() {
    const page = document.getElementById('page-admin');
    page.innerHTML = '';

    // Only admins should see this page
    const me = await NVR.api.get('/api/auth/me').catch(() => null);
    if (!me || me.role !== 'admin') {
      page.innerHTML = '<div class="empty-state"><h3>Brak dostępu</h3><p>Ta strona jest dostępna tylko dla administratorów.</p></div>';
      return;
    }

    page.innerHTML = `
      <div class="admin-wrap">
        <div class="admin-tabs">
          <button class="admin-tab active" data-tab="users">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Użytkownicy
          </button>
          <button class="admin-tab" data-tab="logs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Logi zdarzeń
          </button>
          <button class="admin-tab" data-tab="sessions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            Aktywne sesje
          </button>
          <button class="admin-tab" data-tab="streams">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            Streamy
          </button>
          <button class="admin-tab" data-tab="myaccount">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Moje konto
          </button>
        </div>
        <div class="admin-body" id="adminBody"></div>
      </div>
    `;

    page.querySelectorAll('.admin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        page.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        adminTab = btn.dataset.tab;
        renderAdminTab(adminTab);
      });
    });

    renderAdminTab(adminTab);
  }

  function renderAdminTab(tab) {
    const body = document.getElementById('adminBody');
    if (!body) return;
    if (tab === 'users')     renderUsers(body);
    if (tab === 'logs')      renderLogs(body);
    if (tab === 'sessions')  renderSessions(body);
    if (tab === 'streams')   renderStreams(body);
    if (tab === 'myaccount') renderMyAccount(body);
  }

  /* ----------------------------------------------------------
     Users tab
  ---------------------------------------------------------- */
  async function renderUsers(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:16px;font-weight:700">Użytkownicy systemu</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Zarządzanie kontami i uprawnieniami</div>
        </div>
        <button class="btn btn-primary btn-sm" id="addUserBtn">+ Nowy użytkownik</button>
      </div>
      <div id="usersTableWrap"><div style="padding:24px;color:var(--text-dim);text-align:center">Ładowanie...</div></div>
    `;

    document.getElementById('addUserBtn').addEventListener('click', () => openUserModal(null, reloadUsers));

    reloadUsers();
  }

  async function reloadUsers() {
    const wrap = document.getElementById('usersTableWrap');
    if (!wrap) return;
    try {
      const users = await NVR.api.get('/api/admin/users');
      if (!users.length) { wrap.innerHTML = '<div style="padding:24px;color:var(--text-dim);text-align:center">Brak użytkowników</div>'; return; }

      wrap.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Użytkownik</th>
              <th>Rola</th>
              <th>Status</th>
              <th>Ostatnie logowanie</th>
              <th>IP</th>
              <th style="text-align:right">Akcje</th>
            </tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:10px">
                      <div class="user-avatar" style="background:${avatarColor(u.username)}">
                        ${escHtml((u.display_name || u.username)[0].toUpperCase())}
                      </div>
                      <div>
                        <div style="font-weight:600">${escHtml(u.display_name || u.username)}</div>
                        <div style="font-size:11px;color:var(--text-dim)">@${escHtml(u.username)}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="role-badge role-${u.role}">${roleLabel(u.role)}</span></td>
                  <td>
                    ${u.is_active
                      ? '<span class="status-pill pill-enabled"><span class="dot"></span>Aktywny</span>'
                      : '<span class="status-pill pill-disabled"><span class="dot"></span>Zablokowany</span>'}
                    ${u.locked_until && new Date(u.locked_until) > new Date()
                      ? `<span style="font-size:10px;color:var(--danger);margin-left:4px">🔒 brute-force</span>` : ''}
                  </td>
                  <td style="font-size:12px;color:var(--text-dim)">${u.last_login ? fmtDate(u.last_login) : '—'}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${escHtml(u.last_login_ip || '—')}</td>
                  <td>
                    <div class="td-actions" style="justify-content:flex-end;gap:6px">
                      ${u.locked_until && new Date(u.locked_until) > new Date()
                        ? `<button class="btn btn-sm btn-secondary" data-unlock="${u.id}">Odblokuj</button>` : ''}
                      <button class="btn btn-sm btn-secondary" data-edit="${u.id}">Edytuj</button>
                      ${u.username !== 'admin'
                        ? `<button class="btn btn-sm btn-danger" data-del="${u.id}" data-name="${escHtml(u.username)}">Usuń</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      wrap.querySelectorAll('[data-edit]').forEach(btn => {
        const u = users.find(x => x.id === parseInt(btn.dataset.edit));
        if (u) btn.addEventListener('click', () => openUserModal(u, reloadUsers));
      });

      wrap.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Usunąć użytkownika "${btn.dataset.name}"?`)) return;
          try {
            await NVR.api.del(`/api/admin/users/${btn.dataset.del}`);
            NVR.toast('success', 'Usunięto', btn.dataset.name);
            reloadUsers();
          } catch (e) { NVR.toast('error', 'Błąd', e.message); }
        });
      });

      wrap.querySelectorAll('[data-unlock]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await NVR.api.post(`/api/admin/users/${btn.dataset.unlock}/unlock`, {});
            NVR.toast('success', 'Odblokowano', 'Konto zostało odblokowane');
            reloadUsers();
          } catch (e) { NVR.toast('error', 'Błąd', e.message); }
        });
      });
    } catch (e) {
      wrap.innerHTML = `<div style="padding:24px;color:var(--danger);text-align:center">Błąd: ${escHtml(e.message)}</div>`;
    }
  }

  /* ----------------------------------------------------------
     User modal (add / edit)
  ---------------------------------------------------------- */
  function openUserModal(user, onSave) {
    const old = document.getElementById('userModal');
    if (old) old.remove();

    const isEdit = !!user;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'userModal';

    const currentPerms = user ? JSON.parse(user.permissions || '{}') : {};

    modal.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2>${isEdit ? 'Edytuj użytkownika' : 'Nowy użytkownik'}</h2>
          <button class="modal-close" id="uClose">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Login *</label>
              <input type="text" id="uUsername" value="${escHtml(user?.username || '')}" ${isEdit ? 'disabled' : ''} placeholder="jan.kowalski"/>
            </div>
            <div class="form-group">
              <label>Nazwa wyświetlana</label>
              <input type="text" id="uDisplayName" value="${escHtml(user?.display_name || '')}" placeholder="Jan Kowalski"/>
            </div>
            <div class="form-group">
              <label>${isEdit ? 'Nowe hasło (puste = bez zmiany)' : 'Hasło *'}</label>
              <input type="password" id="uPassword" placeholder="min. 6 znaków" autocomplete="new-password"/>
            </div>
            <div class="form-group">
              <label>Rola</label>
              <select id="uRole">
                <option value="viewer"   ${user?.role==='viewer'   ?'selected':''}>Przeglądający</option>
                <option value="operator" ${user?.role==='operator' ?'selected':''}>Operator</option>
                <option value="admin"    ${user?.role==='admin'    ?'selected':''}>Administrator</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-top:4px">
            <label>Status konta</label>
            <select id="uActive">
              <option value="1" ${!user || user.is_active ? 'selected' : ''}>Aktywne</option>
              <option value="0" ${user && !user.is_active ? 'selected' : ''}>Zablokowane</option>
            </select>
          </div>

          <div style="margin-top:16px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-dim);margin-bottom:10px">
              Dodatkowe uprawnienia (dla roli Operator / Przeglądający)
            </div>
            <div style="display:flex;flex-direction:column;gap:8px" id="permList">
              ${PERMISSIONS.map(p => `
                <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--border)">
                  <input type="checkbox" data-perm="${p.key}" ${currentPerms[p.key] ? 'checked' : ''} style="margin-top:2px;accent-color:var(--accent)"/>
                  <div>
                    <div style="font-size:13px;font-weight:600">${p.label}</div>
                    <div style="font-size:11px;color:var(--text-dim)">${p.desc}</div>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group" style="margin-top:14px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
              <input type="checkbox" id="uForcePwd" ${!isEdit || user?.force_password_change ? 'checked' : ''} style="accent-color:var(--accent)"/>
              Wymuś zmianę hasła przy następnym logowaniu
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="uCancel">Anuluj</button>
          <button class="btn btn-primary" id="uSave">Zapisz</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#uClose').addEventListener('click', close);
    modal.querySelector('#uCancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#uSave').addEventListener('click', async () => {
      const username    = document.getElementById('uUsername')?.value?.trim() || user?.username;
      const displayName = document.getElementById('uDisplayName').value.trim();
      const password    = document.getElementById('uPassword').value;
      const role        = document.getElementById('uRole').value;
      const isActive    = document.getElementById('uActive').value === '1';
      const forcePwd    = document.getElementById('uForcePwd').checked;

      const permissions = {};
      modal.querySelectorAll('[data-perm]').forEach(cb => {
        if (cb.checked) permissions[cb.dataset.perm] = true;
      });

      if (!isEdit && !password) { NVR.toast('error', 'Błąd', 'Hasło jest wymagane'); return; }
      if (password && password.length < 6) { NVR.toast('error', 'Błąd', 'Hasło min. 6 znaków'); return; }

      const saveBtn = modal.querySelector('#uSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie...';

      try {
        if (isEdit) {
          await NVR.api.put(`/api/admin/users/${user.id}`, {
            display_name: displayName, role, permissions, is_active: isActive,
            force_password_change: forcePwd, newPassword: password || undefined
          });
          NVR.toast('success', 'Zapisano', displayName || username);
        } else {
          await NVR.api.post('/api/admin/users', {
            username, display_name: displayName, password, role, permissions,
            force_password_change: forcePwd
          });
          NVR.toast('success', 'Dodano', displayName || username);
        }
        close();
        if (onSave) onSave();
      } catch (e) {
        NVR.toast('error', 'Błąd', e.message);
        saveBtn.disabled = false; saveBtn.textContent = 'Zapisz';
      }
    });
  }

  /* ----------------------------------------------------------
     Logs tab
  ---------------------------------------------------------- */
  async function renderLogs(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:16px;font-weight:700">Dziennik zdarzeń</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Ostatnie 200 wpisów</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="logFilterUser" placeholder="Filtruj użytkownika..." style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:13px;width:160px"/>
          <select id="logFilterAction" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:13px">
            <option value="">Wszystkie akcje</option>
            <option value="LOGIN">Logowania</option>
            <option value="LOGIN_FAILED">Błędne logowania</option>
            <option value="LOGOUT">Wylogowania</option>
            <option value="CHANGE_PASSWORD">Zmiana hasła</option>
            <option value="CREATE_USER">Nowy użytkownik</option>
            <option value="DELETE_USER">Usunięcie użytkownika</option>
            <option value="CREATE_CATEGORY">Kategoria</option>
          </select>
          <button class="btn btn-sm btn-secondary" id="logRefreshBtn">Odśwież</button>
        </div>
      </div>
      <div id="logsBody"><div style="padding:24px;color:var(--text-dim);text-align:center">Ładowanie...</div></div>
    `;

    const refresh = () => loadLogs();

    document.getElementById('logRefreshBtn').addEventListener('click', refresh);
    document.getElementById('logFilterUser').addEventListener('input', () => setTimeout(refresh, 300));
    document.getElementById('logFilterAction').addEventListener('change', refresh);

    loadLogs();
  }

  async function loadLogs() {
    const logsBody = document.getElementById('logsBody');
    if (!logsBody) return;

    const username = document.getElementById('logFilterUser')?.value || '';
    const action   = document.getElementById('logFilterAction')?.value || '';

    try {
      const params = new URLSearchParams({ limit: 200 });
      if (username) params.set('username', username);
      if (action)   params.set('action', action);

      const logs = await NVR.api.get(`/api/admin/logs?${params}`);

      if (!logs.length) {
        logsBody.innerHTML = '<div style="padding:24px;color:var(--text-dim);text-align:center">Brak wpisów</div>';
        return;
      }

      logsBody.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Czas</th>
              <th>Użytkownik</th>
              <th>Akcja</th>
              <th>Zasób</th>
              <th>IP</th>
              <th>Urządzenie</th>
              <th>Szczegóły</th>
            </tr></thead>
            <tbody>
              ${logs.map(l => `
                <tr>
                  <td style="font-size:11px;white-space:nowrap;color:var(--text-dim)">${fmtDate(l.created_at)}</td>
                  <td>
                    <div style="font-weight:600;font-size:13px">${escHtml(l.username || '—')}</div>
                  </td>
                  <td><span class="log-action log-${actionClass(l.action)}">${escHtml(l.action)}</span></td>
                  <td style="font-size:12px;color:var(--text-dim)">${escHtml(l.resource || '—')}</td>
                  <td style="font-size:12px;color:var(--text-dim);white-space:nowrap">${escHtml(l.ip || '—')}</td>
                  <td style="font-size:11px;color:var(--text-dim);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(l.user_agent || '')}">
                    ${escHtml(parseUA(l.user_agent))}
                  </td>
                  <td style="font-size:11px;color:var(--text-dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${escHtml(l.details ? JSON.stringify(JSON.parse(l.details)) : '—')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      logsBody.innerHTML = `<div style="padding:24px;color:var(--danger);text-align:center">Błąd: ${escHtml(e.message)}</div>`;
    }
  }

  /* ----------------------------------------------------------
     Sessions tab
  ---------------------------------------------------------- */
  async function renderSessions(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div>
          <div style="font-size:16px;font-weight:700">Aktywne sesje</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Użytkownicy aktualnie zalogowani</div>
        </div>
        <button class="btn btn-sm btn-secondary" id="sessRefresh">Odśwież</button>
      </div>
      <div id="sessBody"><div style="padding:24px;color:var(--text-dim);text-align:center">Ładowanie...</div></div>
    `;

    const load = async () => {
      const sessBody = document.getElementById('sessBody');
      if (!sessBody) return;
      try {
        const sessions = await NVR.api.get('/api/admin/sessions');
        if (!sessions.length) {
          sessBody.innerHTML = '<div style="padding:24px;color:var(--text-dim);text-align:center">Brak aktywnych sesji</div>';
          return;
        }
        sessBody.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Użytkownik</th><th>Rola</th><th>IP</th></tr></thead>
              <tbody>
                ${sessions.map(s => `
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        <div class="user-avatar" style="background:${avatarColor(s.username)}">
                          ${escHtml((s.displayName || s.username)[0].toUpperCase())}
                        </div>
                        <div>
                          <div style="font-weight:600">${escHtml(s.displayName || s.username)}</div>
                          <div style="font-size:11px;color:var(--text-dim)">@${escHtml(s.username)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="role-badge role-${s.role}">${roleLabel(s.role)}</span></td>
                    <td style="font-size:12px;color:var(--text-dim)">${escHtml(s.ip || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } catch (e) {
        sessBody.innerHTML = `<div style="padding:24px;color:var(--danger)">Błąd: ${escHtml(e.message)}</div>`;
      }
    };

    document.getElementById('sessRefresh').addEventListener('click', load);
    load();
  }

  /* ----------------------------------------------------------
     Streams tab
  ---------------------------------------------------------- */
  async function renderStreams(body) {
    const lazyOn = localStorage.getItem('nvr_lazy') === '1';

    body.innerHTML = `
      <div style="max-width:600px">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">Zarządzanie streamami</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:24px">Kontrola aktywnych procesów FFmpeg i trybu uruchamiania</div>

        <!-- Active streams card -->
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px">Aktywne strumienie</div>
              <div style="font-size:28px;font-weight:800;color:var(--accent)" id="activeStreamCount">—</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-secondary" id="streamsRefreshBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Odśwież
              </button>
              <button class="btn btn-sm btn-danger" id="stopAllStreamsBtn">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                Zatrzymaj wszystkie
              </button>
            </div>
          </div>
          <div id="streamsList" style="margin-top:16px"></div>
        </div>

        <!-- Lazy mode card -->
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
            <div>
              <div style="font-size:14px;font-weight:600;margin-bottom:4px">Tryb leniwy (on-demand)</div>
              <div style="font-size:12px;color:var(--text-dim);line-height:1.5">
                Gdy włączony, kafelki kamer na dashboardzie pokazują przycisk ▶ zamiast automatycznie uruchamiać stream.
                Strumień startuje dopiero po kliknięciu kafelka. Zmniejsza obciążenie serwera przy dużej liczbie kamer.
              </div>
            </div>
            <label class="toggle-switch" style="flex-shrink:0;margin-top:2px">
              <input type="checkbox" id="lazyModeToggle" ${lazyOn ? 'checked' : ''}/>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div id="lazyModeStatus" style="margin-top:12px;font-size:12px;color:var(--text-dim)">
            ${lazyOn
              ? '<span style="color:var(--accent)">● Włączony</span> — strumienie uruchamiają się po kliknięciu'
              : '<span style="color:var(--text-dim)">● Wyłączony</span> — strumienie uruchamiają się automatycznie'}
          </div>
        </div>
      </div>
    `;

    loadStreamsList();

    document.getElementById('streamsRefreshBtn').addEventListener('click', loadStreamsList);

    document.getElementById('stopAllStreamsBtn').addEventListener('click', async () => {
      const btn = document.getElementById('stopAllStreamsBtn');
      if (!confirm('Zatrzymać wszystkie aktywne strumienie FFmpeg?')) return;
      btn.disabled = true;
      btn.textContent = 'Zatrzymywanie...';
      try {
        await NVR.api.post('/api/streams/stop-all', {});
        NVR.toast('success', 'Zatrzymano', 'Wszystkie strumienie zostały zatrzymane');
        setTimeout(loadStreamsList, 800);
      } catch (e) {
        NVR.toast('error', 'Błąd', e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Zatrzymaj wszystkie`;
      }
    });

    document.getElementById('lazyModeToggle').addEventListener('change', (e) => {
      const on = e.target.checked;
      localStorage.setItem('nvr_lazy', on ? '1' : '0');
      const status = document.getElementById('lazyModeStatus');
      if (status) {
        status.innerHTML = on
          ? '<span style="color:var(--accent)">● Włączony</span> — strumienie uruchamiają się po kliknięciu'
          : '<span style="color:var(--text-dim)">● Wyłączony</span> — strumienie uruchamiają się automatycznie';
      }
      NVR.toast('success', 'Tryb leniwy', on ? 'Włączony' : 'Wyłączony');
    });
  }

  async function loadStreamsList() {
    const countEl = document.getElementById('activeStreamCount');
    const listEl  = document.getElementById('streamsList');
    if (!countEl || !listEl) return;

    try {
      const statuses = await NVR.api.get('/api/streams/status');
      const running = Object.entries(statuses).filter(([, s]) => s.status === 'running');
      if (countEl) countEl.textContent = running.length;

      if (!running.length) {
        listEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px">Brak aktywnych strumieni</div>';
        return;
      }

      const cameras = await NVR.api.get('/api/cameras').catch(() => []);
      const camMap  = Object.fromEntries(cameras.map(c => [c.id, c]));

      listEl.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kamera</th><th>Kategoria</th><th>Status</th><th>Widzowie</th></tr></thead>
            <tbody>
              ${running.map(([id, s]) => {
                const cam = camMap[id] || {};
                return `<tr>
                  <td style="font-weight:600">${escHtml(cam.name || `Camera #${id}`)}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${escHtml(cam.category || '—')}</td>
                  <td><span class="tile-badge badge-streaming">Na żywo</span></td>
                  <td style="font-size:13px">${s.viewers ?? 0}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (e) {
      if (countEl) countEl.textContent = '—';
      if (listEl) listEl.innerHTML = `<div style="color:var(--danger);font-size:13px">Błąd: ${escHtml(e.message)}</div>`;
    }
  }

  /* ----------------------------------------------------------
     My account tab
  ---------------------------------------------------------- */
  async function renderMyAccount(body) {
    body.innerHTML = `
      <div style="max-width:420px">
        <div style="font-size:16px;font-weight:700;margin-bottom:18px">Zmień hasło</div>
        <div class="form-group">
          <label>Aktualne hasło</label>
          <input type="password" id="myCurrPwd" placeholder="••••••••"/>
        </div>
        <div class="form-group">
          <label>Nowe hasło (min. 6 znaków)</label>
          <input type="password" id="myNewPwd" placeholder="••••••••"/>
        </div>
        <div class="form-group">
          <label>Powtórz nowe hasło</label>
          <input type="password" id="myNewPwd2" placeholder="••••••••"/>
        </div>
        <button class="btn btn-primary" id="myChangePwdBtn">Zapisz nowe hasło</button>
      </div>
    `;

    document.getElementById('myChangePwdBtn').addEventListener('click', async () => {
      const curr  = document.getElementById('myCurrPwd').value;
      const newP  = document.getElementById('myNewPwd').value;
      const newP2 = document.getElementById('myNewPwd2').value;

      if (newP.length < 6)   { NVR.toast('error', 'Błąd', 'Hasło min. 6 znaków'); return; }
      if (newP !== newP2)    { NVR.toast('error', 'Błąd', 'Hasła nie są identyczne'); return; }

      try {
        await NVR.api.post('/api/auth/change-password', { currentPassword: curr, newPassword: newP });
        NVR.toast('success', 'Zapisano', 'Hasło zostało zmienione');
        document.getElementById('myCurrPwd').value = '';
        document.getElementById('myNewPwd').value  = '';
        document.getElementById('myNewPwd2').value = '';
      } catch (e) { NVR.toast('error', 'Błąd', e.message); }
    });
  }

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */
  function roleLabel(role) {
    return { admin: 'Administrator', operator: 'Operator', viewer: 'Przeglądający' }[role] || role;
  }

  function actionClass(action) {
    if (action?.includes('FAILED') || action?.includes('BLOCKED')) return 'danger';
    if (action?.includes('DELETE')) return 'warning';
    if (action?.includes('LOGIN') && !action.includes('FAILED')) return 'success';
    return 'info';
  }

  function parseUA(ua) {
    if (!ua) return '—';
    if (/Android/i.test(ua)) return '📱 Android';
    if (/iPhone|iPad/i.test(ua)) return '📱 iOS';
    if (/Windows/i.test(ua)) return '💻 Windows';
    if (/Mac/i.test(ua)) return '💻 macOS';
    if (/Linux/i.test(ua)) return '🐧 Linux';
    return ua.slice(0, 40);
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('pl-PL') + ' ' + dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  function avatarColor(name) {
    const colors = ['#1f6feb','#388bfd','#3fb950','#d29922','#f85149','#bc8cff','#ff7b72'];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
    return colors[Math.abs(h)];
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ----------------------------------------------------------
     Register page
  ---------------------------------------------------------- */
  NVR.pages.admin = initAdmin;
  NVR.pagesRenderTopbar = NVR.pagesRenderTopbar || {};
  NVR.pagesRenderTopbar.admin = () => {};

})();

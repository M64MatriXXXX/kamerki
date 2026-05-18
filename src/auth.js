'use strict';

const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path     = require('path');
const db       = require('./database');
const { Store } = require('express-session');

/* ── SQLite Session Store ──────────────────────────────────── */
class SQLiteStore extends Store {
  constructor() {
    super();
    // Clean expired sessions every 15 min
    setInterval(() => { try { db.sessionCleanup(); } catch (_) {} }, 15 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = db.sessionGet(sid);
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 3600 * 1000;
      db.sessionSet(sid, JSON.stringify(sess), exp);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { db.sessionDestroy(sid); cb(null); } catch (e) { cb(e); }
  }
  all(cb) {
    try { cb(null, db.sessionGetAll().map(r => JSON.parse(r.data))); } catch (e) { cb(e); }
  }
  clear(cb) {
    try { db.sessionDestroyAll(); cb(null); } catch (e) { cb(e); }
  }
}

/* ── Session middleware ────────────────────────────────────── */
const sessionMiddleware = session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || ('nvr_s3cr3t_' + Math.random().toString(36)),
  resave: false,
  saveUninitialized: false,
  name: 'nvr.sid',
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
});

/* ── Rate limiter for login ────────────────────────────────── */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele prób logowania. Spróbuj za 15 minut.' }
});

/* ── Auth middlewares ──────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.session.role === 'admin') return next();
    const perms = JSON.parse(req.session.permissions || '{}');
    if (perms[perm]) return next();
    res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/* ── Audit helper ──────────────────────────────────────────── */
function auditLog(req, action, resource, details) {
  try {
    db.createAuditLog({
      user_id:    req.session?.userId  || null,
      username:   req.session?.username || 'anonymous',
      action,
      resource:   resource || null,
      ip:         req.ip || req.socket?.remoteAddress || null,
      user_agent: req.headers?.['user-agent'] || null,
      details:    details ? JSON.stringify(details) : null
    });
  } catch (e) { console.error('[Audit]', e.message); }
}

/* ── Auth routes ───────────────────────────────────────────── */
function setupAuthRoutes(app) {

  // Serve login page
  app.get('/login', (req, res) => {
    if (req.session?.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  });

  // POST /api/auth/login
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password, remember } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Podaj login i hasło' });

    try {
      const user = db.getUserByUsername(username.trim());

      if (!user || !user.is_active) {
        auditLog(req, 'LOGIN_FAILED', 'auth', { username, reason: 'not_found_or_inactive' });
        return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
      }

      // Check lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
        auditLog(req, 'LOGIN_BLOCKED', 'auth', { username });
        return res.status(429).json({ error: `Konto zablokowane. Spróbuj za ${mins} min.` });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        const attempts = (user.login_attempts || 0) + 1;
        const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        db.updateLoginAttempts(user.id, attempts, lock);
        auditLog(req, 'LOGIN_FAILED', 'auth', { username, attempts });
        if (lock) return res.status(429).json({ error: 'Zbyt wiele błędnych prób. Konto zablokowane na 15 min.' });
        return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
      }

      db.updateLastLogin(user.id, req.ip || req.socket?.remoteAddress);

      if (remember) req.session.cookie.maxAge = 30 * 24 * 3600 * 1000;

      req.session.userId      = user.id;
      req.session.username    = user.username;
      req.session.displayName = user.display_name || user.username;
      req.session.role        = user.role;
      req.session.permissions = user.permissions || '{}';
      req.session.forcePasswordChange = user.force_password_change === 1;

      auditLog(req, 'LOGIN', 'auth', { username, remember: !!remember });

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          role: user.role,
          permissions: JSON.parse(user.permissions || '{}'),
          forcePasswordChange: user.force_password_change === 1
        }
      });
    } catch (err) {
      console.error('[Auth] Login error:', err);
      res.status(500).json({ error: 'Błąd serwera' });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (req, res) => {
    auditLog(req, 'LOGOUT', 'auth');
    req.session.destroy(() => res.json({ success: true }));
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({
      id:                  req.session.userId,
      username:            req.session.username,
      displayName:         req.session.displayName,
      role:                req.session.role,
      permissions:         JSON.parse(req.session.permissions || '{}'),
      forcePasswordChange: req.session.forcePasswordChange
    });
  });

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Nowe hasło musi mieć min. 6 znaków' });
    try {
      const user = db.getUserById(req.session.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Nieprawidłowe aktualne hasło' });
      db.updateUserPassword(user.id, await bcrypt.hash(newPassword, 12));
      req.session.forcePasswordChange = false;
      auditLog(req, 'CHANGE_PASSWORD', 'auth');
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin user management ─────────────────────────────────

  // GET /api/admin/users
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    try { res.json(db.getAllUsers()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/users
  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const { username, display_name, password, role, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Login i hasło są wymagane' });
    if (password.length < 6)    return res.status(400).json({ error: 'Hasło min. 6 znaków' });
    try {
      const hash = await bcrypt.hash(password, 12);
      const user = db.createUser({
        username:               username.trim(),
        display_name:           display_name?.trim() || username.trim(),
        password_hash:          hash,
        role:                   role || 'viewer',
        permissions:            JSON.stringify(permissions || {}),
        is_active:              1,
        force_password_change:  1,
        created_by:             req.session.username
      });
      auditLog(req, 'CREATE_USER', 'users', { target: username, role });
      const { password_hash: _, ...safe } = user;
      res.status(201).json(safe);
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Użytkownik już istnieje' });
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/admin/users/:id
  app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (id === req.session.userId && req.body.role && req.body.role !== 'admin')
      return res.status(400).json({ error: 'Nie możesz zmienić własnej roli administratora' });
    try {
      const { display_name, role, permissions, is_active, force_password_change, newPassword } = req.body;
      const upd = {};
      if (display_name          !== undefined) upd.display_name          = display_name;
      if (role                  !== undefined) upd.role                  = role;
      if (permissions           !== undefined) upd.permissions           = JSON.stringify(permissions);
      if (is_active             !== undefined) upd.is_active             = is_active ? 1 : 0;
      if (force_password_change !== undefined) upd.force_password_change = force_password_change ? 1 : 0;
      const user = db.updateUser(id, upd);
      if (newPassword) {
        if (newPassword.length < 6) return res.status(400).json({ error: 'Hasło min. 6 znaków' });
        db.updateUserPassword(id, await bcrypt.hash(newPassword, 12));
      }
      auditLog(req, 'UPDATE_USER', 'users', { target_id: id, changes: Object.keys(upd) });
      const { password_hash: _, ...safe } = db.getUserById(id);
      res.json(safe);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/admin/users/:id
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    if (id === req.session.userId) return res.status(400).json({ error: 'Nie możesz usunąć własnego konta' });
    try {
      const user = db.getUserById(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      db.deleteUser(id);
      auditLog(req, 'DELETE_USER', 'users', { target: user.username });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/users/:id/unlock
  app.post('/api/admin/users/:id/unlock', requireAdmin, (req, res) => {
    try {
      db.updateLoginAttempts(parseInt(req.params.id), 0, null);
      auditLog(req, 'UNLOCK_USER', 'users', { target_id: req.params.id });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/logs
  app.get('/api/admin/logs', requireAdmin, (req, res) => {
    try {
      const logs = db.getAuditLogs({
        limit:    parseInt(req.query.limit)    || 200,
        offset:   parseInt(req.query.offset)   || 0,
        username: req.query.username           || null,
        action:   req.query.action             || null
      });
      res.json(logs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/sessions — active sessions info
  app.get('/api/admin/sessions', requireAdmin, (req, res) => {
    try {
      const rows = db.sessionGetAll();
      const sessions = rows
        .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(s => s?.userId)
        .map(s => ({
          userId:      s.userId,
          username:    s.username,
          displayName: s.displayName,
          role:        s.role,
          ip:          s.ip || null
        }));
      res.json(sessions);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { sessionMiddleware, requireAuth, requireAdmin, requirePermission, auditLog, setupAuthRoutes };

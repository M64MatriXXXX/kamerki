'use strict';

const axios = require('axios');
const crypto = require('crypto');

/* ----------------------------------------------------------
   Digest Auth helper (required by modern Dahua firmware 2.x+)
---------------------------------------------------------- */
async function digestRequest(method, url, username, password, params = {}) {
  // Step 1: probe to get WWW-Authenticate challenge
  let challenge;
  try {
    await axios({ method, url, params, timeout: 5000, validateStatus: () => true });
  } catch (_) {}

  try {
    const probe = await axios({
      method, url, params, timeout: 5000,
      validateStatus: s => true
    });

    if (probe.status !== 401) {
      // Camera accepted without auth (or Basic auth works)
      return probe;
    }
    challenge = probe.headers['www-authenticate'] || '';
  } catch (err) {
    throw new Error(`PTZ connection failed: ${err.message}`);
  }

  if (!challenge.toLowerCase().includes('digest')) {
    // Fall back to Basic auth
    return axios({ method, url, params, timeout: 5000,
      auth: { username, password } });
  }

  // Step 2: parse Digest challenge
  const get = (key) => {
    const m = challenge.match(new RegExp(`${key}="([^"]+)"`));
    return m ? m[1] : '';
  };
  const realm  = get('realm');
  const nonce  = get('nonce');
  const opaque = get('opaque');
  const qop    = (challenge.match(/qop="?([^",\s]+)"?/) || [])[1] || '';

  const parsedUrl = new URL(url);
  const uri = parsedUrl.pathname + (parsedUrl.search || '');

  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

  const nc     = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');

  let responseHash;
  if (qop === 'auth' || qop === 'auth-int') {
    responseHash = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex');
  } else {
    responseHash = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${ha2}`).digest('hex');
  }

  const authHeader = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    qop ? `qop=${qop}` : null,
    qop ? `nc=${nc}` : null,
    qop ? `cnonce="${cnonce}"` : null,
    `response="${responseHash}"`,
    opaque ? `opaque="${opaque}"` : null
  ].filter(Boolean).join(', ');

  return axios({
    method, url, params, timeout: 5000,
    headers: { Authorization: authHeader },
    validateStatus: s => s >= 200 && s < 400
  });
}

// Hikvision direction -> [pan, tilt] speed multipliers
const HIKVISION_DIRECTIONS = {
  left:       [-1,  0,  0],
  right:      [ 1,  0,  0],
  up:         [ 0,  1,  0],
  down:       [ 0, -1,  0],
  up_left:    [-1,  1,  0],
  up_right:   [ 1,  1,  0],
  down_left:  [-1, -1,  0],
  down_right: [ 1, -1,  0],
  zoom_in:    [ 0,  0,  1],
  zoom_out:   [ 0,  0, -1],
  stop:       [ 0,  0,  0]
};

// Dahua direction -> action code
const DAHUA_DIRECTIONS = {
  left:       'Left',
  right:      'Right',
  up:         'Up',
  down:       'Down',
  up_left:    'LeftUp',
  up_right:   'RightUp',
  down_left:  'LeftDown',
  down_right: 'RightDown',
  zoom_in:    'ZoomTele',
  zoom_out:   'ZoomWide'
};

function buildHikvisionXml(pan, tilt, zoom) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <pan>${pan}</pan>
  <tilt>${tilt}</tilt>
  <zoom>${zoom}</zoom>
</PTZData>`;
}

async function hikvisionMove(camera, direction, speed = 50) {
  const mults = HIKVISION_DIRECTIONS[direction] || [0, 0, 0];
  const pan  = mults[0] * speed;
  const tilt = mults[1] * speed;
  const zoom = mults[2] * Math.round(speed / 10);

  const url = `http://${camera.ip}:${camera.http_port || 80}/ISAPI/PTZCtrl/channels/1/continuous`;
  const xml = buildHikvisionXml(pan, tilt, zoom);

  await axios.put(url, xml, {
    headers: { 'Content-Type': 'application/xml' },
    auth: { username: camera.username || 'admin', password: camera.password || '' },
    timeout: 5000
  });
}

async function hikvisionStop(camera) {
  const url = `http://${camera.ip}:${camera.http_port || 80}/ISAPI/PTZCtrl/channels/1/continuous`;
  const xml = buildHikvisionXml(0, 0, 0);

  await axios.put(url, xml, {
    headers: { 'Content-Type': 'application/xml' },
    auth: { username: camera.username || 'admin', password: camera.password || '' },
    timeout: 5000
  });
}

async function hikvisionGotoPreset(camera, presetNumber) {
  const url = `http://${camera.ip}:${camera.http_port || 80}/ISAPI/PTZCtrl/channels/1/presets/${presetNumber}/goto`;
  await axios.put(url, '', {
    headers: { 'Content-Type': 'application/xml' },
    auth: { username: camera.username || 'admin', password: camera.password || '' },
    timeout: 5000
  });
}

async function hikvisionSavePreset(camera, presetNumber) {
  const url = `http://${camera.ip}:${camera.http_port || 80}/ISAPI/PTZCtrl/channels/1/presets/${presetNumber}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PTZPreset version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <id>${presetNumber}</id>
  <presetName>Preset ${presetNumber}</presetName>
</PTZPreset>`;
  await axios.put(url, xml, {
    headers: { 'Content-Type': 'application/xml' },
    auth: { username: camera.username || 'admin', password: camera.password || '' },
    timeout: 5000
  });
}

async function dahuaMove(camera, direction, speed = 5) {
  const code = DAHUA_DIRECTIONS[direction];
  if (!code) throw new Error(`Unknown direction: ${direction}`);

  const url = `http://${camera.ip}:${camera.http_port || 80}/cgi-bin/ptz.cgi`;
  const user = camera.username || 'admin';
  const pass = camera.password || '';

  await digestRequest('GET', url, user, pass, {
    action: 'start', channel: '1', code, arg1: '0', arg2: String(speed), arg3: '0'
  });
}

async function dahuaStop(camera, direction) {
  const code = direction ? (DAHUA_DIRECTIONS[direction] || 'Up') : 'Up';
  const url  = `http://${camera.ip}:${camera.http_port || 80}/cgi-bin/ptz.cgi`;
  const user = camera.username || 'admin';
  const pass = camera.password || '';

  await digestRequest('GET', url, user, pass, {
    action: 'stop', channel: '1', code, arg1: '0', arg2: '0', arg3: '0'
  });
}

async function dahuaGotoPreset(camera, presetNumber) {
  const url  = `http://${camera.ip}:${camera.http_port || 80}/cgi-bin/ptz.cgi`;
  const user = camera.username || 'admin';
  const pass = camera.password || '';

  await digestRequest('GET', url, user, pass, {
    action: 'goto', channel: '1', code: 'GotoPreset', arg1: '0', arg2: String(presetNumber), arg3: '0'
  });
}

async function dahuaSavePreset(camera, presetNumber) {
  const url  = `http://${camera.ip}:${camera.http_port || 80}/cgi-bin/ptz.cgi`;
  const user = camera.username || 'admin';
  const pass = camera.password || '';

  await digestRequest('GET', url, user, pass, {
    action: 'set', channel: '1', code: 'SetPreset', arg1: '0', arg2: String(presetNumber), arg3: '0'
  });
}

// Unified API
async function ptzMove(camera, direction, speed) {
  const brand = (camera.brand || 'generic').toLowerCase();
  if (brand === 'hikvision') {
    return hikvisionMove(camera, direction, speed || 50);
  } else if (brand === 'dahua') {
    return dahuaMove(camera, direction, speed || 5);
  } else {
    throw new Error(`PTZ not supported for brand: ${camera.brand}`);
  }
}

async function ptzStop(camera, direction) {
  const brand = (camera.brand || 'generic').toLowerCase();
  if (brand === 'hikvision') {
    return hikvisionStop(camera);
  } else if (brand === 'dahua') {
    return dahuaStop(camera, direction);
  } else {
    throw new Error(`PTZ not supported for brand: ${camera.brand}`);
  }
}

async function ptzGotoPreset(camera, presetNumber) {
  const brand = (camera.brand || 'generic').toLowerCase();
  if (brand === 'hikvision') {
    return hikvisionGotoPreset(camera, presetNumber);
  } else if (brand === 'dahua') {
    return dahuaGotoPreset(camera, presetNumber);
  } else {
    throw new Error(`PTZ presets not supported for brand: ${camera.brand}`);
  }
}

async function ptzSavePreset(camera, presetNumber) {
  const brand = (camera.brand || 'generic').toLowerCase();
  if (brand === 'hikvision') {
    return hikvisionSavePreset(camera, presetNumber);
  } else if (brand === 'dahua') {
    return dahuaSavePreset(camera, presetNumber);
  } else {
    throw new Error(`PTZ presets not supported for brand: ${camera.brand}`);
  }
}

module.exports = { ptzMove, ptzStop, ptzGotoPreset, ptzSavePreset };

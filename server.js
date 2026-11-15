'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./lib/engine');
const webpush = require('web-push');
const { GoogleAuth } = require('google-auth-library');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILES_INDEX = path.join(DATA_DIR, 'files.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function saveJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

let vapid = loadJson(VAPID_FILE, null);
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  saveJson(VAPID_FILE, vapid);
}
webpush.setVapidDetails('mailto:shop@quickprint.local', vapid.publicKey, vapid.privateKey);

function sendPush(title, body) {
  const subs = loadJson(PUSH_FILE, []);
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, url: '/' });
  const keep = [];
  subs.forEach((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) return; // dead subscription
      keep.push(sub);
    });
  });
  // keep only the ones that did not fail permanently
  setTimeout(() => {
    const alive = subs.filter((sub) => keep.length === 0 || keep.indexOf(sub) >= 0);
    saveJson(PUSH_FILE, alive.length ? alive : subs);
  }, 1500);
}
const engine = createEngine(DATA_DIR);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));

/* ------------------------------------------------------------------ files */

function readIndex() {
  try { return JSON.parse(fs.readFileSync(FILES_INDEX, 'utf8')); } catch (e) { return {}; }
}
function writeIndex(index) {
  fs.writeFileSync(FILES_INDEX, JSON.stringify(index));
}

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(8).toString('hex');
      file.fileId = id;
      cb(null, id + path.extname(file.originalname).toLowerCase().slice(0, 10));
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) return cb(new Error('Only PDF, photo, Word, Excel, PowerPoint or text files'));
    cb(null, true);
  },
});

/* ------------------------------------------------------------------- auth */

const sessions = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

function isSignedIn(req) {
  const token = readCookie(req, 'qps_owner');
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireOwner(req, res, next) {
  if (!isSignedIn(req)) return res.status(401).json({ error: 'Signed out' });
  next();
}

/* ------------------------------------------------------------------ pages */

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/owner', (req, res) => res.sendFile(path.join(__dirname, 'public', 'owner.html')));

/* -------------------------------------------------------------- api: shop */

app.post('/api/owner/login', (req, res) => {
  const result = engine.call('POST', '/api/owner/login', {}, req.body || {});
  if (result.status !== 200) return res.status(result.status).json(result.body);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `qps_owner=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`);
  res.json({ ok: true });
});

app.post('/api/owner/logout', (req, res) => {
  const token = readCookie(req, 'qps_owner');
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'qps_owner=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/owner/session', (req, res) => {
  const cfg = engine.call('GET', '/api/owner/session', {}, {});
  res.json({ signedIn: isSignedIn(req), pinIsDefault: Boolean(cfg.body && cfg.body.pinIsDefault) });
});

/* uploaded files — owner only */
app.get('/api/owner/files/:orderId/:fileId', requireOwner, (req, res) => {
  const index = readIndex();
  const entry = index[req.params.fileId];
  if (!entry) return res.status(404).json({ error: 'File not found' });
  const full = path.join(UPLOAD_DIR, entry.stored);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', entry.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.name)}"`);
  fs.createReadStream(full).pipe(res);
});

/* customer places an order with files */
app.post('/api/orders', upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));

  try {
    const payload = JSON.parse(req.body.payload || '{}');
    const cfg = engine.call('GET', '/api/config', {}, {}).body || {};
    if (cfg.acceptOrders === false) {
      cleanup();
      return res.status(400).json({ error: 'The shop is not taking online orders right now' });
    }

    const name = String(payload.name || '').trim().slice(0, 60);
    const phone = String(payload.phone || '').replace(/\D/g, '').slice(0, 15);
    if (!name) { cleanup(); return res.status(400).json({ error: 'Please enter your name' }); }
    if (phone.length < 10) { cleanup(); return res.status(400).json({ error: 'Please enter a valid mobile number' }); }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (!rawItems.length) { cleanup(); return res.status(400).json({ error: 'Add at least one file' }); }

    const printTypes = cfg.printTypes || [];
    const bindings = cfg.bindings || [];
    const laminations = cfg.laminations || [];

    const index = readIndex();
    const items = rawItems.map((raw, i) => {
      const file = files[i];
      const pt = printTypes.find((p) => p.id === raw.printTypeId);
      if (!pt) throw new Error('Unknown print type');
      const pages = Math.max(1, Math.round(Number(raw.pages) || 1));
      const copies = Math.max(1, Math.round(Number(raw.copies) || 1));
      const binding = bindings.find((b) => b.id === raw.bindingId) || { name: '', price: 0 };
      const lamination = laminations.find((l) => l.id === raw.laminationId) || { name: '', price: 0 };
      const soldByPieces = pt.unit === 'pcs';
      const piecesPerRate = Math.max(1, pt.pcsPerUnit || 1);
      const qty = soldByPieces ? pages : pages * copies;
      const printAmount = soldByPieces ? qty * (pt.pricePerPage / piecesPerRate) : qty * pt.pricePerPage;
      const amount = printAmount + (binding.price || 0) * copies + (lamination.price || 0) * copies;

      let fileId = null;
      if (file) {
        fileId = file.fileId;
        index[fileId] = {
          stored: file.filename,
          name: file.originalname,
          size: file.size,
          mime: file.mimetype,
          at: new Date().toISOString(),
        };
      }

      return {
        name: file ? file.originalname : `Job ${i + 1}`,
        printTypeName: pt.name,
        printTypeId: pt.id,
        pages,
        copies,
        qty,
        unit: soldByPieces ? 'pcs' : 'page',
        rate: soldByPieces ? Math.round((pt.pricePerPage / piecesPerRate) * 100) / 100 : pt.pricePerPage,
        amount: Math.round(amount * 100) / 100,
        bindingName: binding.name,
        laminationName: lamination.name,
        fileId,
      };
    });

    let total = items.reduce((sum, i) => sum + i.amount, 0);
    if (cfg.enforceMinOrder && total > 0 && total < (cfg.minOrder || 0)) total = cfg.minOrder;

    const work = items.map((i) => `${i.printTypeName} — ${i.pages} pages × ${i.copies}`).join(' · ');

    const created = engine.call('POST', '/api/owner/orders', {}, {
      name,
      phone,
      items,
      total: Math.round(total * 100) / 100,
      work,
      note: String(payload.note || '').slice(0, 300),
      pickup: String(payload.pickup || '').slice(0, 60),
    });

    if (created.status !== 201) {
      cleanup();
      return res.status(created.status).json(created.body);
    }

    writeIndex(index);

    const order = created.body.order;
    const lines = items.map((i) => i.name + (i.pages ? ' (' + i.pages + ' x ' + i.copies + ')' : '')).join(', ');
    notifyPhone('New order ' + order.id, (order.customer.name || 'Customer') + ' - Rs ' + order.total + '\n' + lines);
    sendPush('New order - ' + (order.customer.name || 'Customer'), 'Rs ' + order.total + ' - ' + order.id);
    sendFcm('New order - ' + (order.customer.name || 'Customer'), 'Rs ' + order.total + ' - ' + order.id);

    res.status(201).json({ ok: true, orderId: order.id, total: order.total });
  } catch (err) {
    cleanup();
    res.status(400).json({ error: err.message || 'Could not place the order' });
  }
});



/* ------------------------------------------------------------------ alerts */

function readDbFile() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')); } catch (e) { return {}; }
}

function notifyPhone(title, message, priority) {
  const db = readDbFile();
  const topic = (db.settings && db.settings.notifyTopic) || process.env.NTFY_TOPIC || '';
  if (!topic) return Promise.resolve(false);
  return fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
    method: 'POST',
    headers: {
      Title: title.replace(/[^\x20-\x7E]/g, ''),
      Priority: priority || 'high',
      Tags: 'printer',
    },
    body: message,
  }).then(() => true).catch(() => false);
}


/* a small feed the phone app can poll in the background */
app.get('/api/feed', (req, res) => {
  const key = String(req.query.key || '');
  const since = String(req.query.since || '');
  const db = readDbFile();
  const topic = (db.settings && db.settings.notifyTopic) || process.env.NTFY_TOPIC || '';
  if (!topic || key !== topic) return res.status(403).json({ error: 'Not allowed' });

  const orders = (engine.call('GET', '/api/owner/orders', { status: 'all' }, {}).body || {}).orders || [];
  const fresh = orders.filter((o) => !since || o.createdAt > since).map((o) => ({
    id: o.id,
    name: (o.customer && o.customer.name) || 'Customer',
    phone: (o.customer && o.customer.phone) || '',
    total: o.total,
    at: o.createdAt,
    status: o.status,
  }));
  res.json({ orders: fresh.slice(0, 10), latest: orders.length ? orders[0].createdAt : since });
});

/* customer order tracking — needs the order id plus the mobile number */
app.get('/api/track/:id', (req, res) => {
  const id = String(req.params.id || '').trim().toUpperCase();
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!id || phone.length < 10) return res.status(400).json({ error: 'Order number and mobile number needed' });

  const list = (engine.call('GET', '/api/owner/orders', { status: 'all', q: id }, {}).body || {}).orders || [];
  const order = list.find((o) => o.id === id);
  const samePhone = order && String((order.customer && order.customer.phone) || '').replace(/\D/g, '') === phone;
  if (!order || !samePhone) return res.status(404).json({ error: 'No order found for that number and mobile' });

  let bill = null;
  if (order.billId) {
    const found = engine.call('GET', '/api/owner/bills/' + order.billId, {}, {});
    if (found.body && found.body.bill) {
      bill = { no: found.body.bill.no, total: found.body.bill.total, payment: found.body.bill.payment, at: found.body.bill.at };
    }
  }

  const cfg = engine.call('GET', '/api/config', {}, {}).body || {};
  const unpaid = ['ready', 'delivered'].indexOf(order.status) >= 0 && !order.paid;

  res.json({
    payment: {
      due: unpaid ? order.total : 0,
      paid: Boolean(order.paid),
      upiId: cfg.upiId || '',
      upiQr: cfg.upiQr || '',
    },
    order: {
      id: order.id,
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      pickup: order.customer && order.customer.pickup,
      items: (order.items || []).map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        amount: i.amount,
        printTypeName: i.printTypeName,
        pages: i.pages,
        copies: i.copies,
      })),
    },
    bill,
    statusLabel: { pending: 'Received', printing: 'Printing', ready: 'Ready to collect', delivered: 'Collected', cancelled: 'Cancelled' },
  });
});

/* everything else: the shop's own engine */
const FCM_FILE = path.join(DATA_DIR, 'fcm.json');
const FCM_PROJECT = process.env.FCM_PROJECT_ID || '';
let fcmAuth = null;
function fcmClient() {
  if (fcmAuth) return fcmAuth;
  const raw = process.env.FCM_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    fcmAuth = new GoogleAuth({ credentials: json, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
    return fcmAuth;
  } catch (e) {
    return null;
  }
}

async function sendFcm(title, body) {
  const auth = fcmClient();
  const tokens = loadJson(FCM_FILE, []);
  if (!auth || !FCM_PROJECT || !tokens.length) return false;
  try {
    const client = await auth.getClient();
    const access = await client.getAccessToken();
    await Promise.all(tokens.map((token) =>
      fetch('https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT + '/messages:send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + access.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title, body }, android: { priority: 'high' } } }),
      }).catch(() => null)
    ));
    return true;
  } catch (e) {
    return false;
  }
}

app.post('/api/push/fcm', (req, res) => {
  const token = String((req.body && req.body.token) || '');
  if (!token) return res.status(400).json({ error: 'No token' });
  const tokens = loadJson(FCM_FILE, []);
  if (!tokens.includes(token)) tokens.push(token);
  saveJson(FCM_FILE, tokens.slice(-20));
  res.json({ ok: true });
});

app.get('/api/push/key', (req, res) => res.json({ key: vapid.publicKey }));

app.post('/api/push/subscribe', requireOwner, (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint) return res.status(400).json({ error: 'Bad subscription' });
  const subs = loadJson(PUSH_FILE, []);
  if (!subs.some((x) => x.endpoint === sub.endpoint)) subs.push(sub);
  saveJson(PUSH_FILE, subs);
  res.json({ ok: true });
});

app.post('/api/owner/notify/test', requireOwner, async (req, res) => {
  const sent = await notifyPhone('Test notification', 'Aapke phone par notification kaam kar raha hai.');
  sendPush('Test notification', 'Aapke phone par notification kaam kar raha hai.');
  sendFcm('Test notification', 'Aapke phone par notification kaam kar raha hai.');
  res.json({ ok: true, error: '' });
});

app.all('/api/*', (req, res) => {
  const isOwnerApi = req.path.startsWith('/api/owner/');
  if (isOwnerApi && !isSignedIn(req)) return res.status(401).json({ error: 'Signed out' });

  const query = Object.assign({}, req.query);
  const body = req.method === 'GET' ? {} : (req.body || {});

  try {
    const result = engine.call(req.method, req.path, query, body);

    if (typeof result.body === 'string') {
      const isCsv = req.path.endsWith('.csv');
      res.status(result.status).type(isCsv ? 'text/csv' : 'text/plain').send(result.body);
      return;
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Request failed' });
});

app.listen(PORT, () => {
  console.log('Quick Print Shop running on port ' + PORT);
  console.log('Data folder: ' + DATA_DIR);
});

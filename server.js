'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./lib/engine');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILES_INDEX = path.join(DATA_DIR, 'files.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
      const amount = pages * copies * pt.pricePerPage + (binding.price || 0) * copies + (lamination.price || 0) * copies;

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
        qty: pages * copies,
        unit: 'page',
        rate: pt.pricePerPage,
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
    res.status(201).json({ ok: true, orderId: created.body.order.id, total: created.body.order.total });
  } catch (err) {
    cleanup();
    res.status(400).json({ error: err.message || 'Could not place the order' });
  }
});

/* everything else: the shop's own engine */
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

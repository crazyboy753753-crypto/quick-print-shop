'use strict';

/**
 * Runs the shop's own logic (the same file the Android app uses) on the server.
 * Storage that used to be localStorage becomes a JSON file on disk.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DB_KEY = 'qps_shop_db_v1';

/* when a database is configured the shop data lives there, not on the server disk */
let pgPool = null;
let dbUrl = null;
let dbActive = false;
let dbCache = null;
let dbReady = Promise.resolve(false);

function startDatabase(rawUrl) {
  const { Pool } = require('pg');
  // Neon adds channel_binding=require, which node-postgres does not understand
  const url = String(rawUrl).replace(/([?&])channel_binding=[^&]*/g, '$1').replace(/[?&]$/, '');
  dbUrl = url;
  if (pgPool) { try { pgPool.end(); } catch (e) { /* ignore */ } }
  pgPool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }, max: 3 });
  dbReady = (async () => {
    try {
      await pgPool.query('create table if not exists shop_kv (key text primary key, value text, updated_at timestamptz)');
    } catch (e) {
      // the table is normally already there — carry on and read it
      console.log('[db] table check skipped:', e.message.split('\n')[0]);
    }
    const found = await pgPool.query('select value from shop_kv where key = $1', [DB_KEY]);
    let fromDb = found.rows.length ? found.rows[0].value : null;

    let fromDisk = null;
    try {
      const text = fs.readFileSync(dbFile, 'utf8');
      if (text && text !== '{}') fromDisk = text;
    } catch (e) { /* no local copy */ }

    if (!fromDb && fromDisk) {
      // the database lost the shop but this instance still has it — push it back
      dbCache = fromDisk;
      dbActive = true;
      saveToDatabase(fromDisk);
      return true;
    }

    dbCache = fromDb;
    dbActive = true;
    return true;
  })().catch((err) => {
    console.error('[db] could not connect, falling back to the file:', err.message);
    pgPool = null;
    dbActive = false;
    return false;
  });
  return dbReady;
}

let lastError = '';
let lastSavedAt = null;
let lastBytes = 0;

function saveToDatabase(value, attempt) {
  if (!pgPool || !dbActive) return;
  const tries = attempt || 0;
  pgPool.query(
    'insert into shop_kv (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = $2, updated_at = now()',
    [DB_KEY, value]
  ).then(() => {
    lastError = '';
    lastSavedAt = new Date().toISOString();
    lastBytes = value.length;
  }).catch((err) => {
    lastError = err.message;
    console.error('[db] save failed (attempt ' + (tries + 1) + '):', err.message);
    if (tries < 2) {
      setTimeout(() => saveToDatabase(value, tries + 1), 800 * (tries + 1));
    } else {
      // the connection is gone: go back to the file and try the database again shortly
      dbActive = false;
      setTimeout(() => { if (dbUrl) startDatabase(dbUrl); }, 5000);
    }
  });
}

function dbStats() {
  return { active: dbActive, bytes: lastBytes || (dbCache ? dbCache.length : 0), lastSavedAt, lastError };
}

function createEngine(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, '{}');

  const source = fs.readFileSync(path.join(__dirname, 'engine.src.js'), 'utf8');

  const localStorage = {
    getItem(key) {
      if (key !== DB_KEY) return null;
      if (dbActive) return dbCache;
      try { return fs.readFileSync(dbFile, 'utf8'); } catch (e) { return null; }
    },
    setItem(key, value) {
      if (key !== DB_KEY) return;
      // always keep a local copy first
      try {
        const tmp = dbFile + '.tmp';
        fs.writeFileSync(tmp, value);
        fs.renameSync(tmp, dbFile);
      } catch (e) { /* disk trouble is not fatal */ }
      if (dbActive) {
        dbCache = value;
        saveToDatabase(value);
      }
    },
    removeItem(key) {
      if (key !== DB_KEY) return;
      if (dbActive) { dbCache = '{}'; saveToDatabase('{}'); return; }
      fs.writeFileSync(dbFile, '{}');
    },
  };

  // the app keeps its "signed in" flag in sessionStorage; the server has its own login
  const sessionStorage = {
    getItem: () => '1',
    setItem: () => {},
    removeItem: () => {},
  };

  const sandbox = {
    console,
    JSON, Math, Date, Number, String, Boolean, Object, Array, Promise, RegExp, Error, Map, Set,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
    localStorage,
    sessionStorage,
    document: { createElement: () => ({ click() {}, style: {} }), body: { appendChild() {}, removeChild() {} } },
    alert: (msg) => console.warn('[engine]', msg),
    Response: class Response {
      constructor(body, init) {
        this._body = body;
        this.status = (init && init.status) || 200;
      }
      async json() { return JSON.parse(this._body); }
      async text() { return this._body; }
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.fetch = async () => new sandbox.Response('{}', { status: 200 });

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'engine.src.js' });

  if (typeof sandbox.__engineRoute !== 'function') {
    throw new Error('engine did not load');
  }

  return {
    call(method, path, query, body) {
      const result = sandbox.__engineRoute(method, path, query || {}, body || {});
      return { status: result.status || 200, body: result.body };
    },
  };
}

function ready() {
  return dbReady;
}

module.exports = { createEngine, startDatabase, ready, dbStats };

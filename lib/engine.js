'use strict';

/**
 * Runs the shop's own logic (the same file the Android app uses) on the server.
 * Storage that used to be localStorage becomes a JSON file on disk.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DB_KEY = 'qps_shop_db_v1';

function createEngine(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, '{}');

  const source = fs.readFileSync(path.join(__dirname, 'engine.src.js'), 'utf8');

  const localStorage = {
    getItem(key) {
      if (key !== DB_KEY) return null;
      try { return fs.readFileSync(dbFile, 'utf8'); } catch (e) { return null; }
    },
    setItem(key, value) {
      if (key !== DB_KEY) return;
      const tmp = dbFile + '.tmp';
      fs.writeFileSync(tmp, value);
      fs.renameSync(tmp, dbFile);
    },
    removeItem(key) {
      if (key === DB_KEY) fs.writeFileSync(dbFile, '{}');
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

module.exports = { createEngine };

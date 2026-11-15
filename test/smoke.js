'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qps-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '4999';

require('../server');

const base = 'http://127.0.0.1:4999';
let cookie = '';
let fails = 0;

const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + ' -> ' + e.message); }
};

async function api(pathname, opts = {}) {
  const res = await fetch(base + pathname, {
    ...opts,
    headers: Object.assign(cookie ? { Cookie: cookie } : {}, opts.headers || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* csv etc */ }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { res, json, text };
}

(async () => {
  await new Promise((r) => setTimeout(r, 400));

  await check('customer page and owner page load', async () => {
    const home = await api('/');
    if (home.res.status !== 200 || !/send a print order/i.test(home.text)) throw new Error('home page');
    const owner = await api('/owner');
    if (owner.res.status !== 200 || !/Dashboard/.test(owner.text)) throw new Error('owner page');
  });

  await check('config comes from the shop engine', async () => {
    const { json } = await api('/api/config');
    if (!json || !json.shopName) throw new Error('no config');
    if (!Array.isArray(json.printTypes)) throw new Error('no print types');
  });

  await check('owner area is locked without login', async () => {
    const { res } = await api('/api/owner/bootstrap');
    if (res.status !== 401) throw new Error('should be 401, got ' + res.status);
  });

  await check('wrong PIN rejected, right PIN accepted', async () => {
    const bad = await api('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '9999' }) });
    if (bad.res.status !== 401) throw new Error('wrong pin accepted');
    const good = await api('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1234' }) });
    if (good.res.status !== 200) throw new Error('right pin rejected');
    const session = await api('/api/owner/session');
    if (!session.json.signedIn) throw new Error('session not set');
  });

  await check('owner adds a print type and a rate', async () => {
    const { res, json } = await api('/api/owner/catalog/printTypes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B&W Print · A4', colour: 'bw', sides: 'single', paper: 'A4', pricePerPage: 2 }),
    });
    if (res.status !== 201 && res.status !== 200) throw new Error('create failed ' + res.status + ' ' + JSON.stringify(json));
  });

  await check('customer uploads a file and places an order', async () => {
    const cfg = (await api('/api/config')).json;
    const pt = cfg.printTypes[0];
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'notes.pdf');
    form.append('payload', JSON.stringify({ name: 'Ramesh Patil', phone: '9812345678', items: [{ printTypeId: pt.id, pages: 10, copies: 2 }] }));
    const res = await fetch(base + '/api/orders', { method: 'POST', body: form });
    const data = await res.json();
    if (res.status !== 201) throw new Error('order failed: ' + JSON.stringify(data));
    if (!data.orderId) throw new Error('no order id');
    if (data.total !== 10 * 2 * pt.pricePerPage) throw new Error('total wrong: ' + data.total);
  });

  await check('the order shows up in the owner dashboard', async () => {
    const { json } = await api('/api/owner/orders?status=all');
    const order = (json.orders || [])[0];
    if (!order) throw new Error('no orders');
    if (order.customer.name !== 'Ramesh Patil') throw new Error('customer missing');
    const item = order.items[0];
    if (!item.fileId) throw new Error('file not linked to the order');
  });

  await check('owner can download the uploaded file', async () => {
    const orders = (await api('/api/owner/orders?status=all')).json.orders;
    const order = orders[0];
    const res = await fetch(base + '/api/owner/files/' + order.id + '/' + order.items[0].fileId, { headers: { Cookie: cookie } });
    if (res.status !== 200) throw new Error('download failed ' + res.status);
    const text = await res.text();
    if (!text.includes('%PDF-1.4')) throw new Error('wrong file content');
  });

  await check('file download is blocked without login', async () => {
    const orders = (await api('/api/owner/orders?status=all')).json.orders;
    const order = orders[0];
    const res = await fetch(base + '/api/owner/files/' + order.id + '/' + order.items[0].fileId);
    if (res.status !== 401) throw new Error('should be 401, got ' + res.status);
  });

  await check('status flow and auto bill', async () => {
    const orders = (await api('/api/owner/orders?status=all')).json.orders;
    const order = orders[0];
    for (const st of ['printing', 'ready']) {
      await api('/api/owner/orders/' + order.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st }) });
    }
    const after = (await api('/api/owner/orders?status=all')).json.orders[0];
    if (after.status !== 'ready') throw new Error('status not updated');
    if (!after.billId) throw new Error('no bill created on ready');
    const bill = (await api('/api/owner/bills/' + after.billId)).json.bill;
    if (bill.total !== 40) throw new Error('bill total wrong: ' + bill.total);
  });

  await check('billing, stock and udhar still work', async () => {
    const stock = await api('/api/owner/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A4 paper', unit: 'sheet', qty: 100, lowAt: 10, costPrice: 1.2 }) });
    if (!stock.json.item) throw new Error('stock not created');
    const bill = await api('/api/owner/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ kind: 'custom', name: 'Passport photo', qty: 5, rate: 6 }], customerName: 'Sunita', phone: '9876500000', payment: 'udhar' }),
    });
    if (!bill.json.bill) throw new Error('bill failed');
    const customers = (await api('/api/owner/customers')).json.customers;
    const sunita = customers.find((c) => c.phone === '9876500000');
    if (!sunita || sunita.balance !== 30) throw new Error('udhar not recorded');
  });

  await check('customer can track the order status and see the bill', async () => {
    const orders = (await api('/api/owner/orders?status=all')).json.orders;
    const order = orders[0];
    const track = await fetch(base + '/api/track/' + order.id + '?phone=9812345678');
    const data = await track.json();
    if (track.status !== 200) throw new Error('track failed ' + track.status + ' ' + JSON.stringify(data));
    if (data.order.status !== 'ready') throw new Error('wrong status: ' + data.order.status);
    if (!data.bill || !data.bill.no) throw new Error('bill missing in tracking');
    if (data.order.items.length < 1) throw new Error('items missing');
  });

  await check('tracking needs the right mobile number', async () => {
    const orders = (await api('/api/owner/orders?status=all')).json.orders;
    const order = orders[0];
    const bad = await fetch(base + '/api/track/' + order.id + '?phone=9999999999');
    if (bad.status !== 404) throw new Error('should be 404, got ' + bad.status);
  });

  await check('logout clears the session', async () => {
    await api('/api/owner/logout', { method: 'POST' });
    const { res } = await api('/api/owner/bootstrap');
    if (res.status !== 401) throw new Error('still signed in');
  });

  console.log(fails ? '\n' + fails + ' check(s) failed' : '\nAll checks passed');
  process.exit(fails ? 1 : 0);
})();

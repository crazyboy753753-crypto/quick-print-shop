const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qps-shot2-'));
process.env.DATA_DIR = TMP; process.env.PORT = '4997';
require('../server');
const puppeteer = require('puppeteer-core');

(async () => {
  await new Promise(r => setTimeout(r, 400));
  const base = 'http://127.0.0.1:4997';
  const login = await fetch(base + '/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1234' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(b) });
  await post('/api/owner/catalog/printTypes', { name: 'B&W Print · A4', colour: 'bw', sides: 'single', paper: 'A4', pricePerPage: 2 });
  await fetch(base + '/api/owner/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ shopName: 'Quick Print Shop', tagline: 'Print smarter. Collect faster.', phone: '9876543210', address: 'Shop 4, Main Road, Pune' }) });

  // a customer order, then the shop marks it printing
  const cfg = await (await fetch(base + '/api/config')).json();
  const form = new FormData();
  form.append('files', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'notes.pdf');
  form.append('payload', JSON.stringify({ name: 'Ramesh Patil', phone: '9812345678', items: [{ printTypeId: cfg.printTypes[0].id, pages: 10, copies: 2 }] }));
  const placed = await (await fetch(base + '/api/orders', { method: 'POST', body: form })).json();
  const orders = (await (await fetch(base + '/api/owner/orders?status=all', { headers: { Cookie: cookie } })).json()).orders;
  await fetch(base + '/api/owner/orders/' + orders[0].id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status: 'printing' }) });

  const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate((id, phone) => {
    document.querySelector('#trackId').value = id;
    document.querySelector('#trackPhone').value = phone;
    document.querySelector('#trackBtn').click();
  }, placed.orderId, '9812345678');
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: '/scratch/work/track-page.png' });

  const owner = await browser.newPage();
  await owner.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
  await owner.goto(base + '/owner', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));
  await owner.type('#pin', '1234');
  await owner.click('#loginForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 1500));
  await owner.evaluate(() => { switchTab('settings'); window.scrollTo(0, 0); });
  await new Promise(r => setTimeout(r, 900));
  await owner.screenshot({ path: '/scratch/work/qr-card.png' });

  await browser.close();
  console.log('shots done');
  process.exit(0);
})();

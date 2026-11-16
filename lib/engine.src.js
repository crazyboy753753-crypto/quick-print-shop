
'use strict';

/*
 * Offline engine for Quick Print Shop.
 *
 * The whole shop (stock, billing, udhar, settings) runs on the phone itself.
 * It answers the same /api/... calls the dashboard already makes, but reads and
 * writes to localStorage instead of a server, so nothing needs the internet.
 */
(function () {
  if (window.QPS_LOCAL_API) return;
  window.QPS_LOCAL_API = true;
  window.QPS_OFFLINE = true;

  const KEY = 'qps_shop_db_v1';
  const SESSION_KEY = 'qps_session';

  /* ------------------------------------------------------------- defaults */

  // Empty on purpose: the shop adds its own paper, coils, pouches.
  const DEFAULT_STOCK = [
    { id: 'st-a4century', name: 'A4 Century Paper', unit: 'sheet', qty: 1000, lowAt: 0, costPrice: 0.4, barcode: '' },
    { id: 'st-a4photo', name: 'A4 Photo Paper', unit: 'sheet', qty: 100, lowAt: 0, costPrice: 20, barcode: '' },
    { id: 'st-a4lam', name: 'A4 Lamination Sheet', unit: 'sheet', qty: 100, lowAt: 0, costPrice: 20, barcode: '' },
    { id: 'st-idlam', name: 'ID Lamination Sheet', unit: 'sheet', qty: 100, lowAt: 0, costPrice: 10, barcode: '' },
    { id: 'st-file', name: 'File', unit: 'Piece', qty: 10, lowAt: 0, costPrice: 7, barcode: '' },
    { id: 'st-chy', name: 'Chart Paper (Yellow)', unit: 'sheet', qty: 5, lowAt: 0, costPrice: 4, barcode: '' },
    { id: 'st-chw', name: 'Chart Paper (White)', unit: 'sheet', qty: 5, lowAt: 0, costPrice: 4, barcode: '' },
    { id: 'st-chp', name: 'Chart Paper (Pink)', unit: 'sheet', qty: 5, lowAt: 0, costPrice: 4, barcode: '' },
    { id: 'st-chs', name: 'Chart Paper (Sky Blue)', unit: 'sheet', qty: 5, lowAt: 0, costPrice: 4, barcode: '' },
    { id: 'st-chb', name: 'Chart Paper (Black)', unit: 'sheet', qty: 5, lowAt: 0, costPrice: 8, barcode: '' },
    { id: 'st-env', name: 'Photo Envelope', unit: 'sheet', qty: 100, lowAt: 0, costPrice: 0.1, barcode: '' },
  ];

  const DEFAULT_PRINT_TYPES = [
    { id: 'pt-zerox', name: 'Zerox', colour: 'bw', sides: 'single', paper: 'A4', pricePerPage: 2, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 1 },
    { id: 'pt-colour', name: 'Colour Print', colour: 'color', sides: 'single', paper: 'A4', pricePerPage: 5, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 1 },
    { id: 'pt-bothbw', name: 'Both Side Print Black/White', colour: 'bw', sides: 'double', paper: 'A4', pricePerPage: 3, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 0.5 },
    { id: 'pt-bothcolour', name: 'Both Side Colour Print', colour: 'color', sides: 'double', paper: 'A4', pricePerPage: 8, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 0.5 },
    { id: 'pt-mobbw', name: 'Black/White Mobile Print', colour: 'bw', sides: 'single', paper: 'A4', pricePerPage: 5, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 1 },
    { id: 'pt-mobcolour', name: 'Mobile Colour Print', colour: 'color', sides: 'single', paper: 'A4', pricePerPage: 6, unit: 'page', pcsPerUnit: 1, stockId: 'st-a4century', sheetsPerPage: 1 },
    { id: 'pt-passport', name: 'Passport Size Photo', colour: 'color', sides: 'none', paper: 'Photo', pricePerPage: 30, unit: 'pcs', pcsPerUnit: 5, stockId: 'st-a4photo', sheetsPerPage: 0.2 },
  ];
  const DEFAULT_BINDINGS = [];
  const DEFAULT_LAMINATIONS = [
    { id: 'lm-a4', name: 'A4 Lamination', price: 40, stockId: 'st-a4lam', consume: 1 },
    { id: 'lm-id', name: 'ID Card Lamination', price: 25, stockId: 'st-idlam', consume: 1 },
  ];
  const DEFAULT_PRODUCTS = [
    { id: 'pd-file', name: 'File', price: 10, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-chy', name: 'Chart Paper (Yellow)', price: 6, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-chw', name: 'Chart Paper (White)', price: 6, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-chp', name: 'Chart Paper (Pink)', price: 6, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-chs', name: 'Chart Paper (Sky Blue)', price: 6, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-chb', name: 'Chart Paper (Black)', price: 12, stockId: null, barcode: '', unit: 'piece' },
    { id: 'pd-env', name: 'Photo Envelope', price: 0, stockId: null, barcode: '', unit: 'piece' },
  ];

  const DEFAULT_SETTINGS = {
    shopName: 'Quick Print Shop',
    tagline: 'Print smarter. Collect faster. Your documents, ready when you are.',
    phone: '7782040642',
    upiId: '',
    upiQr: '',
    notifyTopic: '',
    address: 'Yehyapur, Sheikhpura',
    gstin: '',
    openNote: 'Counter open 9 AM – 9 PM',
    billPrefix: 'INV-',
    billFooter: 'Thank you! Please come again.',
    acceptOrders: true,
    enforceMinOrder: true,
    minOrder: 2,
  };

  const STATUS_LABEL = {
    pending: 'Pending',
    printing: 'Printing',
    ready: 'Ready',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const PAYMENT_MODES = ['cash', 'upi', 'udhar', 'card'];

  /* --------------------------------------------------------------- helpers */

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : (d === undefined ? 0 : d);
  };
  const nowIso = () => new Date().toISOString();
  const rid = (n) => {
    let out = '';
    const chars = 'abcdef0123456789';
    for (let i = 0; i < (n || 8); i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };
  const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);

  function hashPin(pin, salt) {
    const s = salt + '|' + pin;
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = (h1 ^ c) * 16777619 >>> 0;
      h2 = (h2 + c * (i + 7)) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  }

  /* ------------------------------------------------------------- normalise */

  function normaliseStock(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && s.id).map((s) => ({
      id: String(s.id),
      name: String(s.name || 'Item').slice(0, 80),
      unit: String(s.unit || 'piece').slice(0, 20),
      qty: round2(num(s.qty, 0)),
      lowAt: round2(num(s.lowAt, 0)),
      costPrice: round2(num(s.costPrice, 0)),
      barcode: String(s.barcode || '').slice(0, 40),
      createdAt: s.createdAt || nowIso(),
    }));
  }

  function normalisePrintTypes(list) {
    return (Array.isArray(list) ? list : []).filter((p) => p && p.id).map((p) => {
      const sides = p.sides === 'double' ? 'double' : p.sides === 'none' ? 'none' : 'single';
      return {
        id: String(p.id),
        name: String(p.name || 'Print type').slice(0, 60),
        colour: p.colour === 'color' ? 'color' : p.colour === 'none' ? 'none' : 'bw',
        paper: p.paper === 'Photo' ? 'Photo' : p.paper === 'A4' ? 'A4' : 'none',
        sides,
        pricePerPage: round2(num(p.pricePerPage, 2)),
        unit: p.unit === 'pcs' ? 'pcs' : 'page',
        pcsPerUnit: Math.max(1, Math.round(num(p.pcsPerUnit, 1))),
        stockId: p.stockId || null,
        sheetsPerPage: num(p.sheetsPerPage, sides === 'double' ? 0.5 : 1) || (sides === 'double' ? 0.5 : 1),
        active: p.active !== false,
      };
    });
  }

  function normaliseSimple(list, label) {
    return (Array.isArray(list) ? list : []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id),
      name: String(x.name || label).slice(0, 60),
      price: round2(num(x.price, 0)),
      stockId: x.stockId || null,
      consume: num(x.consume, 0),
      active: x.active !== false,
    }));
  }

  function normaliseProducts(list) {
    return (Array.isArray(list) ? list : []).filter((p) => p && p.id).map((p) => ({
      id: String(p.id),
      name: String(p.name || 'Item').slice(0, 80),
      price: round2(num(p.price, 0)),
      stockId: p.stockId || null,
      barcode: String(p.barcode || '').slice(0, 40),
      unit: String(p.unit || 'piece').slice(0, 20),
      active: p.active !== false,
    }));
  }

  /* -------------------------------------------------------------- database */

  function fresh() {
    return {
      settings: Object.assign({}, DEFAULT_SETTINGS),
      pin: null,
      stock: normaliseStock(DEFAULT_STOCK.map((s) => Object.assign({}, s, { createdAt: nowIso() }))),
      printTypes: normalisePrintTypes(DEFAULT_PRINT_TYPES),
      bindings: normaliseSimple(DEFAULT_BINDINGS, 'Binding'),
      laminations: normaliseSimple(DEFAULT_LAMINATIONS, 'Lamination'),
      products: normaliseProducts(DEFAULT_PRODUCTS),
      orders: [],
      bills: [],
      customers: [],
      payments: [],
      stockLog: [],
      counters: { bill: 0 },
      createdAt: nowIso(),
    };
  }

  let db;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw || typeof raw !== 'object') return fresh();
      const base = fresh();
      return {
        settings: Object.assign({}, DEFAULT_SETTINGS, raw.settings || {}),
        pin: raw.pin || null,
        stock: raw.stock ? normaliseStock(raw.stock) : base.stock,
        printTypes: raw.printTypes ? normalisePrintTypes(raw.printTypes) : base.printTypes,
        bindings: raw.bindings ? normaliseSimple(raw.bindings, 'Binding') : base.bindings,
        laminations: raw.laminations ? normaliseSimple(raw.laminations, 'Lamination') : base.laminations,
        products: raw.products ? normaliseProducts(raw.products) : base.products,
        orders: Array.isArray(raw.orders) ? raw.orders : [],
        bills: Array.isArray(raw.bills) ? raw.bills : [],
        customers: Array.isArray(raw.customers) ? raw.customers : [],
        payments: Array.isArray(raw.payments) ? raw.payments : [],
        stockLog: Array.isArray(raw.stockLog) ? raw.stockLog : [],
        counters: { bill: Number(raw.counters && raw.counters.bill) || 0 },
        createdAt: raw.createdAt || nowIso(),
      };
    } catch (e) {
      return fresh();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      window.alert('Phone storage is full — please export your bills CSV and remove old entries.');
    }
  }

  db = load();
  save();

  /* ---------------------------------------------------------------- prices */

  function priceLine(item) {
    const pt = db.printTypes.find((p) => p.id === item.printTypeId);
    if (!pt) return null;
    const pages = Math.max(1, Math.round(num(item.pages, 1)));
    const copies = Math.max(1, Math.round(num(item.copies, 1)));
    const binding = db.bindings.find((b) => b.id === item.bindingId) || null;
    const lamination = db.laminations.find((l) => l.id === item.laminationId) || null;
    const soldByPieces = pt.unit === 'pcs';
    const piecesPerRate = Math.max(1, pt.pcsPerUnit || 1);
    const print = soldByPieces
      ? (pages * copies) * (pt.pricePerPage / piecesPerRate)
      : pages * copies * pt.pricePerPage;
    const bind = binding ? binding.price * copies : 0;
    const lam = lamination ? lamination.price * copies : 0;
    return {
      printTypeId: pt.id,
      printTypeName: pt.name,
      colour: pt.colour,
      sides: pt.sides,
      pages,
      copies,
      bindingId: binding ? binding.id : null,
      bindingName: binding ? binding.name : '',
      laminationId: lamination ? lamination.id : null,
      laminationName: lamination ? lamination.name : '',
      amount: round2(print + bind + lam),
      parts: { print: round2(print), binding: round2(bind), lamination: round2(lam) },
    };
  }

  /* ----------------------------------------------------------------- stock */

  function findStock(id) {
    return db.stock.find((s) => s.id === id) || null;
  }

  function adjustStock(stockId, delta, reason, ref) {
    const s = findStock(stockId);
    if (!s) return null;
    s.qty = round2(s.qty + delta);
    db.stockLog.unshift({
      id: rid(8),
      at: nowIso(),
      stockId,
      stockName: s.name,
      unit: s.unit,
      delta: round2(delta),
      after: s.qty,
      reason: reason || '',
      ref: ref || '',
    });
    if (db.stockLog.length > 400) db.stockLog.length = 400;
    return s;
  }

  /* --------------------------------------------------------------- billing */

  function nextBillNo() {
    db.counters.bill = (Number(db.counters.bill) || 0) + 1;
    const prefix = cleanText(db.settings.billPrefix, 8) || 'INV-';
    return prefix + String(db.counters.bill).padStart(4, '0');
  }

  function findOrCreateCustomer(name, phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!name && !digits) return null;
    let cust = null;
    if (digits) cust = db.customers.find((c) => c.phone && c.phone.replace(/\D/g, '') === digits) || null;
    if (!cust && name) cust = db.customers.find((c) => c.name.toLowerCase() === name.toLowerCase() && !c.phone) || null;
    if (!cust) {
      cust = { id: 'cu-' + rid(8), name: cleanText(name, 60) || 'Customer', phone: digits, createdAt: nowIso() };
      db.customers.push(cust);
    } else if (name && !cust.name) {
      cust.name = cleanText(name, 60);
    }
    return cust;
  }

  function buildBillItems(rawItems) {
    const items = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      const kind = raw.kind === 'print' ? 'print' : raw.kind === 'product' ? 'product' : 'custom';
      if (kind === 'print') {
        const pt = db.printTypes.find((p) => p.id === raw.printTypeId);
        if (!pt) return { error: 'Print type not found' };
        const pages = Math.max(1, Math.round(num(raw.pages, 1)));
        const copies = Math.max(1, Math.round(num(raw.copies, 1)));
        const qty = pages * copies;
        items.push({
          kind: 'print',
          printTypeId: pt.id,
          name: pt.name + ' — ' + pages + ' page' + (pages > 1 ? 's' : '') + ' × ' + copies,
          qty,
          rate: pt.pricePerPage,
          amount: round2(qty * pt.pricePerPage),
          stockId: pt.stockId,
          consume: pt.sheetsPerPage,
        });
      } else if (kind === 'product') {
        const prod = db.products.find((p) => p.id === raw.productId);
        if (!prod) return { error: 'Product not found' };
        const qty = Math.max(1, round2(num(raw.qty, 1)));
        const rate = raw.rate !== undefined ? round2(num(raw.rate, prod.price)) : prod.price;
        items.push({
          kind: 'product',
          productId: prod.id,
          name: prod.name,
          qty,
          rate,
          amount: round2(qty * rate),
          stockId: prod.stockId,
          consume: prod.stockId ? 1 : 0,
          unit: prod.unit,
        });
      } else {
        const qty = Math.max(1, round2(num(raw.qty, 1)));
        const rate = round2(num(raw.rate, 0));
        const name = cleanText(raw.name, 100);
        if (!name) return { error: 'Every line needs a name' };
        items.push({
          kind: 'custom',
          name,
          qty,
          rate,
          amount: round2(qty * rate),
          stockId: raw.stockId && findStock(raw.stockId) ? raw.stockId : null,
          consume: num(raw.consume, 0),
        });
      }
    }
    if (!items.length) return { error: 'Add at least one item to the bill' };
    return { items };
  }

  function creditScore(customerId) {
    const bills = db.bills.filter((b) => b.customerId === customerId);
    const payments = db.payments.filter((p) => p.customerId === customerId);
    const udharBills = bills.filter((b) => b.payment === 'udhar');
    const totalUdhar = round2(udharBills.reduce((sum, b) => sum + b.total, 0));
    const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    const outstanding = Math.max(0, round2(totalUdhar - paid));
    if (totalUdhar <= 0) return { score: null, label: 'New', outstanding, totalUdhar: 0, paid, days: 0 };
    const ratio = Math.min(1, paid / totalUdhar);
    let score = 40 + ratio * 55;
    const oldest = udharBills.length ? Math.min.apply(null, udharBills.map((b) => new Date(b.at).getTime())) : Date.now();
    const days = Math.max(0, Math.round((Date.now() - oldest) / 86400000));
    if (outstanding > 0) {
      if (days > 30) score -= 25;
      else if (days > 15) score -= 12;
      else if (days > 7) score -= 5;
    } else {
      score += 5;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Risky';
    return { score, label, outstanding, totalUdhar, paid, days };
  }

  function customerBalances() {
    const map = new Map();
    db.customers.forEach((c) => map.set(c.id, 0));
    db.bills.forEach((b) => {
      if (b.payment !== 'udhar' || !b.customerId) return;
      map.set(b.customerId, round2((map.get(b.customerId) || 0) + b.total));
    });
    db.payments.forEach((p) => {
      if (!p.customerId) return;
      map.set(p.customerId, round2((map.get(p.customerId) || 0) - p.amount));
    });
    return map;
  }

  function orderList() {
    return db.orders.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  function newOrderId() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    let n = 1;
    let id;
    do {
      id = `ORD-${stamp}-${String(n).padStart(3, '0')}`;
      n += 1;
    } while (db.orders.some((o) => o.id === id));
    return id;
  }

  function billFromOrder(order) {
    const customer = findOrCreateCustomer(order.customer.name, order.customer.phone);
    const items = (order.items || []).map((i) => ({
      kind: 'custom',
      name: i.name,
      qty: i.qty,
      rate: i.rate,
      amount: round2(i.qty * i.rate),
      stockId: null,
      consume: 0,
    }));
    const subtotal = round2(items.reduce((sum, i) => sum + i.amount, 0));
    const total = order.total || subtotal;
    const bill = {
      id: 'bl-' + rid(10),
      no: nextBillNo(),
      at: nowIso(),
      customerId: customer ? customer.id : null,
      customerName: customer ? customer.name : order.customer.name,
      phone: customer ? customer.phone : order.customer.phone,
      items,
      subtotal: subtotal || total,
      discount: Math.max(0, round2((subtotal || total) - total)),
      total,
      payment: 'cash',
      note: 'Order ' + order.id,
      orderId: order.id,
      skipStock: true,
      stockUsed: [],
    };
    db.bills.push(bill);
    order.billId = bill.id;
    order.billed = true;
    return bill;
  }

  function stats() {
    const today = nowIso().slice(0, 10);
    const todaysBills = db.bills.filter((b) => (b.at || '').slice(0, 10) === today);
    const todaysPayments = db.payments.filter((p) => (p.at || '').slice(0, 10) === today);
    const balances = customerBalances();
    const udharOutstanding = round2(Array.from(balances.values()).reduce((s, v) => s + v, 0));
    const collection = round2(
      todaysBills.filter((b) => b.payment !== 'udhar').reduce((s, b) => s + b.total, 0) +
      todaysPayments.reduce((s, p) => s + p.amount, 0)
    );
    const todaysOrders = db.orders.filter((o) => (o.createdAt || '').slice(0, 10) === today && o.status !== 'cancelled');
    return {
      todayOrders: todaysOrders.length,
      todayOrderValue: round2(todaysOrders.reduce((sum, o) => sum + (o.total || 0), 0)),
      pendingOrders: db.orders.filter((o) => o.status === 'pending' || o.status === 'printing').length,
      readyOrders: db.orders.filter((o) => o.status === 'ready').length,
      todaySales: round2(todaysBills.reduce((s, b) => s + b.total, 0)),
      todayBills: todaysBills.length,
      todayCollection: collection,
      udharOutstanding,
      lowStock: db.stock.filter((s) => s.qty <= s.lowAt).length,
      unpaidOrders: 0,
      totalBills: db.bills.length,
      totalOrders: 0,
    };
  }

  function bootstrap() {
    const balances = customerBalances();
    return {
      settings: db.settings,
      pinIsDefault: !db.pin,
      stock: db.stock,
      stockLog: db.stockLog.slice(0, 60),
      printTypes: db.printTypes,
      bindings: db.bindings,
      laminations: db.laminations,
      products: db.products,
      customers: db.customers.map((c) => {
        const bills = db.bills.filter((b) => b.customerId === c.id);
        const credit = creditScore(c.id);
        return Object.assign({}, c, {
          balance: balances.get(c.id) || 0,
          bills: bills.length,
          lastAt: bills.length ? bills[bills.length - 1].at : c.createdAt,
          creditScore: credit.score,
          creditLabel: credit.label,
        });
      }),
      stats: stats(),
      statusLabel: STATUS_LABEL,
      counters: db.counters,
      recentBills: db.bills.slice(-10).reverse(),
      offline: true,
    };
  }

  /* ------------------------------------------------------------------ auth */

  function isSignedIn() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return true; }
  }

  function signIn(pin) {
    if (db.pin) {
      if (hashPin(String(pin), db.pin.salt) !== db.pin.hash) return false;
    } else if (String(pin) !== '1234') {
      return false;
    }
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* ignore */ }
    return true;
  }

  /* -------------------------------------------------------------- csv export */

  function csvEscape(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  function saveTextFile(name, text) {
    if (window.AndroidBridge && window.AndroidBridge.saveFile) {
      try {
        window.AndroidBridge.saveFile(name, text);
        return;
      } catch (e) { /* fall through */ }
    }
    try {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      window.alert('Could not save the file on this phone.');
    }
  }

  function billsCsv() {
    const rows = [['Bill', 'Date', 'Customer', 'Phone', 'Items', 'Subtotal', 'Discount', 'Total', 'Payment']];
    db.bills.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).forEach((b) => {
      rows.push([
        b.no, new Date(b.at).toLocaleString('en-IN'), b.customerName, b.phone || '',
        b.items.map((i) => i.name + ' x' + i.qty).join(' | '),
        b.subtotal, b.discount, b.total, b.payment,
      ]);
    });
    return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  }

  function stockCsv() {
    const rows = [['Item', 'Unit', 'In stock', 'Low at', 'Cost price', 'Barcode']];
    db.stock.forEach((s) => rows.push([s.name, s.unit, s.qty, s.lowAt, s.costPrice, s.barcode || '']));
    return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  }

  /* ---------------------------------------------------------------- routing */

  function ok(body) { return { status: 200, body }; }
  function bad(msg, status) { return { status: status || 400, body: { error: msg } }; }

  function route(method, path, query, body) {
    const q = query || {};
    const b = body || {};

    /* public config */
    if (method === 'GET' && path === '/api/config') {
      return ok({
        shopName: db.settings.shopName,
        tagline: db.settings.tagline,
        phone: db.settings.phone,
        upiId: db.settings.upiId,
        upiQr: db.settings.upiQr || '',
        address: db.settings.address,
        openNote: db.settings.openNote,
        acceptOrders: db.settings.acceptOrders,
        enforceMinOrder: db.settings.enforceMinOrder,
        minOrder: db.settings.minOrder,
        printTypes: db.printTypes.filter((p) => p.active),
        bindings: db.bindings.filter((x) => x.active),
        laminations: db.laminations.filter((x) => x.active),
        statusLabel: STATUS_LABEL,
        offline: true,
      });
    }

    /* session */
    if (method === 'GET' && path === '/api/owner/session') {
      return ok({ signedIn: isSignedIn(), pinIsDefault: !db.pin, offline: true });
    }
    if (method === 'POST' && path === '/api/owner/login') {
      return signIn(b.pin) ? ok({ ok: true }) : bad('Wrong PIN', 401);
    }
    if (method === 'POST' && path === '/api/owner/logout') {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
      return ok({ ok: true });
    }

    /* everything below needs the PIN */
    if (!isSignedIn()) return bad('Not signed in', 401);

    if (method === 'GET' && path === '/api/owner/bootstrap') return ok(bootstrap());
    if (method === 'GET' && path === '/api/owner/stats') return ok(stats());

    if (method === 'GET' && path === '/api/owner/orders') {
      const status = String(q.status || '');
      const text = String(q.q || '').toLowerCase().trim();
      let list = orderList();
      if (status && status !== 'all') list = list.filter((o) => o.status === status);
      if (text) {
        list = list.filter((o) =>
          o.id.toLowerCase().indexOf(text) >= 0 ||
          String(o.customer.name || '').toLowerCase().indexOf(text) >= 0 ||
          String(o.customer.phone || '').indexOf(text) >= 0 ||
          String(o.work || '').toLowerCase().indexOf(text) >= 0);
      }
      return ok({ orders: list, statusLabel: STATUS_LABEL });
    }

    if (method === 'POST' && path === '/api/owner/orders') {
      const name = cleanText(b.name, 60);
      const phone = cleanText(b.phone, 15).replace(/\D/g, '');
      if (!name && !phone) return bad('Enter the customer name or mobile number');
      const rawItems = Array.isArray(b.items) ? b.items : [];
      const items = rawItems.map((i) => ({
        kind: 'custom',
        name: cleanText(i.name, 100),
        qty: round2(num(i.qty, 1)),
        unit: cleanText(i.unit, 10),
        rate: round2(num(i.rate, 0)),
        amount: round2(num(i.qty, 1) * num(i.rate, 0)),
        fileId: i.fileId ? String(i.fileId) : null,
        printTypeName: cleanText(i.printTypeName, 60),
        pages: Math.max(0, Math.round(num(i.pages, 0))),
        copies: Math.max(0, Math.round(num(i.copies, 0))),
      })).filter((i) => i.name);
      const work = cleanText(b.work, 160) ||
        items.map((i) => `${i.name}${i.qty ? ' × ' + i.qty + (i.unit ? ' ' + i.unit : '') : ''}`).join(' · ');
      if (!work) return bad('Enter the work or pick an item');
      const order = {
        id: newOrderId(),
        createdAt: nowIso(),
        status: 'pending',
        customer: { name: name || 'Customer', phone, pickup: cleanText(b.pickup, 60), note: cleanText(b.note, 300) },
        work,
        items,
        total: round2(num(b.total, items.reduce((sum, i) => sum + i.amount, 0))),
        paid: false,
        billId: null,
        ownerNote: '',
        history: [{ status: 'pending', at: nowIso() }],
      };
      db.orders.push(order);
      save();
      return { status: 201, body: { ok: true, order } };
    }

    const mOrder = path.match(/^\/api\/owner\/orders\/([^/]+)$/);
    if (mOrder && method === 'PATCH') {
      const order = db.orders.find((o) => o.id === mOrder[1]);
      if (!order) return bad('Order not found', 404);
      if (b.status !== undefined) {
        if (Object.keys(STATUS_LABEL).indexOf(b.status) < 0) return bad('Unknown status');
        if (b.status !== order.status) {
          order.status = b.status;
          order.history.push({ status: b.status, at: nowIso() });
          // ready hote hi bill ban jata hai, taaki delivery ke waqt bill taiyaar ho
          if (b.status === 'ready' && !order.billId && (order.items || []).length) {
            billFromOrder(order);
          }
        }
      }
      if (b.paid !== undefined) order.paid = Boolean(b.paid);
      if (b.total !== undefined) order.total = round2(num(b.total, order.total));
      if (b.ownerNote !== undefined) order.ownerNote = cleanText(b.ownerNote, 500);
      save();
      return ok({ ok: true, order });
    }
    if (mOrder && method === 'DELETE') {
      const idx = db.orders.findIndex((o) => o.id === mOrder[1]);
      if (idx < 0) return bad('Order not found', 404);
      db.orders.splice(idx, 1);
      save();
      return ok({ ok: true });
    }

    /* stock */
    if (method === 'POST' && path === '/api/owner/stock') {
      const name = cleanText(b.name, 80);
      if (!name) return bad('Stock name is required');
      const item = {
        id: 'st-' + rid(8),
        name,
        unit: cleanText(b.unit, 20) || 'piece',
        qty: round2(num(b.qty, 0)),
        lowAt: round2(num(b.lowAt, 0)),
        costPrice: round2(num(b.costPrice, 0)),
        barcode: cleanText(b.barcode, 40),
        createdAt: nowIso(),
      };
      db.stock.push(item);
      if (item.qty > 0) adjustStock(item.id, 0, 'Opening stock', item.id);
      save();
      return { status: 201, body: { ok: true, item } };
    }

    let m = path.match(/^\/api\/owner\/stock\/([^/]+)\/adjust$/);
    if (m && method === 'POST') {
      const item = findStock(m[1]);
      if (!item) return bad('Stock item not found', 404);
      const delta = Number(b.delta);
      if (!Number.isFinite(delta) || delta === 0) return bad('Enter a quantity to add or remove');
      adjustStock(item.id, delta, cleanText(b.reason, 80) || 'Manual entry', 'manual');
      save();
      return ok({ ok: true, item });
    }

    m = path.match(/^\/api\/owner\/stock\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const item = findStock(m[1]);
      if (!item) return bad('Stock item not found', 404);
      if (b.name !== undefined) item.name = cleanText(b.name, 80) || item.name;
      if (b.unit !== undefined) item.unit = cleanText(b.unit, 20) || item.unit;
      if (b.lowAt !== undefined) item.lowAt = round2(num(b.lowAt, item.lowAt));
      if (b.costPrice !== undefined) item.costPrice = round2(num(b.costPrice, item.costPrice));
      if (b.barcode !== undefined) item.barcode = cleanText(b.barcode, 40);
      if (b.qty !== undefined) {
        const target = round2(num(b.qty, item.qty));
        const delta = round2(target - item.qty);
        if (delta !== 0) adjustStock(item.id, delta, 'Manual correction', item.id);
      }
      save();
      return ok({ ok: true, item });
    }
    if (m && method === 'DELETE') {
      const idx = db.stock.findIndex((s) => s.id === m[1]);
      if (idx < 0) return bad('Stock item not found', 404);
      db.stock.splice(idx, 1);
      db.printTypes.forEach((p) => { if (p.stockId === m[1]) p.stockId = null; });
      db.bindings.forEach((x) => { if (x.stockId === m[1]) x.stockId = null; });
      db.laminations.forEach((x) => { if (x.stockId === m[1]) x.stockId = null; });
      db.products.forEach((x) => { if (x.stockId === m[1]) x.stockId = null; });
      save();
      return ok({ ok: true });
    }

    /* catalog */
    m = path.match(/^\/api\/owner\/catalog\/([a-zA-Z]+)(?:\/([^/]+))?$/);
    if (m) {
      const kind = m[1];
      const id = m[2];
      const lists = {
        printTypes: { list: () => db.printTypes, norm: normalisePrintTypes, label: 'print type' },
        bindings: { list: () => db.bindings, norm: (x) => normaliseSimple(x, 'Binding'), label: 'binding' },
        laminations: { list: () => db.laminations, norm: (x) => normaliseSimple(x, 'Lamination'), label: 'lamination' },
        products: { list: () => db.products, norm: normaliseProducts, label: 'product' },
      };
      const target = lists[kind];
      if (!target) return bad('Unknown list', 404);

      if (method === 'POST' && !id) {
        const item = target.norm([Object.assign({}, b, { id: kind.slice(0, 2) + '-' + rid(8) })])[0];
        if (!item) return bad('Could not add ' + target.label);
        if (!item.name) return bad('Name is required');
        if (item.barcode && target.list().some((x) => x.barcode && x.barcode === item.barcode)) {
          return bad('That barcode is already used by another item');
        }
        target.list().push(item);
        save();
        return { status: 201, body: { ok: true, item } };
      }
      if (method === 'PATCH' && id) {
        const list = target.list();
        const idx = list.findIndex((x) => x.id === id);
        if (idx < 0) return bad('Item not found', 404);
        const item = target.norm([Object.assign({}, list[idx], b, { id: list[idx].id })])[0];
        if (item.barcode && list.some((x) => x.id !== item.id && x.barcode && x.barcode === item.barcode)) {
          return bad('That barcode is already used by another item');
        }
        list[idx] = item;
        save();
        return ok({ ok: true, item });
      }
      if (method === 'DELETE' && id) {
        const list = target.list();
        const idx = list.findIndex((x) => x.id === id);
        if (idx < 0) return bad('Item not found', 404);
        if (kind === 'printTypes' && db.bills.some((bl) => bl.items.some((i) => i.printTypeId === id))) {
          list[idx].active = false;
          save();
          return ok({ ok: true, deactivated: true });
        }
        list.splice(idx, 1);
        save();
        return ok({ ok: true });
      }
    }

    /* barcode lookup */
    if (method === 'GET' && path === '/api/owner/lookup') {
      const code = cleanText(q.code, 60);
      const text = cleanText(q.q, 60).toLowerCase();
      const matches = [];
      if (code) {
        const byBarcode = db.products.find((p) => p.barcode && p.barcode === code);
        if (byBarcode) matches.push({ kind: 'product', id: byBarcode.id, name: byBarcode.name, price: byBarcode.price, unit: byBarcode.unit, stockId: byBarcode.stockId, barcode: byBarcode.barcode });
        const stockHit = db.stock.find((s) => s.barcode && s.barcode === code);
        if (stockHit) matches.push({ kind: 'stock', id: stockHit.id, name: stockHit.name, price: stockHit.costPrice, unit: stockHit.unit, stockId: stockHit.id, barcode: stockHit.barcode });
      }
      if (text) {
        db.products.forEach((p) => {
          if (p.name.toLowerCase().indexOf(text) >= 0 && !matches.some((x) => x.id === p.id)) {
            matches.push({ kind: 'product', id: p.id, name: p.name, price: p.price, unit: p.unit, stockId: p.stockId, barcode: p.barcode });
          }
        });
        db.printTypes.forEach((pt) => {
          if (pt.name.toLowerCase().indexOf(text) >= 0 && matches.length < 12) {
            matches.push({ kind: 'printType', id: pt.id, name: pt.name, price: pt.pricePerPage, unit: pt.unit === 'pcs' ? 'pcs' : 'page', stockId: pt.stockId, barcode: '' });
          }
        });
      }
      return ok({ matches: matches.slice(0, 12) });
    }

    /* bills */
    if (method === 'POST' && path === '/api/owner/bills') {
      const built = buildBillItems(b.items);
      if (built.error) return bad(built.error);
      const subtotal = round2(built.items.reduce((s, i) => s + i.amount, 0));
      const discount = Math.min(round2(num(b.discount, 0)), subtotal);
      const total = round2(subtotal - discount);
      const payment = PAYMENT_MODES.indexOf(b.payment) >= 0 ? b.payment : 'cash';
      const name = cleanText(b.customerName, 60);
      const phone = cleanText(b.phone, 15).replace(/\D/g, '');
      if (payment === 'udhar' && !name && !phone) return bad('For udhar, enter the customer name or mobile number');

      const customer = (payment === 'udhar' || name || phone) ? findOrCreateCustomer(name, phone) : null;
      const bill = {
        id: 'bl-' + rid(10),
        no: nextBillNo(),
        at: nowIso(),
        customerId: customer ? customer.id : null,
        customerName: customer ? customer.name : (name || 'Walk-in'),
        phone: customer ? customer.phone : phone,
        items: built.items,
        subtotal,
        discount,
        total,
        payment,
        note: cleanText(b.note, 300),
        orderId: null,
        skipStock: false,
        stockUsed: [],
      };
      const map = new Map();
      bill.items.forEach((it) => {
        if (it.stockId && it.consume) map.set(it.stockId, round2((map.get(it.stockId) || 0) + it.qty * it.consume));
      });
      bill.stockUsed = Array.from(map.entries()).map(([stockId, qty]) => ({ stockId, qty }));
      bill.stockUsed.forEach((u) => adjustStock(u.stockId, -u.qty, 'Bill ' + bill.no, bill.no));
      db.bills.push(bill);
      save();
      return { status: 201, body: { ok: true, bill } };
    }

    if (method === 'GET' && path === '/api/owner/bills') {
      const text = String(q.q || '').toLowerCase().trim();
      const limit = Math.min(Number(q.limit) || 50, 200);
      let list = db.bills.slice().sort((a, b2) => (a.at < b2.at ? 1 : -1));
      if (text) {
        list = list.filter((bl) =>
          bl.no.toLowerCase().indexOf(text) >= 0 ||
          String(bl.customerName || '').toLowerCase().indexOf(text) >= 0 ||
          String(bl.phone || '').indexOf(text) >= 0);
      }
      return ok({ bills: list.slice(0, limit) });
    }

    m = path.match(/^\/api\/owner\/bills\/([^/]+)$/);
    if (m && method === 'GET') {
      const bill = db.bills.find((x) => x.id === m[1]);
      if (!bill) return bad('Bill not found', 404);
      return ok({ bill, settings: db.settings });
    }
    if (m && method === 'DELETE') {
      const idx = db.bills.findIndex((x) => x.id === m[1]);
      if (idx < 0) return bad('Bill not found', 404);
      const bill = db.bills.splice(idx, 1)[0];
      (bill.stockUsed || []).forEach((u) => adjustStock(u.stockId, +u.qty, 'Bill ' + bill.no + ' deleted', bill.no));
      save();
      return ok({ ok: true });
    }

    /* customers / udhar */
    if (method === 'GET' && path === '/api/owner/customers') {
      const balances = customerBalances();
      const list = db.customers.map((c) => {
        const bills = db.bills.filter((x) => x.customerId === c.id);
        return Object.assign({}, c, {
          balance: balances.get(c.id) || 0,
          bills: bills.length,
          lastAt: bills.length ? bills[bills.length - 1].at : c.createdAt,
        });
      }).sort((a, b2) => b2.balance - a.balance || (a.lastAt < b2.lastAt ? 1 : -1));
      return ok({ customers: list });
    }
    if (method === 'POST' && path === '/api/owner/customers') {
      const name = cleanText(b.name, 60);
      const phone = cleanText(b.phone, 15).replace(/\D/g, '');
      if (!name && !phone) return bad('Enter a name or mobile number');
      if (phone && db.customers.some((c) => c.phone.replace(/\D/g, '') === phone)) return bad('A customer with this number already exists');
      const cust = { id: 'cu-' + rid(8), name: name || 'Customer', phone, createdAt: nowIso() };
      db.customers.push(cust);
      save();
      return { status: 201, body: { ok: true, customer: cust } };
    }

    m = path.match(/^\/api\/owner\/customers\/([^/]+)\/payments$/);
    if (m && method === 'POST') {
      const cust = db.customers.find((c) => c.id === m[1]);
      if (!cust) return bad('Customer not found', 404);
      const amount = round2(num(b.amount, 0));
      if (amount <= 0) return bad('Enter an amount received');
      const payment = {
        id: 'pm-' + rid(8),
        at: nowIso(),
        customerId: cust.id,
        amount,
        mode: PAYMENT_MODES.indexOf(b.mode) >= 0 ? b.mode : 'cash',
        note: cleanText(b.note, 200),
      };
      db.payments.push(payment);
      save();
      return { status: 201, body: { ok: true, payment } };
    }

    m = path.match(/^\/api\/owner\/customers\/([^/]+)$/);
    if (m && method === 'GET') {
      const cust = db.customers.find((c) => c.id === m[1]);
      if (!cust) return bad('Customer not found', 404);
      const bills = db.bills.filter((x) => x.customerId === cust.id).sort((a, b2) => (a.at < b2.at ? 1 : -1));
      const payments = db.payments.filter((x) => x.customerId === cust.id).sort((a, b2) => (a.at < b2.at ? 1 : -1));
      const balance = round2(
        bills.filter((x) => x.payment === 'udhar').reduce((s, x) => s + x.total, 0) -
        payments.reduce((s, x) => s + x.amount, 0)
      );
      const credit = creditScore(cust.id);
      return ok({ customer: cust, bills, payments, balance, credit });
    }
    if (m && method === 'PATCH') {
      const cust = db.customers.find((c) => c.id === m[1]);
      if (!cust) return bad('Customer not found', 404);
      if (b.name !== undefined) cust.name = cleanText(b.name, 60) || cust.name;
      if (b.phone !== undefined) cust.phone = cleanText(b.phone, 15).replace(/\D/g, '');
      save();
      return ok({ ok: true, customer: cust });
    }
    if (m && method === 'DELETE') {
      const idx = db.customers.findIndex((c) => c.id === m[1]);
      if (idx < 0) return bad('Customer not found', 404);
      const balances = customerBalances();
      if ((balances.get(m[1]) || 0) !== 0) return bad('Settle the balance before deleting this customer');
      db.customers.splice(idx, 1);
      save();
      return ok({ ok: true });
    }

    /* settings + pin */
    if (method === 'PUT' && path === '/api/owner/settings') {
      ['shopName', 'tagline', 'phone', 'upiId', 'address', 'gstin', 'openNote', 'billPrefix', 'billFooter'].forEach((k) => {
        if (b[k] !== undefined) db.settings[k] = cleanText(b[k], 160);
      });
      if (b.notifyTopic !== undefined) db.settings.notifyTopic = cleanText(b.notifyTopic, 80);
      if (b.upiQr !== undefined) {
        const qr = String(b.upiQr || '');
        db.settings.upiQr = qr.slice(0, 400000);
      }
      ['acceptOrders', 'enforceMinOrder'].forEach((k) => {
        if (b[k] !== undefined) db.settings[k] = Boolean(b[k]);
      });
      if (b.minOrder !== undefined) db.settings.minOrder = round2(num(b.minOrder, db.settings.minOrder));
      save();
      return ok({ ok: true, settings: db.settings });
    }

    if (method === 'POST' && path === '/api/owner/pin') {
      const pin = String(b.pin || '');
      if (pin.length < 4 || pin.length > 12) return bad('PIN must be 4–12 characters');
      const salt = rid(16);
      db.pin = { salt, hash: hashPin(pin, salt) };
      save();
      return ok({ ok: true });
    }

    /* csv */
    if (method === 'GET' && path === '/api/owner/bills.csv') {
      saveTextFile('quick-print-bills.csv', billsCsv());
      return ok({ ok: true });
    }
    if (method === 'GET' && path === '/api/owner/orders.csv') {
      saveTextFile('quick-print-stock.csv', stockCsv());
      return ok({ ok: true });
    }
    if (method === 'GET' && path === '/api/owner/stock.csv') {
      saveTextFile('quick-print-stock.csv', stockCsv());
      return ok({ ok: true });
    }

    return bad('Not available offline: ' + method + ' ' + path, 404);
  }

  /* ------------------------------------------------------------ fetch shim */

  window.__engineRoute = route;

  const realFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    const options = init || {};
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String(options.method || (input && input.method) || 'GET').toUpperCase();

    let path = rawUrl;
    let query = {};
    const qIndex = path.indexOf('?');
    if (qIndex >= 0) {
      const qs = path.slice(qIndex + 1);
      path = path.slice(0, qIndex);
      qs.split('&').forEach((pair) => {
        if (!pair) return;
        const eq = pair.indexOf('=');
        const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
        const v = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
        query[k] = v;
      });
    }
    path = path.replace(/^https?:\/\/[^/]+/i, '');
    if (path.charAt(0) !== '/') path = '/' + path;

    if (path.indexOf('/api/') !== 0) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new Error('Offline'));
    }

    let body = {};
    if (options.body && typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch (e) { body = {}; }
    }

    let result;
    try {
      result = route(method, path, query, body);
    } catch (err) {
      result = { status: 500, body: { error: String(err && err.message ? err.message : err) } };
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'Content-Type': 'application/json' },
        }));
      }, 0);
    });
  };
})();


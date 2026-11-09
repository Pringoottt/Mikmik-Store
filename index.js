/* ---------- Show errors on the phone ---------- */
if (typeof supabase === 'undefined' || typeof Swal === 'undefined') {
  alert('Could not load required libraries. Check that your device has internet access and no ad-blockers are blocking CDNs.');
}
window.addEventListener('error', e => alert('JS error: ' + e.message));
window.addEventListener('unhandledrejection', e => alert('Error: ' + ((e.reason && e.reason.message) || e.reason)));

const $ = s => document.querySelector(s);

/* ---------- Supabase ---------- */
const SUPABASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
  || (typeof window !== 'undefined' && window.SUPABASE_URL)
  || 'https://hbcksinakccqhezcmucv.supabase.co';

const SUPABASE_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_KEY)
  || (typeof window !== 'undefined' && window.SUPABASE_KEY)
  || 'sb_publishable_9XJsWIC9L1AJngLvSwpqUQ_2gpXIxCQ';

const sb = (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

let db = { products: [], sales: [], credits: [] };

const peso = n => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmtDate = d => { const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };   // MM/DD/YYYY
const LOW = 5;

/* ---------- SweetAlert helpers ---------- */
const Alert = typeof Swal !== 'undefined'
  ? Swal.mixin({ confirmButtonColor: '#1f6f4a', cancelButtonColor: '#7a766a' })
  : { fire: opts => alert((opts.title ? opts.title + ': ' : '') + (opts.text || opts.html || '')) };

const Toast = typeof Swal !== 'undefined'
  ? Swal.mixin({
      toast: true, position: 'top-end', showConfirmButton: false,
      timer: 2200, timerProgressBar: true
    })
  : { fire: opts => console.log('Toast:', opts.title) };

const ok = title => Toast.fire({ icon: 'success', title });

const fail = e => Alert.fire({
  icon: 'error',
  title: 'Something went wrong',
  text: e && e.code === '23505' ? 'That name already exists.' : (e && e.message) || String(e)
});
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };
const check = r => { if (r.error) throw r.error; return r.data; };

/* ---------- Load data from Supabase ---------- */
async function load() {
  if (!sb) {
    throw new Error('Supabase is not initialized. Please verify your internet connection and Supabase configuration.');
  }
  const [p, s, c] = await Promise.all([
    sb.from('products').select('*').order('name'),
    sb.from('sales').select('*, customers(name)').order('created_at', { ascending: false }).limit(1000),
    sb.from('credit_transactions').select('*, customers(name)').order('created_at', { ascending: false }).limit(1000)
  ]);
  db.products = check(p).map(x => ({ id: x.id, name: x.name, price: +x.price, stock: x.stock }));
  db.sales = check(s).map(x => ({
    id: x.id, date: x.sale_date, name: x.product_name, qty: x.quantity,
    total: +x.total, type: x.payment_type, customer: x.customers ? x.customers.name : ''
  }));
  db.credits = check(c).map(x => ({
    id: x.id, cid: x.customer_id, customer: x.customers ? x.customers.name : '',
    date: x.txn_date, type: x.type, amount: +x.amount, note: x.note || ''
  }));
  render();
}

/* ---------- Tabs ---------- */
document.querySelectorAll('nav button[data-tab]').forEach(b => b.onclick = () => {
  if (b.dataset.tab !== 'inventory') $('#scan-close').click();
  if (b.dataset.tab !== 'sales') $('#ss-close').click();
  document.querySelectorAll('nav button, .tab').forEach(e => e.classList.remove('active'));
  b.classList.add('active');
  $('#' + b.dataset.tab).classList.add('active');
});

/* ---------- Helpers ---------- */
const balances = () => {
  const m = {};
  db.credits.forEach(c => { if (c.customer) m[c.customer] = (m[c.customer] || 0) + (c.type === 'utang' ? c.amount : -c.amount); });
  return m;
};

/* ---------- Inventory scanner ---------- */
let scanner = null, camWanted = false, scanned = null;

async function startCamera() {
  if (scanner) return;
  if (!window.Html5Qrcode) {
    camWanted = false;
    return Alert.fire({ icon: 'error', title: 'Scanner not loaded', text: 'Check your internet connection and refresh the page.' });
  }
  scanner = new Html5Qrcode('reader');
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, handleCode, () => {});
  } catch (err) {
    camWanted = false; scanner = null;
    Alert.fire({
      icon: 'error',
      title: 'Live camera not available',
      text: 'Live scanning needs HTTPS or localhost, and camera permission. Tap "Take photo to scan" instead, or use a USB scanner in the box.'
    });
  }
}

async function stopCamera() {
  const s = scanner; scanner = null;
  if (s) {
    try { await s.stop(); } catch (e) {}
    try { s.clear(); } catch (e) {}
  }
}

function resetScan() {
  scanned = null;
  $('#scan-result').hidden = true;
}

// The code text is the product name, or "Name|Price" to include the price.
function handleCode(text) {
  if (scanned) return;
  const [rawName, rawPrice] = String(text).split('|');
  const name = (rawName || '').trim();
  if (!name) return;
  const existing = db.products.find(p => p.name.toLowerCase() === name.toLowerCase());
  scanned = { name: existing ? existing.name : name, existing };
  stopCamera();
  $('#scan-name').textContent = scanned.name;
  $('#scan-status').textContent = existing
    ? `Found in inventory. Current stock: ${existing.stock}`
    : 'New product. Enter a price to add it to your listing.';
  $('#price-wrap').hidden = !!existing;
  const p = parseFloat(rawPrice);
  $('#scan-price').value = !existing && !isNaN(p) ? p : '';
  $('#scan-qty').value = 1;
  $('#scan-result').hidden = false;
  $('#scan-qty').focus();
}

$('#scan-open').onclick = () => {
  $('#scan-card').hidden = false;
  camWanted = true;
  resetScan();
  startCamera();
  $('#scan-card').scrollIntoView({ behavior: 'smooth' });
};

$('#scan-close').onclick = async () => {
  camWanted = false;
  await stopCamera();
  resetScan();
  $('#scan-card').hidden = true;
};

$('#scan-again').onclick = () => {
  resetScan();
  camWanted = true;
  startCamera();
};

$('#scan-manual').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  resetScan();
  handleCode(e.target.value);
  e.target.value = '';
});

// Photo fallback: works on plain http, no live camera needed
$('#scan-photo').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  await stopCamera();
  const reader = new Html5Qrcode('reader-tmp');
  try {
    const text = await reader.scanFile(file, false);
    resetScan();
    handleCode(text);
  } catch (err) {
    Alert.fire({ icon: 'warning', title: "Couldn't read the code", text: 'Move closer, keep the code flat and well lit, then try again.' });
  }
  try { reader.clear(); } catch (err) {}
};

$('#scan-add').onclick = safe(async () => {
  if (!scanned) return;
  const qty = parseInt($('#scan-qty').value, 10);
  if (!qty || qty < 1) return Alert.fire({ icon: 'warning', title: 'Enter a quantity', text: 'Quantity must be 1 or more.' });
  if (scanned.existing) {
    check(await sb.rpc('add_stock', { p_id: scanned.existing.id, p_qty: qty }));
  } else {
    const price = parseFloat($('#scan-price').value);
    if (isNaN(price) || price < 0) return Alert.fire({ icon: 'warning', title: 'Enter a price', text: 'New products need a price.' });
    check(await sb.from('products').insert({ name: scanned.name, price, stock: qty }));
  }
  const label = `${scanned.name} x${qty}`;
  await load();
  ok(`${label} added to listing`);
  resetScan();
  if (camWanted) startCamera();
});

/* ---------- Scan to sell ---------- */
let saleScanner = null, cart = [], lastScan = { text: '', time: 0 };

function addToCart(text, force) {
  const now = Date.now();
  // Camera reads the same code many times a second, so ignore repeats within 2 seconds
  if (!force && text === lastScan.text && now - lastScan.time < 2000) return;
  lastScan = { text, time: now };
  const name = String(text).split('|')[0].trim();
  const p = db.products.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!p) return Toast.fire({ icon: 'error', title: `Product not found: ${name}` });
  const line = cart.find(l => l.id === p.id);
  if ((line ? line.qty : 0) + 1 > p.stock) return Toast.fire({ icon: 'warning', title: `Only ${p.stock} of ${p.name} in stock` });
  if (line) line.qty++; else cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
  renderCart();
  Toast.fire({ icon: 'success', title: `${p.name} added` });
}

function renderCart() {
  $('#ss-body').innerHTML = cart.length ? cart.map((l, i) => `
    <tr><td>${esc(l.name)}</td><td>${peso(l.price)}</td>
    <td><button class="small" onclick="cartQty(${i},-1)">-</button> ${l.qty}
        <button class="small" onclick="cartQty(${i},1)">+</button></td>
    <td>${peso(l.price * l.qty)}</td>
    <td><button class="small danger" onclick="cartDel(${i})">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Scan a product to start.</td></tr>';
  $('#ss-total').textContent = peso(cart.reduce((a, l) => a + l.price * l.qty, 0));
}

window.cartQty = (i, d) => {
  const l = cart[i], p = db.products.find(p => p.id === l.id), q = l.qty + d;
  if (q < 1) return cartDel(i);
  if (p && q > p.stock) return Toast.fire({ icon: 'warning', title: `Only ${p.stock} in stock` });
  l.qty = q; renderCart();
};
window.cartDel = i => { cart.splice(i, 1); renderCart(); };

async function startSaleCam() {
  if (saleScanner) return;
  if (!window.Html5Qrcode) return Alert.fire({ icon: 'error', title: 'Scanner not loaded', text: 'Check your internet connection and refresh the page.' });
  saleScanner = new Html5Qrcode('ss-reader');
  try {
    await saleScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, t => addToCart(t), () => {});
  } catch (err) {
    saleScanner = null;
    Alert.fire({
      icon: 'error',
      title: 'Live camera not available',
      text: 'Live scanning needs HTTPS or localhost, and camera permission. Tap "Take photo to scan" instead, or use a USB scanner in the box.'
    });
  }
}

async function stopSaleCam() {
  const s = saleScanner; saleScanner = null;
  if (s) {
    try { await s.stop(); } catch (e) {}
    try { s.clear(); } catch (e) {}
  }
}

$('#ss-open').onclick = () => {
  $('#ss-card').hidden = false;
  renderCart();
  startSaleCam();
  $('#ss-card').scrollIntoView({ behavior: 'smooth' });
};

$('#ss-close').onclick = async () => {
  await stopSaleCam();
  $('#ss-card').hidden = true;   // the list is kept until you complete or clear it
};

$('#ss-clear').onclick = () => { cart = []; renderCart(); };

$('#ss-type').onchange = e => {
  $('#ss-customer').hidden = e.target.value !== 'utang';
};

// USB scanner or pasted code (no 2-second repeat filter, so you can scan the same item twice)
$('#ss-manual').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.target.value.trim()) addToCart(e.target.value, true);
  e.target.value = '';
});

// Photo fallback for plain http
$('#ss-photo').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const wasOn = !!saleScanner;
  await stopSaleCam();
  const reader = new Html5Qrcode('ss-tmp');
  try {
    addToCart(await reader.scanFile(file, false), true);
  } catch (err) {
    Alert.fire({ icon: 'warning', title: "Couldn't read the code", text: 'Move closer, keep the code flat and well lit, then try again.' });
  }
  try { reader.clear(); } catch (err) {}
  if (wasOn) startSaleCam();
};

$('#ss-done').onclick = safe(async () => {
  if (!cart.length) return Alert.fire({ icon: 'info', title: 'Nothing to sell', text: 'Scan a product first.' });
  const type = $('#ss-type').value, customer = $('#ss-customer').value.trim();
  if (type === 'utang' && !customer) return Alert.fire({ icon: 'warning', title: 'Customer name needed', text: 'Enter who is buying on credit.' });
  const total = cart.reduce((a, l) => a + l.price * l.qty, 0);
  let err = null;
  for (const l of [...cart]) {
    const r = await sb.rpc('record_sale', { p_product_id: l.id, p_qty: l.qty, p_type: type, p_customer: type === 'utang' ? customer : null });
    if (r.error) { err = r.error; break; }
    cart = cart.filter(x => x !== l);   // remove lines that were saved
  }
  await load();
  renderCart();
  if (err) throw err;                    // lines that failed stay in the list
  $('#ss-customer').value = '';
  ok(`Sale recorded: ${peso(total)}`);
});

/* ---------- Inventory ---------- */
$('#prod-form').onsubmit = safe(async e => {
  e.preventDefault();
  const name = $('#p-name').value.trim();
  check(await sb.from('products').insert({ name, price: +$('#p-price').value, stock: +$('#p-stock').value }));
  e.target.reset();
  await load();
  ok(`${name} added`);
});

function renderInventory() {
  const q = $('#search').value.toLowerCase();
  const rows = db.products.filter(p => p.name.toLowerCase().includes(q));
  $('#inv-body').innerHTML = rows.length ? rows.map(p => `
    <tr><td>${esc(p.name)}</td><td>${peso(p.price)}</td>
    <td class="${p.stock <= LOW ? 'low' : ''}">${p.stock}${p.stock <= LOW ? ' (low)' : ''}</td>
    <td><button class="small" onclick="restock(${p.id})">+ Stock</button>
        <button class="small" onclick="editPrice(${p.id})">Price</button>
        <button class="small danger" onclick="delProduct(${p.id})">Delete</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No products yet. Add one above.</td></tr>';
}
$('#search').oninput = renderInventory;

window.restock = safe(async id => {
  const p = db.products.find(p => p.id === id);
  const { value } = await Alert.fire({
    title: 'Add stock',
    text: p.name,
    input: 'number',
    inputLabel: 'How many units?',
    inputAttributes: { min: 1, step: 1 },
    showCancelButton: true,
    confirmButtonText: 'Add stock',
    inputValidator: v => (!v || parseInt(v, 10) < 1) ? 'Enter a number greater than 0' : null
  });
  if (value) {
    check(await sb.rpc('add_stock', { p_id: id, p_qty: parseInt(value, 10) }));
    await load(); ok('Stock updated');
  }
});

window.editPrice = safe(async id => {
  const p = db.products.find(p => p.id === id);
  const { value } = await Alert.fire({
    title: 'Change price',
    text: p.name,
    input: 'number',
    inputValue: p.price,
    inputAttributes: { min: 0, step: '0.01' },
    showCancelButton: true,
    confirmButtonText: 'Save price',
    inputValidator: v => (v === '' || parseFloat(v) < 0) ? 'Enter a valid price' : null
  });
  if (value !== undefined && value !== '') {
    check(await sb.from('products').update({ price: parseFloat(value) }).eq('id', id));
    await load(); ok('Price updated');
  }
});

window.delProduct = safe(async id => {
  const p = db.products.find(p => p.id === id);
  const r = await Alert.fire({
    icon: 'warning',
    title: 'Delete this product?',
    text: `${p.name} will be removed from your inventory.`,
    showCancelButton: true,
    confirmButtonText: 'Yes, delete',
    confirmButtonColor: '#b42318'
  });
  if (r.isConfirmed) {
    check(await sb.from('products').delete().eq('id', id));
    await load(); ok('Product deleted');
  }
});

/* ---------- Sales ---------- */
$('#sale-type').onchange = e => {
  $('#sale-customer').hidden = e.target.value !== 'utang';
  $('#sale-customer').required = e.target.value === 'utang';
};

$('#sale-form').onsubmit = safe(async e => {
  e.preventDefault();
  const p = db.products.find(p => p.id === +$('#sale-product').value);
  const qty = +$('#sale-qty').value, type = $('#sale-type').value;
  if (!p) return Alert.fire({ icon: 'info', title: 'No product selected', text: 'Please select a product first.' });
  if (qty > p.stock) return Alert.fire({ icon: 'warning', title: 'Not enough stock', text: `Only ${p.stock} left of ${p.name}.` });
  const customer = $('#sale-customer').value.trim();
  check(await sb.rpc('record_sale', { p_product_id: p.id, p_qty: qty, p_type: type, p_customer: type === 'utang' ? customer : null }));
  e.target.reset(); $('#sale-customer').hidden = true;
  await load();
  ok(`Sale recorded: ${peso(p.price * qty)}`);
});

// Product dropdown with search
function renderSaleProducts() {
  const q = $('#sale-search').value.trim().toLowerCase();
  const prev = $('#sale-product').value;
  const list = db.products.filter(p => p.stock > 0 && p.name.toLowerCase().includes(q));
  $('#sale-product').innerHTML = list.length
    ? list.map(p => `<option value="${p.id}">${esc(p.name)} - ${peso(p.price)} (${p.stock})</option>`).join('')
    : `<option value="">${q ? 'No matching product' : 'No products available'}</option>`;
  if (list.some(p => String(p.id) === prev)) $('#sale-product').value = prev;   // keep your selection
}
$('#sale-search').oninput = renderSaleProducts;

function renderSales() {
  renderSaleProducts();
  $('#customers').innerHTML = Object.keys(balances()).map(c => `<option value="${esc(c)}">`).join('');
  const recent = db.sales.slice(0, 15);
  $('#sales-body').innerHTML = recent.length ? recent.map(s => `
    <tr><td>${s.date}</td><td>${esc(s.name)}</td><td>${s.qty}</td><td>${peso(s.total)}</td>
    <td><span class="badge ${s.type}">${s.type === 'utang' ? 'Credit: ' + esc(s.customer) : 'Cash'}</span></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No sales yet.</td></tr>';
}

/* ---------- Credit ---------- */
function renderCredit() {
  const q = $('#credit-search').value.trim().toLowerCase();
  const list = Object.entries(balances())
    .filter(([name]) => name.toLowerCase().includes(q))
    .map(([name, bal]) => {
      const entries = db.credits.filter(c => c.customer === name);
      const lastCredit = entries.filter(c => c.type === 'utang').reduce((m, c) => c.date > m ? c.date : m, '');
      return { name, bal, entries, lastCredit };
    })
    .sort((a, b) => b.bal - a.bal);

  $('#credit-list').innerHTML = list.length ? list.map(x => {
    const rows = x.entries.map(c => c.type === 'utang'
      ? `<li><span>${esc(c.note || 'Credit')}</span><span>${fmtDate(c.date)}</span><b>${peso(c.amount)}</b></li>`
      : `<li class="paid"><span>Payment</span><span>${fmtDate(c.date)}</span><b>-${peso(c.amount)}</b></li>`).join('');
    return `<details><summary>
      <span class="arrow">▶</span>
      <span class="cname">${esc(x.name)}</span>
      <span class="owe ${x.bal <= 0 ? 'zero' : ''}">${peso(x.bal)}</span>
      <span class="cdate">${x.lastCredit ? fmtDate(x.lastCredit) : ''}</span>
      <button class="small" onclick="event.preventDefault();pay('${esc(x.name).replace(/'/g, "\\'")}')">Add payment</button>
    </summary>
    <ul class="hist items">${rows}</ul></details>`;
  }).join('') : `<p class="empty">${q ? 'No matching customers.' : 'No credit yet. Choose "Credit" when recording a sale to get started.'}</p>`;
}
$('#credit-search').addEventListener('input', renderCredit);

window.pay = safe(async name => {
  const bal = balances()[name];
  const cid = (db.credits.find(c => c.customer === name) || {}).cid;
  const { value } = await Alert.fire({
    title: 'Add payment',
    html: `${esc(name)}<br>Current balance: <b>${peso(bal)}</b>`,
    input: 'number',
    inputLabel: 'Amount paid',
    inputAttributes: { min: 0, step: '0.01' },
    showCancelButton: true,
    confirmButtonText: 'Save payment',
    inputValidator: v => {
      if (!v || parseFloat(v) <= 0) return 'Enter an amount greater than 0';
      if (parseFloat(v) > bal) return `Payment is more than the balance (${peso(bal)})`;
      return null;
    }
  });
  if (value) {
    check(await sb.from('credit_transactions').insert({ customer_id: cid, type: 'bayad', amount: parseFloat(value) }));
    await load(); ok('Payment saved');
  }
});

/* ---------- Monthly revenue ---------- */
function renderRevenue() {
  const m = {};
  const row = k => m[k] ||= { total: 0, cash: 0, utang: 0, paid: 0 };
  db.sales.forEach(s => { const r = row(s.date.slice(0, 7)); r.total += s.total; r[s.type] += s.total; });
  db.credits.filter(c => c.type === 'bayad').forEach(c => row(c.date.slice(0, 7)).paid += c.amount);
  const keys = Object.keys(m).sort().reverse();
  $('#rev-body').innerHTML = keys.length ? keys.map(k => {
    const label = new Date(k + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const r = m[k];
    return `<tr><td>${label}</td><td><b>${peso(r.total)}</b></td><td>${peso(r.cash)}</td><td>${peso(r.utang)}</td><td>${peso(r.paid)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No data yet.</td></tr>';
}

/* ---------- Summary + render ---------- */
function renderStats() {
  const t = today(), mo = t.slice(0, 7);
  $('#st-today').textContent = peso(db.sales.filter(s => s.date === t).reduce((a, s) => a + s.total, 0));
  $('#st-month').textContent = peso(db.sales.filter(s => s.date.startsWith(mo)).reduce((a, s) => a + s.total, 0));
  $('#st-utang').textContent = peso(Object.values(balances()).reduce((a, b) => a + Math.max(b, 0), 0));
  $('#st-low').textContent = db.products.filter(p => p.stock <= LOW).length;
}

function render() { renderStats(); renderSales(); renderInventory(); renderCredit(); renderRevenue(); }

/* ---------- Start ---------- */
render();
renderCart();
load().catch(fail);
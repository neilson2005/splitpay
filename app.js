// ============================================================
// SplitPay — config
// ============================================================
const CONFIG = {
  CLIENT_ID: '679676657560-epd881626nfnfar7f1l52sc316d7oqop.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/drive.file openid profile email',
  DRIVE_API: 'https://www.googleapis.com/drive/v3',
  DRIVE_UPLOAD: 'https://www.googleapis.com/upload/drive/v3',
  FOLDER_NAME: 'SplitPay',
  DATA_FILE: 'splitpay-data.json',
  PROXY_URL: 'REPLACE_WITH_WORKER_URL',
};

// ============================================================
// State
// ============================================================
let state = {
  token: null,
  user: null,
  folderId: null,
  dataFileId: null,
  groupName: 'Trip Expenses',
  members: [],
  expenses: [],
  receiptFileIds: {}, // expenseId -> driveFileId
  scanResult: null,
  scanImageB64: null,
  scanImagePreview: null,
  scanning: false,
  syncing: false,
};

// ============================================================
// Avatar colors
// ============================================================
const AV_COLORS = [
  { bg: '#E1F5EE', color: '#0F6E56' },
  { bg: '#E6F1FB', color: '#185FA5' },
  { bg: '#FAEEDA', color: '#854F0B' },
  { bg: '#FAECE7', color: '#993C1D' },
  { bg: '#FBEAF0', color: '#993556' },
  { bg: '#EAF3DE', color: '#3B6D11' },
  { bg: '#FCEBEB', color: '#A32D2D' },
];
const CATS = ['🍽️ Food','🚕 Transport','🏨 Hotel','🛍️ Shopping','🎭 Entertainment','💊 Health','⚡ Utilities','📦 Other'];

function avatarColor(name) {
  const i = Math.abs((name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % AV_COLORS.length;
  return AV_COLORS[i];
}
function initials(name) {
  return (name || '?').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtMoney(v) { return 'RM ' + Math.abs(parseFloat(v) || 0).toFixed(2); }
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ============================================================
// Google Sign-In
// ============================================================
let tokenClient = null;

function initGoogle() {
  if (typeof google === 'undefined') {
    setTimeout(initGoogle, 300);
    return;
  }
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: handleToken,
      error_callback: (err) => {
        console.error('OAuth error:', err);
        showAuthError('Sign-in error: ' + (err.message || err.type || 'Unknown error. Check your OAuth settings.'));
      },
    });
    console.log('Google OAuth token client ready');
    // Show button as ready
    const btn = document.getElementById('signin-btn');
    if (btn) btn.style.opacity = '1';
  } catch (e) {
    console.error('initTokenClient failed:', e);
    showAuthError('Google sign-in could not load. Check your Client ID and authorised origins.');
  }
}

function showAuthError(msg) {
  let el = document.getElementById('auth-error');
  if (!el) {
    el = document.createElement('p');
    el.id = 'auth-error';
    el.style.cssText = 'color:#A32D2D;background:#FCEBEB;border:0.5px solid #F09595;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:12px;text-align:left';
    document.querySelector('.auth-card').appendChild(el);
  }
  el.textContent = msg;
}

function handleToken(resp) {
  if (resp.error) {
    console.error('Token error:', resp);
    showAuthError('Sign-in failed: ' + resp.error + '. Make sure your email is added as a Test User in Google Cloud Console.');
    return;
  }
  state.token = resp.access_token;
  fetchUserInfo().then(() => {
    showApp();
    initDriveFolder();
  }).catch(e => {
    console.error('fetchUserInfo failed:', e);
    showAuthError('Signed in but could not fetch user info. Try again.');
  });
}

async function fetchUserInfo() {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + state.token }
  });
  state.user = await r.json();
  const av = document.getElementById('user-avatar');
  if (state.user.picture) {
    av.innerHTML = `<img src="${state.user.picture}" alt="avatar">`;
  } else {
    av.textContent = initials(state.user.name || state.user.email || 'U');
  }
}

function signOut() {
  state.token = null;
  state.user = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

// ============================================================
// Google Drive — folder & data file management
// ============================================================
async function driveGet(url, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${CONFIG.DRIVE_API}${url}${qs ? '?' + qs : ''}`, {
    headers: { Authorization: 'Bearer ' + state.token }
  });
  return r.json();
}

async function initDriveFolder() {
  showSync('Connecting to Google Drive...');
  try {
    // Find or create SplitPay folder
    const list = await driveGet('/files', {
      q: `name='${CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
    });
    if (list.files && list.files.length > 0) {
      state.folderId = list.files[0].id;
    } else {
      const r = await fetch(`${CONFIG.DRIVE_API}/files`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: CONFIG.FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      });
      const f = await r.json();
      state.folderId = f.id;
    }

    // Find or load data file
    const dlist = await driveGet('/files', {
      q: `name='${CONFIG.DATA_FILE}' and '${state.folderId}' in parents and trashed=false`,
      fields: 'files(id,name)',
    });
    if (dlist.files && dlist.files.length > 0) {
      state.dataFileId = dlist.files[0].id;
      await loadDataFromDrive();
    } else {
      await saveDataToDrive();
    }
    hideSync();
    renderAll();
  } catch (e) {
    hideSync();
    console.error('Drive init error', e);
    renderAll();
  }
}

async function loadDataFromDrive() {
  if (!state.dataFileId) return;
  try {
    const r = await fetch(`${CONFIG.DRIVE_API}/files/${state.dataFileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + state.token }
    });
    const data = await r.json();
    if (data.groupName) state.groupName = data.groupName;
    if (data.members) state.members = data.members;
    if (data.expenses) state.expenses = data.expenses;
    if (data.receiptFileIds) state.receiptFileIds = data.receiptFileIds;
    // update group name display
    document.getElementById('group-name-display').textContent = state.groupName;
  } catch (e) { console.error('Load error', e); }
}

async function saveDataToDrive() {
  if (!state.folderId) return;
  showSync('Saving to Google Drive...');
  const payload = JSON.stringify({
    groupName: state.groupName,
    members: state.members,
    expenses: state.expenses,
    receiptFileIds: state.receiptFileIds,
  });
  try {
    if (state.dataFileId) {
      await fetch(`${CONFIG.DRIVE_UPLOAD}/files/${state.dataFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' },
        body: payload,
      });
    } else {
      const meta = { name: CONFIG.DATA_FILE, parents: [state.folderId], mimeType: 'application/json' };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', new Blob([payload], { type: 'application/json' }));
      const r = await fetch(`${CONFIG.DRIVE_UPLOAD}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: form,
      });
      const f = await r.json();
      state.dataFileId = f.id;
    }
  } catch (e) { console.error('Save error', e); }
  hideSync();
}

async function uploadReceiptToDrive(expenseId, base64img) {
  if (!state.folderId) return null;
  showSync('Uploading receipt to Google Drive...');
  try {
    const binary = atob(base64img);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/jpeg' });

    const meta = { name: `receipt_${expenseId}.jpg`, parents: [state.folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);

    const r = await fetch(`${CONFIG.DRIVE_UPLOAD}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.token },
      body: form,
    });
    const f = await r.json();
    hideSync();
    return f.id;
  } catch (e) {
    hideSync();
    console.error('Receipt upload error', e);
    return null;
  }
}

async function getReceiptUrl(fileId) {
  // Return a Drive thumbnail/download URL using the token
  return `${CONFIG.DRIVE_API}/files/${fileId}?alt=media&access_token=${state.token}`;
}

// ============================================================
// Finance logic
// ============================================================
function computeBalances() {
  const bal = {};
  state.members.forEach(m => bal[m.id] = 0);
  state.expenses.forEach(exp => {
    const splits = exp.splits || {};
    Object.entries(splits).forEach(([uid, amt]) => {
      if (uid !== exp.paidBy) {
        if (bal[exp.paidBy] !== undefined) bal[exp.paidBy] += parseFloat(amt) || 0;
        if (bal[uid] !== undefined) bal[uid] -= parseFloat(amt) || 0;
      }
    });
  });
  return bal;
}

function computeSettlements() {
  const bal = computeBalances();
  const pos = [], neg = [];
  Object.entries(bal).forEach(([id, v]) => {
    const m = state.members.find(x => x.id === id);
    if (!m) return;
    if (v > 0.005) pos.push({ id, name: m.name, amt: v });
    else if (v < -0.005) neg.push({ id, name: m.name, amt: Math.abs(v) });
  });
  const txns = [];
  const p = [...pos.sort((a, b) => b.amt - a.amt)];
  const n = [...neg.sort((a, b) => b.amt - a.amt)];
  let pi = 0, ni = 0;
  while (pi < p.length && ni < n.length) {
    const pay = Math.min(p[pi].amt, n[ni].amt);
    txns.push({ from: n[ni].name, to: p[pi].name, fromId: n[ni].id, toId: p[pi].id, amt: pay });
    p[pi].amt -= pay; n[ni].amt -= pay;
    if (p[pi].amt < 0.005) pi++;
    if (n[ni].amt < 0.005) ni++;
  }
  return txns;
}

// ============================================================
// AI Receipt Scan
// ============================================================

// Compress image before sending — reduces size and improves reliability
function compressImage(b64, maxWidth = 1200, quality = 0.82) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      resolve(compressed);
    };
    img.onerror = () => resolve(b64); // fallback to original
    img.src = 'data:image/jpeg;base64,' + b64;
  });
}

// Map AI category response to our CATS list
function matchCategory(raw) {
  if (!raw) return CATS[0]; // default Food
  const r = raw.toLowerCase().trim();
  const map = {
    'food': '🍽️ Food', 'drink': '🍽️ Food', 'restaurant': '🍽️ Food',
    'cafe': '🍽️ Food', 'coffee': '🍽️ Food', 'meal': '🍽️ Food',
    'grocery': '🍽️ Food', 'groceries': '🍽️ Food',
    'transport': '🚕 Transport', 'taxi': '🚕 Transport', 'grab': '🚕 Transport',
    'uber': '🚕 Transport', 'bus': '🚕 Transport', 'train': '🚕 Transport',
    'flight': '🚕 Transport', 'petrol': '🚕 Transport', 'fuel': '🚕 Transport',
    'hotel': '🏨 Hotel', 'accommodation': '🏨 Hotel', 'airbnb': '🏨 Hotel',
    'hostel': '🏨 Hotel', 'motel': '🏨 Hotel',
    'shopping': '🛍️ Shopping', 'retail': '🛍️ Shopping', 'clothes': '🛍️ Shopping',
    'entertainment': '🎭 Entertainment', 'movie': '🎭 Entertainment',
    'cinema': '🎭 Entertainment', 'ticket': '🎭 Entertainment',
    'health': '💊 Health', 'pharmacy': '💊 Health', 'medical': '💊 Health',
    'clinic': '💊 Health', 'hospital': '💊 Health',
    'utilities': '⚡ Utilities', 'electric': '⚡ Utilities', 'water': '⚡ Utilities',
    'internet': '⚡ Utilities', 'phone': '⚡ Utilities',
  };
  // Direct key match
  if (map[r]) return map[r];
  // Partial match
  for (const [key, val] of Object.entries(map)) {
    if (r.includes(key)) return val;
  }
  return CATS[0]; // default to Food (most common for group trips)
}

async function scanReceipt(b64) {
  state.scanning = true;
  renderScannerPanel();
  try {
    // Compress image first
    const compressed = await compressImage(b64);

    const resp = await fetch(CONFIG.PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: compressed }
            },
            {
              type: 'text',
              text: `You are a receipt scanner. Carefully read this receipt image and extract ALL visible information.

Extract:
1. Store/restaurant name (look for header text at top)
2. Grand total amount — look for "TOTAL", "GRAND TOTAL", "JUMLAH", "Amount Due" — use the FINAL total after tax, NOT subtotal
3. Category — MUST be exactly one of: Food, Transport, Hotel, Shopping, Entertainment, Health, Utilities, Other
   - Nasi lemak, kopi, makan, restaurant, cafe, hawker = Food
   - Grab, taxi, parking, petrol = Transport
   - Hotel, resort, airbnb = Hotel
4. Date if visible (YYYY-MM-DD format)
5. All line items with their prices

Rules:
- If you see "Subtotal: 31.70" and "Service charge: 1.90" and "Total: 33.60" — use 33.60
- Category: when in doubt between Food and Other, choose Food
- All prices in MYR unless currency symbol shows otherwise

Respond ONLY with this exact JSON format, no markdown, no explanation:
{"name":"store name here","total":0.00,"currency":"MYR","category":"Food","date":"","items":[{"desc":"item name","price":0.00}]}`
            }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Proxy error:', resp.status, errText);
      throw new Error('Proxy returned ' + resp.status);
    }

    const data = await resp.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Fix category using our robust matcher
    parsed.category = matchCategory(parsed.category);
    state.scanResult = parsed;

  } catch (e) {
    console.error('Scan error:', e);
    state.scanResult = { error: true, name: '', total: 0, category: '🍽️ Food', items: [] };
  }
  state.scanning = false;
  renderScannerPanel();
}

// ============================================================
// Render — full UI
// ============================================================
function renderAll() {
  renderStats();
  renderExpenses();
  renderSettle();
  renderMembers();
  document.getElementById('group-name-display').textContent = state.groupName;
}

function renderStats() {
  const totalSpent = state.expenses.filter(e => !e.isSettlement).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const receiptCount = Object.keys(state.receiptFileIds).length;
  const settlements = computeSettlements();
  document.getElementById('stat-total').textContent = 'RM ' + totalSpent.toFixed(2);
  document.getElementById('stat-count').textContent = state.expenses.filter(e => !e.isSettlement).length;
  document.getElementById('stat-receipts').textContent = receiptCount;
  document.getElementById('stat-settle').textContent = settlements.length;
}

// ===== Expenses Tab =====
function renderExpenses() {
  const list = document.getElementById('expense-list');
  if (state.expenses.length === 0) {
    list.innerHTML = '<div class="empty-state">No expenses yet.<br>Scan a receipt or add manually.</div>';
    return;
  }
  list.innerHTML = state.expenses.map(e => buildExpenseRow(e)).join('');
}

function buildExpenseRow(e) {
  const payer = state.members.find(m => m.id === e.paidBy);
  const av = payer ? avatarColor(payer.name) : { bg: '#eee', color: '#999' };
  const splits = e.splits || {};
  const splitees = Object.keys(splits).filter(id => id !== e.paidBy);
  const hasReceipt = !!state.receiptFileIds[e.id];
  const perPerson = splitees.length ? (parseFloat(e.amount || 0) / (splitees.length + 1)).toFixed(2) : null;

  return `<div class="expense-row">
    <div class="avatar" style="background:${av.bg};color:${av.color}">${payer ? initials(payer.name) : '?'}</div>
    <div class="expense-meta">
      <div class="expense-desc">
        <span>${e.desc || 'Expense'}</span>
        ${e.isSettlement ? '<span class="pill pill-gray">settlement</span>' : ''}
        ${hasReceipt ? `<span class="pill pill-blue" onclick="viewReceipt('${e.id}')">📎 receipt</span>` : ''}
        ${e.items && e.items.length ? '<span class="ai-badge">AI scanned</span>' : ''}
      </div>
      <div class="expense-sub">${e.category || ''} · paid by <b>${payer ? payer.name : 'Unknown'}</b> · ${fmtDate(e.date)}</div>
      ${splitees.length && !e.isSettlement ? `<div class="expense-split">Split: ${splitees.map(id => { const m = state.members.find(x => x.id === id); return m ? m.name : '?'; }).join(', ')}</div>` : ''}
    </div>
    <div class="expense-amount">
      <div class="amount-val">${fmtMoney(e.amount)}</div>
      ${perPerson && !e.isSettlement ? `<div class="amount-per">RM ${perPerson}/person</div>` : ''}
      <button class="btn-danger" onclick="removeExpense('${e.id}')">remove</button>
    </div>
  </div>`;
}

// ===== Scanner Panel =====
function renderScannerPanel() {
  const panel = document.getElementById('scanner-panel');
  const dz = document.getElementById('drop-zone');
  const progress = document.getElementById('scan-progress');
  const resultForm = document.getElementById('scan-result-form');

  if (state.scanning) {
    dz.classList.add('hidden');
    progress.classList.remove('hidden');
    resultForm.classList.add('hidden');
    resultForm.innerHTML = '';
    return;
  }

  progress.classList.add('hidden');

  if (state.scanResult) {
    dz.classList.add('hidden');
    resultForm.classList.remove('hidden');
    resultForm.innerHTML = buildScanResultForm();
  } else {
    dz.classList.remove('hidden');
    resultForm.classList.add('hidden');
    resultForm.innerHTML = '';
  }
}

function buildScanResultForm() {
  const r = state.scanResult;
  if (!state.members.length) return '<div class="notice warn">Add members first before scanning.</div>';

  const memberOpts = state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  // r.category is already a full CATS string like "🍽️ Food" from matchCategory()
  const catVal = CATS.includes(r.category) ? r.category : CATS[0];

  let html = '';
  if (r.error) html += '<div class="notice warn" style="margin-bottom:10px">Could not read receipt automatically. Fill in manually below.</div>';

  if (state.scanImagePreview) {
    html += `<img src="${state.scanImagePreview}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:10px;border:0.5px solid rgba(0,0,0,0.08)">`;
  }

  if (r.items && r.items.length) {
    html += `<div class="extracted-items" style="margin-bottom:10px">
      <div style="font-size:11px;color:#73726c;font-weight:500;margin-bottom:6px">EXTRACTED ITEMS</div>
      ${r.items.map(it => `<div class="extracted-item"><span>${it.desc}</span><span style="font-family:'DM Mono',monospace">RM ${parseFloat(it.price || 0).toFixed(2)}</span></div>`).join('')}
      <div class="extracted-item"><span>Total</span><span style="font-family:'DM Mono',monospace">RM ${parseFloat(r.total || 0).toFixed(2)}</span></div>
    </div>`;
  }

  html += `<div class="form-grid">
    <div class="form-row"><label class="form-label">Description</label><input id="exp-desc" class="input-field" value="${r.name || ''}"></div>
    <div class="form-row"><label class="form-label">Amount (RM)</label><input id="exp-amount" class="input-field" type="number" step="0.01" value="${parseFloat(r.total || 0).toFixed(2)}"></div>
  </div>
  <div class="form-grid">
    <div class="form-row"><label class="form-label">Paid by</label><select id="exp-payer" class="input-field">${memberOpts}</select></div>
    <div class="form-row"><label class="form-label">Category</label><select id="exp-cat" class="input-field">${CATS.map(c => `<option value="${c}" ${c === catVal ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
  </div>
  <div class="form-row"><label class="form-label">Split among</label>
    <div class="split-checks">${state.members.map(m => `<label class="split-check-label"><input type="checkbox" name="split_${m.id}" value="${m.id}" checked> ${m.name}</label>`).join('')}</div>
  </div>
  <div class="panel-footer">
    <button class="btn-primary" onclick="submitExpense(true)">Save with receipt 📎</button>
    <button class="btn-outline" onclick="resetScanner()">Rescan</button>
  </div>`;
  return html;
}

function buildManualForm() {
  const memberOpts = state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  if (!state.members.length) return '<div class="notice warn">Add members first.</div>';
  return `<div class="form-grid">
    <div class="form-row"><label class="form-label">Description</label><input id="exp-desc" class="input-field" placeholder="e.g. Dinner"></div>
    <div class="form-row"><label class="form-label">Amount (RM)</label><input id="exp-amount" class="input-field" type="number" step="0.01" placeholder="0.00"></div>
  </div>
  <div class="form-grid">
    <div class="form-row"><label class="form-label">Paid by</label><select id="exp-payer" class="input-field">${memberOpts}</select></div>
    <div class="form-row"><label class="form-label">Category</label><select id="exp-cat" class="input-field">${CATS.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
  </div>
  <div class="form-row"><label class="form-label">Split among</label>
    <div class="split-checks">${state.members.map(m => `<label class="split-check-label"><input type="checkbox" name="split_${m.id}" value="${m.id}" checked> ${m.name}</label>`).join('')}</div>
  </div>`;
}

// ===== Settle Tab =====
function renderSettle() {
  const settlements = computeSettlements();
  const bal = computeBalances();

  const settleEl = document.getElementById('settlements-list');
  if (settlements.length === 0) {
    settleEl.innerHTML = '<div class="empty-state">Everyone is settled up! 🎉</div>';
  } else {
    settleEl.innerHTML = settlements.map(t => `
      <div class="settle-row">
        <div class="settle-who">
          <span class="pill pill-red">${t.from}</span>
          <span style="font-size:12px;color:#73726c">owes</span>
          <span class="pill pill-green">${t.to}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="settle-amount">${fmtMoney(t.amt)}</span>
          <button class="btn-primary" style="font-size:12px;padding:5px 10px" onclick="markSettled('${t.fromId}','${t.toId}',${t.amt.toFixed(2)})">Mark paid</button>
        </div>
      </div>`).join('');
  }

  const balEl = document.getElementById('balances-list');
  if (state.members.length === 0) {
    balEl.innerHTML = '<div class="empty-state">No members yet.</div>';
  } else {
    balEl.innerHTML = state.members.map(m => {
      const b = bal[m.id] || 0;
      const av = avatarColor(m.name);
      let badge = '';
      if (Math.abs(b) < 0.01) badge = '<span class="pill pill-gray">settled</span>';
      else if (b > 0) badge = `<span class="pill pill-green">gets back ${fmtMoney(b)}</span>`;
      else badge = `<span class="pill pill-red">owes ${fmtMoney(b)}</span>`;
      return `<div class="settle-row">
        <div class="member-info">
          <div class="avatar" style="background:${av.bg};color:${av.color}">${initials(m.name)}</div>
          <span style="font-size:14px;font-weight:500">${m.name}</span>
        </div>
        ${badge}
      </div>`;
    }).join('');
  }
}

// ===== Members Tab =====
function renderMembers() {
  const bal = computeBalances();
  const el = document.getElementById('members-list');
  if (state.members.length === 0) {
    el.innerHTML = '<div class="empty-state">No members yet. Add people who share expenses.</div>';
    return;
  }
  el.innerHTML = state.members.map(m => {
    const b = bal[m.id] || 0;
    const av = avatarColor(m.name);
    const balText = Math.abs(b) < 0.01 ? 'settled' : b > 0 ? `gets back ${fmtMoney(b)}` : `owes ${fmtMoney(b)}`;
    return `<div class="member-row">
      <div class="member-info">
        <div class="avatar" style="background:${av.bg};color:${av.color}">${initials(m.name)}</div>
        <div>
          <div class="member-name">${m.name}</div>
          <div class="member-balance">${balText}</div>
        </div>
      </div>
      <button class="btn-danger" onclick="removeMember('${m.id}')">Remove</button>
    </div>`;
  }).join('');
}

// ============================================================
// Actions
// ============================================================
async function submitExpense(withReceipt) {
  const desc = document.getElementById('exp-desc')?.value?.trim();
  const amount = parseFloat(document.getElementById('exp-amount')?.value || '0');
  const paidBy = document.getElementById('exp-payer')?.value;
  const category = document.getElementById('exp-cat')?.value;
  if (!desc || !amount || !paidBy) { alert('Please fill in description, amount, and payer.'); return; }

  const checks = document.querySelectorAll('[name^="split_"]');
  const splitees = [...checks].filter(c => c.checked).map(c => c.value);
  if (!splitees.length) { alert('Select at least one person to split with.'); return; }

  const perPerson = amount / splitees.length;
  const splits = {};
  splitees.forEach(id => splits[id] = perPerson);
  const items = (state.scanResult && state.scanResult.items) || [];
  const expId = uid();

  state.expenses.unshift({ id: expId, desc, amount, paidBy, category, splits, items, date: new Date().toISOString() });

  if (withReceipt && state.scanImageB64) {
    const fileId = await uploadReceiptToDrive(expId, state.scanImageB64);
    if (fileId) state.receiptFileIds[expId] = fileId;
  }

  resetScanner();
  document.getElementById('scanner-panel').classList.add('hidden');
  document.getElementById('manual-panel').classList.add('hidden');
  await saveDataToDrive();
  renderAll();
}

async function removeExpense(id) {
  if (!confirm('Remove this expense?')) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  delete state.receiptFileIds[id];
  await saveDataToDrive();
  renderAll();
}

async function markSettled(fromId, toId, amt) {
  const splits = {}; splits[fromId] = amt;
  state.expenses.unshift({ id: uid(), desc: 'Settlement', amount: amt, paidBy: toId, category: '📦 Other', splits, date: new Date().toISOString(), isSettlement: true });
  await saveDataToDrive();
  renderAll();
}

async function addMember(name) {
  if (!name.trim()) return;
  state.members.push({ id: uid(), name: name.trim() });
  await saveDataToDrive();
  renderAll();
}

async function removeMember(id) {
  const used = state.expenses.some(e => e.paidBy === id || Object.keys(e.splits || {}).includes(id));
  if (used) { alert('Cannot remove — this member has recorded expenses.'); return; }
  if (!confirm('Remove this member?')) return;
  state.members = state.members.filter(m => m.id !== id);
  await saveDataToDrive();
  renderAll();
}

async function viewReceipt(expId) {
  const fileId = state.receiptFileIds[expId];
  const exp = state.expenses.find(e => e.id === expId);
  const viewer = document.getElementById('receipt-viewer');
  const title = document.getElementById('receipt-viewer-title');
  const details = document.getElementById('receipt-viewer-details');
  const imgEl = document.getElementById('receipt-viewer-img');

  title.textContent = exp ? exp.desc : 'Receipt';
  details.innerHTML = exp ? `
    <div class="card" style="padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:500;font-size:15px">${exp.desc}</div>
          <div style="font-size:12px;color:#73726c">${exp.category || ''} · ${fmtDate(exp.date)}</div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:600">${fmtMoney(exp.amount)}</div>
      </div>
      ${exp.items && exp.items.length ? `
      <div class="divider"></div>
      <div class="extracted-items">
        <div style="font-size:11px;color:#73726c;font-weight:500;margin-bottom:6px">AI EXTRACTED ITEMS</div>
        ${exp.items.map(it => `<div class="extracted-item"><span>${it.desc}</span><span style="font-family:'DM Mono',monospace">RM ${parseFloat(it.price || 0).toFixed(2)}</span></div>`).join('')}
      </div>` : ''}
    </div>` : '';

  imgEl.innerHTML = '<div class="empty-state">Loading receipt from Google Drive...</div>';
  viewer.classList.remove('hidden');
  document.getElementById('tab-expenses').classList.add('hidden');

  if (fileId) {
    const url = await getReceiptUrl(fileId);
    imgEl.innerHTML = `<img src="${url}" alt="Receipt" style="width:100%;border-radius:10px;border:0.5px solid rgba(0,0,0,0.08);margin-top:12px">`;
  } else {
    imgEl.innerHTML = '<div class="empty-state">Receipt image not found.</div>';
  }
}

function closeReceipt() {
  document.getElementById('receipt-viewer').classList.add('hidden');
  document.getElementById('tab-expenses').classList.remove('hidden');
}

function resetScanner() {
  state.scanResult = null;
  state.scanImageB64 = null;
  state.scanImagePreview = null;
  state.scanning = false;
}

// ============================================================
// UI helpers
// ============================================================
function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function showSync(msg) {
  const bar = document.getElementById('sync-bar');
  document.getElementById('sync-msg').textContent = msg;
  bar.classList.remove('hidden');
}

function hideSync() {
  document.getElementById('sync-bar').classList.add('hidden');
}

// ============================================================
// Event Listeners
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initGoogle();

  // Sign in button
  document.getElementById('signin-btn').addEventListener('click', () => {
    const btn = document.getElementById('signin-btn');
    if (!tokenClient) {
      showAuthError('Google sign-in is still loading. Please wait a moment and try again.');
      return;
    }
    btn.textContent = 'Opening sign-in...';
    btn.disabled = true;
    try {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      console.error('requestAccessToken error:', e);
      showAuthError('Could not open sign-in popup. Make sure popups are not blocked for this site.');
    }
    setTimeout(() => {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg> Sign in with Google`;
      btn.disabled = false;
    }, 6000);
  });

  // Sign out
  document.getElementById('signout-btn').addEventListener('click', signOut);

  // Group name rename
  document.getElementById('group-name-display').addEventListener('click', async () => {
    const n = prompt('Group name:', state.groupName);
    if (n && n.trim()) {
      state.groupName = n.trim();
      document.getElementById('group-name-display').textContent = state.groupName;
      await saveDataToDrive();
      renderStats();
    }
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
    });
  });

  // Scan button
  document.getElementById('scan-btn').addEventListener('click', () => {
    resetScanner();
    document.getElementById('manual-panel').classList.add('hidden');
    const panel = document.getElementById('scanner-panel');
    panel.classList.toggle('hidden');
    renderScannerPanel();
  });

  // Manual button
  document.getElementById('manual-btn').addEventListener('click', () => {
    document.getElementById('scanner-panel').classList.add('hidden');
    const panel = document.getElementById('manual-panel');
    panel.classList.toggle('hidden');
    document.getElementById('manual-form').innerHTML = buildManualForm();
  });

  // Cancel scan
  document.getElementById('cancel-scan-btn').addEventListener('click', () => {
    resetScanner();
    document.getElementById('scanner-panel').classList.add('hidden');
  });

  // Cancel manual
  document.getElementById('cancel-manual-btn').addEventListener('click', () => {
    document.getElementById('manual-panel').classList.add('hidden');
  });

  // Save manual
  document.getElementById('save-manual-btn').addEventListener('click', () => submitExpense(false));

  // File input / drag-drop
  const fileInput = document.getElementById('receipt-file');
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
  });
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  });

  // Add member
  document.getElementById('add-member-btn').addEventListener('click', () => {
    document.getElementById('add-member-panel').classList.toggle('hidden');
    document.getElementById('new-member-input').focus();
  });
  document.getElementById('cancel-member-btn').addEventListener('click', () => {
    document.getElementById('add-member-panel').classList.add('hidden');
  });
  document.getElementById('save-member-btn').addEventListener('click', () => {
    const inp = document.getElementById('new-member-input');
    if (inp.value.trim()) {
      addMember(inp.value.trim());
      inp.value = '';
      document.getElementById('add-member-panel').classList.add('hidden');
    }
  });
  document.getElementById('new-member-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('save-member-btn').click();
  });

  // Close receipt viewer
  document.getElementById('close-receipt-btn').addEventListener('click', closeReceipt);
});

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    state.scanImagePreview = dataUrl;
    state.scanImageB64 = dataUrl.split(',')[1];
    scanReceipt(state.scanImageB64);
  };
  reader.readAsDataURL(file);
}

// Expose globals for inline onclick handlers
window.submitExpense = submitExpense;
window.removeExpense = removeExpense;
window.markSettled = markSettled;
window.removeMember = removeMember;
window.viewReceipt = viewReceipt;
window.resetScanner = resetScanner;

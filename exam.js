/**
 * VSAT – exam.js  v7.0
 *
 * NGÂN HÀNG CÂU HỎI: Lưu theo môn học + loại câu hỏi
 *   bank = [{ id, type, question, subject, ...fields }]
 *   subject: "Toán", "Vật Lý", "Hóa Học", ...
 *
 * PDF IMPORT: PDF → parse → JSON → lưu kho đề + ngân hàng
 *
 * SCORING:
 *   MCQ     : đúng=6đ, sai=0đ
 *   TF      : 1đúng→1đ, 2→2đ, 3→3đ, 4→6đ
 *   Matching: floor(đúng/n × 6)
 *   Short   : đúng=6đ, sai=0đ
 */

// ══════════════════════════════════════════
//  STORAGE KEYS
// ══════════════════════════════════════════
const LS_BANK    = 'vsat_bank_v2';   // v2: có field subject
const LS_CONFIG  = 'vsat_config_v1';
const LS_HISTORY = 'vsat_history_v1';
const LS_SETS    = 'vsat_sets_v1';

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let examData      = null;
let answers       = [];
let answerKey     = [];
let currentIdx    = 0;
let timerInterval = null;
let timeLeft      = 0;
let currentTheme  = 'real';
let studentInfo   = { username: '', subject: '' };

let bank   = [];   // [{ id, type, question, subject, ...}]
let sets   = [];   // [{ id, name, time, subject, questions[], createdAt }]
let config = { mcq: 9, truefalse: 11, short: 5, matching: 0, time: 90, subject: '' };
let bankEditIdx = -1;
let _pendingSetSave = null;

// ══════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function escH(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
const pad  = n => String(n).padStart(2,'0');
const ALPHA = ['A','B','C','D','E','F','G','H'];

const SUBJECTS = ['Toán','Ngữ Văn','Vật Lý','Hóa Học','Sinh Học','Lịch Sử','Địa Lý','Khác'];

function typeFull(t) {
  return {mcq:'Trắc nghiệm',truefalse:'Đúng/Sai',short:'Trả lời ngắn',matching:'Ghép cột'}[t] || t;
}
function typeShort(t) {
  return {mcq:'TN',truefalse:'Đ/S',short:'TLN',matching:'Ghép'}[t] || t;
}

// Lấy danh sách môn có trong ngân hàng
function getBankSubjects() {
  const s = new Set(bank.map(q => q.subject || 'Khác'));
  return [...s].sort();
}

// ══════════════════════════════════════════
//  LATEX / KATEX
// ══════════════════════════════════════════
function renderMathHTML(str) {
  if (!str) return '';
  if (!window.katex) return `<span class="math-pending">${escH(str)}</span>`;
  const parts = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
  let lastIdx = 0, match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(str)) !== null) {
    if (match.index > lastIdx) parts.push({type:'text', val: str.slice(lastIdx, match.index)});
    parts.push({type:'math', val: match[0]});
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < str.length) parts.push({type:'text', val: str.slice(lastIdx)});
  if (!parts.length) return escH(str);
  return parts.map(p => {
    if (p.type === 'text') return escH(p.val);
    const isDisplay = p.val.startsWith('$$') || p.val.startsWith('\\[');
    let inner = p.val;
    if (inner.startsWith('$$'))    inner = inner.slice(2,-2);
    else if (inner.startsWith('$'))  inner = inner.slice(1,-1);
    else if (inner.startsWith('\\[')) inner = inner.slice(2,-2);
    else if (inner.startsWith('\\(')) inner = inner.slice(2,-2);
    try {
      return katex.renderToString(inner.trim(), {
        throwOnError:false, displayMode:isDisplay, output:'html', trust:false, strict:false,
        macros:{'\\R':'\\mathbb{R}','\\N':'\\mathbb{N}','\\Z':'\\mathbb{Z}','\\vec':'\\overrightarrow'}
      });
    } catch { return escH(p.val); }
  }).join('');
}

function rerenderPendingMath() {
  document.querySelectorAll('.math-pending').forEach(el => {
    const raw = el.textContent;
    const tmp = document.createElement('span');
    tmp.innerHTML = renderMathHTML(raw);
    el.replaceWith(...tmp.childNodes);
  });
}
document.addEventListener('katex-ready', rerenderPendingMath);

// ══════════════════════════════════════════
//  LOCAL STORAGE
// ══════════════════════════════════════════
function loadLS() {
  try { bank = JSON.parse(localStorage.getItem(LS_BANK)) || []; } catch { bank = []; }
  // Migrate v1 bank: thêm subject nếu thiếu
  bank = bank.map(q => ({ subject: 'Toán', ...q }));
  try { sets = JSON.parse(localStorage.getItem(LS_SETS)) || []; } catch { sets = []; }
  try {
    const c = JSON.parse(localStorage.getItem(LS_CONFIG));
    if (c) config = { ...config, ...c };
  } catch {}
}
function saveBank()   { localStorage.setItem(LS_BANK,   JSON.stringify(bank)); }
function saveSets()   { localStorage.setItem(LS_SETS,   JSON.stringify(sets)); }
function saveConfig() { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }
function loadHistory() { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; } }
function saveHistory(h) { localStorage.setItem(LS_HISTORY, JSON.stringify(h)); }

// ══════════════════════════════════════════
//  FIREBASE
// ══════════════════════════════════════════
const FB_CONFIG = {
  apiKey:            "AIzaSyDE1CrLybblFqy3k6Yec0wmsIvW3JfW51Y",
  authDomain:        "vset-75fb5.firebaseapp.com",
  projectId:         "vset-75fb5",
  storageBucket:     "vset-75fb5.firebasestorage.app",
  messagingSenderId: "807067750847",
  appId:             "1:807067750847:web:ae37b9d1f271d37e7e510a"
};
let _db = null, _auth = null, _fbReady = false, _currentUser = null;

function setFbStatus(state, msg) {
  const el = document.getElementById('fb-sync-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'fb-sync-status fb-' + state;
}
function _invalidateSetsListCache() { localStorage.removeItem('vsat_fb_sets_list'); }

function initFirebase() {
  if (_fbReady) return true;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    _db   = firebase.firestore();
    _auth = firebase.auth();
    _fbReady = true;
    _auth.onAuthStateChanged(user => { _currentUser = user; updateGoogleUserUI(); });
    return true;
  } catch(e) { console.error('[Firebase]', e); return false; }
}

function updateGoogleUserUI() {
  const infoEl = document.getElementById('google-user-info');
  const btn    = document.getElementById('google-login-btn');
  if (!infoEl || !btn) return;
  if (_currentUser) {
    infoEl.classList.remove('hidden');
    infoEl.innerHTML = `<img src="${_currentUser.photoURL||''}" class="google-avatar" onerror="this.style.display='none'"/>
      <span>${escH(_currentUser.displayName||_currentUser.email)}</span>
      <button class="google-logout-btn" onclick="googleLogout()">Đăng xuất</button>`;
    btn.textContent = '✓ Đã đăng nhập Google';
    btn.style.opacity = '0.6';
    const uInput = document.getElementById('login-username');
    if (uInput && !uInput.value.startsWith('VKOD'))
      uInput.value = _currentUser.displayName || _currentUser.email.split('@')[0];
  } else {
    infoEl.classList.add('hidden');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Đăng nhập bằng Google`;
    btn.style.opacity = '1';
  }
}

async function googleLogin() {
  try {
    if (!initFirebase()) return;
    await _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') showToast('⚠️ Đăng nhập Google thất bại: ' + e.message, true);
  }
}
async function googleLogout() {
  try { if (_auth) await _auth.signOut(); } catch(e) {}
}

function compressImage(base64, quality=0.72, maxW=900) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w=img.width, h=img.height;
      if (w>maxW) { h=Math.round(h*maxW/w); w=maxW; }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      resolve(c.toDataURL('image/jpeg',quality));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

async function saveSetToFirebase(setObj, onProgress) {
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const { id:setId, name, time, subject, questions, createdAt } = setObj;
  const total = questions.length;
  const withImages = questions.filter(q => q.image);
  onProgress && onProgress(0, total, `🗜️ Nén ${withImages.length} ảnh...`);
  for (let i=0; i<withImages.length; i++) {
    try { withImages[i].image = await compressImage(withImages[i].image, 0.60, 800); } catch {}
    onProgress && onProgress(i+1, withImages.length, `🗜️ Nén ảnh ${i+1}/${withImages.length}`);
  }
  const byType = {mcq:0,truefalse:0,short:0,matching:0};
  questions.forEach(q => { if (byType[q.type]!==undefined) byType[q.type]++; });
  const meta = { id:setId, name, time:time||90, subject:subject||'Toán',
    createdAt:createdAt||Date.now(), questionCount:questions.length, byType, updatedAt:Date.now() };
  onProgress && onProgress(0, total, '💾 Lưu lên Firestore...');
  await _db.collection('sets').doc(setId).set(meta);
  const BATCH = 400;
  for (let i=0; i<questions.length; i+=BATCH) {
    const batch = _db.batch();
    questions.slice(i,i+BATCH).forEach((q,bi) => {
      batch.set(_db.collection('sets').doc(setId).collection('questions').doc(q.id), {...q, _order:i+bi});
    });
    await batch.commit();
    onProgress && onProgress(Math.min(i+BATCH,total), total, `💾 ${Math.min(i+BATCH,total)}/${total} câu`);
  }
  try {
    const cached = JSON.parse(localStorage.getItem('vsat_fb_sets_list')) || {data:[]};
    const list = cached.data || [];
    const idx = list.findIndex(s => s.id===setId);
    if (idx>=0) list[idx]=meta; else list.unshift(meta);
    localStorage.setItem('vsat_fb_sets_list', JSON.stringify({ts:Date.now(), data:list}));
  } catch {}
  return {...meta, questions};
}

async function fetchSetsList(forceRefresh=false) {
  if (!forceRefresh) {
    try {
      const c = JSON.parse(localStorage.getItem('vsat_fb_sets_list'));
      if (c && c.ts && Date.now()-c.ts < 5*60*1000) return c.data;
    } catch {}
  }
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const snap = await _db.collection('sets').orderBy('createdAt','desc').get();
  const list = snap.docs.map(d => d.data());
  localStorage.setItem('vsat_fb_sets_list', JSON.stringify({ts:Date.now(), data:list}));
  return list;
}

async function fetchSetFull(setId) {
  const cacheKey = 'vsat_fb_cache_' + setId;
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey));
    if (c && c.ts && Date.now()-c.ts < 30*60*1000) return c.data;
  } catch {}
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const metaDoc = await _db.collection('sets').doc(setId).get();
  if (!metaDoc.exists) throw new Error('Bộ đề không tồn tại');
  const qSnap = await _db.collection('sets').doc(setId).collection('questions').get();
  const questions = qSnap.docs.map(d=>d.data()).sort((a,b)=>(a._order??999)-(b._order??999));
  const fullSet = {...metaDoc.data(), questions};
  localStorage.setItem(cacheKey, JSON.stringify({ts:Date.now(), data:fullSet}));
  return fullSet;
}

async function deleteSetFromFirebase(setId) {
  if (!initFirebase()) return;
  try {
    const qSnap = await _db.collection('sets').doc(setId).collection('questions').get();
    const batch = _db.batch();
    qSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await _db.collection('sets').doc(setId).delete();
    localStorage.removeItem('vsat_fb_cache_' + setId);
    _invalidateSetsListCache();
  } catch(e) { console.warn('[Firebase] deleteSet:', e); }
}

async function syncSetsFromFirebase() {
  try {
    const list = await fetchSetsList();
    const oldSets = sets;
    sets = list.map(s => {
      const existing = oldSets.find(x => x.id===s.id);
      return {...s, questions: existing?.questions || s.questions || [], _fromFirebase:true};
    });
    saveSets();
    return true;
  } catch(e) { console.warn('[Firebase] sync failed:', e.message); return false; }
}

async function ensureSetQuestions(setId) {
  const s = sets.find(x => x.id===setId);
  if (!s) return null;
  if (s.questions && s.questions.length > 0) return s.questions;
  const full = await fetchSetFull(setId);
  s.questions = full.questions;
  saveSets();
  return s.questions;
}

async function _initFirebaseSync(forceRefresh=false) {
  setFbStatus('uploading','⏳ Kết nối Firebase...');
  try {
    if (forceRefresh) {
      _invalidateSetsListCache();
      Object.keys(localStorage).filter(k=>k.startsWith('vsat_fb_cache_')).forEach(k=>localStorage.removeItem(k));
    }
    const ok = await syncSetsFromFirebase();
    if (ok) {
      setFbStatus('ok', `☁️ ${sets.length} đề`);
      renderSets();
      populateExamModeSelect();
    } else {
      setFbStatus('error','⚠️ Offline');
    }
  } catch(e) {
    setFbStatus('error','⚠️ Lỗi Firebase');
    console.error('[Firebase]', e);
  }
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadLS();

  // Dashboard nav
  document.querySelectorAll('.dnav').forEach(btn =>
    btn.addEventListener('click', () => switchDashPanel(btn.dataset.panel))
  );
  document.getElementById('dash-start-btn').addEventListener('click', gotoLogin);

  // Sets panel
  document.getElementById('sets-import-btn').addEventListener('click', () =>
    document.getElementById('sets-file-input').click()
  );
  document.getElementById('sets-file-input').addEventListener('change', handleSetsImport);
  document.getElementById('sets-pdf-btn').addEventListener('click', () => {
    _setsImportMode = true;
    openPdfImportModal(true);
  });
  document.getElementById('sets-refresh-btn').addEventListener('click', () => {
    _invalidateSetsListCache();
    _initFirebaseSync(true);
  });

  // Set name modal
  document.getElementById('set-name-close').addEventListener('click', closeSetNameModal);
  document.getElementById('set-name-cancel').addEventListener('click', closeSetNameModal);
  document.getElementById('set-name-confirm').addEventListener('click', confirmSetName);
  document.getElementById('set-name-input').addEventListener('keydown', e => {
    if (e.key==='Enter') confirmSetName();
  });

  // Bank panel
  document.getElementById('bank-import-btn').addEventListener('click', () =>
    document.getElementById('bank-file-input').click()
  );
  document.getElementById('bank-file-input').addEventListener('change', handleBankImport);
  document.getElementById('bank-clear-btn').addEventListener('click', clearBank);
  document.getElementById('bank-export-btn').addEventListener('click', exportBankAsJSON);
  document.getElementById('bank-filter-type').addEventListener('change', renderBankList);
  document.getElementById('bank-filter-subject').addEventListener('change', renderBankList);
  document.getElementById('bank-search').addEventListener('input', renderBankList);
  // bank-pdf-btn handler is registered in pdf-import.js initPdfImport()
  // But we need to set _setsImportMode = false before opening
  document.getElementById('bank-pdf-btn').addEventListener('click', () => {
    _setsImportMode = false;
    openPdfImportModal(false);
  });

  // Config panel
  ['cfg-mcq','cfg-tf','cfg-short','cfg-match'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateConfigTotal)
  );
  document.getElementById('config-save-btn').addEventListener('click', saveConfigFromUI);
  document.getElementById('cfg-subject-filter').addEventListener('change', renderConfigTab);

  // History
  document.getElementById('hist-clear-btn').addEventListener('click', () => {
    if (confirm('Xóa toàn bộ lịch sử làm bài?')) { saveHistory([]); renderHistory(); }
  });

  // Bank edit modal
  document.getElementById('bank-edit-close').addEventListener('click', closeBankEdit);
  document.getElementById('bank-edit-cancel').addEventListener('click', closeBankEdit);
  document.getElementById('bank-edit-save').addEventListener('click', saveBankEdit);

  // Set question editor modals
  document.getElementById('set-qlist-close').addEventListener('click', closeSetQList);
  document.getElementById('set-qlist-cancel').addEventListener('click', closeSetQList);
  document.getElementById('set-qedit-close').addEventListener('click', closeSetQEdit);
  document.getElementById('set-qedit-cancel').addEventListener('click', closeSetQEdit);
  document.getElementById('set-qedit-save').addEventListener('click', saveSetQEdit);

  // Login
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('google-login-btn').addEventListener('click', googleLogin);
  document.getElementById('file-input-login').addEventListener('change', handleFileInputLogin);
  document.getElementById('file-input-login-pdf').addEventListener('change', handlePdfLoginInput);
  document.getElementById('back-to-dash-btn').addEventListener('click', () => showScreen('dashboard-screen'));

  // Exam
  document.getElementById('submit-btn-top').addEventListener('click', openSubmitModal);
  document.getElementById('modal-cancel').addEventListener('click', closeSubmitModal);
  document.getElementById('modal-confirm').addEventListener('click', submitExam);
  document.getElementById('prev-btn').addEventListener('click', () => navigateDot(-1));
  document.getElementById('next-btn').addEventListener('click', () => navigateDot(1));
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

  // Result
  document.getElementById('restart-btn').addEventListener('click', gotoLogin);
  document.getElementById('goto-dash-btn').addEventListener('click', gotoDashboard);
  document.getElementById('btn-show-answers').addEventListener('click', toggleAnswerDisplay);
  document.getElementById('adp-close').addEventListener('click', toggleAnswerDisplay);
  document.getElementById('btn-edit-answers').addEventListener('click', openAnswerEditor);
  document.getElementById('answer-editor-close').addEventListener('click', closeAnswerEditor);
  document.getElementById('answer-editor-cancel').addEventListener('click', closeAnswerEditor);
  document.getElementById('answer-editor-save').addEventListener('click', saveAnswerKey);

  // Render initial
  renderSets();
  renderBankList();
  renderConfigTab();
  renderHistory();
  populateSubjectFilters();

  setTimeout(() => {
    initFirebase();
    _initFirebaseSync();
  }, 500);
});

// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
function toggleTheme() {
  currentTheme = currentTheme==='real' ? 'galaxy' : 'real';
  document.documentElement.setAttribute('data-theme', currentTheme);
  document.getElementById('theme-icon').textContent  = currentTheme==='galaxy' ? '🌞' : '🌌';
  document.getElementById('theme-label').textContent = currentTheme==='galaxy' ? 'Thi thật' : 'Galaxy';
}

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id==='exam-screen') setTimeout(initScrollObserver, 150);
}
function switchDashPanel(panelId) {
  document.querySelectorAll('.dnav').forEach(b => b.classList.toggle('active', b.dataset.panel===panelId));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.toggle('active', p.id===panelId));
  if (panelId==='panel-sets')    renderSets();
  if (panelId==='panel-bank')    { populateSubjectFilters(); renderBankList(); }
  if (panelId==='panel-config')  renderConfigTab();
  if (panelId==='panel-history') renderHistory();
}

function gotoLogin() {
  updateLoginBadge();
  populateExamModeSelect();
  showScreen('login-screen');
  const code = 'VKOD' + Math.floor(10000 + Math.random()*90000);
  const pass  = String(Math.floor(10000000 + Math.random()*90000000));
  document.getElementById('info-account').textContent  = code;
  document.getElementById('info-password').textContent = pass;
  document.getElementById('login-username').value = code;
  document.getElementById('draw-error').classList.add('hidden');
  document.getElementById('login-error').classList.add('hidden');
}

function populateExamModeSelect() {
  const sel = document.getElementById('login-exam-mode');
  sel.innerHTML = `<option value="random">🎲 Bốc ngẫu nhiên từ ngân hàng</option>`;
  sets.forEach(s => {
    const cnt = s.questions ? s.questions.length : 0;
    const opt = document.createElement('option');
    opt.value = `set:${s.id}`;
    opt.textContent = `📄 ${s.name} (${cnt} câu)`;
    sel.appendChild(opt);
  });
}

function onExamModeChange() {}

function gotoDashboard() {
  clearInterval(timerInterval);
  examData=null; answers=[]; answerKey=[]; currentIdx=0;
  renderBankList(); renderHistory();
  showScreen('dashboard-screen');
}

function updateLoginBadge() {
  const badge = document.getElementById('bank-status-badge');
  if (!bank.length) { badge.classList.add('hidden'); return; }
  const cnt = countByType();
  badge.classList.remove('hidden');
  badge.innerHTML = `📚 Ngân hàng: <b>${bank.length}</b> câu &nbsp;·&nbsp; TN: <b>${cnt.mcq}</b> &nbsp;·&nbsp; Đ/S: <b>${cnt.truefalse}</b> &nbsp;·&nbsp; TLN: <b>${cnt.short}</b> &nbsp;·&nbsp; Ghép: <b>${cnt.matching}</b>`;
}

function countByType(filterSubject='') {
  const c = {mcq:0, truefalse:0, short:0, matching:0};
  bank.filter(q => !filterSubject || (q.subject||'Khác')===filterSubject)
      .forEach(q => { if (c[q.type]!==undefined) c[q.type]++; });
  return c;
}

// Populate subject dropdowns
function populateSubjectFilters() {
  const subjects = getBankSubjects();
  const selectors = ['bank-filter-subject','cfg-subject-filter'];
  selectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">Tất cả môn</option>`;
    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s===cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
  // Also update set-subject-input
  const setSubSel = document.getElementById('set-subject-input');
  if (setSubSel) {
    const cur = setSubSel.value;
    setSubSel.innerHTML = '';
    SUBJECTS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s===cur) opt.selected = true;
      setSubSel.appendChild(opt);
    });
  }
}

// ══════════════════════════════════════════
//  LOGIN / FILE INPUT
// ══════════════════════════════════════════
async function handleLogin() {
  const user    = document.getElementById('login-username').value.trim();
  const pass    = document.getElementById('login-password').value.trim();
  const subject = document.getElementById('login-subject').value;
  const mode    = document.getElementById('login-exam-mode').value;
  const errEl   = document.getElementById('login-error');
  const drawErr = document.getElementById('draw-error');

  drawErr.classList.add('hidden');
  if (!user || !pass) {
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 3000);
    return;
  }
  errEl.classList.add('hidden');
  studentInfo = { username: user, subject };

  if (mode.startsWith('set:')) {
    const setId = mode.slice(4);
    const examSet = sets.find(s => s.id===setId);
    if (!examSet) {
      drawErr.textContent = '⚠️ Không tìm thấy bộ đề này.';
      drawErr.classList.remove('hidden');
      return;
    }
    let questions = examSet.questions || examSet._cachedQuestions;
    if (!questions || !questions.length) {
      drawErr.textContent = '⏳ Đang tải câu hỏi từ Firebase...';
      drawErr.classList.remove('hidden');
      try {
        questions = await ensureSetQuestions(setId);
        drawErr.classList.add('hidden');
      } catch(e) {
        drawErr.textContent = '⚠️ Không tải được câu hỏi: ' + e.message;
        return;
      }
    }
    startExam({ title:`${examSet.name} – ${user}`, time:examSet.time||config.time, questions });
    return;
  }

  // Bốc ngẫu nhiên từ ngân hàng
  const drawn = drawFromBank(subject);
  if (drawn === null) {
    drawErr.textContent = '⚠️ Ngân hàng trống hoặc không có câu hỏi phù hợp với môn đã chọn.';
    drawErr.classList.remove('hidden');
    return;
  }
  startExam({
    title: `${subject} – ${user} – ${new Date().toLocaleDateString('vi-VN')}`,
    time: config.time,
    questions: drawn
  });
}

function handleFileInputLogin(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      validateExamJSON(data);
      studentInfo = {
        username: document.getElementById('login-username').value.trim() || 'GUEST',
        subject:  document.getElementById('login-subject').value
      };
      startExam(data);
    } catch(err) {
      const el = document.getElementById('import-error');
      el.textContent = 'Lỗi file: ' + err.message;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 6000);
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function validateExamJSON(data) {
  if (!data.title)   throw new Error("Thiếu 'title'.");
  if (!data.time)    throw new Error("Thiếu 'time'.");
  if (!Array.isArray(data.questions) || !data.questions.length)
    throw new Error("'questions' trống hoặc không hợp lệ.");
  const valid = ['truefalse','mcq','matching','short'];
  data.questions.forEach((q,i) => {
    if (!valid.includes(q.type)) throw new Error(`Câu ${i+1}: type '${q.type}' không hợp lệ.`);
    if (!q.question)             throw new Error(`Câu ${i+1}: thiếu 'question'.`);
  });
}

// ── Tải PDF trực tiếp từ login screen → parse → thi luôn ──
async function handlePdfLoginInput(e) {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';

  const statusEl = document.getElementById('pdf-login-status');
  const msgEl    = document.getElementById('pdf-login-msg');
  const errEl    = document.getElementById('import-error');
  errEl.classList.add('hidden');
  statusEl.classList.remove('hidden');
  msgEl.textContent = '⏳ Đang đọc PDF...';

  try {
    // Dùng hàm từ pdf-import.js
    msgEl.textContent = '🔍 Đang phân tích câu hỏi...';
    const rawText = await extractTextAndRenderPDF(file);
    const questions = parseVSATText(rawText);

    if (!questions || !questions.length) {
      throw new Error('Không tìm thấy câu hỏi nào trong file PDF này.');
    }

    // Gán id cho từng câu
    questions.forEach(q => { if (!q.id) q.id = uid(); });

    msgEl.textContent = `✅ Đọc được ${questions.length} câu — đang vào thi...`;

    studentInfo = {
      username: document.getElementById('login-username').value.trim() || 'GUEST',
      subject:  document.getElementById('login-subject').value
    };

    // Thi luôn với đề từ PDF, thời gian lấy từ config
    setTimeout(() => {
      statusEl.classList.add('hidden');
      startExam({
        title: `${file.name.replace('.pdf','')} – ${studentInfo.username}`,
        time:  config.time,
        questions
      });
    }, 600);

  } catch(err) {
    statusEl.classList.add('hidden');
    errEl.textContent = '❌ ' + err.message;
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 8000);
  }
}

// ══════════════════════════════════════════
//  BANK DRAW (theo môn nếu có)
//  Logic: bốc TỐI ĐA số câu có thể từ ngân hàng.
//  Nếu ngân hàng có ít hơn số cần → bốc hết những gì có (không báo lỗi).
//  Chỉ báo lỗi khi pool hoàn toàn trống.
// ══════════════════════════════════════════
function drawFromBank(preferSubject='') {
  if (!bank.length) return null;

  // Lọc theo môn: config.subject ưu tiên hơn subject từ login
  const subjectFilter = config.subject || preferSubject || '';
  const pool = subjectFilter
    ? bank.filter(q => (q.subject||'Khác')===subjectFilter)
    : bank;

  if (!pool.length) return null;

  const byType = {mcq:[], truefalse:[], short:[], matching:[]};
  pool.forEach(q => { if (byType[q.type]) byType[q.type].push(q); });

  // Số câu cần bốc theo config — nếu ngân hàng có ít hơn thì bốc hết
  const need = {
    mcq:       config.mcq,
    truefalse: config.truefalse,
    short:     config.short,
    matching:  config.matching
  };

  const shuffle = arr => [...arr].sort(() => Math.random() - .5);
  let qs = [];
  ['truefalse','mcq','matching','short'].forEach(t => {
    const want = need[t] || 0;
    if (want <= 0) return;
    const available = byType[t];
    // Bốc min(want, available.length) — không báo lỗi khi thiếu
    const take = Math.min(want, available.length);
    if (take > 0) qs.push(...shuffle(available).slice(0, take));
  });

  if (!qs.length) return null;  // pool có câu nhưng không match loại nào cần

  return shuffle(qs);
}

// ══════════════════════════════════════════
//  START EXAM
// ══════════════════════════════════════════
function startExam(data) {
  examData   = data;
  currentIdx = 0;
  answers = data.questions.map(q => {
    if (q.type==='truefalse') return new Array(q.statements.length).fill(null);
    if (q.type==='matching')  return new Array(q.left.length).fill(null);
    return null;
  });
  answerKey = data.questions.map(q => {
    if (q.type==='truefalse') return Array.isArray(q.answers) ? [...q.answers] : new Array(q.statements.length).fill(null);
    if (q.type==='matching')  return Array.isArray(q.answers) ? q.answers.map(v => v!==null&&v!==undefined ? Number(v) : null) : new Array(q.left.length).fill(null);
    if (q.type==='mcq')       return (q.answer!==undefined && q.answer!==null) ? Number(q.answer) : null;
    if (q.type==='short')     return (q.answer!==undefined && q.answer!==null) ? String(q.answer).trim() : null;
    return null;
  });
  document.getElementById('exam-title').textContent = data.title;
  timeLeft = data.time * 60;
  updateTimerDisplay();
  startTimer();
  renderAllQuestions();
  buildBottomDots();
  showScreen('exam-screen');
  scrollToQuestion(0);
  if (window.katex) setTimeout(rerenderPendingMath, 100);
  else document.addEventListener('katex-ready', rerenderPendingMath, {once:true});
}

// ══════════════════════════════════════════
//  RENDER QUESTIONS
// ══════════════════════════════════════════
function renderAllQuestions() {
  const body = document.getElementById('exam-body');
  body.innerHTML = '';
  examData.questions.forEach((q,i) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.id = `q-block-${i}`;
    block.innerHTML = `
      <div class="q-block-header">
        <span class="q-block-title">Câu ${i+1}
          <span style="font-size:.7rem;opacity:.75;font-weight:400">[${typeFull(q.type)}]</span>
        </span>
        <button class="q-pin-btn" data-idx="${i}">📌</button>
      </div>
      <div class="q-block-body">
        <div class="q-text">${renderMathHTML(q.question)}</div>
        ${q.image ? `<div class="q-img-wrap"><img src="${q.image}" class="q-img" alt="Hình vẽ câu ${i+1}"/></div>` : ''}
        ${buildAnswerHTML(q,i)}
      </div>`;
    body.appendChild(block);
  });
  examData.questions.forEach((q,i) => {
    if (q.type==='truefalse') attachTFListeners(i);
    if (q.type==='mcq')       attachMCQListeners(i);
    if (q.type==='matching')  attachMatchingListeners(i);
    if (q.type==='short')     attachShortListeners(i);
    document.querySelector(`.q-pin-btn[data-idx="${i}"]`).addEventListener('click', () => togglePin(i));
  });
}

function buildAnswerHTML(q,i) {
  if (q.type==='truefalse') return buildTFHTML(q,i);
  if (q.type==='mcq')       return buildMCQHTML(q,i);
  if (q.type==='matching')  return buildMatchingHTML(q,i);
  if (q.type==='short')     return buildShortHTML(q,i);
  return '';
}

function buildTFHTML(q,i) {
  const rows = q.statements.map((s,si) => {
    const dC = answers[i]?.[si]==='D' ? 'checked' : '';
    const sC = answers[i]?.[si]==='S' ? 'checked' : '';
    return `<tr>
      <td class="tf-cell"><input type="radio" class="tf-radio" name="tf_${i}_${si}" id="tf${i}_${si}_D" data-si="${si}" data-val="D" ${dC}/><label class="tf-label" for="tf${i}_${si}_D"></label></td>
      <td class="tf-cell"><input type="radio" class="tf-radio" name="tf_${i}_${si}" id="tf${i}_${si}_S" data-si="${si}" data-val="S" ${sC}/><label class="tf-label" for="tf${i}_${si}_S"></label></td>
      <td class="tf-stmt">${renderMathHTML(s)}</td>
    </tr>`;
  }).join('');
  return `<table class="tf-table"><thead><tr><th>Đúng</th><th>Sai</th><th>Mệnh đề</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function attachTFListeners(i) {
  document.getElementById(`q-block-${i}`).querySelectorAll('.tf-radio').forEach(r => {
    r.addEventListener('change', () => {
      if (!answers[i]) answers[i] = new Array(examData.questions[i].statements.length).fill(null);
      answers[i][+r.dataset.si] = r.dataset.val;
      updateDot(i);
    });
  });
}

function buildMCQHTML(q,i) {
  return `<div class="mcq-options">${q.options.map((opt,oi) => {
    const sel = answers[i]===String(oi) ? 'selected' : '';
    return `<input type="radio" class="mcq-option" name="mcq_${i}" value="${oi}" ${sel?'checked':''}/>
    <div class="mcq-row ${sel}" data-qi="${i}" data-oi="${oi}">
      <div class="mcq-radio-wrap"><div class="mcq-circle"></div></div>
      <div class="mcq-text-wrap">${ALPHA[oi]}. ${renderMathHTML(opt)}</div>
    </div>`;
  }).join('')}</div>`;
}
function attachMCQListeners(i) {
  document.getElementById(`q-block-${i}`).querySelectorAll('.mcq-row').forEach(row => {
    row.addEventListener('click', () => {
      answers[i] = String(row.dataset.oi);
      document.getElementById(`q-block-${i}`).querySelectorAll('.mcq-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      updateDot(i);
    });
  });
}

function buildMatchingHTML(q,i) {
  const leftRows  = q.left.map((it,li) => `<tr><td class="match-idx">${li+1}.</td><td>${renderMathHTML(it)}</td></tr>`).join('');
  const rightRows = q.right.map((it,ri) => `<tr><td class="match-key">${ALPHA[ri]}.</td><td>${renderMathHTML(it)}</td></tr>`).join('');
  const sels = q.left.map((_,li) => {
    const sv = answers[i]?.[li]!=null ? answers[i][li] : '';
    let opts = `<option value="">Chọn</option>`;
    q.right.forEach((_,ri) => opts += `<option value="${ri}" ${String(ri)===String(sv)?'selected':''}>${ALPHA[ri]}</option>`);
    return `<div class="match-label-item"><span class="match-label-text">Ý ${li+1}:</span>
      <select class="match-select ${sv!==''?'selected':''}" data-li="${li}">${opts}</select></div>`;
  }).join('');
  return `<div class="matching-tables">
    <div class="match-col"><div class="match-col-title">Cột trái</div><table class="match-table"><tbody>${leftRows}</tbody></table></div>
    <div class="match-col"><div class="match-col-title">Cột phải</div><table class="match-table"><tbody>${rightRows}</tbody></table></div>
  </div>
  <div class="matching-answer-section"><div class="matching-answer-label">Trả lời:</div><div class="matching-selects">${sels}</div></div>`;
}
function attachMatchingListeners(i) {
  document.getElementById(`q-block-${i}`).querySelectorAll('.match-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const li = +sel.dataset.li;
      if (!answers[i]) answers[i] = new Array(examData.questions[i].left.length).fill(null);
      answers[i][li] = sel.value!=='' ? +sel.value : null;
      sel.className = sel.value!=='' ? 'match-select selected' : 'match-select';
      updateDot(i);
    });
  });
}

function buildShortHTML(q,i) {
  const val = answers[i]!=null ? escH(String(answers[i])) : '';
  return `<div class="short-wrap"><div class="short-row">
    <span class="short-row-label">Trả lời:</span>
    <input type="text" class="short-input" id="short_${i}" value="${val}" placeholder="${escH(q.placeholder||'Nhập câu trả lời...')}" autocomplete="off"/>
  </div></div>`;
}
function attachShortListeners(i) {
  const inp = document.getElementById(`short_${i}`);
  if (inp) inp.addEventListener('input', () => { answers[i]=inp.value; updateDot(i); });
}

const pinnedSet = new Set();
function togglePin(i) {
  const btn = document.querySelector(`.q-pin-btn[data-idx="${i}"]`);
  pinnedSet.has(i) ? (pinnedSet.delete(i), btn.classList.remove('pinned'))
                   : (pinnedSet.add(i),    btn.classList.add('pinned'));
}

function isAnswered(i) {
  const a = answers[i];
  if (a===null || a===undefined) return false;
  if (Array.isArray(a)) return a.some(v => v!==null && v!==undefined);
  return String(a).trim()!=='';
}

// ══════════════════════════════════════════
//  BOTTOM DOTS / TIMER / SUBMIT
// ══════════════════════════════════════════
function buildBottomDots() {
  const c = document.getElementById('bottom-dots'); c.innerHTML='';
  examData.questions.forEach((_,i) => {
    const d = document.createElement('div');
    d.className = 'b-dot' + (i===0?' current':'');
    d.textContent = i+1; d.id = `bdot-${i}`;
    d.addEventListener('click', () => scrollToQuestion(i));
    c.appendChild(d);
  });
  updateNavBtns();
}
function updateDot(i) {
  const d = document.getElementById(`bdot-${i}`); if (!d) return;
  isAnswered(i) ? d.classList.add('answered') : d.classList.remove('answered');
}
function highlightCurrentDot() {
  document.querySelectorAll('.b-dot').forEach((d,i) => d.classList.toggle('current', i===currentIdx));
  const cur = document.getElementById(`bdot-${currentIdx}`);
  if (cur) cur.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
  updateNavBtns();
}
function updateNavBtns() {
  if (!examData) return;
  document.getElementById('prev-btn').disabled = currentIdx===0;
  document.getElementById('next-btn').disabled = currentIdx===examData.questions.length-1;
}
function scrollToQuestion(i) {
  currentIdx = i;
  const b = document.getElementById(`q-block-${i}`);
  if (b) b.scrollIntoView({behavior:'smooth', block:'start'});
  highlightCurrentDot();
}
function navigateDot(dir) {
  const n = currentIdx+dir;
  if (n>=0 && n<examData.questions.length) scrollToQuestion(n);
}
function initScrollObserver() {
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio>0.25) {
        const m = e.target.id.match(/^q-block-(\d+)$/);
        if (m && +m[1]!==currentIdx) { currentIdx=+m[1]; highlightCurrentDot(); }
      }
    });
  }, {threshold:0.25, rootMargin:'-46px 0px -50px 0px'});
  document.querySelectorAll('.question-block').forEach(b => obs.observe(b));
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft<=0) { clearInterval(timerInterval); submitExam(); }
  }, 1000);
}
function updateTimerDisplay() {
  const m=Math.floor(timeLeft/60), s=timeLeft%60;
  const box = document.getElementById('timer-box');
  box.textContent = `${pad(m)}:${pad(s)}`;
  box.classList.remove('warning','danger');
  if      (timeLeft<=60)  box.classList.add('danger');
  else if (timeLeft<=300) box.classList.add('warning');
}

function openSubmitModal() {
  const ua = answers.filter((_,i) => !isAnswered(i)).length;
  document.getElementById('modal-message').innerHTML = ua===0
    ? 'Bạn đã trả lời tất cả câu. Xác nhận nộp bài?'
    : `Còn <strong>${ua}</strong> câu chưa trả lời. Bạn có chắc muốn nộp không?`;
  document.getElementById('submit-modal').classList.remove('hidden');
}
function closeSubmitModal() { document.getElementById('submit-modal').classList.add('hidden'); }
function submitExam() { clearInterval(timerInterval); closeSubmitModal(); showResults(); }

// ══════════════════════════════════════════
//  SCORING
// ══════════════════════════════════════════
function calcScore(q, studentAns, keyAns) {
  if (q.type==='truefalse') {
    if (!Array.isArray(keyAns)) return null;
    if (!keyAns.some(v => v==='D'||v==='S')) return null;
    const n = keyAns.length;
    let correct = 0;
    for (let si=0; si<n; si++) {
      const student = Array.isArray(studentAns) ? studentAns[si] : null;
      if (student!==null && student!==undefined && keyAns[si]!==null && student===keyAns[si]) correct++;
    }
    if (correct===n) return 6;
    if (correct===3) return 3;
    if (correct===2) return 2;
    if (correct===1) return 1;
    return 0;
  }
  if (q.type==='mcq') {
    if (keyAns===null||keyAns===undefined) return null;
    if (studentAns===null||studentAns===undefined) return 0;
    return Number(studentAns)===Number(keyAns) ? 6 : 0;
  }
  if (q.type==='matching') {
    if (!Array.isArray(keyAns)||!keyAns.some(v=>v!==null&&v!==undefined)) return null;
    if (!Array.isArray(studentAns)) return 0;
    const n = keyAns.length;
    let correct = 0;
    for (let li=0; li<n; li++) {
      if (studentAns[li]!==null&&studentAns[li]!==undefined&&keyAns[li]!==null&&keyAns[li]!==undefined&&Number(studentAns[li])===Number(keyAns[li])) correct++;
    }
    return Math.floor((correct/n)*6);
  }
  if (q.type==='short') {
    if (keyAns===null||keyAns===undefined||String(keyAns).trim()==='') return null;
    if (studentAns===null||studentAns===undefined) return 0;
    const g = String(studentAns).trim().toLowerCase().replace(/,/g,'.');
    const e = String(keyAns).trim().toLowerCase().replace(/,/g,'.');
    return g===e ? 6 : 0;
  }
  return 0;
}

function hasAnyKey() {
  return answerKey.some(k => {
    if (k===null||k===undefined) return false;
    if (Array.isArray(k)) return k.some(v=>v==='D'||v==='S'||(v!==null&&v!==undefined));
    if (typeof k==='string') return k.trim()!=='';
    return true;
  });
}

// ══════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════
function showResults() {
  document.getElementById('result-sbd').textContent     = studentInfo.username||'GUEST';
  document.getElementById('result-subject').textContent = studentInfo.subject||'Toán';
  const answered = answers.filter((_,i) => isAnswered(i)).length;
  document.getElementById('result-answered').textContent = answered;
  document.getElementById('result-total').textContent    = examData.questions.length;
  document.getElementById('answer-display-panel').classList.add('hidden');
  renderScore();
  let total=0, possible=0;
  examData.questions.forEach((q,i) => {
    const pts = calcScore(q, answers[i], answerKey[i]);
    if (pts!==null) { total+=pts; possible+=6; }
  });
  const hist = loadHistory();
  hist.unshift({
    id:uid(), date:new Date().toISOString(),
    username:studentInfo.username, subject:studentInfo.subject,
    score:total, possible, totalQ:examData.questions.length,
    answered, title:examData.title
  });
  saveHistory(hist.slice(0,200));
  showScreen('result-screen');
}

function renderScore() {
  let total = 0;
  examData.questions.forEach((q,i) => {
    const pts = calcScore(q, answers[i], answerKey[i]);
    if (pts!==null) total+=pts;
  });
  document.getElementById('result-score').textContent =
    hasAnyKey() ? `${total} điểm` : '– (chưa có đáp án)';
}

function toggleAnswerDisplay() {
  const panel = document.getElementById('answer-display-panel');
  const hide  = panel.classList.toggle('hidden');
  document.getElementById('btn-show-answers').classList.toggle('active-toggle', !hide);
  if (!hide) renderAnswerDisplay();
}
function renderAnswerDisplay() {
  document.getElementById('adp-body').innerHTML = examData.questions.map((q,i) => {
    const k = answerKey[i];
    let keyText = '';
    if (q.type==='mcq')
      keyText = (k!==null&&k!==undefined) ? ALPHA[Number(k)] : '–';
    else if (q.type==='truefalse')
      keyText = Array.isArray(k) ? k.map((v,si)=>`(${si+1})${v||'–'}`).join(' ') : '–';
    else if (q.type==='matching')
      keyText = Array.isArray(k) ? k.map((v,si)=>`Ý${si+1}→${v!==null&&v!==undefined?ALPHA[Number(v)]:'–'}`).join(' ') : '–';
    else if (q.type==='short')
      keyText = (k&&String(k).trim()) ? String(k) : '–';
    return `<div class="adp-row">
      <div class="adp-num">Câu ${i+1}</div>
      <div class="adp-content">${renderMathHTML(q.question)}</div>
      <div class="adp-key ${keyText==='–'?'no-key':''}">${escH(keyText)}</div>
    </div>`;
  }).join('');
}

function openAnswerEditor() {
  const body = document.getElementById('answer-editor-body');
  body.innerHTML = examData.questions.map((q,i) => {
    const k = answerKey[i];
    let ctrl = '';
    if (q.type==='mcq') {
      ctrl = `<div class="aem-controls">` +
        q.options.map((opt,oi) => {
          const chk = (k!==null&&k!==undefined&&Number(k)===oi) ? 'checked' : '';
          return `<input type="radio" class="aem-radio-pill" name="aem_mcq_${i}" id="aem_mcq_${i}_${oi}" value="${oi}" ${chk}/>
            <label class="aem-radio-label" for="aem_mcq_${i}_${oi}" title="${escH(opt)}">${ALPHA[oi]}</label>`;
        }).join('') + `</div>`;
    } else if (q.type==='truefalse') {
      ctrl = `<div class="aem-controls" style="flex-direction:column;gap:.3rem;align-items:stretch">` +
        q.statements.map((s,si) => {
          const kv = Array.isArray(k) ? k[si] : null;
          return `<div class="aem-tf-row">
            <span class="aem-tf-stmt">(${si+1}) ${renderMathHTML(s)}</span>
            <div class="aem-tf-group">
              <input type="radio" class="aem-tf-radio" name="aem_tf_${i}_${si}" id="aem_tf${i}_${si}_D" value="D" ${kv==='D'?'checked':''}/>
              <label class="aem-tf-label" for="aem_tf${i}_${si}_D">Đ</label>
              <input type="radio" class="aem-tf-radio" name="aem_tf_${i}_${si}" id="aem_tf${i}_${si}_S" value="S" ${kv==='S'?'checked':''}/>
              <label class="aem-tf-label" for="aem_tf${i}_${si}_S">S</label>
            </div>
          </div>`;
        }).join('') + `</div>`;
    } else if (q.type==='matching') {
      ctrl = `<div class="aem-controls" style="flex-direction:column;gap:.28rem;align-items:stretch">` +
        q.left.map((lItem,li) => {
          const kv = Array.isArray(k) ? (k[li]!==null&&k[li]!==undefined?k[li]:'') : '';
          let opts = `<option value="">–</option>`;
          q.right.forEach((_,ri) => opts+=`<option value="${ri}" ${String(ri)===String(kv)?'selected':''}>${ALPHA[ri]}</option>`);
          return `<div class="aem-match-row">
            <span class="aem-match-stmt">(${li+1}) ${renderMathHTML(lItem)}</span>
            <select class="aem-match-select" data-qi="${i}" data-li="${li}">${opts}</select>
          </div>`;
        }).join('') + `</div>`;
    } else if (q.type==='short') {
      const val = (k!==null&&k!==undefined) ? escH(String(k)) : '';
      ctrl = `<div class="aem-controls"><input type="text" class="aem-short-input" data-qi="${i}" value="${val}" placeholder="Nhập đáp án đúng..."/></div>`;
    }
    return `<div class="aem-q-row">
      <div class="aem-q-num">Câu ${i+1} · ${typeFull(q.type)}</div>
      <div class="aem-q-text">${renderMathHTML(q.question)}</div>
      ${ctrl}
    </div>`;
  }).join('');
  document.getElementById('answer-editor-modal').classList.remove('hidden');
}
function closeAnswerEditor() { document.getElementById('answer-editor-modal').classList.add('hidden'); }

function saveAnswerKey() {
  examData.questions.forEach((q,i) => {
    if (q.type==='mcq') {
      const s = document.querySelector(`input[name="aem_mcq_${i}"]:checked`);
      answerKey[i] = s ? Number(s.value) : null;
    } else if (q.type==='truefalse') {
      answerKey[i] = q.statements.map((_,si) => {
        const s = document.querySelector(`input[name="aem_tf_${i}_${si}"]:checked`);
        return s ? s.value : null;
      });
    } else if (q.type==='matching') {
      answerKey[i] = q.left.map((_,li) => {
        const s = document.querySelector(`.aem-match-select[data-qi="${i}"][data-li="${li}"]`);
        return (s&&s.value!=='') ? Number(s.value) : null;
      });
    } else if (q.type==='short') {
      const inp = document.querySelector(`.aem-short-input[data-qi="${i}"]`);
      answerKey[i] = inp ? (inp.value.trim()||null) : null;
    }
  });
  closeAnswerEditor();
  renderScore();
  const panel = document.getElementById('answer-display-panel');
  if (!panel.classList.contains('hidden')) renderAnswerDisplay();
}

// ══════════════════════════════════════════
//  BANK IMPORT / EXPORT
// ══════════════════════════════════════════
function handleBankImport(e) {
  const files = [...e.target.files];
  let added=0, errors=[];
  let pending = files.length;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        let data = JSON.parse(ev.target.result);
        let qs = [];
        if (Array.isArray(data)) qs = data;
        else if (Array.isArray(data.questions)) qs = data.questions;
        else throw new Error('Không tìm thấy mảng questions');
        const subject = data.metadata?.subject || data.subject || 'Toán';
        const valid = ['truefalse','mcq','matching','short'];
        qs.forEach(q => {
          if (valid.includes(q.type) && q.question) {
            bank.push({ subject, ...q, id: uid() });
            added++;
          }
        });
      } catch(err) { errors.push(`${file.name}: ${err.message}`); }
      pending--;
      if (pending===0) {
        saveBank();
        populateSubjectFilters();
        renderBankList();
        showToast(added>0 ? `✓ Đã thêm ${added} câu hỏi` : '⚠️ Không thêm được câu nào');
        if (errors.length) showToast('⚠️ ' + errors.join('; '), true);
      }
    };
    reader.readAsText(file, 'UTF-8');
  });
  e.target.value = '';
}

function clearBank() {
  if (!confirm('Xóa toàn bộ ngân hàng đề? Không thể hoàn tác.')) return;
  bank = [];
  saveBank();
  populateSubjectFilters();
  renderBankList();
}

function exportBankAsJSON() {
  if (!bank.length) { alert('Ngân hàng trống, không có gì để xuất.'); return; }
  // Xuất theo môn
  const subjects = getBankSubjects();
  const exportData = {
    exportedAt: new Date().toISOString(),
    totalQuestions: bank.length,
    bySubject: {}
  };
  subjects.forEach(s => {
    const qs = bank.filter(q => (q.subject||'Khác')===s);
    exportData.bySubject[s] = {
      subject: s,
      questions: qs,
      byType: {
        mcq: qs.filter(q=>q.type==='mcq').length,
        truefalse: qs.filter(q=>q.type==='truefalse').length,
        short: qs.filter(q=>q.type==='short').length,
        matching: qs.filter(q=>q.type==='matching').length,
      }
    };
  });
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'ngan-hang-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function deleteBankItem(idx) {
  if (!confirm('Xóa câu hỏi này?')) return;
  bank.splice(idx, 1);
  saveBank();
  renderBankList();
}

// ══════════════════════════════════════════
//  BANK RENDER (theo môn + loại)
// ══════════════════════════════════════════
function renderBankList() {
  const filterType    = document.getElementById('bank-filter-type')?.value || '';
  const filterSubject = document.getElementById('bank-filter-subject')?.value || '';
  const search        = (document.getElementById('bank-search')?.value || '').toLowerCase();

  // Update stats
  const cnt = countByType();
  document.getElementById('bstat-total').textContent = bank.length;
  document.getElementById('bstat-mcq').textContent   = cnt.mcq;
  document.getElementById('bstat-tf').textContent    = cnt.truefalse;
  document.getElementById('bstat-short').textContent = cnt.short;
  document.getElementById('bstat-match').textContent = cnt.matching;

  // Render subject tabs
  renderBankSubjectTabs(filterSubject);

  const filtered = bank.filter((q,i) => {
    if (filterType && q.type!==filterType) return false;
    if (filterSubject && (q.subject||'Khác')!==filterSubject) return false;
    if (search && !q.question.toLowerCase().includes(search)) return false;
    return true;
  });

  const emptyEl = document.getElementById('bank-empty-state');
  const listEl  = document.getElementById('bank-list');

  if (!filtered.length) {
    emptyEl.style.display = '';
    listEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';

  // Group by subject then type
  const grouped = {};
  filtered.forEach((q,_) => {
    const subj = q.subject || 'Khác';
    if (!grouped[subj]) grouped[subj] = {mcq:[],truefalse:[],short:[],matching:[]};
    if (grouped[subj][q.type]) grouped[subj][q.type].push(q);
    else grouped[subj]['mcq'].push(q); // fallback
  });

  const rm = typeof renderMathHTML==='function' ? renderMathHTML : escH;

  let html = '';
  Object.entries(grouped).forEach(([subj, byType]) => {
    const subjTotal = Object.values(byType).reduce((s,a)=>s+a.length,0);
    if (!subjTotal) return;

    html += `<div class="bank-subject-group">
      <div class="bank-subject-header">
        <span class="bank-subject-name">📚 ${escH(subj)}</span>
        <span class="bank-subject-count">${subjTotal} câu</span>
      </div>`;

    // Render by type within subject
    const typeOrder = ['truefalse','mcq','matching','short'];
    typeOrder.forEach(type => {
      const qs = byType[type];
      if (!qs || !qs.length) return;
      html += `<div class="bank-type-group">
        <div class="bank-type-header">
          <span class="bank-card-type ${type}">${typeFull(type)}</span>
          <span class="bank-type-count">${qs.length} câu</span>
        </div>
        <div class="bank-type-list">`;
      qs.forEach(q => {
        const realIdx = bank.indexOf(q);
        const hasAns  = checkQuestionHasAnswer(q);
        const keyText = getAnswerPreview(q);
        html += `<div class="bank-card">
          <div class="bank-card-body">
            <div class="bank-card-q">${rm(q.question)}</div>
            <div class="bank-card-meta">
              <span class="bank-card-ans ${hasAns?'has-ans':'no-ans'}">${hasAns?'✓ Có đáp án':'— Chưa có đáp án'}</span>
              ${keyText ? `<span class="bank-card-key">${escH(keyText)}</span>` : ''}
              <span class="bank-card-subj-tag">${escH(q.subject||'Khác')}</span>
            </div>
          </div>
          <div class="bank-card-actions">
            <button class="bc-btn" onclick="openBankEdit(${realIdx})" title="Sửa">✏️</button>
            <button class="bc-btn del" onclick="deleteBankItem(${realIdx})" title="Xóa">🗑</button>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  });

  listEl.innerHTML = html;
  if (window.katex) setTimeout(rerenderPendingMath, 50);
}

function renderBankSubjectTabs(activeSubject) {
  const container = document.getElementById('bank-subject-tabs');
  if (!container) return;
  const subjects = getBankSubjects();
  if (!subjects.length) { container.innerHTML=''; return; }

  container.innerHTML = `
    <button class="bank-stab ${!activeSubject?'active':''}" onclick="setBankSubjectFilter('')">Tất cả</button>
    ${subjects.map(s => {
      const cnt = bank.filter(q=>(q.subject||'Khác')===s).length;
      return `<button class="bank-stab ${activeSubject===s?'active':''}" onclick="setBankSubjectFilter('${escH(s)}')">${escH(s)} <span class="stab-cnt">${cnt}</span></button>`;
    }).join('')}`;
}

function setBankSubjectFilter(subject) {
  const sel = document.getElementById('bank-filter-subject');
  if (sel) sel.value = subject;
  renderBankList();
}

function getAnswerPreview(q) {
  if (q.type==='mcq' && q.answer!==null && q.answer!==undefined) return `→ ${ALPHA[Number(q.answer)]}`;
  if (q.type==='short' && q.answer) return `→ ${String(q.answer).slice(0,20)}`;
  if (q.type==='truefalse' && Array.isArray(q.answers) && q.answers.some(v=>v)) {
    return q.answers.map(v=>v||'?').join(' ');
  }
  if (q.type==='matching' && Array.isArray(q.answers) && q.answers.some(v=>v!==null&&v!==undefined)) {
    return q.answers.map((v,i)=>`${i+1}→${v!==null&&v!==undefined?ALPHA[Number(v)]:'?'}`).join(' ');
  }
  return '';
}

function checkQuestionHasAnswer(q) {
  if (q.type==='mcq')       return q.answer!==null && q.answer!==undefined;
  if (q.type==='short')     return q.answer!==null && q.answer!==undefined && String(q.answer).trim()!=='';
  if (q.type==='truefalse') return Array.isArray(q.answers) && q.answers.some(v=>v==='D'||v==='S');
  if (q.type==='matching')  return Array.isArray(q.answers) && q.answers.some(v=>v!==null&&v!==undefined);
  return false;
}

// ══════════════════════════════════════════
//  BANK EDIT MODAL
// ══════════════════════════════════════════
function openBankEdit(idx) {
  bankEditIdx = idx;
  const q = bank[idx];
  document.getElementById('bank-edit-title').textContent = `✏️ Sửa câu hỏi [${typeFull(q.type)}]`;

  let html = `<div class="bedit-group">
    <label class="bedit-label">📚 Môn học</label>
    <select class="bedit-select" id="bedit-subject">
      ${SUBJECTS.map(s=>`<option value="${s}" ${(q.subject||'Toán')===s?'selected':''}>${s}</option>`).join('')}
    </select>
  </div>
  <div class="bedit-group">
    <label class="bedit-label">Câu hỏi</label>
    <textarea class="bedit-textarea" id="bedit-question" rows="4">${escH(q.question)}</textarea>
  </div>`;

  if (q.type==='mcq') {
    html += (q.options||[]).map((opt,oi) => `<div class="bedit-group">
      <label class="bedit-label">Phương án ${ALPHA[oi]}</label>
      <input class="bedit-input" id="bedit-opt-${oi}" value="${escH(opt)}"/>
    </div>`).join('');
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án đúng</label>
      <select class="bedit-select" id="bedit-answer">
        <option value="">– Chưa có –</option>
        ${(q.options||[]).map((_,oi)=>`<option value="${oi}" ${q.answer===oi?'selected':''}>${ALPHA[oi]}</option>`).join('')}
      </select></div>`;
  } else if (q.type==='truefalse') {
    html += (q.statements||[]).map((s,si) => `
      <div class="bedit-group">
        <label class="bedit-label">Mệnh đề ${si+1}</label>
        <input class="bedit-input" id="bedit-stmt-${si}" value="${escH(s)}"/>
      </div>
      <div class="bedit-group">
        <label class="bedit-label">✅ Đáp án mệnh đề ${si+1}</label>
        <select class="bedit-select" id="bedit-ans-${si}">
          <option value="">– Chưa có –</option>
          <option value="D" ${q.answers?.[si]==='D'?'selected':''}>Đúng</option>
          <option value="S" ${q.answers?.[si]==='S'?'selected':''}>Sai</option>
        </select>
      </div>`).join('');
  } else if (q.type==='short') {
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án</label>
      <input class="bedit-input" id="bedit-answer" value="${escH(q.answer||'')}"/></div>`;
  } else if (q.type==='matching') {
    html += `<div class="bedit-group"><label class="bedit-label">Cột trái (mỗi dòng 1 ý)</label>
      <textarea class="bedit-textarea" id="bedit-left">${(q.left||[]).map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">Cột phải (mỗi dòng 1 ý)</label>
      <textarea class="bedit-textarea" id="bedit-right">${(q.right||[]).map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án (A,B,C,D...)</label>
      <input class="bedit-input" id="bedit-answer" value="${
        Array.isArray(q.answers) ? q.answers.map(v=>v!==null&&v!==undefined?ALPHA[Number(v)]:'–').join(',') : ''
      }"/></div>`;
  }

  document.getElementById('bank-edit-body').innerHTML = html;
  document.getElementById('bank-edit-modal').classList.remove('hidden');
}

function closeBankEdit() { document.getElementById('bank-edit-modal').classList.add('hidden'); }

function saveBankEdit() {
  if (bankEditIdx<0) return;
  const q = bank[bankEditIdx];
  q.subject  = document.getElementById('bedit-subject')?.value || q.subject || 'Toán';
  q.question = document.getElementById('bedit-question')?.value.trim() || q.question;

  if (q.type==='mcq') {
    q.options = (q.options||[]).map((_,oi) => document.getElementById(`bedit-opt-${oi}`)?.value.trim() || '');
    const ans = document.getElementById('bedit-answer')?.value;
    q.answer  = ans!=='' ? Number(ans) : null;
  } else if (q.type==='truefalse') {
    q.statements = (q.statements||[]).map((_,si) => document.getElementById(`bedit-stmt-${si}`)?.value.trim() || '');
    q.answers    = (q.statements||[]).map((_,si) => document.getElementById(`bedit-ans-${si}`)?.value || null);
  } else if (q.type==='short') {
    q.answer = document.getElementById('bedit-answer')?.value.trim() || null;
  } else if (q.type==='matching') {
    q.left  = (document.getElementById('bedit-left')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    q.right = (document.getElementById('bedit-right')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const ansStr = document.getElementById('bedit-answer')?.value||'';
    q.answers = ansStr.split(',').map(s => {
      const idx = ALPHA.indexOf(s.trim().toUpperCase());
      return idx>=0 ? idx : null;
    });
  }

  saveBank();
  closeBankEdit();
  renderBankList();
  showToast('✓ Đã lưu câu hỏi');
}

// ══════════════════════════════════════════
//  CONFIG TAB
// ══════════════════════════════════════════
function renderConfigTab() {
  const subjectFilter = document.getElementById('cfg-subject-filter')?.value || '';
  const cnt = countByType(subjectFilter);
  document.getElementById('avail-mcq').textContent   = `${cnt.mcq} câu trong ngân hàng`;
  document.getElementById('avail-tf').textContent    = `${cnt.truefalse} câu trong ngân hàng`;
  document.getElementById('avail-short').textContent = `${cnt.short} câu trong ngân hàng`;
  document.getElementById('avail-match').textContent = `${cnt.matching} câu trong ngân hàng`;
  document.getElementById('cfg-mcq').value   = config.mcq;
  document.getElementById('cfg-tf').value    = config.truefalse;
  document.getElementById('cfg-short').value = config.short;
  document.getElementById('cfg-match').value = config.matching;
  document.getElementById('cfg-time').value  = config.time;
  updateConfigTotal();
  // Populate subject filter
  const sel = document.getElementById('cfg-subject-filter');
  if (sel) {
    const subjects = getBankSubjects();
    const cur = sel.value;
    sel.innerHTML = `<option value="">Tất cả môn</option>`;
    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value=s; opt.textContent=s;
      if (s===cur) opt.selected=true;
      sel.appendChild(opt);
    });
  }
}

function updateConfigTotal() {
  const total = ['cfg-mcq','cfg-tf','cfg-short','cfg-match']
    .reduce((s,id) => s + (parseInt(document.getElementById(id)?.value)||0), 0);
  document.getElementById('cfg-total').textContent = total;
}

function saveConfigFromUI() {
  config.mcq       = parseInt(document.getElementById('cfg-mcq').value)||0;
  config.truefalse = parseInt(document.getElementById('cfg-tf').value)||0;
  config.short     = parseInt(document.getElementById('cfg-short').value)||0;
  config.matching  = parseInt(document.getElementById('cfg-match').value)||0;
  config.time      = parseInt(document.getElementById('cfg-time').value)||90;
  config.subject   = document.getElementById('cfg-subject-filter')?.value || '';
  saveConfig();
  const msg = document.getElementById('config-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

// ══════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════
function renderHistory() {
  const hist = loadHistory();
  const emptyEl = document.getElementById('hist-empty');
  const tbody   = document.getElementById('hist-tbody');
  if (!hist.length) {
    emptyEl.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  emptyEl.classList.add('hidden');
  tbody.innerHTML = hist.map((h,i) => {
    const d = new Date(h.date);
    const dateStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const scoreClass = h.possible>0 && h.score===h.possible ? 'hist-score full' : 'hist-score';
    const scoreText  = h.possible>0 ? `${h.score}/${h.possible}` : '–';
    return `<tr>
      <td>${i+1}</td>
      <td>${escH(h.username||'GUEST')}</td>
      <td><span class="hist-subject">${escH(h.subject||'Toán')}</span></td>
      <td>${h.answered||0}/${h.totalQ||0}</td>
      <td class="${scoreClass}">${scoreText}</td>
      <td class="hist-date">${dateStr}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
//  SETS (KHO ĐỀ)
// ══════════════════════════════════════════
let _setsImportMode = false;

function renderSets() {
  const grid    = document.getElementById('sets-grid');
  const emptyEl = document.getElementById('sets-empty-state');
  if (!grid) return;
  if (!sets.length) { emptyEl.style.display=''; grid.innerHTML=''; return; }
  emptyEl.style.display = 'none';

  grid.innerHTML = sets.map((s,idx) => {
    const cnt    = s.questions ? s.questions.length : 0;
    const byType = {mcq:0,truefalse:0,short:0,matching:0};
    (s.questions||[]).forEach(q => { if (byType[q.type]!==undefined) byType[q.type]++; });
    const d       = new Date(s.createdAt);
    const dateStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
    const hasAns  = (s.questions||[]).filter(q => checkQuestionHasAnswer(q)).length;
    const subj    = s.subject || s.metadata?.subject || '';

    return `<div class="set-card" id="set-card-${s.id}">
      <div class="set-card-header">
        <div class="set-card-name">${escH(s.name)}</div>
        <div class="set-card-actions">
          <button class="bc-btn" onclick="openSetQList('${s.id}')" title="Xem & sửa câu hỏi">📋</button>
          <button class="bc-btn" onclick="renameSet('${s.id}')" title="Đổi tên">✏️</button>
          <button class="bc-btn" onclick="exportSet('${s.id}')" title="Xuất JSON">⬇️</button>
          <button class="bc-btn" onclick="addSetToBank('${s.id}')" title="Thêm vào ngân hàng">📥</button>
          <button class="bc-btn del" onclick="deleteSet('${s.id}')" title="Xóa bộ đề">🗑</button>
        </div>
      </div>
      <div class="set-card-meta">
        ${subj ? `<span class="set-meta-item set-meta-subj">📚 ${escH(subj)}</span>` : ''}
        <span class="set-meta-item">📋 ${cnt} câu</span>
        <span class="set-meta-item set-meta-time">⏱ ${s.time||90} phút</span>
        <span class="set-meta-item">✓ ${hasAns}/${cnt} đáp án</span>
        <span class="set-meta-date">📅 ${dateStr}</span>
      </div>
      <div class="set-card-types">
        ${byType.truefalse ? `<span class="bank-card-type truefalse">Đ/S ${byType.truefalse}</span>` : ''}
        ${byType.mcq       ? `<span class="bank-card-type mcq">TN ${byType.mcq}</span>` : ''}
        ${byType.matching  ? `<span class="bank-card-type matching">Ghép ${byType.matching}</span>` : ''}
        ${byType.short     ? `<span class="bank-card-type short">TLN ${byType.short}</span>` : ''}
      </div>
      <div class="set-card-footer">
        <button class="set-start-btn" onclick="startSetExam('${s.id}')">🎯 Thi theo đề này</button>
      </div>
    </div>`;
  }).join('');
}

async function startSetExam(setId) {
  const examSet = sets.find(s => s.id===setId);
  if (!examSet) return;
  let questions = examSet.questions;
  if (!questions || !questions.length) {
    showToast('⏳ Đang tải câu hỏi...');
    try { questions = await ensureSetQuestions(setId); } catch(e) { showToast('⚠️ Lỗi: '+e.message, true); return; }
  }
  studentInfo = { username: 'GUEST', subject: examSet.subject || 'Toán' };
  startExam({ title: examSet.name, time: examSet.time||90, questions });
}

function handleSetsImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      let qs = [];
      if (Array.isArray(data)) qs = data;
      else if (Array.isArray(data.questions)) qs = data.questions;
      else throw new Error('Không tìm thấy mảng questions');
      const name    = data.title || file.name.replace('.json','');
      const time    = data.time || 90;
      const subject = data.metadata?.subject || data.subject || 'Toán';
      openSetNameModal(name, time, qs, subject);
    } catch(err) { showToast('⚠️ Lỗi file: ' + err.message, true); }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function openSetNameModal(defaultName, defaultTime, questions, defaultSubject='Toán') {
  _pendingSetSave = { questions, defaultSubject };
  document.getElementById('set-name-input').value  = defaultName || '';
  document.getElementById('set-time-input').value  = defaultTime || 90;
  const subjSel = document.getElementById('set-subject-input');
  if (subjSel) subjSel.value = defaultSubject;
  const info = document.getElementById('set-name-info');
  const byType = {mcq:0,truefalse:0,short:0,matching:0};
  questions.forEach(q => { if (byType[q.type]!==undefined) byType[q.type]++; });
  info.innerHTML = `<div class="set-name-stats">
    <span>${questions.length} câu</span>
    ${byType.truefalse?`<span class="bank-card-type truefalse">Đ/S ${byType.truefalse}</span>`:''}
    ${byType.mcq?`<span class="bank-card-type mcq">TN ${byType.mcq}</span>`:''}
    ${byType.matching?`<span class="bank-card-type matching">Ghép ${byType.matching}</span>`:''}
    ${byType.short?`<span class="bank-card-type short">TLN ${byType.short}</span>`:''}
  </div>`;
  document.getElementById('set-name-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('set-name-input').focus(), 100);
}

function closeSetNameModal() {
  document.getElementById('set-name-modal').classList.add('hidden');
  _pendingSetSave = null;
}

async function confirmSetName() {
  if (!_pendingSetSave) return;
  const name    = document.getElementById('set-name-input').value.trim();
  const time    = parseInt(document.getElementById('set-time-input').value)||90;
  const subject = document.getElementById('set-subject-input')?.value || 'Toán';
  const alsoBank = document.getElementById('set-also-bank')?.checked ?? true;
  if (!name) { document.getElementById('set-name-input').focus(); return; }

  const { questions } = _pendingSetSave;
  const setId = uid();
  const setObj = {
    id: setId, name, time, subject,
    questions: questions.map(q => ({...q, id: q.id||uid(), subject: q.subject||subject})),
    createdAt: Date.now()
  };

  // Lưu local
  sets.unshift(setObj);
  saveSets();
  closeSetNameModal();
  renderSets();
  populateExamModeSelect();

  // Đồng thời thêm vào ngân hàng nếu được chọn
  if (alsoBank) {
    let added = 0;
    setObj.questions.forEach(q => {
      const exists = bank.some(b => b.question===q.question && b.type===q.type);
      if (!exists) {
        bank.push({...q, id:uid(), subject});
        added++;
      }
    });
    if (added>0) {
      saveBank();
      populateSubjectFilters();
      renderBankList();
    }
  }

  // Upload lên Firebase
  setFbStatus('uploading','⏳ Đang lưu...');
  try {
    await saveSetToFirebase(setObj, (done, total, msg) => {
      setFbStatus('uploading', `⏳ ${msg}`);
    });
    setFbStatus('ok', `☁️ ${sets.length} đề`);
    showToast(`✅ Đã lưu "${name}" vào kho đề${alsoBank?' và ngân hàng':''}`);
  } catch(e) {
    setFbStatus('error','⚠️ Lỗi Firebase');
    showToast('⚠️ Lưu Firebase thất bại: ' + e.message, true);
  }
}

function renameSet(setId) {
  const s = sets.find(x => x.id===setId);
  if (!s) return;
  const newName = prompt('Tên mới cho bộ đề:', s.name);
  if (!newName || !newName.trim()) return;
  s.name = newName.trim();
  saveSets();
  renderSets();
  populateExamModeSelect();
}

function exportSet(setId) {
  const s = sets.find(x => x.id===setId);
  if (!s) return;
  const data = JSON.stringify({
    title: s.name, time: s.time, subject: s.subject,
    questions: s.questions||[],
    metadata: { subject: s.subject||'Toán', title: s.name }
  }, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=s.name.replace(/[^a-z0-9]/gi,'_')+'.json';
  a.click(); URL.revokeObjectURL(url);
}

function addSetToBank(setId) {
  const s = sets.find(x => x.id===setId);
  if (!s || !s.questions?.length) { showToast('⚠️ Bộ đề không có câu hỏi', true); return; }
  const subject = s.subject || 'Toán';
  let added = 0;
  s.questions.forEach(q => {
    const exists = bank.some(b => b.question===q.question && b.type===q.type);
    if (!exists) { bank.push({...q, id:uid(), subject}); added++; }
  });
  saveBank();
  populateSubjectFilters();
  renderBankList();
  showToast(added>0 ? `✅ Đã thêm ${added} câu vào ngân hàng (môn ${subject})` : '⚠️ Tất cả câu đã có trong ngân hàng');
}

async function deleteSet(setId) {
  if (!confirm('Xóa bộ đề này? Không thể hoàn tác.')) return;
  sets = sets.filter(s => s.id!==setId);
  saveSets();
  renderSets();
  populateExamModeSelect();
  try { await deleteSetFromFirebase(setId); } catch {}
  _invalidateSetsListCache();
  setFbStatus('ok', `☁️ ${sets.length} đề`);
}

// ══════════════════════════════════════════
//  SET QUESTION EDITOR
// ══════════════════════════════════════════
let _setQEditSetId = null, _setQEditQIdx = -1;

async function openSetQList(setId) {
  const s = sets.find(x => x.id===setId);
  if (!s) return;
  let qs = s.questions;
  if (!qs || !qs.length) {
    showToast('⏳ Đang tải câu hỏi...');
    qs = await ensureSetQuestions(setId);
  }
  if (!qs || !qs.length) { showToast('⚠️ Không có câu hỏi', true); return; }
  document.getElementById('set-qlist-title').textContent = `📋 ${escH(s.name)} — ${qs.length} câu`;
  const rm = typeof renderMathHTML==='function' ? renderMathHTML : escH;
  document.getElementById('set-qlist-body').innerHTML = qs.map((q,i) => {
    const typeLabel = {truefalse:'Đ/S',mcq:'TN',matching:'Ghép',short:'TLN'}[q.type]||q.type;
    const preview = q.question ? q.question.slice(0,120)+(q.question.length>120?'…':'') : '';
    return `<div class="sqlist-item">
      <div class="sqlist-header">
        <span class="sqlist-num">Câu ${i+1}</span>
        <span class="bank-card-type ${q.type}" style="font-size:.68rem">${typeLabel}</span>
        <div class="sqlist-q">${rm(preview)}</div>
        <button class="bc-btn sqlist-edit-btn" onclick="openSetQEdit('${setId}',${i})">✏️ Sửa</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('set-qlist-modal').classList.remove('hidden');
  if (window.katex) setTimeout(rerenderPendingMath, 50);
}
function closeSetQList() { document.getElementById('set-qlist-modal').classList.add('hidden'); }

function openSetQEdit(setId, qIdx) {
  const s = sets.find(x => x.id===setId);
  if (!s || !s.questions) return;
  const q = s.questions[qIdx];
  if (!q) return;
  _setQEditSetId = setId; _setQEditQIdx = qIdx;
  document.getElementById('set-qlist-modal').classList.add('hidden');
  document.getElementById('set-qedit-title').textContent = `✏️ Sửa câu ${qIdx+1} [${typeFull(q.type)}]`;

  let html = `<div class="bedit-group">
    <label class="bedit-label">Câu hỏi</label>
    <textarea class="bedit-textarea" id="sqedit-question" rows="4">${escH(q.question)}</textarea>
  </div>`;
  if (q.type==='mcq') {
    html += (q.options||[]).map((opt,oi) => `<div class="bedit-group">
      <label class="bedit-label">Phương án ${ALPHA[oi]}</label>
      <input class="bedit-input" id="sqedit-opt-${oi}" value="${escH(opt)}"/>
    </div>`).join('');
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án đúng</label>
      <select class="bedit-select" id="sqedit-answer">
        <option value="">– Chưa có –</option>
        ${(q.options||[]).map((_,oi)=>`<option value="${oi}" ${q.answer===oi?'selected':''}>${ALPHA[oi]}</option>`).join('')}
      </select></div>`;
  } else if (q.type==='truefalse') {
    html += (q.statements||[]).map((s,si) => `
      <div class="bedit-group"><label class="bedit-label">Mệnh đề ${si+1}</label>
        <input class="bedit-input" id="sqedit-stmt-${si}" value="${escH(s)}"/></div>
      <div class="bedit-group"><label class="bedit-label">✅ Đáp án mệnh đề ${si+1}</label>
        <select class="bedit-select" id="sqedit-ans-${si}">
          <option value="">– Chưa có –</option>
          <option value="D" ${q.answers?.[si]==='D'?'selected':''}>Đúng</option>
          <option value="S" ${q.answers?.[si]==='S'?'selected':''}>Sai</option>
        </select></div>`).join('');
  } else if (q.type==='short') {
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án</label>
      <input class="bedit-input" id="sqedit-answer" value="${escH(q.answer||'')}"/></div>`;
  } else if (q.type==='matching') {
    html += `<div class="bedit-group"><label class="bedit-label">Cột trái</label>
      <textarea class="bedit-textarea" id="sqedit-left">${(q.left||[]).map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">Cột phải</label>
      <textarea class="bedit-textarea" id="sqedit-right">${(q.right||[]).map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án (A,B,C,D)</label>
      <input class="bedit-input" id="sqedit-answer" value="${
        Array.isArray(q.answers)?q.answers.map(v=>v!==null&&v!==undefined?ALPHA[Number(v)]:'–').join(','):''
      }"/></div>`;
  }
  document.getElementById('set-qedit-body').innerHTML = html;
  document.getElementById('set-qedit-modal').classList.remove('hidden');
}
function closeSetQEdit() {
  document.getElementById('set-qedit-modal').classList.add('hidden');
  if (_setQEditSetId) openSetQList(_setQEditSetId);
}
function saveSetQEdit() {
  if (!_setQEditSetId || _setQEditQIdx<0) return;
  const s = sets.find(x => x.id===_setQEditSetId);
  if (!s || !s.questions) return;
  const q = s.questions[_setQEditQIdx];
  q.question = document.getElementById('sqedit-question')?.value.trim() || q.question;
  if (q.type==='mcq') {
    q.options = (q.options||[]).map((_,oi) => document.getElementById(`sqedit-opt-${oi}`)?.value.trim()||'');
    const ans = document.getElementById('sqedit-answer')?.value;
    q.answer  = ans!=='' ? Number(ans) : null;
  } else if (q.type==='truefalse') {
    q.statements = (q.statements||[]).map((_,si) => document.getElementById(`sqedit-stmt-${si}`)?.value.trim()||'');
    q.answers    = (q.statements||[]).map((_,si) => document.getElementById(`sqedit-ans-${si}`)?.value||null);
  } else if (q.type==='short') {
    q.answer = document.getElementById('sqedit-answer')?.value.trim()||null;
  } else if (q.type==='matching') {
    q.left  = (document.getElementById('sqedit-left')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    q.right = (document.getElementById('sqedit-right')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const ansStr = document.getElementById('sqedit-answer')?.value||'';
    q.answers = ansStr.split(',').map(s => { const idx=ALPHA.indexOf(s.trim().toUpperCase()); return idx>=0?idx:null; });
  }
  saveSets();
  closeSetQEdit();
  showToast('✓ Đã lưu câu hỏi');
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function showToast(msg, isError=false) {
  const el = document.getElementById('pdf-import-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'pdf-toast' + (isError?' toast-error':'');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

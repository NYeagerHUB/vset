/**
 * VSAT – exam.js  v6.0
 *
 * SCORING FIX:
 *   MCQ     : đúng = 6đ, SAI = 0đ (không có điểm âm)
 *             Nếu KHÔNG có đáp án trong bank → không tính điểm câu đó
 *   TF      : đúng k/4 ý → k=1→1đ, k=2→2đ, k=3→3đ, k=4→6đ
 *             Ý chưa chọn = SAI (không được cộng điểm ý đó)
 *   Matching: đúng k/n ý → floor(k/n*6) ← không cộng khi sai
 *   Short   : đúng = 6đ, sai = 0đ
 *
 *   → Chỉ cộng điểm khi ĐÚng. Sai = 0. Không có đáp án → bỏ qua câu đó khỏi tổng.
 *
 * DASHBOARD:
 *   - Màn hình dashboard = nơi quản lý ngân hàng, cấu hình, lịch sử
 *   - Khi đang làm bài (exam-screen) KHÔNG hiện bất kỳ nút dashboard nào
 *   - Nút dashboard chỉ hiện ở result-screen
 */

// ══════════════════════════════════════════
//  STORAGE KEYS
// ══════════════════════════════════════════
const LS_BANK    = 'vsat_bank_v1';
const LS_CONFIG  = 'vsat_config_v1';
const LS_HISTORY = 'vsat_history_v1';
const LS_SETS    = 'vsat_sets_v1';   // kho đề

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let examData     = null;
let answers      = [];
let answerKey    = [];
let currentIdx   = 0;
let timerInterval = null;
let timeLeft     = 0;
let currentTheme = 'real';
let studentInfo  = { username: '', subject: '' };

let bank   = [];
let sets   = [];   // [{ id, name, time, questions[], createdAt }]
let config = { mcq: 9, truefalse: 11, short: 5, matching: 0, time: 90 };
let bankEditIdx = -1;

// pending set save callback (used by set-name modal)
let _pendingSetSave = null;

// ══════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function escH(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
const pad  = n => String(n).padStart(2, '0');
const ALPHA = ['A','B','C','D','E','F','G','H'];

function typeFull(t) {
  return { mcq:'Trắc nghiệm', truefalse:'Đúng/Sai', short:'Trả lời ngắn', matching:'Ghép cột' }[t] || t;
}
function typeShort(t) {
  return { mcq:'TN', truefalse:'Đ/S', short:'TLN', matching:'Ghép' }[t] || t;
}

// ══════════════════════════════════════════
//  LATEX / KATEX RENDER
// ══════════════════════════════════════════

/**
 * renderMath(str) → HTML string
 * Chuyển text có LaTeX ($...$, $$...$$, \(...\), \[...\]) thành HTML với KaTeX.
 * Nếu KaTeX chưa load → trả về text đã escH (fallback an toàn).
 */
function renderMath(str) {
  if (!str) return '';
  // Nếu KaTeX chưa sẵn sàng, trả về plain text (sẽ được re-render sau)
  if (!window.katex) return escH(str);

  try {
    // Dùng renderToString với delimiters chuẩn
    return katex.renderToString(str, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
      trust: false,
      strict: false,
      // Cho phép các lệnh LaTeX phổ biến trong toán học VN
      macros: {
        '\\R': '\\mathbb{R}',
        '\\N': '\\mathbb{N}',
        '\\Z': '\\mathbb{Z}',
        '\\Q': '\\mathbb{Q}',
        '\\C': '\\mathbb{C}',
        '\\vec': '\\overrightarrow',
      }
    });
  } catch {
    return escH(str);
  }
}

/**
 * renderMathHTML(str) → HTML string
 * Xử lý text hỗn hợp: tách phần LaTeX ($...$, $$...$$) khỏi text thường,
 * render LaTeX bằng KaTeX, giữ nguyên text thường (đã escH).
 */
function renderMathHTML(str) {
  if (!str) return '';
  if (!window.katex) {
    // KaTeX chưa load: trả về text thô, đánh dấu để re-render sau
    return `<span class="math-pending">${escH(str)}</span>`;
  }

  // Regex tách các block LaTeX ra khỏi text thường
  // Thứ tự quan trọng: $$...$$ trước $...$
  const parts = [];
  let remaining = str;
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
  let lastIdx = 0;
  let match;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(str)) !== null) {
    // Text thường trước block LaTeX
    if (match.index > lastIdx) {
      parts.push({ type: 'text', val: str.slice(lastIdx, match.index) });
    }
    parts.push({ type: 'math', val: match[0] });
    lastIdx = match.index + match[0].length;
  }
  // Phần text còn lại
  if (lastIdx < str.length) {
    parts.push({ type: 'text', val: str.slice(lastIdx) });
  }

  if (parts.length === 0) return escH(str);

  return parts.map(p => {
    if (p.type === 'text') return escH(p.val);

    // Xác định display mode
    const isDisplay = p.val.startsWith('$$') || p.val.startsWith('\\[');
    let inner = p.val;
    if (inner.startsWith('$$'))   inner = inner.slice(2, -2);
    else if (inner.startsWith('$'))  inner = inner.slice(1, -1);
    else if (inner.startsWith('\\[')) inner = inner.slice(2, -2);
    else if (inner.startsWith('\\(')) inner = inner.slice(2, -2);

    try {
      return katex.renderToString(inner.trim(), {
        throwOnError: false,
        displayMode: isDisplay,
        output: 'html',
        trust: false,
        strict: false,
        macros: {
          '\\R': '\\mathbb{R}',
          '\\N': '\\mathbb{N}',
          '\\Z': '\\mathbb{Z}',
          '\\Q': '\\mathbb{Q}',
          '\\C': '\\mathbb{C}',
        }
      });
    } catch {
      return escH(p.val);
    }
  }).join('');
}

/**
 * Re-render tất cả .math-pending sau khi KaTeX load xong
 */
function rerenderPendingMath() {
  document.querySelectorAll('.math-pending').forEach(el => {
    const raw = el.textContent;
    el.outerHTML = renderMathHTML(raw);
  });
}

// Lắng nghe sự kiện KaTeX ready để re-render nếu cần
document.addEventListener('katex-ready', rerenderPendingMath);


// ── LocalStorage ──
function loadLS() {
  try { bank = JSON.parse(localStorage.getItem(LS_BANK)) || []; } catch { bank = []; }
  try { sets = JSON.parse(localStorage.getItem(LS_SETS)) || []; } catch { sets = []; }
  try {
    const c = JSON.parse(localStorage.getItem(LS_CONFIG));
    if (c) config = { ...config, ...c };
  } catch {}
}
function saveBank()   { localStorage.setItem(LS_BANK,   JSON.stringify(bank)); }
function saveSets()   { localStorage.setItem(LS_SETS,   JSON.stringify(sets)); }
function saveConfig() { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; }
}
function saveHistory(h) { localStorage.setItem(LS_HISTORY, JSON.stringify(h)); }

// ══════════════════════════════════════════
//  FIREBASE HELPERS (gọi sang firebase.js)
// ══════════════════════════════════════════
function setFbStatus(state, msg) {
  const el = document.getElementById('fb-sync-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'fb-sync-status fb-' + state;
}

function _invalidateSetsListCache() {
  localStorage.removeItem('vsat_fb_sets_list');
}

// ── Firebase init (SDK loaded via <script> in HTML head) ──
const FB_CONFIG = {
  apiKey:            "AIzaSyDE1CrLybblFqy3k6Yec0wmsIvW3JfW51Y",
  authDomain:        "vset-75fb5.firebaseapp.com",
  projectId:         "vset-75fb5",
  storageBucket:     "vset-75fb5.firebasestorage.app",
  messagingSenderId: "807067750847",
  appId:             "1:807067750847:web:ae37b9d1f271d37e7e510a"
};
let _db = null, _storage = null, _fbReady = false;

function initFirebase() {
  if (_fbReady) return true;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    _db      = firebase.firestore();
    _storage = firebase.storage();
    _fbReady = true;
    return true;
  } catch(e) {
    console.error('[Firebase] init failed:', e);
    return false;
  }
}

// ── Nén ảnh base64 → JPEG ──
function compressImage(base64, quality = 0.72, maxW = 900) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

// ── Upload ảnh lên Storage ──
async function uploadImageFB(base64, setId, qId) {
  const compressed = await compressImage(base64);
  const parts  = compressed.split(',');
  const binary = atob(parts[1]);
  const arr    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  const blob = new Blob([arr], { type: 'image/jpeg' });
  const ref  = _storage.ref(`images/${setId}/${qId}.jpg`);
  await ref.put(blob, { contentType: 'image/jpeg' });
  return await ref.getDownloadURL();
}

// ── Lưu bộ đề lên Firestore + Storage ──
async function saveSetToFirebase(setObj, onProgress) {
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const { id: setId, name, time, questions, createdAt } = setObj;
  const total = questions.length;

  // Upload ảnh
  const withImages = questions.filter(q => q.image);
  onProgress && onProgress(0, total, `⬆️ Upload ${withImages.length} ảnh...`);
  for (let i = 0; i < withImages.length; i++) {
    const q = withImages[i];
    try {
      q._imageUrl = await uploadImageFB(q.image, setId, q.id);
    } catch(e) { q._imageUrl = null; }
    onProgress && onProgress(i + 1, withImages.length, `⬆️ Ảnh ${i+1}/${withImages.length}`);
  }

  // Chuẩn bị questions
  const processedQs = questions.map(q => {
    const d = { ...q };
    delete d.image;
    if (q._imageUrl) { d.imageUrl = q._imageUrl; delete d._imageUrl; }
    return d;
  });

  // Metadata
  const byType = { mcq:0, truefalse:0, short:0, matching:0 };
  processedQs.forEach(q => { if (byType[q.type] !== undefined) byType[q.type]++; });
  const meta = { id: setId, name, time: time||90, createdAt: createdAt||Date.now(),
                 questionCount: processedQs.length, byType, updatedAt: Date.now() };

  onProgress && onProgress(0, total, '💾 Lưu câu hỏi...');
  await _db.collection('sets').doc(setId).set(meta);

  // Batch write questions
  const BATCH = 400;
  for (let i = 0; i < processedQs.length; i += BATCH) {
    const batch = _db.batch();
    processedQs.slice(i, i + BATCH).forEach(q => {
      batch.set(_db.collection('sets').doc(setId).collection('questions').doc(q.id), q);
    });
    await batch.commit();
    onProgress && onProgress(i + Math.min(BATCH, processedQs.length - i), total,
      `💾 ${Math.min(i+BATCH, processedQs.length)}/${total} câu`);
  }

  // Update cache
  try {
    const cached = JSON.parse(localStorage.getItem('vsat_fb_sets_list')) || { data: [] };
    const list = cached.data || [];
    const idx = list.findIndex(s => s.id === setId);
    if (idx >= 0) list[idx] = meta; else list.unshift(meta);
    localStorage.setItem('vsat_fb_sets_list', JSON.stringify({ ts: Date.now(), data: list }));
  } catch {}

  return { ...meta, questions: processedQs };
}

// ── Lấy danh sách sets từ Firestore ──
async function fetchSetsList(forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const c = JSON.parse(localStorage.getItem('vsat_fb_sets_list'));
      if (c && c.ts && Date.now() - c.ts < 5*60*1000) return c.data;
    } catch {}
  }
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const snap = await _db.collection('sets').orderBy('createdAt', 'desc').get();
  const list = snap.docs.map(d => d.data());
  localStorage.setItem('vsat_fb_sets_list', JSON.stringify({ ts: Date.now(), data: list }));
  return list;
}

// ── Lấy đầy đủ 1 bộ đề (metadata + questions) ──
async function fetchSetFull(setId) {
  const cacheKey = 'vsat_fb_cache_' + setId;
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey));
    if (c && c.ts && Date.now() - c.ts < 30*60*1000) return c.data;
  } catch {}
  if (!initFirebase()) throw new Error('Firebase chưa khởi tạo');
  const metaDoc = await _db.collection('sets').doc(setId).get();
  if (!metaDoc.exists) throw new Error('Bộ đề không tồn tại');
  const qSnap = await _db.collection('sets').doc(setId).collection('questions').get();
  const fullSet = { ...metaDoc.data(), questions: qSnap.docs.map(d => d.data()) };
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: fullSet }));
  return fullSet;
}

// ── Xóa bộ đề khỏi Firestore + Storage ──
async function deleteSetFromFirebase(setId) {
  if (!initFirebase()) return;
  try {
    const qSnap = await _db.collection('sets').doc(setId).collection('questions').get();
    // Xóa ảnh
    await Promise.allSettled(
      qSnap.docs.filter(d => d.data().imageUrl)
        .map(d => _storage.ref(`images/${setId}/${d.id}.jpg`).delete().catch(()=>{}))
    );
    // Xóa questions
    const batch = _db.batch();
    qSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    // Xóa set doc
    await _db.collection('sets').doc(setId).delete();
    localStorage.removeItem('vsat_fb_cache_' + setId);
    _invalidateSetsListCache();
  } catch(e) { console.warn('[Firebase] deleteSet:', e); }
}

// ── Sync sets từ Firebase vào local ──
async function syncSetsFromFirebase() {
  try {
    const list = await fetchSetsList();
    // Giữ lại questions đã có local, merge với metadata từ Firebase
    sets = list.map(s => {
      const existing = sets.find(x => x.id === s.id);
      return {
        ...s,
        // Giữ questions local nếu có (tránh mất data)
        questions: existing?.questions || s.questions || [],
        _fromFirebase: true
      };
    });
    saveSets();
    return true;
  } catch(e) {
    console.warn('[Firebase] sync failed:', e.message);
    return false;
  }
}

async function _initFirebaseSync(forceRefresh = false) {
  setFbStatus('uploading', '⏳ Kết nối Firebase...');
  try {
    if (forceRefresh) _invalidateSetsListCache();
    const ok = await syncSetsFromFirebase();
    if (ok) {
      setFbStatus('ok', `☁️ ${sets.length} đề`);
      renderSets();
      populateExamModeSelect();
    } else {
      setFbStatus('error', '⚠️ Offline');
    }
  } catch(e) {
    setFbStatus('error', '⚠️ Lỗi Firebase');
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
    if (e.key === 'Enter') confirmSetName();
  });

  // Format guide toggle
  document.getElementById('fg-toggle').addEventListener('click', () => {
    const body  = document.getElementById('fg-body');
    const hdr   = document.getElementById('fg-toggle');
    body.classList.toggle('hidden');
    hdr.classList.toggle('open', !body.classList.contains('hidden'));
  });

  // Bank panel
  document.getElementById('bank-import-btn').addEventListener('click', () =>
    document.getElementById('bank-file-input').click()
  );
  document.getElementById('bank-file-input').addEventListener('change', handleBankImport);
  document.getElementById('bank-clear-btn').addEventListener('click', clearBank);
  document.getElementById('bank-export-btn').addEventListener('click', exportBankAsJSON);
  document.getElementById('bank-filter-type').addEventListener('change', renderBankList);
  document.getElementById('bank-search').addEventListener('input', renderBankList);

  // Config panel
  ['cfg-mcq','cfg-tf','cfg-short','cfg-match'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateConfigTotal)
  );
  document.getElementById('config-save-btn').addEventListener('click', saveConfigFromUI);

  // History
  document.getElementById('hist-clear-btn').addEventListener('click', () => {
    if (confirm('Xóa toàn bộ lịch sử làm bài?')) { saveHistory([]); renderHistory(); }
  });

  // Bank edit modal
  document.getElementById('bank-edit-close').addEventListener('click', closeBankEdit);
  document.getElementById('bank-edit-cancel').addEventListener('click', closeBankEdit);
  document.getElementById('bank-edit-save').addEventListener('click', saveBankEdit);

  // Login
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('file-input-login').addEventListener('change', handleFileInputLogin);
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

  // Render initial dashboard
  renderSets();
  renderBankList();
  renderConfigTab();
  renderHistory();

  // Sync sets từ Firebase (async, không block UI — delay 500ms để UI render trước)
  setTimeout(() => _initFirebaseSync(), 500);
});

// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
function toggleTheme() {
  currentTheme = currentTheme === 'real' ? 'galaxy' : 'real';
  document.documentElement.setAttribute('data-theme', currentTheme);
  document.getElementById('theme-icon').textContent  = currentTheme === 'galaxy' ? '🌞' : '🌌';
  document.getElementById('theme-label').textContent = currentTheme === 'galaxy' ? 'Thi thật' : 'Galaxy';
}

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'exam-screen') setTimeout(initScrollObserver, 150);
}
function switchDashPanel(panelId) {
  document.querySelectorAll('.dnav').forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.toggle('active', p.id === panelId));
  if (panelId === 'panel-sets')   renderSets();
  if (panelId === 'panel-config') renderConfigTab();
  if (panelId === 'panel-history') renderHistory();
}
function gotoLogin() {
  updateLoginBadge();
  populateExamModeSelect();
  showScreen('login-screen');
  const code = 'VKOD' + Math.floor(10000 + Math.random() * 90000);
  const pass  = String(Math.floor(10000000 + Math.random() * 90000000));
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

function onExamModeChange() {
  // Có thể thêm preview info sau
}
function gotoDashboard() {
  clearInterval(timerInterval);
  examData = null; answers = []; answerKey = []; currentIdx = 0;
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
function countByType() {
  const c = { mcq: 0, truefalse: 0, short: 0, matching: 0 };
  bank.forEach(q => { if (c[q.type] !== undefined) c[q.type]++; });
  return c;
}

// ══════════════════════════════════════════
//  LOGIN / FILE INPUT
// ══════════════════════════════════════════
function handleLogin() {
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

  // ── Thi theo đề cố định ──
  if (mode.startsWith('set:')) {
    const setId = mode.slice(4);
    const examSet = sets.find(s => s.id === setId);
    if (!examSet) {
      drawErr.textContent = '⚠️ Không tìm thấy bộ đề này.';
      drawErr.classList.remove('hidden');
      return;
    }
    // Lấy questions: ưu tiên _cachedQuestions (đã fetch từ Firebase), rồi questions local
    const questions = examSet._cachedQuestions || examSet.questions;
    if (!questions || !questions.length) {
      drawErr.textContent = '⚠️ Đề chưa tải xong. Vui lòng thử lại.';
      drawErr.classList.remove('hidden');
      return;
    }
    startExam({
      title: `${examSet.name} – ${user}`,
      time:  examSet.time || config.time,
      questions
    });
    return;
  }

  // ── Bốc ngẫu nhiên từ ngân hàng ──
  const drawn = drawFromBank();
  if (drawn === null) {
    startExam(DEMO_EXAM);
    return;
  }
  if (drawn.error) {
    drawErr.textContent = drawn.error;
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
      el.textContent = 'Lỗi file: ' + err.message; el.classList.remove('hidden');
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
  data.questions.forEach((q, i) => {
    if (!valid.includes(q.type)) throw new Error(`Câu ${i+1}: type '${q.type}' không hợp lệ.`);
    if (!q.question)             throw new Error(`Câu ${i+1}: thiếu 'question'.`);
  });
}

// ══════════════════════════════════════════
//  BANK DRAW
// ══════════════════════════════════════════
function drawFromBank() {
  if (!bank.length) return null;   // no bank → demo
  const byType = { mcq: [], truefalse: [], short: [], matching: [] };
  bank.forEach(q => { if (byType[q.type]) byType[q.type].push(q); });

  const need = { mcq: config.mcq, truefalse: config.truefalse, short: config.short, matching: config.matching };
  const errors = [];
  Object.entries(need).forEach(([type, n]) => {
    if (n > 0 && byType[type].length < n)
      errors.push(`${typeFull(type)}: cần ${n} nhưng chỉ có ${byType[type].length}`);
  });
  if (errors.length) return { error: '⚠️ Không đủ câu hỏi: ' + errors.join('; ') };

  const shuffle = arr => [...arr].sort(() => Math.random() - .5);
  let qs = [];
  ['truefalse','mcq','matching','short'].forEach(t => {
    if (need[t] > 0) qs.push(...shuffle(byType[t]).slice(0, need[t]));
  });
  return shuffle(qs);
}

// ══════════════════════════════════════════
//  START EXAM
// ══════════════════════════════════════════
function startExam(data) {
  examData   = data;
  currentIdx = 0;

  // Init blank student answers
  answers = data.questions.map(q => {
    if (q.type === 'truefalse') return new Array(q.statements.length).fill(null);
    if (q.type === 'matching')  return new Array(q.left.length).fill(null);
    return null;
  });

  // Init answer key from JSON (if present)
  answerKey = data.questions.map(q => {
    if (q.type === 'truefalse') {
      // Must have ALL 4 answers non-null to be valid
      if (Array.isArray(q.answers) && q.answers.every(v => v === 'D' || v === 'S'))
        return [...q.answers];
      return new Array(q.statements.length).fill(null);
    }
    if (q.type === 'matching') {
      if (Array.isArray(q.answers) && q.answers.length === q.left.length)
        return [...q.answers];
      return new Array(q.left.length).fill(null);
    }
    if (q.type === 'mcq') {
      return (q.answer !== undefined && q.answer !== null) ? Number(q.answer) : null;
    }
    if (q.type === 'short') {
      return (q.answer !== undefined && q.answer !== null) ? String(q.answer).trim() : null;
    }
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
}

// ══════════════════════════════════════════
//  RENDER QUESTIONS
// ══════════════════════════════════════════
function renderAllQuestions() {
  const body = document.getElementById('exam-body');
  body.innerHTML = '';
  examData.questions.forEach((q, i) => {
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
        ${buildAnswerHTML(q, i)}
      </div>`;
    body.appendChild(block);
  });
  examData.questions.forEach((q, i) => {
    if (q.type === 'truefalse') attachTFListeners(i);
    if (q.type === 'mcq')       attachMCQListeners(i);
    if (q.type === 'matching')  attachMatchingListeners(i);
    if (q.type === 'short')     attachShortListeners(i);
    document.querySelector(`.q-pin-btn[data-idx="${i}"]`).addEventListener('click', () => togglePin(i));
  });
}

function buildAnswerHTML(q, i) {
  if (q.type === 'truefalse') return buildTFHTML(q, i);
  if (q.type === 'mcq')       return buildMCQHTML(q, i);
  if (q.type === 'matching')  return buildMatchingHTML(q, i);
  if (q.type === 'short')     return buildShortHTML(q, i);
  return '';
}

/* ── TRUE/FALSE ── */
function buildTFHTML(q, i) {
  const rows = q.statements.map((s, si) => {
    const dC = answers[i]?.[si] === 'D' ? 'checked' : '';
    const sC = answers[i]?.[si] === 'S' ? 'checked' : '';
    return `<tr>
      <td class="tf-cell">
        <input type="radio" class="tf-radio" name="tf_${i}_${si}" id="tf${i}_${si}_D"
          data-si="${si}" data-val="D" ${dC}/>
        <label class="tf-label" for="tf${i}_${si}_D"></label>
      </td>
      <td class="tf-cell">
        <input type="radio" class="tf-radio" name="tf_${i}_${si}" id="tf${i}_${si}_S"
          data-si="${si}" data-val="S" ${sC}/>
        <label class="tf-label" for="tf${i}_${si}_S"></label>
      </td>
      <td class="tf-stmt">${renderMathHTML(s)}</td>
    </tr>`;
  }).join('');
  return `<table class="tf-table">
    <thead><tr><th>Đúng</th><th>Sai</th><th>Mệnh đề</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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

/* ── MCQ ── */
function buildMCQHTML(q, i) {
  return `<div class="mcq-options">${
    q.options.map((opt, oi) => {
      const sel = answers[i] === String(oi) ? 'selected' : '';
      return `<input type="radio" class="mcq-option" name="mcq_${i}" value="${oi}" ${sel ? 'checked' : ''}/>
      <div class="mcq-row ${sel}" data-qi="${i}" data-oi="${oi}">
        <div class="mcq-radio-wrap"><div class="mcq-circle"></div></div>
        <div class="mcq-text-wrap">${ALPHA[oi]}. ${renderMathHTML(opt)}</div>
      </div>`;
    }).join('')
  }</div>`;
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

/* ── MATCHING ── */
function buildMatchingHTML(q, i) {
  const leftRows  = q.left.map((it, li) =>
    `<tr><td class="match-idx">${li+1}.</td><td>${renderMathHTML(it)}</td></tr>`).join('');
  const rightRows = q.right.map((it, ri) =>
    `<tr><td class="match-key">${ALPHA[ri]}.</td><td>${renderMathHTML(it)}</td></tr>`).join('');
  const sels = q.left.map((_, li) => {
    const sv = answers[i]?.[li] != null ? answers[i][li] : '';
    let opts = `<option value="">Chọn</option>`;
    q.right.forEach((_, ri) =>
      opts += `<option value="${ri}" ${String(ri) === String(sv) ? 'selected' : ''}>${ALPHA[ri]}</option>`);
    return `<div class="match-label-item">
      <span class="match-label-text">Ý ${li+1}:</span>
      <select class="match-select ${sv !== '' ? 'selected' : ''}" data-li="${li}">${opts}</select>
    </div>`;
  }).join('');
  return `
    <div class="matching-tables">
      <div class="match-col">
        <div class="match-col-title">Cột trái</div>
        <table class="match-table"><tbody>${leftRows}</tbody></table>
      </div>
      <div class="match-col">
        <div class="match-col-title">Cột phải</div>
        <table class="match-table"><tbody>${rightRows}</tbody></table>
      </div>
    </div>
    <div class="matching-answer-section">
      <div class="matching-answer-label">Trả lời:</div>
      <div class="matching-selects">${sels}</div>
    </div>`;
}
function attachMatchingListeners(i) {
  document.getElementById(`q-block-${i}`).querySelectorAll('.match-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const li = +sel.dataset.li;
      if (!answers[i]) answers[i] = new Array(examData.questions[i].left.length).fill(null);
      answers[i][li] = sel.value !== '' ? +sel.value : null;
      sel.className = sel.value !== '' ? 'match-select selected' : 'match-select';
      updateDot(i);
    });
  });
}

/* ── SHORT ── */
function buildShortHTML(q, i) {
  const val = answers[i] != null ? escH(String(answers[i])) : '';
  return `<div class="short-wrap"><div class="short-row">
    <span class="short-row-label">Trả lời:</span>
    <input type="text" class="short-input" id="short_${i}"
      value="${val}" placeholder="${escH(q.placeholder || 'Nhập câu trả lời...')}" autocomplete="off"/>
  </div></div>`;
}
function attachShortListeners(i) {
  const inp = document.getElementById(`short_${i}`);
  if (inp) inp.addEventListener('input', () => { answers[i] = inp.value; updateDot(i); });
}

// PIN
const pinnedSet = new Set();
function togglePin(i) {
  const btn = document.querySelector(`.q-pin-btn[data-idx="${i}"]`);
  pinnedSet.has(i) ? (pinnedSet.delete(i), btn.classList.remove('pinned'))
                   : (pinnedSet.add(i),    btn.classList.add('pinned'));
}

// ══════════════════════════════════════════
//  BOTTOM DOTS
// ══════════════════════════════════════════
function buildBottomDots() {
  const c = document.getElementById('bottom-dots'); c.innerHTML = '';
  examData.questions.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'b-dot' + (i === 0 ? ' current' : '');
    d.textContent = i + 1; d.id = `bdot-${i}`;
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
  document.querySelectorAll('.b-dot').forEach((d, i) => d.classList.toggle('current', i === currentIdx));
  const cur = document.getElementById(`bdot-${currentIdx}`);
  if (cur) cur.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  updateNavBtns();
}
function updateNavBtns() {
  if (!examData) return;
  document.getElementById('prev-btn').disabled = currentIdx === 0;
  document.getElementById('next-btn').disabled = currentIdx === examData.questions.length - 1;
}
function scrollToQuestion(i) {
  currentIdx = i;
  const b = document.getElementById(`q-block-${i}`);
  if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  highlightCurrentDot();
}
function navigateDot(dir) {
  const n = currentIdx + dir;
  if (n >= 0 && n < examData.questions.length) scrollToQuestion(n);
}
function initScrollObserver() {
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio > 0.25) {
        const m = e.target.id.match(/^q-block-(\d+)$/);
        if (m && +m[1] !== currentIdx) { currentIdx = +m[1]; highlightCurrentDot(); }
      }
    });
  }, { threshold: 0.25, rootMargin: '-46px 0px -50px 0px' });
  document.querySelectorAll('.question-block').forEach(b => obs.observe(b));
}

// ══════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) { clearInterval(timerInterval); submitExam(); }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  const box = document.getElementById('timer-box');
  box.textContent = `${pad(m)}:${pad(s)}`;
  box.classList.remove('warning','danger');
  if      (timeLeft <= 60)  box.classList.add('danger');
  else if (timeLeft <= 300) box.classList.add('warning');
}

// ══════════════════════════════════════════
//  SUBMIT
// ══════════════════════════════════════════
function openSubmitModal() {
  const ua = answers.filter((_, i) => !isAnswered(i)).length;
  document.getElementById('modal-message').innerHTML = ua === 0
    ? 'Bạn đã trả lời tất cả câu. Xác nhận nộp bài?'
    : `Còn <strong>${ua}</strong> câu chưa trả lời. Bạn có chắc muốn nộp không?`;
  document.getElementById('submit-modal').classList.remove('hidden');
}
function closeSubmitModal() { document.getElementById('submit-modal').classList.add('hidden'); }
function submitExam() { clearInterval(timerInterval); closeSubmitModal(); showResults(); }

// ══════════════════════════════════════════
//  SCORING  ← ĐÃ FIX
//
//  Quy tắc:
//  - Nếu KHÔNG có đáp án (keyAns === null/undefined) → trả về null → KHÔNG tính vào tổng
//  - MCQ:  đúng → 6đ, sai → 0đ   (không trừ điểm)
//  - TF:   mỗi ý chưa chọn coi là sai (không cộng điểm ý đó)
//          1 đúng→1đ, 2→2đ, 3→3đ, 4→6đ
//  - Short: đúng → 6đ, sai → 0đ
//  - Matching: floor(đúng/n × 6)  (chỉ cộng khi ý đúng)
// ══════════════════════════════════════════
function calcScore(q, studentAns, keyAns) {
  // ── TRUE/FALSE ──
  if (q.type === 'truefalse') {
    if (!Array.isArray(keyAns)) return null;   // no key
    // check if key has at least one non-null
    const keyHasValue = keyAns.some(v => v === 'D' || v === 'S');
    if (!keyHasValue) return null;

    const n = keyAns.length;
    let correct = 0;
    for (let si = 0; si < n; si++) {
      const student = Array.isArray(studentAns) ? studentAns[si] : null;
      const key     = keyAns[si];
      // ý chưa chọn (null) KHÔNG được coi là đúng dù key là gì
      if (student !== null && student !== undefined && key !== null && student === key) {
        correct++;
      }
    }
    if (correct === n) return 6;
    if (correct === 3)  return 3;
    if (correct === 2)  return 2;
    if (correct === 1)  return 1;
    return 0;
  }

  // ── MCQ ──
  if (q.type === 'mcq') {
    if (keyAns === null || keyAns === undefined) return null;  // no key
    if (studentAns === null || studentAns === undefined) return 0; // not answered → 0
    return Number(studentAns) === Number(keyAns) ? 6 : 0;
  }

  // ── MATCHING ──
  if (q.type === 'matching') {
    if (!Array.isArray(keyAns) || !keyAns.some(v => v !== null && v !== undefined)) return null;
    if (!Array.isArray(studentAns)) return 0;
    const n = keyAns.length;
    let correct = 0;
    for (let li = 0; li < n; li++) {
      const student = studentAns[li];
      const key     = keyAns[li];
      if (student !== null && student !== undefined &&
          key !== null && key !== undefined &&
          Number(student) === Number(key)) {
        correct++;
      }
    }
    // proportional: floor(correct/n * 6)
    return Math.floor((correct / n) * 6);
  }

  // ── SHORT ──
  if (q.type === 'short') {
    if (keyAns === null || keyAns === undefined || String(keyAns).trim() === '') return null;
    if (studentAns === null || studentAns === undefined) return 0;
    const g = String(studentAns).trim().toLowerCase().replace(/,/g, '.');
    const e = String(keyAns).trim().toLowerCase().replace(/,/g, '.');
    return g === e ? 6 : 0;
  }

  return 0;
}

function hasAnyKey() {
  return answerKey.some(k => {
    if (k === null || k === undefined) return false;
    if (Array.isArray(k)) return k.some(v => v === 'D' || v === 'S' || (v !== null && v !== undefined));
    if (typeof k === 'string') return k.trim() !== '';
    return true;
  });
}

// ══════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════
function showResults() {
  document.getElementById('result-sbd').textContent     = studentInfo.username || 'GUEST';
  document.getElementById('result-subject').textContent = studentInfo.subject  || 'Toán';
  const answered = answers.filter((_, i) => isAnswered(i)).length;
  document.getElementById('result-answered').textContent = answered;
  document.getElementById('result-total').textContent    = examData.questions.length;
  document.getElementById('answer-display-panel').classList.add('hidden');
  renderScore();

  // Save to history
  let total = 0, possible = 0;
  examData.questions.forEach((q, i) => {
    const pts = calcScore(q, answers[i], answerKey[i]);
    if (pts !== null) { total += pts; possible += 6; }
  });
  const hist = loadHistory();
  hist.unshift({
    id: uid(), date: new Date().toISOString(),
    username: studentInfo.username, subject: studentInfo.subject,
    score: total, possible, totalQ: examData.questions.length,
    answered, title: examData.title
  });
  saveHistory(hist.slice(0, 200));

  showScreen('result-screen');
}

function renderScore() {
  let total = 0;
  examData.questions.forEach((q, i) => {
    const pts = calcScore(q, answers[i], answerKey[i]);
    if (pts !== null) total += pts;
  });
  document.getElementById('result-score').textContent =
    hasAnyKey() ? `${total} điểm` : '– (chưa có đáp án)';
}

// ══════════════════════════════════════════
//  ANSWER DISPLAY PANEL
// ══════════════════════════════════════════
function toggleAnswerDisplay() {
  const panel = document.getElementById('answer-display-panel');
  const hide  = panel.classList.toggle('hidden');
  document.getElementById('btn-show-answers').classList.toggle('active-toggle', !hide);
  if (!hide) renderAnswerDisplay();
}
function renderAnswerDisplay() {
  document.getElementById('adp-body').innerHTML = examData.questions.map((q, i) => {
    const k = answerKey[i];
    let keyText = '';
    if (q.type === 'mcq')
      keyText = (k !== null && k !== undefined) ? ALPHA[Number(k)] : '–';
    else if (q.type === 'truefalse')
      keyText = Array.isArray(k)
        ? k.map((v, si) => `(${si+1})${v || '–'}`).join(' ')
        : '–';
    else if (q.type === 'matching')
      keyText = Array.isArray(k)
        ? k.map((v, si) => `Ý${si+1}→${v !== null && v !== undefined ? ALPHA[Number(v)] : '–'}`).join(' ')
        : '–';
    else if (q.type === 'short')
      keyText = (k && String(k).trim()) ? String(k) : '–';

    return `<div class="adp-row">
      <div class="adp-num">Câu ${i+1}</div>
      <div class="adp-content">${renderMathHTML(q.question)}</div>
      <div class="adp-key ${keyText === '–' ? 'no-key' : ''}">${escH(keyText)}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  ANSWER EDITOR MODAL (result screen)
// ══════════════════════════════════════════
function openAnswerEditor() {
  const body = document.getElementById('answer-editor-body');
  body.innerHTML = examData.questions.map((q, i) => {
    const k = answerKey[i];
    let ctrl = '';

    if (q.type === 'mcq') {
      ctrl = `<div class="aem-controls">` +
        q.options.map((opt, oi) => {
          const chk = (k !== null && k !== undefined && Number(k) === oi) ? 'checked' : '';
          return `<input type="radio" class="aem-radio-pill" name="aem_mcq_${i}" id="aem_mcq_${i}_${oi}" value="${oi}" ${chk}/>
            <label class="aem-radio-label" for="aem_mcq_${i}_${oi}" title="${escH(opt)}">${ALPHA[oi]}</label>`;
        }).join('') + `</div>`;
    }
    else if (q.type === 'truefalse') {
      ctrl = `<div class="aem-controls" style="flex-direction:column;gap:.3rem;align-items:stretch">` +
        q.statements.map((s, si) => {
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
    }
    else if (q.type === 'matching') {
      ctrl = `<div class="aem-controls" style="flex-direction:column;gap:.28rem;align-items:stretch">` +
        q.left.map((lItem, li) => {
          const kv = Array.isArray(k) ? (k[li] !== null && k[li] !== undefined ? k[li] : '') : '';
          let opts = `<option value="">–</option>`;
          q.right.forEach((_, ri) =>
            opts += `<option value="${ri}" ${String(ri) === String(kv) ? 'selected' : ''}>${ALPHA[ri]}</option>`);
          return `<div class="aem-match-row">
            <span class="aem-match-stmt">(${li+1}) ${renderMathHTML(lItem)}</span>
            <select class="aem-match-select" data-qi="${i}" data-li="${li}">${opts}</select>
          </div>`;
        }).join('') + `</div>`;
    }
    else if (q.type === 'short') {
      const val = (k !== null && k !== undefined) ? escH(String(k)) : '';
      ctrl = `<div class="aem-controls">
        <input type="text" class="aem-short-input" data-qi="${i}" value="${val}" placeholder="Nhập đáp án đúng..."/>
      </div>`;
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
  examData.questions.forEach((q, i) => {
    if (q.type === 'mcq') {
      const s = document.querySelector(`input[name="aem_mcq_${i}"]:checked`);
      answerKey[i] = s ? Number(s.value) : null;
    }
    else if (q.type === 'truefalse') {
      answerKey[i] = q.statements.map((_, si) => {
        const s = document.querySelector(`input[name="aem_tf_${i}_${si}"]:checked`);
        return s ? s.value : null;
      });
    }
    else if (q.type === 'matching') {
      answerKey[i] = q.left.map((_, li) => {
        const s = document.querySelector(`.aem-match-select[data-qi="${i}"][data-li="${li}"]`);
        return (s && s.value !== '') ? Number(s.value) : null;
      });
    }
    else if (q.type === 'short') {
      const inp = document.querySelector(`.aem-short-input[data-qi="${i}"]`);
      answerKey[i] = inp ? (inp.value.trim() || null) : null;
    }
  });
  closeAnswerEditor();
  renderScore();
  const panel = document.getElementById('answer-display-panel');
  if (!panel.classList.contains('hidden')) renderAnswerDisplay();
}

// ══════════════════════════════════════════
//  BANK IMPORT
// ══════════════════════════════════════════
function handleBankImport(e) {
  const files = [...e.target.files];
  let added = 0, errors = [];
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

        const valid = ['truefalse','mcq','matching','short'];
        qs.forEach(q => {
          if (valid.includes(q.type) && q.question) {
            bank.push({ ...q, id: uid() });
            added++;
          }
        });
      } catch(err) { errors.push(`${file.name}: ${err.message}`); }
      pending--;
      if (pending === 0) {
        saveBank();
        renderBankList();
        showToast(added > 0 ? `✓ Đã thêm ${added} câu hỏi` : '⚠️ Không thêm được câu nào');
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
  renderBankList();
}

function exportBankAsJSON() {
  if (!bank.length) { alert('Ngân hàng trống, không có gì để xuất.'); return; }
  const data = JSON.stringify({ questions: bank }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
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
//  SETS (KHO ĐỀ)
// ══════════════════════════════════════════

// Flag: khi true, PDF import modal sẽ lưu vào kho đề thay vì ngân hàng
let _setsImportMode = false;

function renderSets() {
  const grid     = document.getElementById('sets-grid');
  const emptyEl  = document.getElementById('sets-empty-state');
  if (!grid) return;

  if (!sets.length) {
    emptyEl.style.display = '';
    grid.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';

  grid.innerHTML = sets.map((s, idx) => {
    const cnt      = s.questions ? s.questions.length : 0;
    const byType   = { mcq:0, truefalse:0, short:0, matching:0 };
    (s.questions || []).forEach(q => { if (byType[q.type] !== undefined) byType[q.type]++; });
    const d        = new Date(s.createdAt);
    const dateStr  = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
    const hasAns   = (s.questions || []).filter(q => checkQuestionHasAnswer(q)).length;

    return `<div class="set-card" id="set-card-${s.id}">
      <div class="set-card-header">
        <div class="set-card-name">${escH(s.name)}</div>
        <div class="set-card-actions">
          <button class="bc-btn" onclick="renameSet('${s.id}')" title="Đổi tên">✏️</button>
          <button class="bc-btn" onclick="exportSet('${s.id}')" title="Xuất JSON">⬇️</button>
          <button class="bc-btn" onclick="addSetToBank('${s.id}')" title="Thêm vào ngân hàng">📥</button>
          <button class="bc-btn del" onclick="deleteSet('${s.id}')" title="Xóa bộ đề">🗑</button>
        </div>
      </div>
      <div class="set-card-meta">
        <span class="set-meta-item">📋 ${cnt} câu</span>
        <span class="set-meta-item set-meta-time">⏱ ${s.time || 90} phút</span>
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

function handleSetsImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      let data = JSON.parse(ev.target.result);
      let qs = [];
      let name = file.name.replace(/\.json$/i, '');
      let time = 90;

      if (Array.isArray(data)) {
        qs = data;
      } else if (Array.isArray(data.questions)) {
        qs = data.questions;
        if (data.title) name = data.title;
        if (data.time)  time = data.time;
      } else {
        throw new Error('Không tìm thấy mảng questions');
      }

      const valid = ['truefalse','mcq','matching','short'];
      qs = qs.filter(q => valid.includes(q.type) && q.question).map(q => ({ ...q, id: uid() }));
      if (!qs.length) throw new Error('Không có câu hỏi hợp lệ');

      openSetNameModal(name, time, qs);
    } catch(err) {
      showToast('⚠️ Lỗi: ' + err.message, true);
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// Mở modal đặt tên bộ đề
function openSetNameModal(defaultName, defaultTime, questions) {
  document.getElementById('set-name-input').value = defaultName || '';
  document.getElementById('set-time-input').value = defaultTime || 90;
  const cnt = questions ? questions.length : 0;
  const byType = { mcq:0, truefalse:0, short:0, matching:0 };
  (questions || []).forEach(q => { if (byType[q.type] !== undefined) byType[q.type]++; });
  document.getElementById('set-name-info').innerHTML =
    `<span class="set-name-count">${cnt} câu</span>` +
    (byType.truefalse ? ` · <span class="bank-card-type truefalse" style="font-size:.7rem">Đ/S ${byType.truefalse}</span>` : '') +
    (byType.mcq       ? ` · <span class="bank-card-type mcq" style="font-size:.7rem">TN ${byType.mcq}</span>` : '') +
    (byType.matching  ? ` · <span class="bank-card-type matching" style="font-size:.7rem">Ghép ${byType.matching}</span>` : '') +
    (byType.short     ? ` · <span class="bank-card-type short" style="font-size:.7rem">TLN ${byType.short}</span>` : '');

  _pendingSetSave = questions;
  document.getElementById('set-name-modal').classList.remove('hidden');
  setTimeout(() => {
    const inp = document.getElementById('set-name-input');
    inp.focus(); inp.select();
  }, 80);
}

function closeSetNameModal() {
  document.getElementById('set-name-modal').classList.add('hidden');
  _pendingSetSave = null;
  _setsImportMode = false;
}

function confirmSetName() {
  const name = document.getElementById('set-name-input').value.trim();
  const time = parseInt(document.getElementById('set-time-input').value) || 90;
  if (!name) { document.getElementById('set-name-input').focus(); return; }
  if (!_pendingSetSave || !_pendingSetSave.length) { closeSetNameModal(); return; }

  const newSet = {
    id:        uid(),
    name,
    time,
    questions: _pendingSetSave,
    createdAt: Date.now()
  };

  closeSetNameModal();

  // Lưu local với đầy đủ questions (để hiển thị ngay và dùng offline)
  sets.unshift(newSet);
  saveSets();
  switchDashPanel('panel-sets');
  renderSets();
  populateExamModeSelect();
  showToast(`✅ Đã lưu "${name}" (${newSet.questions.length} câu)`);

  // Upload Firebase async (không xóa questions local sau khi upload)
  _saveSetToFirebaseWithProgress(newSet);
}

async function _saveSetToFirebaseWithProgress(setObj) {
  try {
    setFbStatus('uploading', `⬆️ Upload "${setObj.name}"...`);
    await saveSetToFirebase(setObj, (cur, total, msg) => {
      setFbStatus('uploading', msg);
    });
    setFbStatus('ok', '☁️ Firebase đã đồng bộ');
    showToast(`☁️ "${setObj.name}" đã lưu lên Firebase!`);
  } catch(e) {
    setFbStatus('error', '⚠️ Upload Firebase thất bại');
    showToast(`⚠️ Firebase lỗi: ${e.message}. Đề vẫn lưu local.`, true);
    console.error('[Firebase] saveSet error:', e);
  }
}

function deleteSet(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`Xóa bộ đề "${s.name}"?\nĐề sẽ bị xóa khỏi Firebase và không thể khôi phục.`)) return;

  // Xóa local ngay
  sets = sets.filter(x => x.id !== id);
  saveSets();
  renderSets();
  populateExamModeSelect();

  // Xóa Firebase async
  if (typeof deleteSetFromFirebase === 'function') {
    setFbStatus('uploading', '🗑 Đang xóa...');
    deleteSetFromFirebase(id)
      .then(() => setFbStatus('ok', '☁️ Firebase đã đồng bộ'))
      .catch(e => {
        setFbStatus('error', '⚠️ Xóa Firebase thất bại');
        console.warn('[Firebase] deleteSet error:', e);
      });
  }
}

async function startSetExam(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return;

  // Nếu set từ Firebase và chưa có questions local → fetch trước
  if (s._fromFirebase && (!s.questions || !s.questions.length)) {
    setFbStatus('uploading', `⬇️ Đang tải đề "${s.name}"...`);
    try {
      const fullSet = await fetchSetFull(id);
      // Lưu questions vào set local tạm thời (không saveSets để tránh nặng)
      s._cachedQuestions = fullSet.questions;
      setFbStatus('ok', '☁️ Firebase đã đồng bộ');
    } catch(e) {
      setFbStatus('error', '⚠️ Không tải được đề');
      showToast('⚠️ Không tải được đề từ Firebase: ' + e.message, true);
      return;
    }
  }

  gotoLogin();
  setTimeout(() => {
    const sel = document.getElementById('login-exam-mode');
    if (sel) sel.value = `set:${id}`;
  }, 50);
}

function renameSet(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return;
  const newName = prompt('Tên mới cho bộ đề:', s.name);
  if (!newName || !newName.trim()) return;
  s.name = newName.trim();
  saveSets();
  renderSets();
  populateExamModeSelect();
}

function exportSet(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return;
  // Nếu set từ Firebase, cần fetch questions trước
  if (s._fromFirebase && (!s.questions || !s.questions.length)) {
    const qs = s._cachedQuestions;
    if (!qs) { showToast('⚠️ Cần tải đề trước khi xuất. Nhấn 🎯 Thi để tải.', true); return; }
    _doExportSet(s, qs);
  } else {
    _doExportSet(s, s.questions || []);
  }
}
function _doExportSet(s, questions) {
  const data = JSON.stringify({ title: s.name, time: s.time, questions }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = s.name.replace(/[^a-zA-Z0-9À-ỹ\s]/g, '').trim().replace(/\s+/g, '-') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function addSetToBank(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return;
  const qs = s.questions || s._cachedQuestions;
  if (!qs || !qs.length) {
    showToast('⚠️ Cần tải đề trước. Nhấn 🎯 Thi để tải câu hỏi.', true);
    return;
  }
  const added = qs.map(q => ({ ...q, id: uid() }));
  bank.push(...added);
  saveBank();
  renderBankList();
  showToast(`✅ Đã thêm ${added.length} câu từ "${s.name}" vào ngân hàng`);
}

// startSetExam đã được định nghĩa ở trên (async version)

// ══════════════════════════════════════════
//  RENDER BANK LIST
// ══════════════════════════════════════════
function renderBankList() {
  const cnt      = countByType();
  document.getElementById('bstat-total').textContent = bank.length;
  document.getElementById('bstat-mcq').textContent   = cnt.mcq;
  document.getElementById('bstat-tf').textContent    = cnt.truefalse;
  document.getElementById('bstat-short').textContent = cnt.short;
  document.getElementById('bstat-match').textContent = cnt.matching;

  const typeF  = document.getElementById('bank-filter-type')?.value || '';
  const search = (document.getElementById('bank-search')?.value || '').toLowerCase();
  const emptyState = document.getElementById('bank-empty-state');
  const listEl     = document.getElementById('bank-list');
  if (!listEl) return;

  const filtered = bank.filter(q => {
    if (typeF && q.type !== typeF) return false;
    if (search && !q.question.toLowerCase().includes(search)) return false;
    return true;
  });

  if (bank.length === 0) {
    emptyState.style.display = '';
    listEl.innerHTML = '';
    return;
  }
  emptyState.style.display = 'none';

  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">Không tìm thấy câu hỏi phù hợp.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(q => {
    const idx = bank.findIndex(b => b.id === q.id);
    const hasAns = checkQuestionHasAnswer(q);
    const keyPreview = getKeyPreview(q);
    return `<div class="bank-card">
      <div class="bank-card-type ${q.type}">${typeShort(q.type)}</div>
      <div class="bank-card-body">
        <div class="bank-card-q">${renderMathHTML(q.question)}</div>
        <div class="bank-card-meta">
          <span class="bank-card-ans ${hasAns ? 'has-ans' : 'no-ans'}">${hasAns ? '✓ Có đáp án' : '✗ Chưa có đáp án'}</span>
          ${q.image ? `<span class="bank-card-img-badge">🖼️ Có ảnh</span>` : ''}
          ${keyPreview ? `<span class="bank-card-key">→ ${escH(keyPreview)}</span>` : ''}
        </div>
      </div>
      <div class="bank-card-actions">
        <button class="bc-btn" onclick="openBankEdit(${idx})">✏️</button>
        <button class="bc-btn del" onclick="deleteBankItem(${idx})">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function checkQuestionHasAnswer(q) {
  if (q.type === 'mcq')       return q.answer !== null && q.answer !== undefined;
  if (q.type === 'short')     return q.answer !== null && q.answer !== undefined && String(q.answer).trim() !== '';
  if (q.type === 'truefalse') return Array.isArray(q.answers) && q.answers.some(v => v === 'D' || v === 'S');
  if (q.type === 'matching')  return Array.isArray(q.answers) && q.answers.some(v => v !== null && v !== undefined);
  return false;
}
function getKeyPreview(q) {
  if (q.type === 'mcq' && q.answer !== null && q.answer !== undefined)
    return ALPHA[Number(q.answer)];
  if (q.type === 'short' && q.answer !== null && q.answer !== undefined)
    return String(q.answer);
  if (q.type === 'truefalse' && Array.isArray(q.answers))
    return q.answers.map((v, i) => `${i+1}:${v||'?'}`).join(' ');
  if (q.type === 'matching' && Array.isArray(q.answers))
    return q.answers.map((v, i) => `${i+1}→${v!==null&&v!==undefined?ALPHA[Number(v)]:'?'}`).join(' ');
  return '';
}

// ══════════════════════════════════════════
//  BANK EDIT MODAL
// ══════════════════════════════════════════
function openBankEdit(idx) {
  bankEditIdx = idx;
  const q = bank[idx];
  document.getElementById('bank-edit-title').textContent = 'Sửa câu hỏi · ' + typeFull(q.type);

  let html = `<div class="bedit-group">
    <label class="bedit-label">Câu hỏi</label>
    <textarea class="bedit-textarea" id="bedit-question">${escH(q.question)}</textarea>
  </div>`;

  if (q.type === 'mcq') {
    html += q.options.map((opt, oi) => `<div class="bedit-group">
      <label class="bedit-label">Phương án ${ALPHA[oi]}</label>
      <input class="bedit-input" id="bedit-opt-${oi}" value="${escH(opt)}"/>
    </div>`).join('');
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án đúng</label>
      <select class="bedit-select" id="bedit-answer">
        <option value="">– Chưa có –</option>
        ${q.options.map((_, oi) => `<option value="${oi}" ${q.answer===oi?'selected':''}>${ALPHA[oi]}</option>`).join('')}
      </select></div>`;
  }
  else if (q.type === 'truefalse') {
    html += q.statements.map((s, si) => `
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
  }
  else if (q.type === 'short') {
    html += `<div class="bedit-group"><label class="bedit-label">✅ Đáp án đúng</label>
      <input class="bedit-input" id="bedit-answer" value="${escH(q.answer || '')}"/></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">Placeholder</label>
      <input class="bedit-input" id="bedit-placeholder" value="${escH(q.placeholder || '')}"/></div>`;
  }
  else if (q.type === 'matching') {
    html += `<div class="bedit-group"><label class="bedit-label">Cột trái (mỗi dòng 1 ý)</label>
      <textarea class="bedit-textarea" id="bedit-left">${q.left.map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group"><label class="bedit-label">Cột phải (mỗi dòng 1 mục)</label>
      <textarea class="bedit-textarea" id="bedit-right">${q.right.map(escH).join('\n')}</textarea></div>`;
    html += `<div class="bedit-group">
      <label class="bedit-label">✅ Đáp án (vd: A,B,C,D – tương ứng từng ý cột trái)</label>
      <input class="bedit-input" id="bedit-answer" value="${
        Array.isArray(q.answers) ? q.answers.map(v => v !== null && v !== undefined ? ALPHA[Number(v)] : '–').join(',') : ''
      }"/></div>`;
  }

  // ── Ảnh câu hỏi ──
  const imgPreview = q.image
    ? `<div class="bedit-img-preview-wrap">
         <img src="${q.image}" class="bedit-img-preview" alt="Hình vẽ"/>
         <button type="button" class="bedit-img-del" onclick="clearBankEditImage()">✕ Xóa ảnh</button>
       </div>`
    : '';
  html += `<div class="bedit-group">
    <label class="bedit-label">🖼️ Hình vẽ / Đồ thị</label>
    ${imgPreview}
    <label class="bedit-img-upload-btn">
      📷 ${q.image ? 'Thay ảnh' : 'Thêm ảnh'}
      <input type="file" id="bedit-img-input" accept="image/*" style="display:none"
        onchange="handleBankEditImageUpload(event)"/>
    </label>
    <span class="bedit-img-hint">Hỗ trợ JPG, PNG, WebP. Ảnh lưu dạng base64.</span>
  </div>`;

  document.getElementById('bank-edit-body').innerHTML = html;
  document.getElementById('bank-edit-modal').classList.remove('hidden');
}

function handleBankEditImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    if (bankEditIdx < 0) return;
    // Cập nhật preview ngay
    const wrap = document.querySelector('.bedit-img-preview-wrap');
    const btn  = document.querySelector('.bedit-img-upload-btn');
    if (wrap) {
      wrap.querySelector('img').src = ev.target.result;
    } else {
      const newWrap = document.createElement('div');
      newWrap.className = 'bedit-img-preview-wrap';
      newWrap.innerHTML = `<img src="${ev.target.result}" class="bedit-img-preview" alt="Hình vẽ"/>
        <button type="button" class="bedit-img-del" onclick="clearBankEditImage()">✕ Xóa ảnh</button>`;
      btn.parentNode.insertBefore(newWrap, btn);
    }
    if (btn) btn.textContent = '📷 Thay ảnh';
    // Lưu tạm vào bank object để saveBankEdit đọc được
    bank[bankEditIdx]._pendingImage = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearBankEditImage() {
  if (bankEditIdx < 0) return;
  bank[bankEditIdx]._pendingImage = null;
  bank[bankEditIdx].image = null;
  const wrap = document.querySelector('.bedit-img-preview-wrap');
  if (wrap) wrap.remove();
  const btn = document.querySelector('.bedit-img-upload-btn');
  if (btn) btn.textContent = '📷 Thêm ảnh';
}

function closeBankEdit() {
  // Xóa pending image nếu không lưu
  if (bankEditIdx >= 0 && bank[bankEditIdx]) {
    delete bank[bankEditIdx]._pendingImage;
  }
  document.getElementById('bank-edit-modal').classList.add('hidden');
  bankEditIdx = -1;
}
function saveBankEdit() {
  if (bankEditIdx < 0) return;
  const q = { ...bank[bankEditIdx] };
  q.question = document.getElementById('bedit-question').value.trim();

  // Xử lý ảnh
  if (bank[bankEditIdx]._pendingImage !== undefined) {
    q.image = bank[bankEditIdx]._pendingImage;
    delete bank[bankEditIdx]._pendingImage;
  }

  if (q.type === 'mcq') {
    q.options = q.options.map((_, oi) => document.getElementById(`bedit-opt-${oi}`).value);
    const av = document.getElementById('bedit-answer').value;
    q.answer  = av !== '' ? Number(av) : null;
  }
  else if (q.type === 'truefalse') {
    q.statements = q.statements.map((_, si) => document.getElementById(`bedit-stmt-${si}`).value);
    q.answers    = q.statements.map((_, si) => {
      const v = document.getElementById(`bedit-ans-${si}`).value;
      return v || null;
    });
  }
  else if (q.type === 'short') {
    q.answer      = document.getElementById('bedit-answer').value.trim() || null;
    q.placeholder = document.getElementById('bedit-placeholder').value.trim();
  }
  else if (q.type === 'matching') {
    q.left  = document.getElementById('bedit-left').value.split('\n').map(s => s.trim()).filter(Boolean);
    q.right = document.getElementById('bedit-right').value.split('\n').map(s => s.trim()).filter(Boolean);
    const raw = document.getElementById('bedit-answer').value.split(',').map(s => s.trim().toUpperCase());
    q.answers = raw.map(s => { const i = ALPHA.indexOf(s); return i >= 0 ? i : null; });
  }

  bank[bankEditIdx] = q;
  saveBank();
  const savedIdx = bankEditIdx;
  bankEditIdx = -1;  // reset trước khi closeBankEdit để tránh double-delete
  document.getElementById('bank-edit-modal').classList.add('hidden');
  renderBankList();
  showToast('✓ Đã lưu câu hỏi');
}

// ══════════════════════════════════════════
//  CONFIG TAB
// ══════════════════════════════════════════
function renderConfigTab() {
  document.getElementById('cfg-mcq').value   = config.mcq;
  document.getElementById('cfg-tf').value    = config.truefalse;
  document.getElementById('cfg-short').value = config.short;
  document.getElementById('cfg-match').value = config.matching;
  document.getElementById('cfg-time').value  = config.time;
  const cnt = countByType();
  document.getElementById('avail-mcq').textContent   = `${cnt.mcq} câu trong ngân hàng`;
  document.getElementById('avail-tf').textContent    = `${cnt.truefalse} câu trong ngân hàng`;
  document.getElementById('avail-short').textContent = `${cnt.short} câu trong ngân hàng`;
  document.getElementById('avail-match').textContent = `${cnt.matching} câu trong ngân hàng`;
  updateConfigTotal();
}
function updateConfigTotal() {
  const t = ['cfg-mcq','cfg-tf','cfg-short','cfg-match']
    .reduce((s, id) => s + (+document.getElementById(id).value || 0), 0);
  document.getElementById('cfg-total').textContent = t;
}
function saveConfigFromUI() {
  config.mcq       = +document.getElementById('cfg-mcq').value  || 0;
  config.truefalse = +document.getElementById('cfg-tf').value   || 0;
  config.short     = +document.getElementById('cfg-short').value || 0;
  config.matching  = +document.getElementById('cfg-match').value || 0;
  config.time      = +document.getElementById('cfg-time').value  || 90;
  saveConfig();
  const msg = document.getElementById('config-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);
}

// ══════════════════════════════════════════
//  HISTORY TAB
// ══════════════════════════════════════════
function renderHistory() {
  const hist   = loadHistory();
  const emptyEl = document.getElementById('hist-empty');
  const tbody   = document.getElementById('hist-tbody');
  if (!tbody) return;
  const countEl = document.querySelector('.panel-sub');  // update via hist count heading
  if (!hist.length) {
    emptyEl.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  emptyEl.classList.add('hidden');
  tbody.innerHTML = hist.map((h, idx) => {
    const d = new Date(h.date);
    const dateStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const isFull  = h.possible > 0 && h.score === h.possible;
    const scoreDisplay = h.possible > 0 ? `${h.score}/${h.possible}` : '–';
    return `<tr>
      <td style="color:var(--text-muted);font-family:var(--mono);font-size:.76rem">${hist.length - idx}</td>
      <td><b>${escH(h.username)}</b></td>
      <td><span class="hist-subject">${escH(h.subject)}</span></td>
      <td style="font-family:var(--mono)">${h.answered || 0}/${h.totalQ}</td>
      <td><span class="hist-score ${isFull ? 'full' : ''}">${scoreDisplay} đ</span></td>
      <td class="hist-date">${dateStr}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════
function isAnswered(i) {
  const a = answers[i];
  if (a === null || a === undefined) return false;
  if (typeof a === 'string') return a.trim() !== '';
  if (Array.isArray(a)) return a.some(v => v !== null && v !== undefined && v !== '');
  return false;
}

function showToast(msg, isErr = false) {
  let t = document.getElementById('vsat-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'vsat-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'padding:.5rem 1.2rem;border-radius:99px;font-family:var(--sans);font-size:.82rem;' +
      'font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s;color:#fff;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = isErr ? '#c0392b' : '#1a2a3a';
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

// ══════════════════════════════════════════
//  DEMO EXAM (khi ngân hàng trống)
// ══════════════════════════════════════════
const DEMO_EXAM = {
  title: 'Đề thi Demo – Toán 2025',
  time: 90,
  questions: [
    {
      type: 'truefalse',
      question: 'Câu 1 (DEMO). Cho dãy số (uₙ) biết uₙ = 2n + 3.',
      statements: ['Dãy số (uₙ) là cấp số cộng.','Dãy số (uₙ) là dãy tăng.','Dãy số (uₙ) bị chặn dưới.','Dãy số (uₙ) bị chặn trên.'],
      answers: ['D','D','D','S']
    },
    {
      type: 'mcq',
      question: 'Câu 10 (DEMO). Tìm gia tốc cực đại (ms⁻²) của vật trong khoảng thời gian từ 1 tới 3 giây. a(t) = -0.8t + 4.',
      options: ['3,2','2,6','4,8','6,4'],
      answer: 0
    },
    {
      type: 'mcq',
      question: 'Câu 13 (DEMO). Tứ phân vị thứ nhất của mẫu số liệu ghép nhóm (ChatGPT).',
      options: ['11,4','11,3','11,2','11,1'],
      answer: 0
    },
    {
      type: 'matching',
      question: 'Câu 16 (DEMO). Ghép cột: Hàm số đạt cực trị.',
      left: ['1. Đạt cực đại tại', '2. Đạt cực tiểu tại', '3. Giá trị cực đại', '4. Giá trị cực tiểu'],
      right: ['x = 1', 'x = -1', 'f(1) = 2', 'f(-1) = -2', 'x = 0', 'f(0) = 0'],
      answers: [0, 1, 2, 3]
    },
    {
      type: 'short',
      question: 'Câu 24 (DEMO). Xác suất (%) để anh An chạy bộ vào buổi sáng ngày thứ hai?',
      placeholder: 'Nhập số % (ví dụ: 65)',
      answer: '65'
    }
  ]
};

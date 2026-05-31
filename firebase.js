/**
 * firebase.js  v1.0
 * Firebase Firestore + Storage integration cho VSAT
 *
 * Firestore structure:
 *   sets/{setId}  →  { id, name, time, subject, createdAt, questionCount, byType }
 *   sets/{setId}/questions/{qId}  →  { ...questionData, imageUrl? }
 *
 * Storage:
 *   images/{setId}/{questionId}.jpg  →  ảnh đồ thị đã nén
 */

// ══════════════════════════════════════════
//  FIREBASE CONFIG
// ══════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDE1CrLybblFqy3k6Yec0wmsIvW3JfW51Y",
  authDomain:        "vset-75fb5.firebaseapp.com",
  projectId:         "vset-75fb5",
  storageBucket:     "vset-75fb5.firebasestorage.app",
  messagingSenderId: "807067750847",
  appId:             "1:807067750847:web:ae37b9d1f271d37e7e510a"
};

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let _db      = null;   // Firestore instance
let _storage = null;   // Storage instance
let _fbReady = false;  // Firebase initialized

// Cache key prefix
const FB_CACHE_PREFIX = 'vsat_fb_cache_';
const FB_SETS_LIST_KEY = 'vsat_fb_sets_list';

// ══════════════════════════════════════════
//  LOAD FIREBASE SDK (CDN)
// ══════════════════════════════════════════
function loadFirebaseSDK() {
  return new Promise((resolve, reject) => {
    if (_fbReady) { resolve(); return; }

    // Load Firebase App + Firestore + Storage từ CDN
    const scripts = [
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js'
    ];

    let loaded = 0;
    scripts.forEach(src => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => {
        loaded++;
        if (loaded === scripts.length) {
          try {
            if (!firebase.apps.length) {
              firebase.initializeApp(FIREBASE_CONFIG);
            }
            _db      = firebase.firestore();
            _storage = firebase.storage();
            _fbReady = true;
            resolve();
          } catch(e) { reject(e); }
        }
      };
      s.onerror = () => reject(new Error('Không thể tải Firebase SDK'));
      document.head.appendChild(s);
    });
  });
}

// ══════════════════════════════════════════
//  IMAGE COMPRESSION
// ══════════════════════════════════════════
/**
 * Nén ảnh base64 xuống JPEG với quality cho trước
 * @param {string} base64  - data:image/png;base64,...
 * @param {number} quality - 0.0 → 1.0 (default 0.72)
 * @param {number} maxW    - max width px (default 900)
 * @returns {Promise<string>} compressed base64 JPEG
 */
function compressImage(base64, quality = 0.72, maxW = 900) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64); // fallback: giữ nguyên
    img.src = base64;
  });
}

/**
 * Tính kích thước base64 string (bytes)
 */
function base64Size(b64) {
  const base = b64.split(',')[1] || b64;
  return Math.round(base.length * 0.75);
}

// ══════════════════════════════════════════
//  UPLOAD ẢNH LÊN STORAGE
// ══════════════════════════════════════════
/**
 * Upload 1 ảnh lên Firebase Storage
 * @param {string} base64   - data:image/...;base64,...
 * @param {string} setId    - ID bộ đề
 * @param {string} qId      - ID câu hỏi
 * @returns {Promise<string>} public download URL
 */
async function uploadImage(base64, setId, qId) {
  // Nén trước khi upload
  const sizeBefore = base64Size(base64);
  const compressed = await compressImage(base64, 0.72, 900);
  const sizeAfter  = base64Size(compressed);
  console.log(`[IMG] ${qId}: ${(sizeBefore/1024).toFixed(0)}KB → ${(sizeAfter/1024).toFixed(0)}KB`);

  // Convert base64 → Blob
  const parts  = compressed.split(',');
  const mime   = parts[0].match(/:(.*?);/)[1];
  const binary = atob(parts[1]);
  const arr    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });

  // Upload
  const ref = _storage.ref(`images/${setId}/${qId}.jpg`);
  await ref.put(blob, { contentType: 'image/jpeg' });
  return await ref.getDownloadURL();
}

/**
 * Xóa ảnh khỏi Storage khi xóa bộ đề
 */
async function deleteSetImages(setId, questions) {
  const withImg = (questions || []).filter(q => q.imageUrl);
  await Promise.allSettled(
    withImg.map(q => _storage.ref(`images/${setId}/${q.id}.jpg`).delete().catch(() => {}))
  );
}

// ══════════════════════════════════════════
//  FIRESTORE — LƯU BỘ ĐỀ
// ══════════════════════════════════════════
/**
 * Lưu 1 bộ đề lên Firestore (set metadata + subcollection questions)
 * @param {Object} setObj  - { id, name, time, questions[], createdAt }
 * @param {Function} onProgress - callback(current, total, message)
 * @returns {Promise<Object>} saved set object (questions có imageUrl thay vì image)
 */
async function saveSetToFirebase(setObj, onProgress) {
  await loadFirebaseSDK();

  const { id: setId, name, time, questions, createdAt } = setObj;
  const total = questions.length;
  let current = 0;

  // Bước 1: Upload ảnh song song (batch 3 ảnh cùng lúc)
  const processedQuestions = [];
  const withImages = questions.filter(q => q.image);

  onProgress && onProgress(0, total, `⬆️ Đang upload ${withImages.length} ảnh...`);

  // Upload ảnh theo batch để tránh quá tải
  const BATCH = 3;
  for (let i = 0; i < withImages.length; i += BATCH) {
    const batch = withImages.slice(i, i + BATCH);
    await Promise.all(batch.map(async q => {
      try {
        const url = await uploadImage(q.image, setId, q.id);
        q._imageUrl = url;
      } catch(e) {
        console.warn(`Upload ảnh ${q.id} thất bại:`, e);
        q._imageUrl = null;
      }
    }));
    current += batch.length;
    onProgress && onProgress(current, withImages.length, `⬆️ Đã upload ${current}/${withImages.length} ảnh`);
  }

  // Bước 2: Chuẩn bị questions (thay image base64 → imageUrl)
  for (const q of questions) {
    const qData = { ...q };
    delete qData.image;       // bỏ base64 nặng
    if (q._imageUrl) {
      qData.imageUrl = q._imageUrl;
      delete qData._imageUrl;
    }
    processedQuestions.push(qData);
  }

  // Bước 3: Lưu metadata set
  const byType = { mcq:0, truefalse:0, short:0, matching:0 };
  processedQuestions.forEach(q => { if (byType[q.type] !== undefined) byType[q.type]++; });

  const setMeta = {
    id:            setId,
    name,
    time:          time || 90,
    createdAt:     createdAt || Date.now(),
    questionCount: processedQuestions.length,
    byType,
    updatedAt:     Date.now()
  };

  onProgress && onProgress(0, total, '💾 Đang lưu câu hỏi...');

  // Bước 4: Lưu set document
  await _db.collection('sets').doc(setId).set(setMeta);

  // Bước 5: Lưu questions vào subcollection (batch write, max 500/batch)
  const WRITE_BATCH = 400;
  for (let i = 0; i < processedQuestions.length; i += WRITE_BATCH) {
    const chunk = processedQuestions.slice(i, i + WRITE_BATCH);
    const batch = _db.batch();
    chunk.forEach(q => {
      const ref = _db.collection('sets').doc(setId).collection('questions').doc(q.id);
      batch.set(ref, q);
    });
    await batch.commit();
    onProgress && onProgress(i + chunk.length, total, `💾 Đã lưu ${i + chunk.length}/${total} câu`);
  }

  // Cập nhật cache
  _updateSetsListCache(setMeta);

  return { ...setMeta, questions: processedQuestions };
}

// ══════════════════════════════════════════
//  FIRESTORE — ĐỌC DANH SÁCH BỘ ĐỀ
// ══════════════════════════════════════════
/**
 * Lấy danh sách tất cả bộ đề (chỉ metadata, không có questions)
 * Dùng cache localStorage để load nhanh
 */
async function fetchSetsList(forceRefresh = false) {
  // Thử cache trước
  if (!forceRefresh) {
    try {
      const cached = JSON.parse(localStorage.getItem(FB_SETS_LIST_KEY));
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) {
        return cached.data; // cache còn hiệu lực 5 phút
      }
    } catch {}
  }

  await loadFirebaseSDK();
  const snap = await _db.collection('sets').orderBy('createdAt', 'desc').get();
  const list = snap.docs.map(d => d.data());

  // Lưu cache
  localStorage.setItem(FB_SETS_LIST_KEY, JSON.stringify({ ts: Date.now(), data: list }));
  return list;
}

/**
 * Lấy đầy đủ 1 bộ đề (metadata + questions)
 * Cache theo setId
 */
async function fetchSetFull(setId) {
  const cacheKey = FB_CACHE_PREFIX + setId;

  // Thử cache
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && cached.ts && Date.now() - cached.ts < 30 * 60 * 1000) {
      return cached.data; // cache 30 phút
    }
  } catch {}

  await loadFirebaseSDK();

  // Lấy metadata
  const metaDoc = await _db.collection('sets').doc(setId).get();
  if (!metaDoc.exists) throw new Error('Bộ đề không tồn tại');
  const meta = metaDoc.data();

  // Lấy questions
  const qSnap = await _db.collection('sets').doc(setId)
    .collection('questions').orderBy('__name__').get();
  const questions = qSnap.docs.map(d => d.data());

  const fullSet = { ...meta, questions };

  // Lưu cache
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: fullSet }));
  return fullSet;
}

// ══════════════════════════════════════════
//  FIRESTORE — XÓA BỘ ĐỀ
// ══════════════════════════════════════════
async function deleteSetFromFirebase(setId) {
  await loadFirebaseSDK();

  // Lấy questions để xóa ảnh
  const qSnap = await _db.collection('sets').doc(setId).collection('questions').get();
  const questions = qSnap.docs.map(d => d.data());

  // Xóa ảnh trên Storage
  await deleteSetImages(setId, questions);

  // Xóa questions subcollection (batch)
  const batch = _db.batch();
  qSnap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();

  // Xóa set document
  await _db.collection('sets').doc(setId).delete();

  // Xóa cache
  localStorage.removeItem(FB_CACHE_PREFIX + setId);
  _invalidateSetsListCache();
}

// ══════════════════════════════════════════
//  CACHE HELPERS
// ══════════════════════════════════════════
function _updateSetsListCache(setMeta) {
  try {
    const cached = JSON.parse(localStorage.getItem(FB_SETS_LIST_KEY)) || { data: [] };
    const list   = cached.data || [];
    const idx    = list.findIndex(s => s.id === setMeta.id);
    if (idx >= 0) list[idx] = setMeta;
    else list.unshift(setMeta);
    localStorage.setItem(FB_SETS_LIST_KEY, JSON.stringify({ ts: Date.now(), data: list }));
  } catch {}
}

function _invalidateSetsListCache() {
  localStorage.removeItem(FB_SETS_LIST_KEY);
}

function invalidateSetCache(setId) {
  localStorage.removeItem(FB_CACHE_PREFIX + setId);
  _invalidateSetsListCache();
}

// ══════════════════════════════════════════
//  SYNC: FIREBASE → LOCAL sets[]
// ══════════════════════════════════════════
/**
 * Load danh sách sets từ Firebase vào biến sets[] của app
 * Gọi khi app khởi động
 */
async function syncSetsFromFirebase() {
  try {
    const list = await fetchSetsList();
    // Merge với local sets (ưu tiên Firebase)
    // Chỉ lưu metadata (không có questions) vào sets[] để nhẹ
    // questions sẽ fetch on-demand khi thi
    sets = list.map(s => ({
      id:            s.id,
      name:          s.name,
      time:          s.time,
      createdAt:     s.createdAt,
      questionCount: s.questionCount,
      byType:        s.byType || {},
      _fromFirebase: true   // đánh dấu để biết cần fetch questions khi thi
    }));
    saveSets(); // sync về localStorage
    return true;
  } catch(e) {
    console.warn('[Firebase] syncSets failed, using local:', e.message);
    return false;
  }
}

/**
 * Lấy questions của 1 set để thi
 * Nếu set có _fromFirebase → fetch từ Firestore
 * Nếu không → dùng questions local
 */
async function getSetQuestionsForExam(setId) {
  const localSet = sets.find(s => s.id === setId);
  if (!localSet) throw new Error('Không tìm thấy bộ đề');

  // Nếu đã có questions local (import trực tiếp) → dùng luôn
  if (localSet.questions && localSet.questions.length > 0) {
    return localSet.questions;
  }

  // Fetch từ Firebase
  const fullSet = await fetchSetFull(setId);
  return fullSet.questions;
}

/**
 * pdf-import.js  v3.0
 * Nhập đề thi + đáp án từ PDF (định dạng ĐGNL V-SAT)
 * v3.0: Render PDF → canvas, crop ảnh tự động cho câu có đồ thị
 */

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfJsLoaded = false;

// ══════════════════════════════════════════
//  PDF PAGE IMAGES (render canvas)
// ══════════════════════════════════════════
// Lưu ảnh từng trang PDF dưới dạng canvas để crop
let _pdfPageCanvases = [];   // Array<HTMLCanvasElement>
let _pdfDoc = null;          // pdfjsLib document

/**
 * Render tất cả trang PDF thành canvas (scale 2x để rõ nét)
 */
async function renderPdfToCanvases(file) {
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  _pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
  _pdfPageCanvases = [];

  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page     = await _pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    _pdfPageCanvases.push(canvas);
  }
}

/**
 * Crop một vùng từ canvas trang PDF
 * @param {number} pageIdx  - 0-based page index
 * @param {number} x,y,w,h - vùng crop (pixel trên canvas scale 2x)
 * @returns {string} base64 PNG
 */
function cropCanvasRegion(pageIdx, x, y, w, h) {
  const src = _pdfPageCanvases[pageIdx];
  if (!src) return null;
  const out = document.createElement('canvas');
  out.width  = w;
  out.height = h;
  out.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

// ══════════════════════════════════════════
//  IMAGE CROP MODAL STATE
// ══════════════════════════════════════════
let _cropTargetIdx   = -1;   // index trong _parsedQuestions
let _cropPageIdx     = 0;    // trang đang xem
let _cropDragging    = false;
let _cropStart       = { x: 0, y: 0 };
let _cropRect        = null; // { x, y, w, h } trên canvas display
let _cropScale       = 1;    // tỉ lệ display/actual

// ══════════════════════════════════════════
//  LOAD PDF.JS
// ══════════════════════════════════════════
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (pdfJsLoaded && window.pdfjsLib) { resolve(); return; }
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      pdfJsLoaded = true; resolve();
    };
    s.onerror = () => reject(new Error('Không thể tải PDF.js. Kiểm tra kết nối mạng.'));
    document.head.appendChild(s);
  });
}

// ══════════════════════════════════════════
//  ĐỌC TEXT TỪ PDF
// ══════════════════════════════════════════
async function extractTextFromPDF(file) {
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    let pageText = '', lastY = null;
    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) pageText += '\n';
      pageText += item.str;
      lastY = item.transform[5];
    }
    out += pageText + '\n\n';
  }
  return out;
}

// ══════════════════════════════════════════
//  ĐỌC TEXT + RENDER CANVAS TỪ PDF ĐỀ
// ══════════════════════════════════════════
async function extractTextAndRenderPDF(file) {
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  // Dùng lại buffer cho cả text và canvas
  _pdfDoc = await window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  _pdfPageCanvases = [];

  let out = '';
  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page = await _pdfDoc.getPage(p);

    // Extract text
    const content = await page.getTextContent();
    let pageText = '', lastY = null;
    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) pageText += '\n';
      pageText += item.str;
      lastY = item.transform[5];
    }
    out += pageText + '\n\n';

    // Render canvas (scale 2x)
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    _pdfPageCanvases.push(canvas);
  }
  return out;
}

// ══════════════════════════════════════════
//  NORMALIZE TEXT
// ══════════════════════════════════════════
function normalizeText(text) {
  return text
    .replace(/HỆ THỐNG GIÁO DỤC EMPIRE TEAM/gi, '')
    .replace(/CHINH PHỤC MỌI MIỀN KIẾN THỨC/gi, '')
    .replace(/BỘ ĐỀ ĐÁNH GIÁ NĂNG LỰC V-SAT/gi, '')
    .replace(/BỘ ĐỀ ĐGNL V-SAT MÔN TOÁN/gi, '')
    .replace(/\[EMPIRE TEAM\]/gi, '')
    .replace(/Lời giải/gi, '')
    .replace(/Từ câu hỏi \d+ đến \d+[^.\n]*/gi, '')
    .replace(/Ⓐ/g,'A. ').replace(/Ⓑ/g,'B. ').replace(/Ⓒ/g,'C. ').replace(/Ⓓ/g,'D. ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s*\d{1,2}\s*$/gm, '')
    .trim();
}

function isCauLine(line) { return /^Câu\s*(\d+)\b/i.test(line); }

function isAnswerLine(line, qNum) {
  if (/^[A-D]\s*[.)]\s+\S/.test(line)) return true;
  if (/^[a-d]\s*[.)]\s+\S/.test(line)) return true;
  if (/^Cột\s+[I1]/i.test(line)) return true;
  if (qNum >= 16 && qNum <= 20) {
    if (/^\d+\s*[.)-]\s*\S/.test(line)) return true;
  }
  return false;
}

// Split multiple MCQ options on a single horizontal line
function splitOptionsLine(line) {
  const matches = [...line.matchAll(/([A-D])\s*[.)]\s*(.*?)(?=\s*[A-D]\s*[.)]\s*|$)/gi)];
  return matches.map(m => ({
    marker: m[1].toUpperCase(),
    text: m[2].trim()
  }));
}

// Split multiple True/False statements on a single horizontal line
function splitTrueFalseLine(line) {
  const matches = [...line.matchAll(/([a-d])\s*[.)]\s*(.*?)(?=\s*[a-d]\s*[.)]\s*|$)/gi)];
  return matches.map(m => ({
    marker: m[1].toLowerCase(),
    text: m[2].trim()
  }));
}

function detectQuestionType(lines, startIdx, qNum) {
  if (qNum >= 1  && qNum <= 9)  return 'truefalse';
  if (qNum >= 10 && qNum <= 15) return 'mcq';
  if (qNum >= 16 && qNum <= 20) return 'matching';
  if (qNum >= 21 && qNum <= 25) return 'short';
  const win = lines.slice(startIdx, startIdx + 20).join('\n');
  if (/Cột\s+I/i.test(win) && /Cột\s+II/i.test(win)) return 'matching';
  if (/^[a-d]\s*\)/m.test(win)) return 'truefalse';
  if (/[A-D]\s*[.)]\s+\S/m.test(win)) return 'mcq';
  return 'short';
}

// ══════════════════════════════════════════
//  PARSE ĐỀ THI
// ══════════════════════════════════════════
function parseVSATText(rawText) {
  const text  = normalizeText(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const questions = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cauMatch = line.match(/^Câu\s*(\d+)\b/i);
    if (!cauMatch) { i++; continue; }
    const qNum = parseInt(cauMatch[1]);
    let qText = line.replace(/^Câu\s*\d+\b\s*[:.-]?\s*/i, '').trim();
    let j = i + 1;
    while (j < lines.length && !isAnswerLine(lines[j], qNum) && !isCauLine(lines[j])) {
      qText += ' ' + lines[j]; j++;
    }
    qText = qText.trim();
    const type = detectQuestionType(lines, j, qNum);
    let question = null;
    if (type === 'truefalse') { question = parseTrueFalse(qText, lines, j); }
    else if (type === 'mcq')  { question = parseMCQ(qText, lines, j); }
    else if (type === 'matching') { question = parseMatching(qText, lines, j); }
    else { question = parseShort(qText, lines, j, qNum); }
    if (question) { j = question._nextIdx; delete question._nextIdx; questions.push(question); }
    i = j;
  }
  return questions;
}

function parseTrueFalse(qText, lines, startIdx) {
  const statements = new Array(4).fill(null);
  const answers = new Array(4).fill(null);
  let count = 0;
  let i = startIdx;
  
  while (i < lines.length) {
    const line = lines[i];
    if (isCauLine(line)) break;
    
    const parsedStmts = splitTrueFalseLine(line);
    if (parsedStmts.length > 0) {
      parsedStmts.forEach(s => {
        const idx = ['a','b','c','d'].indexOf(s.marker);
        if (idx !== -1 && statements[idx] === null) {
          statements[idx] = s.text;
          count++;
        }
      });
      i++;
      continue;
    }
    
    if (count > 0 && !isAnswerLine(line)) {
      for (let idx = 3; idx >= 0; idx--) {
        if (statements[idx] !== null) {
          statements[idx] += ' ' + line;
          break;
        }
      }
      i++;
    } else {
      break;
    }
  }
  
  const actualStmts = statements.filter(s => s !== null);
  if (actualStmts.length === 0) return null;
  
  for (let idx = 0; idx < 4; idx++) {
    if (statements[idx] === null) {
      statements[idx] = `(Mệnh đề ${idx + 1})`;
    }
  }
  return { type:'truefalse', question:qText, statements, answers, _nextIdx:i };
}

function parseMCQ(qText, lines, startIdx) {
  const options = new Array(4).fill(null);
  let count = 0;
  let i = startIdx;
  
  while (i < lines.length) {
    const line = lines[i];
    if (isCauLine(line)) break;
    
    const parsedOpts = splitOptionsLine(line);
    if (parsedOpts.length > 0) {
      parsedOpts.forEach(o => {
        const idx = ['A','B','C','D'].indexOf(o.marker);
        if (idx !== -1 && options[idx] === null) {
          options[idx] = o.text;
          count++;
        }
      });
      i++;
      continue;
    }
    
    if (count > 0 && !isAnswerLine(line)) {
      for (let idx = 3; idx >= 0; idx--) {
        if (options[idx] !== null) {
          options[idx] += ' ' + line;
          break;
        }
      }
      i++;
    } else {
      break;
    }
  }
  
  const actualOpts = options.filter(o => o !== null);
  if (actualOpts.length < 2) return null;
  
  for (let idx = 0; idx < 4; idx++) {
    if (options[idx] === null) {
      options[idx] = `(Lựa chọn ${idx + 1})`;
    }
  }
  return { type:'mcq', question:qText, options, answer:null, _nextIdx:i };
}

function parseMatching(qText, lines, startIdx) {
  const left = [], right = [];
  let i = startIdx;
  
  while (i < lines.length) {
    const line = lines[i];
    if (isCauLine(line)) break;
    if (/^Kết\s*quả/i.test(line)) break;
    
    const mHoriz = line.match(/^(\d+)\s*[.)-]\s*(.+?)\s+([A-F])\s*[.)-]\s*(.+)$/i);
    if (mHoriz) {
      left.push(mHoriz[2].trim());
      right.push(mHoriz[4].trim());
      i++;
      continue;
    }
    
    if (/^Cột\s+[I1]/i.test(line)) { i++; continue; }
    if (/^Cột\s+(II|2)/i.test(line)) { i++; continue; }
    
    const mLeft = line.match(/^(\d+)\s*[.)-]\s*(.+)$/);
    if (mLeft) {
      left.push(mLeft[2].trim());
      i++;
      continue;
    }
    
    const mRight = line.match(/^([A-F])\s*[.)-]\s*(.+)$/i);
    if (mRight) {
      right.push(mRight[2].trim());
      i++;
      continue;
    }
    
    if (right.length > 0) {
      right[right.length - 1] += ' ' + line;
    } else if (left.length > 0) {
      left[left.length - 1] += ' ' + line;
    }
    i++;
  }
  
  if (!left.length) return null;
  
  return { 
    type: 'matching', 
    question: qText, 
    left: left.slice(0, 4), 
    right: right.slice(0, 6), 
    answers: new Array(left.length).fill(null), 
    _nextIdx: i 
  };
}

function parseShort(qText, lines, startIdx, qNum) {
  let i = startIdx;
  while (i < lines.length && !isCauLine(lines[i])) {
    if (lines[i] && !isAnswerLine(lines[i], qNum)) qText += ' ' + lines[i];
    i++;
  }
  return { type:'short', question:qText.trim(), placeholder:'Nhập câu trả lời...', answer:null, _nextIdx:i };
}

// ══════════════════════════════════════════
//  PARSE ĐÁP ÁN TỪ PDF ĐÁP ÁN
// ══════════════════════════════════════════
/**
 * parseVSATAnswers(rawText) → Map<qNum, answerData>
 *
 * Scan toàn bộ text, không phụ thuộc vào cấu trúc dòng của PDF.js.
 * Dùng regex trên toàn bộ chuỗi để tìm đáp án theo từng loại.
 *
 * FIX v2.1: Không dùng \b cho ký tự tiếng Việt (Đ) vì JS coi Đ là non-word char.
 *           Tự động detect loại câu thay vì hardcode range.
 *           Thêm fallback "Chọn ĐÚNG/SAI" cho TF.
 */
function parseVSATAnswers(rawText) {
  const answerMap = new Map();

  // Chuẩn hóa nhẹ — giữ lại nội dung đáp án
  const text = rawText
    .replace(/HỆ THỐNG GIÁO DỤC EMPIRE TEAM/gi, '')
    .replace(/CHINH PHỤC MỌI MIỀN KIẾN THỨC/gi, '')
    .replace(/BỘ ĐỀ ĐÁNH GIÁ NĂNG LỰC V-SAT/gi, '')
    .replace(/\[EMPIRE TEAM\]/gi, '')
    .replace(/[ \t]+/g, ' ');

  // ── Tách thành các block theo "Câu N:" ──
  const blockPattern = /Câu\s+(\d+)\s*[:.][^\n]*([\s\S]*?)(?=Câu\s+\d+\s*[:.:]|$)/gi;
  let m;
  while ((m = blockPattern.exec(text)) !== null) {
    const qNum   = parseInt(m[1]);
    const block  = m[0];

    // ── 1. Thử Matching: "1 – D; 2 – C; 3 – E; 4 – F" ──
    const pairs = [...block.matchAll(/(\d+)\s*[–\-]\s*([A-F])/gi)];
    if (pairs.length >= 2) {
      const answers = new Array(4).fill(null);
      pairs.forEach(p => {
        const idx = parseInt(p[1]) - 1;
        const val = p[2].toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < 4) answers[idx] = val;
      });
      answerMap.set(qNum, { type:'matching', answers });
      continue;
    }

    // ── 2. Thử TF: pattern "Đ Đ S S" hoặc "ĐĐSS" trên 1 dòng ──
    // FIX: Không dùng \b — dùng lookbehind/lookahead cho Unicode-safe boundary
    // (?:^|[^a-zA-Z0-9_ĐđSs]) = trước ký tự đầu không phải chữ cái liên quan
    const tfMatch = block.match(/(?:^|[\s\n\r:;.,])([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])(?:\s|[.:;,\n\r]|$)/m);
    if (tfMatch) {
      const answers = [tfMatch[1],tfMatch[2],tfMatch[3],tfMatch[4]]
        .map(c => c.toUpperCase() === 'Đ' ? 'D' : 'S');
      answerMap.set(qNum, { type:'truefalse', answers });
      continue;
    }

    // ── 2b. TF fallback: không có khoảng trắng giữa "ĐĐSS" ──
    const tfCompact = block.match(/(?:^|[\s\n\r:;.,])([ĐSđs])([ĐSđs])([ĐSđs])([ĐSđs])(?:\s|[.:;,\n\r]|$)/m);
    if (tfCompact) {
      const answers = [tfCompact[1],tfCompact[2],tfCompact[3],tfCompact[4]]
        .map(c => c.toUpperCase() === 'Đ' ? 'D' : 'S');
      answerMap.set(qNum, { type:'truefalse', answers });
      continue;
    }

    // ── 2c. TF fallback: "» Chọn ĐÚNG" / "» Chọn SAI" rải rác trong block ──
    const tfScattered = [...block.matchAll(/(?:»\s*)?Chọn\s+(ĐÚNG|SAI|đúng|sai)\b/gi)];
    if (tfScattered.length === 4) {
      const answers = tfScattered.map(sm =>
        sm[1].toUpperCase() === 'ĐÚNG' ? 'D' : 'S');
      answerMap.set(qNum, { type:'truefalse', answers });
      continue;
    }

    // ── 3. Thử MCQ: "Chọn A" (nhưng không phải "Chọn ĐÚNG/SAI") ──
    const chooseMatch = block.match(/Chọn\s+([A-D])(?:\s|[.:;,\n\r]|$)/i);
    if (chooseMatch) {
      answerMap.set(qNum, { type:'mcq', answer: ['A','B','C','D'].indexOf(chooseMatch[1].toUpperCase()) });
      continue;
    }

    // ── 4. Thử Short: "Đáp số: X" / "Trả lời: X" / "✓ Trả lời: X" ──
    const shortPatterns = [
      /Đáp\s*số\s*[:.]\s*([\d.,/\-]+)/i,
      /[✓✔]\s*Trả\s*lời\s*[:.]\s*([\d.,/\s\-]+)/i,
      /Trả\s*lời\s*[:.]\s*([\d.,/\-]+)/i,
      /=\s*([\d.,/]+)\s*\.?\s*$/m,
    ];
    for (const pat of shortPatterns) {
      const sm = block.match(pat);
      if (sm) {
        // Chuẩn hóa: dấu phẩy thập phân → dấu chấm, bỏ trailing dot/space
        let val = sm[1].trim()
          .replace(/,(?=\d)/g, '.')
          .replace(/[.\s]+$/, '');  // bỏ dấu chấm cuối
        if (val) {
          answerMap.set(qNum, { type:'short', answer: val });
          break;
        }
      }
    }
  }

  return answerMap;
}

/**
 * Ghép đáp án vào mảng câu hỏi đã parse từ đề
 */
function mergeAnswers(questions, answerMap) {
  return questions.map((q, idx) => {
    const qNum = idx + 1; // câu 1-based
    const ans  = answerMap.get(qNum);
    if (!ans) return q;

    const merged = { ...q };
    if (q.type === 'truefalse' && ans.type === 'truefalse') {
      merged.answers = ans.answers;
    } else if (q.type === 'mcq' && ans.type === 'mcq') {
      merged.answer = ans.answer;
    } else if (q.type === 'matching' && ans.type === 'matching') {
      merged.answers = ans.answers;
    } else if (q.type === 'short' && ans.type === 'short') {
      merged.answer = ans.answer;
    }
    return merged;
  });
}

// ══════════════════════════════════════════
//  UI STATE
// ══════════════════════════════════════════
let _parsedQuestions = [];  // từ file đề
let _parsedAnswers   = new Map(); // từ file đáp án

function openPdfImportModal(forSets = false) {
  // Đặt mode trước khi reset UI
  if (typeof _setsImportMode !== 'undefined') _setsImportMode = forSets;

  document.getElementById('pdf-import-modal').classList.remove('hidden');
  document.getElementById('pdf-preview-area').classList.add('hidden');
  document.getElementById('pdf-import-status').textContent = '';
  document.getElementById('pdf-ans-status').textContent = '';
  document.getElementById('pdf-file-input-modal').value = '';
  document.getElementById('pdf-ans-file-input').value = '';
  document.getElementById('pdf-parsed-count').textContent = '';
  document.getElementById('pdf-ans-badge').classList.add('hidden');
  _parsedQuestions = [];
  _parsedAnswers   = new Map();
  _pdfPageCanvases = [];
  _pdfDoc = null;

  // Cập nhật tiêu đề và nút theo mode
  const titleEl = document.querySelector('#pdf-import-modal .modal-header h3');
  if (titleEl) {
    titleEl.textContent = forSets ? '📂 Nhập đề vào Kho đề' : '📄 Nhập đề thi từ PDF';
  }
  const confirmBtn = document.getElementById('pdf-modal-confirm');
  if (confirmBtn) {
    confirmBtn.textContent = forSets ? '📂 Lưu vào kho đề' : '✅ Thêm vào ngân hàng';
  }
}

function closePdfImportModal() {
  document.getElementById('pdf-import-modal').classList.add('hidden');
  if (typeof _setsImportMode !== 'undefined') _setsImportMode = false;
}

// ── Xử lý file ĐỀ ──
async function handlePdfFileSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  const statusEl   = document.getElementById('pdf-import-status');
  const previewArea = document.getElementById('pdf-preview-area');

  statusEl.textContent = '⏳ Đang đọc file đề...';
  statusEl.className = 'pdf-status-text';
  previewArea.classList.add('hidden');
  _pdfPageCanvases = [];

  try {
    statusEl.textContent = '🖼️ Đang render trang PDF...';
    const rawText = await extractTextAndRenderPDF(file);
    statusEl.textContent = '🔍 Đang phân tích câu hỏi...';
    _parsedQuestions = parseVSATText(rawText);

    if (!_parsedQuestions.length) {
      statusEl.textContent = '⚠️ Không tìm thấy câu hỏi nào.';
      statusEl.className = 'pdf-status-text error';
      return;
    }

    // Nếu đã có đáp án thì ghép luôn
    if (_parsedAnswers.size > 0) {
      _parsedQuestions = mergeAnswers(_parsedQuestions, _parsedAnswers);
    }

    statusEl.textContent = `✅ Tìm thấy ${_parsedQuestions.length} câu hỏi · ${_pdfPageCanvases.length} trang đã render.`;
    statusEl.className = 'pdf-status-text ok';
    document.getElementById('pdf-parsed-count').textContent = `${_parsedQuestions.length} câu`;
    renderPdfPreview(_parsedQuestions);
    previewArea.classList.remove('hidden');
  } catch(err) {
    statusEl.textContent = '❌ Lỗi: ' + err.message;
    statusEl.className = 'pdf-status-text error';
  }
}

// ── Xử lý file ĐÁP ÁN ──
async function handleAnsFileSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  const statusEl = document.getElementById('pdf-ans-status');
  const badge    = document.getElementById('pdf-ans-badge');

  statusEl.textContent = '⏳ Đang đọc file đáp án...';
  statusEl.className = 'pdf-status-text';

  try {
    const rawText = await extractTextFromPDF(file);
    _parsedAnswers = parseVSATAnswers(rawText);

    if (_parsedAnswers.size === 0) {
      statusEl.textContent = '⚠️ Không tìm thấy đáp án nào.';
      statusEl.className = 'pdf-status-text error';
      return;
    }

    statusEl.textContent = `✅ Đọc được ${_parsedAnswers.size} đáp án.`;
    statusEl.className = 'pdf-status-text ok';
    badge.textContent = `🔑 ${_parsedAnswers.size} đáp án`;
    badge.classList.remove('hidden');

    // Nếu đã có câu hỏi thì ghép luôn và re-render
    if (_parsedQuestions.length > 0) {
      _parsedQuestions = mergeAnswers(_parsedQuestions, _parsedAnswers);
      renderPdfPreview(_parsedQuestions);
      document.getElementById('pdf-preview-area').classList.remove('hidden');
    }
  } catch(err) {
    statusEl.textContent = '❌ Lỗi: ' + err.message;
    statusEl.className = 'pdf-status-text error';
  }
}

// ══════════════════════════════════════════
//  RENDER PREVIEW
// ══════════════════════════════════════════
function renderPdfPreview(questions) {
  const typeCount = { truefalse:0, mcq:0, matching:0, short:0 };
  questions.forEach(q => { if (typeCount[q.type] !== undefined) typeCount[q.type]++; });
  document.getElementById('pdf-stat-tf').textContent    = typeCount.truefalse;
  document.getElementById('pdf-stat-mcq').textContent   = typeCount.mcq;
  document.getElementById('pdf-stat-match').textContent = typeCount.matching;
  document.getElementById('pdf-stat-short').textContent = typeCount.short;

  const rm = typeof renderMathHTML === 'function' ? renderMathHTML : escH;

  document.getElementById('pdf-preview-list').innerHTML = questions.map((q, i) => {
    const typeLabel = { truefalse:'Đ/S', mcq:'TN', matching:'Ghép', short:'TLN' }[q.type] || q.type;
    const typeClass = q.type;

    // Badge đáp án
    const hasAns = checkParsedAnswer(q);
    const ansBadge = hasAns
      ? `<span class="pdf-ans-ok">🔑 Có đáp án</span>`
      : `<span class="pdf-ans-no">— Chưa có đáp án</span>`;

    // Badge ảnh
    const hasImg = q._image ? `<span class="pdf-img-badge">🖼️ Có ảnh</span>` : '';

    // Nút crop ảnh (chỉ hiện khi đã render canvas)
    const hasPdfCanvas = _pdfPageCanvases.length > 0;
    const cropBtn = hasPdfCanvas
      ? `<button class="pdf-crop-btn" onclick="openCropModal(${i})" title="Chọn vùng ảnh từ PDF">📷 Chọn ảnh</button>`
      : `<label class="pdf-crop-btn pdf-upload-img-btn" title="Upload ảnh thủ công">
           📷 Thêm ảnh
           <input type="file" accept="image/*" style="display:none" onchange="handleManualImageUpload(event,${i})"/>
         </label>`;

    // Chi tiết
    let detail = '';
    if (q.type === 'truefalse') {
      detail = `<div class="pdf-prev-stmts">${q.statements.map((s, si) => {
        const ans = q.answers?.[si];
        const ansLabel = ans === 'D' ? '<b class="ans-d">Đ</b>' : ans === 'S' ? '<b class="ans-s">S</b>' : '<span class="ans-none">?</span>';
        return `<div class="pdf-prev-stmt">
          <span class="pdf-stmt-label">${['a','b','c','d'][si]})</span>
          <span class="pdf-stmt-text">${rm(s)}</span>
          <span class="pdf-stmt-ans">${ansLabel}</span>
        </div>`;
      }).join('')}</div>`;
    } else if (q.type === 'mcq') {
      detail = `<div class="pdf-prev-opts">${q.options.map((o, oi) => {
        const isAns = q.answer !== null && q.answer !== undefined && Number(q.answer) === oi;
        return `<div class="pdf-prev-opt ${isAns ? 'opt-correct' : ''}">
          <span class="pdf-opt-label">${['A','B','C','D'][oi]}.</span> ${rm(o)}
          ${isAns ? ' ✓' : ''}
        </div>`;
      }).join('')}</div>`;
    } else if (q.type === 'matching') {
      detail = `<div class="pdf-prev-match">${q.left.map((l, li) => {
        const ans = q.answers?.[li];
        const ansLabel = (ans !== null && ans !== undefined) ? `→ <b>${['A','B','C','D','E','F'][ans]}</b>` : '→ ?';
        return `<div class="pdf-match-row"><span>${li+1}. ${rm(l)}</span><span class="pdf-match-ans">${ansLabel}</span></div>`;
      }).join('')}
      ${q.right && q.right.length ? `<div class="pdf-match-right-list">${q.right.map((r,ri)=>`<span class="pdf-match-right-item"><b>${['A','B','C','D','E','F'][ri]}.</b> ${rm(r)}</span>`).join('')}</div>` : ''}
      </div>`;
    } else if (q.type === 'short') {
      const ansVal = (q.answer !== null && q.answer !== undefined && String(q.answer).trim())
        ? `<b class="ans-d">${escH(String(q.answer))}</b>`
        : '<span class="ans-none">? (chưa đọc được)</span>';
      detail = `<div class="pdf-prev-short">Đáp số: ${ansVal}</div>`;
    }

    // Ảnh đã crop/upload
    const imgPreview = q._image
      ? `<div class="pdf-prev-img-wrap">
           <img src="${q._image}" class="pdf-prev-img" alt="Hình vẽ câu ${i+1}"/>
           <button class="pdf-prev-img-del" onclick="removePrevImage(${i})" title="Xóa ảnh">✕</button>
         </div>`
      : '';

    return `<div class="pdf-prev-item" id="pdf-prev-item-${i}">
      <div class="pdf-prev-header">
        <span class="pdf-prev-num">Câu ${i+1}</span>
        <span class="bank-card-type ${typeClass}">${typeLabel}</span>
        ${ansBadge}
        ${hasImg}
        ${cropBtn}
        <label class="pdf-prev-check-wrap">
          <input type="checkbox" class="pdf-prev-check" data-idx="${i}" checked/>
          <span>Chọn</span>
        </label>
      </div>
      <div class="pdf-prev-q">${rm(q.question)}</div>
      ${imgPreview}
      ${hasImageRef(q) && !q._image ? `<div class="pdf-img-notice">🖼️ Câu này có hình vẽ/đồ thị — nhấn <b>📷 Chọn ảnh</b> để crop từ PDF.</div>` : ''}
      ${detail}
    </div>`;
  }).join('');

  // Re-render KaTeX sau khi DOM cập nhật
  if (window.katex) {
    setTimeout(() => {
      document.querySelectorAll('#pdf-preview-list .math-pending').forEach(el => {
        const raw = el.textContent;
        el.outerHTML = renderMathHTML(raw);
      });
    }, 50);
  }
}

function checkParsedAnswer(q) {
  if (q.type === 'mcq')       return q.answer !== null && q.answer !== undefined;
  if (q.type === 'short')     return q.answer !== null && q.answer !== undefined && String(q.answer).trim() !== '';
  if (q.type === 'truefalse') return Array.isArray(q.answers) && q.answers.some(v => v === 'D' || v === 'S');
  if (q.type === 'matching')  return Array.isArray(q.answers) && q.answers.some(v => v !== null && v !== undefined);
  return false;
}

// Phát hiện câu hỏi có đề cập đến hình vẽ / đồ thị / bảng số liệu
function hasImageRef(q) {
  const keywords = /hình\s*vẽ|đồ\s*thị|bảng\s*số\s*liệu|bảng\s*tần\s*số|hình\s*chóp|hình\s*hộp|hình\s*cầu|hình\s*trụ|hình\s*nón|như\s*sau|dưới\s*đây/i;
  const allText = [q.question, ...(q.statements||[]), ...(q.options||[]), ...(q.left||[])].join(' ');
  return keywords.test(allText);
}

// ══════════════════════════════════════════
//  CONFIRM IMPORT
// ══════════════════════════════════════════
function confirmPdfImport() {
  if (!_parsedQuestions.length) return;
  const checked = document.querySelectorAll('.pdf-prev-check:checked');
  const selectedIdxs = new Set([...checked].map(c => parseInt(c.dataset.idx)));
  const toAdd = _parsedQuestions.filter((_, i) => selectedIdxs.has(i)).map(q => {
    const item = { ...q, id: uid() };
    if (q._image) item.image = q._image;
    delete item._image;
    return item;
  });
  if (!toAdd.length) { alert('Vui lòng chọn ít nhất 1 câu hỏi.'); return; }

  // Đọc mode TRƯỚC khi đóng modal
  const savingToSets = !!_setsImportMode;
  closePdfImportModal();

  // ── Lưu vào kho đề → mở modal đặt tên + môn ──
  if (savingToSets) {
    openSetNameModal('Đề PDF mới', (typeof config !== 'undefined' ? config.time : 90), toAdd, 'Toán');
    return;
  }

  // ── Lưu vào ngân hàng → mở modal chọn môn ──
  openBankSubjectModal(toAdd);
}

// Modal chọn môn khi thêm vào ngân hàng từ PDF
function openBankSubjectModal(questions) {
  // Tạo modal nếu chưa có
  let modal = document.getElementById('bank-subject-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bank-subject-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:380px">
        <div class="modal-header">
          <h3>📚 Chọn môn học cho ngân hàng</h3>
          <button class="modal-x-close" onclick="document.getElementById('bank-subject-modal').classList.add('hidden')">✕</button>
        </div>
        <div class="modal-body" style="padding:1rem 1.3rem">
          <div class="bedit-group">
            <label class="bedit-label">Môn học</label>
            <select class="bedit-select" id="bsm-subject">
              <option value="Toán">Toán</option>
              <option value="Ngữ Văn">Ngữ Văn</option>
              <option value="Vật Lý">Vật Lý</option>
              <option value="Hóa Học">Hóa Học</option>
              <option value="Sinh Học">Sinh Học</option>
              <option value="Lịch Sử">Lịch Sử</option>
              <option value="Địa Lý">Địa Lý</option>
              <option value="Khác">Khác</option>
            </select>
          </div>
          <div id="bsm-info" style="font-size:.8rem;color:var(--text-muted);margin-top:.4rem"></div>
        </div>
        <div class="modal-actions">
          <button class="modal-cancel" onclick="document.getElementById('bank-subject-modal').classList.add('hidden')">Huỷ</button>
          <button class="modal-confirm" id="bsm-confirm" style="background:var(--success)">✅ Thêm vào ngân hàng</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const withAns = questions.filter(checkParsedAnswer).length;
  const withImg = questions.filter(q => q.image).length;
  document.getElementById('bsm-info').textContent =
    `${questions.length} câu (${withAns} có đáp án${withImg ? `, ${withImg} có ảnh` : ''})`;

  modal.classList.remove('hidden');

  // Gán handler
  const confirmBtn = document.getElementById('bsm-confirm');
  confirmBtn.onclick = () => {
    const subject = document.getElementById('bsm-subject').value || 'Toán';
    modal.classList.add('hidden');

    // Thêm subject vào từng câu
    const toAdd = questions.map(q => ({ ...q, subject }));
    bank.push(...toAdd);
    saveBank();
    if (typeof populateSubjectFilters === 'function') populateSubjectFilters();
    renderBankList();

    showToast(`✅ Đã thêm ${toAdd.length} câu vào ngân hàng môn ${subject}`);
  };
}

function selectAllPdfItems(v) {
  document.querySelectorAll('.pdf-prev-check').forEach(c => c.checked = v);
}

// ══════════════════════════════════════════
//  MANUAL IMAGE UPLOAD (khi không có canvas)
// ══════════════════════════════════════════
function handleManualImageUpload(e, qIdx) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    _parsedQuestions[qIdx]._image = ev.target.result;
    // Re-render chỉ item đó
    rerenderPrevItem(qIdx);
  };
  reader.readAsDataURL(file);
}

function removePrevImage(qIdx) {
  delete _parsedQuestions[qIdx]._image;
  rerenderPrevItem(qIdx);
}

function rerenderPrevItem(qIdx) {
  // Re-render toàn bộ preview để cập nhật item
  renderPdfPreview(_parsedQuestions);
}

// ══════════════════════════════════════════
//  CROP MODAL
// ══════════════════════════════════════════
function openCropModal(qIdx) {
  if (!_pdfPageCanvases.length) return;
  _cropTargetIdx = qIdx;
  _cropPageIdx   = 0;
  _cropRect      = null;

  const modal = document.getElementById('pdf-crop-modal');
  modal.classList.remove('hidden');

  // Build page selector
  const sel = document.getElementById('crop-page-select');
  sel.innerHTML = _pdfPageCanvases.map((_, i) =>
    `<option value="${i}">Trang ${i+1}</option>`
  ).join('');
  sel.value = 0;

  renderCropCanvas(0);
}

function closeCropModal() {
  document.getElementById('pdf-crop-modal').classList.add('hidden');
  _cropTargetIdx = -1;
  _cropRect = null;
}

function renderCropCanvas(pageIdx) {
  _cropPageIdx = pageIdx;
  _cropRect    = null;

  const src     = _pdfPageCanvases[pageIdx];
  const display = document.getElementById('crop-canvas');
  const wrap    = document.getElementById('crop-canvas-wrap');

  // Scale để vừa modal (max 700px wide)
  const maxW = Math.min(700, wrap.clientWidth || 700);
  _cropScale = maxW / src.width;

  display.width  = Math.round(src.width  * _cropScale);
  display.height = Math.round(src.height * _cropScale);
  display.style.width  = display.width  + 'px';
  display.style.height = display.height + 'px';

  const ctx = display.getContext('2d');
  ctx.drawImage(src, 0, 0, display.width, display.height);

  // Reset overlay
  const overlay = document.getElementById('crop-overlay');
  overlay.style.cssText = 'display:none';
}

function getCropCanvasPos(e) {
  const canvas = document.getElementById('crop-canvas');
  const rect   = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: Math.max(0, Math.min(clientX - rect.left, canvas.width)),
    y: Math.max(0, Math.min(clientY - rect.top,  canvas.height))
  };
}

function onCropMouseDown(e) {
  e.preventDefault();
  _cropDragging = true;
  const pos = getCropCanvasPos(e);
  _cropStart = pos;
  _cropRect  = { x: pos.x, y: pos.y, w: 0, h: 0 };
  updateCropOverlay();
}

function onCropMouseMove(e) {
  if (!_cropDragging) return;
  e.preventDefault();
  const pos = getCropCanvasPos(e);
  _cropRect = {
    x: Math.min(_cropStart.x, pos.x),
    y: Math.min(_cropStart.y, pos.y),
    w: Math.abs(pos.x - _cropStart.x),
    h: Math.abs(pos.y - _cropStart.y)
  };
  updateCropOverlay();
}

function onCropMouseUp(e) {
  if (!_cropDragging) return;
  _cropDragging = false;
  if (_cropRect && _cropRect.w > 10 && _cropRect.h > 10) {
    showCropPreview();
  }
}

function updateCropOverlay() {
  if (!_cropRect) return;
  const canvas  = document.getElementById('crop-canvas');
  const overlay = document.getElementById('crop-overlay');
  const cRect   = canvas.getBoundingClientRect();
  const wRect   = document.getElementById('crop-canvas-wrap').getBoundingClientRect();

  overlay.style.display  = 'block';
  overlay.style.left     = (cRect.left - wRect.left + _cropRect.x) + 'px';
  overlay.style.top      = (cRect.top  - wRect.top  + _cropRect.y) + 'px';
  overlay.style.width    = _cropRect.w + 'px';
  overlay.style.height   = _cropRect.h + 'px';
}

function showCropPreview() {
  if (!_cropRect || _cropRect.w < 5 || _cropRect.h < 5) return;

  // Convert display coords → actual canvas coords
  const ax = Math.round(_cropRect.x / _cropScale);
  const ay = Math.round(_cropRect.y / _cropScale);
  const aw = Math.round(_cropRect.w / _cropScale);
  const ah = Math.round(_cropRect.h / _cropScale);

  const dataUrl = cropCanvasRegion(_cropPageIdx, ax, ay, aw, ah);
  if (!dataUrl) return;

  const prev = document.getElementById('crop-result-preview');
  prev.src = dataUrl;
  prev.style.display = 'block';
  document.getElementById('crop-confirm-btn').disabled = false;
  document.getElementById('crop-result-wrap').classList.remove('hidden');
}

function confirmCrop() {
  if (_cropTargetIdx < 0 || !_cropRect) return;

  const ax = Math.round(_cropRect.x / _cropScale);
  const ay = Math.round(_cropRect.y / _cropScale);
  const aw = Math.round(_cropRect.w / _cropScale);
  const ah = Math.round(_cropRect.h / _cropScale);

  const dataUrl = cropCanvasRegion(_cropPageIdx, ax, ay, aw, ah);
  if (!dataUrl) return;

  _parsedQuestions[_cropTargetIdx]._image = dataUrl;
  closeCropModal();
  renderPdfPreview(_parsedQuestions);
}

function resetCropSelection() {
  _cropRect = null;
  // Ẩn preview
  document.getElementById('crop-result-wrap').classList.add('hidden');
  document.getElementById('crop-confirm-btn').disabled = true;
  // Xóa overlay
  const overlay = document.getElementById('crop-overlay');
  if (overlay) overlay.style.display = 'none';
  // Vẽ lại canvas sạch
  renderCropCanvas(_cropPageIdx);
}

// ══════════════════════════════════════════
//  INIT CROP MODAL EVENTS
// ══════════════════════════════════════════
function initCropModal() {
  // Tạo modal crop nếu chưa có
  if (document.getElementById('pdf-crop-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'pdf-crop-modal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-box modal-crop">
      <div class="modal-header">
        <h3>✂️ Chọn vùng ảnh từ PDF</h3>
        <button class="modal-x-close" onclick="closeCropModal()">✕</button>
      </div>
      <div class="modal-body crop-modal-body">
        <div class="crop-controls">
          <label class="crop-ctrl-label">Trang:</label>
          <select id="crop-page-select" class="crop-page-sel" onchange="renderCropCanvas(+this.value)"></select>
          <span class="crop-hint">🖱️ Kéo để chọn vùng ảnh</span>
        </div>
        <div class="crop-canvas-wrap" id="crop-canvas-wrap">
          <canvas id="crop-canvas"
            onmousedown="onCropMouseDown(event)"
            onmousemove="onCropMouseMove(event)"
            onmouseup="onCropMouseUp(event)"
            ontouchstart="onCropMouseDown(event)"
            ontouchmove="onCropMouseMove(event)"
            ontouchend="onCropMouseUp(event)"
            style="cursor:crosshair;display:block;max-width:100%"></canvas>
          <div id="crop-overlay" class="crop-overlay"></div>
        </div>
        <div id="crop-result-wrap" class="crop-result-wrap hidden">
          <div class="crop-result-label">
            Xem trước vùng đã chọn:
            <button class="crop-reset-btn" onclick="resetCropSelection()" title="Chọn lại vùng khác">↺ Chọn lại</button>
          </div>
          <img id="crop-result-preview" class="crop-result-img" src="" alt="preview"/>
        </div>
      </div>
      <div class="modal-actions">
        <button class="modal-cancel" onclick="closeCropModal()">Huỷ</button>
        <button class="modal-confirm" id="crop-confirm-btn" onclick="confirmCrop()" disabled>✅ Dùng ảnh này</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
function initPdfImport() {
  initCropModal();

  // bank-pdf-btn is handled in exam.js DOMContentLoaded
  document.getElementById('pdf-modal-close').addEventListener('click', closePdfImportModal);
  document.getElementById('pdf-modal-cancel').addEventListener('click', closePdfImportModal);

  // File đề
  document.getElementById('pdf-file-input-modal').addEventListener('change', handlePdfFileSelect);
  document.getElementById('pdf-drop-zone').addEventListener('click', () =>
    document.getElementById('pdf-file-input-modal').click()
  );
  const dz = document.getElementById('pdf-drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') handlePdfFileSelect({ target: { files: [f] } });
  });

  // File đáp án
  document.getElementById('pdf-ans-file-input').addEventListener('change', handleAnsFileSelect);
  document.getElementById('pdf-ans-drop-zone').addEventListener('click', () =>
    document.getElementById('pdf-ans-file-input').click()
  );
  const adz = document.getElementById('pdf-ans-drop-zone');
  adz.addEventListener('dragover', e => { e.preventDefault(); adz.classList.add('drag-over'); });
  adz.addEventListener('dragleave', () => adz.classList.remove('drag-over'));
  adz.addEventListener('drop', e => {
    e.preventDefault(); adz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') handleAnsFileSelect({ target: { files: [f] } });
  });

  document.getElementById('pdf-modal-confirm').addEventListener('click', confirmPdfImport);
  document.getElementById('pdf-select-all').addEventListener('click', () => selectAllPdfItems(true));
  document.getElementById('pdf-deselect-all').addEventListener('click', () => selectAllPdfItems(false));
}

document.addEventListener('DOMContentLoaded', initPdfImport);

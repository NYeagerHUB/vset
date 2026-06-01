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

// Expose để exam.js có thể đọc số trang sau khi render
Object.defineProperty(window, '_pdfPageCanvases', {
  get: () => _pdfPageCanvases,
  configurable: true
});

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
 * Hỗ trợ 3 format:
 *   1. V-SAT thuần: "Đ Đ S S", "Chọn A", "1–D; 2–C"
 *   2. THPT thử (lời giải): "Chọn A", "» Chọn ĐÚNG/SAI", "✓ Trả lời: X"
 *   3. V-SAT kèm lời giải (Hóa/Lý): dấu X trong bảng, "→ Đáp án: 1e,2a", "→ Đáp án: 3358"
 */
function parseVSATAnswers(rawText) {
  const answerMap = new Map();

  const text = rawText
    .replace(/HỆ THỐNG GIÁO DỤC EMPIRE TEAM/gi, '')
    .replace(/CHINH PHỤC MỌI MIỀN KIẾN THỨC/gi, '')
    .replace(/BỘ ĐỀ ĐÁNH GIÁ NĂNG LỰC V-SAT/gi, '')
    .replace(/BỘ ĐỀ ĐGNL V-SAT[^\n]*/gi, '')
    .replace(/\[EMPIRE TEAM\]/gi, '')
    .replace(/---\s*PAGE\s*\d+\s*---/gi, '')
    .replace(/Trang\s+\d+\s*/gi, '')
    .replace(/^\s*\d{1,2}\s*$/gm, '')
    .replace(/[ \t]+/g, ' ');

  const blockPattern = /(?:»\s*)?Câu\s+(\d+)[.:)][^\n]*([\s\S]*?)(?=(?:»\s*)?Câu\s+\d+[.:)]|$)/gi;
  let m;
  while ((m = blockPattern.exec(text)) !== null) {
    const qNum  = parseInt(m[1]);
    const block = m[0];

    // ── 1. Matching format mới: "→ Đáp án 1e, 2a, 3c, 4b" ──
    const matchingArrow = block.match(/→\s*Đáp\s*án\s*:?\s*((?:\d+\s*[a-f]\s*[,;]?\s*){2,})/i);
    if (matchingArrow) {
      const mpairs = [...matchingArrow[1].matchAll(/(\d+)\s*([a-f])/gi)];
      if (mpairs.length >= 2) {
        const answers = new Array(4).fill(null);
        mpairs.forEach(p => {
          const pos = parseInt(p[1]) - 1;
          const val = p[2].toLowerCase().charCodeAt(0) - 97;
          if (pos >= 0 && pos < 4) answers[pos] = val;
        });
        answerMap.set(qNum, { type: 'matching', answers });
        continue;
      }
    }

    // ── 2. Matching format cũ: "1 – D; 2 – C" ──
    const pairs = [...block.matchAll(/(\d+)\s*[–\-]\s*([A-F])/gi)];
    if (pairs.length >= 2) {
      const answers = new Array(4).fill(null);
      pairs.forEach(p => {
        const idx = parseInt(p[1]) - 1;
        const val = p[2].toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < 4) answers[idx] = val;
      });
      answerMap.set(qNum, { type: 'matching', answers });
      continue;
    }

    // ── 3. TF bảng X: "a. [text] X" hoặc "a. [text]\nX" ──
    const tfX = _parseTFTableX(block);
    if (tfX) {
      answerMap.set(qNum, { type: 'truefalse', answers: tfX });
      continue;
    }

    // ── 4. TF: "Đ Đ S S" ──
    const tfMatch = block.match(/(?:^|[\s\n\r:;.,])([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])(?:\s|[.:;,\n\r]|$)/m);
    if (tfMatch) {
      answerMap.set(qNum, { type: 'truefalse', answers: [tfMatch[1],tfMatch[2],tfMatch[3],tfMatch[4]].map(c => c.toUpperCase()==='Đ'?'D':'S') });
      continue;
    }

    const tfCompact = block.match(/(?:^|[\s\n\r:;.,])([ĐSđs])([ĐSđs])([ĐSđs])([ĐSđs])(?:\s|[.:;,\n\r]|$)/m);
    if (tfCompact) {
      answerMap.set(qNum, { type: 'truefalse', answers: [tfCompact[1],tfCompact[2],tfCompact[3],tfCompact[4]].map(c => c.toUpperCase()==='Đ'?'D':'S') });
      continue;
    }

    // ── 5. TF: "Đúng Sai Sai Đúng" ──
    const tfFull = block.match(/(?:^|[\s\n\r])((Đúng|Sai)\s+(Đúng|Sai)\s+(Đúng|Sai)\s+(Đúng|Sai))(?:\s|[.\n\r]|$)/im);
    if (tfFull) {
      answerMap.set(qNum, { type: 'truefalse', answers: [tfFull[2],tfFull[3],tfFull[4],tfFull[5]].map(c => c.toLowerCase()==='đúng'?'D':'S') });
      continue;
    }

    // ── 6. TF: "» Chọn ĐÚNG/SAI" rải rác ──
    const tfScattered = [...block.matchAll(/(?:»\s*)?Chọn\s+(ĐÚNG|SAI|đúng|sai)\b/gi)];
    if (tfScattered.length >= 2) {
      const answers = tfScattered.slice(0, 4).map(sm => sm[1].toUpperCase()==='ĐÚNG'?'D':'S');
      while (answers.length < 4) answers.push(null);
      answerMap.set(qNum, { type: 'truefalse', answers });
      continue;
    }

    // ── 7. MCQ: "→ Đáp án: A" hoặc "Chọn A" ──
    const mcqArrow = block.match(/→\s*(?:Đáp\s*án|Chọn)\s*:?\s*([A-D])(?:\s|[.:;,\n\r]|$)/i);
    if (mcqArrow) {
      answerMap.set(qNum, { type: 'mcq', answer: ['A','B','C','D'].indexOf(mcqArrow[1].toUpperCase()) });
      continue;
    }
    const chooseMatch = block.match(/Chọn\s*:?\s*([A-D])(?:\s|[.:;,\n\r]|$)/i);
    if (chooseMatch) {
      answerMap.set(qNum, { type: 'mcq', answer: ['A','B','C','D'].indexOf(chooseMatch[1].toUpperCase()) });
      continue;
    }

    // ── 8. Short: "→ Đáp án: X" / "✓ Trả lời: X" / "Đáp số: X" ──
    const shortPatterns = [
      /→\s*Đáp\s*án\s*:?\s*([\d.,/\-]+)/i,
      /[✓✔]\s*Trả\s*lời\s*[:.]\s*([\d.,/\s\-]+)/i,
      /Đáp\s*số\s*[:.]\s*([\d.,/\-]+)/i,
      /Trả\s*lời\s*[:.]\s*([\d.,/\-]+)/i,
    ];
    for (const pat of shortPatterns) {
      const sm = block.match(pat);
      if (sm) {
        let val = sm[1].trim().replace(/\s+/g,'').replace(/,(?=\d)/g,'.').replace(/[.\s]+$/,'');
        if (val) { answerMap.set(qNum, { type: 'short', answer: val }); break; }
      }
    }
  }

  // ── FALLBACK: scan toàn bộ text ──
  const tfFallbackPattern = /(?:»\s*)?Câu\s+(\d+)[^]*?(?<![a-zA-ZĐđSs])([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])\s+([ĐSđs])(?![a-zA-ZĐđSs])/g;
  let tfm;
  while ((tfm = tfFallbackPattern.exec(text)) !== null) {
    const qNum = parseInt(tfm[1]);
    if (!answerMap.has(qNum)) {
      answerMap.set(qNum, { type: 'truefalse', answers: [tfm[2],tfm[3],tfm[4],tfm[5]].map(c=>c.toUpperCase()==='Đ'?'D':'S') });
    }
  }

  const tfFullFallback = /(?:»\s*)?Câu\s+(\d+)[^]*?(Đúng|Sai)\s+(Đúng|Sai)\s+(Đúng|Sai)\s+(Đúng|Sai)(?:\s|[.\n\r]|$)/gi;
  let tfm2;
  while ((tfm2 = tfFullFallback.exec(text)) !== null) {
    const qNum = parseInt(tfm2[1]);
    if (!answerMap.has(qNum)) {
      answerMap.set(qNum, { type: 'truefalse', answers: [tfm2[2],tfm2[3],tfm2[4],tfm2[5]].map(c=>c.toLowerCase()==='đúng'?'D':'S') });
    }
  }

  return answerMap;
}

/**
 * Parse TF từ bảng có dấu X (format Hóa/Lý V-SAT kèm lời giải)
 * "a. [text] X" = Đúng, "a. [text]" không có X = Sai
 */
function _parseTFTableX(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l);
  const stmtMap = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "a. [text] X" — X ở cuối = Đúng
    const inlineX = line.match(/^([a-d])[.)]\s+.+\s+X\s*$/i);
    if (inlineX) { stmtMap[inlineX[1].toLowerCase()] = 'D'; continue; }

    // "a. [text]" — kiểm tra dòng tiếp theo có X không
    const stmtOnly = line.match(/^([a-d])[.)]\s+(.+)$/i);
    if (stmtOnly) {
      const letter = stmtOnly[1].toLowerCase();
      const next = lines[i + 1] || '';
      if (/^X\s*$/i.test(next)) { stmtMap[letter] = 'D'; i++; }
      else { stmtMap[letter] = 'S'; }
    }
  }

  const keys = ['a','b','c','d'];
  if (keys.every(k => stmtMap[k])) return keys.map(k => stmtMap[k]);
  return null;
}

/**
 * normalizeAIStudioJSON(questions)
 * Chuẩn hóa JSON từ Google AI Studio về format web dùng:
 *   - TF: "T"→"D", "F"→"S"
 *   - MCQ: right["Ⓓ"] → answer: 3
 *   - Matching: statements["1 - A, 2 - C"] → answers: [0, 2, ...]
 */
function normalizeAIStudioJSON(questions) {
  const circledMap = {'Ⓐ':0,'Ⓑ':1,'Ⓒ':2,'Ⓓ':3,'Ⓔ':4,'Ⓕ':5,
                      'A':0,'B':1,'C':2,'D':3,'E':4,'F':5};

  return questions.map(q => {
    const out = { ...q };

    // ── Truefalse: "T"→"D", "F"→"S" ──
    if (q.type === 'truefalse' && Array.isArray(q.answers)) {
      out.answers = q.answers.map(a => {
        if (a === 'T' || a === 'Đ' || a === 'D') return 'D';
        if (a === 'F' || a === 'S')               return 'S';
        return a; // null hoặc giá trị khác giữ nguyên
      });
    }

    // ── MCQ: lấy đáp án từ right[] hoặc answer ──
    if (q.type === 'mcq') {
      // right: ["Ⓓ"] hoặc answer: "3" hoặc answer: "D"
      if (Array.isArray(q.right) && q.right.length > 0) {
        const raw = q.right[0].trim();
        const idx = circledMap[raw] ?? circledMap[raw.replace(/[^A-FⒶ-Ⓕ]/g,'')] ?? null;
        if (idx !== null) out.answer = String(idx);
      } else if (q.answer !== null && q.answer !== undefined) {
        const raw = String(q.answer).trim();
        // "D" → 3, "Ⓓ" → 3, "3" → giữ nguyên
        const idx = circledMap[raw];
        if (idx !== undefined) out.answer = String(idx);
      }
    }

    // ── Matching: parse "1 - A, 2 - C, 3 - B, 4 - F" từ statements[0] ──
    if (q.type === 'matching') {
      const src = Array.isArray(q.statements) ? q.statements[0] : null;
      if (src && typeof src === 'string' && /\d\s*[-–]\s*[A-FⒶ-Ⓕ]/i.test(src)) {
        const pairs = [...src.matchAll(/(\d+)\s*[-–]\s*([A-FⒶ-Ⓕ])/gi)];
        if (pairs.length >= 2) {
          const answers = new Array(q.left?.length || 4).fill(null);
          pairs.forEach(p => {
            const pos = parseInt(p[1]) - 1;
            const letter = p[2].trim();
            const val = circledMap[letter] ?? (letter.toUpperCase().charCodeAt(0) - 65);
            if (pos >= 0 && pos < answers.length) answers[pos] = val;
          });
          out.answers = answers;
          out.statements = []; // xóa statements giả
        }
      }
      // Chuẩn hóa right[]: bỏ ký tự Ⓐ Ⓑ... chỉ giữ text
      if (Array.isArray(q.right)) {
        out.right = q.right.map(r =>
          r.replace(/^[ⒶⒷⒸⒹⒺⒻA-F]\s*/i, '').trim()
        );
      }
    }

    return out;
  });
}

/**
 * Ghép đáp án từ PDF vào câu hỏi đã parse
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
let _needImgFilterOn = false; // filter chỉ hiện câu cần ảnh

function toggleNeedImgFilter() {
  _needImgFilterOn = !_needImgFilterOn;
  const btn = document.getElementById('pdf-stat-needimg-btn');
  if (btn) btn.classList.toggle('active', _needImgFilterOn);

  const list = document.getElementById('pdf-preview-list');
  if (!list) return;

  // Ẩn/hiện từng item
  list.querySelectorAll('.pdf-prev-item').forEach((item, i) => {
    const q = _parsedQuestions[i];
    if (!q) return;
    const needsImg = hasImageRef(q) && !q._image && !q.image;
    if (_needImgFilterOn) {
      item.style.display = needsImg ? '' : 'none';
    } else {
      item.style.display = '';
    }
  });

  // Cập nhật label
  if (btn) {
    btn.title = _needImgFilterOn ? 'Đang lọc — click để xem tất cả' : 'Lọc chỉ hiện câu cần ảnh';
  }
}

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
  // Cleanup JSON+PDF mode state
  if (typeof _resetJspdfState === 'function') _resetJspdfState();
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
//  SAFE LATEX RENDER — không crash khi KaTeX lỗi
// ══════════════════════════════════════════
function safeRenderMath(str) {
  if (!str) return '';
  // Nếu KaTeX chưa load → trả về text thô (sẽ re-render sau)
  if (!window.katex) return `<span class="math-pending">${escH(str)}</span>`;

  // Tách text và math tokens
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
  const parts = [];
  let last = 0, m;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(str)) !== null) {
    if (m.index > last) parts.push({ type: 'text', val: str.slice(last, m.index) });
    parts.push({ type: 'math', val: m[0] });
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push({ type: 'text', val: str.slice(last) });
  if (!parts.length) return escH(str);

  return parts.map(p => {
    if (p.type === 'text') return escH(p.val);
    const isDisplay = p.val.startsWith('$$') || p.val.startsWith('\\[');
    let inner = p.val;
    if (inner.startsWith('$$'))     inner = inner.slice(2, -2);
    else if (inner.startsWith('$')) inner = inner.slice(1, -1);
    else if (inner.startsWith('\\[')) inner = inner.slice(2, -2);
    else if (inner.startsWith('\\(')) inner = inner.slice(2, -2);
    try {
      return window.katex.renderToString(inner.trim(), {
        throwOnError: false,
        displayMode: isDisplay,
        output: 'html',
        trust: false,
        strict: false,
        macros: { '\\R':'\\mathbb{R}', '\\N':'\\mathbb{N}', '\\Z':'\\mathbb{Z}' }
      });
    } catch {
      // Lỗi LaTeX → hiện text gốc thay vì crash
      return `<span class="latex-error" title="LaTeX lỗi">${escH(p.val)}</span>`;
    }
  }).join('');
}

// Re-render tất cả math-pending sau khi KaTeX load xong
document.addEventListener('katex-ready', () => {
  document.querySelectorAll('#pdf-preview-list .math-pending').forEach(el => {
    const raw = el.textContent;
    const tmp = document.createElement('span');
    tmp.innerHTML = safeRenderMath(raw);
    el.replaceWith(...tmp.childNodes);
  });
});

// ══════════════════════════════════════════
//  TÍNH SỐ TRANG GỢI Ý cho câu có hình
//  Ước tính: mỗi trang ~3-4 câu, câu i → trang floor(i/3)
// ══════════════════════════════════════════
function guessPageForQuestion(qIdx, totalPages) {
  if (!totalPages) return null;
  // Ước tính dựa trên vị trí câu trong đề
  const approxPage = Math.floor(qIdx / 3);
  return Math.min(approxPage, totalPages - 1);
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

  const hasPdfCanvas = _pdfPageCanvases.length > 0;

  document.getElementById('pdf-preview-list').innerHTML = questions.map((q, i) => {
    const typeLabel = { truefalse:'Đ/S', mcq:'TN', matching:'Ghép', short:'TLN' }[q.type] || q.type;
    const typeClass = q.type;

    // Badge đáp án
    const hasAns = checkParsedAnswer(q);
    const ansBadge = hasAns
      ? `<span class="pdf-ans-ok">🔑 Có đáp án</span>`
      : `<span class="pdf-ans-no">— Chưa có đáp án</span>`;

    // Badge ảnh đã crop
    const hasImgBadge = q._image ? `<span class="pdf-img-badge">🖼️ Có ảnh</span>` : '';

    // Nút crop — nếu câu có hình ref thì gợi ý trang
    const needsImg = hasImageRef(q) && !q._image;
    const guessedPage = needsImg ? guessPageForQuestion(i, _pdfPageCanvases.length) : null;
    const pageHint = (guessedPage !== null) ? ` data-page="${guessedPage}"` : '';

    const cropBtn = hasPdfCanvas
      ? `<button class="pdf-crop-btn${needsImg ? ' pdf-crop-btn-warn' : ''}"
           onclick="openCropModal(${i}, ${guessedPage ?? 0})"
           title="Crop ảnh từ PDF${guessedPage !== null ? ' · gợi ý trang ' + (guessedPage+1) : ''}"
           ${pageHint}>
           📷 ${needsImg ? `Crop ảnh (tr.${(guessedPage??0)+1})` : 'Chọn ảnh'}
         </button>`
      : `<label class="pdf-crop-btn pdf-upload-img-btn" title="Upload ảnh thủ công">
           📷 Thêm ảnh
           <input type="file" accept="image/*" style="display:none" onchange="handleManualImageUpload(event,${i})"/>
         </label>`;

    // ── Chi tiết câu hỏi với LaTeX + input điền đáp án ──
    let detail = '';
    if (q.type === 'truefalse') {
      detail = `<div class="pdf-prev-stmts">${(q.statements||[]).map((s, si) => {
        const ans = q.answers?.[si];
        return `<div class="pdf-prev-stmt">
          <span class="pdf-stmt-label">${['a','b','c','d'][si]})</span>
          <span class="pdf-stmt-text">${safeRenderMath(s)}</span>
          <span class="pdf-stmt-ans-wrap">
            <button class="tf-ans-btn ${ans==='D'?'active-d':''}" onclick="setPrevTFAnswer(${i},${si},'D')">Đ</button>
            <button class="tf-ans-btn ${ans==='S'?'active-s':''}" onclick="setPrevTFAnswer(${i},${si},'S')">S</button>
          </span>
        </div>`;
      }).join('')}</div>`;

    } else if (q.type === 'mcq') {
      detail = `<div class="pdf-prev-opts">${(q.options||[]).map((o, oi) => {
        const isAns = q.answer !== null && q.answer !== undefined && Number(q.answer) === oi;
        return `<div class="pdf-prev-opt ${isAns ? 'opt-correct' : ''}" onclick="setPrevMCQAnswer(${i},${oi})" style="cursor:pointer">
          <span class="pdf-opt-label">${['A','B','C','D'][oi]}.</span>
          ${safeRenderMath(o)}
          ${isAns ? '<span class="opt-check">✓</span>' : ''}
        </div>`;
      }).join('')}</div>`;

    } else if (q.type === 'matching') {
      detail = `<div class="pdf-prev-match">
        ${(q.left||[]).map((l, li) => {
          const ans = q.answers?.[li];
          const rightLabels = ['A','B','C','D','E','F'];
          return `<div class="pdf-match-row">
            <span class="pdf-match-left">${li+1}. ${safeRenderMath(l)}</span>
            <select class="pdf-match-sel" onchange="setPrevMatchAnswer(${i},${li},this.value)">
              <option value="">?</option>
              ${(q.right||[]).map((r,ri) =>
                `<option value="${ri}" ${ans===ri||ans===String(ri)?'selected':''}>${rightLabels[ri]}</option>`
              ).join('')}
            </select>
          </div>`;
        }).join('')}
        ${q.right?.length ? `<div class="pdf-match-right-list">${q.right.map((r,ri) =>
          `<span class="pdf-match-right-item"><b>${['A','B','C','D','E','F'][ri]}.</b> ${safeRenderMath(r)}</span>`
        ).join('')}</div>` : ''}
      </div>`;

    } else if (q.type === 'short') {
      const curVal = (q.answer !== null && q.answer !== undefined) ? String(q.answer) : '';
      detail = `<div class="pdf-prev-short">
        <span class="pdf-short-label">Đáp số:</span>
        <input class="pdf-short-input" type="text" value="${escH(curVal)}"
          placeholder="Nhập đáp án..."
          oninput="setPrevShortAnswer(${i}, this.value)"/>
      </div>`;
    }

    // Ảnh đã crop/upload
    const imgPreview = q._image
      ? `<div class="pdf-prev-img-wrap">
           <img src="${q._image}" class="pdf-prev-img" alt="Hình vẽ câu ${i+1}"/>
           <button class="pdf-prev-img-del" onclick="removePrevImage(${i})" title="Xóa ảnh">✕</button>
         </div>`
      : '';

    // Notice câu cần ảnh
    const imgNotice = needsImg
      ? `<div class="pdf-img-notice">
           🖼️ Câu này có hình vẽ/đồ thị — nhấn
           <b>📷 Crop ảnh (tr.${(guessedPage??0)+1})</b> để chọn vùng từ PDF.
         </div>`
      : '';

    return `<div class="pdf-prev-item" id="pdf-prev-item-${i}">
      <div class="pdf-prev-header">
        <span class="pdf-prev-num">Câu ${i+1}</span>
        <span class="bank-card-type ${typeClass}">${typeLabel}</span>
        ${ansBadge}
        ${hasImgBadge}
        ${cropBtn}
        <label class="pdf-prev-check-wrap">
          <input type="checkbox" class="pdf-prev-check" data-idx="${i}" checked/>
          <span>Chọn</span>
        </label>
      </div>
      <div class="pdf-prev-q">${safeRenderMath(q.question)}</div>
      ${imgPreview}
      ${imgNotice}
      ${detail}
    </div>`;
  }).join('');

  // Re-render math-pending nếu KaTeX chưa load kịp
  if (window.katex) {
    requestAnimationFrame(() => {
      document.querySelectorAll('#pdf-preview-list .math-pending').forEach(el => {
        const raw = el.textContent;
        const tmp = document.createElement('span');
        tmp.innerHTML = safeRenderMath(raw);
        el.replaceWith(...tmp.childNodes);
      });
    });
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
  // Trong mode JSON+PDF, đảm bảo _parsedQuestions được sync từ _jspdfQuestions
  if (_importMode === 'json-pdf' && _jspdfQuestions.length > 0 && !_parsedQuestions.length) {
    _parsedQuestions = _jspdfQuestions.map(q => ({ ...q }));
  }

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
  // Dùng title modal làm fallback vì _setsImportMode có thể bị override
  const titleEl2 = document.querySelector('#pdf-import-modal .modal-header h3');
  const titleText = titleEl2 ? titleEl2.textContent : '';
  const savingToSets = !!_setsImportMode || titleText.includes('Kho đề');
  closePdfImportModal();

  // ── Lưu vào kho đề → mở modal đặt tên + môn ──
  if (savingToSets) {
    if (typeof openSetNameModal !== 'function') {
      alert('Lỗi: openSetNameModal không tồn tại'); return;
    }
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
function openCropModal(qIdx, suggestedPage) {
  if (!_pdfPageCanvases.length) return;
  _cropTargetIdx = qIdx;
  _cropRect      = null;

  const modal = document.getElementById('pdf-crop-modal');
  modal.classList.remove('hidden');

  // Build page selector
  const sel = document.getElementById('crop-page-select');
  sel.innerHTML = _pdfPageCanvases.map((_, i) =>
    `<option value="${i}">Trang ${i+1}</option>`
  ).join('');

  // Mở đúng trang gợi ý
  const startPage = (suggestedPage !== undefined && suggestedPage !== null)
    ? Math.max(0, Math.min(suggestedPage, _pdfPageCanvases.length - 1))
    : 0;
  sel.value = startPage;
  _cropPageIdx = startPage;

  renderCropCanvas(startPage);
}

function closeCropModal() {
  document.getElementById('pdf-crop-modal').classList.add('hidden');
  _cropTargetIdx = -1;
  _cropRect = null;
  _cropContext = 'import'; // reset về default
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

// Context cho crop: 'import' | 'bankEdit' | 'setQEdit'
let _cropContext = 'import';

function confirmCrop() {
  if (_cropTargetIdx < 0 || !_cropRect) return;

  const ax = Math.round(_cropRect.x / _cropScale);
  const ay = Math.round(_cropRect.y / _cropScale);
  const aw = Math.round(_cropRect.w / _cropScale);
  const ah = Math.round(_cropRect.h / _cropScale);

  const dataUrl = cropCanvasRegion(_cropPageIdx, ax, ay, aw, ah);
  if (!dataUrl) return;

  if (_cropContext === 'bankEdit') {
    // Ghi vào preview trong bank edit modal
    window._pendingEditImage = dataUrl;
    const wrap = document.getElementById('bedit-img-wrap');
    const prev = document.getElementById('bedit-img-preview');
    if (wrap && prev) { prev.src = dataUrl; wrap.classList.remove('hidden'); }
    closeCropModal();
    return;
  }

  if (_cropContext === 'setQEdit') {
    // Ghi vào preview trong set question edit modal
    window._pendingEditImage = dataUrl;
    const wrap = document.getElementById('sqedit-img-wrap');
    const prev = document.getElementById('sqedit-img-preview');
    if (wrap && prev) { prev.src = dataUrl; wrap.classList.remove('hidden'); }
    closeCropModal();
    return;
  }

  // Default: import flow
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


// ══════════════════════════════════════════
//  MODE TABS — PDF thuần vs JSON+PDF
// ══════════════════════════════════════════
let _importMode = 'pdf'; // 'pdf' | 'json-pdf'

function initImportModeTabs() {
  document.querySelectorAll('.imt-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _importMode = btn.dataset.mode;
      document.querySelectorAll('.imt-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('import-mode-pdf').classList.toggle('hidden', _importMode !== 'pdf');
      document.getElementById('import-mode-json-pdf').classList.toggle('hidden', _importMode !== 'json-pdf');
      // Reset preview
      document.getElementById('pdf-preview-area').classList.add('hidden');
      _parsedQuestions = [];
    });
  });
}

// ══════════════════════════════════════════
//  JSON + PDF MODE STATE
// ══════════════════════════════════════════
let _jspdfQuestions  = [];   // câu hỏi từ JSON
let _jspdfPdfLoaded  = false; // PDF đã render canvas chưa

// ── Xử lý JSON ──
async function handleJspdfJsonSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  const statusEl = document.getElementById('jspdf-json-status');
  const badge    = document.getElementById('jspdf-json-badge');

  statusEl.textContent = '⏳ Đang đọc JSON...';
  statusEl.className = 'pdf-status-text';

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Hỗ trợ cả 2 format: { questions: [...] } hoặc [...] trực tiếp
    const qs = Array.isArray(data) ? data : (data.questions || []);
    if (!qs.length) throw new Error('Không tìm thấy câu hỏi trong file JSON.');

    // Gán id nếu thiếu
    qs.forEach((q, i) => { if (!q.id) q.id = `q${i+1}`; });

    // Chuẩn hóa format AI Studio → format web
    _jspdfQuestions = normalizeAIStudioJSON(qs);

    statusEl.textContent = `✅ Đọc được ${qs.length} câu hỏi`;
    statusEl.className = 'pdf-status-text ok';
    badge.textContent = `${qs.length} câu`;
    badge.classList.remove('hidden');

    // Nếu PDF đã load → render preview luôn
    _tryRenderJspdfPreview();
  } catch(err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.className = 'pdf-status-text error';
  }
}

// ── Xử lý PDF (quét đáp án + detect trang đồ thị) ──
async function handleJspdfPdfSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  const statusEl = document.getElementById('jspdf-pdf-status');
  const badge    = document.getElementById('jspdf-pdf-badge');

  statusEl.textContent = '⏳ Đang render PDF...';
  statusEl.className = 'pdf-status-text';
  _jspdfPdfLoaded = false;

  try {
    // Render canvas + extract text cùng lúc
    const rawText = await extractTextAndRenderPDF(file);

    // Quét đáp án từ text
    const answerMap = parseVSATAnswers(rawText);

    // Ghép đáp án vào câu hỏi JSON nếu có
    if (_jspdfQuestions.length && answerMap.size > 0) {
      _jspdfQuestions = mergeAnswers(_jspdfQuestions, answerMap);
    }

    // Detect trang có đồ thị bằng cách quét text từng trang
    await _detectGraphPages(rawText);

    _jspdfPdfLoaded = true;
    const ansCount = answerMap.size;
    statusEl.textContent = `✅ ${_pdfPageCanvases.length} trang · ${ansCount} đáp án · sẵn sàng crop ảnh`;
    statusEl.className = 'pdf-status-text ok';
    badge.textContent = `${_pdfPageCanvases.length} trang`;
    badge.classList.remove('hidden');

    _tryRenderJspdfPreview();
  } catch(err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.className = 'pdf-status-text error';
  }
}

// ── Map câu hỏi → số trang gợi ý dựa trên text PDF ──
let _questionPageMap = {}; // { qIdx: pageIdx (0-based) }

async function _detectGraphPages(fullText) {
  _questionPageMap = {};
  if (!_pdfPageCanvases.length) return;

  // Tách text theo trang (extractTextAndRenderPDF đã render canvas theo trang)
  // Dùng lại _pdfDoc để lấy text từng trang
  if (!_pdfDoc) return;

  const pageTexts = [];
  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page    = await _pdfDoc.getPage(p);
    const content = await page.getTextContent();
    let t = '';
    for (const item of content.items) t += item.str + ' ';
    pageTexts.push(t);
  }

  // Với mỗi câu hỏi, tìm trang chứa "Câu X" hoặc nội dung câu đó
  _jspdfQuestions.forEach((q, idx) => {
    const qNum = idx + 1;
    const cauPattern = new RegExp(`Câu\\s*${qNum}\\b`, 'i');

    for (let p = 0; p < pageTexts.length; p++) {
      if (cauPattern.test(pageTexts[p])) {
        _questionPageMap[idx] = p;
        break;
      }
    }

    // Fallback: ước tính nếu không tìm thấy
    if (_questionPageMap[idx] === undefined) {
      _questionPageMap[idx] = Math.min(
        Math.floor(idx / 3) + 1,
        _pdfPageCanvases.length - 1
      );
    }
  });
}

// ── Render preview khi cả JSON và PDF đã sẵn sàng ──
function _tryRenderJspdfPreview() {
  if (!_jspdfQuestions.length) return;

  // Copy sang _parsedQuestions để dùng chung hàm renderPdfPreview
  _parsedQuestions = _jspdfQuestions.map(q => ({ ...q }));

  renderPdfPreview(_parsedQuestions);
  document.getElementById('pdf-preview-area').classList.remove('hidden');

  // ── Cập nhật stat "cần ảnh" ──
  const needImg = _parsedQuestions.filter(q => hasImageRef(q) && !q._image && !q.image).length;
  const el = document.getElementById('pdf-stat-needimg');
  if (el) el.textContent = needImg;
  // Reset filter khi re-render
  _needImgFilterOn = false;
  const btn = document.getElementById('pdf-stat-needimg-btn');
  if (btn) btn.classList.remove('active');
}

// ── Override openCropModal để dùng _questionPageMap khi ở mode json-pdf ──
const _origOpenCropModal = typeof openCropModal === 'function' ? openCropModal : null;

function openCropModal(qIdx, suggestedPage) {
  if (!_pdfPageCanvases.length) return;
  _cropTargetIdx = qIdx;
  _cropRect      = null;

  const modal = document.getElementById('pdf-crop-modal');
  modal.classList.remove('hidden');

  const sel = document.getElementById('crop-page-select');
  sel.innerHTML = _pdfPageCanvases.map((_, i) =>
    `<option value="${i}">Trang ${i+1}</option>`
  ).join('');

  // Ưu tiên: trang từ _questionPageMap → suggestedPage → 0
  let startPage = 0;
  if (_importMode === 'json-pdf' && _questionPageMap[qIdx] !== undefined) {
    startPage = _questionPageMap[qIdx];
  } else if (suggestedPage !== undefined && suggestedPage !== null) {
    startPage = Math.max(0, Math.min(suggestedPage, _pdfPageCanvases.length - 1));
  }

  sel.value = startPage;
  _cropPageIdx = startPage;
  renderCropCanvas(startPage);
}

// ── Init drop zones cho JSON+PDF mode ──
function initJspdfMode() {
  // JSON drop zone
  const jz = document.getElementById('jspdf-json-zone');
  if (!jz) return;
  jz.addEventListener('click', () => document.getElementById('jspdf-json-input').click());
  jz.addEventListener('dragover', e => { e.preventDefault(); jz.classList.add('drag-over'); });
  jz.addEventListener('dragleave', () => jz.classList.remove('drag-over'));
  jz.addEventListener('drop', e => {
    e.preventDefault(); jz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleJspdfJsonSelect({ target: { files: [f], value: '' } });
  });
  document.getElementById('jspdf-json-input').addEventListener('change', handleJspdfJsonSelect);

  // PDF drop zone
  const pz = document.getElementById('jspdf-pdf-zone');
  pz.addEventListener('click', () => document.getElementById('jspdf-pdf-input').click());
  pz.addEventListener('dragover', e => { e.preventDefault(); pz.classList.add('drag-over'); });
  pz.addEventListener('dragleave', () => pz.classList.remove('drag-over'));
  pz.addEventListener('drop', e => {
    e.preventDefault(); pz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') handleJspdfPdfSelect({ target: { files: [f], value: '' } });
  });
  document.getElementById('jspdf-pdf-input').addEventListener('change', handleJspdfPdfSelect);
}

// ── Reset khi đóng modal (JSON+PDF mode cleanup) ──
// KHÔNG override closePdfImportModal để tránh infinite recursion
// Thay vào đó hook vào sự kiện đóng modal
function _resetJspdfState() {
  _jspdfQuestions  = [];
  _jspdfPdfLoaded  = false;
  _questionPageMap = {};
  ['jspdf-json-status','jspdf-pdf-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'pdf-status-text'; }
  });
  ['jspdf-json-badge','jspdf-pdf-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  // Reset tab về PDF
  _importMode = 'pdf';
  document.querySelectorAll('.imt-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'pdf')
  );
  const modePdf  = document.getElementById('import-mode-pdf');
  const modeJson = document.getElementById('import-mode-json-pdf');
  if (modePdf)  modePdf.classList.remove('hidden');
  if (modeJson) modeJson.classList.add('hidden');
}

// ── Gắn vào initPdfImport ──
const _origInitPdfImport = initPdfImport;
document.addEventListener('DOMContentLoaded', () => {
  initImportModeTabs();
  initJspdfMode();
});

// ══════════════════════════════════════════
//  INLINE ANSWER EDITING trong preview
// ══════════════════════════════════════════

// TF: toggle Đ/S cho từng mệnh đề
function setPrevTFAnswer(qIdx, stmtIdx, val) {
  const q = _parsedQuestions[qIdx];
  if (!q) return;
  if (!Array.isArray(q.answers)) q.answers = new Array((q.statements||[]).length).fill(null);
  // Toggle: nếu đang chọn rồi thì bỏ chọn
  q.answers[stmtIdx] = q.answers[stmtIdx] === val ? null : val;

  // Cập nhật UI chỉ phần đó, không re-render toàn bộ
  const stmts = document.querySelectorAll(`#pdf-prev-item-${qIdx} .pdf-prev-stmt`);
  if (stmts[stmtIdx]) {
    const wrap = stmts[stmtIdx].querySelector('.pdf-stmt-ans-wrap');
    if (wrap) {
      wrap.querySelectorAll('.tf-ans-btn').forEach(btn => {
        btn.classList.remove('active-d','active-s');
        if (btn.textContent === 'Đ' && q.answers[stmtIdx] === 'D') btn.classList.add('active-d');
        if (btn.textContent === 'S' && q.answers[stmtIdx] === 'S') btn.classList.add('active-s');
      });
    }
  }
  _updateNeedImgStat();
}

// MCQ: chọn đáp án bằng click vào option
function setPrevMCQAnswer(qIdx, optIdx) {
  const q = _parsedQuestions[qIdx];
  if (!q) return;
  q.answer = q.answer === optIdx ? null : optIdx; // toggle

  // Cập nhật UI
  const opts = document.querySelectorAll(`#pdf-prev-item-${qIdx} .pdf-prev-opt`);
  opts.forEach((el, oi) => {
    el.classList.toggle('opt-correct', oi === q.answer);
    const check = el.querySelector('.opt-check');
    if (check) check.remove();
    if (oi === q.answer) {
      const span = document.createElement('span');
      span.className = 'opt-check';
      span.textContent = '✓';
      el.appendChild(span);
    }
  });
}

// Matching: chọn đáp án từ select
function setPrevMatchAnswer(qIdx, leftIdx, val) {
  const q = _parsedQuestions[qIdx];
  if (!q) return;
  if (!Array.isArray(q.answers)) q.answers = new Array((q.left||[]).length).fill(null);
  q.answers[leftIdx] = val === '' ? null : parseInt(val);
}

// Short: nhập đáp án
function setPrevShortAnswer(qIdx, val) {
  const q = _parsedQuestions[qIdx];
  if (!q) return;
  q.answer = val.trim() || null;
}

function _updateNeedImgStat() {
  const needImg = _parsedQuestions.filter(q => hasImageRef(q) && !q._image && !q.image).length;
  const el = document.getElementById('pdf-stat-needimg');
  if (el) el.textContent = needImg;
}

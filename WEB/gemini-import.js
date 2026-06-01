/**
 * gemini-import.js  v1.0
 * Gửi PDF lên Gemini API → nhận JSON câu hỏi → merge vào _parsedQuestions
 * Xử lý được: đồ thị, hình vẽ, phương trình hóa học, bảng số liệu
 */

// ══════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════
const GEMINI_API_KEY = 'AIzaSyDdDT6o70AoW5xwE7yAsmtKdHgt0Xo6PJU';
const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ══════════════════════════════════════════
//  SCHEMA JSON cho Gemini
// ══════════════════════════════════════════
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id:       { type: "STRING" },
          type:     { type: "STRING", description: "mcq | truefalse | short | matching" },
          question: { type: "STRING" },
          // MCQ
          options:  { type: "ARRAY", items: { type: "STRING" } },
          answer:   { type: "STRING", description: "Index 0-3 cho MCQ, text cho short" },
          // True/False
          statements: { type: "ARRAY", items: { type: "STRING" } },
          answers:    { type: "ARRAY", items: { type: "STRING" }, description: "D hoặc S cho mỗi statement" },
          // Matching
          left:  { type: "ARRAY", items: { type: "STRING" } },
          right: { type: "ARRAY", items: { type: "STRING" } },
          // Hình ảnh / đồ thị
          hasImage:         { type: "BOOLEAN" },
          imageDescription: { type: "STRING" },
          graph: {
            type: "OBJECT",
            properties: {
              xAxis: {
                type: "OBJECT",
                properties: {
                  min:   { type: "NUMBER" },
                  max:   { type: "NUMBER" },
                  ticks: { type: "ARRAY", items: { type: "NUMBER" } }
                }
              },
              yAxis: {
                type: "OBJECT",
                properties: {
                  min:   { type: "NUMBER" },
                  max:   { type: "NUMBER" },
                  ticks: { type: "ARRAY", items: { type: "NUMBER" } }
                }
              },
              curves: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    type:     { type: "STRING", description: "equation | points" },
                    equation: { type: "STRING", description: "JS math string, dùng x làm biến, vd: x^3 - 3*x" },
                    points:   { type: "ARRAY", items: { type: "ARRAY", items: { type: "NUMBER" } } },
                    range:    { type: "ARRAY", items: { type: "NUMBER" } },
                    label:    { type: "STRING" },
                    color:    { type: "STRING" },
                    dash:     { type: "BOOLEAN" }
                  }
                }
              },
              points: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    x:               { type: "NUMBER" },
                    y:               { type: "NUMBER" },
                    label:           { type: "STRING" },
                    showCoordinates: { type: "BOOLEAN" },
                    align:           { type: "STRING" }
                  }
                }
              },
              annotations: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    type:       { type: "STRING", description: "segment | shade | text" },
                    x1:         { type: "NUMBER" },
                    y1:         { type: "NUMBER" },
                    x2:         { type: "NUMBER" },
                    y2:         { type: "NUMBER" },
                    text:       { type: "STRING" },
                    dash:       { type: "BOOLEAN" },
                    range:      { type: "ARRAY", items: { type: "NUMBER" } },
                    curveIndex: { type: "NUMBER" }
                  }
                }
              }
            }
          }
        },
        required: ["type", "question"]
      }
    }
  },
  required: ["questions"]
};

// ══════════════════════════════════════════
//  PROMPT
// ══════════════════════════════════════════
const GEMINI_PROMPT = `Bạn là chuyên gia số hóa đề thi V-SAT Việt Nam. Hãy trích xuất TẤT CẢ câu hỏi từ PDF và trả về JSON.

CẤU TRÚC ĐỀ V-SAT (2025):
- Câu 1–9: Đúng/Sai (truefalse) — mỗi câu có 4 mệnh đề a,b,c,d
- Câu 10–15: Trắc nghiệm (mcq) — 4 lựa chọn A,B,C,D  
- Câu 16–20: Ghép cột (matching) — cột trái 1-4, cột phải A-F
- Câu 21–25: Trả lời ngắn (short)

QUY TẮC QUAN TRỌNG:
1. LaTeX BẮT BUỘC cho mọi công thức: inline $...$ hoặc block $$...$$
2. Hóa học: $H_2SO_4$, $Fe^{2+}$, $\\rightarrow$, $\\xrightarrow{t^o}$
3. Bảng số liệu → LaTeX array: $$\\begin{array}{|c|c|}\\hline A & B\\\\\\hline\\end{array}$$
4. Nếu câu có ĐỒ THỊ/HÌNH VẼ: set hasImage=true, imageDescription mô tả chi tiết
5. Nếu đồ thị là hàm số tọa độ: điền thêm graph object với curves/points/annotations
   - equation dùng JS syntax: x^3 - 3*x, Math.sin(x), -0.5*(x-2)^2 + 3
6. Đáp án: điền nếu có trong PDF (file đáp án kèm theo)
   - MCQ: answer = "0","1","2","3" (index)
   - TF: answers = ["D","S","D","S"] (Đúng/Sai)
   - Short: answer = giá trị số
7. Xóa header/footer: "EMPIRE TEAM", số trang, watermark`;

// ══════════════════════════════════════════
//  MAIN: Gửi PDF lên Gemini
// ══════════════════════════════════════════
async function convertPdfWithGemini(file, onProgress) {
  onProgress && onProgress(10, 'Đang đọc file PDF...');

  // Đọc file thành base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  onProgress && onProgress(30, '🤖 Đang gửi lên Gemini AI...');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: base64 } },
        { text: GEMINI_PROMPT }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 65536
    }
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  onProgress && onProgress(80, '📦 Đang xử lý kết quả...');

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini không trả về dữ liệu.');

  const parsed = JSON.parse(text);
  const questions = parsed?.questions || [];
  if (!questions.length) throw new Error('Không tìm thấy câu hỏi nào trong PDF.');

  // Gán id nếu chưa có
  questions.forEach((q, i) => { if (!q.id) q.id = `q${i+1}`; });

  onProgress && onProgress(100, `✅ Gemini đọc được ${questions.length} câu`);
  return questions;
}

// ══════════════════════════════════════════
//  UI: Thêm nút AI vào modal PDF hiện có
// ══════════════════════════════════════════
function initGeminiImport() {
  // Chờ DOM sẵn sàng
  const dropZone = document.getElementById('pdf-drop-zone');
  if (!dropZone) return;

  // Thêm nút "🤖 AI Convert" vào khu vực upload đề
  const aiBtn = document.createElement('button');
  aiBtn.id        = 'gemini-convert-btn';
  aiBtn.className = 'gemini-ai-btn';
  aiBtn.innerHTML = '🤖 AI Convert (Gemini)';
  aiBtn.title     = 'Dùng Gemini AI để đọc PDF — xử lý được đồ thị, hình vẽ, hóa học';
  aiBtn.onclick   = () => document.getElementById('gemini-file-input').click();

  // Input file ẩn cho AI
  const aiInput = document.createElement('input');
  aiInput.type   = 'file';
  aiInput.id     = 'gemini-file-input';
  aiInput.accept = '.pdf';
  aiInput.hidden = true;
  aiInput.addEventListener('change', handleGeminiFileSelect);

  // Chèn sau drop zone
  dropZone.parentNode.insertBefore(aiBtn, dropZone.nextSibling);
  dropZone.parentNode.insertBefore(aiInput, aiBtn.nextSibling);

  // Thêm divider
  const divider = document.createElement('div');
  divider.className = 'gemini-divider';
  divider.innerHTML = '<span>hoặc dùng AI</span>';
  dropZone.parentNode.insertBefore(divider, aiBtn);
}

// ══════════════════════════════════════════
//  XỬ LÝ FILE CHỌN → GEMINI
// ══════════════════════════════════════════
async function handleGeminiFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const statusEl   = document.getElementById('pdf-import-status');
  const previewArea = document.getElementById('pdf-preview-area');

  // Reset preview
  previewArea.classList.add('hidden');
  _parsedQuestions = [];

  // Hiện progress bar
  showGeminiProgress(0, 'Khởi động...');

  try {
    const questions = await convertPdfWithGemini(file, (pct, msg) => {
      showGeminiProgress(pct, msg);
      if (statusEl) { statusEl.textContent = msg; statusEl.className = 'pdf-status-text'; }
    });

    _parsedQuestions = questions;

    // Ghép đáp án nếu đã có
    if (_parsedAnswers && _parsedAnswers.size > 0) {
      _parsedQuestions = mergeAnswers(_parsedQuestions, _parsedAnswers);
    }

    hideGeminiProgress();
    if (statusEl) {
      statusEl.textContent = `✅ Gemini đọc được ${questions.length} câu (đồ thị + hình vẽ đã xử lý)`;
      statusEl.className = 'pdf-status-text ok';
    }
    document.getElementById('pdf-parsed-count').textContent = `${questions.length} câu`;

    // Render preview — dùng hàm có sẵn của pdf-import.js
    renderPdfPreview(_parsedQuestions);
    previewArea.classList.remove('hidden');

  } catch(err) {
    hideGeminiProgress();
    if (statusEl) {
      statusEl.textContent = '❌ Gemini lỗi: ' + err.message;
      statusEl.className = 'pdf-status-text error';
    }
    showToast('❌ ' + err.message, true);
  }
}

// ══════════════════════════════════════════
//  PROGRESS BAR UI
// ══════════════════════════════════════════
function showGeminiProgress(pct, msg) {
  let bar = document.getElementById('gemini-progress-wrap');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'gemini-progress-wrap';
    bar.className = 'gemini-progress-wrap';
    bar.innerHTML = `
      <div class="gemini-progress-label">
        <span id="gemini-progress-msg"></span>
        <span id="gemini-progress-pct"></span>
      </div>
      <div class="gemini-progress-track">
        <div class="gemini-progress-fill" id="gemini-progress-fill"></div>
      </div>`;
    // Chèn vào modal body
    const modalBody = document.querySelector('.pdf-modal-body');
    if (modalBody) modalBody.prepend(bar);
  }
  bar.classList.remove('hidden');
  document.getElementById('gemini-progress-msg').textContent  = msg;
  document.getElementById('gemini-progress-pct').textContent  = pct + '%';
  document.getElementById('gemini-progress-fill').style.width = pct + '%';
}

function hideGeminiProgress() {
  const bar = document.getElementById('gemini-progress-wrap');
  if (bar) bar.classList.add('hidden');
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Đợi pdf-import.js init xong rồi mới thêm nút AI
  setTimeout(initGeminiImport, 100);
});

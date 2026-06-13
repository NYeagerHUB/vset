/**
 * exam-editor.js  v1.0
 * Module Soạn thảo đề thi — tích hợp vào dashboard VSAT
 *
 * Tính năng:
 *  - Soạn thảo WYSIWYG với rich text (bold, italic, underline, list, image, LaTeX)
 *  - Kéo-thả sắp xếp câu hỏi
 *  - Lưu nháp tự động (localStorage)
 *  - Nhân bản, xóa, sửa câu hỏi
 *  - Hỗ trợ: MCQ, MultiMCQ, TrueFalse, Short, Matching, Essay
 *  - Preview & lưu vào kho đề / xuất JSON
 */

'use strict';

// ══════════════════════════════════════════
//  EDITOR STATE
// ══════════════════════════════════════════
const LS_EDITOR_DRAFT = 'vsat_editor_draft_v1';

let _editorQuestions  = [];   // Array<EditorQuestion>
let _editorActiveIdx  = -1;   // index câu đang chỉnh sửa
let _editorDraftTimer = null; // debounce autosave
let _editorDragIdx    = -1;   // drag source
let _editorDragOver   = -1;   // drag target

// Mỗi câu hỏi trong editor:
// { id, type, question, options[], correctAnswer, explanation, score, ... }
function _euid() {
  return 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const DEFAULT_QUESTION = (type) => {
  const base = { id: _euid(), type, question: '', explanation: '', score: 1 };
  if (type === 'mcq') return { ...base, options: ['', '', '', ''], correctAnswer: null };
  if (type === 'multimcq') return { ...base, options: ['', '', '', ''], correctAnswer: [] };
  if (type === 'truefalse') return { ...base, statements: ['', '', '', ''], answers: [null, null, null, null] };
  if (type === 'short') return { ...base, answer: '' };
  if (type === 'matching') return { ...base, left: ['', '', '', ''], right: ['', '', '', '', '', ''], answers: [null, null, null, null] };
  if (type === 'essay') return { ...base, rubric: '' };
  return base;
};

const TYPE_LABELS = {
  mcq: 'Trắc nghiệm',
  multimcq: 'Nhiều đáp án',
  truefalse: 'Đúng / Sai',
  short: 'Trả lời ngắn',
  matching: 'Ghép cột',
  essay: 'Tự luận',
};

// ══════════════════════════════════════════
//  AUTOSAVE DRAFT
// ══════════════════════════════════════════
function editorScheduleAutosave() {
  clearTimeout(_editorDraftTimer);
  _editorDraftTimer = setTimeout(() => {
    _editorSaveDraft();
    _updateDraftStatus('💾 Đã lưu nháp');
    setTimeout(() => _updateDraftStatus('📝 Nháp tự động'), 2000);
  }, 1200);
  _updateDraftStatus('✏️ Đang soạn...');
}

function _editorSaveDraft() {
  const draft = {
    title:     document.getElementById('editor-title')?.value || '',
    subject:   document.getElementById('editor-subject')?.value || 'Toán',
    time:      parseInt(document.getElementById('editor-time')?.value) || 90,
    questions: _editorQuestions,
    savedAt:   Date.now(),
  };
  try { localStorage.setItem(LS_EDITOR_DRAFT, JSON.stringify(draft)); } catch(e) {}
}

function _editorLoadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_EDITOR_DRAFT));
    if (!d) return;
    document.getElementById('editor-title').value   = d.title   || '';
    document.getElementById('editor-subject').value = d.subject || 'Toán';
    document.getElementById('editor-time').value    = d.time    || 90;
    _editorQuestions = d.questions || [];
    _editorActiveIdx = _editorQuestions.length > 0 ? 0 : -1;
    _renderEditorList();
    if (_editorActiveIdx >= 0) _renderEditorForm(_editorActiveIdx);
  } catch(e) {}
}

function _updateDraftStatus(msg) {
  const el = document.getElementById('editor-draft-status');
  if (el) el.textContent = msg;
}

// ══════════════════════════════════════════
//  ADD / CLONE / DELETE
// ══════════════════════════════════════════
function editorAddQuestion(type = 'mcq') {
  const q = DEFAULT_QUESTION(type);
  // Nếu đang chỉnh sửa câu nào thì chèn sau câu đó, không thì thêm cuối
  const insertIdx = (_editorActiveIdx >= 0 && _editorActiveIdx < _editorQuestions.length)
    ? _editorActiveIdx + 1
    : _editorQuestions.length;
  _editorQuestions.splice(insertIdx, 0, q);
  _editorActiveIdx = insertIdx;
  _renderEditorList();
  _renderEditorForm(_editorActiveIdx);
  editorScheduleAutosave();
  // Scroll câu mới vào view
  requestAnimationFrame(() => {
    const item = document.getElementById(`eql-item-${insertIdx}`);
    if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function editorCloneQuestion(idx) {
  const q = JSON.parse(JSON.stringify(_editorQuestions[idx]));
  q.id = _euid();
  _editorQuestions.splice(idx + 1, 0, q);
  _editorActiveIdx = idx + 1;
  _renderEditorList();
  _renderEditorForm(_editorActiveIdx);
  editorScheduleAutosave();
}

function editorDeleteQuestion(idx) {
  if (!confirm(`Xóa câu ${idx + 1}?`)) return;
  _editorQuestions.splice(idx, 1);
  if (_editorActiveIdx >= _editorQuestions.length) {
    _editorActiveIdx = _editorQuestions.length - 1;
  }
  _renderEditorList();
  if (_editorActiveIdx >= 0) _renderEditorForm(_editorActiveIdx);
  else _showEditorPlaceholder();
  editorScheduleAutosave();
}

function editorMoveQuestion(fromIdx, toIdx) {
  if (fromIdx === toIdx || toIdx < 0 || toIdx >= _editorQuestions.length) return;
  const [q] = _editorQuestions.splice(fromIdx, 1);
  _editorQuestions.splice(toIdx, 0, q);
  _editorActiveIdx = toIdx;
  _renderEditorList();
  _renderEditorForm(_editorActiveIdx);
  editorScheduleAutosave();
}

// ══════════════════════════════════════════
//  RENDER QUESTION LIST (cột trái)
// ══════════════════════════════════════════
function _renderEditorList() {
  const listEl  = document.getElementById('editor-q-list');
  const countEl = document.getElementById('editor-q-count');
  if (!listEl) return;

  countEl.textContent = `${_editorQuestions.length} câu`;

  if (!_editorQuestions.length) {
    listEl.innerHTML = '<div class="editor-empty-hint">Nhấn <b>+ Thêm câu</b> để bắt đầu soạn đề</div>';
    return;
  }

  listEl.innerHTML = _editorQuestions.map((q, i) => {
    const typeLabel = TYPE_LABELS[q.type] || q.type;
    const preview   = (q.question || '').replace(/<[^>]+>/g, '').slice(0, 60) || '(Chưa có nội dung)';
    const active    = i === _editorActiveIdx ? 'active' : '';
    const hasAns    = _editorHasAnswer(q);
    return `<div class="eql-item ${active}" id="eql-item-${i}"
      draggable="true"
      onclick="editorSelectQuestion(${i})"
      ondragstart="editorOnDragStart(event,${i})"
      ondragover="editorOnDragOver(event,${i})"
      ondrop="editorOnDrop(event,${i})"
      ondragend="editorOnDragEnd(event)">
      <div class="eql-grip">⠿</div>
      <div class="eql-body">
        <div class="eql-meta">
          <span class="eql-num">${i + 1}</span>
          <span class="bank-card-type ${q.type}">${typeLabel}</span>
          ${hasAns ? '<span class="eql-ans-ok">✓</span>' : ''}
        </div>
        <div class="eql-preview">${escH(preview)}</div>
      </div>
      <div class="eql-actions">
        <button class="eql-btn" onclick="event.stopPropagation();editorCloneQuestion(${i})" title="Nhân bản">⎘</button>
        <button class="eql-btn del" onclick="event.stopPropagation();editorDeleteQuestion(${i})" title="Xóa">✕</button>
      </div>
    </div>`;
  }).join('');
}

function editorSelectQuestion(idx) {
  // Lưu câu đang sửa trước khi chuyển
  if (_editorActiveIdx >= 0 && _editorActiveIdx !== idx) {
    _collectEditorForm(_editorActiveIdx);
  }
  _editorActiveIdx = idx;
  _renderEditorList();
  _renderEditorForm(idx);
}

function _editorHasAnswer(q) {
  if (q.type === 'mcq')       return q.correctAnswer !== null && q.correctAnswer !== undefined;
  if (q.type === 'multimcq')  return Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0;
  if (q.type === 'truefalse') return Array.isArray(q.answers) && q.answers.some(v => v !== null);
  if (q.type === 'short')     return !!q.answer;
  if (q.type === 'matching')  return Array.isArray(q.answers) && q.answers.some(v => v !== null);
  return false;
}

// ══════════════════════════════════════════
//  RENDER EDITOR FORM (cột giữa)
// ══════════════════════════════════════════
function _renderEditorForm(idx) {
  const mainEl = document.getElementById('editor-main');
  if (!mainEl) return;
  const q = _editorQuestions[idx];
  if (!q) { _showEditorPlaceholder(); return; }

  mainEl.innerHTML = `
    <div class="editor-form" id="editor-form-${idx}">
      <div class="ef-header">
        <div class="ef-num">Câu ${idx + 1}</div>
        <select class="ef-type-sel" onchange="editorChangeType(${idx},this.value)">
          ${Object.entries(TYPE_LABELS).map(([v, l]) =>
            `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`
          ).join('')}
        </select>
        <div class="ef-header-actions">
          <button class="ef-move-btn" onclick="editorMoveQuestion(${idx},${idx-1})" ${idx===0?'disabled':''} title="Lên">↑</button>
          <button class="ef-move-btn" onclick="editorMoveQuestion(${idx},${idx+1})" ${idx===_editorQuestions.length-1?'disabled':''} title="Xuống">↓</button>
          <button class="ef-clone-btn" onclick="editorCloneQuestion(${idx})" title="Nhân bản">⎘ Nhân bản</button>
          <button class="ef-del-btn" onclick="editorDeleteQuestion(${idx})" title="Xóa câu">🗑 Xóa</button>
        </div>
      </div>

      <!-- Question text (rich textarea với toolbar LaTeX) -->
      <div class="ef-section">
        <label class="ef-label">Nội dung câu hỏi <span class="ef-hint">(hỗ trợ LaTeX: $x^2$)</span></label>
        ${_buildRichEditor('ef-question-' + idx, q.question || '', 'Nhập nội dung câu hỏi...', idx)}
      </div>

      <!-- Type-specific fields -->
      <div id="ef-body-${idx}">
        ${_buildTypeFields(q, idx)}
      </div>

      <!-- Giải thích -->
      <div class="ef-section">
        <label class="ef-label">Giải thích / Lời giải <span class="ef-optional">(tùy chọn)</span></label>
        <textarea class="ef-textarea" id="ef-explanation-${idx}" rows="2"
          oninput="editorFieldChange(${idx},'explanation',this.value)"
          placeholder="Nhập lời giải hoặc ghi chú...">${escH(q.explanation || '')}</textarea>
      </div>
    </div>`;

  _renderEditorProps(idx);

  // Nếu KaTeX đã load, preview LaTeX
  if (window.katex) {
    requestAnimationFrame(() => rerenderPendingMath && rerenderPendingMath());
  }
}

function _buildRichEditor(id, value, placeholder, qIdx) {
  return `
    <div class="ef-rich-wrap">
      <div class="ef-rich-toolbar">
        <button class="ef-tb-btn" onclick="efExecCmd('bold')" title="In đậm"><b>B</b></button>
        <button class="ef-tb-btn" onclick="efExecCmd('italic')" title="In nghiêng"><i>I</i></button>
        <button class="ef-tb-btn" onclick="efExecCmd('underline')" title="Gạch chân"><u>U</u></button>
        <span class="ef-tb-sep"></span>
        <button class="ef-tb-btn" onclick="efInsertOrderedList()" title="Danh sách số">1.</button>
        <button class="ef-tb-btn" onclick="efInsertUnorderedList()" title="Danh sách dấu">•</button>
        <span class="ef-tb-sep"></span>
        <button class="ef-tb-btn" onclick="efInsertLatex(${qIdx},'inline')" title="Công thức LaTeX inline">$x$</button>
        <button class="ef-tb-btn" onclick="efInsertLatex(${qIdx},'block')" title="Công thức LaTeX block">$$</button>
        <span class="ef-tb-sep"></span>
        <button class="ef-tb-btn" onclick="efInsertTable(${qIdx})" title="Chèn bảng">⊞</button>
        <label class="ef-tb-btn" title="Chèn ảnh">
          🖼
          <input type="file" accept="image/*" hidden onchange="efInsertImage(event,${qIdx})"/>
        </label>
      </div>
      <div class="ef-rich-editor" id="${id}"
        contenteditable="true"
        spellcheck="false"
        placeholder="${placeholder}"
        oninput="editorRichChange(${qIdx},'question',this)"
        onpaste="efHandlePaste(event,this)">${value}</div>
      <div class="ef-math-preview" id="${id}-preview"></div>
    </div>`;
}

function _buildTypeFields(q, idx) {
  if (q.type === 'mcq') return _buildMCQFields(q, idx);
  if (q.type === 'multimcq') return _buildMultiMCQFields(q, idx);
  if (q.type === 'truefalse') return _buildTrueFalseFields(q, idx);
  if (q.type === 'short') return _buildShortFields(q, idx);
  if (q.type === 'matching') return _buildMatchingFields(q, idx);
  if (q.type === 'essay') return _buildEssayFields(q, idx);
  return '';
}

function _buildMCQFields(q, idx) {
  const opts = q.options || ['', '', '', ''];
  const ALPHA = ['A', 'B', 'C', 'D', 'E', 'F'];
  return `
    <div class="ef-section">
      <div class="ef-section-header">
        <label class="ef-label">Các phương án</label>
        <button class="ef-small-btn" onclick="editorAddOption(${idx})">+ Thêm phương án</button>
      </div>
      <div class="ef-options-list" id="ef-opts-${idx}">
        ${opts.map((opt, oi) => `
          <div class="ef-opt-row" id="ef-opt-row-${idx}-${oi}">
            <input type="radio" class="ef-opt-radio" name="ef-ans-${idx}" id="ef-opt-radio-${idx}-${oi}"
              value="${oi}" ${q.correctAnswer === oi ? 'checked' : ''}
              onchange="editorFieldChange(${idx},'correctAnswer',${oi})"/>
            <label class="ef-opt-label" for="ef-opt-radio-${idx}-${oi}">${ALPHA[oi]}</label>
            <input class="ef-opt-input" type="text" value="${escH(opt)}"
              placeholder="Nhập phương án ${ALPHA[oi]}..."
              oninput="editorOptionChange(${idx},${oi},this.value)"/>
            ${opts.length > 2 ? `<button class="ef-opt-del" onclick="editorRemoveOption(${idx},${oi})" title="Xóa phương án">✕</button>` : ''}
          </div>`).join('')}
      </div>
      <div class="ef-hint-row">💡 Chọn radio để đánh dấu đáp án đúng</div>
    </div>`;
}

function _buildMultiMCQFields(q, idx) {
  const opts = q.options || ['', '', '', ''];
  const correct = q.correctAnswer || [];
  const ALPHA = ['A', 'B', 'C', 'D', 'E', 'F'];
  return `
    <div class="ef-section">
      <div class="ef-section-header">
        <label class="ef-label">Các phương án <span class="ef-hint">(nhiều đáp án đúng)</span></label>
        <button class="ef-small-btn" onclick="editorAddOption(${idx})">+ Thêm phương án</button>
      </div>
      <div class="ef-options-list" id="ef-opts-${idx}">
        ${opts.map((opt, oi) => `
          <div class="ef-opt-row" id="ef-opt-row-${idx}-${oi}">
            <input type="checkbox" class="ef-opt-check" id="ef-opt-chk-${idx}-${oi}"
              ${correct.includes(oi) ? 'checked' : ''}
              onchange="editorMultiAnswerChange(${idx},${oi},this.checked)"/>
            <label class="ef-opt-label" for="ef-opt-chk-${idx}-${oi}">${ALPHA[oi]}</label>
            <input class="ef-opt-input" type="text" value="${escH(opt)}"
              placeholder="Nhập phương án ${ALPHA[oi]}..."
              oninput="editorOptionChange(${idx},${oi},this.value)"/>
            ${opts.length > 2 ? `<button class="ef-opt-del" onclick="editorRemoveOption(${idx},${oi})" title="Xóa">✕</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function _buildTrueFalseFields(q, idx) {
  const stmts = q.statements || ['', '', '', ''];
  const answers = q.answers || [null, null, null, null];
  return `
    <div class="ef-section">
      <div class="ef-section-header">
        <label class="ef-label">Các mệnh đề</label>
        <button class="ef-small-btn" onclick="editorAddStatement(${idx})">+ Thêm mệnh đề</button>
      </div>
      <div id="ef-stmts-${idx}">
        ${stmts.map((s, si) => `
          <div class="ef-stmt-row">
            <span class="ef-stmt-lbl">${['a', 'b', 'c', 'd', 'e', 'f'][si]})</span>
            <input class="ef-opt-input" type="text" value="${escH(s)}"
              placeholder="Nhập mệnh đề ${si + 1}..."
              oninput="editorStatementChange(${idx},${si},this.value)"/>
            <div class="ef-tf-group">
              <button class="ef-tf-btn ${answers[si]==='D'?'active-d':''}" onclick="editorTFAnswer(${idx},${si},'D')">Đ</button>
              <button class="ef-tf-btn ${answers[si]==='S'?'active-s':''}" onclick="editorTFAnswer(${idx},${si},'S')">S</button>
            </div>
            ${stmts.length > 2 ? `<button class="ef-opt-del" onclick="editorRemoveStatement(${idx},${si})">✕</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function _buildShortFields(q, idx) {
  return `
    <div class="ef-section">
      <label class="ef-label">Đáp án đúng</label>
      <input class="ef-text-input" type="text" value="${escH(q.answer || '')}"
        placeholder="Nhập đáp án (để trống nếu chưa có)..."
        oninput="editorFieldChange(${idx},'answer',this.value)"/>
      <div class="ef-hint-row">💡 Hệ thống so sánh đáp án sau khi chuẩn hóa (bỏ dấu cách, chuyển , → .)</div>
    </div>`;
}

function _buildMatchingFields(q, idx) {
  const left  = q.left  || ['', '', '', ''];
  const right = q.right || ['', '', '', '', '', ''];
  const answers = q.answers || new Array(left.length).fill(null);
  const ALPHA = ['A', 'B', 'C', 'D', 'E', 'F'];
  return `
    <div class="ef-section">
      <div class="ef-matching-wrap">
        <div class="ef-matching-col">
          <div class="ef-section-header">
            <label class="ef-label">Cột trái</label>
            <button class="ef-small-btn" onclick="editorAddMatchLeft(${idx})">+ Thêm</button>
          </div>
          ${left.map((l, li) => `
            <div class="ef-match-row-left">
              <span class="ef-match-num">${li + 1}.</span>
              <input class="ef-opt-input" type="text" value="${escH(l)}"
                placeholder="Ý ${li + 1}..."
                oninput="editorMatchChange(${idx},'left',${li},this.value)"/>
              <select class="ef-match-ans-sel" onchange="editorMatchAnswerChange(${idx},${li},this.value)">
                <option value="">?</option>
                ${right.map((r, ri) =>
                  `<option value="${ri}" ${answers[li]===ri||answers[li]===String(ri)?'selected':''}>${ALPHA[ri]}</option>`
                ).join('')}
              </select>
              ${left.length > 2 ? `<button class="ef-opt-del" onclick="editorRemoveMatchLeft(${idx},${li})">✕</button>` : ''}
            </div>`).join('')}
        </div>
        <div class="ef-matching-col">
          <div class="ef-section-header">
            <label class="ef-label">Cột phải</label>
            <button class="ef-small-btn" onclick="editorAddMatchRight(${idx})">+ Thêm</button>
          </div>
          ${right.map((r, ri) => `
            <div class="ef-match-row-right">
              <span class="ef-match-lbl">${ALPHA[ri]}.</span>
              <input class="ef-opt-input" type="text" value="${escH(r)}"
                placeholder="${ALPHA[ri]}..."
                oninput="editorMatchChange(${idx},'right',${ri},this.value)"/>
              ${right.length > 2 ? `<button class="ef-opt-del" onclick="editorRemoveMatchRight(${idx},${ri})">✕</button>` : ''}
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function _buildEssayFields(q, idx) {
  return `
    <div class="ef-section">
      <label class="ef-label">Hướng dẫn chấm / Rubric <span class="ef-optional">(tùy chọn)</span></label>
      <textarea class="ef-textarea" id="ef-rubric-${idx}" rows="4"
        oninput="editorFieldChange(${idx},'rubric',this.value)"
        placeholder="Nhập tiêu chí chấm điểm...">${escH(q.rubric || '')}</textarea>
    </div>`;
}

// ══════════════════════════════════════════
//  RENDER PROPS PANEL (cột phải)
// ══════════════════════════════════════════
function _renderEditorProps(idx) {
  const bodyEl = document.getElementById('editor-props-body');
  if (!bodyEl) return;
  const q = _editorQuestions[idx];
  if (!q) { bodyEl.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem">Chọn câu hỏi để xem thuộc tính</div>'; return; }

  bodyEl.innerHTML = `
    <div class="ep-group">
      <label class="ep-label">Điểm</label>
      <input class="ep-input" type="number" min="0" max="100" step="0.5"
        value="${q.score || 1}"
        oninput="editorFieldChange(${idx},'score',parseFloat(this.value)||0)"/>
    </div>
    <div class="ep-group">
      <label class="ep-label">ID câu hỏi</label>
      <input class="ep-input" type="text" value="${escH(q.id)}"
        oninput="editorFieldChange(${idx},'id',this.value)"/>
    </div>
    <div class="ep-group">
      <label class="ep-label">Hình ảnh</label>
      <div id="ep-img-wrap-${idx}" class="${q.image ? '' : 'hidden'}">
        <img id="ep-img-preview-${idx}" src="${q.image || ''}"
          style="max-width:100%;max-height:120px;border-radius:4px;border:1px solid var(--border);margin-bottom:.3rem"/>
        <button class="ef-small-btn" style="color:var(--danger);border-color:var(--danger);width:100%"
          onclick="editorRemoveImage(${idx})">🗑 Xóa ảnh</button>
      </div>
      <label class="ef-tb-btn" style="width:100%;justify-content:center;cursor:pointer;margin-top:.3rem">
        📁 Upload ảnh
        <input type="file" accept="image/*" hidden onchange="editorUploadImage(event,${idx})"/>
      </label>
    </div>
    <div class="ep-divider"></div>
    <div class="ep-stat">
      <div class="ep-stat-row">
        <span>Loại:</span>
        <span class="bank-card-type ${q.type}">${TYPE_LABELS[q.type] || q.type}</span>
      </div>
      <div class="ep-stat-row">
        <span>Có đáp án:</span>
        <span style="color:${_editorHasAnswer(q) ? 'var(--success)' : 'var(--text-muted)'}">${_editorHasAnswer(q) ? '✓ Có' : '✗ Chưa'}</span>
      </div>
      <div class="ep-stat-row">
        <span>Có giải thích:</span>
        <span style="color:${q.explanation ? 'var(--success)' : 'var(--text-muted)'}">${q.explanation ? '✓ Có' : '✗ Chưa'}</span>
      </div>
      <div class="ep-stat-row">
        <span>Có ảnh:</span>
        <span style="color:${q.image ? 'var(--success)' : 'var(--text-muted)'}">${q.image ? '✓ Có' : '✗ Chưa'}</span>
      </div>
    </div>`;
}

function _showEditorPlaceholder() {
  const mainEl = document.getElementById('editor-main');
  if (mainEl) mainEl.innerHTML = `
    <div class="editor-placeholder">
      <div class="editor-placeholder-icon">✏️</div>
      <div class="editor-placeholder-title">Chọn câu hỏi để chỉnh sửa</div>
      <div class="editor-placeholder-sub">Hoặc nhấn <b>+ Thêm câu</b> để tạo câu hỏi mới</div>
    </div>`;
  const propsEl = document.getElementById('editor-props-body');
  if (propsEl) propsEl.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem">Chọn câu hỏi để xem thuộc tính</div>';
}

// ══════════════════════════════════════════
//  FIELD CHANGE HANDLERS
// ══════════════════════════════════════════
function editorFieldChange(idx, field, value) {
  if (!_editorQuestions[idx]) return;
  _editorQuestions[idx][field] = value;
  editorScheduleAutosave();
  // Cập nhật trạng thái có đáp án trong list
  _updateQListItem(idx);
}

function editorRichChange(idx, field, el) {
  if (!_editorQuestions[idx]) return;
  _editorQuestions[idx][field] = el.innerHTML;
  editorScheduleAutosave();
  _updateQListItem(idx);
}

function editorOptionChange(idx, optIdx, value) {
  if (!_editorQuestions[idx]) return;
  if (!_editorQuestions[idx].options) _editorQuestions[idx].options = [];
  _editorQuestions[idx].options[optIdx] = value;
  editorScheduleAutosave();
}

function editorMultiAnswerChange(idx, optIdx, checked) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!Array.isArray(q.correctAnswer)) q.correctAnswer = [];
  if (checked) {
    if (!q.correctAnswer.includes(optIdx)) q.correctAnswer.push(optIdx);
  } else {
    q.correctAnswer = q.correctAnswer.filter(v => v !== optIdx);
  }
  editorScheduleAutosave();
  _updateQListItem(idx);
}

function editorStatementChange(idx, si, value) {
  const q = _editorQuestions[idx];
  if (!q || !q.statements) return;
  q.statements[si] = value;
  editorScheduleAutosave();
}

function editorTFAnswer(idx, si, val) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!Array.isArray(q.answers)) q.answers = new Array((q.statements || []).length).fill(null);
  q.answers[si] = q.answers[si] === val ? null : val;
  // Cập nhật button UI
  const row = document.querySelector(`#ef-stmts-${idx} .ef-stmt-row:nth-child(${si + 1})`);
  if (row) {
    row.querySelectorAll('.ef-tf-btn').forEach(b => {
      b.classList.remove('active-d', 'active-s');
    });
    const targetBtns = row.querySelectorAll('.ef-tf-btn');
    if (q.answers[si] === 'D' && targetBtns[0]) targetBtns[0].classList.add('active-d');
    if (q.answers[si] === 'S' && targetBtns[1]) targetBtns[1].classList.add('active-s');
  }
  editorScheduleAutosave();
  _updateQListItem(idx);
}

function editorMatchChange(idx, side, pos, value) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (side === 'left') { if (!q.left) q.left = []; q.left[pos] = value; }
  else { if (!q.right) q.right = []; q.right[pos] = value; }
  editorScheduleAutosave();
}

function editorMatchAnswerChange(idx, leftIdx, val) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!Array.isArray(q.answers)) q.answers = new Array((q.left || []).length).fill(null);
  q.answers[leftIdx] = val === '' ? null : parseInt(val);
  editorScheduleAutosave();
  _updateQListItem(idx);
}

function editorChangeType(idx, newType) {
  const q = _editorQuestions[idx];
  if (!q || q.type === newType) return;
  // Giữ lại question text khi đổi loại
  const newQ = DEFAULT_QUESTION(newType);
  newQ.id = q.id;
  newQ.question = q.question || '';
  newQ.explanation = q.explanation || '';
  newQ.score = q.score || 1;
  newQ.image = q.image;
  _editorQuestions[idx] = newQ;
  _renderEditorForm(idx);
  _renderEditorList();
  editorScheduleAutosave();
}

// ══════════════════════════════════════════
//  ADD/REMOVE DYNAMIC ITEMS
// ══════════════════════════════════════════
function editorAddOption(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!q.options) q.options = [];
  if (q.options.length >= 8) return;
  q.options.push('');
  if (q.type === 'multimcq' && !Array.isArray(q.correctAnswer)) q.correctAnswer = [];
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorRemoveOption(idx, optIdx) {
  const q = _editorQuestions[idx];
  if (!q || !q.options || q.options.length <= 2) return;
  q.options.splice(optIdx, 1);
  if (q.type === 'mcq') {
    if (q.correctAnswer === optIdx) q.correctAnswer = null;
    else if (q.correctAnswer > optIdx) q.correctAnswer--;
  }
  if (q.type === 'multimcq' && Array.isArray(q.correctAnswer)) {
    q.correctAnswer = q.correctAnswer.filter(v => v !== optIdx).map(v => v > optIdx ? v - 1 : v);
  }
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorAddStatement(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!q.statements) q.statements = [];
  if (q.statements.length >= 8) return;
  q.statements.push('');
  if (!Array.isArray(q.answers)) q.answers = [];
  q.answers.push(null);
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorRemoveStatement(idx, si) {
  const q = _editorQuestions[idx];
  if (!q || !q.statements || q.statements.length <= 2) return;
  q.statements.splice(si, 1);
  if (Array.isArray(q.answers)) q.answers.splice(si, 1);
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorAddMatchLeft(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!q.left) q.left = [];
  if (q.left.length >= 8) return;
  q.left.push('');
  if (!Array.isArray(q.answers)) q.answers = [];
  q.answers.push(null);
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorRemoveMatchLeft(idx, li) {
  const q = _editorQuestions[idx];
  if (!q || !q.left || q.left.length <= 2) return;
  q.left.splice(li, 1);
  if (Array.isArray(q.answers)) q.answers.splice(li, 1);
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorAddMatchRight(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  if (!q.right) q.right = [];
  if (q.right.length >= 8) return;
  q.right.push('');
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

function editorRemoveMatchRight(idx, ri) {
  const q = _editorQuestions[idx];
  if (!q || !q.right || q.right.length <= 2) return;
  q.right.splice(ri, 1);
  // Cập nhật đáp án ghép cột
  if (Array.isArray(q.answers)) {
    q.answers = q.answers.map(a => {
      if (a === ri) return null;
      if (a > ri) return a - 1;
      return a;
    });
  }
  _renderEditorForm(idx);
  editorScheduleAutosave();
}

// ══════════════════════════════════════════
//  IMAGE
// ══════════════════════════════════════════
function editorUploadImage(e, idx) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    _editorQuestions[idx].image = ev.target.result;
    _renderEditorProps(idx);
    editorScheduleAutosave();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function editorRemoveImage(idx) {
  delete _editorQuestions[idx].image;
  _renderEditorProps(idx);
  editorScheduleAutosave();
}

// ══════════════════════════════════════════
//  RICH TEXT EDITOR HELPERS
// ══════════════════════════════════════════
function efExecCmd(cmd) {
  document.execCommand(cmd, false, null);
}

function efInsertOrderedList() { document.execCommand('insertOrderedList', false, null); }
function efInsertUnorderedList() { document.execCommand('insertUnorderedList', false, null); }

function efInsertLatex(qIdx, mode) {
  const sel = window.getSelection();
  const selText = sel && !sel.isCollapsed ? sel.toString() : (mode === 'inline' ? 'x^2' : 'x^2 + y^2 = r^2');
  const latex = mode === 'inline' ? `$${selText}$` : `$$${selText}$$`;
  document.execCommand('insertText', false, latex);
}

function efInsertTable(qIdx) {
  const rows = parseInt(prompt('Số hàng:', '3')) || 3;
  const cols = parseInt(prompt('Số cột:', '3')) || 3;
  let html = '<table border="1" style="border-collapse:collapse;margin:.5rem 0"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += `<td style="padding:.3rem .5rem;border:1px solid #ccc">` +
        (r === 0 ? `<b>Cột ${c + 1}</b>` : ``) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table><br>';
  document.execCommand('insertHTML', false, html);
}

function efInsertImage(e, qIdx) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.execCommand('insertImage', false, ev.target.result);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function efHandlePaste(e, el) {
  // Chỉ paste plain text để tránh Word garbage
  const text = e.clipboardData?.getData('text/plain');
  if (text) {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
}

// ══════════════════════════════════════════
//  DRAG & DROP
// ══════════════════════════════════════════
function editorOnDragStart(e, idx) {
  _editorDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
  const item = document.getElementById(`eql-item-${idx}`);
  if (item) item.classList.add('dragging');
}

function editorOnDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (_editorDragOver !== idx) {
    // Remove old indicator
    document.querySelectorAll('.eql-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    const item = document.getElementById(`eql-item-${idx}`);
    if (item) item.classList.add('drag-over');
    _editorDragOver = idx;
  }
}

function editorOnDrop(e, toIdx) {
  e.preventDefault();
  const fromIdx = _editorDragIdx;
  document.querySelectorAll('.eql-item.drag-over, .eql-item.dragging').forEach(el => {
    el.classList.remove('drag-over', 'dragging');
  });
  if (fromIdx !== -1 && fromIdx !== toIdx) {
    editorMoveQuestion(fromIdx, toIdx);
  }
  _editorDragIdx = -1;
  _editorDragOver = -1;
}

function editorOnDragEnd(e) {
  document.querySelectorAll('.eql-item.drag-over, .eql-item.dragging').forEach(el => {
    el.classList.remove('drag-over', 'dragging');
  });
  _editorDragIdx = -1;
  _editorDragOver = -1;
}

// ══════════════════════════════════════════
//  COLLECT FORM DATA (trước khi chuyển câu)
// ══════════════════════════════════════════
function _collectEditorForm(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  // Lấy nội dung rich editor
  const richEl = document.getElementById(`ef-question-${idx}`);
  if (richEl) q.question = richEl.innerHTML;
  // Explanation
  const expEl = document.getElementById(`ef-explanation-${idx}`);
  if (expEl) q.explanation = expEl.value;
  // Rubric (essay)
  const rubricEl = document.getElementById(`ef-rubric-${idx}`);
  if (rubricEl) q.rubric = rubricEl.value;
  // Short answer
  const shortEl = document.querySelector(`#ef-body-${idx} .ef-text-input`);
  if (shortEl && q.type === 'short') q.answer = shortEl.value;
}

function _updateQListItem(idx) {
  const q = _editorQuestions[idx];
  if (!q) return;
  const hasAns = _editorHasAnswer(q);
  const oksEl = document.querySelector(`#eql-item-${idx} .eql-ans-ok`);
  if (hasAns && !oksEl) {
    const metaEl = document.querySelector(`#eql-item-${idx} .eql-meta`);
    if (metaEl) {
      const span = document.createElement('span');
      span.className = 'eql-ans-ok';
      span.textContent = '✓';
      metaEl.appendChild(span);
    }
  } else if (!hasAns && oksEl) {
    oksEl.remove();
  }
  // Cập nhật preview text
  const prevEl = document.querySelector(`#eql-item-${idx} .eql-preview`);
  if (prevEl) {
    const preview = (q.question || '').replace(/<[^>]+>/g, '').slice(0, 60) || '(Chưa có nội dung)';
    prevEl.textContent = preview;
  }
}

// ══════════════════════════════════════════
//  IMPORT / EXPORT
// ══════════════════════════════════════════
function editorImportJSON(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      let qs = [];
      if (Array.isArray(data)) qs = data;
      else if (Array.isArray(data.questions)) {
        qs = data.questions;
        if (data.title) document.getElementById('editor-title').value = data.title;
        if (data.subject) document.getElementById('editor-subject').value = data.subject;
        if (data.time) document.getElementById('editor-time').value = data.time;
      }
      // Chuẩn hóa format
      if (typeof normalizeAIStudioJSON === 'function') qs = normalizeAIStudioJSON(qs);
      // Convert sang editor format
      _editorQuestions = qs.map(q => _convertToEditorFormat(q));
      _editorActiveIdx = _editorQuestions.length > 0 ? 0 : -1;
      _renderEditorList();
      if (_editorActiveIdx >= 0) _renderEditorForm(_editorActiveIdx);
      editorScheduleAutosave();
      if (typeof showToast === 'function') showToast(`✅ Nhập ${qs.length} câu hỏi`);
    } catch(e) {
      if (typeof showToast === 'function') showToast('⚠️ Lỗi file: ' + e.message, true);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function _convertToEditorFormat(q) {
  // Map từ format thi (truefalse/matching/mcq/short) sang editor format
  const base = {
    id: q.id || _euid(),
    type: q.type || 'mcq',
    question: q.question || '',
    explanation: q.explanation || '',
    score: q.score || 1,
    image: q.image,
  };
  if (q.type === 'mcq') {
    return { ...base, options: q.options || ['', '', '', ''], correctAnswer: q.answer !== null && q.answer !== undefined ? Number(q.answer) : null };
  }
  if (q.type === 'truefalse') {
    return { ...base, statements: q.statements || [], answers: q.answers || [] };
  }
  if (q.type === 'matching') {
    return { ...base, left: q.left || [], right: q.right || [], answers: q.answers || [] };
  }
  if (q.type === 'short') {
    return { ...base, answer: q.answer !== null && q.answer !== undefined ? String(q.answer) : '' };
  }
  return base;
}

function editorExportJSON() {
  _collectEditorForm(_editorActiveIdx);
  const title   = document.getElementById('editor-title')?.value || 'Đề thi mới';
  const subject = document.getElementById('editor-subject')?.value || 'Toán';
  const time    = parseInt(document.getElementById('editor-time')?.value) || 90;

  const output = {
    title, subject, time,
    metadata: { subject, title },
    questions: _editorQuestions.map((q, i) => _convertToExamFormat(q, i)),
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[^a-z0-9áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ ]/gi, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function _convertToExamFormat(q, i) {
  const base = {
    id: q.id || String(i + 1),
    type: q.type === 'multimcq' ? 'mcq' : q.type, // multimcq → mcq cho compat
    question: q.question || '',
    score: q.score,
  };
  if (q.image) base.image = q.image;
  if (q.explanation) base.explanation = q.explanation;

  if (q.type === 'mcq') {
    return { ...base, options: q.options || [], answer: q.correctAnswer !== null && q.correctAnswer !== undefined ? q.correctAnswer : null };
  }
  if (q.type === 'multimcq') {
    // Xuất dưới dạng mcq với answer là mảng
    return { ...base, type: 'mcq', options: q.options || [], answer: q.correctAnswer || null };
  }
  if (q.type === 'truefalse') {
    return { ...base, statements: q.statements || [], answers: q.answers || [] };
  }
  if (q.type === 'matching') {
    return { ...base, left: q.left || [], right: q.right || [], answers: q.answers || [] };
  }
  if (q.type === 'short') {
    return { ...base, answer: q.answer || null };
  }
  if (q.type === 'essay') {
    return { ...base, type: 'short', answer: null, rubric: q.rubric || '' };
  }
  return base;
}

// ══════════════════════════════════════════
//  SAVE TO KHO ĐỀ (tích hợp hệ thống hiện có)
// ══════════════════════════════════════════
async function editorSaveToSets() {
  _collectEditorForm(_editorActiveIdx);
  if (!_editorQuestions.length) {
    if (typeof showToast === 'function') showToast('⚠️ Đề trống, chưa có câu hỏi nào', true);
    return;
  }

  const title   = document.getElementById('editor-title')?.value.trim() || 'Đề thi mới';
  const subject = document.getElementById('editor-subject')?.value || 'Toán';
  const time    = parseInt(document.getElementById('editor-time')?.value) || 90;

  const questions = _editorQuestions.map((q, i) => {
    const eq = _convertToExamFormat(q, i);
    eq.subject = subject;
    return eq;
  });

  // Dùng hàm openSetNameModal từ exam.js
  if (typeof openSetNameModal === 'function') {
    openSetNameModal(title, time, questions, subject);
  } else {
    if (typeof showToast === 'function') showToast('⚠️ Lỗi tích hợp: openSetNameModal không tồn tại', true);
  }
}

// ══════════════════════════════════════════
//  NEW EXAM
// ══════════════════════════════════════════
function editorNewExam() {
  if (_editorQuestions.length > 0 && !confirm('Tạo đề mới sẽ xóa đề hiện tại. Tiếp tục?')) return;
  _editorQuestions = [];
  _editorActiveIdx = -1;
  document.getElementById('editor-title').value   = '';
  document.getElementById('editor-subject').value = 'Toán';
  document.getElementById('editor-time').value    = 90;
  _renderEditorList();
  _showEditorPlaceholder();
  localStorage.removeItem(LS_EDITOR_DRAFT);
  _updateDraftStatus('📝 Nháp tự động');
}

// ══════════════════════════════════════════
//  PREVIEW MODAL
// ══════════════════════════════════════════
function editorShowPreview() {
  _collectEditorForm(_editorActiveIdx);
  const title = document.getElementById('editor-title')?.value || 'Đề thi';

  // Reuse existing modal framework
  let modal = document.getElementById('editor-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'editor-preview-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-box modal-wide" style="max-width:800px;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <h3 id="editor-preview-title">👁 Preview đề thi</h3>
          <button class="modal-x-close" onclick="document.getElementById('editor-preview-modal').classList.add('hidden')">✕</button>
        </div>
        <div class="modal-body" id="editor-preview-body" style="overflow-y:auto;flex:1;padding:1rem 1.5rem"></div>
        <div class="modal-actions">
          <button class="modal-cancel" onclick="document.getElementById('editor-preview-modal').classList.add('hidden')">Đóng</button>
          <button class="modal-confirm" style="background:var(--success)" onclick="editorSaveToSets()">💾 Lưu vào kho đề</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const rm = typeof renderMathHTML === 'function' ? renderMathHTML : (s => s || '');
  document.getElementById('editor-preview-title').textContent = `👁 ${title}`;

  const bodyEl = document.getElementById('editor-preview-body');
  bodyEl.innerHTML = `
    <div class="eprev-header">
      <div class="eprev-meta">
        <span><b>Môn:</b> ${escH(document.getElementById('editor-subject')?.value || '')}</span>
        <span><b>Thời gian:</b> ${document.getElementById('editor-time')?.value || 90} phút</span>
        <span><b>Số câu:</b> ${_editorQuestions.length}</span>
      </div>
    </div>
    ${_editorQuestions.map((q, i) => {
      const examQ = _convertToExamFormat(q, i);
      const typeL = TYPE_LABELS[q.type] || q.type;
      let body = '';
      if (examQ.type === 'mcq') {
        body = `<div class="eprev-opts">${(examQ.options || []).map((o, oi) =>
          `<div class="eprev-opt ${examQ.answer===oi?'correct':''}">
            ${['A','B','C','D','E','F'][oi]}. ${rm(o)}
            ${examQ.answer===oi?'<span class="eprev-tick">✓</span>':''}
          </div>`).join('')}</div>`;
      } else if (examQ.type === 'truefalse') {
        body = `<div class="eprev-stmts">${(examQ.statements || []).map((s, si) => {
          const a = examQ.answers?.[si];
          return `<div class="eprev-stmt">
            <span class="eprev-lbl">${['a','b','c','d'][si]})</span>
            <span>${rm(s)}</span>
            ${a ? `<span class="eprev-ans-badge ${a==='D'?'badge-d':'badge-s'}">${a==='D'?'Đúng':'Sai'}</span>` : ''}
          </div>`;
        }).join('')}</div>`;
      } else if (examQ.type === 'matching') {
        body = `<div class="eprev-match">
          <div>${(examQ.left||[]).map((l,li)=>`<div>${li+1}. ${rm(l)}</div>`).join('')}</div>
          <div>${(examQ.right||[]).map((r,ri)=>`<div>${['A','B','C','D','E','F'][ri]}. ${rm(r)}</div>`).join('')}</div>
        </div>`;
      } else if (examQ.type === 'short') {
        body = examQ.answer ? `<div class="eprev-ans">→ ${escH(String(examQ.answer))}</div>` : '';
      }
      return `<div class="eprev-item">
        <div class="eprev-head">
          <b>Câu ${i+1}</b>
          <span class="bank-card-type ${q.type}" style="font-size:.65rem">${typeL}</span>
        </div>
        <div class="eprev-q">${rm(q.question) || '<em style="color:var(--text-muted)">(Chưa có nội dung)</em>'}</div>
        ${q.image ? `<img src="${q.image}" style="max-width:100%;max-height:200px;margin:.3rem 0;border-radius:4px"/>` : ''}
        ${body}
        ${q.explanation ? `<div class="eprev-exp"><b>Giải:</b> ${rm(q.explanation)}</div>` : ''}
      </div>`;
    }).join('')}`;

  modal.classList.remove('hidden');
  if (window.katex) setTimeout(() => typeof rerenderPendingMath === 'function' && rerenderPendingMath(), 80);
}

// ══════════════════════════════════════════
//  ADD TYPE PICKER POPUP
// ══════════════════════════════════════════
function editorShowTypePicker() {
  let popup = document.getElementById('editor-type-picker');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'editor-type-picker';
    popup.className = 'editor-type-picker hidden';
    popup.innerHTML = Object.entries(TYPE_LABELS).map(([v, l]) =>
      `<button class="etp-btn ${v}" onclick="editorAddQuestion('${v}');editorHideTypePicker()">${l}</button>`
    ).join('');
    const btn = document.getElementById('editor-add-q-btn');
    if (btn) btn.parentNode.appendChild(popup);
  }
  popup.classList.toggle('hidden');
}

function editorHideTypePicker() {
  const p = document.getElementById('editor-type-picker');
  if (p) p.classList.add('hidden');
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
function initExamEditor() {
  // Buttons
  document.getElementById('editor-new-btn')?.addEventListener('click', editorNewExam);
  document.getElementById('editor-export-btn')?.addEventListener('click', editorExportJSON);
  document.getElementById('editor-preview-btn')?.addEventListener('click', editorShowPreview);
  document.getElementById('editor-save-set-btn')?.addEventListener('click', editorSaveToSets);
  document.getElementById('editor-add-q-btn')?.addEventListener('click', editorShowTypePicker);

  // Import
  const importFile = document.getElementById('editor-import-file');
  const importBtn  = document.getElementById('editor-import-btn');
  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) editorImportJSON(f);
    e.target.value = '';
  });

  // Meta bar autosave
  ['editor-title', 'editor-subject', 'editor-time'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', editorScheduleAutosave);
  });

  // Close type picker khi click ngoài
  document.addEventListener('click', e => {
    const picker = document.getElementById('editor-type-picker');
    const addBtn = document.getElementById('editor-add-q-btn');
    if (picker && !picker.classList.contains('hidden')) {
      if (!picker.contains(e.target) && e.target !== addBtn) {
        editorHideTypePicker();
      }
    }
  });

  // Load draft khi vào panel editor
  // (được gọi lại từ switchDashPanel)
  _editorLoadDraft();
}

// Hook vào switchDashPanel của exam.js
const _origSwitchDashPanel = typeof switchDashPanel === 'function' ? switchDashPanel : null;
// Patch sau khi exam.js đã khởi tạo
document.addEventListener('DOMContentLoaded', () => {
  initExamEditor();

  // Patch switchDashPanel để load draft khi chuyển sang panel-editor
  if (window.switchDashPanel) {
    const origFn = window.switchDashPanel;
    window.switchDashPanel = function(panelId) {
      origFn.call(this, panelId);
      if (panelId === 'panel-editor') {
        // Re-render khi quay lại panel
        _renderEditorList();
        if (_editorActiveIdx >= 0) _renderEditorForm(_editorActiveIdx);
        else _showEditorPlaceholder();
      }
    };
  }
});

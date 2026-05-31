const fs = require('fs');

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
  // Mỗi block chứa toàn bộ nội dung từ "Câu N:" đến "Câu N+1:"
  const blockPattern = /Câu\s+(\d+)\s*[:.][^\n]*([\s\S]*?)(?=Câu\s+\d+\s*[:.:]|$)/gi;
  let m;
  while ((m = blockPattern.exec(text)) !== null) {
    const qNum   = parseInt(m[1]);
    const block  = m[0]; // toàn bộ text của block này

    // ── TF (câu 1-9): tìm dòng chỉ gồm 4 ký tự Đ/S ──
    if (qNum >= 1 && qNum <= 9) {
      // Tìm pattern "Đ Đ S S" hoặc "ĐĐSS" — thường xuất hiện sau "Lời giải"
      const tfMatch = block.match(/\b([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\b/);
      if (tfMatch) {
        const answers = [tfMatch[1],tfMatch[2],tfMatch[3],tfMatch[4]]
          .map(c => c.toUpperCase() === 'Đ' ? 'D' : 'S');
        answerMap.set(qNum, { type:'truefalse', answers });
      }
    }

    // ── MCQ (câu 10-15): "Chọn A" ──
    if (qNum >= 10 && qNum <= 15) {
      const chooseMatch = block.match(/Chọn\s+([A-D])\b/i);
      if (chooseMatch) {
        answerMap.set(qNum, { type:'mcq', answer: ['A','B','C','D'].indexOf(chooseMatch[1].toUpperCase()) });
      }
    }

    // ── Matching (câu 16-20): "1 – D; 2 – C; 3 – E; 4 – F" hoặc "Đáp án: 1–D; 2–C..." ──
    if (qNum >= 16 && qNum <= 20) {
      const pairs = [...block.matchAll(/(\d+)\s*[–\-]\s*([A-F])/gi)];
      if (pairs.length >= 2) {
        const answers = new Array(4).fill(null);
        pairs.forEach(p => {
          const idx = parseInt(p[1]) - 1;
          const val = p[2].toUpperCase().charCodeAt(0) - 65;
          if (idx >= 0 && idx < 4) answers[idx] = val;
        });
        answerMap.set(qNum, { type:'matching', answers });
      }
    }

    // ── Short (câu 21-25): "Đáp số: X" ──
    if (qNum >= 21 && qNum <= 25) {
      const shortPatterns = [
        /Đáp\s*số\s*[:.]\s*([\d.,/]+)/i,
        /Trả\s*lời\s*[:.]\s*([\d.,/]+)/i,
        /=\s*([\d.,/]+)\s*\.?\s*$/m,
      ];
      for (const pat of shortPatterns) {
        const sm = block.match(pat);
        if (sm) {
          const val = sm[1].trim().replace(/,(?=\d)/g, '.');
          answerMap.set(qNum, { type:'short', answer: val });
          break;
        }
      }
    }
  }

  return answerMap;
}

const rawText = fs.readFileSync('extracted_answers_de1.txt', 'utf8');
const answers = parseVSATAnswers(rawText);
console.log(`Parsed ${answers.size} answers:`);
for (let [qNum, ans] of answers.entries()) {
  console.log(`Câu ${qNum}:`, JSON.stringify(ans));
}

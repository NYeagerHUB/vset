var fso = new ActiveXObject("Scripting.FileSystemObject");
var file = fso.OpenTextFile("extracted_answers_de1.txt", 1, false, -1); // Open as unicode/utf-8 or ascii?
// Wait, -1 is Unicode (UTF-16), -2 is system default.
// Our file is UTF-8. In JScript, reading UTF-8 is easier with ADODB.Stream.
var stream = new ActiveXObject("ADODB.Stream");
stream.CharSet = "utf-8";
stream.Open();
stream.LoadFromFile("extracted_answers_de1.txt");
var text = stream.ReadText(-1);
stream.Close();

WScript.Echo("Loaded text length: " + text.length);
if (text.length > 0) {
  WScript.Echo("First 200 chars: " + text.substring(0, 200));
}

// Normalize text like pdf-import.js
text = text.replace(/HỆ THỐNG GIÁO DỤC EMPIRE TEAM/gi, '')
           .replace(/CHINH PHỤC MỌI MIỀN KIẾN THỨC/gi, '')
           .replace(/BỘ ĐỀ ĐÁNH GIÁ NĂNG LỰC V-SAT/gi, '')
           .replace(/\[EMPIRE TEAM\]/gi, '')
           .replace(/[ \t]+/g, ' ');

var blockPattern = /Câu\s+(\d+)\s*[:.][^\n]*([\s\S]*?)(?=Câu\s+\d+\s*[:.:]|$)/gi;
var m;
var count = 0;
while ((m = blockPattern.exec(text)) !== null) {
  var qNum = parseInt(m[1], 10);
  var block = m[0];
  var recognized = false;
  var detail = "";

  if (qNum >= 1 && qNum <= 9) {
    var tfMatch = block.match(/\b([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\b/);
    if (tfMatch) {
      recognized = true;
      detail = tfMatch[0];
    }
  }

  if (qNum >= 10 && qNum <= 15) {
    var chooseMatch = block.match(/Chọn\s+([A-D])\b/i);
    if (chooseMatch) {
      recognized = true;
      detail = chooseMatch[0];
    }
  }

  if (qNum >= 16 && qNum <= 20) {
    // In ES3/IE we don't have matchAll, so we use exec loop
    var pairs = [];
    var pairPattern = /(\d+)\s*[–\-]\s*([A-F])/gi;
    var pm;
    while ((pm = pairPattern.exec(block)) !== null) {
      pairs.push(pm[0]);
    }
    if (pairs.length >= 2) {
      recognized = true;
      detail = pairs.join(", ");
    }
  }

  if (qNum >= 21 && qNum <= 25) {
    var shortPatterns = [
      /Đáp\s*số\s*[:.]\s*([\d.,/]+)/i,
      /Trả\s*lời\s*[:.]\s*([\d.,/]+)/i,
      /=\s*([\d.,/]+)\s*\.?\s*$/m
    ];
    for (var k = 0; k < shortPatterns.length; k++) {
      var sm = block.match(shortPatterns[k]);
      if (sm) {
        recognized = true;
        detail = sm[0];
        break;
      }
    }
  }

  if (recognized) {
    count++;
    WScript.Echo("Câu " + qNum + ": Recognized -> " + detail);
  } else {
    WScript.Echo("Câu " + qNum + ": NOT Recognized");
  }
}
WScript.Echo("Total recognized: " + count);

// build-charstats.mjs — sinh data/char-rank.json (TOOL build, chạy ở máy có mạng npm).
// Mục tiêu: cho phép xếp chữ NGOÀI HSK vào HSK 1–6 theo ĐỘ THÔNG DỤNG (tần suất Jun Da),
// calibrate theo chính phân bố tần suất của các chữ trong bộ HSK. Chữ hiếm/lóng/thuật ngữ
// (không có trong bảng tần suất) → HSK 6.
//
//   npm install && node scripts/build-charstats.mjs

import { readFileSync, writeFileSync } from "fs";
import hanzi from "hanzi";

hanzi.start();

// 1) charLevel của bộ HSK (giống app): chữ → cấp HSK thấp nhất.
const hsk = JSON.parse(readFileSync(new URL("../data/hsk-words.json", import.meta.url)));
const cards = hsk.cards || hsk.words || [];
const charLevel = new Map();
for (const c of cards) {
  const s = c.simplified; if (!s) continue;
  const lv = c.hsk_level || 6;
  for (const ch of s) { const cur = charLevel.get(ch); if (cur == null || lv < cur) charLevel.set(ch, lv); }
}

// 2) Bảng tần suất Jun Da theo thứ hạng (1 = thông dụng nhất).
const freqChars = [];
for (let pos = 1; ; pos++) {
  const o = hanzi.getCharacterInFrequencyListByPosition(pos);
  if (!o || !o.character) break;
  freqChars.push(o.character);
}
const rankOf = new Map(freqChars.map((ch, i) => [ch, i + 1]));
console.log("Tổng số chữ trong bảng tần suất:", freqChars.length);

// 3) Calibrate: với mỗi cấp HSK, lấy phân vị 70% thứ hạng tần suất của các chữ cấp đó
//    → làm ngưỡng. Bảo đảm tăng dần (cummax).
const ranksByLevel = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
for (const [ch, lv] of charLevel) { const r = rankOf.get(ch); if (r) ranksByLevel[lv].push(r); }
const pct = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const thresholds = [];
let run = 0;
for (let lv = 1; lv <= 5; lv++) {
  let t = pct(ranksByLevel[lv], 0.7) ?? run + 500;
  if (t < run) t = run + 200; // ép tăng dần
  run = t; thresholds.push(t);
}
for (let lv = 1; lv <= 6; lv++) {
  const a = ranksByLevel[lv];
  console.log(`HSK${lv}: n=${a.length}, median rank=${pct(a, 0.5)}, p70=${pct(a, 0.7)}`);
}
console.log("thresholds (t1..t5):", thresholds);

// kiểm thử vài chữ ngoài HSK
const lvOf = (r) => { if (r == null) return 6; for (let i = 0; i < 5; i++) if (r <= thresholds[i]) return i + 1; return 6; };
for (const ch of ["氢", "菜", "囧", "鑫", "卡", "�థ", "酶", "熵", "妈"]) {
  if (charLevel.has(ch)) { console.log(ch, "→ trong HSK", charLevel.get(ch)); continue; }
  const r = rankOf.get(ch);
  console.log(ch, "ngoài HSK | rank:", r ?? "(none)", "→ HSK", lvOf(r));
}

// 4) Ghi file: chỉ giữ ranks cho chữ NGOÀI HSK (chữ trong HSK đã có cấp gốc) để gọn.
const outRanks = {};
for (const [ch, r] of rankOf) if (!charLevel.has(ch)) outRanks[ch] = r;
const out = { thresholds, ranks: outRanks };
const path = new URL("../data/char-rank.json", import.meta.url);
writeFileSync(path, JSON.stringify(out));
console.log("Đã ghi data/char-rank.json — số chữ ngoài HSK có rank:", Object.keys(outRanks).length);

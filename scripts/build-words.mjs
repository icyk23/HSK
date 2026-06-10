// build-words.mjs — Phase 1: build dữ liệu từ vựng HSK1–6 (chạy 1 lần, offline).
//
// Đọc data/vocab.xlsx (5.002 từ HSK1–6) → làm sạch, sinh phồn thể (opencc-js),
// chạy pipeline phân loại (Lớp 1 + Lớp 2 trong js/classify.js) → xuất
// data/hsk-words.json (deck tĩnh đã phân loại). Lớp 3 (Qwen3) bổ sung sau.
//
// Chạy:  npm run build:words
//
// Lưu ý: đây là TOOL build, không phải runtime. App vẫn chạy không cần dependency.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import XLSX from "xlsx";
import * as OpenCC from "opencc-js";
import { classify, STRUCT_LABELS, SEMANTIC_LABELS } from "../js/classify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(ROOT, "data", "vocab.xlsx");
const OUT_PATH = path.join(ROOT, "data", "hsk-words.json");

const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

// Cột trong file (theo header thực tế):
// 0:STT 1:Từ mới 2:Phiên âm(từ) 3:Giải thích 4:Ví dụ hán 5:Phiên âm(ví dụ) 6:Dịch
const COL = { word: 1, pinyin: 2, meaning: 3, exZh: 4, exPy: 5, exVi: 6 };

// Làm sạch ô "Từ mới": xử lý các ca có ngoặc đặc biệt.
//   （杯）子 → 杯子   (ngoặc bọc 1 chữ ở đầu, sau còn chữ Hán → giữ chữ trong ngoặc)
//   哪里 (哪儿) → 哪里 ; 椅子 （把） → 椅子  (annotation sau khoảng trắng → bỏ)
//   得（助动词） → 得 ; 等（助词） → 等       (ngoặc chú thích từ loại → bỏ cả cụm)
function cleanSimplified(raw) {
  let w = String(raw || "").trim();
  if (/\s/.test(w)) w = w.split(/\s+/)[0];
  if (/^[（(][一-鿿][）)][一-鿿]/.test(w)) {
    w = w.replace(/[（）()]/g, "");
  } else {
    w = w.replace(/[（(][^）)]*[）)]/g, "");
  }
  return w.trim();
}

// Tách "[hán việt]" (nếu có) khỏi cột phiên âm.
function parsePinyin(raw) {
  let py = String(raw || "").trim();
  let han_viet = null;
  const m = py.match(/\[([^\]]+)\]/);
  if (m) {
    han_viet = m[1].trim();
    py = py.replace(/\[[^\]]*\]/, "").trim();
  }
  return { pinyin: py.replace(/\s+/g, " ").trim(), han_viet };
}

async function main() {
  const buf = await readFile(XLSX_PATH);
  const wb = XLSX.read(buf, { type: "buffer" });

  const cards = [];
  const stats = { perLevel: {}, struct: {}, semantic: {}, source: {}, needsReview: 0 };

  for (let level = 1; level <= 6; level++) {
    const sheet = wb.Sheets[`HSK${level}`];
    if (!sheet) {
      console.warn(`⚠ Không thấy sheet HSK${level}`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
    let n = 0;
    for (const r of rows.slice(1)) {
      const simplified = cleanSimplified(r[COL.word]);
      if (!simplified) continue;
      n++;
      const { pinyin, han_viet } = parsePinyin(r[COL.pinyin]);
      const meaning = String(r[COL.meaning] || "").trim();
      const traditional = toTraditional(simplified);

      const cls = classify({ simplified, meaning });

      cards.push({
        id: `hsk${level}-${String(n).padStart(4, "0")}`,
        simplified,
        traditional: traditional === simplified ? simplified : traditional,
        pinyin,
        han_viet,
        meaning,
        example: String(r[COL.exZh] || "").trim(),
        example_pinyin: String(r[COL.exPy] || "").trim(),
        example_vi: String(r[COL.exVi] || "").trim(),
        hsk_level: level,
        source: "excel",
        ...cls,
      });

      stats.perLevel[level] = (stats.perLevel[level] || 0) + 1;
      stats.struct[cls.struct_group] = (stats.struct[cls.struct_group] || 0) + 1;
      const sg = cls.semantic_group || "(chờ Qwen3)";
      stats.semantic[sg] = (stats.semantic[sg] || 0) + 1;
      stats.source[cls.classification_source] = (stats.source[cls.classification_source] || 0) + 1;
      if (cls.needs_review) stats.needsReview++;
    }
  }

  const deck = {
    id: "hsk-1-6",
    name: "HSK 1–6 (đầy đủ)",
    description: `Toàn bộ ${cards.length} từ HSK1–6, đã gán struct_group + semantic_group (Lớp 1+2). Phần còn lại chờ Qwen3 (Lớp 3).`,
    language: "zh",
    builtAt: new Date().toISOString().slice(0, 10),
    cards,
  };

  await writeFile(OUT_PATH, JSON.stringify(deck, null, 0) + "\n", "utf8");

  // ---- Báo cáo ----
  console.log(`\n✅ Đã ghi ${OUT_PATH}`);
  console.log(`Tổng: ${cards.length} từ`);
  console.log("Theo cấp:", stats.perLevel);
  console.log("\nstruct_group:");
  for (const k of Object.keys(STRUCT_LABELS)) if (stats.struct[k]) console.log(`  ${k} ${STRUCT_LABELS[k]}: ${stats.struct[k]}`);
  console.log("\nsemantic_group:");
  for (const k of Object.keys(SEMANTIC_LABELS)) if (stats.semantic[k]) console.log(`  ${k} ${SEMANTIC_LABELS[k]}: ${stats.semantic[k]}`);
  if (stats.semantic["(chờ Qwen3)"]) console.log(`  (chờ Qwen3): ${stats.semantic["(chờ Qwen3)"]}`);
  console.log("\nNguồn phân loại:", stats.source);
  console.log(`Cần xem lại (needs_review): ${stats.needsReview} (${(stats.needsReview / cards.length * 100).toFixed(1)}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

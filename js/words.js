// words.js — nạp kho từ vựng HSK (data/words.json) và cung cấp nhãn nhóm + bộ lọc.
// Kho này do scripts/build_vocab.py sinh ra (Pha 1): mỗi từ đã có struct_group
// và semantic_group (pipeline Lớp 1–2). Người dùng có thể sửa nhóm thủ công (Pha 2).

const WORDS_URL = "./data/words.json";
let cache = null;

export async function loadWords() {
  if (cache) return cache;
  try {
    const res = await fetch(WORDS_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    cache = data.words || [];
  } catch (e) {
    console.warn("Không tải được kho từ vựng:", e);
    cache = [];
  }
  return cache;
}

/* ---------------- Nhãn nhóm (tiếng Việt) ---------------- */
export const STRUCT_LABELS = {
  S1: "Đơn âm", S2: "Song âm", S3: "Tam âm", S4: "Thành ngữ", S5: "Cụm dài",
};

export const SEMANTIC_LABELS = {
  A1: "Thân thể & sức khỏe", A2: "Cảm xúc & tâm lý", A3: "Quan hệ & giao tiếp", A4: "Cuộc sống hàng ngày",
  B1: "Học thuật & nhà trường", B2: "Nghề nghiệp & công sở", B3: "Kinh tế & tài chính",
  C1: "Tư duy & lý luận", C2: "Ngôn ngữ & biểu đạt",
  D1: "Tự nhiên & địa lý", D2: "Không gian & thời gian",
  E1: "Chính trị & pháp luật", E2: "Văn hóa & nghệ thuật",
  F1: "Liên từ", F2: "Giới từ", F3: "Trợ từ", F4: "Phó từ", F5: "Đại từ", F6: "Lượng từ",
};

// Thứ tự hiển thị các nhóm ngữ nghĩa trong dropdown (gom theo cụm A–F)
export const SEMANTIC_ORDER = [
  "A1", "A2", "A3", "A4", "B1", "B2", "B3",
  "C1", "C2", "D1", "D2", "E1", "E2",
  "F1", "F2", "F3", "F4", "F5", "F6",
];

export const SOURCE_LABELS = {
  rule: "Quy tắc (F)", keyword: "Từ khóa", ai: "Qwen3", manual: "Sửa tay",
};

export function semanticLabel(code) {
  if (!code) return "Chưa phân loại";
  return SEMANTIC_LABELS[code] ? `${code} · ${SEMANTIC_LABELS[code]}` : code;
}

/* ---------------- Lọc ---------------- */
// filters: { q, hsk, struct, semantic, source }
//   semantic === "_none" -> chỉ từ chưa phân loại
//   source   === "_none" -> chưa phân loại nguồn
export function filterWords(words, f) {
  const q = (f.q || "").trim().toLowerCase();
  return words.filter((w) => {
    if (f.hsk && String(w.hsk_level) !== String(f.hsk)) return false;
    if (f.struct && w.struct_group !== f.struct) return false;
    if (f.semantic === "_none") {
      if (w.semantic_group) return false;
    } else if (f.semantic && w.semantic_group !== f.semantic) {
      return false;
    }
    if (f.source === "_none") {
      if (w.classification_source) return false;
    } else if (f.source && w.classification_source !== f.source) {
      return false;
    }
    if (q) {
      const hay = `${w.simplified} ${w.traditional || ""} ${w.pinyin || ""} ${w.meaning_vi || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

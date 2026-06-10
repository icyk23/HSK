// classify.js — pipeline phân loại từ vựng (Lớp 1 + Lớp 2), chạy được cả ở
// trình duyệt lẫn Node (script build). Lớp 3 (Qwen3) thêm sau khi có backend.
//
// Xuất 2 nhóm cho mỗi từ:
//   struct_group   : "S1".."S5" — gán 100% theo số chữ Hán
//   semantic_group : "A1".."E2" (nội dung) / "F1".."F6" (từ chức năng)
//
// Tham khảo đầy đủ: VOCAB_CLASSIFICATION_SYSTEM.md

/* ============================================================
 * CẤP 1 — NHÓM CẤU TRÚC (struct_group): theo số chữ Hán
 * ============================================================ */

// Đếm số chữ Hán (CJK Unified Ideographs), bỏ qua dấu câu/chữ Latin.
export function countHanzi(text) {
  if (!text) return 0;
  const m = String(text).match(/[一-鿿㐀-䶿]/g);
  return m ? m.length : 0;
}

// isIdiom: nếu biết từ CC-CEDICT có đánh dấu 成语 thì truyền true.
// Khi chưa có CEDICT (Phase 1), mặc định 4 chữ → S4 (tạm), 5+ chữ → S5.
export function structGroup(simplified, isIdiom = null) {
  const n = countHanzi(simplified);
  if (n <= 1) return "S1";
  if (n === 2) return "S2";
  if (n === 3) return "S3";
  if (n === 4) return isIdiom === false ? "S5" : "S4";
  return "S5"; // 5+ chữ
}

/* ============================================================
 * LỚP 1 — TỪ CHỨC NĂNG (danh sách đóng) → F1..F6
 * Tra khớp tuyệt đối theo `simplified`.
 * Lưu ý: vài từ thuộc >1 loại (vd 把 = giới từ F2 lẫn lượng từ F6);
 * ưu tiên theo thứ tự F1→F6 (first-win), người dùng sửa thủ công nếu cần.
 * ============================================================ */

const FUNCTION_WORDS = {
  F1: ["和", "但是", "因为", "所以", "虽然", "如果", "既然", "否则", "而且", "不过",
       "并且", "然后", "因此", "于是", "不但", "无论", "只要", "只有", "即使", "或者",
       "要是", "可是", "然而", "况且", "以及", "甚至", "与", "或", "及"],
  F2: ["在", "从", "到", "对", "把", "被", "为了", "关于", "按照", "除了",
       "向", "往", "于", "由", "给", "跟", "替", "为", "据", "凭", "沿", "朝", "自从", "随着", "通过"],
  F3: ["了", "过", "着", "吗", "吧", "呢", "啊", "的", "地", "得", "嘛", "啦", "哟", "呀", "哇", "罢了", "而已"],
  F4: ["很", "非常", "太", "最", "也", "都", "就", "才", "还", "已经", "一直", "一定",
       "曾经", "突然", "刚", "刚才", "马上", "立刻", "终于", "渐渐", "始终", "竟然", "居然", "难道", "几乎", "幸亏", "反而"],
  F5: ["我", "你", "他", "她", "它", "我们", "你们", "他们", "她们", "它们", "咱们",
       "这", "那", "谁", "什么", "哪", "怎么", "怎样", "自己", "大家", "别人", "这儿", "那儿", "哪儿", "这样", "那样", "多少"],
  F6: ["个", "本", "张", "条", "件", "辆", "只", "次", "遍", "种", "位", "名", "块", "点", "些",
       "杯", "碗", "双", "对", "群", "份", "篇", "座", "层", "台", "顶", "棵", "朵", "趟", "顿", "场", "阵"],
};

// Map ngược: simplified → mã F (ưu tiên F1..F6 theo thứ tự khai báo).
const FUNCTION_LOOKUP = (() => {
  const map = new Map();
  for (const code of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
    for (const w of FUNCTION_WORDS[code]) {
      if (!map.has(w)) map.set(w, code); // first-win
    }
  }
  return map;
})();

/* ============================================================
 * LỚP 2 — TỪ KHÓA NGHĨA TIẾNG VIỆT → A1..E2
 * Khớp theo *token* (ranh giới từ), không phải substring thô,
 * để tránh "học" dính trong "khoa học", "giá" trong "đánh giá"...
 * Đa-khớp (≥2 nhóm) → vẫn gán nhóm nhiều hit nhất nhưng bật needs_review.
 * ============================================================ */

// Từ khóa mỗi nhóm. Cụm nhiều chữ (vd "ngân hàng") khớp như một cụm.
const KEYWORD_MAP = {
  A1: ["bệnh", "ung thư", "đau", "sốt", "thuốc", "y tế", "phẫu thuật", "bác sĩ",
       "bệnh viện", "cơ thể", "sức khỏe", "triệu chứng", "khám", "chữa", "thương"],
  A2: ["vui", "buồn", "sợ", "tức", "yêu", "ghét", "lo", "cảm xúc", "tâm lý",
       "tính cách", "cảm giác", "tâm trạng", "vui mừng", "hạnh phúc", "tức giận", "lo lắng", "thất vọng", "tự tin"],
  A3: ["gia đình", "bạn bè", "đồng nghiệp", "chào", "xin lỗi", "cảm ơn", "quan hệ",
       "giao tiếp", "lịch sự", "cha mẹ", "bố mẹ", "bạn", "thăm hỏi", "lễ phép"],
  A4: ["ăn", "mặc", "ngủ", "nghỉ", "mua", "giải trí", "hàng ngày", "sinh hoạt",
       "nhà ở", "đi lại", "nấu", "tắm", "dạo", "mua sắm", "nghỉ ngơi"],
  B1: ["học", "thi", "trường", "giáo viên", "môn học", "nghiên cứu", "kiến thức",
       "giáo dục", "sinh viên", "học sinh", "bài", "lớp", "tốt nghiệp", "chuyên ngành"],
  B2: ["làm việc", "công ty", "nghề", "chức vụ", "hợp đồng", "nhiệm vụ", "nhân viên",
       "quản lý", "công việc", "giám đốc", "đồng nghiệp", "phụ trách", "sắp xếp", "công sở"],
  B3: ["tiền", "ngân hàng", "kinh tế", "thị trường", "đầu tư", "lợi nhuận", "tiêu dùng",
       "thu nhập", "giá", "kinh doanh", "buôn bán", "mua bán", "vốn", "tài chính"],
  C1: ["suy nghĩ", "phân tích", "lý luận", "quan điểm", "nguyên tắc", "lý thuyết",
       "phán đoán", "logic", "tư duy", "nhận thức", "lý lẽ", "đạo lý", "lý giải"],
  C2: ["ngôn ngữ", "dịch", "chữ", "văn", "giải thích", "diễn đạt", "mô tả",
       "từ ngữ", "câu", "biểu đạt", "văn chương", "phiên dịch", "thuyết minh"],
  D1: ["núi", "sông", "biển", "thời tiết", "động vật", "thực vật", "môi trường",
       "ô nhiễm", "tài nguyên", "khí hậu", "nhiệt độ", "thiên nhiên", "địa hình", "sinh vật"],
  D2: ["trên", "dưới", "trái", "phải", "trước", "sau", "thời gian", "khi", "lúc",
       "thường xuyên", "đôi khi", "gần đây", "phương hướng", "vị trí", "tương lai", "xung quanh"],
  E1: ["luật", "chính phủ", "quyền", "bầu cử", "chính sách", "dân chủ", "nhà nước",
       "pháp luật", "chính trị", "quyền lợi", "nghĩa vụ", "chế độ", "quốc gia"],
  E2: ["văn hóa", "lịch sử", "nghệ thuật", "âm nhạc", "hội họa", "lễ hội", "phong tục",
       "truyền thống", "tôn giáo", "nghệ sĩ", "hội hoạ", "tập tục"],
};

// Chuẩn hóa nghĩa tiếng Việt → chuỗi token cách nhau bởi dấu cách.
// Dấu phân cách nghĩa (; , / 、) → ranh giới "¶" để cụm keyword KHÔNG khớp
// bắc cầu qua hai nghĩa rời (vd "xử lý; giải quyết" ≠ cụm "lý giải").
function normalizeMeaning(meaning) {
  let t = String(meaning || "").toLowerCase();
  t = t.replace(/[;,/、，；。()\[\]·]+/g, " ¶ ");
  t = t.replace(/[^a-zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ¶]+/g, " ");
  return " " + t.replace(/\s+/g, " ").trim() + " ";
}

// Khớp một keyword (có thể là cụm) theo ranh giới từ trong text đã chuẩn hóa.
function hasKeyword(normText, keyword) {
  return normText.includes(" " + keyword + " ");
}

// Trả về { group, hits } cho mọi nhóm có ít nhất 1 keyword khớp.
function keywordMatches(meaning) {
  const norm = normalizeMeaning(meaning);
  const results = [];
  for (const [group, kws] of Object.entries(KEYWORD_MAP)) {
    let hits = 0;
    for (const kw of kws) if (hasKeyword(norm, kw)) hits++;
    if (hits > 0) results.push({ group, hits });
  }
  // nhiều hit nhất lên đầu; hòa → giữ thứ tự khai báo (ổn định)
  results.sort((a, b) => b.hits - a.hits);
  return results;
}

/* ============================================================
 * PIPELINE TỔNG: classify(word)
 * word = { simplified, meaning, isIdiom? }
 * Trả về { struct_group, semantic_group, classification_source,
 *          classification_conf, needs_review }
 * Lớp 3 (Qwen3) chưa chạy ở đây: nếu Lớp 1+2 không xác định được,
 * semantic_group = null, source = "ai", needs_review = true (chờ Qwen3).
 * ============================================================ */

export function classify(word) {
  const simplified = (word.simplified || "").trim();
  const struct_group = structGroup(simplified, word.isIdiom ?? null);

  // LỚP 1 — từ chức năng
  const fcode = FUNCTION_LOOKUP.get(simplified);
  if (fcode) {
    return {
      struct_group,
      semantic_group: fcode,
      classification_source: "rule",
      classification_conf: 1.0,
      needs_review: false,
    };
  }

  // LỚP 2 — từ khóa nghĩa tiếng Việt
  const matches = keywordMatches(word.meaning);
  if (matches.length === 1) {
    return {
      struct_group,
      semantic_group: matches[0].group,
      classification_source: "keyword",
      classification_conf: 0.85,
      needs_review: false,
    };
  }
  if (matches.length >= 2) {
    // đa-khớp: chọn nhóm nhiều hit nhất nhưng đánh dấu cần xem lại (opt #3)
    return {
      struct_group,
      semantic_group: matches[0].group,
      classification_source: "keyword",
      classification_conf: 0.6,
      needs_review: true,
    };
  }

  // Không khớp → để dành cho Lớp 3 (Qwen3) ở Phase backend
  return {
    struct_group,
    semantic_group: null,
    classification_source: "ai",
    classification_conf: 0.0,
    needs_review: true,
  };
}

// Tên đầy đủ của nhóm — dùng để hiển thị nhãn trong UI.
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

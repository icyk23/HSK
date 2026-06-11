// trad.js — Phồn thể: bóc các cặp chữ Giản→Phồn (khác nhau) từ bộ thẻ HSK,
// kèm pinyin/nghĩa (từ thẻ 1 chữ) + ví dụ từ. Chạy thuần trình duyệt.

// Trả mảng { simp, trad, level, pinyin, meaning, han_viet, examples:[{s,t}] } sắp theo cấp HSK.
export function buildTradPairs(cards) {
  const single = new Map(); // chữ đơn → { pinyin, meaning, han_viet }
  for (const c of cards) {
    const s = c.simplified || "";
    if ([...s].length === 1 && !single.has(s)) single.set(s, { pinyin: c.pinyin, meaning: c.meaning, han_viet: c.han_viet });
  }
  const map = new Map(); // simpChar → entry
  for (const c of cards) {
    const s = [...(c.simplified || "")];
    const t = [...(c.traditional || c.simplified || "")];
    if (s.length !== t.length) continue; // hiếm: lệch độ dài → bỏ qua
    const lv = c.hsk_level || 6;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === t[i]) continue;
      let e = map.get(s[i]);
      if (!e) { e = { simp: s[i], trad: t[i], level: lv, examples: [] }; map.set(s[i], e); }
      else if (lv < e.level) e.level = lv;
      if ([...(c.simplified || "")].length > 1 && e.examples.length < 6 && !e.examples.some((x) => x.s === c.simplified)) {
        e.examples.push({ s: c.simplified, t: c.traditional });
      }
    }
  }
  const pairs = [...map.values()].map((e) => {
    const inf = single.get(e.simp) || {};
    return { ...e, pinyin: inf.pinyin || "", meaning: inf.meaning || "", han_viet: inf.han_viet || "" };
  });
  pairs.sort((a, b) => a.level - b.level || (a.simp < b.simp ? -1 : 1));
  return pairs;
}

// Bộ thủ/thành phần giản↔phồn thông dụng (tham chiếu học nhận diện).
export const TRAD_COMPONENTS = [
  { s: "讠", t: "言", note: "bộ ngôn (lời nói)", ex: [["说", "說"], ["语", "語"], ["话", "話"]] },
  { s: "钅", t: "金", note: "bộ kim (kim loại)", ex: [["钱", "錢"], ["银", "銀"], ["钟", "鐘"]] },
  { s: "饣", t: "食", note: "bộ thực (ăn)", ex: [["饭", "飯"], ["饿", "餓"], ["馆", "館"]] },
  { s: "纟", t: "糸", note: "bộ mịch (tơ sợi)", ex: [["红", "紅"], ["给", "給"], ["级", "級"]] },
  { s: "马", t: "馬", note: "bộ mã (ngựa)", ex: [["妈", "媽"], ["吗", "嗎"], ["骑", "騎"]] },
  { s: "鸟", t: "鳥", note: "bộ điểu (chim)", ex: [["鸡", "雞"], ["鸭", "鴨"]] },
  { s: "门", t: "門", note: "bộ môn (cửa)", ex: [["问", "問"], ["们", "們"], ["间", "間"]] },
  { s: "见", t: "見", note: "bộ kiến (thấy)", ex: [["现", "現"], ["视", "視"], ["观", "觀"]] },
  { s: "贝", t: "貝", note: "bộ bối (tiền/quý)", ex: [["贵", "貴"], ["费", "費"], ["购", "購"]] },
  { s: "车", t: "車", note: "bộ xa (xe)", ex: [["轮", "輪"], ["软", "軟"], ["较", "較"]] },
  { s: "页", t: "頁", note: "bộ hiệt (trang/đầu)", ex: [["顾", "顧"], ["顿", "頓"], ["颜", "顏"]] },
  { s: "风", t: "風", note: "bộ phong (gió)", ex: [["飘", "飄"]] },
  { s: "鱼", t: "魚", note: "bộ ngư (cá)", ex: [["鲜", "鮮"]] },
  { s: "龙", t: "龍", note: "long (rồng)", ex: [["笼", "籠"], ["袭", "襲"]] },
  { s: "长", t: "長", note: "trường (dài)", ex: [["张", "張"], ["帐", "帳"]] },
  { s: "东", t: "東", note: "đông (hướng đông)", ex: [["冻", "凍"], ["陈", "陳"]] },
];

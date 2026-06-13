// cc.js — chuyển Giản thể → Phồn thể (简→繁) thuần trình duyệt.
// Khớp CỤM TỪ dài nhất trước (data/s2t-phrases.json, các ngoại lệ ngữ cảnh) rồi tới KÝ TỰ
// (data/s2t.json, bảng char OpenCC). Dùng cho "chế độ phồn thể toàn cục".

let S2T = null, PH = null, PHSTART = null, PHLEN = 1;

export async function ensureS2T() {
  if (S2T) return S2T;
  try {
    const [c, p] = await Promise.all([
      fetch("data/s2t.json").then((r) => r.json()),
      fetch("data/s2t-phrases.json").then((r) => r.json()).catch(() => ({})),
    ]);
    S2T = c; PH = p || {};
    PHSTART = new Set();
    for (const k of Object.keys(PH)) { const a = [...k]; PHSTART.add(a[0]); if (a.length > PHLEN) PHLEN = a.length; }
  } catch { S2T = {}; PH = {}; PHSTART = new Set(); }
  return S2T;
}

export function isReady() { return !!S2T; }

// Chuyển một chuỗi giản thể → phồn thể (cụm trước, rồi ký tự; ngoài bảng giữ nguyên).
export function s2t(text) {
  if (!S2T || !text) return text;
  const ch = [...text];
  let out = "";
  for (let i = 0; i < ch.length;) {
    const c = ch[i];
    if (PHSTART && PHSTART.has(c)) {
      const max = Math.min(PHLEN, ch.length - i);
      let hit = false;
      for (let L = max; L >= 2; L--) {
        const sub = ch.slice(i, i + L).join("");
        const rep = PH[sub];
        if (rep) { out += rep; i += L; hit = true; break; }
      }
      if (hit) continue;
    }
    out += (S2T[c] || c); i++;
  }
  return out;
}

const HAN = /[㐀-鿿]/;

// Quét text-node trong `root`, chuyển sang phồn thể. Bỏ qua nhánh có class "no-cc".
export function applyToDom(root) {
  if (!S2T || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!HAN.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
        if (p.classList && p.classList.contains("no-cc")) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) { const c = s2t(n.nodeValue); if (c !== n.nodeValue) n.nodeValue = c; }
}

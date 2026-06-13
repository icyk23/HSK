// cc.js — chuyển Giản thể → Phồn thể (简→繁) thuần trình duyệt.
// Bảng char-level OpenCC (data/s2t.json). Dùng cho "chế độ phồn thể toàn cục".

let S2T = null;

export async function ensureS2T() {
  if (S2T) return S2T;
  try { S2T = await fetch("data/s2t.json").then((r) => r.json()); }
  catch { S2T = {}; }
  return S2T;
}

export function isReady() { return !!S2T; }

// Chuyển một chuỗi giản thể → phồn thể (ký tự ngoài bảng giữ nguyên).
export function s2t(text) {
  if (!S2T || !text) return text;
  let out = "";
  for (const ch of text) out += (S2T[ch] || ch);
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

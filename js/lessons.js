// lessons.js — Nạp nội dung: phân tích văn bản → từ vựng xếp nhóm HSK + tách câu,
// và lưu "Bài học" vào IndexedDB. Chạy thuần trình duyệt (không cần backend).

import { splitChinese } from "./comm.js";

const HAN = /[一-鿿]/;

/* ---------------- Chỉ mục từ vựng (từ 5.002 từ HSK) ---------------- */
let _idx = null;
export async function loadVocabIndex() {
  if (_idx) return _idx;
  let cards = [];
  try {
    const r = await fetch("./data/hsk-words.json");
    const data = await r.json();
    cards = Array.isArray(data) ? data : data.cards || data.words || [];
  } catch {}
  const wordMap = new Map();   // simplified → { level, meaning, id }
  const charLevel = new Map(); // chữ Hán → cấp HSK thấp nhất (sớm nhất gặp)
  let maxLen = 1;
  for (const c of cards) {
    const s = c.simplified;
    if (!s) continue;
    const lv = c.hsk_level || 6;
    if (!wordMap.has(s)) wordMap.set(s, { level: lv, meaning: c.meaning, id: c.id });
    const len = [...s].length;
    if (len > maxLen) maxLen = len;
    for (const ch of s) {
      const cur = charLevel.get(ch);
      if (cur == null || lv < cur) charLevel.set(ch, lv);
    }
  }
  _idx = { wordMap, charLevel, maxLen: Math.min(maxLen, 6) };
  return _idx;
}

// Quy tắc xếp nhóm cho token KHÔNG có trong danh sách HSK:
// level = cấp HSK CAO NHẤT trong các chữ Hán cấu thành (biết hết chữ thì học được từ);
// nếu có chữ ngoài HSK → nhóm 7 ("6+ / Ngoài HSK").
function tokenLevel(tok, idx) {
  const w = idx.wordMap.get(tok);
  if (w) return w.level;
  let lv = 1, unknown = false;
  for (const ch of tok) {
    const cl = idx.charLevel.get(ch);
    if (cl == null) unknown = true;
    else if (cl > lv) lv = cl;
  }
  return unknown ? 7 : lv;
}

// Tách từ bằng khớp-dài-nhất với từ điển; token lạ giữ ở mức 1 chữ.
// Trả mảng { word, level, meaning, cardId, inDict, freq } đã gộp & sắp xếp.
export function analyzeVocab(text, idx) {
  const chars = [...text];
  const tokens = new Map();
  let i = 0;
  while (i < chars.length) {
    if (!HAN.test(chars[i])) { i++; continue; }
    let matched = null;
    for (let L = Math.min(idx.maxLen, chars.length - i); L >= 1; L--) {
      const cand = chars.slice(i, i + L).join("");
      if (idx.wordMap.has(cand)) { matched = cand; break; }
    }
    const tok = matched || chars[i];
    i += [...tok].length;
    let e = tokens.get(tok);
    if (!e) {
      const w = idx.wordMap.get(tok);
      e = { word: tok, level: tokenLevel(tok, idx), meaning: w ? w.meaning : null, cardId: w ? w.id : null, inDict: !!w, freq: 0 };
      tokens.set(tok, e);
    }
    e.freq++;
  }
  return [...tokens.values()].sort((a, b) => a.level - b.level || b.freq - a.freq);
}

export async function analyzeText(text) {
  const idx = await loadVocabIndex();
  return { vocab: analyzeVocab(text, idx), sentences: splitChinese(text).map((zh) => ({ zh })) };
}

/* ---------------- Lưu Bài học (IndexedDB) ---------------- */
const DB = "hsk-lessons";
let dbP = null;
function openDB() {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("lessons")) r.result.createObjectStore("lessons", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function saveLesson(l) {
  const db = await openDB();
  const t = db.transaction("lessons", "readwrite");
  t.objectStore("lessons").put(l);
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}
export async function listLessons() {
  const db = await openDB();
  const all = await reqP(db.transaction("lessons", "readonly").objectStore("lessons").getAll());
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export async function getLesson(id) {
  const db = await openDB();
  return reqP(db.transaction("lessons", "readonly").objectStore("lessons").get(id));
}
export async function deleteLesson(id) {
  const db = await openDB();
  const t = db.transaction("lessons", "readwrite");
  t.objectStore("lessons").delete(id);
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

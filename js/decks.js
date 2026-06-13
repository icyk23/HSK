// decks.js — loads the bundled starter deck and merges it with user-created decks.

import { getUserDecks } from "./store.js";

const BUNDLED = ["./data/hsk-words.json", "./data/hsk6-starter.json"];
let bundledCache = null;

export async function loadBundledDecks() {
  if (bundledCache) return bundledCache;
  const decks = [];
  for (const url of BUNDLED) {
    try {
      const res = await fetch(url);
      if (res.ok) decks.push({ ...(await res.json()), builtin: true });
    } catch (e) {
      console.warn("Không tải được bộ thẻ:", url, e);
    }
  }
  bundledCache = decks;
  return decks;
}

export async function getAllDecks() {
  const bundled = await loadBundledDecks();
  return [...bundled, ...getUserDecks()];
}

export async function getDeck(id) {
  return (await getAllDecks()).find((d) => d.id === id) || null;
}

// Parse a CSV/TSV string into cards.
// Expected columns (header optional, order-flexible): simplified, traditional, pinyin, meaning, example
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delim = lines[0].includes("\t") ? "\t" : ",";
  const splitLine = (l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

  let header = null;
  const first = splitLine(lines[0]).map((c) => c.toLowerCase());
  const headerWords = ["simplified", "traditional", "pinyin", "meaning", "example", "giản thể", "phồn thể", "nghĩa"];
  if (first.some((c) => headerWords.includes(c))) header = first;

  const colMap = { simplified: 0, traditional: 1, pinyin: 2, meaning: 3, example: 4 };
  if (header) {
    const find = (...names) => header.findIndex((h) => names.includes(h));
    colMap.simplified = find("simplified", "giản thể", "简体");
    colMap.traditional = find("traditional", "phồn thể", "繁體");
    colMap.pinyin = find("pinyin", "拼音");
    colMap.meaning = find("meaning", "nghĩa", "释义");
    colMap.example = find("example", "ví dụ", "例句");
  }

  const rows = header ? lines.slice(1) : lines;
  const cards = [];
  rows.forEach((line, i) => {
    const c = splitLine(line);
    const get = (k) => (colMap[k] >= 0 && c[colMap[k]] !== undefined ? c[colMap[k]] : "");
    const simplified = get("simplified");
    if (!simplified) return;
    cards.push({
      id: `u-${Date.now().toString(36)}-${i}`,
      simplified,
      traditional: get("traditional") || simplified,
      pinyin: get("pinyin"),
      meaning: get("meaning"),
      example: get("example"),
    });
  });
  return cards;
}

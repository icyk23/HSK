// comm.js — ngân hàng câu cho module Giao tiếp (Luyện phản xạ + Phát âm).
// Nguồn câu: (1) bộ cảnh mẫu data/comm-scenes.json, (2) văn bản người dùng dán,
// (3) file văn bản (.txt/.srt) trong thư viện đã nạp (IndexedDB).
// Ảnh / video / PDF cần Qwen3 bóc chữ → để sau (khi có backend).

import * as lib from "./library.js";
import { getSettings } from "./store.js";

let scenesCache = null;

export async function loadScenes() {
  if (scenesCache) return scenesCache;
  try {
    const res = await fetch("./data/comm-scenes.json");
    scenesCache = res.ok ? (await res.json()).scenes || [] : [];
  } catch {
    scenesCache = [];
  }
  return scenesCache;
}

const hasHan = (s) => /[一-鿿]/.test(s);

// Tách văn bản tiếng Trung thành từng câu (giữ dấu câu cuối).
export function splitChinese(text) {
  return String(text)
    .replace(/\r/g, "")
    .split(/(?<=[。！？!?\n；;])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => hasHan(s) && [...s].filter(hasHan).length >= 2);
}

// Phụ đề .srt → bỏ số thứ tự + mốc thời gian, rồi tách câu.
export function parseSrt(text) {
  const noTime = String(text)
    .replace(/\r/g, "")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^\d\d:\d\d:\d\d[.,]\d{3}\s*-->.*$/gm, "");
  return splitChinese(noTime).map((zh) => ({ zh }));
}

// Cặp song ngữ: mỗi dòng "中文 ||| Tiếng Việt" hoặc "中文<tab>Tiếng Việt".
export function parseBilingual(text) {
  const out = [];
  for (const raw of String(text).split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*\|\|\|\s*|\t+/);
    if (parts.length >= 2 && hasHan(parts[0])) {
      out.push({ zh: parts[0].trim(), vi: parts.slice(1).join(" ").trim() });
    } else if (hasHan(line)) {
      out.push({ zh: line });
    }
  }
  return out;
}

// Tự đoán định dạng văn bản người dùng dán → mảng { zh, vi? }.
export function parseUserText(text) {
  if (/-->/.test(text)) return parseSrt(text);
  if (/\|\|\||\t/.test(text)) return parseBilingual(text);
  return splitChinese(text).map((zh) => ({ zh }));
}

// Liệt kê mọi file trong thư viện, kèm phân loại (text dùng được ngay).
export async function listLibraryFiles() {
  const colls = await lib.listCollections();
  const out = [];
  for (const c of colls) {
    for (const fm of c.fileMeta || []) {
      out.push({ collId: c.id, collName: c.name, kind: lib.fileKind(fm), ...fm });
    }
  }
  return out;
}

// Bóc câu từ 1 file thư viện. Chỉ file text bóc được trong trình duyệt;
// pdf/audio/image cần Qwen3 → trả mảng rỗng (UI báo "sắp có").
export async function extractFileLines(fileId, kind) {
  if (kind !== "text") return [];
  const blob = await lib.getFileBlob(fileId);
  if (!blob) return [];
  try {
    return parseUserText(await blob.text());
  } catch {
    return [];
  }
}

/* ---------- Dựng ngân hàng cho từng kiểu luyện ---------- */

// Câu lẻ để Shadowing / Sprint (gộp lines + đáp án hỏi-đáp + câu mẫu của pattern).
export function sceneLineBank(scene) {
  const out = [];
  for (const l of scene.lines || []) out.push({ zh: l.zh, pinyin: l.pinyin, vi: l.vi });
  for (const qa of scene.qa || []) out.push({ zh: qa.a, pinyin: qa.a_pinyin, vi: qa.a_vi });
  for (const p of scene.patterns || [])
    for (const s of p.slots || [])
      out.push({ zh: fillFrame(p.frame, s.zh), vi: fillFrame(p.frame_vi, s.vi) });
  return out;
}

export function fillFrame(frame, slot) {
  return String(frame).replace("{}", slot);
}

/* ---------- Backend Qwen3 (bóc ảnh/PDF/audio/video + dịch Việt) ---------- */
// Backend là TÙY CHỌN. Rỗng = chưa bật → UI dùng nhãn "sắp có".
export function backendUrl() {
  return (getSettings().commBackendUrl || "").replace(/\/+$/, "");
}
export function hasBackend() {
  return !!backendUrl();
}

// Kiểm tra backend sống không + năng lực nào (ocr/asr/pdf). Trả null nếu không tới được.
export async function pingBackend() {
  const url = backendUrl();
  if (!url) return null;
  try {
    const res = await fetch(url + "/health", { signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Gửi 1 blob lên backend → trả mảng { zh, vi }.
export async function extractViaBackend(blob, name, kind, translate = true) {
  const url = backendUrl();
  if (!url) throw new Error("Chưa cấu hình backend Qwen3 trong Cài đặt.");
  const fd = new FormData();
  fd.append("file", blob, name || "file");
  fd.append("kind", kind || "auto");
  fd.append("translate", translate ? "true" : "false");
  const res = await fetch(url + "/extract", { method: "POST", body: fd });
  if (!res.ok) {
    let msg = "Lỗi backend (" + res.status + ")";
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).lines || [];
}

// Chấm & sửa bản dịch (Dịch thuật). dir: "zh2vi" | "vi2zh".
// Trả { reference, score, corrected, notes:[] }.
export async function gradeTranslation(source, user, dir) {
  return postJson("/grade", { source, user, dir });
}

// Chấm phần Viết 缩写 (Luyện đề). Trả { score, scores, corrected, notes:[] }.
export async function gradeWriting(article, title, text, target) {
  return postJson("/grade-writing", { article, title, text, target });
}

async function postJson(path, payload) {
  const url = backendUrl();
  if (!url) throw new Error("Chưa cấu hình backend Qwen3 trong Cài đặt.");
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = "Lỗi backend (" + res.status + ")";
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return await res.json();
}

// exams.js — nạp đề luyện thi tĩnh (data/exam-*.json) và gộp với đề người dùng nhập.

import { getUserExams, getUserHskk } from "./store.js";

const BUNDLED = ["./data/exam-hsk6.json"];
let bundledCache = null;

export async function loadBundledExams() {
  if (bundledCache) return bundledCache;
  const exams = [];
  for (const url of BUNDLED) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const ex of data.exams || []) exams.push({ ...ex, builtin: true });
      }
    } catch (e) {
      console.warn("Không tải được đề:", url, e);
    }
  }
  bundledCache = exams;
  return exams;
}

export async function getAllExams() {
  const bundled = await loadBundledExams();
  return [...bundled, ...getUserExams()];
}

export async function getExam(id) {
  return (await getAllExams()).find((e) => e.id === id) || null;
}

// Đếm tổng số câu trắc nghiệm trong phần Đọc của một đề.
export function countReadingQuestions(exam) {
  let n = 0;
  for (const sec of exam.reading || []) {
    for (const item of sec.items || []) {
      if (item.type === "mcq") n += 1;
      else if (item.type === "cloze") n += (item.blanks || []).length;
      else if (item.type === "sentence-cloze") n += (item.answers || []).length;
      else if (item.type === "reading") n += (item.questions || []).length;
    }
  }
  return n;
}

// Kiểm tra & chuẩn hóa 1 đề người dùng nhập (JSON). Trả {exam} hoặc {error}.
export function parseExamJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "JSON không hợp lệ: " + e.message };
  }
  // Cho phép nhập 1 đề, hoặc { exams:[...] } (lấy đề đầu).
  const exam = Array.isArray(data.exams) ? data.exams[0] : data;
  if (!exam || typeof exam !== "object") return { error: "Không tìm thấy đề trong JSON." };
  if (!exam.title) return { error: "Đề thiếu trường “title”." };
  if (!Array.isArray(exam.reading) && !exam.writing) return { error: "Đề cần có “reading” hoặc “writing”." };
  exam.id = "u-exam-" + Date.now().toString(36);
  exam.reading = exam.reading || [];
  return { exam };
}

/* ---------------- HSKK 高级 (thi nói) ---------------- */
let hskkBundled = null;
async function loadBundledHskk() {
  if (hskkBundled) return hskkBundled;
  const out = [];
  try {
    const res = await fetch("./data/hskk-gaoji.json");
    if (res.ok) for (const e of (await res.json()).hskk || []) out.push({ ...e, builtin: true });
  } catch (e) {
    console.warn("Không tải được đề HSKK:", e);
  }
  hskkBundled = out;
  return out;
}
export async function getHskkExams() {
  return [...(await loadBundledHskk()), ...getUserHskk()];
}
export async function getHskk(id) {
  return (await getHskkExams()).find((e) => e.id === id) || null;
}

// Kiểm tra & chuẩn hóa 1 đề HSKK (từ JSON hoặc Qwen3). Trả {exam} hoặc {error}.
export function parseHskkJson(input) {
  let data;
  if (typeof input === "string") {
    try { data = JSON.parse(input); } catch (e) { return { error: "JSON không hợp lệ: " + e.message }; }
  } else {
    data = input;
  }
  const exam = Array.isArray(data && data.hskk) ? data.hskk[0] : data;
  if (!exam || typeof exam !== "object") return { error: "Không tìm thấy đề HSKK." };
  if (!exam.title) return { error: "Đề thiếu “title”." };
  const retell = Array.isArray(exam.retell) ? exam.retell.filter((x) => x && x.zh) : [];
  const answer = Array.isArray(exam.answer) ? exam.answer.filter((x) => x && x.q_zh) : [];
  const read = exam.read && exam.read.zh ? exam.read : null;
  if (!retell.length && !read && !answer.length) return { error: "Đề HSKK cần có retell / read / answer." };
  return { exam: { id: "u-hskk-" + Date.now().toString(36), title: exam.title, note: exam.note || "", retell, read, answer } };
}

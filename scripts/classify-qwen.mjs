// classify-qwen.mjs — Task 3c (Lớp 3): phân loại các từ còn lại bằng Qwen3 (Ollama local).
//
// Chạy TRÊN MÁY CÓ OLLAMA + QWEN3:
//   ollama pull qwen3            (hoặc model bạn có)
//   npm run classify:qwen        (toàn bộ từ chưa phân loại)
//   npm run classify:qwen -- --limit 20   (thử 20 từ trước)
//
// Cấu hình qua biến môi trường:
//   OLLAMA_URL   (mặc định http://localhost:11434)
//   QWEN_MODEL   (mặc định qwen3)
//   CONCURRENCY  (mặc định 2 — máy 8GB nên để thấp)
//
// An toàn:
//   - Chỉ xử lý từ có semantic_group rỗng VÀ classification_source != "manual".
//   - Lưu tiến độ mỗi 50 từ → ngắt giữa chừng vẫn không mất, chạy lại sẽ tiếp tục.
//   - confidence < 0.7 → needs_review = true (hiện badge "cần xem lại" trong app).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "..", "data", "hsk-words.json");

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.QWEN_MODEL || "qwen3";
const CONCURRENCY = Math.max(1, +(process.env.CONCURRENCY || 2));
const SAVE_EVERY = 50;
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? +process.argv[i + 1] : Infinity; })();

const GROUPS = {
  A1: "thân thể/sức khỏe", A2: "cảm xúc/tâm lý", A3: "quan hệ/giao tiếp", A4: "cuộc sống hàng ngày",
  B1: "học thuật/trường", B2: "nghề nghiệp/công sở", B3: "kinh tế/tài chính",
  C1: "tư duy/lý luận", C2: "ngôn ngữ/biểu đạt",
  D1: "tự nhiên/địa lý", D2: "không gian/thời gian",
  E1: "chính trị/pháp luật", E2: "văn hóa/nghệ thuật",
};
const VALID = new Set(Object.keys(GROUPS));

function buildPrompt(card) {
  const groupList = Object.entries(GROUPS).map(([k, v]) => `${k}=${v}`).join(", ");
  return `Phân loại từ tiếng Trung sau vào đúng 1 nhóm. Trả lời JSON duy nhất, không giải thích dài.

Từ: ${card.simplified}
Nghĩa tiếng Việt: ${card.meaning || ""}
Câu ví dụ: ${card.example || ""}
Nguồn tài liệu: ${card.source || "excel"}

Các nhóm:
${groupList}

Trả về: {"group": "XX", "confidence": 0.0-1.0, "reason": "1 câu ngắn"}
Nếu từ có thể thuộc 2 nhóm, ưu tiên nhóm phù hợp với nguồn tài liệu hơn.`;
}

async function classifyOne(card) {
  const body = {
    model: MODEL,
    prompt: buildPrompt(card),
    stream: false,
    format: "json",
    options: { temperature: 0.1 },
  };
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.response); }
  catch { throw new Error(`JSON không hợp lệ: ${String(data.response).slice(0, 80)}`); }
  return parsed;
}

function applyResult(card, parsed) {
  const g = String(parsed.group || "").toUpperCase().trim();
  if (!VALID.has(g)) throw new Error(`nhóm lạ "${parsed.group}"`);
  const conf = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  card.semantic_group = g;
  card.classification_source = "ai";
  card.classification_conf = conf;
  card.needs_review = conf < 0.7;
  if (parsed.reason) card.classification_reason = String(parsed.reason).slice(0, 140);
}

async function main() {
  const deck = JSON.parse(await readFile(DATA, "utf8"));
  const targets = deck.cards.filter((c) => !c.semantic_group && c.classification_source !== "manual");
  const todo = targets.slice(0, LIMIT === Infinity ? targets.length : LIMIT);

  console.log(`Ollama: ${OLLAMA} | model: ${MODEL} | concurrency: ${CONCURRENCY}`);
  console.log(`Cần phân loại: ${targets.length} từ${todo.length < targets.length ? ` (chạy ${todo.length} từ lần này)` : ""}\n`);
  if (!todo.length) { console.log("Không còn từ nào cần phân loại. 🎉"); return; }

  let done = 0, ok = 0, fail = 0, sinceSave = 0;
  const save = async () => { await writeFile(DATA, JSON.stringify(deck, null, 0) + "\n", "utf8"); };

  // worker pool
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const card = todo[cursor++];
      try {
        const parsed = await classifyOne(card);
        applyResult(card, parsed);
        ok++;
      } catch (e) {
        fail++;
        card.needs_review = true; // để dành sửa tay / chạy lại
        if (fail <= 10) console.warn(`  ⚠ ${card.simplified}: ${e.message}`);
      }
      done++; sinceSave++;
      if (done % 25 === 0 || done === todo.length) process.stdout.write(`\r  tiến độ: ${done}/${todo.length} (ok ${ok}, lỗi ${fail})   `);
      if (sinceSave >= SAVE_EVERY) { sinceSave = 0; await save(); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await save();

  console.log(`\n\n✅ Xong. Phân loại ${ok} từ, lỗi ${fail}.`);
  const remaining = deck.cards.filter((c) => !c.semantic_group).length;
  const review = deck.cards.filter((c) => c.needs_review).length;
  console.log(`Còn chưa phân loại: ${remaining} | cần xem lại: ${review}`);
  if (fail) console.log(`(Chạy lại lệnh để thử tiếp ${fail} từ lỗi.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

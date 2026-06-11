// ui.js — view rendering for every tab.

import * as store from "./store.js";
import * as srs from "./srs.js";
import { speak, hasChineseVoice, hasRecognition, recognizeChinese, stopSpeaking } from "./audio.js";
import * as comm from "./comm.js";
import * as lessons from "./lessons.js";
import { navigate } from "./main.js";
import { getAllDecks, getDeck, parseCsv } from "./decks.js";
import { getAllExams, getExam, countReadingQuestions, parseExamJson, getHskkExams, getHskk } from "./exams.js";
import { unzip } from "./unzip.js";
import * as lib from "./library.js";
import { STRUCT_LABELS, SEMANTIC_LABELS } from "./classify.js";

const app = () => document.getElementById("app");

/* ---------------- helpers ---------------- */
export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function displayHanzi(card, mode) {
  if (mode === "traditional") return { main: card.traditional, sub: null };
  if (mode === "both") return { main: card.simplified, sub: card.traditional !== card.simplified ? card.traditional : null };
  return { main: card.simplified, sub: null };
}

function clear() {
  const root = app();
  root.innerHTML = "";
  return root;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Tô đậm mọi lần xuất hiện của từ khóa trong câu ví dụ (an toàn HTML).
function highlightHeadword(example, word) {
  const esc = escapeHtml(example);
  if (!word) return esc;
  return esc.split(escapeHtml(word)).join(`<mark class="hl">${escapeHtml(word)}</mark>`);
}

// Trạng thái học của một thẻ: new | learning | due | known
function learnStatus(cardId) {
  const st = store.getCardState(cardId);
  if (!st || st.reps === 0) return "new";
  if (st.known) return "known";
  if (srs.isDue(st)) return "due";
  return "learning";
}
const STATUS_LABELS = { new: "Chưa học", learning: "Đang học", due: "Đến hạn", known: "Đã thuộc" };

/* ============================================================
   STUDY (flashcards + SRS)
   ============================================================ */
let session = null;

// Bộ lọc học tập (do tab Từ vựng đặt qua "Học các từ đang lọc").
let studyFilter = null;
let studyFilterLabel = "";
export function setStudyFilter(pred, label) { studyFilter = pred; studyFilterLabel = label || ""; }
function clearStudyFilter() { studyFilter = null; studyFilterLabel = ""; }
function studyFilterBanner() {
  if (!studyFilter) return null;
  return el("div", { class: "filter-banner" },
    el("span", {}, `🔎 Đang học theo bộ lọc: ${studyFilterLabel}`),
    el("button", { class: "btn ghost small", onclick: () => { clearStudyFilter(); renderStudy(); } }, "✕ Bỏ lọc"));
}

export async function renderStudy() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  const banner = studyFilterBanner();

  if (!deck) {
    if (banner) root.append(banner);
    root.append(emptyState("Chưa chọn bộ thẻ", "Vào tab 📚 Bộ thẻ để chọn hoặc tạo bộ thẻ."));
    return;
  }

  let cards = deck.cards;
  if (studyFilter) cards = cards.filter(studyFilter);

  const progress = store.getProgress();
  const queue = srs.buildQueue(cards, progress, { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit });

  if (!queue.length) {
    if (banner) root.append(banner);
    root.append(emptyState("🎉 Xong hôm nay!", studyFilter
      ? `Đã ôn hết thẻ đến hạn trong bộ lọc. Bỏ lọc để học cả bộ, hoặc quay lại sau.`
      : `Bạn đã ôn hết thẻ đến hạn của "${deck.name}". Quay lại sau nhé, hoặc tăng số từ mới/ngày trong Cài đặt.`));
    return;
  }

  session = { deck, queue, idx: 0, total: queue.length, settings: s, revealed: false };
  renderCard();
}

function advance() {
  session.idx += 1;
  session.revealed = false;
  if (session.idx >= session.queue.length) renderStudy();
  else renderCard();
}
function skipCard() {
  if (!session) return;
  toast("Đã bỏ qua");
  advance();
}
function markKnown() {
  if (!session) return;
  const card = session.queue[session.idx];
  store.saveCardState(card.id, srs.knownState(session.deck.id));
  toast(`✓ Đã thuộc "${card.simplified}" — sẽ không hiện lại`);
  advance();
}

function renderCard() {
  const root = clear();
  const { deck, queue, idx, total, settings } = session;
  const rawCard = queue[idx];
  if (!rawCard) return renderStudy();
  const card = store.mergeClassification(rawCard);

  const { main, sub } = displayHanzi(card, settings.charMode);
  const progressPct = Math.round((idx / total) * 100);

  const bar = el("div", { class: "progress" }, el("span", { style: `width:${progressPct}%` }));
  const counter = el("div", { class: "muted center", style: "margin-bottom:10px" }, `${idx + 1} / ${total}`);

  const front = el("div", { class: "stack" },
    el("div", { class: "label-tag" }, settings.charMode === "traditional" ? "Phồn thể" : "Giản thể"),
    el("div", { class: "hanzi" }, main),
    sub && el("div", { class: "hanzi trad" }, sub),
    settings.showPinyinByDefault && el("div", { class: "pinyin" }, card.pinyin),
    el("button", { class: "card-audio", title: "Nghe phát âm", onclick: (e) => { e.stopPropagation(); speak(card.simplified, { rate: settings.speechRate }); } }, "🔊"),
    !session.revealed && el("div", { class: "tap-hint" }, "Chạm vào thẻ để xem nghĩa"),
  );

  const back = session.revealed && el("div", { class: "stack" },
    el("div", { class: "pinyin" }, card.pinyin),
    el("div", { class: "meaning" }, card.meaning),
    card.han_viet && el("div", { class: "muted" }, `Hán-Việt: ${card.han_viet}`),
    settings.charMode !== "both" && card.traditional !== card.simplified &&
      el("div", { class: "muted" }, `${settings.charMode === "traditional" ? "Giản thể" : "Phồn thể"}: ${settings.charMode === "traditional" ? card.simplified : card.traditional}`),
    card.example && el("div", { class: "example", html: highlightHeadword(card.example, card.simplified) }),
    (card.hsk_level || card.semantic_group) && el("div", { class: "chips center-chips" },
      card.hsk_level && el("span", { class: "chip lvl" }, "HSK" + card.hsk_level),
      card.semantic_group && el("span", { class: semChipClass(card.semantic_group), title: SEMANTIC_LABELS[card.semantic_group] || "" }, `${card.semantic_group} ${SEMANTIC_LABELS[card.semantic_group] || ""}`),
    ),
  );

  const flashcard = el("div", { class: "flashcard", onclick: () => { if (!session.revealed) reveal(); } }, front, back);

  const banner = studyFilterBanner();
  if (banner) root.append(banner);
  root.append(bar, counter, flashcard);

  if (session.revealed) {
    root.append(gradeButtons(card));
  } else {
    root.append(el("div", { class: "row", style: "margin-top:14px;justify-content:center" },
      el("button", { class: "btn primary", onclick: reveal }, "Hiện nghĩa (Space)")));
  }

  // Hành động phụ: bỏ qua / đã thuộc (dùng được cả trước và sau khi lật)
  root.append(el("div", { class: "skip-row" },
    el("button", { class: "btn ghost small", title: "Bỏ qua thẻ này, không ghi nhận (S)", onclick: skipCard }, "⏭️ Bỏ qua"),
    el("button", { class: "btn ghost small", title: "Đã thuộc — không hiện lại (K)", onclick: markKnown }, "✓ Đã thuộc"),
  ));

  if (settings.autoPlayAudio) speak(card.simplified, { rate: settings.speechRate });
}

function reveal() {
  session.revealed = true;
  renderCard();
}

function gradeButtons(card) {
  const st = store.getCardState(card.id) || srs.freshState(session.deck.id);
  const preview = (g) => srs.humanInterval(srs.schedule(st, g).interval || 0);

  const grade = (g, ok) => {
    const next = srs.schedule(store.getCardState(card.id) || srs.freshState(session.deck.id), g);
    store.saveCardState(card.id, next);
    store.logReview(ok);
    if (g === srs.GRADES.AGAIN) {
      // push to back of queue for another try this session
      session.queue.push(card);
      session.total = session.queue.length;
    }
    advance();
  };

  return el("div", { class: "grade-row", style: "margin-top:14px" },
    el("button", { class: "btn grade again", onclick: () => grade(srs.GRADES.AGAIN, false) }, "Lại", el("span", { class: "k" }, "1 phút")),
    el("button", { class: "btn grade hard", onclick: () => grade(srs.GRADES.HARD, true) }, "Khó", el("span", { class: "k" }, preview(srs.GRADES.HARD))),
    el("button", { class: "btn grade good", onclick: () => grade(srs.GRADES.GOOD, true) }, "Được", el("span", { class: "k" }, preview(srs.GRADES.GOOD))),
    el("button", { class: "btn grade easy", onclick: () => grade(srs.GRADES.EASY, true) }, "Dễ", el("span", { class: "k" }, preview(srs.GRADES.EASY))),
  );
}

// keyboard: space reveal, 1-4 grade
export function handleStudyKey(e) {
  if (!session) return;
  if (e.code === "Space") { e.preventDefault(); if (!session.revealed) reveal(); return; }
  if (e.key === "s" || e.key === "S") { e.preventDefault(); skipCard(); return; }
  if (e.key === "k" || e.key === "K") { e.preventDefault(); markKnown(); return; }
  if (session.revealed && ["1", "2", "3", "4"].includes(e.key)) {
    const map = { "1": ".again", "2": ".hard", "3": ".good", "4": ".easy" };
    document.querySelector(`.grade${map[e.key]}`)?.click();
  }
}

/* ============================================================
   VOCAB BROWSER (lọc theo cấp/nhóm + sửa nhóm thủ công)
   ============================================================ */
const SEM_ORDER = Object.keys(SEMANTIC_LABELS); // A1..F6
const SEM_COLORS = { A: "#d65745", B: "#d97706", C: "#7c3aed", D: "#0f766e", E: "#2563eb", F: "#6b7280" };
let vocab = { level: "all", sem: "all", struct: "all", status: "all", review: false, sort: "level", q: "", limit: 100, editing: null };

function matchVocab(c, f) {
  if (f.level !== "all" && String(c.hsk_level) !== f.level) return false;
  if (f.struct !== "all" && c.struct_group !== f.struct) return false;
  if (f.sem === "none") { if (c.semantic_group) return false; }
  else if (f.sem !== "all" && c.semantic_group !== f.sem) return false;
  if (f.review && !c.needs_review) return false;
  if (f.status !== "all" && learnStatus(c.id) !== f.status) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = `${c.simplified} ${c.traditional || ""} ${(c.pinyin || "").toLowerCase()} ${(c.meaning || "").toLowerCase()} ${(c.han_viet || "").toLowerCase()}`;
    if (!hay.includes(q)) return false;
  }
  return true;
}

export async function renderVocab() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  root.append(el("h1", { class: "view-title" }, "📖 Danh sách từ"));
  if (!deck) { root.append(emptyState("Chưa chọn bộ thẻ", "Vào tab 📚 Bộ thẻ để chọn bộ thẻ.")); return; }

  // Áp override sửa tay lên từng thẻ
  const cards = deck.cards.map(store.mergeClassification);
  const levels = [...new Set(cards.map((c) => c.hsk_level).filter(Boolean))].sort();

  const reRender = (resetLimit = true) => { if (resetLimit) vocab.limit = 100; renderVocab(); };

  // Đếm số từ mỗi nhóm nghĩa theo bộ lọc cấp/trạng thái/cần-xem-lại hiện tại
  const base = cards.filter((c) =>
    (vocab.level === "all" || String(c.hsk_level) === vocab.level) &&
    (!vocab.review || c.needs_review) &&
    (vocab.status === "all" || learnStatus(c.id) === vocab.status));
  const semCount = {}; let noneCount = 0;
  for (const c of base) { if (c.semantic_group) semCount[c.semantic_group] = (semCount[c.semantic_group] || 0) + 1; else noneCount++; }

  // ----- Thanh lọc -----
  const search = el("input", { type: "text", placeholder: "Tìm chữ Hán / pinyin / nghĩa…", value: vocab.q });
  search.addEventListener("input", () => { vocab.q = search.value.trim(); vocab.limit = 100; renderVocabList(); });

  const levelSel = selectRow(["all", ...levels.map(String)], ["Mọi cấp", ...levels.map((l) => "HSK" + l)], vocab.level, (v) => { vocab.level = v; reRender(); });
  const structSel = selectRow(["all", ...Object.keys(STRUCT_LABELS)], ["Mọi cấu trúc", ...Object.values(STRUCT_LABELS).map((l, i) => `${Object.keys(STRUCT_LABELS)[i]} · ${l}`)], vocab.struct, (v) => { vocab.struct = v; reRender(); });
  const semSel = selectRow(
    ["all", "none", ...SEM_ORDER],
    [`Mọi nhóm nghĩa (${base.length})`, `(chưa phân loại) (${noneCount})`, ...SEM_ORDER.map((g) => `${g} · ${SEMANTIC_LABELS[g]} (${semCount[g] || 0})`)],
    vocab.sem, (v) => { vocab.sem = v; reRender(); });
  const statusSel = selectRow(["all", "new", "learning", "due", "known"],
    ["Mọi trạng thái", "Chưa học", "Đang học", "Đến hạn", "Đã thuộc"], vocab.status, (v) => { vocab.status = v; reRender(); });
  const sortSel = selectRow(["level", "pinyin", "length"], ["Sắp xếp: cấp HSK", "Sắp xếp: pinyin A→Z", "Sắp xếp: số chữ"], vocab.sort, (v) => { vocab.sort = v; renderVocabList(); });

  const reviewToggle = el("label", { class: "review-toggle" },
    (() => { const cb = el("input", { type: "checkbox", checked: vocab.review || false }); cb.addEventListener("change", () => { vocab.review = cb.checked; reRender(); }); return cb; })(),
    el("span", {}, "⚠ Chỉ từ cần xem lại"));

  root.append(el("div", { class: "panel vocab-filter" },
    el("div", { class: "field", style: "margin-bottom:10px" }, search),
    el("div", { class: "filter-grid" }, levelSel, structSel, semSel, statusSel, sortSel),
    reviewToggle,
  ));

  // Vùng danh sách (render riêng để lọc/tìm không dựng lại cả thanh lọc)
  root.append(el("div", { id: "vocab-list" }));
  renderVocabList();
}

function renderVocabList() {
  const host = document.getElementById("vocab-list");
  if (!host) return;
  host.innerHTML = "";

  getDeck(store.getSettings().activeDeckId).then((deck) => {
    const host2 = document.getElementById("vocab-list");
    if (!deck || !host2) return;
    const cards = deck.cards.map(store.mergeClassification);
    const filtered = sortVocab(cards.filter((c) => matchVocab(c, vocab)), vocab.sort);

    // Thanh tóm tắt + nút học
    const summary = el("div", { class: "row", style: "margin:14px 0 10px" },
      el("div", { class: "muted" }, `${filtered.length} từ`),
      el("div", { class: "spacer" }),
      filtered.length ? el("button", { class: "btn primary small", onclick: () => {
        const ids = new Set(filtered.map((c) => c.id));
        const label = describeFilter(filtered.length);
        setStudyFilter((c) => ids.has(c.id), label);
        document.querySelector('[data-view="study"]').click();
      } }, `🎴 Học ${filtered.length} từ này`) : null,
    );
    host2.append(summary);

    if (!filtered.length) { host2.append(el("p", { class: "muted center", style: "padding:30px" }, "Không có từ nào khớp bộ lọc.")); return; }

    const list = el("div", { class: "vocab-list" });
    filtered.slice(0, vocab.limit).forEach((c) => list.append(vocabRow(c)));
    host2.append(list);

    if (filtered.length > vocab.limit) {
      host2.append(el("div", { class: "center", style: "margin-top:12px" },
        el("button", { class: "btn", onclick: () => { vocab.limit += 100; renderVocabList(); } }, `Hiện thêm (còn ${filtered.length - vocab.limit})`)));
    }
  });
}

function describeFilter(n) {
  const parts = [];
  if (vocab.level !== "all") parts.push("HSK" + vocab.level);
  if (vocab.struct !== "all") parts.push(STRUCT_LABELS[vocab.struct]);
  if (vocab.sem === "none") parts.push("chưa phân loại");
  else if (vocab.sem !== "all") parts.push(SEMANTIC_LABELS[vocab.sem]);
  if (vocab.review) parts.push("cần xem lại");
  if (vocab.q) parts.push(`"${vocab.q}"`);
  return parts.length ? parts.join(" · ") : `${n} từ`;
}

function semChipClass(g) { return g ? "chip sem " + g[0] : "chip"; }

function sortVocab(arr, sort) {
  const a = [...arr];
  if (sort === "pinyin") a.sort((x, y) => (x.pinyin || "").localeCompare(y.pinyin || "", "vi"));
  else if (sort === "length") a.sort((x, y) => (x.simplified.length - y.simplified.length) || (x.hsk_level || 0) - (y.hsk_level || 0));
  else a.sort((x, y) => (x.hsk_level || 0) - (y.hsk_level || 0) || (x.id < y.id ? -1 : 1));
  return a;
}

function vocabRow(c) {
  const st = learnStatus(c.id);
  const chips = el("div", { class: "chips" },
    st !== "new" && el("span", { class: "chip st " + st }, STATUS_LABELS[st]),
    c.hsk_level && el("span", { class: "chip lvl" }, "HSK" + c.hsk_level),
    c.struct_group && el("span", { class: "chip" }, c.struct_group),
    c.semantic_group
      ? el("span", { class: semChipClass(c.semantic_group), title: SEMANTIC_LABELS[c.semantic_group] || "" }, `${c.semantic_group} ${SEMANTIC_LABELS[c.semantic_group] || ""}`)
      : el("span", { class: "chip muted-chip" }, "chưa phân loại"),
    c.classification_source === "manual" && el("span", { class: "chip manual" }, "✎ sửa tay"),
    c.needs_review && el("span", { class: "chip review" }, "⚠ xem lại"),
  );

  const right = c.id === vocab.editing ? groupEditor(c) :
    el("button", { class: "btn ghost small", title: "Sửa nhóm nghĩa", onclick: () => { vocab.editing = c.id; renderVocabList(); } }, "✏️");

  return el("div", { class: "vocab-item" },
    el("div", { class: "vhanzi", title: "Nghe phát âm", onclick: () => speak(c.simplified, { rate: store.getSettings().speechRate }) }, c.simplified),
    el("div", { class: "vmeta" },
      el("div", { class: "vline" }, el("b", { class: "vpy" }, c.pinyin || ""),
        c.traditional && c.traditional !== c.simplified ? el("span", { class: "muted" }, " · " + c.traditional) : null,
        c.han_viet ? el("span", { class: "muted" }, " · " + c.han_viet) : null),
      el("div", { class: "vmean" }, c.meaning || ""),
      chips),
    right,
  );
}

function groupEditor(c) {
  const sel = el("select", {});
  sel.append(el("option", { value: "", selected: !c.semantic_group }, "— chọn nhóm —"));
  for (const g of SEM_ORDER) sel.append(el("option", { value: g, selected: g === c.semantic_group }, `${g} · ${SEMANTIC_LABELS[g]}`));
  sel.addEventListener("change", () => {
    if (sel.value) {
      store.setClassOverride(c.id, { semantic_group: sel.value, struct_group: c.struct_group });
      toast(`Đã đổi "${c.simplified}" → ${sel.value}`);
    }
    vocab.editing = null; renderVocabList();
  });
  const cancel = el("button", { class: "btn ghost small", title: "Đóng", onclick: () => { vocab.editing = null; renderVocabList(); } }, "✕");
  const clear = c.classification_source === "manual"
    ? el("button", { class: "btn ghost small", title: "Bỏ sửa tay (về tự động)", onclick: () => { store.clearClassOverride(c.id); toast("Đã bỏ sửa tay"); vocab.editing = null; renderVocabList(); } }, "↺")
    : null;
  return el("div", { class: "group-editor" }, sel, clear, cancel);
}

/* ============================================================
   QUIZ
   ============================================================ */
export async function renderQuiz() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  if (!deck || deck.cards.length < 4) {
    root.append(emptyState("Cần ít nhất 4 thẻ", "Quiz cần tối thiểu 4 từ trong bộ thẻ đang chọn."));
    return;
  }

  const quiz = { deck, settings: s, q: 0, score: 0, total: Math.min(10, deck.cards.length), pool: shuffle([...deck.cards]) };
  renderQuizQuestion(quiz);
}

function renderQuizQuestion(quiz) {
  const root = clear();
  if (quiz.q >= quiz.total) return renderQuizResult(quiz);

  const card = quiz.pool[quiz.q];
  const others = shuffle(quiz.deck.cards.filter((c) => c.id !== card.id)).slice(0, 3);
  const options = shuffle([card, ...others]);
  const { main } = displayHanzi(card, quiz.settings.charMode);

  const bar = el("div", { class: "progress" }, el("span", { style: `width:${(quiz.q / quiz.total) * 100}%` }));
  const head = el("div", { class: "row", style: "margin-bottom:8px" },
    el("div", { class: "muted" }, `Câu ${quiz.q + 1}/${quiz.total}`),
    el("div", { class: "spacer" }),
    el("div", { class: "pill" }, `Điểm: ${quiz.score}`));

  const q = el("div", { class: "panel" },
    el("div", { class: "label-tag center" }, "Nghĩa của từ này là gì?"),
    el("div", { class: "quiz-q" }, main),
    el("button", { class: "btn ghost", style: "margin:0 auto 8px;display:block", onclick: () => speak(card.simplified, { rate: quiz.settings.speechRate }) }, "🔊 Nghe"),
  );

  const optWrap = el("div", { class: "quiz-options" });
  options.forEach((opt) => {
    const btn = el("button", { class: "btn quiz-opt", onclick: () => answer(btn, opt, card) }, opt.meaning);
    optWrap.append(btn);
  });

  function answer(btn, opt, correct) {
    const ok = opt.id === correct.id;
    [...optWrap.children].forEach((b) => (b.disabled = true));
    btn.classList.add(ok ? "correct" : "wrong");
    if (!ok) {
      [...optWrap.children].find((b) => b.textContent === correct.meaning)?.classList.add("correct");
    }
    if (ok) quiz.score += 1;
    store.logReview(ok);
    setTimeout(() => { quiz.q += 1; renderQuizQuestion(quiz); }, ok ? 650 : 1400);
  }

  root.append(bar, head, q, optWrap);
}

function renderQuizResult(quiz) {
  const root = clear();
  const pct = Math.round((quiz.score / quiz.total) * 100);
  root.append(
    el("div", { class: "empty" },
      el("div", { class: "big" }, pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "💪"),
      el("h2", {}, `${quiz.score} / ${quiz.total} đúng (${pct}%)`),
      el("p", { class: "muted" }, pct >= 80 ? "Tuyệt vời!" : "Cố lên, ôn lại rồi thử tiếp nhé."),
      el("button", { class: "btn primary", style: "margin-top:12px", onclick: renderQuiz }, "Làm lại"),
    ));
}

/* ============================================================
   LISTEN
   ============================================================ */
export async function renderListen() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  if (!deck) { root.append(emptyState("Chưa có bộ thẻ", "Chọn bộ thẻ ở tab 📚.")); return; }

  root.append(el("h1", { class: "view-title" }, "🔊 Luyện nghe"));

  if (!hasChineseVoice()) {
    root.append(el("div", { class: "panel", style: "margin-bottom:14px" },
      el("p", { class: "muted" }, "⚠️ Trình duyệt chưa có giọng đọc tiếng Trung. Trên máy tính, hãy cài gói giọng nói tiếng Trung (Windows: Settings → Time & Language → Speech). Trên điện thoại Android/iOS thường có sẵn.")));
  }

  let mode = "char"; // char | meaning
  const card = { current: null };

  const display = el("div", { class: "flashcard", style: "min-height:220px" });
  const controls = el("div", { class: "row", style: "margin-top:14px;justify-content:center" });

  function next() {
    card.current = deck.cards[Math.floor(Math.random() * deck.cards.length)];
    card.shown = false;
    paint();
    speak(card.current.simplified, { rate: s.speechRate });
  }
  function paint() {
    display.innerHTML = "";
    const c = card.current;
    if (!c) { display.append(el("div", { class: "muted" }, "Bấm ▶️ để bắt đầu")); return; }
    if (card.shown) {
      const { main, sub } = displayHanzi(c, s.charMode);
      display.append(
        el("div", { class: "hanzi" }, main),
        sub && el("div", { class: "hanzi trad" }, sub),
        el("div", { class: "pinyin" }, c.pinyin),
        el("div", { class: "meaning" }, c.meaning),
      );
    } else {
      display.append(el("div", { class: "hanzi", style: "letter-spacing:8px" }, "❓"), el("div", { class: "tap-hint" }, "Nghe rồi đoán — chạm để hiện đáp án"));
    }
  }
  display.addEventListener("click", () => { if (card.current && !card.shown) { card.shown = true; paint(); } });

  controls.append(
    el("button", { class: "btn", onclick: () => card.current && speak(card.current.simplified, { rate: s.speechRate }) }, "🔁 Nghe lại"),
    el("button", { class: "btn primary", onclick: next }, "▶️ Từ tiếp theo"),
  );

  paint();
  root.append(display, controls);
}

/* ============================================================
   MANAGE DECKS
   ============================================================ */
export async function renderManage() {
  const root = clear();
  const s = store.getSettings();
  const decks = await getAllDecks();

  root.append(el("h1", { class: "view-title" }, "📚 Nguồn từ"));

  const list = el("div", { class: "stack" });
  decks.forEach((d) => {
    const active = d.id === s.activeDeckId;
    list.append(el("div", { class: "deck-item" },
      el("div", { class: "meta" },
        el("b", {}, d.name),
        el("small", {}, `${d.cards.length} thẻ${d.builtin ? " · có sẵn" : ""}`)),
      active ? el("span", { class: "pill" }, "Đang chọn")
             : el("button", { class: "btn", onclick: () => { store.saveSettings({ activeDeckId: d.id }); toast(`Đã chọn "${d.name}"`); renderManage(); } }, "Chọn"),
      !d.builtin && el("button", { class: "btn ghost", title: "Xoá", onclick: () => { if (confirm(`Xoá bộ "${d.name}"?`)) { store.deleteUserDeck(d.id); toast("Đã xoá"); renderManage(); } } }, "🗑️"),
    ));
  });
  root.append(list);

  // Import panel
  root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "➕ Thêm bộ thẻ mới"));
  const nameInput = el("input", { type: "text", placeholder: "Tên bộ thẻ, vd: Từ của tôi" });
  const ta = el("textarea", { placeholder: "Dán dữ liệu CSV/TSV. Mỗi dòng một từ:\nsimplified,traditional,pinyin,meaning,example\n爱护,愛護,àihù,yêu quý và bảo vệ,我们要爱护环境。" });
  const fileInput = el("input", { type: "file", accept: ".csv,.tsv,.txt,.json" });

  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    if (f.name.endsWith(".json")) {
      try {
        const d = JSON.parse(text);
        if (d.cards && d.name) { d.id = d.id || `u-${Date.now().toString(36)}`; delete d.builtin; store.saveUserDeck(d); toast(`Đã nhập "${d.name}"`); renderManage(); return; }
      } catch { /* fall through */ }
      toast("File JSON không đúng định dạng bộ thẻ.");
    } else {
      ta.value = text;
      if (!nameInput.value) nameInput.value = f.name.replace(/\.[^.]+$/, "");
      toast("Đã nạp file vào ô bên dưới, bấm Lưu để tạo bộ thẻ.");
    }
  });

  const save = el("button", { class: "btn primary", onclick: () => {
    const name = nameInput.value.trim() || "Bộ thẻ của tôi";
    const cards = parseCsv(ta.value);
    if (!cards.length) { toast("Không đọc được thẻ nào từ dữ liệu."); return; }
    const deck = { id: `u-${Date.now().toString(36)}`, name, description: "Bộ thẻ tự tạo", cards };
    store.saveUserDeck(deck);
    store.saveSettings({ activeDeckId: deck.id });
    toast(`Đã tạo "${name}" với ${cards.length} thẻ`);
    renderManage();
  } }, "💾 Lưu bộ thẻ");

  root.append(el("div", { class: "panel" },
    el("div", { class: "field" }, el("label", {}, "Tên bộ thẻ"), nameInput),
    el("div", { class: "field" }, el("label", {}, "Dữ liệu (CSV/TSV)"), ta),
    el("div", { class: "field" }, el("label", {}, "…hoặc tải file (.csv / .json)"), fileInput),
    save,
  ));
}

/* ============================================================
   STATS
   ============================================================ */
export async function renderStats() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  const progress = store.getProgress();
  const stats = store.getStats();

  root.append(el("h1", { class: "view-title" }, "📊 Tiến độ"));

  let learned = 0, due = 0, total = deck ? deck.cards.length : 0;
  if (deck) {
    for (const c of deck.cards) {
      const st = progress[c.id];
      if (st && st.reps > 0) learned += 1;
      if (srs.isDue(st) && !srs.isNew(st)) due += 1;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayStat = stats[today] || { reviews: 0, correct: 0 };
  const streak = computeStreak(stats);

  root.append(el("div", { class: "stat-grid" },
    statBox(learned, "Đã học"),
    statBox(`${learned}/${total}`, "Tiến độ bộ thẻ"),
    statBox(due, "Đến hạn ôn"),
    statBox(todayStat.reviews, "Lượt ôn hôm nay"),
    statBox(streak + " 🔥", "Chuỗi ngày"),
    statBox(todayStat.reviews ? Math.round((todayStat.correct / todayStat.reviews) * 100) + "%" : "—", "Độ chính xác hôm nay"),
  ));

  // 14-day history
  root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "14 ngày gần nhất"));
  const hist = el("div", { class: "panel", style: "display:flex;align-items:flex-end;gap:4px;height:130px" });
  const days = lastNDays(14);
  const max = Math.max(1, ...days.map((d) => (stats[d]?.reviews || 0)));
  days.forEach((d) => {
    const v = stats[d]?.reviews || 0;
    hist.append(el("div", { style: "flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%" },
      el("div", { title: `${d}: ${v} lượt`, style: `width:100%;background:var(--accent);border-radius:4px 4px 0 0;height:${(v / max) * 90}%;min-height:${v ? 4 : 0}px` }),
      el("small", { class: "muted", style: "font-size:9px" }, d.slice(8)),
    ));
  });
  root.append(hist);

  // Tiến độ theo cấp HSK + theo nhóm nghĩa
  if (deck) {
    const merged = deck.cards.map(store.mergeClassification);
    const byLevel = {}, byGroup = {};
    for (const c of merged) {
      const learnedFlag = (progress[c.id]?.reps > 0);
      if (c.hsk_level) { (byLevel[c.hsk_level] ??= { learned: 0, total: 0 }).total++; if (learnedFlag) byLevel[c.hsk_level].learned++; }
      if (c.semantic_group) { (byGroup[c.semantic_group] ??= { learned: 0, total: 0 }).total++; if (learnedFlag) byGroup[c.semantic_group].learned++; }
    }
    const levelKeys = Object.keys(byLevel).sort();
    if (levelKeys.length) {
      root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "Tiến độ theo cấp HSK"));
      const wrap = el("div", { class: "panel stack" });
      levelKeys.forEach((lv) => wrap.append(progressRow("HSK" + lv, byLevel[lv].learned, byLevel[lv].total)));
      root.append(wrap);
    }
    const groupKeys = SEM_ORDER.filter((g) => byGroup[g]);
    if (groupKeys.length) {
      root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "Tiến độ theo nhóm nghĩa"));
      const wrap = el("div", { class: "panel stack" });
      groupKeys.forEach((g) => wrap.append(progressRow(`${g} · ${SEMANTIC_LABELS[g]}`, byGroup[g].learned, byGroup[g].total, g[0])));
      root.append(wrap);
    }
  }
}

function progressRow(label, learned, total, colorKey) {
  const pct = total ? Math.round((learned / total) * 100) : 0;
  const fill = el("span", { style: `width:${pct}%` });
  if (colorKey && SEM_COLORS[colorKey]) fill.style.background = SEM_COLORS[colorKey];
  return el("div", { class: "prog-row" },
    el("div", { class: "prog-head" }, el("span", {}, label), el("span", { class: "muted" }, `${learned}/${total} · ${pct}%`)),
    el("div", { class: "progress", style: "margin-bottom:0" }, fill));
}

function computeStreak(stats) {
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (stats[d]?.reviews) streak++;
    else if (i === 0) continue; // today not done yet doesn't break a prior streak
    else break;
  }
  return streak;
}
function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
}
function statBox(num, lbl) {
  return el("div", { class: "stat-box" }, el("div", { class: "num" }, String(num)), el("div", { class: "lbl" }, lbl));
}

/* ============================================================
   SETTINGS
   ============================================================ */
export async function renderSettings() {
  const root = clear();
  const s = store.getSettings();
  root.append(el("h1", { class: "view-title" }, "⚙️ Cài đặt"));

  const update = (patch) => { store.saveSettings(patch); };

  // appearance
  const accents = ["#c0392b", "#2563eb", "#7c3aed", "#0f766e", "#d97706", "#db2777"];
  const swatches = el("div", { class: "swatches" });
  accents.forEach((a) => swatches.append(el("div", {
    class: "swatch" + (a === s.accent ? " active" : ""), style: `background:${a}`,
    onclick: () => { update({ accent: a }); renderSettings(); },
  })));

  root.append(el("div", { class: "panel stack" },
    el("b", {}, "Giao diện"),
    switchRow("Chế độ tối", s.theme === "dark", (on) => { update({ theme: on ? "dark" : "light" }); }),
    el("div", { class: "field" }, el("label", {}, "Màu chủ đạo"), swatches),
    sliderRow("Cỡ chữ Hán", s.hanziScale, 0.8, 1.6, 0.1, (v) => { update({ hanziScale: v }); }),
    sliderRow("Cỡ chữ giao diện", s.fontBase, 14, 20, 1, (v) => { update({ fontBase: v }); }),
  ));

  // learning
  root.append(el("div", { class: "panel stack", style: "margin-top:14px" },
    el("b", {}, "Hiển thị chữ"),
    el("div", { class: "field" },
      el("label", {}, "Kiểu chữ mặc định"),
      selectRow(["simplified", "traditional", "both"], ["Giản thể", "Phồn thể", "Cả hai"], s.charMode, (v) => { update({ charMode: v }); })),
    switchRow("Hiện pinyin mặt trước thẻ", s.showPinyinByDefault, (on) => update({ showPinyinByDefault: on })),
    switchRow("Tự động đọc khi lật thẻ", s.autoPlayAudio, (on) => update({ autoPlayAudio: on })),
    sliderRow("Tốc độ đọc", s.speechRate, 0.5, 1.3, 0.1, (v) => update({ speechRate: v })),
  ));

  root.append(el("div", { class: "panel stack", style: "margin-top:14px" },
    el("b", {}, "Lặp lại ngắt quãng (SRS)"),
    numberRow("Số từ mới mỗi ngày", s.newPerDay, (v) => update({ newPerDay: v })),
    numberRow("Giới hạn ôn mỗi ngày", s.reviewLimit, (v) => update({ reviewLimit: v })),
  ));

  // AI backend (Qwen3) — tùy chọn, dùng cho Giao tiếp (bóc ảnh/PDF/audio/video + dịch)
  const backendInput = el("input", { type: "text", value: s.commBackendUrl || "", placeholder: "http://localhost:8000" });
  const backendStatus = el("span", { class: "muted small" });
  const testBackend = async () => {
    update({ commBackendUrl: backendInput.value.trim() });
    if (!backendInput.value.trim()) { backendStatus.textContent = "Đã tắt (chạy thuần trình duyệt)."; return; }
    backendStatus.textContent = "Đang kiểm tra…";
    const h = await comm.pingBackend();
    if (!h) { backendStatus.innerHTML = '<span style="color:var(--bad)">Không kết nối được. Kiểm tra backend đã chạy chưa.</span>'; return; }
    const caps = h.caps || {};
    const yn = (b) => (b ? "✓" : "✗");
    backendStatus.innerHTML = `<span style="color:var(--ok)">Đã kết nối</span> · Ollama ${yn(h.ollama)} (${h.model || "?"}) · PDF ${yn(caps.pdf_text)} · OCR ảnh ${yn(caps.ocr)} · Nghe video/audio ${yn(caps.asr)}`;
  };
  root.append(el("div", { class: "panel stack", style: "margin-top:14px" },
    el("b", {}, "AI · Qwen3 (tùy chọn)"),
    el("p", { class: "muted small" }, "Backend local để Giao tiếp tự bóc câu từ ảnh/PDF/audio/video và dịch Việt. Để trống thì app vẫn chạy đủ trong trình duyệt (chỉ text/.srt). Hướng dẫn cài: thư mục backend/."),
    el("div", { class: "field" }, el("label", {}, "Địa chỉ backend"), backendInput),
    el("div", { class: "row" }, el("button", { class: "btn", onclick: testBackend }, "🔌 Lưu & kiểm tra"), backendStatus),
  ));

  // data
  root.append(el("div", { class: "panel stack", style: "margin-top:14px" },
    el("b", {}, "Dữ liệu"),
    el("div", { class: "row" },
      el("button", { class: "btn", onclick: exportData }, "⬇️ Xuất sao lưu"),
      el("button", { class: "btn", onclick: importData }, "⬆️ Nhập sao lưu"),
    ),
    el("button", { class: "btn ghost", style: "color:var(--bad)", onclick: () => {
      if (confirm("Xoá toàn bộ tiến độ học (giữ lại bộ thẻ)?")) { store.resetProgress(); toast("Đã xoá tiến độ."); }
    } }, "♻️ Đặt lại tiến độ học"),
  ));

  root.append(el("p", { class: "muted center", style: "margin-top:20px;font-size:12px" }, "Mọi dữ liệu lưu ngay trên thiết bị của bạn (offline). Nhớ xuất sao lưu định kỳ."));
}

function exportData() {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `hsk-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  toast("Đã xuất file sao lưu.");
}
function importData() {
  const inp = el("input", { type: "file", accept: ".json" });
  inp.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { store.importAll(JSON.parse(await f.text())); store.applyTheme(); toast("Đã nhập sao lưu."); renderSettings(); }
    catch { toast("File không hợp lệ."); }
  });
  inp.click();
}

/* ---- small setting controls ---- */
function switchRow(label, checked, onChange, sub) {
  const cb = el("input", { type: "checkbox", class: "toggle", checked: checked || false });
  cb.addEventListener("change", () => onChange(cb.checked));
  return el("div", { class: "switch-row" }, el("div", { class: "lbl" }, label, sub && el("small", {}, sub)), cb);
}
function sliderRow(label, value, min, max, step, onChange) {
  const out = el("span", { class: "muted" }, String(value));
  const sl = el("input", { type: "range", min, max, step, value });
  sl.style.flex = "1";
  sl.addEventListener("input", () => { out.textContent = sl.value; onChange(parseFloat(sl.value)); });
  return el("div", { class: "field" }, el("label", {}, label), el("div", { class: "row" }, sl, out));
}
function numberRow(label, value, onChange) {
  const inp = el("input", { type: "number", min: 0, value });
  inp.addEventListener("change", () => onChange(parseInt(inp.value) || 0));
  return el("div", { class: "field" }, el("label", {}, label), inp);
}
function selectRow(values, labels, current, onChange) {
  const sel = el("select", {});
  values.forEach((v, i) => sel.append(el("option", { value: v, selected: v === current }, labels[i])));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function emptyState(title, msg) {
  return el("div", { class: "empty" }, el("div", { class: "big" }, "📭"), el("h2", {}, title), el("p", {}, msg));
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- Kho tài liệu đề thi (zip → PDF/audio/ảnh, lưu IndexedDB) ---------- */
let viewerUrl = null;
function revokeViewerUrl() { if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; } }

async function libraryBar() {
  const wrap = el("details", { class: "panel exam-import", open: true });
  wrap.append(el("summary", {}, "📂 Tài liệu đề thi (PDF · ebook · audio)"));
  wrap.append(el("p", { class: "muted small" }, "Tải lên file .zip (đề / sách / audio). App tự giải nén & lưu vào máy (IndexedDB) để xem offline. Bóc đề tự động bằng Qwen3 sẽ thêm sau."));

  const fileInput = el("input", { type: "file", accept: ".zip" });
  const status = el("span", { class: "muted small" });
  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    status.textContent = "Đang đọc file…";
    try {
      const buf = await f.arrayBuffer();
      status.textContent = "Đang giải nén…";
      const files = await unzip(buf, (d) => { status.textContent = `Đang giải nén… ${d} file`; });
      if (!files.length) { status.textContent = "Zip rỗng hoặc không có file hỗ trợ."; return; }
      const name = f.name.replace(/\.zip$/i, "");
      await lib.createCollection(name, files);
      toast(`Đã nạp “${name}”: ${files.length} file`);
      renderExam();
    } catch (err) {
      status.textContent = "Lỗi: " + err.message;
      toast("Không giải nén được: " + err.message);
    }
  });
  wrap.append(el("div", { class: "row" }, fileInput, status));

  const colls = await lib.listCollections();
  if (colls.length) {
    const list = el("div", { class: "lib-list" });
    for (const c of colls) {
      list.append(el("div", { class: "lib-row" },
        el("div", {}, el("b", {}, "📦 " + c.name),
          el("div", { class: "muted small" }, `${c.fileMeta.length} file · ${lib.humanSize(lib.collectionSize(c))}`)),
        el("div", { class: "row" },
          el("button", { class: "btn small", onclick: () => { examView = { screen: "library", collId: c.id }; renderExam(); } }, "Mở"),
          el("button", { class: "btn ghost small", onclick: async () => { if (confirm("Xóa bộ tài liệu này?")) { await lib.deleteCollection(c.id); renderExam(); } } }, "Xóa")),
      ));
    }
    wrap.append(list);
  }
  return wrap;
}

const KIND_ICON = { pdf: "📕", audio: "🎧", image: "🖼️", text: "📄", ebook: "📘", other: "📎" };

async function examLibrary(root) {
  const coll = await lib.getCollection(examView.collId);
  if (!coll) { examView = { screen: "list" }; return renderExam(); }
  root.append(examTopbar("📦 " + coll.name));

  const layout = el("div", { class: "lib-layout" });
  const fileList = el("div", { class: "lib-files" });
  for (const fm of coll.fileMeta) {
    const kind = lib.fileKind(fm);
    const active = examView.fileId === fm.id;
    fileList.append(el("button", { class: "lib-file" + (active ? " active" : ""), onclick: () => { examView = { ...examView, fileId: fm.id }; renderExam(); } },
      el("span", { class: "lf-icon" }, KIND_ICON[kind] || "📎"),
      el("span", { class: "lf-name" }, fm.name),
      el("span", { class: "muted small" }, lib.humanSize(fm.size)),
    ));
  }
  layout.append(fileList);

  const viewer = el("div", { class: "lib-viewer" });
  if (examView.fileId) {
    const fm = coll.fileMeta.find((x) => x.id === examView.fileId);
    if (fm) await renderFileViewer(viewer, fm);
    else viewer.append(el("div", { class: "muted" }, "Chọn một file bên trái để xem."));
  } else {
    viewer.append(el("div", { class: "muted" }, "Chọn một file bên trái để xem."));
  }
  layout.append(viewer);
  root.append(layout);
}

async function renderFileViewer(host, fm) {
  const blob = await lib.getFileBlob(fm.id);
  if (!blob) { host.append(el("div", { class: "muted" }, "Không tìm thấy file.")); return; }
  revokeViewerUrl();
  viewerUrl = URL.createObjectURL(blob);
  const kind = lib.fileKind(fm);
  host.append(el("div", { class: "row spread" }, el("b", {}, fm.name),
    el("a", { class: "btn small", href: viewerUrl, download: fm.name }, "⬇ Tải về")));
  if (kind === "pdf") {
    host.append(el("iframe", { class: "pdf-frame", src: viewerUrl }));
    host.append(el("button", { class: "btn ghost small", onclick: () => toast("Bóc đề tự động bằng Qwen3 — sẽ có khi chạy backend Ollama.") }, "🤖 Bóc đề từ PDF (sắp có)"));
  } else if (kind === "audio") {
    host.append(el("audio", { controls: "", src: viewerUrl, style: "width:100%" }));
  } else if (kind === "video") {
    host.append(el("video", { controls: "", src: viewerUrl, class: "lib-img" }));
  } else if (kind === "image") {
    host.append(el("img", { src: viewerUrl, class: "lib-img" }));
  } else if (kind === "text") {
    const txt = await blob.text();
    host.append(el("pre", { class: "lib-text" }, txt.slice(0, 20000)));
  } else {
    host.append(el("p", { class: "muted" }, "Định dạng này chưa xem trực tiếp được trong app — hãy bấm “Tải về”."));
  }
}

/* ============================================================
   LUYỆN ĐỀ (HSK6 — Đọc trắc nghiệm + Viết 缩写)
   ============================================================ */
let examView = { screen: "list", examId: null };
let readingState = null;       // { examId, answers, graded, score, total }
let writeTimer = null;         // setInterval id cho đồng hồ phần Viết
function clearWriteTimer() { if (writeTimer) { clearInterval(writeTimer); writeTimer = null; } }

export async function renderExam() {
  clearWriteTimer();
  revokeViewerUrl();
  clearCommState(); // dừng TTS / nhận diện giọng nếu đang chạy (dùng chung với HSKK)
  const root = clear();
  if (examView.screen === "reading") return examReading(root);
  if (examView.screen === "writing") return examWriting(root);
  if (examView.screen === "library") return examLibrary(root);
  if (examView.screen === "hskk") return examHskk(root);
  return examList(root);
}

function examTopbar(title) {
  return el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { examView = { screen: "list" }; renderExam(); } }, "← Danh sách đề"),
    el("span", { class: "muted" }, title));
}

/* ---------- Màn hình danh sách đề ---------- */
async function examList(root) {
  root.append(el("h1", { class: "view-title" }, "📝 Luyện đề"));
  root.append(await hskkBar());
  root.append(examImportBar());
  root.append(await libraryBar());
  const exams = await getAllExams();
  if (!exams.length) { root.append(emptyState("Chưa có đề", "Nhập đề JSON ở trên để bắt đầu.")); return; }

  const list = el("div", { class: "exam-list" });
  for (const ex of exams) {
    const prog = store.getExamProgress(ex.id);
    const rq = countReadingQuestions(ex);
    const actions = el("div", { class: "exam-actions" });
    if (rq) actions.append(el("button", { class: "btn primary", onclick: () => { examView = { screen: "reading", examId: ex.id }; renderExam(); } }, `🧩 Đọc · ${rq} câu`));
    if (ex.writing) actions.append(el("button", { class: "btn", onclick: () => { examView = { screen: "writing", examId: ex.id }; renderExam(); } }, "✍️ Viết"));
    if (!ex.builtin) actions.append(el("button", { class: "btn ghost", onclick: () => { if (confirm("Xóa đề này?")) { store.deleteUserExam(ex.id); renderExam(); } } }, "Xóa"));

    const badges = el("div", { class: "exam-badges" });
    if (prog.reading) badges.append(el("span", { class: "chip st known" }, `Đọc: ${prog.reading.score}/${prog.reading.total}`));
    if (prog.writing && prog.writing.text) badges.append(el("span", { class: "chip st learning" }, `Viết: ${countChars(prog.writing.text)} chữ`));

    list.append(el("div", { class: "panel exam-card" },
      el("div", { class: "exam-head" }, el("h3", {}, ex.title), ex.builtin && el("span", { class: "chip" }, "mẫu")),
      ex.note && el("p", { class: "muted small" }, ex.note),
      badges.childNodes.length ? badges : null,
      actions,
    ));
  }
  root.append(list);
}

/* ---------- HSKK 高级 (thi nói) ---------- */
async function hskkBar() {
  const exams = await getHskkExams();
  const box = el("div", { class: "panel exam-import" });
  box.append(el("div", { class: "exam-head" }, el("h3", {}, "🎓 HSKK 高级 — luyện thi nói"), el("span", { class: "chip" }, "mẫu")));
  box.append(el("p", { class: "muted small" }, "3 phần: 听后复述 (nghe·kể lại) · 朗读 (đọc to·chấm phát âm) · 回答问题 (trả lời câu hỏi). Dùng Chrome/Edge để chấm phát âm."));
  if (!exams.length) { box.append(el("p", { class: "muted small" }, "Chưa có đề HSKK.")); return box; }
  const list = el("div", { class: "exam-actions" });
  for (const ex of exams) list.append(el("button", { class: "btn primary", onclick: () => { examView = { screen: "hskk", examId: ex.id, part: "retell" }; renderExam(); } }, "🗣️ " + ex.title));
  box.append(list);
  return box;
}

async function examHskk(root) {
  const ex = await getHskk(examView.examId);
  if (!ex) { examView = { screen: "list" }; return renderExam(); }
  const part = examView.part || "retell";
  root.append(examTopbar(ex.title));
  const nav = el("div", { class: "hskk-nav" });
  for (const [id, label] of [["retell", "第一部分 · 听后复述"], ["read", "第二部分 · 朗读"], ["answer", "第三部分 · 回答问题"]])
    nav.append(el("button", { class: "comm-chip" + (part === id ? " on" : ""), onclick: () => { examView = { ...examView, part: id }; renderExam(); } }, label));
  root.append(nav);
  if (ex.note && part === "retell") root.append(el("p", { class: "muted small" }, ex.note));
  if (part === "read") return hskkRead(root, ex);
  if (part === "answer") return hskkAnswer(root, ex);
  return hskkRetell(root, ex);
}

// 第一部分 — nghe đoạn văn rồi kể lại (ghi âm để tự nghe lại, không chấm).
function hskkRetell(root, ex) {
  const items = ex.retell || [];
  if (!items.length) { root.append(emptyState("Trống", "Phần này chưa có nội dung.")); return; }
  const s = store.getSettings();
  let i = 0, shown = false;
  const progress = el("div", { class: "comm-progress muted small" });
  const card = el("div", { class: "panel comm-card" });
  const controls = el("div", { class: "row comm-controls" });
  root.append(progress, card, controls);
  function paint() {
    const it = items[i];
    progress.textContent = `Đoạn ${i + 1}/${items.length} · Nghe 1–2 lần rồi kể lại bằng lời của bạn`;
    card.innerHTML = "";
    if (shown) {
      card.append(el("div", { class: "hskk-passage" }, it.zh));
      it.vi && card.append(el("div", { class: "meaning", style: "margin-top:10px;text-align:left" }, it.vi));
    } else {
      card.append(el("div", { class: "hskk-big" }, "🎧"), el("div", { class: "comm-hint muted" }, "Bấm 🔊 nghe, tự kể lại, rồi “Hiện nguyên văn” để đối chiếu."));
    }
    paintControls();
  }
  function paintControls() {
    controls.innerHTML = "";
    controls.append(el("button", { class: "btn primary", onclick: () => speak(items[i].zh, { rate: s.speechRate }) }, "🔊 Nghe đoạn văn"));
    if (hasRecognition()) controls.append(micButton(() => items[i].zh, s, { score: false }));
    controls.append(el("button", { class: "btn", onclick: () => { shown = !shown; paint(); } }, shown ? "Ẩn nguyên văn" : "Hiện nguyên văn"));
    if (items.length > 1) controls.append(el("button", { class: "btn ghost", onclick: () => { i = (i + 1) % items.length; shown = false; paint(); } }, "Đoạn sau →"));
  }
  paint();
}

// 第二部分 — đọc to một đoạn, chấm phát âm bằng so khớp chữ Hán.
function hskkRead(root, ex) {
  const r = ex.read;
  if (!r) { root.append(emptyState("Trống", "Phần này chưa có nội dung.")); return; }
  const s = store.getSettings();
  root.append(el("p", { class: "muted small" }, "Đọc to đoạn văn. Bấm 🎙️ Nói để chấm phát âm (so khớp chữ Hán)."));
  const card = el("div", { class: "panel comm-card" });
  card.append(el("div", { class: "hskk-passage" }, r.zh));
  r.vi && card.append(el("details", { class: "comm-personal" }, el("summary", {}, "Xem nghĩa tiếng Việt"), el("p", { class: "meaning", style: "text-align:left" }, r.vi)));
  root.append(card);
  const controls = el("div", { class: "row comm-controls" },
    el("button", { class: "btn", onclick: () => speak(r.zh, { rate: s.speechRate }) }, "🔊 Nghe mẫu"));
  if (hasRecognition()) controls.append(micButton(() => r.zh, s, { score: true }));
  else controls.append(el("span", { class: "muted small" }, "Trình duyệt không hỗ trợ chấm phát âm."));
  root.append(controls);
}

// 第三部分 — trả lời câu hỏi: bấm giờ nói ~2 phút + ghi âm + gợi ý dàn ý.
function hskkAnswer(root, ex) {
  const items = ex.answer || [];
  if (!items.length) { root.append(emptyState("Trống", "Phần này chưa có nội dung.")); return; }
  const s = store.getSettings();
  let i = 0;
  const progress = el("div", { class: "comm-progress muted small" });
  const card = el("div", { class: "panel comm-card" });
  const controls = el("div", { class: "row comm-controls" });
  root.append(progress, card, controls);
  function paint() {
    clearWriteTimer();
    const it = items[i];
    progress.textContent = `Câu ${i + 1}/${items.length} · Chuẩn bị rồi nói khoảng 2 phút`;
    card.innerHTML = "";
    card.append(el("div", { class: "hskk-passage", style: "text-align:left" }, it.q_zh));
    it.q_pinyin && card.append(el("div", { class: "pinyin", style: "text-align:left" }, it.q_pinyin));
    it.q_vi && card.append(el("div", { class: "meaning", style: "text-align:left;margin-top:6px" }, it.q_vi));
    if (it.outline_vi) card.append(el("details", { class: "comm-personal" }, el("summary", {}, "💡 Gợi ý dàn ý"), el("p", { class: "muted small", style: "text-align:left" }, it.outline_vi)));
    paintControls();
  }
  function paintControls() {
    controls.innerHTML = "";
    let remain = 120;
    const disp = el("span", { class: "timer-disp" }, fmtTime(remain));
    const tBtn = el("button", { class: "btn" }, "▶ Bấm giờ nói");
    tBtn.onclick = () => {
      if (writeTimer) { clearWriteTimer(); tBtn.textContent = "▶ Tiếp tục"; return; }
      tBtn.textContent = "⏸ Tạm dừng";
      writeTimer = setInterval(() => {
        remain = Math.max(0, remain - 1); disp.textContent = fmtTime(remain);
        if (remain === 0) { clearWriteTimer(); tBtn.textContent = "Hết giờ"; tBtn.disabled = true; toast("Hết giờ nói!"); }
      }, 1000);
    };
    controls.append(el("span", { class: "row" }, el("b", {}, "⏱ "), disp), tBtn);
    if (hasRecognition()) controls.append(micButton(() => items[i].q_zh, s, { score: false }));
    if (items.length > 1) controls.append(el("button", { class: "btn ghost", onclick: () => { i = (i + 1) % items.length; paint(); } }, "Câu sau →"));
  }
  paint();
}

function examImportBar() {
  const ta = el("textarea", { rows: "4", placeholder: 'Dán JSON đề. Cấu trúc: { "title": "...", "reading": [...], "writing": {...} }' });
  const fileInput = el("input", { type: "file", accept: ".json" });
  fileInput.addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); });
  const doImport = () => {
    const { exam, error } = parseExamJson(ta.value.trim());
    if (error) return toast(error);
    store.saveUserExam(exam);
    toast("Đã nhập đề: " + exam.title);
    renderExam();
  };
  return el("details", { class: "panel exam-import" },
    el("summary", {}, "📥 Nhập đề JSON"),
    el("p", { class: "muted small" }, "Dán JSON hoặc chọn file. Sau này Qwen3 sẽ sinh đề tự động."),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" }, fileInput, el("button", { class: "btn primary", onclick: doImport }, "Nhập đề")),
  );
}

/* ---------- Phần Đọc (trắc nghiệm, tự chấm) ---------- */
async function examReading(root) {
  const exam = await getExam(examView.examId);
  if (!exam) { examView = { screen: "list" }; return renderExam(); }
  if (!readingState || readingState.examId !== exam.id) readingState = { examId: exam.id, answers: {}, graded: false };

  root.append(examTopbar(exam.title + " · Đọc"));
  const form = el("div", { class: "exam-reading" });
  for (const sec of exam.reading) {
    form.append(el("div", { class: "exam-section-head" },
      el("h2", {}, sec.title), sec.instruction && el("p", { class: "muted small" }, sec.instruction)));
    for (const item of sec.items) form.append(renderReadingItem(item));
  }
  root.append(form);

  if (readingState.graded) {
    const pct = readingState.total ? Math.round((readingState.score / readingState.total) * 100) : 0;
    root.append(el("div", { class: "panel result-bar" },
      el("b", {}, `Kết quả: ${readingState.score}/${readingState.total} câu đúng · ${pct}%`),
      el("button", { class: "btn", onclick: () => { readingState = { examId: exam.id, answers: {}, graded: false }; renderExam(); } }, "Làm lại"),
    ));
  } else {
    root.append(el("div", { class: "submit-bar" },
      el("button", { class: "btn primary", onclick: () => gradeReading(exam) }, "Nộp bài & chấm")));
  }
}

function renderReadingItem(item) {
  const panel = el("div", { class: "panel exam-item" });
  if (item.type === "mcq") {
    panel.append(el("p", { class: "exam-stem" }, item.stem || ""));
    panel.append(mcqOptions(item.id, item.options, item.answer));
    if (readingState.graded && item.explain) panel.append(explainBox(item.explain));
  } else if (item.type === "cloze") {
    panel.append(clozeRender(item, false));
    if (readingState.graded && item.explain) panel.append(explainBox(item.explain));
  } else if (item.type === "sentence-cloze") {
    panel.append(clozeRender(item, true));
    if (readingState.graded && item.explain) panel.append(explainBox(item.explain));
  } else if (item.type === "reading") {
    panel.append(el("div", { class: "exam-passage" }, item.passage));
    item.questions.forEach((q, qi) => {
      panel.append(el("p", { class: "exam-stem" }, `${qi + 1}. ${q.stem}`));
      panel.append(mcqOptions(`${item.id}:${qi}`, q.options, q.answer));
      if (readingState.graded && q.explain) panel.append(explainBox(q.explain));
    });
  }
  return panel;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
function mcqOptions(key, options, correctIdx) {
  const wrap = el("div", { class: "opts" });
  options.forEach((opt, i) => {
    const id = `${key}__${i}`;
    const input = el("input", { type: "radio", name: key, id, value: i });
    if (readingState.answers[key] === i) input.checked = true;
    if (readingState.graded) input.disabled = true;
    input.addEventListener("change", () => { readingState.answers[key] = i; });
    const label = el("label", { class: "opt", for: id }, el("span", { class: "opt-mark" }, LETTERS[i]), el("span", {}, opt));
    if (readingState.graded) {
      if (i === correctIdx) label.classList.add("correct");
      else if (readingState.answers[key] === i) label.classList.add("wrong");
    }
    wrap.append(el("div", { class: "opt-row" }, input, label));
  });
  return wrap;
}

// Cloze (chọn từ) và sentence-cloze (chọn câu A–D) dùng chung khung select trong đoạn.
function clozeRender(item, isSentence) {
  const box = el("div", {});
  if (isSentence) {
    const bank = el("div", { class: "sent-bank" }, el("div", { class: "muted small" }, "Ngân hàng câu:"));
    item.bank.forEach((s, i) => bank.append(el("div", { class: "bank-row" }, el("b", {}, LETTERS[i] + ". "), s)));
    box.append(bank);
  }
  const splitRe = isSentence ? /\[\d+\]/ : /_{3,}/;
  const count = isSentence ? item.answers.length : item.blanks.length;
  const parts = item.passage.split(splitRe);
  const frag = el("div", { class: "cloze-passage" });
  parts.forEach((p, i) => {
    frag.append(document.createTextNode(p));
    if (i < count) {
      const key = `${item.id}:${i}`;
      const sel = el("select", { class: "blank-sel" });
      sel.append(el("option", { value: "" }, "—"));
      const opts = isSentence ? item.bank.map((_, oi) => LETTERS[oi]) : item.blanks[i].options;
      opts.forEach((o, oi) => sel.append(el("option", { value: oi, selected: String(readingState.answers[key]) === String(oi) }, o)));
      if (readingState.graded) sel.disabled = true;
      sel.addEventListener("change", () => { readingState.answers[key] = sel.value === "" ? undefined : Number(sel.value); });
      frag.append(sel);
      if (readingState.graded) {
        const correct = isSentence ? item.answers[i] : item.blanks[i].answer;
        sel.classList.add(readingState.answers[key] === correct ? "ok" : "bad");
        if (readingState.answers[key] !== correct) {
          const ans = isSentence ? LETTERS[correct] : item.blanks[i].options[correct];
          frag.append(el("span", { class: "ans-hint" }, `(đúng: ${ans})`));
        }
      }
    }
  });
  box.append(frag);
  return box;
}

function explainBox(text) { return el("div", { class: "explain" }, "💡 " + text); }

function gradeReading(exam) {
  let total = 0, score = 0;
  const a = readingState.answers;
  for (const sec of exam.reading) for (const item of sec.items) {
    if (item.type === "mcq") { total++; if (a[item.id] === item.answer) score++; }
    else if (item.type === "cloze") item.blanks.forEach((b, i) => { total++; if (a[`${item.id}:${i}`] === b.answer) score++; });
    else if (item.type === "sentence-cloze") item.answers.forEach((ans, i) => { total++; if (a[`${item.id}:${i}`] === ans) score++; });
    else if (item.type === "reading") item.questions.forEach((q, i) => { total++; if (a[`${item.id}:${i}`] === q.answer) score++; });
  }
  readingState.graded = true; readingState.score = score; readingState.total = total;
  store.saveReadingResult(exam.id, { score, total, answers: a });
  toast(`Đã chấm: ${score}/${total} câu đúng`);
  renderExam();
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

/* ---------- Phần Viết (缩写 — đọc rồi tóm tắt) ---------- */
function countChars(s) { return [...String(s).replace(/\s/g, "")].length; }
function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }

async function examWriting(root) {
  const exam = await getExam(examView.examId);
  if (!exam || !exam.writing) { examView = { screen: "list" }; return renderExam(); }
  const w = exam.writing;
  const saved = store.getExamProgress(exam.id).writing || {};
  root.append(examTopbar(exam.title + " · Viết"));

  root.append(el("div", { class: "panel" },
    el("h2", {}, w.title || "Phần Viết"),
    el("p", { class: "muted small" }, w.instruction || ""),
  ));

  // Bài đọc + nút ẩn (mô phỏng: đọc xong thì ẩn rồi mới viết)
  const article = el("div", { class: "exam-passage article-box" }, w.article);
  const hideBtn = el("button", { class: "btn ghost small" }, "Ẩn bài");
  hideBtn.onclick = () => { const h = article.hidden = !article.hidden; hideBtn.textContent = h ? "Hiện bài" : "Ẩn bài"; };
  root.append(el("div", { class: "panel" },
    el("div", { class: "row spread" },
      el("b", {}, `Bài đọc (${countChars(w.article)} chữ · đọc ~${w.readMinutes || 10} phút)`), hideBtn),
    article,
  ));

  // Đồng hồ viết
  let remain = (w.writeMinutes || 35) * 60;
  const disp = el("span", { class: "timer-disp" }, fmtTime(remain));
  const toggleBtn = el("button", { class: "btn small" }, "▶ Bắt đầu");
  toggleBtn.onclick = () => {
    if (writeTimer) { clearWriteTimer(); toggleBtn.textContent = "▶ Tiếp tục"; return; }
    toggleBtn.textContent = "⏸ Tạm dừng";
    writeTimer = setInterval(() => {
      remain = Math.max(0, remain - 1); disp.textContent = fmtTime(remain);
      if (remain === 0) { clearWriteTimer(); toggleBtn.textContent = "Hết giờ"; toggleBtn.disabled = true; toast("Hết giờ làm bài Viết!"); }
    }, 1000);
  };

  // Soạn bài
  const titleInput = el("input", { type: "text", placeholder: "Tiêu đề bài tóm tắt…", value: saved.title || "" });
  const ta = el("textarea", { rows: "10", placeholder: "Viết bản tóm tắt của bạn ở đây…" });
  ta.value = saved.text || "";
  const target = w.targetChars || 400;
  const counter = el("span", { class: "muted small" });
  const updateCount = () => {
    const n = countChars(ta.value);
    counter.textContent = `${n} / ~${target} chữ`;
    counter.classList.toggle("count-ok", n >= target * 0.8);
  };
  updateCount();
  let saveT = null;
  const autosave = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { store.saveWritingDraft(exam.id, { title: titleInput.value, text: ta.value }); }, 800);
    updateCount();
  };
  ta.addEventListener("input", autosave);
  titleInput.addEventListener("input", autosave);

  root.append(el("div", { class: "panel" },
    el("div", { class: "row spread" }, el("div", { class: "row" }, el("b", {}, "⏱ "), disp, toggleBtn), counter),
    el("div", { class: "field" }, titleInput),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" },
      el("button", { class: "btn", onclick: () => { store.saveWritingDraft(exam.id, { title: titleInput.value, text: ta.value }); toast("Đã lưu bản nháp."); } }, "💾 Lưu nháp"),
      el("button", { class: "btn primary", onclick: () => toast("Chấm tự động bằng Qwen3 — sẽ có khi chạy backend Ollama.") }, "🤖 Chấm bằng Qwen3"),
    ),
    el("p", { class: "muted small" }, "Bản nháp tự lưu vào máy. Khi có Qwen3, app sẽ chấm bố cục, ngữ pháp và gợi ý sửa."),
  ));
}

/* ============================================================
   GIAO TIẾP (luyện phản xạ + phát âm) — js/comm.js + data/comm-scenes.json
   ============================================================ */
let commView = { screen: "home" };
let commTimer = null;            // đồng hồ Sprint
let commRec = null;              // nhận diện giọng nói đang chạy
let commSel = { sceneIds: null };// null = tất cả cảnh
let commPersonal = [];           // [{zh, pinyin?, vi?}] từ dán/thư viện
let commPersonalLabel = "";

function clearCommState() {
  if (commTimer) { clearInterval(commTimer); commTimer = null; }
  if (commRec) { try { commRec.abort(); } catch {} commRec = null; }
  stopSpeaking();
}

export async function renderComm() {
  clearCommState();
  const root = clear();
  const scenes = await comm.loadScenes();
  if (commView.screen === "qa") return commDrillQA(root, scenes);
  if (commView.screen === "shadow") return commDrillShadow(root, scenes);
  if (commView.screen === "sprint") return commDrillSprint(root, scenes);
  if (commView.screen === "pattern") return commDrillPattern(root, scenes);
  return commHome(root, scenes);
}

/* ---------- Nguồn câu (chọn cảnh + cá nhân) ---------- */
function selectedScenes(scenes) {
  if (!commSel.sceneIds) return scenes;
  const set = new Set(commSel.sceneIds);
  return scenes.filter((s) => set.has(s.id));
}
function lineBank(scenes) {
  const out = [];
  for (const s of selectedScenes(scenes)) out.push(...comm.sceneLineBank(s));
  out.push(...commPersonal);
  return out;
}
function viLineBank(scenes) { return lineBank(scenes).filter((x) => x.vi); }
function qaBank(scenes) { const o = []; for (const s of selectedScenes(scenes)) o.push(...(s.qa || [])); return o; }
function patternBank(scenes) { const o = []; for (const s of selectedScenes(scenes)) o.push(...(s.patterns || [])); return o; }

async function commHome(root, scenes) {
  root.append(el("h1", { class: "view-title" }, "🗣️ Giao tiếp — luyện phản xạ"));
  const backend = await comm.pingBackend(); // null nếu chưa bật / không tới được

  const src = el("div", { class: "panel comm-source" });
  src.append(el("div", { class: "row spread" }, el("b", {}, "Nguồn câu"), el("span", { class: "muted small" }, commSourceSummary(scenes))));
  const chips = el("div", { class: "comm-chips" });
  const allOn = !commSel.sceneIds;
  chips.append(commChip("Tất cả cảnh", allOn, () => { commSel.sceneIds = null; renderComm(); }));
  for (const s of scenes) {
    const on = !allOn && commSel.sceneIds.includes(s.id);
    chips.append(commChip(`${s.icon} ${s.title}`, on, () => toggleScene(s.id, scenes)));
  }
  src.append(chips);
  src.append(commPersonalBar(backend));
  const libBar = await commLibraryBar(backend);
  if (libBar) src.append(libBar);
  root.append(src);

  const nQa = qaBank(scenes).length, nLine = lineBank(scenes).length, nVi = viLineBank(scenes).length, nPat = patternBank(scenes).length;
  const grid = el("div", { class: "comm-grid" });
  grid.append(commDrillCard("💬", "Hỏi–đáp tình huống", `${nQa} cặp`, "Nghe câu hỏi → bật câu trả lời trong vài giây.", nQa > 0, "qa"));
  grid.append(commDrillCard("🎙️", "Shadowing + Phát âm", `${nLine} câu`, "Nghe mẫu → nói lại → chấm phát âm.", nLine > 0, "shadow"));
  grid.append(commDrillCard("⏱️", "Sprint Việt→Trung", `${nVi} câu`, "Đếm giờ, bật càng nhiều câu càng tốt.", nVi > 0, "sprint"));
  grid.append(commDrillCard("🔁", "Thay thế mẫu câu", `${nPat} mẫu`, "Giữ khung, đổi chỗ trống để nói tự động.", nPat > 0, "pattern"));
  root.append(grid);

  if (!hasRecognition()) {
    root.append(el("p", { class: "muted small", style: "margin-top:10px" },
      "ℹ️ Trình duyệt này chưa hỗ trợ nhận diện giọng nói (chấm phát âm). Dùng Chrome/Edge để chấm tự động; các kiểu khác vẫn luyện bình thường."));
  }
}

function commChip(label, on, onclick) { return el("button", { class: "comm-chip" + (on ? " on" : ""), onclick }, label); }
function toggleScene(id, scenes) {
  if (!commSel.sceneIds) commSel.sceneIds = scenes.map((s) => s.id);
  const i = commSel.sceneIds.indexOf(id);
  if (i >= 0) commSel.sceneIds.splice(i, 1); else commSel.sceneIds.push(id);
  if (!commSel.sceneIds.length || commSel.sceneIds.length === scenes.length) commSel.sceneIds = null;
  renderComm();
}
function commSourceSummary(scenes) {
  const sc = selectedScenes(scenes).length;
  const p = commPersonal.length ? ` · ${commPersonal.length} câu cá nhân (${commPersonalLabel})` : "";
  return `${sc} cảnh${p}`;
}
function commDrillCard(icon, title, badge, desc, enabled, screen) {
  return el("button", {
    class: "comm-drill" + (enabled ? "" : " disabled"),
    onclick: enabled ? () => { commView = { screen }; renderComm(); } : () => toast("Nguồn hiện chưa có dữ liệu cho kiểu này."),
  },
    el("div", { class: "comm-drill-ic" }, icon),
    el("div", { class: "comm-drill-body" },
      el("div", { class: "comm-drill-title" }, title, el("span", { class: "chip" }, badge)),
      el("div", { class: "muted small" }, desc)));
}

// Backend có xử lý được loại file này không (theo năng lực /health).
function backendHandles(backend, kind) {
  if (!backend) return false;
  const caps = backend.caps || {};
  if (kind === "pdf") return !!(caps.pdf_text || caps.ocr);
  if (kind === "image") return !!caps.ocr;
  if (kind === "audio" || kind === "video") return !!caps.asr;
  return false;
}
function setPersonalSource(items, label) {
  commPersonal = items; commPersonalLabel = label;
  toast(`Đã thêm ${items.length} câu vào nguồn.`);
  renderComm();
}

function commPersonalBar(backend) {
  const ta = el("textarea", { rows: "3", placeholder: "Dán văn bản tiếng Trung, phụ đề .srt, hoặc cặp song ngữ:  中文 ||| Tiếng Việt" });
  const fileInput = el("input", { type: "file", accept: ".txt,.srt,.lrc,.csv" });
  fileInput.addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); });
  const add = () => {
    const items = comm.parseUserText(ta.value.trim());
    if (!items.length) return toast("Không tách được câu tiếng Trung nào.");
    setPersonalSource(items, "đã dán");
  };
  const clearBtn = commPersonal.length ? el("button", { class: "btn ghost small", onclick: () => { commPersonal = []; commPersonalLabel = ""; renderComm(); } }, "Xóa câu cá nhân") : null;

  // Nếu backend Qwen3 đang bật → cho upload thẳng ảnh/PDF/audio/video để bóc tự động.
  let mediaRow = null;
  if (backend) {
    const mediaInput = el("input", { type: "file", accept: "image/*,.pdf,audio/*,video/*" });
    mediaInput.addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      toast("Đang bóc bằng Qwen3… có thể mất một lúc.");
      try {
        const items = await comm.extractViaBackend(f, f.name, "auto");
        if (!items.length) return toast("Không bóc được câu nào.");
        setPersonalSource(items, f.name);
      } catch (err) { toast("Lỗi: " + err.message); }
    });
    mediaRow = el("div", { class: "row" }, el("span", { class: "small muted" }, "🤖 Bóc ảnh/PDF/audio/video:"), mediaInput);
  }

  return el("details", { class: "comm-personal" },
    el("summary", {}, "➕ Thêm nguồn cá nhân (dán văn bản / phụ đề" + (backend ? " / ảnh · video" : "") + ")"),
    el("p", { class: "muted small" }, backend
      ? "Dán text/.srt, hoặc upload ảnh/PDF/audio/video để Qwen3 bóc câu và tự dịch Việt."
      : "Văn bản chỉ có tiếng Trung dùng được cho Shadowing/Phát âm. Muốn luyện Việt→Trung thì dán kèm bản dịch dạng “中文 ||| Tiếng Việt”, hoặc bật backend Qwen3 trong Cài đặt để tự dịch & bóc ảnh/video."),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" }, fileInput, el("button", { class: "btn primary", onclick: add }, "Thêm vào nguồn"), clearBtn),
    mediaRow);
}

async function commLibraryBar(backend) {
  let files = [];
  try { files = await comm.listLibraryFiles(); } catch {}
  if (!files.length) return null;
  const list = el("div", { class: "comm-libfiles" });
  for (const f of files) {
    let action;
    if (f.kind === "text") {
      action = el("button", { class: "btn ghost small", onclick: async () => {
        const items = await comm.extractFileLines(f.id, f.kind);
        if (!items.length) return toast("File không có câu tiếng Trung.");
        setPersonalSource(items, f.name);
      } }, "Dùng");
    } else if (backendHandles(backend, f.kind)) {
      action = el("button", { class: "btn ghost small", onclick: async () => {
        toast("Đang bóc bằng Qwen3… có thể mất một lúc.");
        try {
          const blob = await lib.getFileBlob(f.id);
          const items = await comm.extractViaBackend(blob, f.name, f.kind);
          if (!items.length) return toast("Không bóc được câu nào.");
          setPersonalSource(items, f.name);
        } catch (err) { toast("Lỗi: " + err.message); }
      } }, "🤖 Bóc tự động");
    } else {
      action = el("span", { class: "muted small" }, "Bóc bằng Qwen3 (sắp có)");
    }
    list.append(el("div", { class: "row spread comm-librow" }, el("span", { class: "small" }, `${libIcon(f.kind)} ${f.name}`), action));
  }
  return el("details", { class: "comm-personal" }, el("summary", {}, `📂 Lấy câu từ thư viện đã nạp (${files.length} file)`), list);
}
function libIcon(kind) { return ({ text: "📄", pdf: "📕", audio: "🎧", image: "🖼️", video: "🎬", ebook: "📘" })[kind] || "📎"; }

/* ---------- Chấm phát âm (so khớp chữ Hán) ---------- */
function scorePronun(target, said) {
  const han = (s) => [...String(s)].filter((c) => /[一-鿿]/.test(c));
  const t = han(target), saidSet = new Set(han(said));
  if (!t.length) return { pct: 0, marks: [] };
  let hit = 0;
  const marks = t.map((c) => { const ok = saidSet.has(c); if (ok) hit++; return { c, ok }; });
  return { pct: Math.round((hit / t.length) * 100), marks };
}
function pronunMarks(marks) {
  const span = el("span", { class: "comm-marks" });
  for (const m of marks) span.append(el("span", { class: m.ok ? "ok" : "bad" }, m.c));
  return span;
}
function micButton(getTarget, s, { score = true } = {}) {
  const btn = el("button", { class: "btn" }, "🎙️ Nói");
  const out = el("span", { class: "comm-mic-out small" });
  btn.onclick = () => {
    if (commRec) { try { commRec.abort(); } catch {} commRec = null; btn.textContent = "🎙️ Nói"; return; }
    btn.textContent = "● Đang nghe…"; out.textContent = "";
    commRec = recognizeChinese({
      onResult: (txt) => {
        out.innerHTML = "";
        if (score) {
          const { pct, marks } = scorePronun(getTarget(), txt);
          out.append(el("b", { class: pct >= 80 ? "ok" : pct >= 50 ? "" : "bad" }, `${pct}% `), pronunMarks(marks),
            el("span", { class: "muted" }, ` · bạn nói: ${txt || "(không rõ)"}`));
        } else {
          out.append(el("span", { class: "muted" }, "Bạn nói: "), el("b", {}, txt || "(không rõ)"));
        }
      },
      onError: (err) => { out.textContent = err === "unsupported" ? "Trình duyệt không hỗ trợ micro." : "Lỗi micro: " + err; },
      onEnd: () => { commRec = null; btn.textContent = "🎙️ Nói"; },
    });
  };
  return el("span", { class: "comm-mic" }, btn, out);
}

function commTopbar(title) {
  return el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { commView = { screen: "home" }; renderComm(); } }, "← Giao tiếp"),
    el("span", { class: "muted" }, title));
}

/* ---------- Drill: Hỏi–đáp tình huống ---------- */
function commDrillQA(root, scenes) {
  const bank = shuffle(qaBank(scenes).slice());
  if (!bank.length) { commView = { screen: "home" }; return renderComm(); }
  const s = store.getSettings();
  root.append(commTopbar("Hỏi–đáp tình huống"));
  const progress = el("div", { class: "comm-progress muted small" });
  const card = el("div", { class: "panel comm-card" });
  const controls = el("div", { class: "row comm-controls" });
  root.append(progress, card, controls);

  let idx = 0, revealed = false;
  const cur = () => bank[idx];
  function paint() {
    revealed = false;
    const qa = cur();
    progress.textContent = `Câu ${idx + 1} / ${bank.length}`;
    card.innerHTML = "";
    card.append(el("div", { class: "comm-q" },
      el("div", { class: "hanzi-line" }, qa.q),
      qa.q_pinyin && el("div", { class: "pinyin" }, qa.q_pinyin),
      qa.q_vi && el("div", { class: "meaning" }, qa.q_vi)));
    card.append(el("div", { class: "comm-hint muted" }, "→ Bạn trả lời thế nào? (nói ra miệng)"));
    speak(qa.q, { rate: s.speechRate });
    paintControls();
  }
  function reveal() {
    if (revealed) return; revealed = true;
    const qa = cur();
    card.append(el("div", { class: "comm-a" },
      el("div", { class: "muted small" }, "Gợi ý đáp án:"),
      el("div", { class: "hanzi-line" }, qa.a),
      qa.a_pinyin && el("div", { class: "pinyin" }, qa.a_pinyin),
      qa.a_vi && el("div", { class: "meaning" }, qa.a_vi)));
    speak(qa.a, { rate: s.speechRate });
    paintControls();
  }
  function next() {
    idx++;
    if (idx >= bank.length) { idx = 0; shuffle(bank); toast("Hết lượt — xáo lại từ đầu."); }
    paint();
  }
  function paintControls() {
    controls.innerHTML = "";
    controls.append(el("button", { class: "btn", onclick: () => speak(cur().q, { rate: s.speechRate }) }, "🔁 Nghe câu hỏi"));
    if (hasRecognition()) controls.append(micButton(() => cur().a, s));
    if (!revealed) controls.append(el("button", { class: "btn", onclick: reveal }, "💡 Gợi ý đáp án"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp theo →"));
  }
  paint();
}

/* ---------- Drill: Shadowing + Phát âm ---------- */
function commDrillShadow(root, scenes) {
  const bank = shuffle(lineBank(scenes).slice());
  if (!bank.length) { commView = { screen: "home" }; return renderComm(); }
  const s = store.getSettings();
  root.append(commTopbar("Shadowing + Phát âm"));
  const progress = el("div", { class: "comm-progress muted small" });
  const card = el("div", { class: "panel comm-card" });
  const controls = el("div", { class: "row comm-controls" });
  root.append(progress, card, controls);

  let idx = 0, showAid = false;
  const cur = () => bank[idx];
  function renderBody() {
    const it = cur();
    progress.textContent = `Câu ${idx + 1} / ${bank.length}`;
    card.innerHTML = "";
    card.append(el("div", { class: "hanzi-line big" }, it.zh));
    if (showAid) {
      it.pinyin && card.append(el("div", { class: "pinyin" }, it.pinyin));
      it.vi && card.append(el("div", { class: "meaning" }, it.vi));
    } else {
      card.append(el("div", { class: "comm-hint muted" }, "Lặp lại theo mẫu — chạm để hiện pinyin/nghĩa"));
    }
  }
  const speakCur = () => speak(cur().zh, { rate: s.speechRate });
  card.onclick = () => { if (!showAid) { showAid = true; renderBody(); } };
  function next() {
    idx++;
    if (idx >= bank.length) { idx = 0; shuffle(bank); toast("Hết lượt — xáo lại từ đầu."); }
    showAid = false; renderBody(); speakCur(); paintControls();
  }
  function paintControls() {
    controls.innerHTML = "";
    controls.append(el("button", { class: "btn", onclick: speakCur }, "🔁 Nghe mẫu"));
    if (hasRecognition()) controls.append(micButton(() => cur().zh, s));
    controls.append(el("button", { class: "btn", onclick: () => { showAid = true; renderBody(); } }, "👁 Hiện"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp →"));
  }
  renderBody(); speakCur(); paintControls();
}

/* ---------- Drill: Sprint Việt→Trung (đếm giờ) ---------- */
function commDrillSprint(root, scenes) {
  const bank = viLineBank(scenes);
  if (!bank.length) { commView = { screen: "home" }; return renderComm(); }
  const s = store.getSettings();
  root.append(commTopbar("Sprint Việt→Trung"));
  const panel = el("div", { class: "panel comm-card" });
  root.append(panel);
  let dur = 60;

  function showSetup() {
    clearCommState();
    panel.innerHTML = "";
    panel.append(el("p", {}, "Đọc nghĩa tiếng Việt rồi bật ngay câu tiếng Trung. Mỗi câu bật được bấm “✓ Được”. Cố vượt kỷ lục của bạn!"));
    const sel = el("div", { class: "row" });
    [30, 60, 90].forEach((d) => sel.append(el("button", { class: "btn" + (d === dur ? " primary" : ""), onclick: () => { dur = d; showSetup(); } }, d + "s")));
    panel.append(el("div", { class: "field" }, el("label", { class: "muted small" }, "Thời lượng"), sel));
    panel.append(el("button", { class: "btn primary big", onclick: start }, "▶️ Bắt đầu"));
  }
  function start() {
    const queue = shuffle(bank.slice());
    let qi = 0, score = 0, revealed = false, remain = dur;
    const timerEl = el("span", { class: "timer-disp" }, fmtTime(remain));
    const scoreEl = el("b", {}, "0");
    const body = el("div", { class: "comm-sprint-body" });
    function paint() {
      revealed = false;
      const it = queue[qi % queue.length];
      body.innerHTML = "";
      body.append(el("div", { class: "meaning big" }, it.vi), el("div", { class: "comm-hint muted" }, "→ Nói bằng tiếng Trung"));
    }
    function reveal() {
      if (revealed) return; revealed = true;
      const it = queue[qi % queue.length];
      body.append(el("div", { class: "hanzi-line" }, it.zh));
      if (it.pinyin) body.append(el("div", { class: "pinyin" }, it.pinyin));
      speak(it.zh, { rate: s.speechRate });
    }
    function adv(ok) { if (ok) { score++; scoreEl.textContent = String(score); } qi++; paint(); }
    panel.innerHTML = "";
    panel.append(el("div", { class: "row spread" }, el("div", { class: "row" }, el("b", {}, "⏱ "), timerEl), el("div", {}, "Đã bật: ", scoreEl)));
    panel.append(body);
    panel.append(el("div", { class: "row comm-controls" },
      el("button", { class: "btn", onclick: reveal }, "👁 Hiện"),
      el("button", { class: "btn ghost", onclick: () => adv(false) }, "Bỏ qua"),
      el("button", { class: "btn primary", onclick: () => adv(true) }, "✓ Được")));
    paint();
    commTimer = setInterval(() => {
      remain--; timerEl.textContent = fmtTime(Math.max(0, remain));
      if (remain <= 0) { clearCommState(); finish(score); }
    }, 1000);
  }
  function finish(score) {
    panel.innerHTML = "";
    panel.append(el("div", { class: "comm-result" },
      el("div", { class: "big" }, "⚡"),
      el("h2", {}, `Bật được ${score} câu trong ${dur}s`),
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: showSetup }, "Làm lại"),
        el("button", { class: "btn", onclick: () => { commView = { screen: "home" }; renderComm(); } }, "Về Giao tiếp"))));
  }
  showSetup();
}

/* ---------- Drill: Thay thế mẫu câu (句型替换) ---------- */
function commDrillPattern(root, scenes) {
  const bank = patternBank(scenes);
  if (!bank.length) { commView = { screen: "home" }; return renderComm(); }
  const s = store.getSettings();
  root.append(commTopbar("Thay thế mẫu câu"));
  const progress = el("div", { class: "comm-progress muted small" });
  const card = el("div", { class: "panel comm-card" });
  const controls = el("div", { class: "row comm-controls" });
  root.append(progress, card, controls);

  let pi = 0, si = 0, revealed = false;
  const curP = () => bank[pi % bank.length];
  const curS = () => curP().slots[si % curP().slots.length];
  function renderBody() {
    const p = curP(), slot = curS();
    progress.textContent = `Mẫu ${(pi % bank.length) + 1}/${bank.length} · chỗ trống ${si + 1}/${p.slots.length}`;
    card.innerHTML = "";
    card.append(el("div", { class: "comm-skeleton", html: escapeHtml(p.frame).replace("{}", '<span class="blank">＿＿</span>') }));
    card.append(el("div", { class: "meaning big", html: comm.fillFrame(escapeHtml(p.frame_vi), `<mark class="hl">${escapeHtml(slot.vi)}</mark>`) }));
    if (revealed) {
      card.append(el("div", { class: "comm-a" },
        el("div", { class: "hanzi-line", html: comm.fillFrame(escapeHtml(p.frame), `<mark class="hl">${escapeHtml(slot.zh)}</mark>`) })));
    } else {
      card.append(el("div", { class: "comm-hint muted" }, "→ Bật câu tiếng Trung với chỗ trống này"));
    }
  }
  function reveal() { if (revealed) return; revealed = true; renderBody(); speak(comm.fillFrame(curP().frame, curS().zh), { rate: s.speechRate }); paintControls(); }
  function next() {
    revealed = false; si++;
    if (si >= curP().slots.length) { si = 0; pi++; }
    renderBody(); paintControls();
  }
  function paintControls() {
    controls.innerHTML = "";
    if (!revealed) controls.append(el("button", { class: "btn", onclick: reveal }, "💡 Đáp án"));
    else controls.append(el("button", { class: "btn", onclick: () => speak(comm.fillFrame(curP().frame, curS().zh), { rate: s.speechRate }) }, "🔊 Nghe"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp →"));
  }
  renderBody(); paintControls();
}

/* ============================================================
   DỊCH THUẬT (Trung↔Việt + Qwen3 chấm) — store.translations
   ============================================================ */
let transView = { screen: "home" };
let transDraft = newTransDraft();
function newTransDraft(dir = "zh2vi") {
  return { id: null, dir, source: "", sourcePinyin: "", user: "", ref: "", refPinyin: "", grade: null, createdAt: null };
}

export async function renderTrans() {
  clearCommState();
  const root = clear();
  if (transView.screen === "saved") return transSaved(root);
  return transHome(root);
}

// Lấy 1 câu mẫu (ví dụ trong thẻ) làm văn bản nguồn + bản tham khảo.
async function randomExample(dir) {
  const deck = await getDeck(store.getSettings().activeDeckId);
  if (!deck) return null;
  const pool = deck.cards.filter((c) => c.example && c.example_vi);
  const c = pool[Math.floor(Math.random() * pool.length)];
  if (!c) return null;
  if (dir === "vi2zh") return { source: c.example_vi, ref: c.example, refPinyin: c.example_pinyin };
  return { source: c.example, sourcePinyin: c.example_pinyin, ref: c.example_vi };
}

async function transHome(root) {
  const s = store.getSettings();
  const backend = await comm.pingBackend();
  root.append(el("h1", { class: "view-title" }, "🌐 Dịch thuật"));

  const dirRow = el("div", { class: "comm-chips" });
  const setDir = (d) => { if (transDraft.dir !== d) transDraft = newTransDraft(d); renderTrans(); };
  dirRow.append(commChip("中文 → Tiếng Việt", transDraft.dir === "zh2vi", () => setDir("zh2vi")));
  dirRow.append(commChip("Tiếng Việt → 中文", transDraft.dir === "vi2zh", () => setDir("vi2zh")));
  root.append(dirRow);

  const srcIsZh = transDraft.dir === "zh2vi";

  const srcTa = el("textarea", { rows: "3", placeholder: srcIsZh ? "Văn bản tiếng Trung cần dịch…" : "Văn bản tiếng Việt cần dịch…" });
  srcTa.value = transDraft.source;
  srcTa.addEventListener("input", () => { transDraft.source = srcTa.value; });
  const srcBtns = el("div", { class: "row" },
    el("button", { class: "btn", onclick: async () => {
      const ex = await randomExample(transDraft.dir);
      if (!ex) return toast("Không lấy được câu mẫu.");
      Object.assign(transDraft, { source: ex.source, sourcePinyin: ex.sourcePinyin || "", ref: ex.ref || "", refPinyin: ex.refPinyin || "", grade: null });
      renderTrans();
    } }, "🎲 Câu mẫu từ thẻ"));
  if (srcIsZh) srcBtns.append(el("button", { class: "btn", onclick: () => transDraft.source && speak(transDraft.source, { rate: s.speechRate }) }, "🔊 Nghe"));
  root.append(el("div", { class: "panel stack" },
    el("b", {}, srcIsZh ? "Nguồn · 中文" : "Nguồn · Tiếng Việt"),
    transDraft.sourcePinyin && el("div", { class: "pinyin", style: "text-align:left" }, transDraft.sourcePinyin),
    el("div", { class: "field" }, srcTa), srcBtns));

  const userTa = el("textarea", { rows: "3", placeholder: srcIsZh ? "Bản dịch tiếng Việt của bạn…" : "你的中文翻译…" });
  userTa.value = transDraft.user;
  userTa.addEventListener("input", () => { transDraft.user = userTa.value; });
  root.append(el("div", { class: "panel stack" }, el("b", {}, "Bản dịch của bạn"), el("div", { class: "field" }, userTa)));

  if (transDraft.ref) {
    root.append(el("details", { class: "panel comm-personal" },
      el("summary", {}, "👁 Xem bản tham khảo (câu mẫu)"),
      el("div", { class: srcIsZh ? "meaning" : "hanzi-line", style: "text-align:left" }, transDraft.ref),
      transDraft.refPinyin && el("div", { class: "pinyin", style: "text-align:left" }, transDraft.refPinyin)));
  }

  const actions = el("div", { class: "row", style: "margin-top:4px" });
  actions.append(el("button", { class: "btn", onclick: () => saveTransDraft(false) }, "💾 Lưu"));
  if (backend) actions.append(el("button", { class: "btn primary", onclick: gradeTransDraft }, "🤖 Chấm & sửa (Qwen3)"));
  else actions.append(el("button", { class: "btn", onclick: () => toast("Bật backend Qwen3 trong Cài đặt để chấm tự động.") }, "🤖 Chấm (cần Qwen3)"));
  actions.append(el("button", { class: "btn ghost", onclick: () => { transDraft = newTransDraft(transDraft.dir); renderTrans(); } }, "🔄 Mới"));
  actions.append(el("button", { class: "btn ghost", onclick: () => { transView = { screen: "saved" }; renderTrans(); } }, `📚 Bài đã dịch (${store.getTranslations().length})`));
  root.append(actions);

  if (transDraft.grade) root.append(transGradeBox(transDraft.grade, srcIsZh));

  if (!backend) root.append(el("p", { class: "muted small", style: "margin-top:10px" },
    "Hiện chạy thuần trình duyệt: dịch · lưu · ôn lại · tự đối chiếu bằng câu mẫu. Bật backend Qwen3 (Cài đặt) để được chấm điểm + sửa lỗi tự động."));
}

function saveTransDraft(silent) {
  if (!transDraft.source.trim()) { if (!silent) toast("Chưa có văn bản nguồn."); return null; }
  if (!transDraft.id) transDraft.id = "tr-" + Date.now().toString(36);
  if (!transDraft.createdAt) transDraft.createdAt = new Date().toISOString();
  const rec = {
    id: transDraft.id, dir: transDraft.dir, source: transDraft.source, sourcePinyin: transDraft.sourcePinyin,
    user: transDraft.user, ref: transDraft.ref, refPinyin: transDraft.refPinyin, grade: transDraft.grade, createdAt: transDraft.createdAt,
  };
  store.saveTranslation(rec);
  if (!silent) toast("Đã lưu vào Bài đã dịch.");
  return rec;
}

async function gradeTransDraft() {
  if (!transDraft.source.trim()) return toast("Chưa có văn bản nguồn.");
  toast("Đang chấm bằng Qwen3… có thể mất một lúc.");
  try {
    transDraft.grade = await comm.gradeTranslation(transDraft.source, transDraft.user, transDraft.dir);
    saveTransDraft(true);
    renderTrans();
  } catch (e) { toast("Lỗi: " + e.message); }
}

function transGradeBox(g, srcIsZh) {
  const box = el("div", { class: "panel stack", style: "margin-top:12px;border-color:var(--accent)" });
  box.append(el("div", { class: "row spread" }, el("b", {}, "🤖 Qwen3 chấm"), g.score != null ? el("span", { class: "chip lvl" }, `Điểm: ${g.score}/10`) : null));
  if (g.corrected) box.append(el("div", {}, el("div", { class: "muted small" }, "Bản dịch đã sửa:"), el("div", { class: srcIsZh ? "meaning" : "hanzi-line", style: "text-align:left" }, g.corrected)));
  if (g.reference) box.append(el("details", {}, el("summary", { class: "small" }, "Bản dịch tham khảo"), el("div", { class: srcIsZh ? "meaning" : "hanzi-line", style: "text-align:left" }, g.reference)));
  if (Array.isArray(g.notes) && g.notes.length) {
    const ul = el("ul", { class: "trans-notes" });
    for (const n of g.notes) ul.append(el("li", {}, n));
    box.append(el("div", {}, el("div", { class: "muted small" }, "Nhận xét:"), ul));
  }
  return box;
}

function transSaved(root) {
  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { transView = { screen: "home" }; renderTrans(); } }, "← Dịch thuật"),
    el("span", { class: "muted" }, "Bài đã dịch")));
  const list = store.getTranslations();
  if (!list.length) { root.append(emptyState("Chưa có bài dịch", "Dịch một câu rồi bấm 💾 Lưu.")); return; }
  const s = store.getSettings();
  for (const t of list) {
    const srcIsZh = t.dir === "zh2vi";
    const head = el("div", { class: "row spread", style: "width:100%" },
      el("span", { class: "small" }, `${srcIsZh ? "中→Việt" : "Việt→中"} · ${new Date(t.createdAt).toLocaleDateString("vi")} · ${t.source.slice(0, 18)}…`),
      t.grade && t.grade.score != null ? el("span", { class: "chip lvl" }, `${t.grade.score}/10`) : null);
    const notesUl = (t.grade && Array.isArray(t.grade.notes) && t.grade.notes.length)
      ? (() => { const ul = el("ul", { class: "trans-notes" }); for (const n of t.grade.notes) ul.append(el("li", {}, n)); return ul; })() : null;
    const body = el("div", { class: "stack", style: "margin-top:8px" },
      el("div", {}, el("span", { class: "muted small" }, "Nguồn: "), t.source),
      t.user && el("div", {}, el("span", { class: "muted small" }, "Bạn dịch: "), t.user),
      t.grade && t.grade.corrected && el("div", {}, el("span", { class: "muted small" }, "Đã sửa: "), t.grade.corrected),
      notesUl,
      el("div", { class: "row" },
        srcIsZh ? el("button", { class: "btn small", onclick: () => speak(t.source, { rate: s.speechRate }) }, "🔊") : null,
        el("button", { class: "btn small", onclick: () => loadTransDraft(t) }, "Mở lại"),
        el("button", { class: "btn ghost small", onclick: () => { if (confirm("Xóa bài này?")) { store.deleteTranslation(t.id); renderTrans(); } } }, "Xóa")));
    root.append(el("details", { class: "panel" }, el("summary", {}, head), body));
  }
}

function loadTransDraft(t) {
  transDraft = { id: t.id, dir: t.dir, source: t.source, sourcePinyin: t.sourcePinyin || "", user: t.user || "", ref: t.ref || "", refPinyin: t.refPinyin || "", grade: t.grade || null, createdAt: t.createdAt };
  transView = { screen: "home" };
  renderTrans();
}

/* ============================================================
   NẠP NỘI DUNG (nguồn → Bài học gồm task) — js/lessons.js
   ============================================================ */
let ingestView = { screen: "new", lessonId: null };
const LV_LABEL = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4", 5: "HSK 5", 6: "HSK 6" };

export async function renderIngest() {
  clearCommState();
  const root = clear();
  if (ingestView.screen === "lesson") return ingestLesson(root);
  if (ingestView.screen === "library") return ingestLibrary(root);
  return ingestNew(root);
}

function ingestNav(active) {
  return el("div", { class: "comm-chips" },
    commChip("📝 Nạp mới", active === "new", () => { ingestView = { screen: "new" }; renderIngest(); }),
    commChip("📚 Thư viện bài học", active === "library", () => { ingestView = { screen: "library" }; renderIngest(); }));
}

function splitVi(text) {
  return String(text).replace(/\r/g, "").split(/(?<=[.!?…\n])/).map((s) => s.trim()).filter((s) => s.length > 1);
}

async function ingestNew(root) {
  root.append(el("h1", { class: "view-title" }, "📥 Nạp nội dung"));
  root.append(ingestNav("new"));
  const titleInput = el("input", { type: "text", placeholder: "Tên bài học (tùy chọn)" });
  const ta = el("textarea", { rows: "7", placeholder: "Dán truyện / bài viết / phụ đề tiếng Trung (hoặc văn bản tiếng Việt)…" });
  const fileInput = el("input", { type: "file", accept: ".txt,.srt,.lrc" });
  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ta.value = await f.text();
    if (!titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, "");
  });
  root.append(el("div", { class: "panel stack" },
    el("b", {}, "Nguồn"),
    el("div", { class: "field" }, titleInput),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" }, fileInput, el("button", { class: "btn primary", onclick: () => createLesson(ta.value, titleInput.value) }, "🔍 Phân tích & tạo bài học")),
    el("p", { class: "muted small" }, "Văn bản .txt/.srt xử lý ngay trong trình duyệt. Ảnh/PDF/audio/video & link truyện cần backend Qwen3 (sẽ thêm)."),
  ));
}

async function createLesson(text, title) {
  text = (text || "").trim();
  if (!text) return toast("Chưa có nội dung.");
  const hanCount = (text.match(/[一-鿿]/g) || []).length;
  const lang = hanCount >= 5 ? "zh" : "vi";
  toast("Đang phân tích…");
  const lesson = { id: "ls-" + Date.now().toString(36), title: (title || "").trim() || text.slice(0, 24), lang, source: { type: "paste" }, createdAt: new Date().toISOString(), manual: {} };
  if (lang === "zh") {
    const { vocab, sentences, chapters } = await lessons.analyzeText(text);
    lesson.vocab = vocab; lesson.sentences = sentences; lesson.chapters = chapters;
  } else {
    lesson.vocab = [];
    lesson.sentences = splitVi(text).map((vi) => ({ vi }));
    lesson.chapters = lessons.detectChapters(lesson.sentences, "vi");
  }
  await lessons.saveLesson(lesson);
  ingestView = { screen: "lesson", lessonId: lesson.id };
  renderIngest();
}

async function ingestLibrary(root) {
  root.append(el("h1", { class: "view-title" }, "📥 Nạp nội dung"));
  root.append(ingestNav("library"));
  const list = await lessons.listLessons();
  if (!list.length) { root.append(emptyState("Chưa có bài học", "Vào “Nạp mới” để tạo từ văn bản.")); return; }
  for (const l of list) {
    root.append(el("div", { class: "panel exam-card" },
      el("div", { class: "exam-head" }, el("h3", {}, l.title), el("span", { class: "chip" }, l.lang === "zh" ? "中文" : "Tiếng Việt")),
      el("p", { class: "muted small" }, `${new Date(l.createdAt).toLocaleDateString("vi")} · ${(l.vocab || []).length} từ · ${(l.sentences || []).length} câu`),
      el("div", { class: "exam-actions" },
        el("button", { class: "btn primary", onclick: () => { ingestView = { screen: "lesson", lessonId: l.id }; renderIngest(); } }, "Mở"),
        el("button", { class: "btn ghost", onclick: async () => { if (confirm("Xóa bài học?")) { await lessons.deleteLesson(l.id); renderIngest(); } } }, "Xóa"))));
  }
}

async function ingestLesson(root) {
  const lesson = await lessons.getLesson(ingestView.lessonId);
  if (!lesson) { ingestView = { screen: "library" }; return renderIngest(); }
  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { ingestView = { screen: "library" }; renderIngest(); } }, "← Bài học"),
    el("span", { class: "muted" }, lesson.title)));
  if (lesson.lang === "zh" && lesson.vocab.length) root.append(lessonVocabPanel(lesson));
  root.append(lessonTasksPanel(lesson));
}

function lessonVocabPanel(lesson) {
  const box = el("div", { class: "panel stack" });
  box.append(el("b", {}, `Từ vựng trong bài — ${lesson.vocab.length} từ, xếp theo nhóm HSK`));
  box.append(el("p", { class: "muted small" }, "Từ trong danh sách HSK giữ cấp gốc; từ ngoài danh sách xếp theo độ khó vào HSK 1–6 = cấp cao nhất của các chữ Hán (chữ ngoài HSK coi như khó nhất → HSK 6)."));
  const groups = {};
  for (const v of lesson.vocab) (groups[v.level] = groups[v.level] || []).push(v);
  for (let lv = 1; lv <= 6; lv++) {
    const arr = groups[lv]; if (!arr || !arr.length) continue;
    const list = el("div", { class: "lesson-vlist" });
    for (const v of arr) list.append(el("span", { class: "lesson-vword" + (v.inDict ? "" : " out"), title: v.meaning || "(từ ngoài danh sách HSK)" }, v.word + (v.freq > 1 ? ` ·${v.freq}` : "")));
    box.append(el("details", { class: "lesson-vgroup" },
      el("summary", {}, el("span", { class: "chip lvl" }, LV_LABEL[lv]), ` ${arr.length} từ`), list));
  }
  return box;
}

// Task Học từ + Shadowing (task Dịch tách riêng để chia theo khúc).
function buildTasks(lesson) {
  const tasks = [];
  if (lesson.lang !== "zh") return tasks;
  const dictWords = lesson.vocab.filter((v) => v.cardId);
  if (dictWords.length) {
    const prog = store.getProgress();
    const done = dictWords.filter((v) => { const st = prog[v.cardId]; return st && (st.known || st.reps > 0); }).length;
    tasks.push({ label: `🎴 Học ${dictWords.length} từ trong bài`, total: dictWords.length, done,
      start: () => { const ids = new Set(dictWords.map((v) => v.cardId)); setStudyFilter((c) => ids.has(c.id), `Bài học: ${lesson.title}`); navigate("study"); } });
  }
  const zhS = lesson.sentences.filter((s) => !s.chapter && s.zh);
  if (zhS.length) {
    tasks.push({ label: `🗣️ Luyện nói ${zhS.length} câu (Shadowing)`, total: zhS.length, done: lesson.manual.shadow ? zhS.length : 0, manual: "shadow",
      start: () => { commSel.sceneIds = []; commPersonal = zhS.map((s) => ({ zh: s.zh })); commPersonalLabel = lesson.title; commView = { screen: "shadow" }; navigate("comm"); } });
  }
  return tasks;
}

// Chia danh sách chỉ số câu trong 1 chương thành nhiều khúc theo cấu hình.
function chunkIdxs(idxs, sentences, cfg, key) {
  if (cfg.mode === "parts") {
    const k = Math.max(1, Math.min(cfg.value, idxs.length));
    const out = Array.from({ length: k }, () => []);
    idxs.forEach((id, n) => out[Math.floor((n * k) / idxs.length)].push(id));
    return out.filter((p) => p.length);
  }
  if (cfg.mode === "chars") {
    const out = []; let cur = [], sum = 0;
    for (const id of idxs) {
      const len = [...(sentences[id][key] || "")].length;
      if (cur.length && sum + len > cfg.value) { out.push(cur); cur = []; sum = 0; }
      cur.push(id); sum += len;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  const n = Math.max(1, cfg.value), out = [];
  for (let i = 0; i < idxs.length; i += n) out.push(idxs.slice(i, i + n));
  return out;
}

// Task Dịch: chia theo chương (nếu có) → theo khúc (số phần / số câu / số chữ).
function translateTasks(lesson) {
  const key = lesson.lang === "zh" ? "zh" : "vi";
  const dir = lesson.lang === "zh" ? "zh2vi" : "vi2zh";
  const cfg = lesson.transChunk || { mode: "parts", value: 3 };
  const chapters = lesson.chapters && lesson.chapters.length ? lesson.chapters : [{ title: null, start: 0, end: lesson.sentences.length }];
  const saved = new Set(store.getTranslations().map((t) => t.source));
  const tasks = [];
  for (const ch of chapters) {
    const idxs = [];
    for (let i = ch.start; i < ch.end; i++) { const s = lesson.sentences[i]; if (s && !s.chapter && (s[key] || "").trim()) idxs.push(i); }
    if (!idxs.length) continue;
    const parts = chunkIdxs(idxs, lesson.sentences, cfg, key);
    parts.forEach((p, pi) => {
      const done = p.filter((id) => saved.has(lesson.sentences[id][key])).length;
      const chapLbl = ch.title || (chapters.length > 1 ? "Mở đầu" : "");
      const partLbl = parts.length > 1 ? `${chapLbl ? " · " : ""}phần ${pi + 1}/${parts.length}` : "";
      tasks.push({ label: `🌐 Dịch ${chapLbl}${partLbl} (${p.length} câu)`.replace(/\s+/g, " "), total: p.length, done,
        start: () => { const next = p.find((id) => !saved.has(lesson.sentences[id][key])) ?? p[0]; transDraft = newTransDraft(dir); transDraft.source = lesson.sentences[next][key] || ""; transView = { screen: "home" }; navigate("trans"); } });
    });
  }
  return tasks;
}

function taskRow(lesson, t) {
  const row = el("div", { class: "lesson-task" });
  row.append(el("div", { class: "row spread" },
    el("span", {}, t.label),
    el("span", { class: "chip" + (t.total && t.done >= t.total ? " st known" : "") }, `${t.done}/${t.total}`)));
  const actions = el("div", { class: "row" }, el("button", { class: "btn small primary", onclick: t.start }, "Bắt đầu"));
  if (t.manual === "shadow") {
    const flag = !!lesson.manual.shadow;
    actions.append(el("button", { class: "btn small ghost", onclick: async () => { lesson.manual.shadow = !flag; await lessons.saveLesson(lesson); renderIngest(); } }, flag ? "Bỏ đánh dấu" : "✓ Đã luyện xong"));
  }
  row.append(actions);
  return row;
}

// Bộ chỉnh cách chia nhiệm vụ Dịch.
function transConfigRow(lesson) {
  const key = lesson.lang === "zh" ? "zh" : "vi";
  const cfg = lesson.transChunk || { mode: "parts", value: 3 };
  const nCau = (lesson.sentences || []).filter((s) => !s.chapter && (s[key] || "").trim()).length;
  const nChap = (lesson.chapters || []).filter((c) => c.title).length;
  const wrap = el("div", { class: "lesson-task" });
  wrap.append(el("div", { class: "row spread" },
    el("span", {}, "🌐 Dịch — chia nhiệm vụ"),
    el("span", { class: "muted small" }, `${nCau} câu${nChap ? ` · ${nChap} chương` : ""}`)));
  const mode = el("select", { class: "chunk-mode" },
    ...[["parts", "Số phần (½, ⅓…)"], ["sentences", "Số câu / phần"], ["chars", "Số chữ / phần"]].map(([v, l]) => el("option", { value: v, selected: cfg.mode === v }, l)));
  const val = el("input", { type: "number", min: "1", value: String(cfg.value), class: "chunk-val" });
  const apply = el("button", { class: "btn small primary", onclick: async () => {
    lesson.transChunk = { mode: mode.value, value: Math.max(1, parseInt(val.value, 10) || 1) };
    await lessons.saveLesson(lesson); renderIngest();
  } }, "Áp dụng");
  wrap.append(el("div", { class: "row" }, mode, val, apply));
  if (nChap) wrap.append(el("p", { class: "muted small" }, "Chia trong từng chương — không gộp câu giữa các chương."));
  return wrap;
}

function lessonTasksPanel(lesson) {
  const box = el("div", { class: "panel stack" });
  box.append(el("b", {}, "Nhiệm vụ"));
  const core = buildTasks(lesson);
  const tTasks = translateTasks(lesson);
  const all = [...core, ...tTasks];
  if (!all.length) { box.append(el("p", { class: "muted small" }, "Chưa tạo được nhiệm vụ từ nội dung này.")); return box; }
  const totalDone = all.reduce((s, t) => s + t.done, 0), totalAll = all.reduce((s, t) => s + t.total, 0);
  const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;
  box.append(el("div", { class: "progress" }, el("span", { style: `width:${pct}%` })));
  box.append(el("div", { class: "muted small" }, `Hoàn thành ${pct}%`));
  for (const t of core) box.append(taskRow(lesson, t));
  box.append(transConfigRow(lesson));
  for (const t of tTasks) box.append(taskRow(lesson, t));
  return box;
}

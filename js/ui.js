// ui.js — view rendering for every tab.

import * as store from "./store.js";
import * as srs from "./srs.js";
import { speak, hasChineseVoice } from "./audio.js";
import { getAllDecks, getDeck, parseCsv } from "./decks.js";
import { getAllExams, getExam, countReadingQuestions, parseExamJson } from "./exams.js";
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
  root.append(el("h1", { class: "view-title" }, "📖 Từ vựng"));
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

  root.append(el("h1", { class: "view-title" }, "📚 Bộ thẻ"));

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

/* ============================================================
   LUYỆN ĐỀ (HSK6 — Đọc trắc nghiệm + Viết 缩写)
   ============================================================ */
let examView = { screen: "list", examId: null };
let readingState = null;       // { examId, answers, graded, score, total }
let writeTimer = null;         // setInterval id cho đồng hồ phần Viết
function clearWriteTimer() { if (writeTimer) { clearInterval(writeTimer); writeTimer = null; } }

export async function renderExam() {
  clearWriteTimer();
  const root = clear();
  if (examView.screen === "reading") return examReading(root);
  if (examView.screen === "writing") return examWriting(root);
  return examList(root);
}

function examTopbar(title) {
  return el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { examView = { screen: "list" }; renderExam(); } }, "← Danh sách đề"),
    el("span", { class: "muted" }, title));
}

/* ---------- Màn hình danh sách đề ---------- */
async function examList(root) {
  root.append(el("h1", { class: "view-title" }, "📝 Luyện đề HSK6"));
  root.append(examImportBar());
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

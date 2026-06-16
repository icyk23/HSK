// ui.js — view rendering for every tab.

import * as store from "./store.js";
import * as srs from "./srs.js";
import { speak, hasChineseVoice, hasRecognition, recognizeChinese, stopSpeaking } from "./audio.js";
import * as comm from "./comm.js";
import * as lessons from "./lessons.js";
import * as trad from "./trad.js";
import { navigate, setScript } from "./main.js";
import { getAllDecks, getDeck, parseCsv } from "./decks.js";
import { getAllExams, getExam, countReadingQuestions, parseExamJson, getHskkExams, getHskk, parseHskkJson } from "./exams.js";
import { unzip } from "./unzip.js";
import * as lib from "./library.js";
import { STRUCT_LABELS, SEMANTIC_LABELS } from "./classify.js";
import { iconEl } from "./icons.js";

const app = () => document.getElementById("app");
// Nút loa tròn dùng lại nhiều nơi (icon SVG).
const audioBtn = (text, onclick, cls = "card-audio") =>
  el("button", { class: cls, title: "Nghe phát âm", onclick }, iconEl("speaker"), text ? el("span", { class: "btn-tx" }, text) : null);
// Lớp CSS cho chip nhóm nghĩa (trước bị thiếu → crash khi lật thẻ).
const semChipClass = (g) => "chip sem" + (g ? " sem-" + String(g).toLowerCase() : "");
// Đếm số tăng dần (dashboard)
function countUp(node, to, dur = 800) {
  if (!to || to <= 0) { node.textContent = String(to || 0); return; }
  const start = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
  (function step(now) {
    const p = Math.min(1, (now - start) / dur);
    node.textContent = String(Math.round(ease(p) * to));
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

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

// Phạm vi học theo một "bộ từ" — dùng chung cho Học thẻ / Quiz / Nghe / Gõ.
let learnScope = null; // { ids:Set, label } | null
function setLearnScope(ids, label) {
  learnScope = ids ? { ids, label: label || "" } : null;
  setStudyFilter(ids ? (c) => ids.has(c.id) : null, label);
}
function scopeCards(cards) { return learnScope ? cards.filter((c) => learnScope.ids.has(c.id)) : cards; }
// Đặt phạm vi học = nhóm/lựa chọn rồi mở phương thức (flashcard/quiz/gõ/nghe).
function studyScope(ids, label, mode) {
  const set = ids instanceof Set ? new Set(ids) : new Set(ids);
  if (!set.size) return toast("Chưa chọn từ nào.");
  setLearnScope(set, label);
  navigate(mode);
}
function studyFilterBanner() {
  if (!studyFilter) return null;
  return el("div", { class: "filter-banner" },
    el("span", {}, `Đang học theo bộ lọc: ${studyFilterLabel}`),
    el("button", { class: "btn ghost small", onclick: () => { setLearnScope(null); renderStudy(); } }, iconEl("x"), "Bỏ lọc"));
}
// Banner cho Quiz/Nghe/Gõ khi đang học theo một bộ từ.
function scopeBanner(reRender) {
  if (!learnScope) return null;
  return el("div", { class: "filter-banner" },
    el("span", {}, `Đang học bộ: ${learnScope.label}`),
    el("button", { class: "btn ghost small", onclick: () => { setLearnScope(null); reRender(); } }, iconEl("x"), "Bỏ"));
}

export async function renderStudy() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  const banner = studyFilterBanner();

  if (!deck) {
    if (banner) root.append(banner);
    root.append(emptyState("Chưa chọn bộ thẻ", "Vào tab Bộ thẻ để chọn hoặc tạo bộ thẻ."));
    return;
  }

  let cards = deck.cards;
  if (studyFilter) cards = cards.filter(studyFilter);

  const progress = store.getProgress();
  const queue = srs.buildQueue(cards, progress, { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit });

  if (!queue.length) {
    if (banner) root.append(banner);
    root.append(emptyState("Xong hôm nay!", studyFilter
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
    audioBtn(null, (e) => { e.stopPropagation(); speak(card.simplified, { rate: settings.speechRate }); }),
    !session.revealed && el("div", { class: "tap-hint" }, "Chạm vào thẻ để xem nghĩa"),
  );

  const back = session.revealed && el("div", { class: "stack" },
    el("div", { class: "pinyin" }, card.pinyin),
    el("div", { class: "meaning" }, card.meaning),
    card.han_viet && el("div", { class: "muted" }, `Hán-Việt: ${card.han_viet}`),
    settings.charMode !== "both" && card.traditional !== card.simplified &&
      el("div", { class: "muted no-cc" }, `${settings.charMode === "traditional" ? "Giản thể" : "Phồn thể"}: ${settings.charMode === "traditional" ? card.simplified : card.traditional}`),
    card.example && el("div", { class: "example", html: highlightHeadword(card.example, card.simplified) }),
    (card.hsk_level || card.semantic_group) && el("div", { class: "chips center-chips" },
      card.hsk_level && el("span", { class: "chip lvl" }, "HSK" + card.hsk_level),
      card.semantic_group && el("span", { class: semChipClass(card.semantic_group), title: SEMANTIC_LABELS[card.semantic_group] || "" }, `${card.semantic_group} ${SEMANTIC_LABELS[card.semantic_group] || ""}`),
    ),
  );

  const flashcard = el("div", { class: "flashcard" + (session.flip ? " flip" : ""), onclick: () => { if (!session.revealed) reveal(); } }, front, back);
  session.flip = false;

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
    el("button", { class: "btn ghost small", title: "Bỏ qua thẻ này, không ghi nhận (S)", onclick: skipCard }, iconEl("skip"), el("span", { class: "btn-tx" }, "Bỏ qua")),
    el("button", { class: "btn ghost small", title: "Đã thuộc — không hiện lại (K)", onclick: markKnown }, iconEl("check"), el("span", { class: "btn-tx" }, "Đã thuộc")),
  ));

  if (settings.autoPlayAudio) speak(card.simplified, { rate: settings.speechRate });
}

function reveal() {
  session.revealed = true;
  session.flip = true;        // bật hiệu ứng lật 3D một lần
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
let vocab = { level: "all", sem: "all", struct: "all", status: "all", review: false, sort: "level", q: "", limit: 100, editing: null, material: "all", groupBy: "level", open: new Set() };
let vocabSel = new Set();   // cardId đang tick chọn
let folderLimit = {};       // số từ hiện trong mỗi thư mục

function matchVocab(c, f) {
  if (f.level !== "all" && String(c.hsk_level) !== f.level) return false;
  if (f.struct !== "all" && c.struct_group !== f.struct) return false;
  if (f.sem === "none") { if (c.semantic_group) return false; }
  else if (f.sem !== "all" && c.semantic_group !== f.sem) return false;
  if (f.review && !c.needs_review) return false;
  if (f.status !== "all" && learnStatus(c.id) !== f.status) return false;
  if (f.material && f.material !== "all") { const set = materialCardIds[f.material]; if (!set || !set.has(c.id)) return false; }
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
  await ensureMaterials();
  root.append(hubBack("Từ vựng", "vocabHub"));
  root.append(el("h1", { class: "view-title" }, "Từ vựng — Thư mục"));
  if (!deck) { root.append(emptyState("Chưa chọn bộ thẻ", "Vào tab Nguồn từ để chọn bộ thẻ.")); return; }

  const search = el("input", { type: "text", placeholder: "Tìm chữ Hán / pinyin / nghĩa…", value: vocab.q });
  search.addEventListener("input", () => { vocab.q = search.value.trim(); renderFolders(); });
  const groupSel = selectRow(["level", "sem", "material"],
    ["Nhóm theo: Cấp HSK", "Nhóm theo: Nhóm nghĩa", "Nhóm theo: Tài liệu"], vocab.groupBy, (v) => { vocab.groupBy = v; vocab.open = new Set(); renderVocab(); });
  const statusSel = selectRow(["all", "new", "learning", "due", "known"],
    ["Mọi trạng thái", "Chưa học", "Đang học", "Đến hạn", "Đã thuộc"], vocab.status, (v) => { vocab.status = v; renderFolders(); });
  root.append(el("div", { class: "panel vocab-filter" },
    el("div", { class: "field", style: "margin-bottom:10px" }, search),
    el("div", { class: "filter-grid" }, groupSel, statusSel)));

  root.append(el("div", { id: "vocab-selbar" }));
  root.append(el("div", { id: "vocab-folders" }));
  renderSelBar();
  renderFolders();
}

function groupCards(cards, by) {
  const map = new Map();
  if (by === "material") {
    for (const m of materialList) {
      const set = materialCardIds[m.id];
      if (!set || !set.size) continue;
      const arr = cards.filter((c) => set.has(c.id));
      if (arr.length) map.set(m.id, { key: m.id, label: `${m.title}`, cards: arr });
    }
  } else if (by === "sem") {
    for (const c of cards) {
      const k = c.semantic_group || "none";
      if (!map.has(k)) map.set(k, { key: k, label: k === "none" ? "(chưa phân loại)" : `${k} · ${SEMANTIC_LABELS[k] || ""}`, cards: [] });
      map.get(k).cards.push(c);
    }
  } else {
    for (const c of cards) {
      const k = c.hsk_level || 0;
      if (!map.has(k)) map.set(k, { key: k, label: k ? "HSK " + k : "Khác", cards: [] });
      map.get(k).cards.push(c);
    }
  }
  let arr = [...map.values()];
  if (by === "level") arr.sort((a, b) => (a.key || 99) - (b.key || 99));
  else if (by === "sem") arr.sort((a, b) => (a.key === "none" ? 1 : 0) - (b.key === "none" ? 1 : 0) || String(a.key).localeCompare(String(b.key)));
  return arr;
}

function renderFolders() {
  const host = document.getElementById("vocab-folders");
  if (!host) return;
  host.innerHTML = "";
  getDeck(store.getSettings().activeDeckId).then((deck) => {
    const host2 = document.getElementById("vocab-folders");
    if (!deck || !host2) return;
    const cards = deck.cards.map(store.mergeClassification).filter((c) => matchVocab(c, vocab));
    const groups = groupCards(cards, vocab.groupBy);
    if (!groups.length) {
      host2.append(el("p", { class: "muted center", style: "padding:30px" },
        vocab.groupBy === "material" ? "Chưa có tài liệu nào. Vào Nạp tài liệu để thêm." : "Không có từ nào khớp."));
      return;
    }
    for (const g of groups) host2.append(folderEl(g));
  });
}

function cbx(on, partial, onclick) { return el("span", { class: "cbx" + (on ? " on" : partial ? " part" : ""), onclick }, on ? "✓" : partial ? "–" : ""); }

function toggleFolderSel(g, select) {
  for (const c of g.cards) { if (select) vocabSel.add(c.id); else vocabSel.delete(c.id); }
  renderFolders(); renderSelBar();
}

function folderEl(g) {
  const open = vocab.open.has(g.key);
  const selN = g.cards.reduce((n, c) => n + (vocabSel.has(c.id) ? 1 : 0), 0);
  const allSel = selN === g.cards.length && g.cards.length > 0;
  const head = el("div", { class: "folder-head" },
    cbx(allSel, selN > 0 && !allSel, (e) => { e.stopPropagation(); toggleFolderSel(g, !allSel); }),
    el("div", { class: "folder-name", onclick: () => { if (open) vocab.open.delete(g.key); else vocab.open.add(g.key); renderFolders(); } }, `${open ? "▾" : "▸"} ${g.label}`),
    el("span", { class: "folder-ct" }, `${selN ? selN + "/" : ""}${g.cards.length}`),
    el("button", { class: "btn ghost small folder-go", title: "Học nhóm này (Flashcard)", onclick: (e) => { e.stopPropagation(); studyScope(g.cards.map((c) => c.id), g.label, "study"); } }, iconEl("play")));
  const box = el("div", { class: "folder" }, head);
  if (open) {
    const lim = folderLimit[g.key] || 100;
    const wrap = el("div", { class: "folder-words" });
    g.cards.slice(0, lim).forEach((c) => wrap.append(wordChip(c)));
    box.append(wrap);
    if (g.cards.length > lim) box.append(el("button", { class: "btn ghost small", onclick: () => { folderLimit[g.key] = lim + 100; renderFolders(); } }, `Hiện thêm (${g.cards.length - lim})`));
  }
  return box;
}

function wordChip(c) {
  const on = vocabSel.has(c.id);
  return el("button", { class: "wchip" + (on ? " on" : ""), title: `${c.pinyin || ""} · ${c.meaning || ""}`,
    onclick: () => { if (on) vocabSel.delete(c.id); else vocabSel.add(c.id); renderFolders(); renderSelBar(); } },
    el("span", { class: "wcb" + (on ? " on" : "") }, on ? "✓" : ""),
    el("span", { class: "wzh" }, c.simplified),
    el("span", { class: "wpy" }, c.pinyin || ""));
}

function renderSelBar() {
  const host = document.getElementById("vocab-selbar");
  if (!host) return;
  host.innerHTML = "";
  if (!vocabSel.size) {
    host.append(el("p", { class: "muted small", style: "margin:10px 2px" }, "Bấm ▶ ở mỗi nhóm để học ngay, hoặc tick chọn từ → học/lưu thành bộ."));
    return;
  }
  const lbl = `Đã chọn ${vocabSel.size} từ`;
  host.append(el("div", { class: "selbar" },
    el("b", {}, lbl),
    el("div", { class: "spacer" }),
    el("button", { class: "btn primary small", onclick: saveSelAsSet }, iconEl("save"), "Lưu thành bộ…"),
    el("button", { class: "btn ghost small", onclick: () => { vocabSel.clear(); renderFolders(); renderSelBar(); } }, "Bỏ chọn")));
  host.append(el("div", { class: "row", style: "margin-top:8px;align-items:center" },
    el("span", { class: "muted small" }, "Học ngay:"),
    methodBtn("cards", "Flashcard", () => studyScope(vocabSel, lbl, "study")),
    methodBtn("exam", "Quiz", () => studyScope(vocabSel, lbl, "quiz")),
    methodBtn("keyboard", "Gõ pinyin", () => studyScope(vocabSel, lbl, "type")),
    methodBtn("speaker", "Nghe", () => studyScope(vocabSel, lbl, "listen"))));
}

function saveSelAsSet() {
  if (!vocabSel.size) return;
  const d = new Date();
  const def = `Bộ từ ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const name = prompt("Tên bộ từ:", def);
  if (name === null) return;
  store.saveWordSet({ id: "ws-" + Date.now().toString(36), name: name.trim() || def, cardIds: [...vocabSel], createdAt: new Date().toISOString() });
  toast(`Đã lưu "${name.trim() || def}" (${vocabSel.size} từ).`);
  vocabSel.clear();
  renderFolders(); renderSelBar();
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
  const pool = scopeCards(deck.cards);
  if (pool.length < 1) { root.append(scopeBanner(renderQuiz)); root.append(emptyState("Bộ rỗng", "Bộ từ này không có thẻ hợp lệ.")); return; }

  const quiz = { deck, settings: s, q: 0, score: 0, total: Math.min(10, pool.length), pool: shuffle([...pool]) };
  renderQuizQuestion(quiz);
}

function renderQuizQuestion(quiz) {
  const root = clear();
  if (quiz.q >= quiz.total) return renderQuizResult(quiz);
  const sb = scopeBanner(renderQuiz); if (sb) root.append(sb);

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
    el("button", { class: "btn ghost", style: "margin:0 auto 8px;display:block", onclick: () => speak(card.simplified, { rate: quiz.settings.speechRate }) }, iconEl("speaker"), "Nghe"),
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
      el("div", { class: "big" }, iconEl(pct >= 80 ? "check" : pct >= 50 ? "bulb" : "replay")),
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
  if (!deck) { root.append(emptyState("Chưa có bộ thẻ", "Chọn bộ thẻ ở tab Nguồn từ.")); return; }
  const pool = scopeCards(deck.cards);

  root.append(el("h1", { class: "view-title" }, "Luyện nghe"));
  const sb = scopeBanner(renderListen); if (sb) root.append(sb);

  if (!hasChineseVoice()) {
    root.append(el("div", { class: "panel", style: "margin-bottom:14px" },
      el("p", { class: "muted" }, "Trình duyệt chưa có giọng đọc tiếng Trung. Trên máy tính, hãy cài gói giọng nói tiếng Trung (Windows: Settings → Time & Language → Speech). Trên điện thoại Android/iOS thường có sẵn.")));
  }

  let mode = "char"; // char | meaning
  const card = { current: null };

  const display = el("div", { class: "flashcard", style: "min-height:220px" });
  const controls = el("div", { class: "row", style: "margin-top:14px;justify-content:center" });

  function next() {
    card.current = pool[Math.floor(Math.random() * pool.length)];
    card.shown = false;
    paint();
    speak(card.current.simplified, { rate: s.speechRate });
  }
  function paint() {
    display.innerHTML = "";
    const c = card.current;
    if (!c) { display.append(el("div", { class: "muted" }, "Bấm ▶ để bắt đầu")); return; }
    if (card.shown) {
      const { main, sub } = displayHanzi(c, s.charMode);
      display.append(
        el("div", { class: "hanzi" }, main),
        sub && el("div", { class: "hanzi trad" }, sub),
        el("div", { class: "pinyin" }, c.pinyin),
        el("div", { class: "meaning" }, c.meaning),
      );
    } else {
      display.append(el("div", { class: "hanzi", style: "letter-spacing:8px" }, "？"), el("div", { class: "tap-hint" }, "Nghe rồi đoán — chạm để hiện đáp án"));
    }
  }
  display.addEventListener("click", () => { if (card.current && !card.shown) { card.shown = true; paint(); } });

  controls.append(
    el("button", { class: "btn", onclick: () => card.current && speak(card.current.simplified, { rate: s.speechRate }) }, iconEl("replay"), "Nghe lại"),
    el("button", { class: "btn primary", onclick: next }, iconEl("play"), "Từ tiếp theo"),
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

  root.append(hubBack("Từ vựng", "vocabHub"));
  root.append(el("h1", { class: "view-title" }, "Nguồn từ"));

  const list = el("div", { class: "stack" });
  decks.forEach((d) => {
    const active = d.id === s.activeDeckId;
    list.append(el("div", { class: "deck-item" },
      el("div", { class: "meta" },
        el("b", {}, d.name),
        el("small", {}, `${d.cards.length} thẻ${d.builtin ? " · có sẵn" : ""}`)),
      active ? el("span", { class: "pill" }, "Đang chọn")
             : el("button", { class: "btn", onclick: () => { store.saveSettings({ activeDeckId: d.id }); toast(`Đã chọn "${d.name}"`); renderManage(); } }, "Chọn"),
      !d.builtin && el("button", { class: "btn ghost", title: "Xoá", onclick: () => { if (confirm(`Xoá bộ "${d.name}"?`)) { store.deleteUserDeck(d.id); toast("Đã xoá"); renderManage(); } } }, iconEl("trash")),
    ));
  });
  root.append(list);

  // Import panel
  root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "Thêm bộ thẻ mới"));
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
  } }, iconEl("save"), "Lưu bộ thẻ");

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

  root.append(el("div", { class: "row spread" },
    el("h1", { class: "view-title", style: "margin:0" }, "Tiến độ"),
    s.charMode === "traditional" ? el("span", { class: "chip st known no-cc" }, "Track: Phồn thể") : null));

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
    statBox(streak, "Chuỗi ngày"),
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

  // Tiến độ các module khác (Phồn thể · Dịch thuật) — thuần browser
  const tpairs = await tradPairs();
  if (tpairs.length) {
    const tsrs = store.getTradSrs();
    const tmeta = store.getTradMeta();
    const tLearned = tpairs.filter((p) => tsrs[p.simp]?.reps > 0).length;
    const tDue = tpairs.filter((p) => { const st = tsrs[p.simp]; return st && !srs.isNew(st) && srs.isDue(st); }).length;
    root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "Phồn thể 繁→简"));
    const box = el("div", { class: "panel stack" });
    box.append(progressRow("Chữ đã học", tLearned, tpairs.length));
    box.append(el("div", { class: "row" },
      el("span", { class: "chip" }, `Đến hạn ôn: ${tDue}`),
      el("span", { class: "chip" + (tmeta.rulesDone ? " st known" : "") }, tmeta.rulesDone ? "Bộ thủ: đã nắm" : "Bộ thủ: chưa nắm"),
      tmeta.quizBest ? el("span", { class: "chip" }, `Kỷ lục quiz: ${tmeta.quizBest.score}/${tmeta.quizBest.total}`) : null));
    root.append(box);
  }

  await ensureMaterials();
  const stories = materialList.map((m) => ({ m, chunks: storyChunks(m) })).filter((x) => x.chunks.length);
  if (stories.length) {
    root.append(el("h2", { class: "view-title", style: "margin-top:24px;font-size:17px" }, "Dịch thuật theo truyện"));
    const box = el("div", { class: "panel stack" });
    for (const { m, chunks } of stories) {
      const tot = chunks.reduce((a, c) => a + c.total, 0);
      const dn = chunks.reduce((a, c) => a + c.done, 0);
      box.append(progressRow(m.title || "(không tên)", dn, tot));
    }
    root.append(box);
  }
}

/* ---------------- TRANG CHỦ (dashboard) ---------------- */
export async function renderHome() {
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  const progress = store.getProgress();
  const stats = store.getStats();

  let learned = 0, due = 0, total = deck ? deck.cards.length : 0;
  if (deck) for (const c of deck.cards) {
    const st = progress[c.id];
    if (st && st.reps > 0) learned += 1;
    if (srs.isDue(st) && !srs.isNew(st)) due += 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayStat = stats[today] || { reviews: 0, correct: 0 };
  const streak = computeStreak(stats);
  const hour = new Date().getHours();
  const greet = hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  // Hero: lời chào + CTA tiếp tục học
  const hero = el("div", { class: "home-hero" },
    el("div", { class: "home-hero-main" },
      el("div", { class: "home-kicker no-cc" }, greet.toUpperCase() + (s.charMode === "traditional" ? " · TRACK PHỒN THỂ" : "")),
      el("h1", { class: "home-title" }, due > 0 ? `Bạn có ${due} thẻ đến hạn ôn` : learned > 0 ? "Tiếp tục chinh phục tiếng Trung" : "Bắt đầu hành trình tiếng Trung"),
      el("p", { class: "home-sub muted" }, due > 0 ? "Ôn ngay để giữ chuỗi ngày và nhớ lâu hơn." : "Mỗi ngày vài thẻ — tiến bộ đều đặn."),
      el("div", { class: "row" },
        el("button", { class: "btn primary big", onclick: () => navigate("study") }, iconEl("play"), el("span", { class: "btn-tx" }, due > 0 ? "Ôn ngay" : "Bắt đầu học")),
        el("button", { class: "btn", onclick: () => navigate("quiz") }, iconEl("exam"), el("span", { class: "btn-tx" }, "Kiểm tra nhanh"))),
    ),
    el("div", { class: "home-streak" },
      el("div", { class: "home-streak-num" }, String(streak)),
      el("div", { class: "home-streak-lbl" }, "NGÀY LIÊN TỤC")),
  );
  root.append(hero);

  // P1 — "Tiếp tục" việc đang dở (shadowing video · dịch truyện · nháp Viết)
  const cont = await homeContinueItems();
  if (cont.length) {
    const sec = el("div", { style: "margin-top:18px" });
    sec.append(el("div", { class: "row spread", style: "margin-bottom:10px" }, el("h2", { class: "view-title", style: "margin:0" }, "Tiếp tục"), el("span", { class: "muted small" }, "Việc bạn đang làm dở")));
    const grid = el("div", { class: "home-continue" });
    for (const it of cont) {
      grid.append(el("button", { class: "continue-card", onclick: it.go },
        el("span", { class: "cc-ic" }, iconEl(it.icon)),
        el("span", { class: "cc-body" },
          el("span", { class: "cc-title" }, it.title),
          el("span", { class: "cc-sub muted small" }, it.sub),
          it.total ? el("span", { class: "story-prog", style: "margin-top:8px" }, el("span", { style: `width:${Math.round((it.done / it.total) * 100)}%` })) : null),
        el("span", { class: "cc-go" }, iconEl("play"))));
    }
    sec.append(grid);
    root.append(sec);
  }

  // Onboarding: chỉ hiện cho người MỚI (chưa học gì & chưa có việc dở), vẫn ẩn được
  if (!s.onboardDismissed && learned === 0 && cont.length === 0) {
    const card = el("div", { class: "panel", style: "margin-top:16px" });
    card.append(el("div", { class: "row spread" },
      el("b", {}, "Bắt đầu nhanh trong 3 bước"),
      el("button", { class: "btn ghost small", onclick: () => { store.saveSettings({ onboardDismissed: true }); renderHome(); } }, iconEl("x"), "Ẩn hướng dẫn")));
    const grid = el("div", { class: "trad-road", style: "margin-top:12px" });
    const steps = [
      ["1", "Học thẻ từ vựng đầu tiên", "Lật thẻ, tự chấm nhớ — SRS sẽ nhắc ôn đúng lúc.", "study"],
      ["2", "Nạp một truyện để dịch", "Dán truyện / phụ đề tiếng Trung → luyện dịch theo khúc.", "ingest"],
      ["3", "Thử lộ trình Phồn thể", "繁→简 cho người mới: bộ thủ → thẻ nhớ → quiz.", "tradHome"],
    ];
    for (const [n, t, d, view] of steps) {
      grid.append(el("button", { class: "road-step", onclick: () => navigate(view) },
        el("span", { class: "road-n" }, n),
        el("span", { class: "road-body" }, el("span", { class: "road-title" }, t), el("span", { class: "road-desc muted small no-cc" }, d)),
        iconEl("play")));
    }
    card.append(grid);
    root.append(card);
  }

  // "Hôm nay" — gộp mục tiêu + số liệu + tiến độ bộ thẻ vào MỘT panel cho gọn
  {
    const goal = Math.max(1, s.newPerDay || 15);
    const reached = todayStat.reviews >= goal;
    const pct = Math.min(100, Math.round((todayStat.reviews / goal) * 100));
    const fill = el("span", { style: `width:${pct}%` });
    if (reached) fill.style.background = "var(--ok)";
    const miniStat = (n, l) => el("div", { class: "ms" }, el("span", { class: "ms-num" }, String(n)), el("span", { class: "ms-lbl" }, l));
    const panel = el("div", { class: "panel stack", style: "margin-top:18px" });
    panel.append(el("div", { class: "row spread" },
      el("b", {}, reached ? iconEl("check") : null, " Mục tiêu hôm nay"),
      el("span", { class: "chip" + (reached ? " st known" : "") }, `${todayStat.reviews}/${goal} lượt ôn`)));
    panel.append(el("div", { class: "progress", style: "margin:10px 0 0" }, fill));
    panel.append(el("p", { class: "muted small", style: "margin:8px 0 0" },
      reached ? "Tuyệt vời! Bạn đã đạt mục tiêu hôm nay — chuỗi ngày được giữ vững." : `Còn ${goal - todayStat.reviews} lượt ôn nữa là đạt mục tiêu.`));
    panel.append(el("div", { class: "mini-stats" }, miniStat(learned, "Đã học"), miniStat(due, "Đến hạn ôn"), miniStat(total - learned, "Chưa học")));
    panel.append(progressRow("Tiến độ bộ thẻ", learned, total));
    root.append(panel);
  }

  // Tra cứu nhanh: gõ chữ Hán / pinyin / nghĩa → kết quả từ bộ thẻ
  const lookup = el("div", { class: "panel stack", style: "margin-top:16px" }, el("b", {}, "Tra cứu nhanh"));
  const lkInp = el("input", { type: "text", placeholder: "Gõ chữ Hán · pinyin · nghĩa…" });
  const lkRes = el("div", { class: "lookup-results" });
  lkInp.addEventListener("input", () => {
    const q = lkInp.value.trim().toLowerCase();
    lkRes.innerHTML = "";
    if (!q || !deck) return;
    const hits = deck.cards.filter((c) => `${c.simplified} ${c.traditional || ""} ${(c.pinyin || "").toLowerCase()} ${(c.meaning || "").toLowerCase()} ${(c.han_viet || "").toLowerCase()}`.includes(q)).slice(0, 8);
    if (!hits.length) { lkRes.append(el("div", { class: "muted small" }, "Không tìm thấy.")); return; }
    for (const c of hits) {
      const { main } = displayHanzi(c, s.charMode);
      lkRes.append(el("div", { class: "lookup-row" },
        el("button", { class: "btn ghost small", onclick: () => speak(c.simplified, { rate: s.speechRate }) }, iconEl("speaker")),
        el("span", { class: "lookup-hz" }, main),
        el("span", { class: "pinyin" }, c.pinyin || ""),
        el("span", { class: "muted small" }, (c.han_viet ? `[${c.han_viet}] ` : "") + (c.meaning || ""))));
    }
  });
  lookup.append(el("div", { class: "field" }, lkInp), lkRes);
  root.append(lookup);

  // Track học: Giản / Phồn (tiến độ độc lập, 1 chạm chuyển)
  const cur = s.charMode === "traditional" ? "trad" : "simp";
  const trackLearned = (prog) => { if (!deck) return 0; let n = 0; for (const c of deck.cards) if (prog[c.id]?.reps > 0) n++; return n; };
  const trackBox = el("div", { class: "panel stack", style: "margin-top:16px" }, el("b", {}, "Track học"));
  const trackRow = el("div", { class: "track-row" });
  for (const t of [{ id: "simp", label: "Giản thể", zh: "简" }, { id: "trad", label: "Phồn thể", zh: "繁" }]) {
    const ln = trackLearned(store.getProgressFor(t.id));
    const stk = computeStreak(store.getStatsFor(t.id));
    trackRow.append(el("button", { class: "track-card no-cc" + (t.id === cur ? " active" : ""), onclick: () => { if (t.id !== cur) setScript(t.id); } },
      el("span", { class: "track-zh" }, t.zh),
      el("span", { class: "track-body" },
        el("span", { class: "track-name" }, t.label),
        el("span", { class: "track-meta muted small" }, `${ln} từ · ${stk} ngày chuỗi`)),
      t.id === cur ? el("span", { class: "chip st known" }, "Đang học") : el("span", { class: "muted small" }, "Chuyển →")));
  }
  trackBox.append(trackRow);
  root.append(trackBox);

  // Vào nhanh các module — chỉ hiện trên mobile (desktop đã có sidebar)
  const quick = el("div", { class: "home-quick", style: "margin-top:26px" });
  quick.append(el("h2", { class: "view-title", style: "margin:0 0 12px" }, "Vào nhanh"));
  const tiles = el("div", { class: "home-tiles" });
  const TILES = [
    ["cards", "Từ vựng", "Flashcard · SRS · Quiz", "vocabHub"],
    ["exam", "Luyện đề", "HSK6 · HSKK 高级", "examHub"],
    ["comm", "Giao tiếp", "Phản xạ · Phát âm", "comm"],
    ["trans", "Dịch thuật", "Trung ↔ Việt", "trans"],
    ["trad", "Phồn thể", "简 → 繁", "tradHub"],
    ["ingest", "Nạp tài liệu", "Truyện · phụ đề · văn bản", "ingest"],
  ];
  for (const [ic, name, desc, view] of TILES) {
    tiles.append(el("button", { class: "home-tile", onclick: () => navigate(view) },
      el("span", { class: "home-tile-ic" }, iconEl(ic)),
      el("span", { class: "home-tile-body" },
        el("span", { class: "home-tile-name" }, name),
        el("span", { class: "home-tile-desc muted no-cc" }, desc)),
    ));
  }
  quick.append(tiles);
  root.append(quick);

  // đếm số tăng dần cho số nguyên thuần
  requestAnimationFrame(() => root.querySelectorAll(".home-streak-num, .stat-box .num").forEach((n) => {
    const v = n.textContent.trim();
    if (/^\d+$/.test(v)) countUp(n, parseInt(v, 10));
  }));
}

// Mở thẳng Shadowing cho 1 tài liệu (dùng ở "Tiếp tục").
function openShadowMaterial(m) {
  const zhS = (m.sentences || []).filter((x) => !x.chapter && x.zh);
  commSel.sceneIds = [];
  commPersonal = zhS.map((x) => ({ zh: x.zh, vi: x.vi, t: x.t }));
  commPersonalLabel = m.title; commPersonalVideo = matVideo(m); commPersonalMatId = m.id;
  commSrcMode = "material";
  commView = { screen: "shadow", started: true };
  navigate("comm");
}

// Gom việc đang dở để hiện ở Trang chủ. Trả tối đa 4 thẻ.
async function homeContinueItems() {
  const items = [];
  let materials = [];
  try { materials = await lessons.listMaterials(); } catch {}
  const translated = new Set(store.getTranslations().map((t) => t.source));
  for (const m of materials) {
    const sents = (m.sentences || []).filter((x) => !x.chapter && x.zh);
    if (!sents.length) continue;
    if (m.source && m.source.kind === "video" && m.source.url) {
      const prog = store.getShadowProgress(m.id);
      const done = sents.filter((_, i) => prog[i]).length;
      if (done > 0 && done < sents.length) items.push({ icon: "video", title: m.title, sub: `Shadowing video · ${done}/${sents.length} câu`, done, total: sents.length, go: () => openShadowMaterial(m) });
    }
    const tDone = sents.filter((x) => translated.has(x.zh)).length;
    if (tDone > 0 && tDone < sents.length) items.push({ icon: "trans", title: m.title, sub: `Dịch theo truyện · ${tDone}/${sents.length} câu`, done: tDone, total: sents.length, go: () => { transView = { screen: "story", materialId: m.id }; navigate("trans"); } });
  }
  try {
    for (const ex of await getAllExams()) {
      const w = store.getExamProgress(ex.id).writing;
      if (w && w.text && countChars(w.text) > 0) items.push({ icon: "keyboard", title: ex.title, sub: `Viết 缩写 · ${countChars(w.text)} chữ nháp`, done: 0, total: 0, go: () => { examView = { screen: "writing", examId: ex.id, tab: "choose" }; navigate("exam"); } });
    }
  } catch {}
  return items.slice(0, 4);
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
  root.append(el("h1", { class: "view-title" }, "Cài đặt"));

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
    backendStatus.innerHTML = `<span style="color:var(--ok)">Đã kết nối</span> · Ollama ${yn(h.ollama)} (${h.model || "?"}) · PDF ${yn(caps.pdf_text)} · OCR ảnh ${yn(caps.ocr)} · Nghe video/audio ${yn(caps.asr)} · Link web ${yn(caps.web)} · YouTube ${yn(caps.ytdlp)}`;
  };
  root.append(el("div", { class: "panel stack ai-panel", style: "margin-top:14px" },
    el("b", {}, "AI ", el("span", { class: "ai-tag" }, "Qwen3"), el("span", { class: "muted small", style: "font-weight:400" }, " · tùy chọn")),
    el("p", { class: "muted small" }, "Backend local (Ollama) mở khoá AI: chấm & sửa Dịch thuật, chấm Viết 缩写 (Luyện đề), và bóc câu từ ảnh/PDF/audio/video (Giao tiếp). Để trống thì app vẫn chạy đủ trong trình duyệt. Hướng dẫn cài: thư mục backend/ (chạy bash run.sh)."),
    el("div", { class: "field" }, el("label", {}, "Địa chỉ backend"), backendInput),
    el("div", { class: "row" }, el("button", { class: "btn", onclick: testBackend }, iconEl("plug"), "Lưu & kiểm tra"), backendStatus),
  ));

  // data
  root.append(el("div", { class: "panel stack", style: "margin-top:14px" },
    el("b", {}, "Dữ liệu"),
    el("p", { class: "muted small" }, "Sao lưu gồm: tiến độ SRS, bộ thẻ, bộ từ của tôi, bài đã dịch, tài liệu/truyện đã nạp, lộ trình & SRS Phồn thể, kết quả luyện đề, kỷ lục. (Không gồm file .zip đề thi trong Thư viện — tải lại được.)"),
    el("div", { class: "row" },
      el("button", { class: "btn", onclick: exportData }, iconEl("download"), "Xuất sao lưu"),
      el("button", { class: "btn", onclick: importData }, iconEl("upload"), "Nhập sao lưu"),
    ),
    el("button", { class: "btn ghost", style: "color:var(--bad)", onclick: () => {
      if (confirm("Xoá toàn bộ tiến độ học (giữ lại bộ thẻ)?")) { store.resetProgress(); toast("Đã xoá tiến độ."); }
    } }, iconEl("reset"), "Đặt lại tiến độ học"),
  ));

  root.append(el("p", { class: "muted center", style: "margin-top:20px;font-size:12px" }, "Mọi dữ liệu lưu ngay trên thiết bị của bạn (offline). Nhớ xuất sao lưu định kỳ."));
}

async function exportData() {
  const data = store.exportAll();
  try { data.materials = await lessons.listMaterials(); } catch { data.materials = []; }
  data.backupVersion = 2;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `hsk-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  const n = (data.materials || []).length;
  toast(`Đã xuất sao lưu${n ? ` (gồm ${n} tài liệu)` : ""}.`);
}
function importData() {
  const inp = el("input", { type: "file", accept: ".json" });
  inp.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); }
    catch { return toast("File không hợp lệ."); }
    if (!data || typeof data !== "object" || !data.settings) return toast("Không phải file sao lưu của app.");
    const nMat = (data.materials || []).length;
    if (!confirm(`Khôi phục sẽ GHI ĐÈ dữ liệu hiện tại trên thiết bị này (tiến độ, bộ từ, bài dịch${nMat ? `, ${nMat} tài liệu` : ""}). Tiếp tục?`)) return;
    try {
      store.importAll(data);
      if (Array.isArray(data.materials)) {
        for (const m of data.materials) { try { await lessons.saveMaterial(m); } catch {} }
        invalidateMaterials();
      }
      store.applyTheme();
      toast("Đã khôi phục sao lưu.");
      renderSettings();
    } catch (err) { toast("Lỗi khi khôi phục: " + err.message); }
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

function emptyState(title, msg, icon = "book", action = null) {
  const box = el("div", { class: "empty" }, el("div", { class: "big" }, iconEl(icon)), el("h2", {}, title), el("p", {}, msg));
  if (action) box.append(el("button", { class: "btn primary", style: "margin-top:16px", onclick: action.onClick }, action.icon ? iconEl(action.icon) : null, " " + action.label));
  return box;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- Kho tài liệu đề thi (zip → PDF/audio/ảnh, lưu IndexedDB) ---------- */
let viewerUrl = null;
function revokeViewerUrl() { if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; } }

async function libraryBar() {
  const wrap = el("details", { class: "panel exam-import", open: true });
  wrap.append(el("summary", {}, iconEl("download"), " Tài liệu đề thi (PDF · ebook · audio)"));
  wrap.append(el("p", { class: "muted small" }, "Tải lên file .zip (đề / sách / audio). App tự giải nén & lưu vào máy (IndexedDB) để xem offline. Mở file PDF rồi bấm “Sinh đề đọc hiểu từ PDF (Qwen3)” khi bật backend."));

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
        el("div", {}, el("b", {}, "" + c.name),
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

const KIND_ICON = { pdf: "file", audio: "audio", image: "image", text: "book", ebook: "book", other: "file" };

async function examLibrary(root) {
  const coll = await lib.getCollection(examView.collId);
  if (!coll) { examView = { screen: "list" }; return renderExam(); }
  root.append(examTopbar("" + coll.name));

  const layout = el("div", { class: "lib-layout" });
  const fileList = el("div", { class: "lib-files" });
  for (const fm of coll.fileMeta) {
    const kind = lib.fileKind(fm);
    const active = examView.fileId === fm.id;
    fileList.append(el("button", { class: "lib-file" + (active ? " active" : ""), onclick: () => { examView = { ...examView, fileId: fm.id }; renderExam(); } },
      el("span", { class: "lf-icon" }, iconEl(KIND_ICON[kind] || "file")),
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
    el("a", { class: "btn small", href: viewerUrl, download: fm.name }, iconEl("download"), "Tải về")));
  if (kind === "pdf") {
    host.append(el("iframe", { class: "pdf-frame", src: viewerUrl }));
    const pdfBtn = el("button", { class: "btn ghost small", onclick: doExtractExam }, iconEl("ai"), "Sinh đề đọc hiểu từ PDF (Qwen3)");
    host.append(pdfBtn);
    async function doExtractExam() {
      if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để bóc đề.");
      pdfBtn.disabled = true; toast("Đang bóc chữ từ PDF…");
      try {
        const lines = await comm.extractViaBackend(blob, fm.name, "pdf", false);
        const text = (lines || []).map((l) => l.zh).join("\n").trim();
        if (text.length < 30) return toast("PDF không đủ chữ tiếng Trung để ra đề.");
        toast("Đang sinh đề từ nội dung PDF…");
        const { exam, count } = await comm.genExam(text, 5);
        const { exam: norm, error } = parseExamJson(JSON.stringify(exam));
        if (error) return toast("Đề không hợp lệ: " + error);
        store.saveUserExam(norm);
        toast(`Đã tạo đề “${norm.title}” · ${count} câu từ PDF.`);
        examView = { screen: "list", tab: "choose" }; renderExam();
      } catch (e) { toast("Lỗi: " + e.message); }
      finally { pdfBtn.disabled = false; }
    }
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
  return examHskList(root);
}

// Luyện đề HSKK 高级 (tab con riêng).
export async function renderExamHskk() {
  clearWriteTimer();
  revokeViewerUrl();
  clearCommState();
  const root = clear();
  if (examView.screen === "hskk") return examHskk(root);
  return hskkListPage(root);
}

// Thanh tab con trong Luyện đề: Chọn đề luyện / Nạp đề.
function examSubTabs(render) {
  if (!examView.tab) examView.tab = "choose";
  const mk = (id, label, icon) => el("button", { class: "subtab" + (examView.tab === id ? " on" : ""), onclick: () => { examView.tab = id; render(); } }, iconEl(icon), el("span", {}, " " + label));
  return el("div", { class: "subtabs" }, mk("choose", "Chọn đề luyện", "book"), mk("load", "Nạp đề", "upload"));
}

function examTopbar(title) {
  return el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { examView = { screen: "list", tab: examView.tab || "choose" }; renderExam(); } }, "← Danh sách đề"),
    el("span", { class: "muted" }, title));
}

/* ---------- HSK — danh sách & nạp đề ---------- */
async function examHskList(root) {
  examView.screen = "list";
  root.append(hubBack("Luyện đề", "examHub"));
  root.append(el("h1", { class: "view-title" }, "Luyện đề · HSK"));
  root.append(examSubTabs(renderExam));
  if (examView.tab === "load") {
    root.append(examGenBar());
    root.append(await libraryBar());
    return;
  }
  const exams = await getAllExams();
  if (!exams.length) {
    root.append(emptyState("Chưa có đề HSK", "Sang tab “Nạp đề” để sinh đề bằng Qwen3, nhập đề JSON hoặc tải kho đề.",
      "exam", { label: "Nạp đề", onClick: () => { examView.tab = "load"; renderExam(); } }));
    return;
  }

  const list = el("div", { class: "exam-list" });
  for (const ex of exams) {
    const prog = store.getExamProgress(ex.id);
    const rq = countReadingQuestions(ex);
    const actions = el("div", { class: "exam-actions" });
    if (rq) actions.append(el("button", { class: "btn primary", onclick: () => { examView = { screen: "reading", examId: ex.id }; renderExam(); } }, iconEl("book"), ` Đọc · ${rq} câu`));
    if (ex.writing) actions.append(el("button", { class: "btn", onclick: () => { examView = { screen: "writing", examId: ex.id }; renderExam(); } }, iconEl("keyboard"), " Viết"));
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

/* ---------- HSKK 高级 (thi nói) — danh sách & nạp đề ---------- */
async function hskkListPage(root) {
  examView.screen = "hskklist";
  root.append(hubBack("Luyện đề", "examHub"));
  root.append(el("h1", { class: "view-title" }, "Luyện đề · HSKK 高级"));
  root.append(examSubTabs(renderExamHskk));
  if (examView.tab === "load") {
    root.append(hskkGenBar());
    return;
  }
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 12px" }, "3 phần: 听后复述 (nghe·kể lại) · 朗读 (đọc to·chấm phát âm) · 回答问题 (trả lời câu hỏi). Dùng Chrome/Edge để chấm phát âm."));
  const exams = await getHskkExams();
  if (!exams.length) {
    root.append(emptyState("Chưa có đề HSKK", "Sang tab “Nạp đề” để sinh đề theo chủ đề bằng Qwen3 hoặc nhập đề JSON.",
      "mic", { label: "Nạp đề", onClick: () => { examView.tab = "load"; renderExamHskk(); } }));
    return;
  }
  const list = el("div", { class: "exam-list" });
  for (const ex of exams) {
    const actions = el("div", { class: "exam-actions" });
    actions.append(el("button", { class: "btn primary", onclick: () => { examView = { screen: "hskk", examId: ex.id, part: "retell", tab: examView.tab }; renderExamHskk(); } }, iconEl("mic"), " Luyện nói"));
    if (!ex.builtin) actions.append(el("button", { class: "btn ghost", onclick: () => { if (confirm("Xóa đề HSKK này?")) { store.deleteUserHskk(ex.id); renderExamHskk(); } } }, "Xóa"));
    list.append(el("div", { class: "panel exam-card" },
      el("div", { class: "exam-head" }, el("h3", {}, ex.title), ex.builtin && el("span", { class: "chip" }, "mẫu")),
      ex.note && el("p", { class: "muted small" }, ex.note),
      actions));
  }
  root.append(list);
}

function hskkGenBar() {
  const topicInput = el("input", { type: "text", placeholder: "Chủ đề (vd: 环境保护, 科技与生活)…" });
  const genBtn = el("button", { class: "btn primary", onclick: doGenHskk }, iconEl("ai"), " Sinh đề HSKK");
  async function doGenHskk() {
    if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để sinh đề HSKK.");
    genBtn.disabled = true; toast("Đang sinh đề HSKK bằng Qwen3… có thể mất một lúc.");
    try {
      const { exam } = await comm.genHskk(topicInput.value.trim());
      const { exam: norm, error } = parseHskkJson(exam);
      if (error) return toast("Đề sinh ra không hợp lệ: " + error);
      store.saveUserHskk(norm);
      toast(`Đã tạo đề HSKK “${norm.title}”.`);
      examView.tab = "choose"; renderExamHskk();
    } catch (e) { toast("Lỗi: " + e.message); }
    finally { genBtn.disabled = false; }
  }
  return el("div", { class: "panel exam-import ai-panel" },
    el("div", { class: "exam-head" }, el("h3", {}, iconEl("ai"), " Sinh đề HSKK ", el("span", { class: "ai-tag" }, "Qwen3"))),
    el("p", { class: "muted small" }, "Nhập chủ đề → Qwen3 soạn đề 3 phần (nghe-kể lại · đọc to · trả lời câu hỏi) kèm pinyin, nghĩa Việt và gợi ý dàn ý."),
    el("div", { class: "row", style: "margin-top:6px" }, topicInput, genBtn));
}

async function examHskk(root) {
  const ex = await getHskk(examView.examId);
  if (!ex) { examView = { screen: "hskklist", tab: examView.tab || "choose" }; return renderExamHskk(); }
  const part = examView.part || "retell";
  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { examView = { screen: "hskklist", tab: examView.tab || "choose" }; renderExamHskk(); } }, "← Danh sách HSKK"),
    el("span", { class: "muted" }, ex.title)));
  const nav = el("div", { class: "hskk-nav" });
  for (const [id, label] of [["retell", "第一部分 · 听后复述"], ["read", "第二部分 · 朗读"], ["answer", "第三部分 · 回答问题"]])
    nav.append(el("button", { class: "comm-chip" + (part === id ? " on" : ""), onclick: () => { examView = { ...examView, part: id }; renderExamHskk(); } }, label));
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
      card.append(el("div", { class: "hskk-big" }, iconEl("headphone")), el("div", { class: "comm-hint muted" }, "Bấm nghe, tự kể lại, rồi “Hiện nguyên văn” để đối chiếu."));
    }
    paintControls();
  }
  function paintControls() {
    controls.innerHTML = "";
    controls.append(el("button", { class: "btn primary", onclick: () => speak(items[i].zh, { rate: s.speechRate }) }, iconEl("speaker"), "Nghe đoạn văn"));
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
  root.append(el("p", { class: "muted small" }, "Đọc to đoạn văn. Bấm Nói để chấm phát âm (so khớp chữ Hán)."));
  const card = el("div", { class: "panel comm-card" });
  card.append(el("div", { class: "hskk-passage" }, r.zh));
  r.vi && card.append(el("details", { class: "comm-personal" }, el("summary", {}, "Xem nghĩa tiếng Việt"), el("p", { class: "meaning", style: "text-align:left" }, r.vi)));
  root.append(card);
  const controls = el("div", { class: "row comm-controls" },
    el("button", { class: "btn", onclick: () => speak(r.zh, { rate: s.speechRate }) }, iconEl("speaker"), "Nghe mẫu"));
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
    if (it.outline_vi) card.append(el("details", { class: "comm-personal" }, el("summary", {}, iconEl("bulb"), "Gợi ý dàn ý"), el("p", { class: "muted small", style: "text-align:left" }, it.outline_vi)));
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
    controls.append(el("span", { class: "row" }, el("b", {}, iconEl("timer")), disp), tBtn);
    if (hasRecognition()) controls.append(micButton(() => items[i].q_zh, s, { score: false }));
    if (items.length > 1) controls.append(el("button", { class: "btn ghost", onclick: () => { i = (i + 1) % items.length; paint(); } }, "Câu sau →"));
  }
  paint();
}

// Sinh đề đọc hiểu từ một đoạn văn bằng Qwen3 (cần backend).
function examGenBar() {
  const ta = el("textarea", { rows: "4", placeholder: "Dán một đoạn văn tiếng Trung để Qwen3 ra đề đọc hiểu…" });
  const nInput = el("input", { type: "number", value: "5", min: "3", max: "10", style: "width:64px" });
  const genBtn = el("button", { class: "btn primary", onclick: doGen }, iconEl("ai"), " Sinh đề");
  async function doGen() {
    const text = ta.value.trim();
    if (text.length < 30) return toast("Dán đoạn văn dài hơn (≥30 ký tự) để ra đề.");
    if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để sinh đề.");
    genBtn.disabled = true; toast("Đang sinh đề bằng Qwen3… có thể mất một lúc.");
    try {
      const { exam, count } = await comm.genExam(text, parseInt(nInput.value, 10) || 5);
      const { exam: norm, error } = parseExamJson(JSON.stringify(exam));
      if (error) return toast("Đề sinh ra không hợp lệ: " + error);
      store.saveUserExam(norm);
      toast(`Đã tạo đề “${norm.title}” · ${count} câu.`);
      examView.tab = "choose"; renderExam();
    } catch (e) { toast("Lỗi: " + e.message); }
    finally { genBtn.disabled = false; }
  }
  return el("details", { class: "panel exam-import ai-panel" },
    el("summary", {}, iconEl("ai"), " Sinh đề từ văn bản ", el("span", { class: "ai-tag" }, "Qwen3")),
    el("p", { class: "muted small" }, "Dán đoạn văn tiếng Trung → Qwen3 soạn câu hỏi đọc hiểu trắc nghiệm (đoạn văn giữ nguyên). Cần bật backend trong Cài đặt."),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" }, el("label", { class: "muted small" }, "Số câu:"), nInput, genBtn),
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
    const wrong = readingState.total - readingState.score;
    const hist = store.getExamProgress(exam.id).readingHistory || [];
    const bestPct = Math.round(hist.reduce((m, h) => Math.max(m, h.total ? h.score / h.total : 0), 0) * 100);
    const bar = el("div", { class: "panel result-bar stack" });
    bar.append(el("div", { class: "row spread" },
      el("b", {}, `Kết quả: ${readingState.score}/${readingState.total} đúng · ${pct}%`),
      el("span", { class: "chip" + (wrong ? " st learning" : " st known") }, wrong ? `Sai ${wrong} câu` : "Đúng hết!")));
    if (hist.length > 1) bar.append(el("span", { class: "muted small" }, `Tốt nhất: ${bestPct}% · đã làm ${hist.length} lần`));
    const acts = el("div", { class: "row" },
      el("button", { class: "btn primary", onclick: () => { readingState = { examId: exam.id, answers: {}, graded: false }; renderExam(); } }, iconEl("replay"), "Làm lại"));
    if (wrong) acts.append(el("button", { class: "btn ghost", onclick: scrollToFirstWrong }, iconEl("eye"), el("span", { class: "btn-tx" }, "Tới câu sai đầu tiên")));
    bar.append(acts);
    if (hist.length > 1) {
      const det = el("details", {}, el("summary", { class: "small" }, `Lịch sử (${hist.length} lần)`));
      const ul = el("ul", { class: "trans-notes" });
      hist.forEach((h) => ul.append(el("li", {}, `${new Date(h.at).toLocaleDateString("vi")} ${new Date(h.at).toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" })} — ${h.score}/${h.total} · ${h.total ? Math.round(h.score / h.total * 100) : 0}%`)));
      det.append(ul); bar.append(det);
    }
    root.append(bar);
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

function explainBox(text) { return el("div", { class: "explain" }, iconEl("bulb"), "" + text); }

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

function scrollToFirstWrong() {
  const w = document.querySelector(".exam-reading .opt.wrong, .exam-reading .blank-sel.bad");
  if (w) w.scrollIntoView({ behavior: "smooth", block: "center" });
  else toast("Không tìm thấy câu sai.");
}

/* ---------- Phần Viết (缩写 — đọc rồi tóm tắt) ---------- */
function countChars(s) { return [...String(s).replace(/\s/g, "")].length; }
function fmtTime(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, "0")}`; }

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

  const gradeBtn = el("button", { class: "btn primary", onclick: () => doGradeWriting() }, iconEl("ai"), "Chấm bằng Qwen3");

  root.append(el("div", { class: "panel" },
    el("div", { class: "row spread" }, el("div", { class: "row" }, el("b", {}, iconEl("timer")), disp, toggleBtn), counter),
    el("div", { class: "field" }, titleInput),
    el("div", { class: "field" }, ta),
    el("div", { class: "row" },
      el("button", { class: "btn", onclick: () => { store.saveWritingDraft(exam.id, { title: titleInput.value, text: ta.value }); toast("Đã lưu bản nháp."); } }, iconEl("save"), "Lưu nháp"),
      gradeBtn,
    ),
    el("p", { class: "muted small" }, "Bản nháp tự lưu vào máy. Bật backend Qwen3 (Cài đặt) để chấm điểm + sửa lỗi tự động."),
  ));

  const gradeHost = el("div", {});
  root.append(gradeHost);
  if (saved.grade) gradeHost.append(writingGradeBox(saved.grade));

  async function doGradeWriting() {
    const text = ta.value.trim();
    if (!text) return toast("Chưa có bài viết để chấm.");
    if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 trong Cài đặt để chấm tự động.");
    gradeBtn.disabled = true; toast("Đang chấm bằng Qwen3… có thể mất một lúc.");
    try {
      const g = await comm.gradeWriting(w.article, titleInput.value, text, target);
      store.saveWritingDraft(exam.id, { title: titleInput.value, text, grade: g });
      gradeHost.innerHTML = ""; gradeHost.append(writingGradeBox(g));
      gradeHost.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) { toast("Lỗi: " + e.message); }
    finally { gradeBtn.disabled = false; }
  }
}

function writingGradeBox(g) {
  const box = el("div", { class: "panel stack ai-panel ai-pop", style: "margin-top:12px" });
  box.append(el("div", { class: "row spread" },
    el("b", {}, iconEl("ai"), " Qwen3 chấm Viết"),
    g.score != null ? el("span", { class: "chip lvl" }, `${g.score}/100`) : null));
  if (g.scores) {
    const L = { noi_dung: "Nội dung", mach_lac: "Mạch lạc", ngu_phap: "Ngữ pháp", dung_tu: "Dùng từ" };
    const row = el("div", { class: "row" });
    for (const k of Object.keys(L)) if (g.scores[k] != null) row.append(el("span", { class: "chip" }, `${L[k]}: ${g.scores[k]}/25`));
    if (row.childNodes.length) box.append(row);
  }
  if (g.corrected) box.append(el("details", {}, el("summary", { class: "small" }, "Bản tóm tắt đã sửa"), el("div", { class: "exam-passage", style: "margin-top:8px" }, g.corrected)));
  if (Array.isArray(g.notes) && g.notes.length) {
    const ul = el("ul", { class: "trans-notes" });
    for (const n of g.notes) ul.append(el("li", {}, n));
    box.append(el("div", {}, el("div", { class: "muted small" }, "Nhận xét:"), ul));
  }
  return box;
}

/* ============================================================
   GIAO TIẾP (luyện phản xạ + phát âm) — js/comm.js + data/comm-scenes.json
   ============================================================ */
let commView = { screen: "home" };
let commTimer = null;            // đồng hồ Sprint
let commRec = null;              // nhận diện giọng nói đang chạy
let commKeyHandler = null;       // phím tắt của drill đang mở
let commSel = { sceneIds: null };// null = tất cả cảnh
let commPersonal = [];           // [{zh, pinyin?, vi?}] từ dán/thư viện (Shadowing)
let commPersonalLabel = "";
let commPersonalQa = [];         // [{q,q_pinyin,q_vi,a,a_pinyin,a_vi}] sinh từ tài liệu (Hỏi–đáp)
let commPersonalQaLabel = "";
let commPersonalPattern = [];    // [{frame,frame_vi,slots}] sinh từ tài liệu (Thay thế mẫu câu)
let commPersonalPatternLabel = "";
let commSrcMode = "scene";       // segmented nguồn câu: "scene" | "material"
let commPersonalVideo = "";      // URL video của tài liệu nguồn (hiện màn hình video khi luyện)
let commPersonalMatId = "";      // id tài liệu nguồn (để lưu tiến độ shadowing)
let commSyncTimer = null;        // interval dò thời gian video để highlight câu
const matVideo = (m) => (m && m.source && m.source.kind === "video" && m.source.url) ? m.source.url : "";

// Tải YouTube IFrame API 1 lần.
let ytApiPromise = null;
function loadYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

// Màn hình video + transcript đồng bộ: bấm câu → tua; video chạy → highlight câu. lines:[{zh,vi,t}].
function shadowVideoSync(root, lines, url) {
  lines = lines.filter((l) => l.t != null).sort((a, b) => a.t - b.t);
  const host = el("div", { class: "video-embed" });
  root.append(host);
  const s = store.getSettings();
  const matId = commPersonalMatId;
  const prog = store.getShadowProgress(matId);
  const list = el("div", { class: "sync-list" });
  let seek = () => {};
  let loopIdx = -1, loopsDone = 0;
  const LOOP_MODES = [["∞", Infinity], ["1×", 1], ["3×", 3], ["5×", 5]];
  let loopMode = 0;
  const loopBtns = [], doneBtns = [], rows = [];

  // Tiến độ câu
  const doneEl = el("span", { class: "chip" });
  const updateDone = () => { const n = lines.filter((_, i) => prog[i]).length; doneEl.textContent = `Đã luyện ${n}/${lines.length}`; };
  const markDone = (i, val = true) => {
    if (val) prog[i] = true; else delete prog[i];
    store.saveShadowProgress(matId, prog);
    rows[i].classList.toggle("done", !!prog[i]);
    doneBtns[i].classList.toggle("ok", !!prog[i]);
    updateDone();
  };
  const toggleLoop = (i) => {
    loopIdx = (loopIdx === i) ? -1 : i; loopsDone = 0;
    loopBtns.forEach((b, k) => b.classList.toggle("on", k === loopIdx));
    if (loopIdx >= 0) seek(lines[loopIdx].t);
  };

  // Toolbar: ẩn chữ · số lần lặp · tiến độ
  const hideBtn = el("button", { class: "btn ghost small", onclick: () => { list.classList.toggle("hide-zh"); hideBtn.classList.toggle("on"); } }, iconEl("eye"), el("span", { class: "btn-tx" }, "Ẩn chữ"));
  const loopModeBtn = el("button", { class: "btn ghost small", title: "Số lần lặp mỗi câu rồi sang câu kế", onclick: () => { loopMode = (loopMode + 1) % LOOP_MODES.length; loopsDone = 0; loopModeBtn.lastChild.textContent = "Lặp " + LOOP_MODES[loopMode][0]; } }, iconEl("replay"), el("span", { class: "btn-tx" }, "Lặp ∞"));
  root.append(el("div", { class: "sync-toolbar" }, hideBtn, loopModeBtn, doneEl));
  root.append(el("p", { class: "muted small", style: "margin:8px 2px 4px" }, "Bấm câu để tua · ↺ lặp 1 câu · Nói để chấm phát âm (≥80% tự đánh dấu đã luyện) · ✓ đánh dấu thủ công."));

  lines.forEach((l, i) => {
    const main = el("div", { class: "sync-main", onclick: () => seek(l.t) },
      el("span", { class: "sync-t mono" }, fmtTime(l.t)),
      el("span", { class: "sync-zh" }, l.zh),
      l.vi ? el("span", { class: "sync-vi muted small" }, l.vi) : null);
    const loopBtn = el("button", { class: "sync-btn", title: "Lặp câu này", onclick: () => toggleLoop(i) }, iconEl("replay"));
    loopBtns.push(loopBtn);
    const doneBtn = el("button", { class: "sync-btn" + (prog[i] ? " ok" : ""), title: "Đánh dấu đã luyện", onclick: () => markDone(i, !prog[i]) }, iconEl("check"));
    doneBtns.push(doneBtn);
    const actions = el("div", { class: "sync-actions" }, loopBtn, doneBtn);
    if (hasRecognition()) actions.append(micButton(() => l.zh, s, { score: true, onScore: (pct) => { if (pct >= 80) markDone(i); } }));
    const row = el("div", { class: "sync-row" + (prog[i] ? " done" : "") }, main, actions);
    rows.push(row);
    list.append(row);
  });
  root.append(list);
  updateDone();

  let getTime = () => 0;
  const yt = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) {
    const mount = el("div", {});
    host.append(mount);
    loadYTApi().then(() => {
      const player = new window.YT.Player(mount, { videoId: yt[1], playerVars: { rel: 0, playsinline: 1 } });
      seek = (t) => { try { player.seekTo(t, true); player.playVideo(); } catch {} };
      getTime = () => { try { return player.getCurrentTime() || 0; } catch { return 0; } };
    });
  } else {
    const v = el("video", { src: url, controls: "" });
    host.append(v);
    seek = (t) => { try { v.currentTime = t; v.play(); } catch {} };
    getTime = () => v.currentTime || 0;
  }

  let active = -1;
  commSyncTimer = setInterval(() => {
    const ct = getTime();
    if (loopIdx >= 0) {
      const start = lines[loopIdx].t;
      const end = (loopIdx + 1 < lines.length) ? lines[loopIdx + 1].t : start + 8;
      if (ct >= end - 0.1) {
        loopsDone++;
        const N = LOOP_MODES[loopMode][1];
        if (N !== Infinity && loopsDone >= N) {
          markDone(loopIdx); loopsDone = 0;
          if (loopIdx + 1 < lines.length) { toggleLoop(loopIdx + 1); } else { toggleLoop(loopIdx); }
        } else { seek(start); }
        return;
      }
      if (ct < start - 0.4) { seek(start); return; }
    }
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].t <= ct + 0.2) idx = i; else break; }
    if (idx !== active) {
      active = idx;
      rows.forEach((r, i) => r.classList.toggle("on", i === idx));
      if (idx >= 0) rows[idx].scrollIntoView({ block: "nearest" });
    }
  }, 300);
}
function videoEmbed(url) {
  if (!url) return null;
  const wrap = el("div", { class: "video-embed" });
  const yt = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) { wrap.append(el("iframe", { src: `https://www.youtube.com/embed/${yt[1]}`, allow: "encrypted-media; picture-in-picture", allowfullscreen: "" })); return wrap; }
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) { wrap.append(el("video", { src: url, controls: "" })); return wrap; }
  return el("p", { class: "muted small", style: "margin-bottom:10px" }, el("a", { class: "lk", href: url, target: "_blank" }, "Mở video nguồn ↗"));
}

function clearCommState() {
  if (commTimer) { clearInterval(commTimer); commTimer = null; }
  if (commSyncTimer) { clearInterval(commSyncTimer); commSyncTimer = null; }
  if (commRec) { try { commRec.abort(); } catch {} commRec = null; }
  commKeyHandler = null;
  stopSpeaking();
}

// phím tắt Giao tiếp (drill tự đăng ký commKeyHandler)
export function handleCommKey(e) {
  if (commKeyHandler) commKeyHandler(e);
}

export async function renderComm() {
  clearCommState();
  const root = clear();
  const scenes = await comm.loadScenes();
  await ensureMaterials();
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
function qaBank(scenes) { const o = []; for (const s of selectedScenes(scenes)) o.push(...(s.qa || [])); o.push(...commPersonalQa); return o; }
function patternBank(scenes) { const o = []; for (const s of selectedScenes(scenes)) o.push(...(s.patterns || [])); o.push(...commPersonalPattern); return o; }

async function commHome(root, scenes) {
  root.append(el("h1", { class: "view-title" }, "Giao tiếp — luyện phản xạ"));
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 14px" }, "Chọn một phương thức — vào trong rồi chọn nguồn câu (tình huống hoặc tài liệu đã nạp)."));
  const nQa = scenes.reduce((n, s) => n + (s.qa ? s.qa.length : 0), 0);
  const nLine = scenes.reduce((n, s) => n + comm.sceneLineBank(s).length, 0);
  const nVi = scenes.reduce((n, s) => n + comm.sceneLineBank(s).filter((x) => x.vi).length, 0);
  const nPat = scenes.reduce((n, s) => n + (s.patterns ? s.patterns.length : 0), 0);
  const grid = el("div", { class: "comm-grid" });
  grid.append(commDrillCard(iconEl("chat"), "Hỏi–đáp tình huống", `${nQa} cặp`, "Nghe câu hỏi → bật câu trả lời trong vài giây.", true, "qa"));
  grid.append(commDrillCard(iconEl("mic"), "Shadowing + Phát âm", `${nLine}+ câu`, "Nghe mẫu → nói lại → chấm phát âm. Luyện được theo tài liệu của bạn.", true, "shadow"));
  grid.append(commDrillCard(iconEl("timer"), "Sprint Việt→Trung", `${nVi} câu`, "Đếm giờ, bật càng nhiều câu càng tốt.", true, "sprint"));
  grid.append(commDrillCard(iconEl("swap"), "Thay thế mẫu câu", `${nPat} mẫu`, "Giữ khung, đổi chỗ trống để nói tự động.", true, "pattern"));
  root.append(grid);

  if (!hasRecognition()) {
    root.append(el("p", { class: "muted small", style: "margin-top:10px" },
      "Trình duyệt này chưa hỗ trợ nhận diện giọng nói (chấm phát âm). Dùng Chrome/Edge để chấm tự động; các kiểu khác vẫn luyện bình thường."));
  }
}

// Thanh nguồn câu: segmented "Tình huống" / "Tài liệu của tôi" → chọn rõ nguồn rồi mới luyện.
function commSourceBar(scenes, opts = {}) {
  const wrap = el("div", { class: "panel comm-source" });
  wrap.append(el("div", { class: "row spread" }, el("b", {}, "Nguồn câu"), el("span", { class: "muted small" }, commSourceSummary(scenes))));
  const clearPersonal = () => { commPersonal = []; commPersonalLabel = ""; commPersonalQa = []; commPersonalQaLabel = ""; commPersonalPattern = []; commPersonalPatternLabel = ""; commPersonalVideo = ""; commPersonalMatId = ""; };

  const seg = el("div", { class: "subtabs", style: "margin:10px 0 6px" });
  const mk = (id, label, icon) => el("button", { class: "subtab" + (commSrcMode === id ? " on" : ""), onclick: () => { commSrcMode = id; renderComm(); } }, iconEl(icon), el("span", {}, " " + label));
  seg.append(mk("scene", "Tình huống", "comm"), mk("material", "Tài liệu của tôi", "ingest"));
  wrap.append(seg);

  if (commSrcMode === "scene") {
    const chips = el("div", { class: "comm-chips" });
    const allOn = !commSel.sceneIds && !commPersonal.length && !commPersonalQa.length && !commPersonalPattern.length;
    chips.append(commChip("Tất cả tình huống", allOn, () => { clearPersonal(); commSel.sceneIds = null; renderComm(); }));
    for (const s of scenes) {
      const on = !commPersonal.length && !commPersonalQa.length && !commPersonalPattern.length && commSel.sceneIds && commSel.sceneIds.includes(s.id);
      chips.append(commChip([iconEl(sceneIconName(s)), el("span", {}, " " + s.title)], on, () => { clearPersonal(); toggleScene(s.id, scenes); }));
    }
    wrap.append(chips);
    return wrap;
  }

  // commSrcMode === "material"
  if (opts.genPattern) {
    genFromMaterialSection(wrap, "Chọn tài liệu để sinh mẫu câu (cần Qwen3):", commPersonalPatternLabel, async (zh, title) => {
      const { patterns } = await comm.genPattern(zh.map((x) => x.zh).join(" "), 6);
      if (!patterns || !patterns.length) { toast("Không sinh được mẫu câu."); return false; }
      commPersonal = []; commPersonalLabel = ""; commPersonalQa = []; commPersonalQaLabel = "";
      commPersonalPattern = patterns; commPersonalPatternLabel = title;
      commSel.sceneIds = [];
      toast(`Đã sinh ${patterns.length} mẫu câu từ “${title}”.`);
      return true;
    });
  } else if (opts.genQa) {
    genFromMaterialSection(wrap, "Chọn tài liệu để sinh Hỏi–đáp (cần Qwen3):", commPersonalQaLabel, async (zh, title) => {
      const { pairs } = await comm.genQa(zh.map((x) => x.zh).join(" "), 8);
      if (!pairs || !pairs.length) { toast("Không sinh được câu hỏi."); return false; }
      commPersonal = []; commPersonalLabel = ""; commPersonalPattern = []; commPersonalPatternLabel = "";
      commPersonalQa = pairs; commPersonalQaLabel = title;
      commSel.sceneIds = [];
      toast(`Đã sinh ${pairs.length} cặp hỏi–đáp từ “${title}”.`);
      return true;
    });
  } else if (opts.material) {
    const usable = materialList.map((m) => ({ m, zh: materialZh(m) })).filter((x) => x.zh.length);
    if (usable.length) {
      const mat = el("div", { class: "comm-chips" });
      for (const { m, zh } of usable) {
        const on = commPersonalLabel === m.title;
        const vid = matVideo(m);
        mat.append(commChip([vid ? iconEl("video") : null, el("span", {}, `${m.title} (${zh.length})`)], on, () => { commSel.sceneIds = []; commPersonalMatId = m.id; setPersonalSource(zh.map((x) => ({ zh: x.zh, vi: x.vi, t: x.t })), m.title, vid); }));
      }
      wrap.append(el("div", { class: "muted small", style: "margin-top:4px" }, opts.materialHint || "Chọn tài liệu đã nạp:"), mat);
    } else {
      wrap.append(commNoMaterial());
    }
  }
  return wrap;
}
function commNoMaterial() {
  return el("p", { class: "muted small", style: "margin-top:6px" }, "Chưa có tài liệu — vào ", el("a", { class: "lk", onclick: () => navigate("ingest") }, "Nạp tài liệu"), " để luyện theo truyện của bạn.");
}

// Mục "sinh nội dung từ tài liệu" (Hỏi–đáp / Mẫu câu). doGen(zh, title) async → trả truthy nếu thành công.
function genFromMaterialSection(wrap, label, activeLabel, doGen) {
  const usable = materialList.map((m) => ({ m, zh: materialZh(m) })).filter((x) => x.zh.length);
  if (!usable.length) {
    wrap.append(el("p", { class: "muted small", style: "margin-top:6px" }, "Chưa có tài liệu — vào Nạp tài liệu để sinh từ truyện của bạn (cần Qwen3)."));
    return;
  }
  const mat = el("div", { class: "comm-chips" });
  for (const { m, zh } of usable) {
    const chip = commChip(m.title, activeLabel === m.title, async () => {
      if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để sinh nội dung.");
      chip.disabled = true; toast("Đang sinh bằng Qwen3… có thể mất một lúc.");
      try { if (await doGen(zh, m.title)) { commPersonalVideo = matVideo(m); renderComm(); } }
      catch (e) { toast("Lỗi: " + e.message); }
      finally { chip.disabled = false; }
    });
    mat.append(chip);
  }
  wrap.append(el("div", { class: "muted small", style: "margin-top:8px" }, label), mat);
}
function commEmptyNote(kind) { return el("p", { class: "muted center", style: "padding:24px" }, `Nguồn đang chọn chưa có ${kind}. Chọn nguồn khác ở thanh trên.`); }

function commChip(content, on, onclick) {
  const btn = el("button", { class: "comm-chip" + (on ? " on" : ""), onclick });
  if (Array.isArray(content)) btn.append(...content.filter((x) => x != null)); else btn.append(content);
  return btn;
}
const SCENE_ICONS = new Set(["restaurant", "shopping", "directions", "hospital", "intro", "work"]);
const sceneIconName = (s) => (SCENE_ICONS.has(s.id) ? s.id : "chat");
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
  const q = commPersonalQa.length ? ` · ${commPersonalQa.length} hỏi–đáp (${commPersonalQaLabel})` : "";
  const pt = commPersonalPattern.length ? ` · ${commPersonalPattern.length} mẫu câu (${commPersonalPatternLabel})` : "";
  return `${sc} cảnh${p}${q}${pt}`;
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

/* ---------- Hub kiểu Giao tiếp: lưới thẻ chọn mục con ---------- */
function navCard(iconName, title, badge, desc, view) {
  return el("button", { class: "comm-drill", onclick: () => navigate(view) },
    el("div", { class: "comm-drill-ic" }, iconEl(iconName)),
    el("div", { class: "comm-drill-body" },
      el("div", { class: "comm-drill-title" }, title, badge != null ? el("span", { class: "chip" }, badge) : null),
      el("div", { class: "muted small" }, desc)));
}
function hubBack(label, view) {
  return el("div", { class: "exam-topbar" }, el("button", { class: "btn ghost", onclick: () => navigate(view) }, "← " + label));
}

export async function renderVocabHub() {
  clearCommState();
  const root = clear();
  root.append(el("h1", { class: "view-title" }, "Từ vựng"));
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 14px" }, "Chọn cách quản lý & học từ vựng."));
  const deck = await getDeck(store.getSettings().activeDeckId);
  const total = deck ? deck.cards.length : 0;
  const sets = store.getWordSets().length;
  const grid = el("div", { class: "comm-grid" });
  grid.append(navCard("folder", "Thư mục", `${total} từ`, "Duyệt theo cấp HSK / nhóm nghĩa / tài liệu, tick chọn để học ngay hoặc lưu thành bộ.", "vocab"));
  grid.append(navCard("cards", "Bộ của tôi", `${sets} bộ`, "Học các bộ từ đã lưu bằng Flashcard · Quiz · Gõ pinyin · Nghe.", "wordsets"));
  grid.append(navCard("book", "Nguồn từ", null, "Quản lý bộ thẻ nguồn: chọn deck, nhập CSV.", "manage"));
  root.append(grid);
}

export async function renderExamHub() {
  clearCommState();
  revokeViewerUrl();
  const root = clear();
  root.append(el("h1", { class: "view-title" }, "Luyện đề"));
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 14px" }, "Chọn loại đề để luyện."));
  const hsk = (await getAllExams()).length;
  const hskk = (await getHskkExams()).length;
  const grid = el("div", { class: "comm-grid" });
  grid.append(navCard("exam", "HSK", `${hsk} đề`, "Đọc hiểu trắc nghiệm tự chấm + Viết 缩写. Sinh đề bằng Qwen3 hoặc tải kho đề.", "exam"));
  grid.append(navCard("mic", "HSKK 高级", `${hskk} đề`, "Thi nói: nghe-kể lại · đọc to · trả lời câu hỏi. Sinh đề theo chủ đề.", "examHskk"));
  root.append(grid);
}

export async function renderTradHub() {
  clearCommState();
  const root = clear();
  root.append(el("h1", { class: "view-title" }, "Phồn thể 繁"));
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 14px" }, "Học đọc chữ phồn thể (繁→简)."));
  const pairs = await tradPairs();
  const sets = store.getTradSets().length;
  const grid = el("div", { class: "comm-grid" });
  grid.append(navCard("play", "Lộ trình", "3 bước", "Hướng dẫn người mới: bộ thủ → thẻ nhớ → quiz, có tiến độ.", "tradHome"));
  grid.append(navCard("folder", "Thư mục", `${pairs.length} chữ`, "Duyệt chữ phồn thể theo cấp HSK, tick chọn để học hoặc lưu thành bộ.", "tradFolder"));
  grid.append(navCard("cards", "Bộ của tôi", `${sets} bộ`, "Học các bộ chữ đã lưu bằng Thẻ nhớ / Quiz.", "tradSets"));
  grid.append(navCard("trad", "Bộ thủ", null, "Quy luật thành phần Giản↔Phồn để đoán & đọc chữ nhanh.", "tradRules"));
  root.append(grid);
}

// Backend có xử lý được loại file này không (theo năng lực /health).
function setPersonalSource(items, label, video = "") {
  commPersonal = items; commPersonalLabel = label; commPersonalVideo = video || "";
  toast(`Đã thêm ${items.length} câu vào nguồn.`);
  renderComm();
}


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
function micButton(getTarget, s, { score = true, onScore = null } = {}) {
  const btn = el("button", { class: "btn" });
  const setMic = (txt, rec = false) => { btn.classList.toggle("rec", rec); btn.replaceChildren(iconEl("mic"), el("span", { class: "btn-tx" }, txt)); };
  setMic("Nói");
  const out = el("span", { class: "comm-mic-out small" });
  btn.onclick = () => {
    if (commRec) { try { commRec.abort(); } catch {} commRec = null; setMic("Nói"); return; }
    setMic("Đang nghe…", true); out.textContent = "";
    commRec = recognizeChinese({
      onResult: (txt) => {
        out.innerHTML = "";
        if (score) {
          const { pct, marks } = scorePronun(getTarget(), txt);
          out.append(el("b", { class: pct >= 80 ? "ok" : pct >= 50 ? "" : "bad" }, `${pct}% `), pronunMarks(marks),
            el("span", { class: "muted" }, ` · bạn nói: ${txt || "(không rõ)"}`));
          if (onScore) onScore(pct);
        } else {
          out.append(el("span", { class: "muted" }, "Bạn nói: "), el("b", {}, txt || "(không rõ)"));
        }
      },
      onError: (err) => { out.textContent = err === "unsupported" ? "Trình duyệt không hỗ trợ micro." : "Lỗi micro: " + err; },
      onEnd: () => { commRec = null; setMic("Nói"); },
    });
  };
  return el("span", { class: "comm-mic" }, btn, out);
}

function commTopbar(title) {
  return el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { commView = { screen: "home" }; renderComm(); } }, "← Giao tiếp"),
    el("span", { class: "muted" }, title));
}

// Cổng "chọn nguồn trước": hiện thanh nguồn + nút Bắt đầu; chỉ vào luyện khi đã chọn xong.
function commIntro(root, scenes, { title, opts, count, unit }) {
  root.append(commTopbar(title));
  root.append(commSourceBar(scenes, opts));
  root.append(el("div", { class: "panel center stack" },
    el("div", { class: count > 0 ? "" : "muted" }, count > 0 ? `Nguồn đang chọn: ${count} ${unit}` : `Nguồn đang chọn chưa có ${unit} — chọn nguồn khác ở trên.`),
    count > 0 ? el("button", { class: "btn primary big", onclick: () => { commView.started = true; renderComm(); } }, iconEl("play"), el("span", { class: "btn-tx" }, "Bắt đầu luyện")) : null));
}

/* ---------- Drill: Hỏi–đáp tình huống ---------- */
function commDrillQA(root, scenes) {
  const s = store.getSettings();
  if (!commView.started) return commIntro(root, scenes, { title: "Hỏi–đáp tình huống", opts: { genQa: true }, count: qaBank(scenes).length, unit: "cặp hỏi–đáp" });
  root.append(commTopbar("Hỏi–đáp tình huống"));
  root.append(commSourceBar(scenes, { genQa: true }));
  const bank = shuffle(qaBank(scenes).slice());
  if (!bank.length) { root.append(commEmptyNote("cặp hỏi–đáp")); return; }
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
    controls.append(el("button", { class: "btn", onclick: () => speak(cur().q, { rate: s.speechRate }) }, iconEl("replay"), "Nghe câu hỏi"));
    if (hasRecognition()) controls.append(micButton(() => cur().a, s));
    if (!revealed) controls.append(el("button", { class: "btn", onclick: reveal }, iconEl("bulb"), "Gợi ý đáp án"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp theo →"));
  }
  paint();
}

/* ---------- Drill: Shadowing + Phát âm ---------- */
function commDrillShadow(root, scenes) {
  const s = store.getSettings();
  if (!commView.started) return commIntro(root, scenes, { title: "Shadowing + Phát âm", opts: { material: true }, count: lineBank(scenes).length, unit: "câu" });
  root.append(commTopbar("Shadowing + Phát âm"));
  root.append(commSourceBar(scenes, { material: true }));
  if (commPersonalVideo) {
    const timed = lineBank(scenes).filter((l) => l.t != null);
    if (timed.length) { shadowVideoSync(root, timed, commPersonalVideo); return; }
    root.append(videoEmbed(commPersonalVideo));
  }
  const bank = shuffle(lineBank(scenes).slice());
  if (!bank.length) { root.append(commEmptyNote("câu để luyện")); return; }
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
    controls.append(el("button", { class: "btn", onclick: speakCur }, iconEl("replay"), "Nghe mẫu"));
    if (hasRecognition()) controls.append(micButton(() => cur().zh, s));
    controls.append(el("button", { class: "btn", onclick: () => { showAid = true; renderBody(); } }, iconEl("eye"), "Hiện"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp →"));
  }
  commKeyHandler = (e) => {
    if (e.code === "Space") { e.preventDefault(); speakCur(); }
    else if (e.code === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "e" || e.key === "E") { e.preventDefault(); showAid = true; renderBody(); }
  };
  root.append(el("p", { class: "muted small" }, "Phím tắt: Space = Nghe mẫu · → = Tiếp · E = Hiện"));
  renderBody(); speakCur(); paintControls();
}

/* ---------- Drill: Sprint Việt→Trung (đếm giờ) ---------- */
function commDrillSprint(root, scenes) {
  const s = store.getSettings();
  root.append(commTopbar("Sprint Việt→Trung"));
  root.append(commSourceBar(scenes, { material: true, materialHint: "Hoặc theo tài liệu đã nạp (cần đã “Dịch tham khảo” để có câu Việt):" }));
  const bank = viLineBank(scenes);
  if (!bank.length) { root.append(commEmptyNote("câu song ngữ (Việt–Trung) — hãy dịch tham khảo tài liệu, hoặc chọn tình huống")); return; }
  const panel = el("div", { class: "panel comm-card" });
  root.append(panel);
  let dur = 60;

  function showSetup() {
    clearCommState();
    panel.innerHTML = "";
    panel.append(el("p", {}, "Đọc nghĩa tiếng Việt rồi bật ngay câu tiếng Trung. Mỗi câu bật được bấm “Được”. Cố vượt kỷ lục của bạn!"));
    const sel = el("div", { class: "row" });
    [30, 60, 90].forEach((d) => sel.append(el("button", { class: "btn" + (d === dur ? " primary" : ""), onclick: () => { dur = d; showSetup(); } }, d + "s")));
    panel.append(el("div", { class: "field" }, el("label", { class: "muted small" }, "Thời lượng"), sel));
    const best = (store.getCommRecords().sprintBest || {})[dur] || 0;
    panel.append(el("p", { class: "muted small" }, best ? `Kỷ lục ${dur}s: ${best} câu` : `Chưa có kỷ lục ${dur}s — lập ngay!`));
    panel.append(el("button", { class: "btn primary big", onclick: start }, iconEl("play"), "Bắt đầu"));
    panel.append(el("p", { class: "muted small", style: "margin-top:8px" }, "Phím tắt: Space = Hiện · Enter = Được · Backspace = Bỏ qua"));
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
    panel.append(el("div", { class: "row spread" }, el("div", { class: "row" }, el("b", {}, iconEl("timer")), timerEl), el("div", {}, "Đã bật: ", scoreEl)));
    panel.append(body);
    panel.append(el("div", { class: "row comm-controls" },
      el("button", { class: "btn", onclick: reveal }, iconEl("eye"), "Hiện"),
      el("button", { class: "btn ghost", onclick: () => adv(false) }, "Bỏ qua"),
      el("button", { class: "btn primary", onclick: () => adv(true) }, iconEl("check"), "Được")));
    paint();
    commKeyHandler = (e) => {
      if (e.code === "Space") { e.preventDefault(); reveal(); }
      else if (e.code === "Enter") { e.preventDefault(); adv(true); }
      else if (e.code === "Backspace") { e.preventDefault(); adv(false); }
    };
    commTimer = setInterval(() => {
      remain--; timerEl.textContent = fmtTime(Math.max(0, remain));
      if (remain <= 0) { clearCommState(); finish(score); }
    }, 1000);
  }
  function finish(score) {
    const { best, isNew } = store.saveSprintBest(dur, score);
    panel.innerHTML = "";
    panel.append(el("div", { class: "comm-result" },
      el("div", { class: "big" }, iconEl(isNew ? "check" : "timer")),
      el("h2", {}, `Bật được ${score} câu trong ${dur}s`),
      el("p", { class: isNew ? "" : "muted" }, isNew ? "Kỷ lục mới!" : `Kỷ lục ${dur}s: ${best} câu`),
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: showSetup }, iconEl("replay"), "Làm lại"),
        el("button", { class: "btn", onclick: () => { commView = { screen: "home" }; renderComm(); } }, "Về Giao tiếp"))));
  }
  showSetup();
}

/* ---------- Drill: Thay thế mẫu câu (句型替换) ---------- */
function commDrillPattern(root, scenes) {
  const s = store.getSettings();
  if (!commView.started) return commIntro(root, scenes, { title: "Thay thế mẫu câu", opts: { genPattern: true }, count: patternBank(scenes).length, unit: "mẫu câu" });
  root.append(commTopbar("Thay thế mẫu câu"));
  root.append(commSourceBar(scenes, { genPattern: true }));
  if (commPersonalVideo) root.append(videoEmbed(commPersonalVideo));
  const bank = patternBank(scenes);
  if (!bank.length) { root.append(commEmptyNote("mẫu câu")); return; }
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
    if (!revealed) controls.append(el("button", { class: "btn", onclick: reveal }, iconEl("bulb"), "Đáp án"));
    else controls.append(el("button", { class: "btn", onclick: () => speak(comm.fillFrame(curP().frame, curS().zh), { rate: s.speechRate }) }, iconEl("speaker"), "Nghe"));
    controls.append(el("button", { class: "btn primary", onclick: next }, "Tiếp →"));
  }
  renderBody(); paintControls();
}

/* ============================================================
   DỊCH THUẬT (Trung↔Việt + Qwen3 chấm) — store.translations
   ============================================================ */
let transView = { screen: "home" };
let transMode = "stories";        // "stories" (thư mục truyện) | "free" (luyện tự do)
let transDraft = newTransDraft();
let transTask = null;             // { materialId, dir, key, label, idxs:[...], pos }
function newTransDraft(dir = "zh2vi") {
  return { id: null, dir, source: "", sourcePinyin: "", user: "", ref: "", refPinyin: "", grade: null, createdAt: null };
}

export async function renderTrans() {
  clearCommState();
  await ensureMaterials();
  const root = clear();
  if (transView.screen === "saved") return transSaved(root);
  if (transView.screen === "story") return transStory(root);
  if (transView.screen === "task") return transTaskRunner(root);
  return transHome(root);
}

// Mở task runner cho 1 khúc của tài liệu.
function openTransTask(materialId, chunk) {
  transTask = { materialId, dir: chunk.dir, key: chunk.key, label: chunk.label, idxs: chunk.idxs.slice(), pos: 0 };
  // nhảy tới câu CHƯA dịch đầu tiên trong khúc
  const m = materialList.find((x) => x.id === materialId);
  if (m) {
    const saved = new Set(store.getTranslations().map((t) => t.source));
    const undone = transTask.idxs.findIndex((id) => !saved.has((m.sentences[id] || {})[chunk.key]));
    transTask.pos = undone >= 0 ? undone : 0;
  }
  transView = { screen: "task" };
  navigate("trans");
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
  root.append(el("h1", { class: "view-title" }, "Dịch thuật"));

  const modeRow = el("div", { class: "comm-chips" });
  modeRow.append(commChip("Theo truyện", transMode === "stories", () => { transMode = "stories"; renderTrans(); }));
  modeRow.append(commChip("Luyện tự do", transMode === "free", () => { transMode = "free"; renderTrans(); }));
  root.append(modeRow);

  root.append(el("div", { class: "row", style: "justify-content:flex-end;margin-top:-4px" },
    el("button", { class: "btn ghost small", onclick: () => { transView = { screen: "saved" }; renderTrans(); } }, iconEl("book"), el("span", { class: "btn-tx" }, `Bài đã dịch (${store.getTranslations().length})`))));

  if (transMode === "stories") return transStoriesList(root);
  return transFreeWorkspace(root);
}

// ----- Chế độ "Theo truyện": thư mục tài liệu có thể dịch -----
function transStoriesList(root) {
  const stories = materialList.map((m) => ({ m, chunks: storyChunks(m) })).filter((x) => x.chunks.length);
  if (!stories.length) {
    root.append(emptyState("Chưa có truyện để dịch", "Vào Nạp tài liệu, dán truyện / phụ đề tiếng Trung (hoặc Việt) để tạo thư mục dịch theo chương."));
    return;
  }
  const list = el("div", { class: "story-list" });
  for (const { m, chunks } of stories) {
    const total = chunks.reduce((s, c) => s + c.total, 0);
    const done = chunks.reduce((s, c) => s + c.done, 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    list.append(el("button", { class: "story-card", onclick: () => { transView = { screen: "story", materialId: m.id }; renderTrans(); } },
      el("div", { class: "row spread" },
        el("span", { class: "story-title" }, m.title || "(không tên)"),
        el("span", { class: "chip" + (done >= total ? " st known" : "") }, m.lang === "zh" ? "中→Việt" : "Việt→中")),
      el("div", { class: "story-meta muted small" }, `${chunks.length} khúc · ${total} câu · ${done}/${total} đã dịch`),
      el("div", { class: "story-prog" }, el("span", { style: `width:${pct}%` })),
    ));
  }
  root.append(list);
}

// ----- Chi tiết truyện: danh sách khúc (chương → phần) + tiến độ -----
function transStory(root) {
  const m = materialList.find((x) => x.id === transView.materialId);
  if (!m) { transView = { screen: "home" }; return transHome(root); }
  const chunks = storyChunks(m);
  const total = chunks.reduce((s, c) => s + c.total, 0);
  const done = chunks.reduce((s, c) => s + c.done, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { transView = { screen: "home" }; renderTrans(); } }, "← Thư mục truyện"),
    el("span", { class: "muted" }, `${done}/${total} câu`)));
  root.append(el("h1", { class: "view-title" }, m.title || "(không tên)"));
  root.append(el("div", { class: "story-prog big" }, el("span", { style: `width:${pct}%` })));

  const wrap = el("div", { class: "stack", style: "margin-top:14px" });
  chunks.forEach((c, i) => {
    const full = c.done >= c.total;
    wrap.append(el("div", { class: "lesson-task" },
      el("div", { class: "row spread" },
        el("span", {}, `Khúc ${i + 1}${c.label && c.label !== "Cả bài" ? " · " + c.label : ""}`),
        el("span", { class: "chip" + (full ? " st known" : "") }, `${c.done}/${c.total}`)),
      el("div", { class: "row" },
        el("button", { class: "btn small primary", onclick: () => openTransTask(m.id, c) }, full ? "Ôn lại" : (c.done ? "Tiếp tục" : "Bắt đầu")))));
  });
  root.append(wrap);
}

// ----- Task runner: dịch từng câu trong 1 khúc, có tiến độ + tự sang câu kế -----
async function transTaskRunner(root) {
  const s = store.getSettings();
  const backend = await comm.pingBackend();
  const m = materialList.find((x) => x.id === transTask.materialId);
  if (!m || !transTask.idxs.length) { transView = { screen: "home" }; return transHome(root); }
  const { key, dir, idxs } = transTask;
  const srcIsZh = dir === "zh2vi";
  const saved = new Set(store.getTranslations().map((t) => t.source));
  const doneCount = idxs.filter((id) => saved.has((m.sentences[id] || {})[key])).length;

  transTask.pos = Math.max(0, Math.min(transTask.pos, idxs.length - 1));
  const sent = m.sentences[idxs[transTask.pos]] || {};
  const source = sent[key] || "";
  // đồng bộ draft với câu hiện tại (nếu đổi câu)
  if (transDraft.source !== source) {
    const existing = store.getTranslations().find((t) => t.source === source);
    transDraft = newTransDraft(dir);
    transDraft.source = source;
    if (srcIsZh && sent.pinyin) transDraft.sourcePinyin = sent.pinyin;
    if (existing) { transDraft.id = existing.id; transDraft.user = existing.user || ""; transDraft.grade = existing.grade || null; transDraft.createdAt = existing.createdAt; }
  }

  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { transView = { screen: "story", materialId: m.id }; transDraft = newTransDraft(dir); renderTrans(); } }, "← " + (m.title || "Truyện")),
    el("span", { class: "muted" }, `Khúc: ${transTask.label && transTask.label !== "Cả bài" ? transTask.label : "cả bài"} · ${doneCount}/${idxs.length}`)));

  const pct = idxs.length ? Math.round((doneCount / idxs.length) * 100) : 0;
  root.append(el("div", { class: "story-prog" }, el("span", { style: `width:${pct}%` })));

  // điều hướng câu
  const nav = el("div", { class: "row spread", style: "margin-top:10px" },
    el("button", { class: "btn ghost small", disabled: transTask.pos === 0, onclick: () => { transTask.pos--; transDraft = newTransDraft(dir); renderTrans(); } }, "‹ Câu trước"),
    el("span", { class: "muted small" }, `Câu ${transTask.pos + 1}/${idxs.length}` + (saved.has(source) ? " · đã dịch" : "")),
    el("button", { class: "btn ghost small", disabled: transTask.pos >= idxs.length - 1, onclick: () => { transTask.pos++; transDraft = newTransDraft(dir); renderTrans(); } }, "Câu sau ›"));
  root.append(nav);

  // nguồn
  const srcBtns = el("div", { class: "row" });
  if (srcIsZh) srcBtns.append(el("button", { class: "btn", onclick: () => source && speak(source, { rate: s.speechRate }) }, iconEl("speaker"), "Nghe"));
  root.append(el("div", { class: "panel stack" },
    el("b", {}, srcIsZh ? "Nguồn · 中文" : "Nguồn · Tiếng Việt"),
    transDraft.sourcePinyin && el("div", { class: "pinyin", style: "text-align:left" }, transDraft.sourcePinyin),
    el("div", { class: srcIsZh ? "hanzi-line" : "meaning", style: "text-align:left;font-size:18px" }, source),
    srcIsZh && sent.vi ? el("details", { class: "comm-personal" }, el("summary", {}, iconEl("bulb"), " Bản tham khảo (Qwen3)"), el("p", { class: "meaning", style: "text-align:left" }, sent.vi)) : null,
    srcBtns.childNodes.length ? srcBtns : null));

  // bản dịch người dùng
  const userTa = el("textarea", { rows: "3", placeholder: srcIsZh ? "Bản dịch tiếng Việt của bạn…" : "你的中文翻译…" });
  userTa.value = transDraft.user;
  userTa.addEventListener("input", () => { transDraft.user = userTa.value; });
  root.append(el("div", { class: "panel stack" }, el("b", {}, "Bản dịch của bạn"), el("div", { class: "field" }, userTa)));

  // hành động: Lưu & câu kế / chấm Qwen3
  const saveNext = () => {
    const rec = saveTransDraft(true);
    if (!rec) { toast("Chưa có gì để lưu."); return; }
    toast("Đã lưu.");
    const after = new Set(store.getTranslations().map((t) => t.source));
    const nextUndone = idxs.findIndex((id, n) => n > transTask.pos && !after.has((m.sentences[id] || {})[key]));
    const anyUndone = idxs.findIndex((id) => !after.has((m.sentences[id] || {})[key]));
    if (nextUndone >= 0) transTask.pos = nextUndone;
    else if (anyUndone >= 0) transTask.pos = anyUndone;
    else { toast("Đã dịch xong cả khúc!"); transView = { screen: "story", materialId: m.id }; transDraft = newTransDraft(dir); return renderTrans(); }
    transDraft = newTransDraft(dir);
    renderTrans();
  };
  const actions = el("div", { class: "row", style: "margin-top:4px" });
  actions.append(el("button", { class: "btn primary", onclick: saveNext }, iconEl("save"), el("span", { class: "btn-tx" }, "Lưu & câu kế")));
  if (backend) actions.append(el("button", { class: "btn", onclick: gradeTransDraft }, iconEl("ai"), "Chấm & sửa (Qwen3)"));
  root.append(actions);

  if (transDraft.grade) root.append(transGradeBox(transDraft.grade, srcIsZh));
  if (!backend) root.append(el("p", { class: "muted small", style: "margin-top:10px" }, "Dịch xong bấm Lưu để tự sang câu kế. Bật Qwen3 (Cài đặt) để được chấm điểm + sửa lỗi."));
}

// ----- Chế độ "Luyện tự do": workspace phẳng (dán / câu mẫu) -----
function transFreeWorkspace(root) {
  const s = store.getSettings();
  const dirRow = el("div", { class: "comm-chips" });
  const setDir = (d) => { if (transDraft.dir !== d) transDraft = newTransDraft(d); renderTrans(); };
  dirRow.append(commChip("中文 → Tiếng Việt", transDraft.dir === "zh2vi", () => setDir("zh2vi")));
  dirRow.append(commChip("Tiếng Việt → 中文", transDraft.dir === "vi2zh", () => setDir("vi2zh")));
  root.append(dirRow);

  const srcIsZh = transDraft.dir === "zh2vi";
  return transWorkspaceBody(root, s, srcIsZh);
}

async function transWorkspaceBody(root, s, srcIsZh) {
  const backend = await comm.pingBackend();

  const srcTa = el("textarea", { rows: "3", placeholder: srcIsZh ? "Văn bản tiếng Trung cần dịch…" : "Văn bản tiếng Việt cần dịch…" });
  srcTa.value = transDraft.source;
  srcTa.addEventListener("input", () => { transDraft.source = srcTa.value; });
  const srcBtns = el("div", { class: "row" },
    el("button", { class: "btn", onclick: async () => {
      const ex = await randomExample(transDraft.dir);
      if (!ex) return toast("Không lấy được câu mẫu.");
      Object.assign(transDraft, { source: ex.source, sourcePinyin: ex.sourcePinyin || "", ref: ex.ref || "", refPinyin: ex.refPinyin || "", grade: null });
      renderTrans();
    } }, iconEl("dice"), "Câu mẫu từ thẻ"));
  if (srcIsZh) srcBtns.append(el("button", { class: "btn", onclick: () => transDraft.source && speak(transDraft.source, { rate: s.speechRate }) }, iconEl("speaker"), "Nghe"));
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
      el("summary", {}, iconEl("eye"), "Xem bản tham khảo (câu mẫu)"),
      el("div", { class: srcIsZh ? "meaning" : "hanzi-line", style: "text-align:left" }, transDraft.ref),
      transDraft.refPinyin && el("div", { class: "pinyin", style: "text-align:left" }, transDraft.refPinyin)));
  }

  const actions = el("div", { class: "row", style: "margin-top:4px" });
  actions.append(el("button", { class: "btn", onclick: () => saveTransDraft(false) }, iconEl("save"), "Lưu"));
  if (backend) actions.append(el("button", { class: "btn primary", onclick: gradeTransDraft }, iconEl("ai"), "Chấm & sửa (Qwen3)"));
  else actions.append(el("button", { class: "btn", onclick: () => toast("Bật backend Qwen3 trong Cài đặt để chấm tự động.") }, iconEl("ai"), "Chấm (cần Qwen3)"));
  actions.append(el("button", { class: "btn ghost", onclick: () => { transDraft = newTransDraft(transDraft.dir); renderTrans(); } }, iconEl("reset"), "Mới"));
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
  const box = el("div", { class: "panel stack ai-panel ai-pop", style: "margin-top:12px" });
  box.append(el("div", { class: "row spread" }, el("b", {}, iconEl("ai"), " Qwen3 chấm"), g.score != null ? el("span", { class: "chip lvl" }, `Điểm: ${g.score}/10`) : null));
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
  if (!list.length) { root.append(emptyState("Chưa có bài dịch", "Dịch một câu rồi bấm Lưu.")); return; }
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
        srcIsZh ? el("button", { class: "btn small", onclick: () => speak(t.source, { rate: s.speechRate }) }, iconEl("speaker")) : null,
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
   NẠP TÀI LIỆU (cửa nạp duy nhất → Tài liệu) — js/lessons.js
   ============================================================ */
let ingestView = { screen: "new", lessonId: null };
const LV_LABEL = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4", 5: "HSK 5", 6: "HSK 6" };

// Cache tài liệu đã nạp — dùng chung cho bộ chọn ở Từ vựng / Giao tiếp / Dịch thuật.
let materialList = [];       // [{id,title,lang,vocab,sentences,chapters,manual}]
let materialCardIds = {};    // id → Set(cardId) để lọc Từ vựng
let materialsLoaded = false;
async function ensureMaterials() {
  if (materialsLoaded) return;
  try { materialList = await lessons.listMaterials(); } catch { materialList = []; }
  materialCardIds = {};
  for (const l of materialList) materialCardIds[l.id] = new Set((l.vocab || []).filter((v) => v.cardId).map((v) => v.cardId));
  materialsLoaded = true;
}
function invalidateMaterials() { materialsLoaded = false; }
const materialZh = (m) => (m.sentences || []).filter((s) => !s.chapter && s.zh);

export async function renderIngest() {
  clearCommState();
  const root = clear();
  if (ingestView.screen === "lesson") return ingestLesson(root);
  if (ingestView.screen === "library") return ingestLibrary(root);
  return ingestNew(root);
}

function ingestNav(active) {
  return el("div", { class: "comm-chips" },
    commChip("Nạp mới", active === "new", () => { ingestView = { screen: "new" }; renderIngest(); }),
    commChip("Thư viện tài liệu", active === "library", () => { ingestView = { screen: "library" }; renderIngest(); }));
}

function splitVi(text) {
  return String(text).replace(/\r/g, "").split(/(?<=[.!?…\n])/).map((s) => s.trim()).filter((s) => s.length > 1);
}

async function ingestNew(root) {
  root.append(el("h1", { class: "view-title" }, "Nạp tài liệu"));
  root.append(ingestNav("new"));
  const titleInput = el("input", { type: "text", placeholder: "Tên tài liệu (tùy chọn)" });
  const ta = el("textarea", { rows: "7", placeholder: "Dán truyện / bài viết / phụ đề tiếng Trung (hoặc văn bản tiếng Việt)…" });
  const fileInput = el("input", { type: "file", accept: ".txt,.srt,.lrc" });
  fileInput.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ta.value = await f.text();
    if (!titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, "");
  });
  let pendingSource = null, pendingSegments = null; // nguồn link + mốc thời gian (video) sau khi "Bóc từ link"
  const urlInput = el("input", { type: "url", class: "inp", style: "flex:1;min-width:0", placeholder: "Dán link bài web hoặc video YouTube…" });
  const urlBtn = el("button", { class: "btn", onclick: doIngestUrl }, iconEl("upload"), el("span", { class: "btn-tx" }, " Bóc từ link"));
  async function doIngestUrl() {
    const url = urlInput.value.trim();
    if (!/^https?:\/\//.test(url)) return toast("Dán link bắt đầu bằng http(s)://");
    if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để bóc từ link.");
    urlBtn.disabled = true; toast("Đang bóc nội dung từ link… có thể mất một lúc.");
    try {
      const { text, title, kind, segments } = await comm.ingestUrl(url);
      if (!text || !text.trim()) return toast("Không bóc được nội dung từ link này.");
      ta.value = text;
      if (!titleInput.value && title) titleInput.value = title;
      pendingSource = { type: "link", url, kind: kind || "web" };
      pendingSegments = (segments && segments.length) ? segments : null;
      toast(pendingSegments ? `Đã bóc ${pendingSegments.length} câu có mốc thời gian (sync được).` : "Đã bóc nội dung. Xem lại rồi bấm Phân tích.");
    } catch (e) { toast("Lỗi: " + e.message); }
    finally { urlBtn.disabled = false; }
  }
  root.append(el("div", { class: "panel stack" },
    el("b", {}, "Nguồn"),
    el("div", { class: "field" }, el("label", {}, "Tên tài liệu"), titleInput),
    el("div", { class: "field" }, el("label", {}, "Link web / YouTube (cần Qwen3)"),
      el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, urlInput, urlBtn)),
    el("div", { class: "field" }, el("label", {}, "Hoặc dán văn bản"), ta),
    el("div", { class: "row" }, fileInput, el("button", { class: "btn primary", onclick: () => createLesson(ta.value, titleInput.value, pendingSource, pendingSegments) }, iconEl("search"), el("span", { class: "btn-tx" }, " Phân tích & tạo tài liệu"))),
    el("p", { class: "muted small" }, "Nạp xong, tài liệu tự xuất hiện trong Từ vựng (lọc nguồn), Giao tiếp (nguồn câu) và Dịch thuật. Văn bản .txt/.srt xử lý ngay; link web/YouTube cần backend Qwen3 (Cài đặt) — bóc xong điền vào ô trên để bạn xem lại rồi Phân tích. Link video sẽ hiện màn hình video khi luyện Shadowing/Thay thế."),
  ));
}

async function createLesson(text, title, source, segments) {
  text = (text || "").trim();
  if (!text) return toast("Chưa có nội dung.");
  const hanCount = (text.match(/[一-鿿]/g) || []).length;
  const lang = hanCount >= 5 ? "zh" : "vi";
  toast("Đang phân tích…");
  const lesson = { id: "ls-" + Date.now().toString(36), title: (title || "").trim() || text.slice(0, 24), lang, source: source || { type: "paste" }, createdAt: new Date().toISOString(), manual: {} };
  if (lang === "zh") {
    const { vocab, sentences, chapters } = await lessons.analyzeText(text);
    lesson.vocab = vocab;
    if (segments && segments.length) {
      // Tài liệu video: mỗi cue phụ đề = 1 câu, giữ mốc thời gian để sync.
      lesson.sentences = segments.map((s) => ({ zh: s.zh, t: s.start }));
      lesson.timed = true;
      lesson.chapters = lessons.detectChapters(lesson.sentences, "zh");
    } else {
      lesson.sentences = sentences; lesson.chapters = chapters;
    }
  } else {
    lesson.vocab = [];
    lesson.sentences = splitVi(text).map((vi) => ({ vi }));
    lesson.chapters = lessons.detectChapters(lesson.sentences, "vi");
  }
  await lessons.saveMaterial(lesson);
  invalidateMaterials();
  toast("Đã nạp & thêm vào Từ vựng · Giao tiếp · Dịch thuật.");
  ingestView = { screen: "lesson", lessonId: lesson.id };
  renderIngest();
}

async function ingestLibrary(root) {
  root.append(el("h1", { class: "view-title" }, "Nạp tài liệu"));
  root.append(ingestNav("library"));
  const list = await lessons.listMaterials();
  if (!list.length) { root.append(emptyState("Chưa có tài liệu", "Vào “Nạp mới” để tạo từ văn bản.")); return; }
  for (const l of list) {
    root.append(el("div", { class: "panel exam-card" },
      el("div", { class: "exam-head" }, el("h3", {}, l.title), el("span", { class: "chip" }, l.lang === "zh" ? "中文" : "Tiếng Việt")),
      el("p", { class: "muted small" }, `${new Date(l.createdAt).toLocaleDateString("vi")} · ${(l.vocab || []).length} từ · ${(l.sentences || []).length} câu`),
      el("div", { class: "exam-actions" },
        el("button", { class: "btn primary", onclick: () => { ingestView = { screen: "lesson", lessonId: l.id }; renderIngest(); } }, "Mở"),
        el("button", { class: "btn ghost", onclick: async () => { if (confirm("Xóa tài liệu?")) { await lessons.deleteMaterial(l.id); invalidateMaterials(); renderIngest(); } } }, "Xóa"))));
  }
}

async function ingestLesson(root) {
  const lesson = await lessons.getMaterial(ingestView.lessonId);
  if (!lesson) { ingestView = { screen: "library" }; return renderIngest(); }
  root.append(el("div", { class: "exam-topbar" },
    el("button", { class: "btn ghost", onclick: () => { ingestView = { screen: "library" }; renderIngest(); } }, "← Thư viện"),
    el("span", { class: "muted" }, lesson.title)));
  root.append(el("p", { class: "muted small" }, "Tài liệu này đã có sẵn trong Từ vựng · Giao tiếp · Dịch thuật (chọn theo nguồn). Bảng dưới để xem nhanh & theo dõi tiến độ."));
  if (lesson.lang === "zh" && lesson.vocab.length) root.append(lessonVocabPanel(lesson));
  const tp = lessonTranslatePanel(lesson);
  if (tp) root.append(tp);
  root.append(lessonTasksPanel(lesson));
}

// Dịch tham khảo toàn bộ câu (zh→vi) bằng Qwen3 — phục vụ Dịch thuật theo truyện & xem nghĩa khi Shadowing.
function lessonTranslatePanel(lesson) {
  if (lesson.lang !== "zh") return null;
  const zhS = lesson.sentences.filter((s) => !s.chapter && s.zh);
  if (!zhS.length) return null;
  const done = zhS.filter((s) => s.vi).length;
  const box = el("div", { class: "panel stack ai-panel" });
  box.append(el("div", { class: "row spread" }, el("b", {}, "Dịch tham khảo ", el("span", { class: "ai-tag" }, "Qwen3")), el("span", { class: "muted small" }, `${done}/${zhS.length} câu`)));
  box.append(el("p", { class: "muted small" }, "Dịch toàn bộ câu sang tiếng Việt làm bản tham khảo — hiện trong Dịch thuật “theo truyện” và làm nghĩa khi Shadowing. Cần backend Qwen3 (Cài đặt)."));
  box.append(el("div", { class: "story-prog" }, el("span", { style: `width:${zhS.length ? Math.round((done / zhS.length) * 100) : 0}%` })));
  const btn = el("button", { class: "btn primary", onclick: run }, iconEl("ai"), done >= zhS.length ? " Dịch lại toàn bộ" : ` Dịch ${zhS.length - done} câu chưa có`);
  box.append(btn);
  async function run() {
    if (!(await comm.pingBackend())) return toast("Bật backend Qwen3 (Cài đặt) để dịch.");
    const todo = done >= zhS.length ? zhS : zhS.filter((s) => !s.vi);
    btn.disabled = true;
    let n = 0;
    try {
      for (let i = 0; i < todo.length; i += 20) {
        const chunk = todo.slice(i, i + 20);
        toast(`Đang dịch ${i + 1}–${Math.min(i + 20, todo.length)}/${todo.length}…`);
        const { translations } = await comm.translateLines(chunk.map((s) => s.zh));
        chunk.forEach((s, k) => { if (translations && translations[k]) { s.vi = translations[k]; n++; } });
        await lessons.saveMaterial(lesson);
      }
      invalidateMaterials();
      toast(n ? `Đã dịch ${n} câu.` : "Không dịch được câu nào (kiểm tra Ollama).");
      renderIngest();
    } catch (e) { toast("Lỗi: " + e.message); }
    finally { btn.disabled = false; }
  }
  return box;
}

function lessonVocabPanel(lesson) {
  const box = el("div", { class: "panel stack" });
  box.append(el("b", {}, `Từ vựng trong bài — ${lesson.vocab.length} từ, xếp theo nhóm HSK`));
  box.append(el("p", { class: "muted small" }, "Từ trong danh sách HSK giữ cấp gốc; từ ngoài danh sách xếp vào HSK 1–6 theo độ thông dụng (tần suất, calibrate theo bộ HSK); chữ hiếm/lóng/thuật ngữ → HSK 6."));
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
    tasks.push({ label: `Học ${dictWords.length} từ trong bài`, total: dictWords.length, done,
      start: () => { const ids = new Set(dictWords.map((v) => v.cardId)); setStudyFilter((c) => ids.has(c.id), `Tài liệu: ${lesson.title}`); navigate("study"); } });
  }
  const zhS = lesson.sentences.filter((s) => !s.chapter && s.zh);
  if (zhS.length) {
    tasks.push({ label: `Luyện nói ${zhS.length} câu (Shadowing)`, total: zhS.length, done: lesson.manual.shadow ? zhS.length : 0, manual: "shadow",
      start: () => { commSel.sceneIds = []; commPersonal = zhS.map((s) => ({ zh: s.zh, vi: s.vi, t: s.t })); commPersonalLabel = lesson.title; commPersonalVideo = matVideo(lesson); commPersonalMatId = lesson.id; commView = { screen: "shadow", started: true }; navigate("comm"); } });
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

// Chia 1 tài liệu thành các "khúc" dịch (chương → phần) + tiến độ. Dùng chung Nạp & Dịch thuật.
function storyChunks(lesson) {
  const key = lesson.lang === "zh" ? "zh" : "vi";
  const dir = lesson.lang === "zh" ? "zh2vi" : "vi2zh";
  const cfg = lesson.transChunk || { mode: "parts", value: 3 };
  const chapters = lesson.chapters && lesson.chapters.length ? lesson.chapters : [{ title: null, start: 0, end: lesson.sentences.length }];
  const saved = new Set(store.getTranslations().map((t) => t.source));
  const out = [];
  for (const ch of chapters) {
    const idxs = [];
    for (let i = ch.start; i < ch.end; i++) { const s = lesson.sentences[i]; if (s && !s.chapter && (s[key] || "").trim()) idxs.push(i); }
    if (!idxs.length) continue;
    const parts = chunkIdxs(idxs, lesson.sentences, cfg, key);
    parts.forEach((p, pi) => {
      const done = p.filter((id) => saved.has(lesson.sentences[id][key])).length;
      const chapLbl = ch.title || (chapters.length > 1 ? "Mở đầu" : "");
      const partLbl = parts.length > 1 ? `${chapLbl ? " · " : ""}phần ${pi + 1}/${parts.length}` : "";
      out.push({ key, dir, idxs: p, total: p.length, done, label: (`${chapLbl}${partLbl}`).replace(/\s+/g, " ").trim() || "Cả bài" });
    });
  }
  return out;
}

// Task Dịch ở màn Nạp: mở thẳng task runner trong Dịch thuật.
function translateTasks(lesson) {
  return storyChunks(lesson).map((c) => ({
    label: `Dịch ${c.label} (${c.total} câu)`, total: c.total, done: c.done,
    start: () => openTransTask(lesson.id, c),
  }));
}

function taskRow(lesson, t) {
  const row = el("div", { class: "lesson-task" });
  row.append(el("div", { class: "row spread" },
    el("span", {}, t.label),
    el("span", { class: "chip" + (t.total && t.done >= t.total ? " st known" : "") }, `${t.done}/${t.total}`)));
  const actions = el("div", { class: "row" }, el("button", { class: "btn small primary", onclick: t.start }, "Bắt đầu"));
  if (t.manual === "shadow") {
    const flag = !!lesson.manual.shadow;
    actions.append(el("button", { class: "btn small ghost", onclick: async () => { lesson.manual.shadow = !flag; await lessons.saveMaterial(lesson); renderIngest(); } }, flag ? "Bỏ đánh dấu" : "✓ Đã luyện xong"));
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
    el("span", {}, "Dịch — chia nhiệm vụ"),
    el("span", { class: "muted small" }, `${nCau} câu${nChap ? ` · ${nChap} chương` : ""}`)));
  const mode = el("select", { class: "chunk-mode" },
    ...[["parts", "Số phần (½, ⅓…)"], ["sentences", "Số câu / phần"], ["chars", "Số chữ / phần"]].map(([v, l]) => el("option", { value: v, selected: cfg.mode === v }, l)));
  const val = el("input", { type: "number", min: "1", value: String(cfg.value), class: "chunk-val" });
  const apply = el("button", { class: "btn small primary", onclick: async () => {
    lesson.transChunk = { mode: mode.value, value: Math.max(1, parseInt(val.value, 10) || 1) };
    await lessons.saveMaterial(lesson); renderIngest();
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

/* ============================================================
   PHỒN THỂ (繁) — Bài học chữ phồn thể + Nhận diện thành phần
   ============================================================ */
let tradCache = { deckId: null, pairs: null };
async function tradPairs() {
  const id = store.getSettings().activeDeckId;
  if (tradCache.deckId === id && tradCache.pairs) return tradCache.pairs;
  const deck = await getDeck(id);
  const pairs = deck ? trad.buildTradPairs(deck.cards) : [];
  tradCache = { deckId: id, pairs };
  return pairs;
}
let tradFilter = { level: "all", limit: 80 };
let tradRefOpen = false;
let tradSrsSession = null;
let tradScope = null;            // null = toàn bộ; { label, simps:Set<string> }
let tradSel = new Set();         // tick chọn ở Thư mục (theo simp)

function scopedPairs(pairs) { return tradScope && tradScope.simps ? pairs.filter((p) => tradScope.simps.has(p.simp)) : pairs; }
function scopeLabel() { return tradScope ? tradScope.label : "Tất cả chữ"; }
// Đặt phạm vi học (từ Thư mục / Bộ của tôi / Lộ trình) rồi mở phương thức.
function setTradScope(label, simps, view) {
  tradScope = simps ? { label, simps: new Set(simps) } : null;
  tradSrsSession = null; tradQuiz = null;
  navigate(view);
}
function tradScopeBar(backView) {
  return el("div", { class: "row spread", style: "margin-bottom:10px" },
    el("span", { class: "chip lvl" }, scopeLabel()),
    el("button", { class: "btn ghost small", onclick: () => navigate(backView) }, "← Đổi phạm vi"));
}

/* ----- LỘ TRÌNH (home) ----- */
export async function renderTradHome() {
  clearCommState();
  const root = clear();
  const pairs = await tradPairs();
  root.append(hubBack("Phồn thể", "tradHub"));
  root.append(el("h1", { class: "view-title" }, "Phồn thể — lộ trình cho người mới"));
  if (!pairs.length) { root.append(emptyState("Chưa có dữ liệu", "Bộ thẻ chưa có chữ phồn thể.")); return; }
  root.append(el("p", { class: "muted small" }, `App học giản thể; lộ trình này giúp bạn ĐỌC được ${pairs.length} chữ phồn thể HSK qua 3 bước.`));

  const meta = store.getTradMeta();
  const srsMap = store.getTradSrs();
  const learned = pairs.filter((p) => { const st = srsMap[p.simp]; return st && st.reps > 0; }).length;
  const due = pairs.filter((p) => { const st = srsMap[p.simp]; return st && !srs.isNew(st) && srs.isDue(st); }).length;

  const steps = [
    { n: "①", title: "Quy luật bộ thủ", desc: "Nhận ra các thành phần Giản↔Phồn lặp lại để đoán chữ nhanh.", view: "tradRules",
      done: meta.rulesDone ? 1 : 0, total: 1, badge: meta.rulesDone ? "Đã nắm" : "Bắt đầu" },
    { n: "②", title: "Thẻ nhớ 简→繁 (SRS)", desc: "Học thuộc từng chữ bằng thẻ lặp lại ngắt quãng.", view: "tradSrs",
      done: learned, total: pairs.length, badge: due ? `${due} đến hạn` : (learned ? `${learned}/${pairs.length}` : "Bắt đầu") },
    { n: "③", title: "Quiz nhận diện", desc: "Đọc phồn thể → chọn giản thể đúng.", view: "tradComp",
      done: meta.quizBest ? meta.quizBest.score : 0, total: meta.quizBest ? meta.quizBest.total : 0,
      badge: meta.quizBest ? `Kỷ lục ${meta.quizBest.score}/${meta.quizBest.total}` : "Thử sức" },
  ];
  const wrap = el("div", { class: "trad-road" });
  for (const st of steps) {
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    wrap.append(el("button", { class: "road-step", onclick: () => setTradScope(null, null, st.view) },
      el("span", { class: "road-n" }, st.n),
      el("span", { class: "road-body" },
        el("span", { class: "road-title" }, st.title),
        el("span", { class: "road-desc muted small" }, st.desc),
        st.total ? el("div", { class: "story-prog", style: "margin-top:8px" }, el("span", { style: `width:${pct}%` })) : null),
      el("span", { class: "chip" + (st.total && st.done >= st.total ? " st known" : "") }, st.badge),
    ));
  }
  root.append(wrap);
}

/* ----- ① QUY LUẬT BỘ THỦ ----- */
export async function renderTradRules() {
  clearCommState();
  const root = clear();
  root.append(hubBack("Phồn thể", "tradHub"));
  root.append(el("h1", { class: "view-title" }, "Quy luật bộ thủ Giản ↔ Phồn"));
  root.append(el("p", { class: "muted small" }, "Phần lớn chữ phồn thể khác giản thể ở MỘT thành phần lặp lại. Nhớ các cặp bộ thủ này, bạn sẽ đoán & đọc chữ phồn thể nhanh hơn nhiều."));
  const tbl = el("div", { class: "trad-comp-grid" });
  for (const c of trad.TRAD_COMPONENTS) {
    tbl.append(el("div", { class: "trad-comp" },
      el("div", { class: "trad-comp-head" }, el("span", { class: "trad-s" }, c.s), el("span", { class: "trad-arrow" }, "→"), el("span", { class: "trad-t" }, c.t)),
      el("div", { class: "muted small" }, c.note),
      el("div", { class: "trad-ex" }, c.ex.map((e) => `${e[0]}/${e[1]}`).join(" · "))));
  }
  root.append(tbl);
  const meta = store.getTradMeta();
  const row = el("div", { class: "row", style: "margin-top:16px" });
  row.append(el("button", { class: "btn" + (meta.rulesDone ? " ghost" : " primary"), onclick: () => { store.saveTradMeta({ rulesDone: !meta.rulesDone }); renderTradRules(); } },
    iconEl(meta.rulesDone ? "reset" : "check"), meta.rulesDone ? "Bỏ đánh dấu đã nắm" : "Đã nắm quy luật"));
  row.append(el("button", { class: "btn", onclick: () => setTradScope(null, null, "tradSrs") }, iconEl("cards"), el("span", { class: "btn-tx" }, "Sang Thẻ nhớ →")));
  root.append(row);
}

/* ----- ② THẺ NHỚ 简→繁 (SRS) ----- */
export async function renderTradSrs() {
  clearCommState();
  const root = clear();
  const pairs = scopedPairs(await tradPairs());
  root.append(el("h1", { class: "view-title" }, "Thẻ nhớ 简→繁"));
  root.append(tradScopeBar("tradFolder"));
  if (!pairs.length) { root.append(emptyState("Chưa có dữ liệu", "Phạm vi này chưa có chữ phồn thể.", "cards")); return; }
  const s = store.getSettings();
  if (!tradSrsSession || tradSrsSession.scopeLabel !== scopeLabel()) {
    const prog = store.getTradSrs();
    const cards = pairs.map((p) => ({ ...p, id: p.simp }));
    const queue = srs.buildQueue(cards, prog, { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit });
    tradSrsSession = { queue, idx: 0, revealed: false, flip: false, scopeLabel: scopeLabel() };
  }
  const sess = tradSrsSession;

  if (!sess.queue.length || sess.idx >= sess.queue.length) {
    const learned = pairs.filter((p) => { const st = store.getTradState(p.simp); return st && st.reps > 0; }).length;
    root.append(el("div", { class: "empty" }, el("div", { class: "big" }, iconEl("check")),
      el("h2", {}, sess.queue.length ? "Xong thẻ hôm nay!" : "Chưa có thẻ đến hạn"),
      el("p", { class: "muted" }, `Đã học ${learned}/${pairs.length} chữ. Quay lại sau để ôn tiếp, hoặc làm Quiz để kiểm tra.`)));
    root.append(el("div", { class: "row center", style: "margin-top:8px" },
      el("button", { class: "btn primary", onclick: () => navigate("tradComp") }, el("span", { class: "btn-tx" }, "Sang ③ Quiz →")),
      el("button", { class: "btn ghost", onclick: () => { tradSrsSession = null; renderTradSrs(); } }, iconEl("reset"), "Học lại")));
    root.append(tradReferenceDetails(pairs, s));
    return;
  }

  const p = sess.queue[sess.idx];
  root.append(el("div", { class: "center muted small", style: "margin-bottom:6px" }, `Thẻ ${sess.idx + 1}/${sess.queue.length}`));

  const front = el("div", { class: "stack center" },
    el("div", { class: "label-tag" }, "Phồn thể"),
    el("div", { class: "hanzi trad" }, p.trad),
    el("button", { class: "btn ghost small", onclick: (e) => { e.stopPropagation(); speak(p.simp, { rate: s.speechRate }); } }, iconEl("speaker")),
    !sess.revealed && el("div", { class: "tap-hint" }, "Chạm để xem giản thể & nghĩa"));
  const back = sess.revealed && el("div", { class: "stack center" },
    el("div", { class: "label-tag" }, "Giản thể"),
    el("div", { class: "hanzi" }, p.simp),
    p.pinyin ? el("div", { class: "pinyin" }, p.pinyin) : null,
    (p.han_viet || p.meaning) ? el("div", { class: "muted" }, (p.han_viet ? `[${p.han_viet}] ` : "") + (p.meaning || "")) : null,
    p.examples.length ? el("div", { class: "trad-ex" }, "VD: " + p.examples.slice(0, 3).map((e) => `${e.s}/${e.t}`).join(" · ")) : null);
  const card = el("div", { class: "flashcard" + (sess.flip ? " flip" : ""), onclick: () => { if (!sess.revealed) revealTrad(); } }, front, back);
  sess.flip = false;
  root.append(card);

  if (sess.revealed) {
    const grades = el("div", { class: "grade-row" });
    const st = store.getTradState(p.simp) || srs.freshState("trad");
    const defs = [["again", "Lại", srs.GRADES.AGAIN], ["hard", "Khó", srs.GRADES.HARD], ["good", "Được", srs.GRADES.GOOD], ["easy", "Dễ", srs.GRADES.EASY]];
    for (const [cls, lbl, g] of defs) {
      grades.append(el("button", { class: `btn grade ${cls}`, onclick: () => gradeTrad(p, g) },
        el("span", {}, lbl), el("span", { class: "k" }, srs.humanInterval(srs.schedule(st, g).interval || 0))));
    }
    root.append(grades);
  } else {
    root.append(el("div", { class: "center", style: "margin-top:10px" },
      el("button", { class: "btn primary", onclick: revealTrad }, el("span", { class: "btn-tx" }, "Hiện đáp án"))));
  }
  root.append(tradReferenceDetails(pairs, s));
}

function revealTrad() { tradSrsSession.revealed = true; tradSrsSession.flip = true; renderTradSrs(); }

// keyboard cho ② Thẻ nhớ: Space hiện đáp án, 1-4 chấm
export function handleTradKey(e) {
  const sess = tradSrsSession;
  if (!sess || sess.idx >= sess.queue.length) return;
  if (e.code === "Space") { e.preventDefault(); if (!sess.revealed) revealTrad(); return; }
  if (sess.revealed && ["1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    const map = { "1": ".again", "2": ".hard", "3": ".good", "4": ".easy" };
    document.querySelector(`.grade-row .grade${map[e.key]}`)?.click();
  }
}
function gradeTrad(p, g) {
  const cur = store.getTradState(p.simp) || srs.freshState("trad");
  store.saveTradState(p.simp, srs.schedule(cur, g));
  store.logReview(g !== srs.GRADES.AGAIN);
  tradSrsSession.idx++;
  tradSrsSession.revealed = false;
  renderTradSrs();
}

// Bảng tra cứu 简→繁 (collapsible) — dùng lại trong bước ② Thẻ nhớ.
function tradReferenceDetails(pairs, s) {
  const det = el("details", { class: "panel", style: "margin-top:18px" });
  if (tradRefOpen) det.open = true;
  det.addEventListener("toggle", () => { tradRefOpen = det.open; });
  det.append(el("summary", {}, iconEl("book"), ` Tra cứu bảng 简→繁 (${pairs.length} chữ)`));
  const levels = [...new Set(pairs.map((p) => p.level))].sort();
  const sel = selectRow(["all", ...levels.map(String)], ["Mọi cấp", ...levels.map((l) => "HSK" + l)], tradFilter.level,
    (v) => { tradFilter.level = v; tradFilter.limit = 80; tradRefOpen = true; renderTradSrs(); });
  det.append(el("div", { class: "filter-grid", style: "margin-bottom:8px" }, sel));
  const filtered = tradFilter.level === "all" ? pairs : pairs.filter((p) => String(p.level) === tradFilter.level);
  const grid = el("div", { class: "trad-grid" });
  filtered.slice(0, tradFilter.limit).forEach((p) => grid.append(tradPairCard(p, s)));
  det.append(grid);
  if (filtered.length > tradFilter.limit) {
    det.append(el("div", { class: "center", style: "margin-top:12px" },
      el("button", { class: "btn", onclick: () => { tradFilter.limit += 80; tradRefOpen = true; renderTradSrs(); } }, `Hiện thêm (còn ${filtered.length - tradFilter.limit})`)));
  }
  return det;
}

function tradPairCard(p, s) {
  return el("div", { class: "trad-card" },
    el("div", { class: "trad-pair" }, el("span", { class: "trad-s" }, p.simp), el("span", { class: "trad-arrow" }, "→"), el("span", { class: "trad-t" }, p.trad)),
    el("div", { class: "trad-meta" },
      el("span", { class: "chip lvl" }, "HSK" + p.level),
      p.pinyin ? el("span", { class: "pinyin" }, p.pinyin) : null,
      el("button", { class: "btn ghost small", onclick: () => speak(p.simp, { rate: s.speechRate }) }, iconEl("speaker"))),
    (p.han_viet || p.meaning) ? el("div", { class: "muted small" }, (p.han_viet ? `[${p.han_viet}] ` : "") + (p.meaning || "")) : null,
    p.examples.length ? el("div", { class: "trad-ex" }, "VD: " + p.examples.slice(0, 3).map((e) => `${e.s}/${e.t}`).join(" · ")) : null);
}

/* ----- THƯ MỤC: duyệt chữ phồn thể theo cấp + tick chọn ----- */
export async function renderTradFolder() {
  clearCommState();
  const root = clear();
  const pairs = await tradPairs();
  root.append(hubBack("Phồn thể", "tradHub"));
  root.append(el("h1", { class: "view-title" }, "Phồn thể · Thư mục"));
  if (!pairs.length) { root.append(emptyState("Chưa có dữ liệu", "Bộ thẻ chưa có chữ phồn thể.", "trad")); return; }
  root.append(el("p", { class: "muted small", style: "margin:-6px 2px 12px" }, "Tick chọn chữ (theo cấp HSK) rồi học bằng Thẻ nhớ / Quiz hoặc lưu thành bộ. Hoặc bấm ▶ Học cấp để luyện nhanh cả cấp."));

  if (tradSel.size) {
    const simps = [...tradSel];
    root.append(el("div", { class: "panel ai-pop", style: "margin-bottom:12px" },
      el("div", { class: "row spread" }, el("b", {}, `Đã chọn ${tradSel.size} chữ`),
        el("button", { class: "btn ghost small", onclick: () => { tradSel.clear(); renderTradFolder(); } }, "Bỏ chọn")),
      el("div", { class: "row", style: "margin-top:8px" },
        el("button", { class: "btn primary", onclick: () => setTradScope(`Đã chọn ${simps.length} chữ`, simps, "tradSrs") }, iconEl("cards"), el("span", { class: "btn-tx" }, " Thẻ nhớ")),
        el("button", { class: "btn", onclick: () => setTradScope(`Đã chọn ${simps.length} chữ`, simps, "tradComp") }, iconEl("exam"), el("span", { class: "btn-tx" }, " Quiz")),
        el("button", { class: "btn", onclick: () => saveTradSetPrompt(simps) }, iconEl("save"), el("span", { class: "btn-tx" }, " Lưu thành bộ")))));
  }

  const byLevel = {};
  for (const p of pairs) (byLevel[p.level] = byLevel[p.level] || []).push(p);
  for (const lv of Object.keys(byLevel).map(Number).sort((a, b) => a - b)) {
    const arr = byLevel[lv];
    const allSel = arr.every((p) => tradSel.has(p.simp));
    const head = el("div", { class: "row spread" },
      el("b", {}, `HSK${lv}`, el("span", { class: "muted small" }, ` · ${arr.length} chữ`)),
      el("div", { class: "row" },
        el("button", { class: "btn ghost small", onclick: () => { for (const p of arr) allSel ? tradSel.delete(p.simp) : tradSel.add(p.simp); renderTradFolder(); } }, allSel ? "Bỏ cấp" : "Chọn cả cấp"),
        el("button", { class: "btn small", onclick: () => setTradScope(`HSK${lv}`, arr.map((p) => p.simp), "tradSrs") }, iconEl("play"), el("span", { class: "btn-tx" }, " Học cấp"))));
    const grid = el("div", { class: "comm-chips" });
    for (const p of arr) grid.append(commChip(`${p.simp}→${p.trad}`, tradSel.has(p.simp), () => { tradSel.has(p.simp) ? tradSel.delete(p.simp) : tradSel.add(p.simp); renderTradFolder(); }));
    root.append(el("div", { class: "panel stack" }, head, grid));
  }
}

function saveTradSetPrompt(simps) {
  const name = prompt("Tên bộ chữ phồn thể:", `Bộ ${simps.length} chữ`);
  if (name == null) return;
  store.saveTradSet({ id: "ts-" + Date.now().toString(36), name: name.trim() || `Bộ ${simps.length} chữ`, chars: simps, createdAt: new Date().toISOString() });
  tradSel.clear();
  toast("Đã lưu bộ. Xem ở “Bộ của tôi”.");
  navigate("tradSets");
}

/* ----- BỘ CỦA TÔI (phồn thể) ----- */
export async function renderTradSets() {
  clearCommState();
  const root = clear();
  root.append(hubBack("Phồn thể", "tradHub"));
  root.append(el("h1", { class: "view-title" }, "Phồn thể · Bộ của tôi"));
  const sets = store.getTradSets();
  if (!sets.length) {
    root.append(emptyState("Chưa có bộ chữ nào", "Vào tab Thư mục, tick chọn chữ rồi “Lưu thành bộ”.", "trad",
      { label: "Sang Thư mục", icon: "play", onClick: () => navigate("tradFolder") }));
    return;
  }
  const srsMap = store.getTradSrs();
  for (const set of sets) {
    const chars = set.chars || [];
    const learned = chars.filter((c) => { const st = srsMap[c]; return st && st.reps > 0; }).length;
    const preview = chars.slice(0, 18).join(" ") + (chars.length > 18 ? " …" : "");
    root.append(el("div", { class: "panel stack" },
      el("div", { class: "row spread" }, el("b", {}, set.name), el("span", { class: "muted small" }, `${chars.length} chữ · đã học ${learned}`)),
      el("div", { class: "muted small" }, preview),
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: () => setTradScope(set.name, chars, "tradSrs") }, iconEl("cards"), el("span", { class: "btn-tx" }, " Thẻ nhớ")),
        el("button", { class: "btn", onclick: () => setTradScope(set.name, chars, "tradComp") }, iconEl("exam"), el("span", { class: "btn-tx" }, " Quiz")),
        el("button", { class: "btn ghost", onclick: () => { if (confirm("Xóa bộ này?")) { store.deleteTradSet(set.id); renderTradSets(); } } }, "Xóa"))));
  }
}

let tradQuiz = null;
export async function renderTradComp() {
  clearCommState();
  const root = clear();
  root.append(el("h1", { class: "view-title" }, "Quiz nhận diện phồn thể"));
  root.append(tradScopeBar("tradFolder"));
  root.append(await tradQuizPanel());
  root.append(el("div", { class: "row", style: "margin-top:12px" },
    el("button", { class: "btn ghost", onclick: () => navigate("tradRules") }, iconEl("reset"), "Ôn lại Bộ thủ"),
    el("button", { class: "btn ghost", onclick: () => navigate("tradSrs") }, iconEl("cards"), el("span", { class: "btn-tx" }, "Học tiếp Thẻ nhớ"))));
}

async function tradQuizPanel() {
  const pairs = scopedPairs(await tradPairs());
  const box = el("div", { class: "panel stack" });
  box.append(el("div", { class: "row spread" }, el("b", {}, "Quiz: đọc phồn thể → chọn giản thể"), tradQuiz ? el("span", { class: "muted small" }, `Điểm ${tradQuiz.score}/${tradQuiz.total}`) : null));
  if (pairs.length < 4) { box.append(el("p", { class: "muted small" }, "Phạm vi cần ≥4 chữ để làm quiz.")); return box; }
  if (tradQuiz && tradQuiz.scopeLabel !== scopeLabel()) tradQuiz = null;
  if (!tradQuiz || tradQuiz.next) tradQuiz = makeTradQuestion(pairs, tradQuiz);
  const q = tradQuiz;
  box.append(el("div", { class: "trad-quiz-q" }, q.pair.trad));
  box.append(el("div", { class: "muted small center" }, "Chữ phồn thể trên ứng với chữ giản thể nào?"));
  const opts = el("div", { class: "quiz-options" });
  for (const o of q.options) {
    let cls = "btn quiz-opt";
    if (q.picked) { if (o === q.pair.simp) cls += " correct"; else if (o === q.picked) cls += " wrong"; }
    opts.append(el("button", { class: cls, disabled: !!q.picked, onclick: () => pickTrad(o) }, o));
  }
  box.append(opts);
  if (q.picked) {
    box.append(el("div", { class: "muted small" }, `${q.pair.simp} → ${q.pair.trad}${q.pair.pinyin ? ` · ${q.pair.pinyin}` : ""}${q.pair.meaning ? ` · ${q.pair.meaning}` : ""}`));
    box.append(el("button", { class: "btn primary", onclick: () => { tradQuiz.next = true; renderTradComp(); } }, "Câu tiếp →"));
  }
  return box;
}
function makeTradQuestion(pairs, prev) {
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  const opts = new Set([pair.simp]);
  while (opts.size < 4 && opts.size < pairs.length) opts.add(pairs[Math.floor(Math.random() * pairs.length)].simp);
  return { pair, options: [...opts].sort(() => Math.random() - 0.5), picked: null, score: prev ? prev.score : 0, total: prev ? prev.total : 0, next: false, scopeLabel: scopeLabel() };
}
function pickTrad(o) {
  if (tradQuiz.picked) return;
  tradQuiz.picked = o;
  tradQuiz.total++;
  if (o === tradQuiz.pair.simp) tradQuiz.score++;
  const best = store.getTradMeta().quizBest;
  if (!best || tradQuiz.score > best.score) store.saveTradMeta({ quizBest: { score: tradQuiz.score, total: tradQuiz.total } });
  renderTradComp();
}

/* ============================================================
   BỘ CỦA TÔI (bộ từ tự lưu) + GÕ PINYIN
   ============================================================ */
export async function renderWordsets() {
  clearCommState();
  const root = clear();
  root.append(hubBack("Từ vựng", "vocabHub"));
  root.append(el("h1", { class: "view-title" }, "Bộ của tôi"));
  const sets = store.getWordSets();
  if (!sets.length) {
    root.append(emptyState("Chưa có bộ từ nào", "Vào tab Thư mục, tick chọn từ rồi “Lưu thành bộ”."));
    return;
  }
  const deck = await getDeck(store.getSettings().activeDeckId);
  const byId = new Map((deck ? deck.cards : []).map((c) => [c.id, c]));
  const prog = store.getProgress();
  for (const set of sets) {
    const ids = set.cardIds.filter((id) => byId.has(id));
    const known = ids.filter((id) => { const st = prog[id]; return st && (st.known || st.reps > 0); }).length;
    const preview = ids.slice(0, 10).map((id) => byId.get(id).simplified).join(" ") + (ids.length > 10 ? " …" : "");
    root.append(el("div", { class: "panel stack" },
      el("div", { class: "row spread" },
        el("b", {}, set.name),
        el("span", { class: "muted small" }, `${ids.length} từ · đã học ${known}`)),
      el("div", { class: "muted small" }, `${new Date(set.createdAt).toLocaleDateString("vi")} · ${preview}`),
      el("div", { class: "row" },
        methodBtn("cards", "Flashcard", () => startSet(set, ids, "study")),
        methodBtn("exam", "Quiz", () => startSet(set, ids, "quiz")),
        methodBtn("keyboard", "Gõ pinyin", () => startSet(set, ids, "type")),
        methodBtn("speaker", "Nghe", () => startSet(set, ids, "listen")),
        el("button", { class: "btn ghost small", title: "Xóa bộ", onclick: () => { if (confirm(`Xóa bộ "${set.name}"?`)) { store.deleteWordSet(set.id); renderWordsets(); } } }, iconEl("x"))),
    ));
  }
}
function methodBtn(iconName, label, onclick) { return el("button", { class: "btn small", onclick }, iconEl(iconName), el("span", { class: "btn-tx" }, label)); }
function startSet(set, ids, mode) {
  if (!ids.length) return toast("Bộ này không còn từ hợp lệ.");
  setLearnScope(new Set(ids), set.name);
  navigate(mode);
}

let typeState = null;
function normPinyin(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, ""); }

export async function renderType() {
  clearCommState();
  const root = clear();
  const s = store.getSettings();
  const deck = await getDeck(s.activeDeckId);
  root.append(el("h1", { class: "view-title" }, "Gõ pinyin"));
  const sb = scopeBanner(renderType); if (sb) root.append(sb);
  const pool = scopeCards((deck ? deck.cards : []).filter((c) => c.pinyin));
  if (!pool.length) { root.append(emptyState("Không có từ để gõ", "Vào Bộ của tôi chọn một bộ.")); return; }

  const key = learnScope ? learnScope.label : "__all";
  if (!typeState || typeState.key !== key) typeState = { key, pool: shuffle([...pool]).slice(0, 20), i: 0, score: 0, checked: null };
  const t = typeState;
  if (t.i >= t.pool.length) {
    root.append(el("div", { class: "panel center stack" },
      el("h2", {}, `Xong! ${t.score}/${t.pool.length} đúng`),
      el("button", { class: "btn primary", onclick: () => { typeState = null; renderType(); } }, iconEl("reset"), "Làm lại")));
    return;
  }
  const c = t.pool[t.i];
  root.append(el("div", { class: "panel center stack" },
    el("div", { class: "muted small" }, `Câu ${t.i + 1}/${t.pool.length} · Điểm ${t.score}`),
    el("div", { class: "hanzi" }, c.simplified),
    el("div", { class: "meaning" }, c.meaning || ""),
    audioBtn(null, () => speak(c.simplified, { rate: s.speechRate }))));

  const input = el("input", { type: "text", placeholder: "Gõ pinyin (không cần dấu thanh)…", class: "type-input", autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
  const fb = el("div", { class: "type-fb" });
  const btnHost = el("div", { class: "row", style: "justify-content:center" });
  const paint = () => {
    btnHost.innerHTML = "";
    if (t.checked == null) btnHost.append(el("button", { class: "btn primary", onclick: submit }, "Kiểm tra"));
    else btnHost.append(el("button", { class: "btn primary", onclick: () => { t.i++; t.checked = null; renderType(); } }, "Tiếp →"));
  };
  const submit = () => {
    if (t.checked != null) return;
    const ok = normPinyin(input.value) === normPinyin(c.pinyin);
    t.checked = ok; if (ok) t.score++;
    fb.textContent = ok ? "✓ Đúng!" : `✗ Đáp án: ${c.pinyin}`;
    fb.className = "type-fb " + (ok ? "ok" : "bad");
    input.disabled = true;
    paint();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  paint();
  root.append(el("div", { class: "panel stack" }, el("div", { class: "field" }, input), fb, btnHost));
  setTimeout(() => input.focus(), 60);
}

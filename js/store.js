// store.js — persistence layer (localStorage). Holds settings, decks and SRS progress.

const KEYS = {
  settings: "hsk.settings",
  decks: "hsk.decks",        // user-imported / edited decks
  progress: "hsk.progress",  // SRS state keyed by cardId
  stats: "hsk.stats",        // daily review log
  classOverrides: "hsk.classOverrides", // sửa nhóm thủ công, keyed by cardId
  exams: "hsk.exams",        // đề luyện thi do người dùng nhập
  hskk: "hsk.hskk",          // đề HSKK 高级 do người dùng nhập / Qwen3 sinh
  examProgress: "hsk.examProgress", // kết quả Đọc + bản nháp Viết, keyed by examId
  translations: "hsk.translations", // Dịch thuật — "Bài đã dịch" của người dùng (+ Qwen3 chấm)
  wordSets: "hsk.wordSets",  // bộ từ tự lưu (tick chọn) — [{id,name,cardIds,createdAt}]
  tradSrs: "hsk.tradSrs",    // SRS thẻ phồn thể 简→繁, keyed theo chữ giản thể
  tradMeta: "hsk.tradMeta",  // tiến độ lộ trình Phồn thể: { rulesDone, quizBest:{score,total} }
  tradSets: "hsk.tradSets",  // bộ chữ phồn thể tự lưu — [{id,name,chars:[simp],createdAt}]
  commRecords: "hsk.commRecords", // kỷ lục Giao tiếp: { sprintBest:{ "30":n,"60":n,"90":n } }
};

export const DEFAULT_SETTINGS = {
  theme: "dark",             // light | dark — mặc định tối "ngầu"
  accent: "#c0392b",
  hanziScale: 1,             // 0.8 .. 1.6
  fontBase: 16,
  charMode: "simplified",    // simplified | traditional | both
  showPinyinByDefault: false,
  autoPlayAudio: false,
  speechRate: 0.9,
  newPerDay: 15,
  reviewLimit: 100,
  activeDeckId: "hsk-1-6",
  commBackendUrl: "",        // URL backend Qwen3 (Giao tiếp). Rỗng = chưa bật.
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------- Track theo tự hình (Giản/Phồn có tiến độ ĐỘC LẬP) ----------------
 * charMode="traditional" → dùng store hậu tố ".trad" cho SRS progress + daily stats.
 * "simplified"/"both" → store gốc. Cùng bộ thẻ HSK, nhưng tiến độ học tách riêng. */
function scriptSuffix() { return read(KEYS.settings, {}).charMode === "traditional" ? ".trad" : ""; }
function progKey() { return KEYS.progress + scriptSuffix(); }
function statsKey() { return KEYS.stats + scriptSuffix(); }

/* ---------------- Settings ---------------- */
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  applyTheme(next);
  return next;
}
export function applyTheme(s = getSettings()) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--hanzi-scale", String(s.hanziScale));
  root.style.setProperty("--font-base", s.fontBase + "px");
}

/* ---------------- Decks ---------------- */
// User decks are stored locally; the bundled starter deck is loaded from /data.
export function getUserDecks() {
  return read(KEYS.decks, []);
}
export function saveUserDeck(deck) {
  const decks = getUserDecks();
  const idx = decks.findIndex((d) => d.id === deck.id);
  if (idx >= 0) decks[idx] = deck;
  else decks.push(deck);
  write(KEYS.decks, decks);
}
export function deleteUserDeck(id) {
  write(KEYS.decks, getUserDecks().filter((d) => d.id !== id));
}

/* ---------------- SRS progress ---------------- */
export function getProgress() {
  return read(progKey(), {});
}
// Đọc tiến độ/stats của MỘT track cụ thể (bất kể charMode hiện tại) — cho so sánh ở Trang chủ.
export function getProgressFor(script) {
  return read(KEYS.progress + (script === "trad" ? ".trad" : ""), {});
}
export function getStatsFor(script) {
  return read(KEYS.stats + (script === "trad" ? ".trad" : ""), {});
}
export function getCardState(cardId) {
  return getProgress()[cardId] || null;
}
export function saveCardState(cardId, state) {
  const all = getProgress();
  all[cardId] = state;
  write(progKey(), all);
}
export function resetProgress(deckId) {
  const key = progKey();
  if (!deckId) return write(key, {});
  const all = getProgress();
  for (const k of Object.keys(all)) {
    if (all[k].deckId === deckId) delete all[k];
  }
  write(key, all);
}

/* ---------------- Giao tiếp: kỷ lục Sprint ---------------- */
export function getCommRecords() {
  return read(KEYS.commRecords, {});
}
// Cập nhật kỷ lục Sprint theo thời lượng; trả {best, isNew}.
export function saveSprintBest(dur, score) {
  const all = getCommRecords();
  const sprintBest = { ...(all.sprintBest || {}) };
  const prev = sprintBest[dur] || 0;
  const isNew = score > prev;
  if (isNew) { sprintBest[dur] = score; write(KEYS.commRecords, { ...all, sprintBest }); }
  return { best: Math.max(prev, score), isNew };
}

/* ---------------- Phồn thể: SRS thẻ 简→繁 + tiến độ lộ trình ---------------- */
export function getTradSrs() {
  return read(KEYS.tradSrs, {});
}
export function getTradState(simp) {
  return getTradSrs()[simp] || null;
}
export function saveTradState(simp, state) {
  const all = getTradSrs();
  all[simp] = state;
  write(KEYS.tradSrs, all);
}
export function getTradMeta() {
  return read(KEYS.tradMeta, {});
}
export function saveTradMeta(patch) {
  const next = { ...getTradMeta(), ...patch };
  write(KEYS.tradMeta, next);
  return next;
}

/* ---------------- Sửa nhóm thủ công (manual classification) ----------------
 * Lưu TÁCH RIÊNG với data tĩnh để khi nạp lại bộ thẻ không ghi đè lựa chọn của
 * người dùng. Mỗi override: { semantic_group, struct_group?, classification_source:"manual",
 * classification_conf:1, needs_review:false }. mergeClassification() áp override lên thẻ. */
export function getClassOverrides() {
  return read(KEYS.classOverrides, {});
}
export function getClassOverride(cardId) {
  return getClassOverrides()[cardId] || null;
}
export function setClassOverride(cardId, patch) {
  const all = getClassOverrides();
  all[cardId] = {
    ...all[cardId],
    ...patch,
    classification_source: "manual",
    classification_conf: 1.0,
    needs_review: false,
  };
  write(KEYS.classOverrides, all);
  return all[cardId];
}
export function clearClassOverride(cardId) {
  const all = getClassOverrides();
  delete all[cardId];
  write(KEYS.classOverrides, all);
}
// Áp override (nếu có) lên thẻ — dùng khi render. Override luôn thắng data tĩnh.
export function mergeClassification(card) {
  const o = getClassOverride(card.id);
  return o ? { ...card, ...o } : card;
}

/* ---------------- Luyện đề (exams) ----------------
 * Đề tĩnh nạp từ /data/exam-*.json (qua exams.js). Đề người dùng nhập lưu ở
 * KEYS.exams. Tiến độ làm bài (Đọc: đáp án + điểm; Viết: bản nháp) lưu ở
 * KEYS.examProgress keyed theo examId. */
export function getUserExams() {
  return read(KEYS.exams, []);
}
export function saveUserExam(exam) {
  const exams = getUserExams();
  const idx = exams.findIndex((e) => e.id === exam.id);
  if (idx >= 0) exams[idx] = exam;
  else exams.push(exam);
  write(KEYS.exams, exams);
}
export function deleteUserExam(id) {
  write(KEYS.exams, getUserExams().filter((e) => e.id !== id));
}
export function getUserHskk() {
  return read(KEYS.hskk, []);
}
export function saveUserHskk(exam) {
  const exams = getUserHskk();
  const idx = exams.findIndex((e) => e.id === exam.id);
  if (idx >= 0) exams[idx] = exam;
  else exams.push(exam);
  write(KEYS.hskk, exams);
}
export function deleteUserHskk(id) {
  write(KEYS.hskk, getUserHskk().filter((e) => e.id !== id));
}
export function getExamProgress(examId) {
  return read(KEYS.examProgress, {})[examId] || {};
}
function patchExamProgress(examId, patch) {
  const all = read(KEYS.examProgress, {});
  all[examId] = { ...(all[examId] || {}), ...patch, updatedAt: new Date().toISOString() };
  write(KEYS.examProgress, all);
  return all[examId];
}
// Lưu kết quả phần Đọc: { answers, score, total, at } + lịch sử các lần làm.
export function saveReadingResult(examId, result) {
  const prev = read(KEYS.examProgress, {})[examId] || {};
  const at = new Date().toISOString();
  const history = [{ score: result.score, total: result.total, at }, ...(prev.readingHistory || [])].slice(0, 20);
  return patchExamProgress(examId, { reading: { ...result, at }, readingHistory: history });
}
// Lưu bản nháp phần Viết: { title, text }
export function saveWritingDraft(examId, draft) {
  return patchExamProgress(examId, { writing: { ...draft } });
}

/* ---------------- Dịch thuật ("Bài đã dịch") ----------------
 * Mỗi bản: { id, dir:"zh2vi"|"vi2zh", source, sourcePinyin?, user, ref?,
 *   grade?:{ score, corrected, notes:[] }, createdAt }. Lưu local. */
// ---- Bộ từ tự lưu (Từ vựng → tick chọn → lưu thành bộ) ----
export function getWordSets() {
  return read(KEYS.wordSets, []);
}
export function saveWordSet(set) {
  const all = getWordSets();
  const i = all.findIndex((s) => s.id === set.id);
  if (i >= 0) all[i] = set; else all.unshift(set);
  write(KEYS.wordSets, all);
}
export function deleteWordSet(id) {
  write(KEYS.wordSets, getWordSets().filter((s) => s.id !== id));
}
export function getTradSets() {
  return read(KEYS.tradSets, []);
}
export function saveTradSet(set) {
  const all = getTradSets();
  const i = all.findIndex((s) => s.id === set.id);
  if (i >= 0) all[i] = set; else all.unshift(set);
  write(KEYS.tradSets, all);
}
export function deleteTradSet(id) {
  write(KEYS.tradSets, getTradSets().filter((s) => s.id !== id));
}

export function getTranslations() {
  return read(KEYS.translations, []);
}
export function saveTranslation(rec) {
  const all = getTranslations();
  const idx = all.findIndex((t) => t.id === rec.id);
  if (idx >= 0) all[idx] = rec; else all.unshift(rec);
  write(KEYS.translations, all);
  return rec;
}
export function deleteTranslation(id) {
  write(KEYS.translations, getTranslations().filter((t) => t.id !== id));
}

/* ---------------- Daily stats ---------------- */
export function logReview(correct) {
  const key = statsKey();
  const stats = read(key, {});
  const day = new Date().toISOString().slice(0, 10);
  if (!stats[day]) stats[day] = { reviews: 0, correct: 0 };
  stats[day].reviews += 1;
  if (correct) stats[day].correct += 1;
  write(key, stats);
}
export function getStats() {
  return read(statsKey(), {});
}

export function exportAll() {
  return {
    settings: getSettings(),
    decks: getUserDecks(),
    progress: read(KEYS.progress, {}),
    stats: read(KEYS.stats, {}),
    progressTrad: read(KEYS.progress + ".trad", {}),
    statsTrad: read(KEYS.stats + ".trad", {}),
    classOverrides: getClassOverrides(),
    exams: getUserExams(),
    hskk: getUserHskk(),
    examProgress: read(KEYS.examProgress, {}),
    translations: getTranslations(),
    wordSets: getWordSets(),
    tradSrs: getTradSrs(),
    tradMeta: getTradMeta(),
    tradSets: getTradSets(),
    commRecords: getCommRecords(),
    exportedAt: new Date().toISOString(),
  };
}
export function importAll(data) {
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.decks) write(KEYS.decks, data.decks);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.stats) write(KEYS.stats, data.stats);
  if (data.progressTrad) write(KEYS.progress + ".trad", data.progressTrad);
  if (data.statsTrad) write(KEYS.stats + ".trad", data.statsTrad);
  if (data.classOverrides) write(KEYS.classOverrides, data.classOverrides);
  if (data.exams) write(KEYS.exams, data.exams);
  if (data.hskk) write(KEYS.hskk, data.hskk);
  if (data.examProgress) write(KEYS.examProgress, data.examProgress);
  if (data.translations) write(KEYS.translations, data.translations);
  if (data.wordSets) write(KEYS.wordSets, data.wordSets);
  if (data.tradSrs) write(KEYS.tradSrs, data.tradSrs);
  if (data.tradMeta) write(KEYS.tradMeta, data.tradMeta);
  if (data.tradSets) write(KEYS.tradSets, data.tradSets);
  if (data.commRecords) write(KEYS.commRecords, data.commRecords);
}

// store.js — persistence layer (localStorage). Holds settings, decks and SRS progress.

const KEYS = {
  settings: "hsk.settings",
  decks: "hsk.decks",        // user-imported / edited decks
  progress: "hsk.progress",  // SRS state keyed by cardId
  stats: "hsk.stats",        // daily review log
};

export const DEFAULT_SETTINGS = {
  theme: "light",            // light | dark
  accent: "#c0392b",
  hanziScale: 1,             // 0.8 .. 1.6
  fontBase: 16,
  charMode: "simplified",    // simplified | traditional | both
  showPinyinByDefault: false,
  autoPlayAudio: false,
  speechRate: 0.9,
  newPerDay: 15,
  reviewLimit: 100,
  activeDeckId: "hsk6-starter",
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
  return read(KEYS.progress, {});
}
export function getCardState(cardId) {
  return getProgress()[cardId] || null;
}
export function saveCardState(cardId, state) {
  const all = getProgress();
  all[cardId] = state;
  write(KEYS.progress, all);
}
export function resetProgress(deckId) {
  if (!deckId) return write(KEYS.progress, {});
  const all = getProgress();
  for (const k of Object.keys(all)) {
    if (all[k].deckId === deckId) delete all[k];
  }
  write(KEYS.progress, all);
}

/* ---------------- Daily stats ---------------- */
export function logReview(correct) {
  const stats = read(KEYS.stats, {});
  const day = new Date().toISOString().slice(0, 10);
  if (!stats[day]) stats[day] = { reviews: 0, correct: 0 };
  stats[day].reviews += 1;
  if (correct) stats[day].correct += 1;
  write(KEYS.stats, stats);
}
export function getStats() {
  return read(KEYS.stats, {});
}

export function exportAll() {
  return {
    settings: getSettings(),
    decks: getUserDecks(),
    progress: getProgress(),
    stats: getStats(),
    exportedAt: new Date().toISOString(),
  };
}
export function importAll(data) {
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.decks) write(KEYS.decks, data.decks);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.stats) write(KEYS.stats, data.stats);
}

// srs.js — spaced repetition (a compact SM-2 variant).
// A card state: { deckId, ease, interval, reps, due (ISO date-time), lapses }

const DAY = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

export const GRADES = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

export function freshState(deckId) {
  return { deckId, ease: 2.5, interval: 0, reps: 0, due: new Date().toISOString(), lapses: 0 };
}

// Returns the next state given the current one and a grade.
export function schedule(state, grade) {
  const s = { ...state };
  const now = Date.now();

  if (grade === GRADES.AGAIN) {
    s.reps = 0;
    s.lapses += 1;
    s.ease = Math.max(MIN_EASE, s.ease - 0.2);
    s.interval = 0;
    s.due = new Date(now + 60 * 1000).toISOString(); // re-show in ~1 min (same session)
    return s;
  }

  // Correct answers
  s.reps += 1;
  if (grade === GRADES.HARD) s.ease = Math.max(MIN_EASE, s.ease - 0.15);
  if (grade === GRADES.EASY) s.ease += 0.15;

  if (s.reps === 1) {
    s.interval = grade === GRADES.EASY ? 3 : 1;
  } else if (s.reps === 2) {
    s.interval = grade === GRADES.HARD ? 3 : 6;
  } else {
    const mult = grade === GRADES.HARD ? 1.2 : grade === GRADES.EASY ? s.ease * 1.3 : s.ease;
    s.interval = Math.round(s.interval * mult);
  }
  s.interval = Math.max(1, s.interval);
  s.due = new Date(now + s.interval * DAY).toISOString();
  return s;
}

export function isDue(state) {
  if (!state) return true; // never seen → treated as new
  return new Date(state.due).getTime() <= Date.now();
}

export function isNew(state) {
  return !state || state.reps === 0;
}

// Build today's queue: due review cards + up to `newPerDay` new cards.
export function buildQueue(cards, progress, { newPerDay, reviewLimit }) {
  const reviews = [];
  const news = [];
  for (const card of cards) {
    const st = progress[card.id];
    if (isNew(st)) {
      news.push(card);
    } else if (isDue(st)) {
      reviews.push({ card, due: new Date(st.due).getTime() });
    }
  }
  reviews.sort((a, b) => a.due - b.due);
  const queue = reviews.slice(0, reviewLimit).map((r) => r.card);
  queue.push(...news.slice(0, newPerDay));
  return queue;
}

export function humanInterval(days) {
  if (days < 1) return "<1 ngày";
  if (days < 30) return `${days} ngày`;
  if (days < 365) return `${Math.round(days / 30)} tháng`;
  return `${(days / 365).toFixed(1)} năm`;
}

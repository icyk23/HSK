// audio.js — pronunciation via the browser's built-in Chinese TTS (free, offline-capable).

let voices = [];
function loadVoices() {
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickChineseVoice() {
  if (!voices.length) loadVoices();
  return (
    voices.find((v) => /zh[-_]CN/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

export function speak(text, { rate = 0.9 } = {}) {
  if (!window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickChineseVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : "zh-CN";
  u.rate = rate;
  window.speechSynthesis.speak(u);
  return true;
}

export function hasChineseVoice() {
  return !!pickChineseVoice();
}

export function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* ---------- Nhận diện giọng nói (Web Speech Recognition) ----------
 * Miễn phí, chạy trong trình duyệt. Chrome/Edge hỗ trợ tốt; Firefox/Safari
 * (desktop) hiện chưa hỗ trợ → hasRecognition() trả false để UI báo nhẹ. */
export function hasRecognition() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Bắt đầu nghe 1 lần, trả về đối tượng recognition (để .abort() nếu cần).
export function recognizeChinese({ onResult, onError, onEnd } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onError && onError("unsupported"); return null; }
  stopSpeaking(); // tránh micro thu lại tiếng TTS đang đọc
  const rec = new SR();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => { onResult && onResult(e.results[0][0].transcript || ""); };
  rec.onerror = (e) => { onError && onError(e.error || "error"); };
  rec.onend = () => { onEnd && onEnd(); };
  try { rec.start(); } catch (e) { onError && onError(String(e)); return null; }
  return rec;
}

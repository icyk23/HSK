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

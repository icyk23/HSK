// main.js — bootstrap, điều hướng nav 2 tầng, đăng ký service worker.

import { applyTheme } from "./store.js";
import * as ui from "./ui.js";

const VIEWS = {
  study: ui.renderStudy,
  vocab: ui.renderVocab,
  quiz: ui.renderQuiz,
  exam: ui.renderExam,
  comm: ui.renderComm,
  trans: ui.renderTrans,
  listen: ui.renderListen,
  manage: ui.renderManage,
  stats: ui.renderStats,
  settings: ui.renderSettings,
};

// Nav 2 tầng: tầng 1 = module, tầng 2 = tab con (đổi theo module đang chọn).
// Module 1 tab con → ẩn tầng 2.
const NAV = [
  { id: "vocab", label: "🎴 Từ vựng", tabs: [
    { view: "study", label: "Học thẻ" },
    { view: "vocab", label: "Danh sách" },
    { view: "quiz", label: "Quiz" },
    { view: "listen", label: "Nghe" },
    { view: "manage", label: "Nguồn từ" },
  ] },
  { id: "exam", label: "📝 Luyện đề", tabs: [{ view: "exam", label: "Luyện đề" }] },
  { id: "comm", label: "🗣️ Giao tiếp", tabs: [{ view: "comm", label: "Giao tiếp" }] },
  { id: "trans", label: "🌐 Dịch thuật", tabs: [{ view: "trans", label: "Dịch thuật" }] },
  { id: "stats", label: "📊 Tiến độ", tabs: [{ view: "stats", label: "Tiến độ" }] },
  { id: "settings", label: "⚙️ Cài đặt", tabs: [{ view: "settings", label: "Cài đặt" }] },
];

const moduleOf = (view) => NAV.find((m) => m.tabs.some((t) => t.view === view)) || NAV[0];
const lastView = {}; // nhớ tab con gần nhất của mỗi module

let currentView = "study";
const tabs1 = document.getElementById("tabs1");
const tabs2 = document.getElementById("tabs2");

function go(view) {
  currentView = view;
  lastView[moduleOf(view).id] = view;
  renderNav();
  (VIEWS[view] || ui.renderStudy)();
  window.scrollTo({ top: 0 });
}

function tabBtn(label, active, onclick) {
  const b = document.createElement("button");
  b.className = "tab" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function renderNav() {
  const mod = moduleOf(currentView);
  tabs1.innerHTML = "";
  for (const m of NAV) tabs1.append(tabBtn(m.label, m === mod, () => go(lastView[m.id] || m.tabs[0].view)));

  tabs2.innerHTML = "";
  if (mod.tabs.length > 1) {
    tabs2.style.display = "";
    for (const t of mod.tabs) tabs2.append(tabBtn(t.label, t.view === currentView, () => go(t.view)));
  } else {
    tabs2.style.display = "none";
  }
}

document.addEventListener("keydown", (e) => {
  if (currentView === "study") ui.handleStudyKey(e);
});

applyTheme();
go("study");

// PWA service worker (ignored when opened via file://)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

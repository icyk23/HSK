// main.js — bootstrap, tab routing, service worker registration.

import { applyTheme } from "./store.js";
import * as ui from "./ui.js";

const VIEWS = {
  study: ui.renderStudy,
  vocab: ui.renderVocab,
  quiz: ui.renderQuiz,
  exam: ui.renderExam,
  listen: ui.renderListen,
  manage: ui.renderManage,
  stats: ui.renderStats,
  settings: ui.renderSettings,
};

let currentView = "study";

function go(view) {
  currentView = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  (VIEWS[view] || ui.renderStudy)();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) go(tab.dataset.view);
});

document.addEventListener("keydown", (e) => {
  if (currentView === "study") ui.handleStudyKey(e);
});

applyTheme();
go("study");

// PWA service worker (ignored when opened via file://)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

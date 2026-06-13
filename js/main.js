// main.js — bootstrap, điều hướng nav 2 tầng, đăng ký service worker.

import { applyTheme, getSettings, saveSettings } from "./store.js";
import * as ui from "./ui.js";
import * as cc from "./cc.js";
import { icon } from "./icons.js";

const VIEWS = {
  home: ui.renderHome,
  study: ui.renderStudy,
  vocab: ui.renderVocab,
  wordsets: ui.renderWordsets,
  type: ui.renderType,
  quiz: ui.renderQuiz,
  exam: ui.renderExam,
  comm: ui.renderComm,
  trans: ui.renderTrans,
  listen: ui.renderListen,
  manage: ui.renderManage,
  tradHome: ui.renderTradHome,
  tradRules: ui.renderTradRules,
  tradSrs: ui.renderTradSrs,
  tradComp: ui.renderTradComp,
  ingest: ui.renderIngest,
  stats: ui.renderStats,
  settings: ui.renderSettings,
};

// Nav 2 tầng: tầng 1 = module, tầng 2 = tab con (đổi theo module đang chọn).
// Module 1 tab con → ẩn tầng 2.
const NAV = [
  { id: "home", label: "Trang chủ", icon: "home", tabs: [{ view: "home", label: "Trang chủ" }] },
  { id: "vocab", label: "Từ vựng", icon: "cards", tabs: [
    { view: "study", label: "Học thẻ" },
    { view: "vocab", label: "Thư mục" },
    { view: "wordsets", label: "Bộ của tôi" },
    { view: "quiz", label: "Quiz" },
    { view: "listen", label: "Nghe" },
    { view: "manage", label: "Nguồn từ" },
  ] },
  { id: "exam", label: "Luyện đề", icon: "exam", tabs: [{ view: "exam", label: "Luyện đề" }] },
  { id: "comm", label: "Giao tiếp", icon: "comm", tabs: [{ view: "comm", label: "Giao tiếp" }] },
  { id: "trans", label: "Dịch thuật", icon: "trans", tabs: [{ view: "trans", label: "Dịch thuật" }] },
  { id: "phon", label: "Phồn thể", icon: "trad", tabs: [
    { view: "tradHome", label: "Lộ trình" },
    { view: "tradRules", label: "① Bộ thủ" },
    { view: "tradSrs", label: "② Thẻ nhớ" },
    { view: "tradComp", label: "③ Quiz" },
  ] },
  { id: "ingest", label: "Nạp tài liệu", icon: "ingest", tabs: [{ view: "ingest", label: "Nạp tài liệu" }] },
  { id: "stats", label: "Tiến độ", icon: "stats", tabs: [{ view: "stats", label: "Tiến độ" }] },
  { id: "settings", label: "Cài đặt", icon: "settings", tabs: [{ view: "settings", label: "Cài đặt" }] },
];

const moduleOf = (view) => NAV.find((m) => m.tabs.some((t) => t.view === view)) || NAV[0];
const lastView = {}; // nhớ tab con gần nhất của mỗi module

let currentView = "home";
const tabs1 = document.getElementById("tabs1");
const tabs2 = document.getElementById("tabs2");

// Chế độ phồn thể TOÀN CỤC: bật khi charMode="traditional", trừ chính module Phồn thể
// (giữ nguyên 简/繁 minh hoạ ở đó).
function traditionalOn(view = currentView) {
  return getSettings().charMode === "traditional" && !String(view).startsWith("trad");
}
const appEl = document.getElementById("app");
function applyTraditional() { if (traditionalOn()) cc.applyToDom(appEl); }

// Công tắc Giản/Phồn trên thanh điều hướng
const scriptToggle = document.getElementById("scriptToggle");
function renderScriptToggle() {
  const trad = getSettings().charMode === "traditional";
  scriptToggle.textContent = trad ? "繁" : "简";
  scriptToggle.classList.toggle("on", trad);
  scriptToggle.title = trad ? "Đang Phồn thể — bấm về Giản thể" : "Đang Giản thể — bấm sang Phồn thể";
}
scriptToggle.onclick = () => {
  const trad = getSettings().charMode === "traditional";
  saveSettings({ charMode: trad ? "simplified" : "traditional" });
  renderScriptToggle();
  go(currentView);
};

async function go(view) {
  currentView = view;
  lastView[moduleOf(view).id] = view;
  renderNav();
  await (VIEWS[view] || ui.renderStudy)();
  applyTraditional();
  window.scrollTo({ top: 0 });
}

// Nội dung render lại trong-màn (lật thẻ, câu kế, sprint…) → chuyển qua MutationObserver.
let ccScheduled = false, ccBusy = false;
function scheduleCc() {
  if (ccScheduled || ccBusy || !traditionalOn()) return;
  ccScheduled = true;
  requestAnimationFrame(() => { ccScheduled = false; ccBusy = true; try { cc.applyToDom(appEl); } finally { ccBusy = false; } });
}
function startCcObserver() {
  new MutationObserver((muts) => {
    if (ccBusy || !traditionalOn()) return;
    for (const m of muts) { if (m.addedNodes.length || m.type === "characterData") { scheduleCc(); break; } }
  }).observe(appEl, { childList: true, subtree: true, characterData: true });
}

// Cho phép các module (ui.js) chuyển sang module/tab khác — vd Bài học → Học thẻ/Giao tiếp/Dịch thuật.
export function navigate(view) { go(view); }

// Chuyển track Giản/Phồn (dùng từ Trang chủ); cập nhật công tắc + render lại.
export function setScript(script) {
  saveSettings({ charMode: script === "trad" ? "traditional" : "simplified" });
  renderScriptToggle();
  go(currentView);
}

function tabBtn(label, active, onclick, iconName) {
  const b = document.createElement("button");
  b.className = "tab" + (active ? " active" : "");
  if (iconName) {
    b.innerHTML = `<span class="ic">${icon(iconName)}</span><span class="tab-txt"></span>`;
    b.querySelector(".tab-txt").textContent = label;
  } else {
    b.textContent = label;
  }
  b.onclick = onclick;
  return b;
}

function renderNav() {
  const mod = moduleOf(currentView);
  tabs1.innerHTML = "";
  for (const m of NAV) tabs1.append(tabBtn(m.label, m === mod, () => go(lastView[m.id] || m.tabs[0].view), m.icon));

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
  else if (currentView === "tradSrs") ui.handleTradKey(e);
  else if (currentView === "comm") ui.handleCommKey(e);
});

applyTheme();
renderScriptToggle();
startCcObserver();
cc.ensureS2T().then(() => { go("home"); });

// PWA service worker (ignored when opened via file://)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

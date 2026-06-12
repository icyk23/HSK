// Bộ icon SVG line (24x24, stroke = currentColor) — thay cho emoji.
// Dùng: icon("name") → chuỗi SVG; iconEl("name") → node <span class="ic">.
const S = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

const ICONS = {
  // Nav tầng 1
  cards: S('<rect x="3" y="5.5" width="13" height="15" rx="2.5"/><path d="M8 2.5h11a2 2 0 0 1 2 2v12"/><path d="M6.5 10h6M6.5 14h4"/>'),
  exam: S('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8.5 3.5h7v3h-7z"/><path d="M8 12l2 2 4-4"/>'),
  comm: S('<path d="M4 5.5h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" transform="translate(1 0.5)"/><path d="M6 8.5h7M6 11h4"/>'),
  trans: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>'),
  trad: S('<rect x="3" y="3" width="12" height="12" rx="1.5"/><rect x="9" y="9" width="12" height="12" rx="1.5"/>'),
  ingest: S('<path d="M12 3v10m0 0l-4-4m4 4l4-4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  stats: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" transform="translate(-1 0)"/><path d="M4 20V11M9.5 20V5M15 20v-8M20.5 20v-4"/>'),
  settings: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>'),

  // Phương thức Giao tiếp
  chat: S('<path d="M4 5h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V7a2 2 0 0 1 1-1.7z"/>'),
  mic: S('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  timer: S('<circle cx="12" cy="13" r="8"/><path d="M12 13V8.5M9.5 2.5h5"/>'),
  swap: S('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),

  // Nút / chung
  speaker: S('<path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  replay: S('<path d="M4 12a8 8 0 1 1 2.5 5.8M4 18v-4h4"/>'),
  dice: S('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  check: S('<path d="M4 12.5l5 5L20 6"/>'),
  skip: S('<path d="M5 5l9 7-9 7zM18 5v14"/>'),
  headphone: S('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>'),
};

export function icon(name) { return ICONS[name] || ""; }

export function iconEl(name, cls = "ic") {
  const s = document.createElement("span");
  s.className = cls;
  s.innerHTML = icon(name);
  return s;
}

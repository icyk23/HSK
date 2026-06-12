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
  ai: S('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18.5 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  save: S('<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 21v-6h8v6"/>'),
  eye: S('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  bulb: S('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  plug: S('<path d="M9 2v5M15 2v5M7 7h10v3a5 5 0 0 1-10 0V7zM12 15v5"/>'),
  reset: S('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 3v4h4"/>'),
  download: S('<path d="M12 3v11m0 0l-4-4m4 4l4-4M4 19h16"/>'),
  upload: S('<path d="M12 21V10m0 0L8 14m4-4l4 4M4 5h16"/>'),
  keyboard: S('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M16.5 13h.01M9 13h6"/>'),
  play: S('<path d="M6 4.5l13 7.5-13 7.5z"/>'),
  trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  book: S('<path d="M4 4.5A2 2 0 0 1 6 3h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 19.5A2 2 0 0 1 6 18h13v3H6a2 2 0 0 1-2-1.5z"/>'),
};

export function icon(name) { return ICONS[name] || ""; }

export function iconEl(name, cls = "ic") {
  const s = document.createElement("span");
  s.className = cls;
  s.innerHTML = icon(name);
  return s;
}

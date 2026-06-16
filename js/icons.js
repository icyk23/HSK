// Bộ icon SVG line (24x24, stroke = currentColor) — phong cách ANGULAR/sắc cạnh
// hợp theme esports (góc nhọn, square caps, miter joins). icon("name") → SVG; iconEl("name") → <span class="ic">.
const S = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="6" aria-hidden="true">${p}</svg>`;

const ICONS = {
  // Nav tầng 1
  home: S('<path d="M3 11.5L12 3.5l9 8"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/>'),
  cards: S('<path d="M3 6h13v14H3z"/><path d="M7 3h13v13"/><path d="M6.5 10.5h6M6.5 14h4"/>'),
  exam: S('<path d="M4 3h16v18H4z"/><path d="M8.5 3h7v3.5h-7z"/><path d="M8 12.5l2 2 4-4"/>'),
  comm: S('<path d="M3 5h16v9h-9l-4 3.5V14H3z"/><path d="M6.5 8.5h9M6.5 11h6"/>'),
  trans: S('<path d="M12 3l9 9-9 9-9-9z"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>'),
  trad: S('<path d="M3 3h11v11H3z"/><path d="M10 10h11v11H10z"/>'),
  ingest: S('<path d="M12 3v10m0 0l-4-4m4 4l4-4"/><path d="M4 14.5V20h16v-5.5"/>'),
  stats: S('<path d="M3 21V3"/><path d="M3 21h18"/><path d="M7 21v-7h3v7M13 21V9h3v12"/>'),
  settings: S('<path d="M12 8.5l3 1.7v3.6L12 15.5l-3-1.7v-3.6z"/><path d="M12 2.5v3M12 18.5v3M3.5 7l2.6 1.5M17.9 15.5L20.5 17M20.5 7l-2.6 1.5M6.1 15.5L3.5 17"/>'),

  // Phương thức Giao tiếp
  chat: S('<path d="M3 4.5h14v9.5H9l-4 3.5V14H3z"/>'),
  mic: S('<path d="M9 3h6v8.5a3 3 0 0 1-6 0z"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  timer: S('<path d="M12 5l7 4v4l-7 4-7-4V9z"/><path d="M12 9.5V12.5l2 1.2M9.5 2.5h5"/>'),
  swap: S('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),

  // Nút / chung
  speaker: S('<path d="M3 9.5h4L12 5.5v13L7 14.5H3z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  replay: S('<path d="M5 12a7 7 0 1 1 2.2 5.1M5 17.5V12h5.5"/>'),
  dice: S('<path d="M3.5 3.5h17v17h-17z"/><path d="M8 8h.01M16 16h.01M12 12h.01"/>'),
  check: S('<path d="M4 12.5l5 5L20 6"/>'),
  skip: S('<path d="M5 5l9 7-9 7zM18 5v14"/>'),
  headphone: S('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M3 13h4v6H3zM17 13h4v6h-4z"/>'),
  ai: S('<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M18 14l.8 2.1 2.2.8-2.2.8L18 20l-.8-2.3-2.2-.8 2.2-.8z"/>'),
  save: S('<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  eye: S('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><path d="M12 9l3 3-3 3-3-3z"/>'),
  bulb: S('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  plug: S('<path d="M9 2v5M15 2v5M7 7h10v3a5 5 0 0 1-10 0V7zM12 15v5"/>'),
  reset: S('<path d="M5 12a7 7 0 1 0 2.2-5.1M5 3v4h4"/>'),
  download: S('<path d="M12 3v11m0 0l-4-4m4 4l4-4M4 19h16"/>'),
  upload: S('<path d="M12 21V10m0 0L8 14m4-4l4 4M4 5h16"/>'),
  keyboard: S('<path d="M2.5 6h19v12h-19z"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M16.5 13h.01M9 13h6"/>'),
  play: S('<path d="M6 4.5l13 7.5-13 7.5z"/>'),
  trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  book: S('<path d="M4 4h8l1 1.5L14 4h6v15h-7l-1 1.5L11 19H4z"/><path d="M12 5.5V20"/>'),
  file: S('<path d="M6 3h8l5 5v13H6z"/><path d="M13 3v6h6"/>'),
  image: S('<path d="M3 4.5h18v15H3z"/><path d="M3 16l5-5 4 4 3-3 6 6"/><path d="M8.5 9.5h.01"/>'),
  search: S('<path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z"/><path d="M16.5 16.5L21 21"/>'),
  folder: S('<path d="M3 5h6l2 2.5h10V20H3z"/>'),
  audio: S('<path d="M8 4l9-1v13"/><path d="M5 14h3v5H5zM14 13h3v5h-3z"/>'),

  // Cảnh Giao tiếp (khớp scene id) + video
  restaurant: S('<path d="M6 3v7M9 3v7M7.5 10v11M7.5 3v3a1.5 1.5 0 0 1-3 0V3M16.5 3c-1.4 0-2.5 2-2.5 5s1.1 4 2.5 4v9"/>'),
  shopping: S('<path d="M3 5h2.5l2 11h10l2-8H7"/><path d="M9 19.5h.01M16.5 19.5h.01"/>'),
  directions: S('<path d="M12 3v18"/><path d="M12 5h6l2.5 2.5L18 10h-6zM12 12H6l-2.5 2.5L6 17h6z"/>'),
  hospital: S('<path d="M4 4h16v16H4z"/><path d="M12 8v8M8 12h8"/>'),
  intro: S('<path d="M8 9.5a2.4 2.4 0 1 0 0-.01M16 9.5a2.4 2.4 0 1 0 0-.01"/><path d="M3.5 20v-1.5A3.3 3.3 0 0 1 6.8 15h2.4M14.8 15h2.4a3.3 3.3 0 0 1 3.3 3.5V20"/>'),
  work: S('<path d="M3 8h18v11H3z"/><path d="M8.5 8V5.5h7V8M3 13h18"/>'),
  video: S('<path d="M3 6h13v12H3z"/><path d="M16 10l5-3v10l-5-3z"/>'),
};

export function icon(name) { return ICONS[name] || ""; }

export function iconEl(name, cls = "ic") {
  const s = document.createElement("span");
  s.className = cls;
  s.innerHTML = icon(name);
  return s;
}

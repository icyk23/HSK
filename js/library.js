// library.js — kho tài liệu đề thi lưu trong IndexedDB (PDF, audio, ảnh, ebook…).
// File lớn không để trong localStorage được, nên dùng IndexedDB (lưu Blob trực tiếp).
// 2 store: "collections" (metadata 1 bộ tài liệu) và "files" (blob từng file).

const DB_NAME = "hsk-library";
const DB_VER = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("collections")) db.createObjectStore("collections", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}
function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

const uid = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

// Tạo 1 bộ tài liệu từ danh sách file [{name, blob, size}].
export async function createCollection(name, files) {
  const db = await openDB();
  const collId = "col-" + uid();
  const fileMeta = [];
  const t = tx(db, ["collections", "files"], "readwrite");
  const fileStore = t.objectStore("files");
  for (const f of files) {
    const id = "f-" + uid();
    fileStore.put({ id, blob: f.blob });
    fileMeta.push({ id, name: f.name, type: f.blob.type, size: f.size });
  }
  const coll = { id: collId, name, createdAt: new Date().toISOString(), fileMeta };
  t.objectStore("collections").put(coll);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  return coll;
}

export async function listCollections() {
  const db = await openDB();
  const all = await reqP(tx(db, ["collections"], "readonly").objectStore("collections").getAll());
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getCollection(id) {
  const db = await openDB();
  return reqP(tx(db, ["collections"], "readonly").objectStore("collections").get(id));
}

export async function deleteCollection(id) {
  const db = await openDB();
  const coll = await getCollection(id);
  const t = tx(db, ["collections", "files"], "readwrite");
  if (coll) for (const fm of coll.fileMeta) t.objectStore("files").delete(fm.id);
  t.objectStore("collections").delete(id);
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export async function getFileBlob(fileId) {
  const db = await openDB();
  const rec = await reqP(tx(db, ["files"], "readonly").objectStore("files").get(fileId));
  return rec ? rec.blob : null;
}

// Tổng dung lượng 1 bộ (byte).
export function collectionSize(coll) {
  return (coll.fileMeta || []).reduce((s, f) => s + (f.size || 0), 0);
}

// Phân loại file để chọn cách hiển thị.
export function fileKind(meta) {
  const t = meta.type || "";
  const ext = (meta.name.split(".").pop() || "").toLowerCase();
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  if (t.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "aac", "flac"].includes(ext)) return "audio";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (t.startsWith("text/") || ["txt", "srt", "lrc"].includes(ext)) return "text";
  if (ext === "epub" || ext === "mobi") return "ebook";
  return "other";
}

export function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

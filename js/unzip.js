// unzip.js — giải nén file .zip ngay trong trình duyệt, KHÔNG cần thư viện ngoài.
// Dùng DecompressionStream('deflate-raw') (có sẵn ở trình duyệt hiện đại) cho các
// entry nén DEFLATE, và đọc trực tiếp entry lưu nguyên (store). Parse cấu trúc ZIP
// qua Central Directory nên xử lý được cả zip có "data descriptor".

const SIG_EOCD = 0x06054b50;
const SIG_CDH = 0x02014b50;

// MIME theo đuôi file để Blob phát/hiển thị được trong <iframe>/<audio>/<img>.
const MIME = {
  pdf: "application/pdf",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  epub: "application/epub+zip", mobi: "application/x-mobipocket-ebook",
  txt: "text/plain", srt: "text/plain", lrc: "text/plain",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export function mimeFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Response(bytes).body.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeName(bytes, isUtf8) {
  try {
    return new TextDecoder(isUtf8 ? "utf-8" : "gb18030").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// Tìm bản ghi End Of Central Directory (quét ngược từ cuối file).
function findEOCD(dv) {
  const max = Math.min(dv.byteLength, 0xffff + 22);
  for (let i = dv.byteLength - 22; i >= dv.byteLength - max; i--) {
    if (i < 0) break;
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

// Giải nén ArrayBuffer → [{ name, blob, size }]. onProgress(done, total) tùy chọn.
export async function unzip(arrayBuffer, onProgress) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  const eocd = findEOCD(dv);
  if (eocd < 0) throw new Error("Không phải file ZIP hợp lệ (thiếu EOCD).");

  const count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw new Error("ZIP64 chưa được hỗ trợ.");

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CDH) break;
    const flag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = decodeName(u8.subarray(p + 46, p + 46 + nameLen), (flag & 0x800) !== 0);
    entries.push({ name, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.name.endsWith("/")) continue;                 // bỏ thư mục
    if (e.name.split("/").pop().startsWith(".")) continue; // bỏ file ẩn / __MACOSX
    if (e.name.includes("__MACOSX")) continue;
    // Đọc local header để tìm điểm bắt đầu dữ liệu (size lấy từ central dir).
    const lh = e.localOff;
    if (dv.getUint32(lh, true) !== 0x04034b50) continue;
    const lNameLen = dv.getUint16(lh + 26, true);
    const lExtraLen = dv.getUint16(lh + 28, true);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + e.compSize);
    let data;
    if (e.method === 0) data = comp;                    // store
    else if (e.method === 8) data = await inflateRaw(comp); // deflate
    else continue;                                       // method khác: bỏ qua
    out.push({ name: e.name, blob: new Blob([data], { type: mimeFor(e.name) }), size: data.byteLength });
    onProgress && onProgress(out.length, entries.length);
  }
  return out;
}

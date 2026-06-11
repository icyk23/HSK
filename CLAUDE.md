# CLAUDE.md — App học tiếng Trung (repo HSK)

> Bộ nhớ dự án cho Claude Code. Đọc file này trước khi làm bất kỳ việc gì.
> Cập nhật mục **TRẠNG THÁI** sau mỗi task.

---

## Quyết định nền tảng

- **Hướng đi:** *mở rộng* PWA vanilla-JS hiện có trong repo này (không xây lại bằng
  React/FastAPI). Tái dùng code đang chạy: flashcard, SRS, TTS, quiz, import.
- **Browser-first:** mọi thứ chạy 100% trong trình duyệt (localStorage, fetch JSON
  tĩnh, offline qua service worker). **Backend FastAPI chỉ thêm khi cần Python**
  (jieba, yt-dlp, Qwen3...) — dự kiến từ module Dịch thuật / Nạp video trở đi.
- **Miễn phí / local hoàn toàn.** Không API trả phí. AI = Ollama + Qwen3 (local, sau).
- Giao diện **tiếng Việt**; nội dung học là tiếng Trung. HSK **6 cấp (bản cũ)**.

---

## Kiến trúc thông tin (IA) — 5 module + global

Hiện app vẫn dùng **1 hàng tab phẳng** (chưa refactor). Khi có nội dung module mới
thì dựng **nav 2 tầng** theo cấu trúc đã chốt dưới đây:

```
Tầng 1 (module):  🎴 Từ vựng   📝 Luyện đề   🗣️ Giao tiếp   🌐 Dịch thuật   繁 Phồn thể
                                        global:  📥 Nạp nội dung   📊 Tiến độ   ⚙️ Cài đặt
Tầng 2 (tab con): đổi theo module đang chọn
```

| Module | Tab con | Trạng thái |
|--------|---------|-----------|
| **Từ vựng** 🎴 | Học thẻ · Danh sách · Quiz · Nghe · Nguồn từ | ✅ đã có (trừ đổi tên) |
| **Luyện đề** 📝 | HSK6 Đọc · HSK6 Viết · HSKK 高级 | 🟡 Đọc tự chấm + Viết khung (缩写) + HSKK 高级 khung 3 phần đã có |
| **Giao tiếp** 🗣️ | Luyện phản xạ · Luyện phát âm | 🟡 4 drill (Hỏi–đáp · Shadowing+Phát âm · Sprint · Thay thế mẫu câu) đã có; HSKK 高级 chưa |
| **Dịch thuật** 🌐 | Trung→Việt · Việt→Trung · Bài đã dịch | 🟡 Workspace 2 chiều + lưu/ôn (Bài đã dịch) đã có; chấm/sửa cần Qwen3 (/grade) |
| **Phồn thể** 繁 | Bài học · Nhận diện thành phần | ⬜ chưa xây |
| **Nạp nội dung** 📥 *(global)* | Video · Truyện · Tài liệu | ⬜ chưa xây |
| **Tiến độ** 📊 · **Cài đặt** ⚙️ *(global)* | — | ✅ đã có |

Khớp **3 trụ cột** (Từ vựng · Dịch thuật · Giao tiếp) + Luyện đề + Phồn thể độc lập.

- **Luyện đề** gom mọi dạng luyện thi: HSK6 đọc/viết **và HSKK 高级** (nói theo đề thi).
- **Giao tiếp** ≠ luyện đề: tập **phản xạ** (Việt→Trung tức thì / nghe→dịch nhanh) và
  **phát âm**. Ngân hàng câu lấy từ **tài liệu chuyên ngành / video / truyện đã nạp**
  → luyện theo chủ đề. (Chi tiết hóa khi bắt đầu xây.)
- **Bài đã dịch** (trong Dịch thuật) = kho lưu bản dịch của người dùng + bản Qwen3
  chấm/sửa, để xem lại và ôn lỗi.

### Đổi tên khi dựng nav (chưa làm)
- App: **"Học HSK6"** → **"Học tiếng Trung"**
- Tab **"Từ vựng"** (trình duyệt lọc) → **"Danh sách"** (vì "Từ vựng" là tên module)
- Tab **"Bộ thẻ"** → **"Nguồn từ"**

---

## Cấu trúc mã (app không cần dependency lúc chạy)

```
index.html              khung + hàng tab
css/style.css           giao diện (biến CSS, theme)
js/main.js              bootstrap + routing tab + đăng ký service worker
js/ui.js                render mọi màn hình (study, vocab, quiz, listen, manage, stats, settings)
js/store.js             localStorage: settings, decks, progress, stats, classOverrides
js/srs.js               SRS kiểu SM-2 (+ trạng thái "đã thuộc")
js/audio.js             phát âm (Web Speech API)
js/decks.js             nạp deck + parse CSV import
js/classify.js          pipeline phân loại Lớp 1+2 (dùng cả browser lẫn build script)
js/comm.js              Giao tiếp: nạp cảnh mẫu + tách câu (text/.srt/song ngữ) + lấy câu từ thư viện
data/comm-scenes.json   6 cảnh mẫu khẩu ngữ (hỏi-đáp · câu lẻ · mẫu câu thay thế)
data/hsk-words.json     5.002 từ HSK1–6 đã phân loại (sinh bởi build script)
data/vocab.xlsx         nguồn gốc 5.002 từ (để build lại)
scripts/build-words.mjs TOOL build: xlsx → phân loại → hsk-words.json (npm run build:words)
package.json            CHỈ cho build tooling (xlsx, opencc-js); app không dùng
sw.js, manifest.*       offline / cài như app
backend/                Backend Qwen3 (FastAPI) — TÙY CHỌN, chạy ở máy người dùng
  app.py                /extract bóc ảnh·PDF·audio·video → tách câu → dịch Việt (Ollama); /health
  requirements.txt      fastapi/uvicorn/httpx + pymupdf + rapidocr(OCR) + faster-whisper(ASR)
  README.md             hướng dẫn cài & chạy (ollama pull qwen2.5 → uvicorn app:app)
```

## Mô hình dữ liệu thẻ (card)

`{ id, simplified, traditional, pinyin, han_viet, meaning, example, example_pinyin,
   example_vi, hsk_level, source, struct_group, semantic_group,
   classification_source, classification_conf, needs_review }`

- **Sửa nhóm thủ công** lưu TÁCH RIÊNG trong `localStorage["hsk.classOverrides"]`
  → nạp lại data tĩnh không ghi đè. `classification_source="manual"` bất khả ghi đè.
  `store.mergeClassification(card)` áp override lúc render.

---

## Phân loại từ (xem chi tiết VOCAB_CLASSIFICATION_SYSTEM.md)

Pipeline 3 lớp: **Lớp 1** danh sách từ chức năng (F1–F6) · **Lớp 2** keyword tiếng Việt
+ gợi ý Hán tự (A1–E2) · **Lớp 3** Qwen3 (chưa chạy — cần backend).
- struct_group S1–S5 theo số chữ Hán.
- Hiện trạng: ~24% phân loại bởi Lớp 1+2 (precision cao), ~76% chờ Qwen3.

---

## Quy ước làm việc

1. Đọc CLAUDE.md trước khi làm.
2. Lập plan → người dùng duyệt → mới code. Hỏi lại nếu chưa rõ.
3. Làm từng task, kiểm tra chạy được (chụp màn hình headless) rồi mới sang task kế.
4. Commit sau mỗi task, message tiếng Việt ngắn. Branch: `claude/nifty-knuth-58ucui`.
5. Cập nhật TRẠNG THÁI sau khi xong.

---

## TRẠNG THÁI HIỆN TẠI

```
[x] Nền PWA vanilla-JS (flashcard, SRS SM-2, TTS, quiz, import, theme, offline)
[x] Phase 1 — Import 5.002 từ HSK1–6 + build phân loại + nối deck vào app
[x] Mở rộng phân loại Lớp 2 (khớp Hán tự + keyword) — coverage ~24%, precision cao
[x] Học: nút Bỏ qua (S) / Đã thuộc (K)
[x] Phase 2 — Tab Từ vựng: lọc cấp/nhóm/cần-xem-lại + sửa nhóm thủ công + học theo lọc
[x] Chốt IA 5 module (chưa dựng nav 2 tầng — hoãn tới khi có nội dung module mới)
[x] Tinh chỉnh Từ vựng: thẻ giàu hơn (HV/nhóm/tô đậm ví dụ), trạng thái+sắp xếp+đếm Danh sách, tiến độ theo cấp & nhóm
[~] Task 3c — script Qwen3 (scripts/classify-qwen.mjs) SẴN SÀNG; chờ chạy trên máy có Ollama (npm run classify:qwen)
[x] Task 3b — Luyện đề HSK6: tab "🧩 Luyện đề" (phẳng); Đọc 4 phần trắc nghiệm tự chấm
    (病句/选词/选句/阅读) + Viết 缩写 (bài đọc, đồng hồ, đếm chữ, lưu nháp, chỗ chấm Qwen3);
    đề mẫu data/exam-hsk6.json (3 đề) + nhập đề JSON (js/exams.js). Chấm Viết bằng Qwen3 & HSKK chờ làm.
[x] Kho tài liệu đề thi (trong Luyện đề): tải .zip → tự giải nén thuần trình duyệt
    (js/unzip.js dùng DecompressionStream, KHÔNG cần thư viện) → lưu IndexedDB (js/library.js)
    → xem PDF (iframe), nghe audio, xem ảnh/txt offline. Bóc đề từ PDF bằng Qwen3 chờ backend.
[x] Giao tiếp — tab "🗣️ Giao tiếp" (phẳng); 4 drill: Hỏi–đáp tình huống · Shadowing+Phát âm
    (Web Speech Recognition zh-CN, chấm % khớp chữ Hán) · Sprint Việt→Trung (đếm giờ) · Thay thế
    mẫu câu (句型替换). Nguồn câu: 6 cảnh mẫu data/comm-scenes.json + dán văn bản/.srt/cặp song ngữ
    + bóc từ file .txt thư viện (js/comm.js). Bóc ảnh/video/PDF & tự dịch Việt→Trung chờ Qwen3.
[~] Backend Qwen3 (backend/ — FastAPI) SẴN SÀNG, chờ chạy trên máy có Ollama:
    POST /extract bóc ảnh (OCR RapidOCR) · PDF (PyMuPDF, scan→OCR) · audio/video (faster-whisper)
    → tách câu → dịch Việt bằng Qwen3; GET /health báo năng lực. Frontend đã nối: Cài đặt → "AI ·
    Qwen3" (dán URL + kiểm tra); Giao tiếp hiện nút "🤖 Bóc tự động" cho file media khi backend bật
    (thay nhãn "sắp có"), và upload thẳng ảnh/video ở ô nguồn cá nhân. OCR/ASR là lib tùy chọn.
[x] HSKK 高级 (trong Luyện đề) — khung 3 phần thi nói: 听后复述 (nghe→kể lại, ghi âm để tự nghe)
    · 朗读 (đọc to, chấm phát âm % khớp chữ Hán) · 回答问题 (bấm giờ nói 2′ + gợi ý dàn ý). Đề mẫu
    ngắn data/hskk-gaoji.json (1 đề) qua js/exams.js (getHskkExams). Đề đầy đủ chờ Qwen3 sinh / nhập.
[ ] Giao tiếp/HSKK — cá nhân hóa bằng Qwen3 (tự dịch, sinh đề/câu hỏi theo chủ đề người dùng)
[x] Dịch thuật — tab "🌐 Dịch thuật" (phẳng); workspace 2 chiều (中→Việt / Việt→中): chọn/dán
    nguồn hoặc 🎲 câu mẫu từ thẻ (kèm bản tham khảo + pinyin + TTS) → viết bản dịch → 💾 lưu vào
    "Bài đã dịch" (store.translations) để ôn lại. Nút "🤖 Chấm & sửa (Qwen3)" gọi backend POST
    /grade → điểm 0-10 + bản sửa + bản tham khảo + nhận xét tiếng Việt (chờ bật Ollama).
[ ] Phồn thể — module độc lập
[ ] Nạp nội dung — video / truyện / tài liệu
[ ] Dựng nav 2 tầng + đổi tên (khi đã có ≥1 module mới)
```

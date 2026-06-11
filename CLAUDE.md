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
| **Luyện đề** 📝 | HSK6 Đọc · HSK6 Viết | ⬜ chưa xây |
| **Giao tiếp** 🗣️ | HSKK 高级 · Luyện phát âm | ⬜ chưa xây |
| **Dịch thuật** 🌐 | Trung→Việt · Việt→Trung · Lịch sử | ⬜ chưa xây |
| **Phồn thể** 繁 | Bài học · Nhận diện thành phần | ⬜ chưa xây |
| **Nạp nội dung** 📥 *(global)* | Video · Truyện · Tài liệu | ⬜ chưa xây |
| **Tiến độ** 📊 · **Cài đặt** ⚙️ *(global)* | — | ✅ đã có |

Khớp **3 trụ cột** (Từ vựng · Dịch thuật · Giao tiếp) + Luyện đề + Phồn thể độc lập.

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
data/hsk-words.json     5.002 từ HSK1–6 đã phân loại (sinh bởi build script)
data/vocab.xlsx         nguồn gốc 5.002 từ (để build lại)
scripts/build-words.mjs TOOL build: xlsx → phân loại → hsk-words.json (npm run build:words)
package.json            CHỈ cho build tooling (xlsx, opencc-js); app không dùng
sw.js, manifest.*       offline / cài như app
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
[ ] Task 3c — Cài Ollama + Qwen3, phân loại Lớp 3 cho ~76% từ còn lại
[ ] Luyện đề HSK6 (đọc + viết)
[ ] Giao tiếp — HSKK 高级 + luyện phát âm
[ ] Dịch thuật — Trung↔Việt + Qwen3 chấm
[ ] Phồn thể — module độc lập
[ ] Nạp nội dung — video / truyện / tài liệu
[ ] Dựng nav 2 tầng + đổi tên (khi đã có ≥1 module mới)
```

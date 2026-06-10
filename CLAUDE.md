# CLAUDE.md — App học tiếng Trung cá nhân (Học HSK6 · 繁简)

> File này là "bộ nhớ dự án". Đọc file này trước khi bắt đầu mỗi phiên làm việc.
> Sau khi hoàn thành mỗi Pha, cập nhật mục TRẠNG THÁI ở cuối file.

---

## Mô tả dự án

App web cá nhân học tiếng Trung, **chạy hoàn toàn trong trình duyệt** (PWA), học
được offline, cài như app trên điện thoại. Xoay quanh 3 trụ cột: **Từ vựng ·
Dịch thuật · Giao tiếp**, ưu tiên ôn thi **HSK6** và học **chữ phồn thể**.

### Kiến trúc thực tế: PWA hybrid (KHÔNG có backend thường trực)

App là **vanilla JS + ES modules**, không framework, không server chạy nền. Đây
là quyết định kiến trúc có chủ đích để bám sát ràng buộc *miễn phí / local / máy
8GB RAM* (xem mục "Vì sao hybrid" bên dưới).

Python chỉ đóng vai trò **script chuẩn bị dữ liệu offline** (chạy 1 lần, kết quả
bake thành JSON tĩnh cho app đọc). Backend FastAPI chỉ được thêm sau này **khi
nào thật sự cần** (module video: yt-dlp + faster-whisper).

### Vì sao hybrid thay vì FastAPI + React

Rà từng tính năng cho thấy ~90% không cần một server chạy nền:
- Phân loại Lớp 1–2 (rule + keyword): logic thuần → chạy trong JS / script Python.
- Phân loại Lớp 3 (Qwen3): **Ollama vốn đã là HTTP server local** → browser gọi
  thẳng `localhost:11434` (cần bật `OLLAMA_ORIGINS`).
- SRS, flashcard, quiz, giản↔phồn, luyện đề: chạy trong browser.
- Import 5.002 từ Excel: chỉ cần script chạy 1 lần → xuất `data/words.json`.
- **Chỉ module video** (yt-dlp + whisper) là thật sự cần Python → để dành Pha sau.

Lợi ích: nhẹ RAM, deploy miễn phí GitHub Pages, offline, tận dụng code đã chạy được.

---

## Ràng buộc cứng

- **Miễn phí / chạy local hoàn toàn.** KHÔNG dùng OpenAI, Google AI, hay API trả phí.
- **AI** = **Ollama + Qwen3** local trên GPU, browser gọi trực tiếp. Chưa cần ở Pha 0–1.
- Giao diện **tiếng Việt**; nội dung học là tiếng Trung.
- Cấp độ theo **HSK cũ — 6 cấp**.

---

## Môi trường & máy

| Thông số | Giá trị |
|----------|---------|
| OS | Windows — lệnh chuẩn bị dữ liệu viết cho **PowerShell** |
| RAM | 8 GB — không cài thư viện nặng khi chưa cần |
| GPU | Có GPU rời (VRAM xác nhận sau → ảnh hưởng cỡ Qwen3) |
| Python | 3.11+ trong **venv** — chỉ để chạy script chuẩn bị dữ liệu |
| Chạy app | Bất kỳ static server: `python -m http.server 8000` hoặc `npx serve` |

**Lưu ý Windows:** dùng `opencc-python-reimplemented` (thuần Python). `ffmpeg` chỉ
cài khi đến module video.

---

## Stack kỹ thuật

**Frontend (app chính):** HTML + CSS thuần + Vanilla JS (ES modules) · PWA (service worker + manifest)
**Lưu trữ:** `localStorage` (settings, tiến độ SRS, bộ thẻ tự tạo) + JSON tĩnh trong `data/`
**SRS:** thuật toán kiểu SM-2 (`js/srs.js`) — có thể nâng lên FSRS sau
**Phát âm:** Web Speech API (giọng tiếng Trung của trình duyệt) — miễn phí, offline
**Script chuẩn bị dữ liệu (Python, chạy 1 lần):** `openpyxl` · `opencc-python-reimplemented` · (sau: `jieba`, `pypinyin`)
**LLM local (Pha 3+):** Ollama + Qwen3, browser fetch `localhost:11434`
**Video (Pha sau, mới cần backend):** yt-dlp + faster-whisper

---

## Cấu trúc thư mục (thực tế)

```
HSK/
├── CLAUDE.md
├── ROADMAP.md
├── VOCAB_CLASSIFICATION_SYSTEM.md   ← bộ quy tắc phân loại từ
├── README.md
├── index.html                       ← khung app + thanh tab
├── css/style.css                    ← giao diện + theme (biến CSS)
├── js/
│   ├── main.js                      ← bootstrap + điều hướng tab + đăng ký SW
│   ├── ui.js                        ← render mọi màn hình
│   ├── store.js                     ← localStorage (settings, tiến độ, bộ thẻ)
│   ├── srs.js                       ← thuật toán lặp lại ngắt quãng
│   ├── audio.js                     ← phát âm (Web Speech API)
│   ├── decks.js                     ← nạp bộ thẻ + parse CSV import
│   └── words.js                     ← nạp kho từ HSK + nhãn nhóm + bộ lọc
├── data/
│   ├── words.json                   ← 5.002 từ HSK1–6 đã gắn nhóm (sinh từ build_vocab.py)
│   ├── hsk6-starter.json            ← bộ thẻ HSK6 khởi đầu (flashcard)
│   ├── stories/                     ← truyện mẫu để luyện dịch
│   └── translation/                 ← câu mẫu luyện dịch
├── scripts/
│   └── build_vocab.py               ← Excel HSK1–6 → words.json (struct + Lớp 1–2)
├── sw.js, manifest.webmanifest, icons/   ← hỗ trợ offline / cài như app
```

---

## Mô hình dữ liệu từ vựng (`data/words.json`)

Mảng `words[]`, mỗi từ là 1 object (sinh bởi `scripts/build_vocab.py`):

| Trường | Ghi chú |
|-----|---------|
| id | "h{cấp}-{stt}", vd "h6-0003" |
| simplified | Giản thể (đã làm sạch ngoặc chú thích) |
| traditional | OpenCC s2t tự chuyển |
| pinyin | Từ cột Phiên âm Excel (đã bỏ chú thích ngoặc) |
| han_viet | Trích từ `[...]` nếu Excel có (file hiện tại gần như rỗng) |
| meaning_vi | Nghĩa tiếng Việt từ Excel |
| example_zh / example_pinyin / example_vi | Câu ví dụ |
| hsk_level | 1–6 |
| source | "excel" (sau: "video:[tên]" / "story:[tên]") |
| struct_group | S1–S5 theo số chữ — app/script tự gán |
| semantic_group | A1–E2 / F1–F6 — pipeline 3 lớp (xem dưới) |
| classification_source | "rule" / "keyword" / "ai" / "manual" |
| classification_conf | 0.0–1.0 |
| needs_review | true nếu ai conf < 0.7 |
| context_tags | JSON array, dùng cho từ bóc ngoài HSK |

**Quan trọng:** từ có `classification_source = "manual"` KHÔNG BAO GIỜ bị pipeline ghi đè.
Pha 1 mới chạy Lớp 1–2; sửa thủ công (Pha 2) lưu trong `localStorage`, không ghi đè JSON gốc.

---

## Quy tắc phân loại (tóm tắt — xem đầy đủ VOCAB_CLASSIFICATION_SYSTEM.md)

**2 cấp nhóm:** `struct_group` (S1–S5 theo số chữ) + `semantic_group` (A1–E2 nội dung / F1–F6 từ chức năng).

**Pipeline 3 lớp gán `semantic_group`:**
1. Lớp 1 (100%): tra danh sách F đóng → F1–F6 *(đã làm — `build_vocab.py`)*
2. Lớp 2 (~85%): tra từ khóa trong `meaning_vi` → A1–E2 *(đã làm — `build_vocab.py`)*
3. Lớp 3 (~90%): Qwen3 với ngữ cảnh → A1–E2 *(Pha 3, chưa làm)*

Người dùng sửa thủ công bất kỳ lúc nào (Pha 2); từ `manual` không bị ghi đè.

> Ghi chú thực tế: glosses tiếng Việt trong Excel rất ngắn (1–3 từ), nên độ phủ
> Lớp 2 thấp hơn ước tính trong tài liệu (~9% thay vì ~55%). Phần lớn (~89%) chờ
> Lớp 3 (Qwen3). Có thể mở rộng bảng từ khóa để tăng độ phủ trước khi cần Qwen3.

---

## Quy ước làm việc với Claude Code

1. Đọc CLAUDE.md trước khi làm bất kỳ điều gì.
2. Khi đụng phân loại từ: đọc thêm `VOCAB_CLASSIFICATION_SYSTEM.md`.
3. Lập plan → người dùng duyệt → mới code.
4. Hỏi lại nếu chưa rõ — không đoán.
5. Làm từng Pha, kiểm tra chạy được rồi mới sang pha kế.
6. Commit git sau mỗi pha. Message tiếng Việt ngắn.
7. Cập nhật TRẠNG THÁI sau khi xong.
8. Chạy app để kiểm tra: `python -m http.server 8000` rồi mở `http://localhost:8000`.

---

## TRẠNG THÁI HIỆN TẠI

```
[x] Pha 0 — Đồng bộ tài liệu (CLAUDE.md/ROADMAP/VOCAB khớp kiến trúc PWA hybrid)
[x] Pha 1 — Nền dữ liệu từ vựng + phân loại Lớp 1–2 + tab "Từ vựng" có bộ lọc
[ ] Pha 2 — Sửa nhóm thủ công trong app (lưu localStorage, không ghi đè)
[ ] Pha 3 — Tích hợp Qwen3 (Lớp 3) qua Ollama trong browser
[ ] Pha 4 — Luyện đề HSK6 (đọc + viết): đề AI + upload đề thật
[ ] Pha 5 — Nạp truyện / dịch thuật (đã có data mẫu stories/ + translation/)
[ ] Pha 6 — Phồn thể nâng cao · Video (lúc này mới thêm backend Python) · HSKK 高级
```

Xem chi tiết từng pha trong `ROADMAP.md`.

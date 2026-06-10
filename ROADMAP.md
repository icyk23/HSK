# ROADMAP — App học tiếng Trung (PWA hybrid)

Lộ trình theo pha. Mỗi pha chạy được rồi mới sang pha kế. Xem kiến trúc tổng quan
và lý do chọn hướng hybrid trong `CLAUDE.md`.

---

## ✅ Pha 0 — Đồng bộ tài liệu  *(xong)*
- Viết lại `CLAUDE.md` phản ánh đúng kiến trúc PWA vanilla-JS (không FastAPI/React).
- Thêm `VOCAB_CLASSIFICATION_SYSTEM.md` vào repo.
- Tạo `ROADMAP.md` này.

## ✅ Pha 1 — Nền dữ liệu từ vựng + phân loại Lớp 1–2  *(xong)*
- `scripts/build_vocab.py`: đọc Excel HSK1–6 → `data/words.json` (5.002 từ).
  - Làm sạch ngoặc chú thích trong chữ Hán & pinyin.
  - Tách `pinyin` + `han_viet` từ dạng `pinyin [hán việt]`.
  - Sinh `traditional` (OpenCC s2t).
  - `struct_group` S1–S5 theo số chữ.
  - **Lớp 1**: danh sách từ chức năng đóng → F1–F6.
  - **Lớp 2**: tra từ khóa trong `meaning_vi` → A1–E2.
- Tab **📖 Từ vựng** (`js/words.js` + `renderVocab` trong `ui.js`):
  - Tìm kiếm (chữ Hán / pinyin / nghĩa).
  - Lọc theo: cấp HSK · struct_group · semantic_group · nguồn phân loại.
  - Badge nhóm + phát âm từng từ; phân trang "Hiện thêm".
- Service worker cache `words.json` để duyệt offline.

**Kết quả phân loại (5.002 từ):** rule 73 · keyword 474 · chưa phân loại 4.455 (~89%, chờ Lớp 3).
Cách chạy lại: `python scripts/build_vocab.py <đường_dẫn>.xlsx`

## ⬜ Pha 2 — Sửa nhóm thủ công trong app
- Icon ✏️ cạnh badge nhóm → dropdown chọn lại `semantic_group`.
- Lưu override trong `localStorage` (key riêng, vd `hsk.classOverrides`).
- Hiển thị `classification_source = "manual"`; **không ghi đè** `words.json` gốc.
- Lọc thêm: "chỉ từ tôi đã sửa", "chỉ từ cần xem lại".

## ⬜ Pha 3 — Tích hợp Qwen3 (Lớp 3) qua Ollama trong browser
- `js/llm.js`: gọi `localhost:11434/api/generate`, prompt Lớp 3 trong VOCAB file.
- Phân loại các từ Lớp 1–2 chưa khớp; gắn `needs_review` khi conf < 0.7.
- Tùy chọn: chạy batch 1 lần bằng script Python rồi bake kết quả vào `words.json`
  để bản deploy vẫn có nhóm sẵn mà không cần Ollama.
- Hướng dẫn bật CORS: `OLLAMA_ORIGINS=*` (hoặc origin cụ thể).

## ⬜ Pha 4 — Luyện đề HSK6 (đọc + viết)
- Dạng đọc: điền từ, sắp xếp câu, đọc hiểu. Dạng viết: sắp xếp từ, viết luận từ tranh.
- Đề AI: Qwen3 sinh theo prompt từng dạng. Đề thật: upload PDF/DOCX/TXT.
- Lưu trong `localStorage` (hoặc JSON tĩnh nếu là bộ đề mẫu).

## ⬜ Pha 5 — Nạp truyện / dịch thuật
- Đã có data mẫu `data/stories/` + `data/translation/`.
- Bóc từ mới từ truyện → đưa qua pipeline phân loại → thêm vào kho từ (source="story:…").
- Khu luyện dịch theo từng đoạn, có bản dịch tham chiếu; Qwen3 chấm/gợi ý (Pha 3+).

## ⬜ Pha 6 — Phồn thể nâng cao · Video · HSKK 高级
- Module phồn thể độc lập (nhận diện thành phần Hán tự — xem Phần 4 VOCAB file).
- **Video** (yt-dlp + faster-whisper): pha duy nhất cần thêm backend Python nhỏ.
- Luyện nói HSKK 高级: so sánh phát âm với mẫu (edge-tts).

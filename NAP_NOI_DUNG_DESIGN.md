# Thiết kế — Module 📥 Nạp nội dung

> ĐÃ CHỐT (chờ làm sau khi dựng nav 2 tầng). Tiến độ task: **tự đếm + thủ công**.

## Mục tiêu
Biến **một nguồn** (dán text / upload file / link) thành một **"Bài học"** = chuỗi
**task** cụ thể nối vào các module đã có (Học thẻ · Giao tiếp · Dịch thuật), theo dõi
**tiến độ** đến khi hoàn thành.

## Luồng
1. Vào **📥 Nạp nội dung** → chọn nguồn: dán text · upload file (.txt/.srt ngay;
   ảnh/pdf/audio/video qua `/extract` đã có) · dán link (qua `/ingest` — backend).
2. App xử lý → màn **Bài học**: tiêu đề + phân tích từ vựng + danh sách task có tiến độ.
3. **Thư viện bài học**: list bài đã tạo, mở lại / xóa.

## Mô hình dữ liệu (IndexedDB store mới `lessons`, theo pattern library.js)
```
Lesson = {
  id, title, lang:"zh"|"vi", source:{type:"paste"|"file"|"url", ref},
  sentences:[{ zh, vi?, pinyin? }],          // vi/pinyin có khi qua Qwen3
  vocab:[{ word, hsk_level, meaning, cardId? }],
  tasks:[Task], createdAt, updatedAt
}
Task = { id, type:"vocab"|"shadow"|"translate"|"qa", title, items:[...], total, done }
```

## Loại task & nối module
| Task | Nội dung | "Bắt đầu" mở | Đo "done" |
|---|---|---|---|
| 🎴 vocab | từ bóc được (khớp HSK) | Học thẻ + bộ lọc các từ này (`setStudyFilter`) | số từ có SRS state "đã thuộc/đang học" |
| 🗣️ shadow | câu trong bài | Giao tiếp → Shadowing (nạp `commPersonal`) | thủ công "đã luyện" |
| 🌐 translate | câu cần dịch | Dịch thuật (gắn `lessonId` vào bản lưu) | số bản dịch của bài đã lưu |
| ❓ qa (Qwen3) | câu hỏi đọc hiểu | hiển thị tại chỗ | tự chấm / thủ công |

## Bóc từ vựng — browser-only (không cần AI)
- Map 5.002 từ HSK: `simplified → {hsk_level, meaning, id}`.
- Quét text bằng **khớp từ dài nhất** (longest-match, ≤5 ký tự) → từ + cấp HSK + tần
  suất; đánh dấu "từ mới" nếu chưa có SRS state (`learnStatus`).
- Không hoàn hảo với tên riêng/đa nghĩa — chấp nhận được để liệt kê từ cần học.

## Browser vs Backend
- **Browser (ngay):** paste/upload text → bóc vocab + tách câu (`splitChinese`/`parseSrt`)
  → tạo task vocab/shadow/translate + tiến độ.
- **Backend `/ingest` (mới, chờ Ollama):** `{url}` → trafilatura tải bài viết (hoặc
  yt-dlp lấy phụ đề/audio video) → Qwen3 dịch + sinh câu hỏi → `{title, sentences, questions}`.
  File ảnh/pdf/media dùng lại `/extract`.
- **Tài liệu tiếng Việt:** Qwen3 dịch sang Trung → task **Việt→Trung** + từ vựng chủ đề.

## Phụ thuộc thứ tự
Thêm module này đẩy hàng tab phẳng lên ~12 → **dựng nav 2 tầng trước** (đã chốt), rồi
cắm "Nạp nội dung" vào nhóm global.

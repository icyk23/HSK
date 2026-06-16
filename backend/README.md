# Backend Qwen3 — AI cho app (bóc tài liệu + chấm bài)

Chạy **Qwen3 qua Ollama (local, miễn phí)** để mở khoá các tính năng AI:

- **Bóc tài liệu**: ảnh · PDF · audio · video → tách câu → dịch sang tiếng Việt (module Giao tiếp / Nạp).
- **Chấm dịch** (module Dịch thuật): cho điểm + bản sửa + nhận xét.
- **Chấm Viết 缩写** (module Luyện đề): điểm 0-100 + 4 tiêu chí + bản tóm tắt đã sửa + nhận xét.

Tất cả **chạy local**, không gửi dữ liệu ra ngoài.

> App vẫn chạy 100% trong trình duyệt. Backend này **không bắt buộc** — chỉ cần khi muốn
> chấm tự động hoặc bóc câu từ ảnh/video/PDF (file `.txt`/`.srt` app bóc thẳng, khỏi backend).

## Yêu cầu

- **Python 3.10+**
- **[Ollama](https://ollama.com)** + một model Qwen:
  ```bash
  ollama pull qwen2.5:7b      # hoặc qwen2.5:3b cho máy yếu / qwen3 khi có
  ```
- (tùy chọn) **ffmpeg** trong PATH nếu xử lý video nhiều định dạng.

## Cài & chạy

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --port 8000
```

Hoặc gọn: `bash run.sh` (tự cài requirements rồi chạy ở cổng 8000).

Có thể bỏ bớt thư viện nặng nếu không cần:
- Không đọc ảnh → bỏ `rapidocr-onnxruntime pillow numpy`
- Không xử lý audio/video → bỏ `faster-whisper`

Thiếu thư viện nào thì `/health` báo `caps=false` cho đúng phần đó; các loại file
còn lại vẫn chạy bình thường.

## Cấu hình (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `OLLAMA_URL` | `http://localhost:11434` | địa chỉ Ollama |
| `QWEN_MODEL` | `qwen2.5:7b` | model dịch |
| `WHISPER_MODEL` | `small` | cỡ model nghe-ra-chữ (`tiny`/`base`/`small`/`medium`) |

## Nối với app

Trong app → **Cài đặt → AI (Qwen3)** → dán `http://localhost:8000` → Lưu & kiểm tra.
Khi backend sống, các nút AI tự bật: **Giao tiếp** (bóc tự động file media),
**Dịch thuật** (Chấm & sửa), **Luyện đề → Viết** (Chấm bằng Qwen3).

## API

- `GET /health` → `{ status, caps:{pdf_text,ocr,asr,web,ytdlp}, ollama, model }`
- `POST /extract` (multipart): `file`, `kind` (`auto`|`pdf`|`image`|`audio`|`video`|`text`),
  `translate` (`true`/`false`) → `{ lines:[{zh,vi}], count, kind }`
- `POST /ingest` (JSON): `{ url }` → `{ text, title, kind, chars }`
  (Nạp tài liệu — bóc bài web (trafilatura) hoặc video/YouTube (yt-dlp: phụ đề, không có thì ASR))
- `POST /grade` (JSON): `{ source, user, dir }` (`dir`=`zh2vi`|`vi2zh`) →
  `{ reference, score, corrected, notes:[] }` (Dịch thuật — chấm & sửa bản dịch)
- `POST /grade-writing` (JSON): `{ article, title, text, target }` →
  `{ score(0-100), scores:{noi_dung,mach_lac,ngu_phap,dung_tu}, corrected, notes:[] }`
  (Luyện đề Viết 缩写 — chấm tóm tắt)
- `POST /gen-qa` (JSON): `{ text, n }` →
  `{ pairs:[{q,q_pinyin,q_vi,a,a_pinyin,a_vi}], count }`
  (Giao tiếp — sinh Hỏi–đáp từ tài liệu đã nạp)
- `POST /gen-exam` (JSON): `{ text, n }` →
  `{ exam:{title,note,reading:[…]}, count }`
  (Luyện đề — sinh đề đọc hiểu trắc nghiệm từ một đoạn văn; passage = văn bản gốc)
- `POST /gen-hskk` (JSON): `{ topic }` →
  `{ exam:{title,note,retell:[{zh,vi}],read:{zh,vi},answer:[{q_zh,q_pinyin,q_vi,outline_vi}]} }`
  (Luyện đề — sinh đề thi nói HSKK 高级 từ một chủ đề)

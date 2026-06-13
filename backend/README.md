# Backend Qwen3 — bóc tài liệu cho module Giao tiếp

Bóc chữ tiếng Trung từ **ảnh · PDF · audio · video** → tách câu → **dịch sang tiếng Việt
bằng Qwen3 (Ollama)** → trả về cho app để nạp vào ngân hàng câu luyện phản xạ.

Tất cả **chạy local, miễn phí**, không gửi dữ liệu ra ngoài.

> App vẫn chạy 100% trong trình duyệt. Backend này **không bắt buộc** — chỉ cần khi
> muốn tự động bóc câu từ ảnh/video/PDF (file `.txt`/`.srt` thì app bóc thẳng, khỏi backend).

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

Trong app → **⚙️ Cài đặt → AI (Qwen3)** → dán `http://localhost:8000` → Lưu.
Sau đó ở **🗣️ Giao tiếp**, file ảnh/PDF/audio/video trong thư viện sẽ có nút
**🤖 Bóc tự động** (thay cho nhãn “sắp có”).

## API

- `GET /health` → `{ status, caps:{pdf_text,ocr,asr}, ollama, model }`
- `POST /extract` (multipart): `file`, `kind` (`auto`|`pdf`|`image`|`audio`|`video`|`text`),
  `translate` (`true`/`false`) → `{ lines:[{zh,vi}], count, kind }`
- `POST /grade` (JSON): `{ source, user, dir }` với `dir` = `zh2vi`|`vi2zh` →
  `{ reference, score, corrected, notes:[] }` (Dịch thuật — chấm & sửa bản dịch)

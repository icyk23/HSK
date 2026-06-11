# app.py — Backend Qwen3 cho module Giao tiếp.
#
# Nhiệm vụ: nhận file (ảnh / PDF / audio / video) → bóc chữ tiếng Trung
# (OCR hoặc nghe-ra-chữ) → tách câu → dịch sang tiếng Việt bằng Qwen3 (Ollama)
# → trả JSON [{ "zh": ..., "vi": ... }] để app nạp thẳng vào ngân hàng câu.
#
# TẤT CẢ chạy local & miễn phí:
#   - PDF có sẵn chữ : PyMuPDF (fitz)
#   - PDF scan / ảnh : RapidOCR (onnxruntime, không cần GPU)
#   - audio / video  : faster-whisper (ASR, không cần GPU — chạy int8 trên CPU)
#   - dịch zh→vi     : Qwen3 qua Ollama (HTTP, mặc định http://localhost:11434)
#
# Các thư viện OCR/ASR là TÙY CHỌN: thiếu cái nào thì /health báo cap=false,
# endpoint /extract trả lỗi rõ ràng cho đúng loại file đó (các loại khác vẫn chạy).
#
# Chạy:  uvicorn app:app --port 8000   (xem README.md)

import io
import os
import re
import json
import tempfile
import importlib.util
from typing import Dict, List

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen2.5:7b")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")

app = FastAPI(title="HSK Giao tiếp · backend Qwen3")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # app chạy local (file:// hoặc localhost) nên mở hết cho tiện
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Phát hiện năng lực (thư viện nào đã cài)
# --------------------------------------------------------------------------
def _has(mod: str) -> bool:
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def capabilities() -> Dict[str, bool]:
    return {
        "pdf_text": _has("fitz"),
        "ocr": _has("rapidocr_onnxruntime"),
        "asr": _has("faster_whisper"),
    }


# --------------------------------------------------------------------------
# Tách câu tiếng Trung (đồng bộ với js/comm.js splitChinese)
# --------------------------------------------------------------------------
HAN = re.compile(r"[一-鿿]")


def split_zh(text: str) -> List[str]:
    parts = re.split(r"(?<=[。！？!?\n；;])", (text or "").replace("\r", ""))
    out: List[str] = []
    for p in parts:
        p = re.sub(r"\s+", " ", p).strip()
        if HAN.search(p) and len(HAN.findall(p)) >= 2:
            out.append(p)
    return out


# --------------------------------------------------------------------------
# OCR / ASR (lazy — chỉ nạp model khi dùng lần đầu)
# --------------------------------------------------------------------------
_ocr = None
_asr = None


def get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def get_asr():
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel
        _asr = WhisperModel(WHISPER_MODEL, device="auto", compute_type="int8")
    return _asr


def image_bytes_to_text(data: bytes) -> str:
    import numpy as np
    from PIL import Image
    img = np.array(Image.open(io.BytesIO(data)).convert("RGB"))
    result, _ = get_ocr()(img)
    return "\n".join(line[1] for line in result) if result else ""


def pdf_bytes_to_text(data: bytes) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    text = "\n".join(page.get_text() for page in doc)
    if HAN.search(text):
        return text  # PDF có sẵn chữ → khỏi OCR
    if not capabilities()["ocr"]:
        return text  # PDF scan nhưng chưa cài OCR → trả rỗng để báo lỗi rõ
    import numpy as np
    ocr = get_ocr()
    chunks: List[str] = []
    for page in doc:
        pix = page.get_pixmap(dpi=200)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img = img[:, :, :3]
        result, _ = ocr(img)
        if result:
            chunks.append("\n".join(line[1] for line in result))
    return "\n".join(chunks)


def media_bytes_to_text(data: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(data)
        path = tf.name
    try:
        segments, _ = get_asr().transcribe(path, language="zh", vad_filter=True)
        return "".join(seg.text for seg in segments)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# --------------------------------------------------------------------------
# Dịch zh→vi bằng Qwen3 (Ollama)
# --------------------------------------------------------------------------
def translate_lines(zh_lines: List[str]) -> List[str]:
    if not zh_lines:
        return []
    numbered = "\n".join(f"{i + 1}. {z}" for i, z in enumerate(zh_lines))
    prompt = (
        "Bạn là người dịch Trung→Việt cho người học tiếng Trung. "
        "Dịch từng câu tiếng Trung sau sang tiếng Việt tự nhiên, ngắn gọn, đúng văn nói. "
        "CHỈ trả về JSON dạng {\"translations\": [\"...\", \"...\"]} đúng thứ tự và đúng số lượng câu, "
        "không thêm giải thích.\n\n" + numbered
    )
    body = {
        "model": QWEN_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.2},
    }
    try:
        r = httpx.post(f"{OLLAMA_URL}/api/generate", json=body, timeout=600)
        r.raise_for_status()
        raw = r.json().get("response", "")
        data = json.loads(raw)
        vis = data.get("translations") or data.get("vi") or []
        if not isinstance(vis, list):
            vis = []
    except Exception:
        vis = []
    # canh đúng độ dài: thiếu thì đệm rỗng, thừa thì cắt
    vis = [str(v) for v in vis]
    vis = (vis + [""] * len(zh_lines))[: len(zh_lines)]
    return vis


# --------------------------------------------------------------------------
# Phân loại file
# --------------------------------------------------------------------------
def detect_kind(kind: str, ext: str, content_type: str) -> str:
    if kind and kind != "auto":
        return kind
    ct = content_type or ""
    if ext == "pdf" or ct == "application/pdf":
        return "pdf"
    if ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp") or ct.startswith("image/"):
        return "image"
    if ext in ("mp3", "m4a", "wav", "ogg", "aac", "flac") or ct.startswith("audio/"):
        return "audio"
    if ext in ("mp4", "mkv", "mov", "webm", "avi") or ct.startswith("video/"):
        return "video"
    if ext in ("txt", "srt", "lrc") or ct.startswith("text/"):
        return "text"
    return "other"


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@app.get("/health")
def health():
    ollama_ok = False
    try:
        httpx.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        ollama_ok = True
    except Exception:
        pass
    return {"status": "ok", "caps": capabilities(), "ollama": ollama_ok, "model": QWEN_MODEL}


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    kind: str = Form("auto"),
    translate: bool = Form(True),
):
    data = await file.read()
    name = file.filename or ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    k = detect_kind(kind, ext, file.content_type or "")
    caps = capabilities()

    if k == "pdf":
        if not caps["pdf_text"]:
            raise HTTPException(400, "Chưa cài PyMuPDF (pip install pymupdf).")
        text = pdf_bytes_to_text(data)
    elif k == "image":
        if not caps["ocr"]:
            raise HTTPException(400, "Chưa cài RapidOCR (pip install rapidocr-onnxruntime).")
        text = image_bytes_to_text(data)
    elif k in ("audio", "video"):
        if not caps["asr"]:
            raise HTTPException(400, "Chưa cài faster-whisper (pip install faster-whisper).")
        text = media_bytes_to_text(data, "." + (ext or "bin"))
    elif k == "text":
        text = data.decode("utf-8", "ignore")
    else:
        raise HTTPException(400, f"Loại file chưa hỗ trợ: {k}")

    zh = split_zh(text)
    if not zh:
        raise HTTPException(422, "Không bóc được câu tiếng Trung nào từ file này.")
    vis = translate_lines(zh) if translate else [""] * len(zh)
    lines = [{"zh": z, "vi": v} for z, v in zip(zh, vis)]
    return {"lines": lines, "count": len(lines), "kind": k, "caps": caps}


class GradeReq(BaseModel):
    source: str
    user: str = ""
    dir: str = "zh2vi"  # zh2vi | vi2zh


@app.post("/grade")
def grade(req: GradeReq):
    """Chấm & sửa bản dịch của người học bằng Qwen3 (cho module Dịch thuật)."""
    src = (req.source or "").strip()
    if not src:
        raise HTTPException(400, "Thiếu văn bản nguồn.")
    if req.dir == "vi2zh":
        task = "Người học dịch từ tiếng Việt sang tiếng Trung."
        ref_lang = "tiếng Trung giản thể"
    else:
        task = "Người học dịch từ tiếng Trung sang tiếng Việt."
        ref_lang = "tiếng Việt"
    prompt = (
        "Bạn là giáo viên dịch thuật Trung–Việt. " + task + "\n\n"
        f"NGUỒN:\n{src}\n\n"
        f"BẢN DỊCH CỦA NGƯỜI HỌC:\n{req.user or '(chưa dịch)'}\n\n"
        "Trả về DUY NHẤT một JSON gồm:\n"
        f'  "reference": bản dịch chuẩn sang {ref_lang};\n'
        '  "score": điểm số 0-10 cho bản dịch của người học (0 nếu chưa dịch);\n'
        '  "corrected": bản dịch của người học sau khi sửa lỗi (rỗng nếu chưa dịch);\n'
        '  "notes": mảng các nhận xét NGẮN bằng tiếng Việt về lỗi và cách cải thiện.\n'
        "Không viết gì ngoài JSON."
    )
    body = {
        "model": QWEN_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.3},
    }
    try:
        r = httpx.post(f"{OLLAMA_URL}/api/generate", json=body, timeout=600)
        r.raise_for_status()
        data = json.loads(r.json().get("response", "") or "{}")
    except Exception as e:
        raise HTTPException(502, f"Không gọi được Qwen3/Ollama: {e}")
    notes = data.get("notes")
    return {
        "reference": str(data.get("reference", "")),
        "score": data.get("score"),
        "corrected": str(data.get("corrected", "")),
        "notes": [str(n) for n in notes] if isinstance(notes, list) else [],
    }


@app.get("/")
def root():
    return {"name": "HSK backend", "endpoints": ["/health", "/extract", "/grade"], "model": QWEN_MODEL}

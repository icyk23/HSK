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
        "web": _has("trafilatura"),
        "ytdlp": _has("yt_dlp"),
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
# Gọi Qwen3 (Ollama) trả JSON
# --------------------------------------------------------------------------
def _ollama_json(prompt: str, temperature: float = 0.3) -> dict:
    body = {
        "model": QWEN_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": temperature},
    }
    r = httpx.post(f"{OLLAMA_URL}/api/generate", json=body, timeout=600)
    r.raise_for_status()
    return json.loads(r.json().get("response", "") or "{}")


# --------------------------------------------------------------------------
# Bóc nội dung từ LINK (web / YouTube)
# --------------------------------------------------------------------------
def _is_video_url(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in ("youtube.com", "youtu.be", "bilibili.com", "vimeo.com", "/watch?v="))


def web_url_to_text(url: str):
    """Trả (text, title). Ưu tiên trafilatura; không có thì strip HTML thô."""
    title = ""
    if _has("trafilatura"):
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            txt = trafilatura.extract(downloaded, include_comments=False, include_tables=False)
            try:
                meta = trafilatura.extract_metadata(downloaded)
                if meta and meta.title:
                    title = meta.title
            except Exception:
                pass
            if txt:
                return txt, title
    r = httpx.get(url, timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    html = r.text
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()
    html = re.sub(r"(?is)<(script|style|noscript|head).*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", "\n", html)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip(), title


def vtt_to_text(vtt: str) -> str:
    out = []
    for line in vtt.splitlines():
        line = line.strip()
        if not line or "-->" in line or line.isdigit():
            continue
        if line.upper().startswith(("WEBVTT", "KIND", "LANGUAGE", "NOTE", "STYLE")):
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if line and (not out or out[-1] != line):
            out.append(line)
    return "\n".join(out)


def video_url_to_text(url: str):
    """Trả (text, title) cho link video: ưu tiên phụ đề, không có thì nghe-ra-chữ."""
    if not _has("yt_dlp"):
        raise HTTPException(400, "Chưa cài yt-dlp (pip install yt-dlp).")
    import yt_dlp
    with tempfile.TemporaryDirectory() as td:
        title = url
        sub_opts = {
            "skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
            "subtitleslangs": ["zh-Hans", "zh-CN", "zh", "zh-Hant"], "subtitlesformat": "vtt",
            "outtmpl": os.path.join(td, "%(id)s.%(ext)s"), "quiet": True, "no_warnings": True,
        }
        try:
            with yt_dlp.YoutubeDL(sub_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get("title") or title
        except Exception as e:
            raise HTTPException(502, f"Không tải được video: {e}")
        for fn in sorted(os.listdir(td)):
            if fn.endswith(".vtt"):
                with open(os.path.join(td, fn), encoding="utf-8", errors="ignore") as f:
                    txt = vtt_to_text(f.read())
                if txt:
                    return txt, title
        if not capabilities()["asr"]:
            raise HTTPException(400, "Video không có phụ đề tiếng Trung và chưa cài faster-whisper để nghe.")
        audio_opts = {"format": "bestaudio/best", "outtmpl": os.path.join(td, "a.%(ext)s"), "quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(audio_opts) as ydl:
            ydl.download([url])
        for fn in os.listdir(td):
            if fn.startswith("a."):
                with open(os.path.join(td, fn), "rb") as f:
                    return media_bytes_to_text(f.read(), os.path.splitext(fn)[1] or ".m4a"), title
        raise HTTPException(422, "Không lấy được nội dung từ video.")


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


class WritingReq(BaseModel):
    article: str = ""
    title: str = ""
    text: str = ""
    target: int = 400


@app.post("/grade-writing")
def grade_writing(req: WritingReq):
    """Chấm phần Viết HSK6 (缩写 — đọc bài rồi tóm tắt) bằng Qwen3."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Chưa có bài viết để chấm.")
    prompt = (
        "Bạn là giám khảo HSK6 phần Viết 缩写 (đọc một bài rồi viết bản TÓM TẮT khoảng "
        f"{req.target} chữ, KHÔNG thêm ý kiến cá nhân, KHÔNG đặt lại tiêu đề mới ngoài yêu cầu). "
        "Chấm bài tóm tắt của thí sinh.\n\n"
        f"BÀI ĐỌC GỐC:\n{req.article or '(không cung cấp)'}\n\n"
        f"TIÊU ĐỀ THÍ SINH ĐẶT:\n{req.title or '(trống)'}\n\n"
        f"BÀI TÓM TẮT CỦA THÍ SINH:\n{text}\n\n"
        "Trả về DUY NHẤT một JSON gồm:\n"
        '  "score": điểm tổng 0-100 theo tiêu chí HSK6;\n'
        '  "scores": {"noi_dung":0-25,"mach_lac":0-25,"ngu_phap":0-25,"dung_tu":0-25};\n'
        '  "corrected": bản tóm tắt đã sửa lỗi, giữ ý thí sinh, tiếng Trung giản thể;\n'
        '  "notes": mảng nhận xét NGẮN bằng tiếng Việt (ưu/nhược điểm + cách cải thiện).\n'
        "Không viết gì ngoài JSON."
    )
    try:
        data = _ollama_json(prompt, 0.3)
    except Exception as e:
        raise HTTPException(502, f"Không gọi được Qwen3/Ollama: {e}")
    notes = data.get("notes")
    scores = data.get("scores") if isinstance(data.get("scores"), dict) else None
    return {
        "score": data.get("score"),
        "scores": scores,
        "corrected": str(data.get("corrected", "")),
        "notes": [str(n) for n in notes] if isinstance(notes, list) else [],
    }


class TranslateReq(BaseModel):
    lines: List[str] = []


@app.post("/translate")
def translate(req: TranslateReq):
    """Dịch một loạt câu tiếng Trung sang tiếng Việt (Nạp tài liệu — bản tham khảo)."""
    lines = [str(x) for x in (req.lines or []) if str(x).strip()]
    if not lines:
        return {"translations": []}
    return {"translations": translate_lines(lines)}


class GenQaReq(BaseModel):
    text: str = ""
    n: int = 8


@app.post("/gen-qa")
def gen_qa(req: GenQaReq):
    """Sinh cặp Hỏi–đáp tiếng Trung từ một đoạn văn (cá nhân hoá module Giao tiếp)."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Thiếu văn bản nguồn.")
    n = max(3, min(int(req.n or 8), 15))
    prompt = (
        "Bạn là giáo viên luyện phản xạ hội thoại tiếng Trung. Dựa trên ĐOẠN VĂN sau, "
        f"tạo {n} cặp HỎI–ĐÁP tiếng Trung tự nhiên, đúng văn nói, để người học luyện trả lời nhanh. "
        "Câu hỏi bám nội dung/chủ đề đoạn văn; câu trả lời mẫu ngắn gọn, đời thường.\n\n"
        f"ĐOẠN VĂN:\n{text[:4000]}\n\n"
        'Trả về DUY NHẤT JSON {"pairs":[{"q","q_pinyin","q_vi","a","a_pinyin","a_vi"}]}. '
        "q/a là tiếng Trung giản thể; q_pinyin/a_pinyin là pinyin CÓ DẤU; q_vi/a_vi là nghĩa tiếng Việt. "
        "Không viết gì ngoài JSON."
    )
    try:
        data = _ollama_json(prompt, 0.5)
    except Exception as e:
        raise HTTPException(502, f"Không gọi được Qwen3/Ollama: {e}")
    pairs = data.get("pairs") if isinstance(data.get("pairs"), list) else []
    out = []
    for p in pairs:
        if not isinstance(p, dict):
            continue
        q = str(p.get("q", "")).strip()
        if not q:
            continue
        out.append({
            "q": q, "q_pinyin": str(p.get("q_pinyin", "")), "q_vi": str(p.get("q_vi", "")),
            "a": str(p.get("a", "")).strip(), "a_pinyin": str(p.get("a_pinyin", "")), "a_vi": str(p.get("a_vi", "")),
        })
    return {"pairs": out, "count": len(out)}


class GenExamReq(BaseModel):
    text: str = ""
    n: int = 5


@app.post("/gen-exam")
def gen_exam(req: GenExamReq):
    """Sinh đề đọc hiểu trắc nghiệm từ một đoạn văn (module Luyện đề).

    Model CHỈ sinh câu hỏi; passage giữ nguyên văn bản người dùng (không bịa nội dung).
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Thiếu văn bản nguồn.")
    n = max(3, min(int(req.n or 5), 10))
    prompt = (
        "Bạn là người ra đề đọc hiểu HSK. Dựa HOÀN TOÀN trên ĐOẠN VĂN tiếng Trung sau, "
        f"soạn {n} câu hỏi trắc nghiệm đọc hiểu, mỗi câu 4 phương án, chỉ 1 đúng.\n\n"
        f"ĐOẠN VĂN:\n{text[:4000]}\n\n"
        'Trả về DUY NHẤT JSON {"title": tiêu đề ngắn tiếng Việt, '
        '"questions":[{"stem": câu hỏi tiếng Trung, "options":[4 phương án tiếng Trung], '
        '"answer": chỉ số đáp án đúng 0-3, "explain": giải thích NGẮN bằng tiếng Việt}]}. '
        "Câu hỏi & phương án bằng tiếng Trung, bám nội dung đoạn văn. Không viết gì ngoài JSON."
    )
    try:
        data = _ollama_json(prompt, 0.4)
    except Exception as e:
        raise HTTPException(502, f"Không gọi được Qwen3/Ollama: {e}")
    raw = data.get("questions") if isinstance(data.get("questions"), list) else []
    qs = []
    for q in raw:
        if not isinstance(q, dict):
            continue
        stem = str(q.get("stem", "")).strip()
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:4]
        if not stem or len(opts) < 2:
            continue
        try:
            ans = int(q.get("answer", 0))
        except Exception:
            ans = 0
        if ans < 0 or ans >= len(opts):
            ans = 0
        qs.append({"stem": stem, "options": opts, "answer": ans, "explain": str(q.get("explain", ""))})
    if not qs:
        raise HTTPException(422, "Không sinh được câu hỏi từ văn bản này.")
    exam = {
        "title": str(data.get("title") or "Đề đọc hiểu (Qwen3)"),
        "note": "Sinh tự động từ văn bản của bạn bằng Qwen3.",
        "reading": [{"title": "Đọc hiểu", "items": [{"type": "reading", "passage": text, "questions": qs}]}],
    }
    return {"exam": exam, "count": len(qs)}


class IngestReq(BaseModel):
    url: str = ""


@app.post("/ingest")
def ingest(req: IngestReq):
    """Bóc nội dung từ LINK web hoặc video (YouTube…) → trả văn bản để Nạp tài liệu."""
    url = (req.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL phải bắt đầu bằng http:// hoặc https://")
    if _is_video_url(url):
        text, title = video_url_to_text(url)
        kind = "video"
    else:
        try:
            text, title = web_url_to_text(url)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Không tải được trang: {e}")
        kind = "web"
    text = (text or "").strip()
    if not text:
        raise HTTPException(422, "Không bóc được nội dung từ link này.")
    return {"text": text, "title": title or "", "kind": kind, "chars": len(text)}


class GenHskkReq(BaseModel):
    topic: str = ""


@app.post("/gen-hskk")
def gen_hskk(req: GenHskkReq):
    """Sinh một đề thi nói HSKK 高级 quanh một chủ đề (module Luyện đề)."""
    topic = (req.topic or "").strip() or "生活与社会"
    prompt = (
        "Bạn là người ra đề thi nói HSKK 高级 (cấp cao). Soạn MỘT đề quanh chủ đề: "
        f"“{topic}”. Đề gồm 3 phần:\n"
        "1) retell: 2 đoạn văn tiếng Trung NGẮN (mỗi đoạn 80–120 chữ, có cốt truyện hoặc ý nghĩa) để thí sinh nghe rồi kể lại;\n"
        "2) read: 1 đoạn văn tiếng Trung (80–120 chữ) để đọc to;\n"
        "3) answer: 2 câu hỏi nghị luận để thí sinh nói ý kiến.\n\n"
        'Trả về DUY NHẤT JSON {"title": tiêu đề ngắn tiếng Việt, '
        '"retell":[{"zh","vi"}], "read":{"zh","vi"}, '
        '"answer":[{"q_zh","q_pinyin","q_vi","outline_vi"}]}. '
        "Mọi đoạn/câu hỏi bằng tiếng Trung giản thể; vi/q_vi là nghĩa tiếng Việt; "
        "q_pinyin là pinyin CÓ DẤU; outline_vi là gợi ý dàn ý tiếng Việt. Không viết gì ngoài JSON."
    )
    try:
        data = _ollama_json(prompt, 0.6)
    except Exception as e:
        raise HTTPException(502, f"Không gọi được Qwen3/Ollama: {e}")
    retell = [
        {"zh": str(x.get("zh", "")).strip(), "vi": str(x.get("vi", ""))}
        for x in (data.get("retell") or []) if isinstance(x, dict) and str(x.get("zh", "")).strip()
    ]
    rd = data.get("read")
    read = {"zh": str(rd.get("zh", "")).strip(), "vi": str(rd.get("vi", ""))} \
        if isinstance(rd, dict) and str(rd.get("zh", "")).strip() else None
    answer = [
        {"q_zh": str(x.get("q_zh", "")).strip(), "q_pinyin": str(x.get("q_pinyin", "")),
         "q_vi": str(x.get("q_vi", "")), "outline_vi": str(x.get("outline_vi", ""))}
        for x in (data.get("answer") or []) if isinstance(x, dict) and str(x.get("q_zh", "")).strip()
    ]
    if not retell and not read and not answer:
        raise HTTPException(422, "Không sinh được đề HSKK.")
    exam = {
        "title": str(data.get("title") or f"HSKK 高级 — {topic}"),
        "note": "Sinh tự động bằng Qwen3.",
        "retell": retell, "read": read, "answer": answer,
    }
    return {"exam": exam}


@app.get("/")
def root():
    return {"name": "HSK backend",
            "endpoints": ["/health", "/extract", "/ingest", "/translate", "/grade", "/grade-writing", "/gen-qa", "/gen-exam", "/gen-hskk"],
            "model": QWEN_MODEL}

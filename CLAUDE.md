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

App đã dùng **nav 2 tầng** (js/main.js: NAV config — tầng 1 module, tầng 2 tab con; module
1 tab con tự ẩn tầng 2). Cả 5 module + global đã vào nav. Cấu trúc:

```
Tầng 1 (module):  🏠 Trang chủ  🎴 Từ vựng   📝 Luyện đề   🗣️ Giao tiếp   🌐 Dịch thuật   繁 Phồn thể
                                        global:  📥 Nạp tài liệu   📊 Tiến độ   ⚙️ Cài đặt
Tầng 2 (tab con): đổi theo module đang chọn (Trang chủ = dashboard, mở mặc định)
```

| Module | Tab con | Trạng thái |
|--------|---------|-----------|
| **Từ vựng** 🎴 | Học thẻ · Danh sách · Quiz · Nghe · Nguồn từ | ✅ đã có (trừ đổi tên) |
| **Luyện đề** 📝 | HSK6 Đọc · HSK6 Viết · HSKK 高级 | 🟡 Đọc tự chấm + Viết khung (缩写) + HSKK 高级 khung 3 phần đã có |
| **Giao tiếp** 🗣️ | Luyện phản xạ · Luyện phát âm | 🟡 Trang chủ = 4 phương thức (Hỏi–đáp · Shadowing+Phát âm · Sprint · Thay thế); chọn nguồn (tình huống/tài liệu) TRONG từng phương thức; HSKK 高级 chưa |
| **Dịch thuật** 🌐 | Theo truyện · Luyện tự do · Bài đã dịch | 🟢 Thư mục truyện→khúc (task runner có tiến độ) + workspace tự do + lưu/ôn; chấm/sửa cần Qwen3 (/grade) |
| **Phồn thể** 繁 | Lộ trình · ① Bộ thủ · ② Thẻ nhớ · ③ Quiz | 🟢 Lộ trình newbie 3 bước có tiến độ: bộ thủ → thẻ SRS 繁→简 → quiz (+ tra cứu 993 chữ) |
| **Nạp tài liệu** 📥 *(global)* | Nạp mới · Thư viện tài liệu | 🟡 CỬA NẠP DUY NHẤT: nạp text → Tài liệu → map vào Từ vựng/Giao tiếp/Dịch (module hết ô upload); link/media chờ Qwen3 |
| **Tiến độ** 📊 · **Cài đặt** ⚙️ *(global)* | — | ✅ đã có |

Khớp **3 trụ cột** (Từ vựng · Dịch thuật · Giao tiếp) + Luyện đề + Phồn thể độc lập.

- **Luyện đề** gom mọi dạng luyện thi: HSK6 đọc/viết **và HSKK 高级** (nói theo đề thi).
- **Giao tiếp** ≠ luyện đề: tập **phản xạ** (Việt→Trung tức thì / nghe→dịch nhanh) và
  **phát âm**. Ngân hàng câu lấy từ **tài liệu chuyên ngành / video / truyện đã nạp**
  → luyện theo chủ đề. (Chi tiết hóa khi bắt đầu xây.)
- **Bài đã dịch** (trong Dịch thuật) = kho lưu bản dịch của người dùng + bản Qwen3
  chấm/sửa, để xem lại và ôn lỗi.

### Đổi tên (ĐÃ LÀM khi dựng nav 2 tầng)
- App: **"Học HSK6"** → **"Học tiếng Trung"** ✅
- Tab **"Từ vựng"** (trình duyệt lọc) → **"Danh sách"** ✅
- Tab **"Bộ thẻ"** → **"Nguồn từ"** ✅

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
js/lessons.js           Nạp tài liệu: phân tích văn bản → vocab xếp nhóm HSK (quy tắc) + tách câu; lưu Tài liệu (IndexedDB store "materials")
js/trad.js              Phồn thể: bóc cặp chữ Giản→Phồn từ deck + bảng bộ thủ giản↔phồn
data/comm-scenes.json   6 cảnh mẫu khẩu ngữ (hỏi-đáp · câu lẻ · mẫu câu thay thế)
data/hsk-words.json     5.002 từ HSK1–6 đã phân loại (sinh bởi build script)
data/char-rank.json     thứ hạng tần suất chữ NGOÀI HSK + ngưỡng (xếp chữ ngoài HSK vào 1–6 theo độ thông dụng)
data/vocab.xlsx         nguồn gốc 5.002 từ (để build lại)
scripts/build-words.mjs TOOL build: xlsx → phân loại → hsk-words.json (npm run build:words)
scripts/build-charstats.mjs TOOL build: hanzi (Jun Da) → calibrate theo HSK → char-rank.json (npm run build:charstats)
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

## REFACTOR CẤU TRÚC (đang làm — duyệt từng bước)

Lý do: module/tính năng đang rối; trụ cột = cá nhân hóa (nạp 1 cửa → bóc tách → phân vào module dạng thư mục).
```
[x] Bước 0–1 — Mô hình "Tài liệu" (store IndexedDB "materials", bỏ "hsk-lessons" cũ) +
    HUB HÓA NẠP: gỡ ô upload/dán ở Giao tiếp (giữ bộ chọn Tài liệu); đổi tên "Nạp tài liệu",
    "Tài liệu" (thay "Bài học"). Upload chỉ qua Nạp (Luyện đề up đề riêng = ngoại lệ).
[x] Bước 2 — Từ vựng: tab "Thư mục" (cây HSK/Nhóm nghĩa/Tài liệu + CHECKBOX, chọn từ nhiều nhóm)
    → "💾 Lưu thành bộ" (store.wordSets). Tab "Bộ của tôi": mỗi bộ học bằng 4 phương thức —
    🎴 Flashcard · 📝 Quiz · ⌨️ Gõ pinyin (mode mới) · 🔊 Nghe (dùng chung learnScope/scopeCards).
    Đã sửa bug nút "Học từ này" dùng data-view (chết sau nav 2 tầng) → navigate.
[x] Bước 3 — Giao tiếp: trang chủ chỉ còn 4 PHƯƠNG THỨC (bỏ thanh nguồn ở đầu). Vào mỗi phương
    thức mới có commSourceBar: nhánh "tình huống" (chip cảnh) + "tài liệu đã nạp" (Shadowing dùng
    được; QA/Sprint/Pattern ghi chú cần Qwen3). Nguồn rỗng → báo nhẹ, không bật về home.
[x] Bước 4 — Dịch thuật 2 chế độ: "Theo truyện" (thư mục tài liệu có câu dịch → thẻ truyện + thanh
    tiến độ; chi tiết = danh sách KHÚC chương→phần; TASK RUNNER dịch từng câu "i/N", Lưu→tự sang câu
    chưa dịch kế, tiến độ theo store.translations, điều hướng ‹›, xong khúc về chi tiết) + "Luyện tự
    do" (workspace phẳng cũ: dán/câu mẫu thẻ). Helper storyChunks() dùng chung với task Dịch ở màn Nạp
    (Bắt đầu → mở thẳng task runner). Chấm Qwen3 vẫn dùng được mỗi câu khi backend bật.
[x] Bước 5 — Phồn thể LỘ TRÌNH newbie: 4 tab (Lộ trình/① Bộ thủ/② Thẻ nhớ/③ Quiz). Lộ trình = home
    3 bước + thanh tiến độ (store.tradMeta + store.tradSrs). ① Bộ thủ: bảng 16 cặp bộ thủ + nút "Đã
    nắm". ② Thẻ nhớ: thẻ SRS 繁→简 (srs.js + store.tradSrs keyed theo chữ giản, lật 3D + 4 nút chấm
    + bảng tra cứu 简→繁 collapsible). ③ Quiz: đọc phồn→chọn giản, lưu kỷ lục. Thuần browser.
[x] Bước 6 — Dọn dẹp: gỡ code thừa (clearStudyFilter, loadNextFromMaterial/transMaterialId cũ),
    nhất quán tên tab ("Nạp tài liệu"), mặc định landing = Trang chủ; quét 0 export thừa, sweep mọi
    tab tier1+tier2 không lỗi; cập nhật IA + bảng module trong doc. → REFACTOR HOÀN TẤT.
```

## TRẠNG THÁI HIỆN TẠI

```
[x] "CHỌN TRƯỚC RỒI HỌC": (1) Từ vựng còn 3 tab (Thư mục · Bộ của tôi · Nguồn từ); Học thẻ/Quiz/Nghe/
    Gõ thành view ẩn (tab hidden trong NAV, moduleOf vẫn map về Từ vựng) — vào qua nút ▶ mỗi nhóm ở
    Thư mục hoặc hàng phương thức khi tick chọn (studyScope→learnScope) + per-set ở Bộ của tôi.
    (2) Giao tiếp: mỗi drill (Hỏi–đáp/Shadowing/Thay thế) mở CỔNG commIntro = thanh nguồn + "Bắt đầu
    luyện" (đếm số câu nguồn), chỉ vào luyện khi commView.started; Sprint giữ setup sẵn có.
[x] Trang chủ: TRA CỨU NHANH (gõ chữ Hán/pinyin/nghĩa → tối đa 8 thẻ khớp, hiện 简/繁 theo track +
    pinyin/Hán-Việt/nghĩa + TTS) + thẻ "Track học" Giản/Phồn (từ đã học·chuỗi ngày mỗi track, 1 chạm
    chuyển). QA responsive mọi màn mới (home/tra cứu/track/lộ trình/SRS/story/task) OK trên 390px, 0 cảnh báo.
[x] B — TRACK PHỒN THỂ TIẾN ĐỘ ĐỘC LẬP: SRS progress + daily stats định tuyến theo charMode
    (store: progKey()/statsKey() → hậu tố ".trad" khi traditional). Công tắc 简/繁 = chuyển track;
    cùng bộ thẻ HSK + cùng UI/nav, nhưng tiến độ/chuỗi ngày/đến hạn TÁCH RIÊNG. Dashboard hiện
    "TRACK PHỒN THỂ", trang Tiến độ có chip track. Backup gồm cả progressTrad/statsTrad. Kiểm chứng:
    học simp→progress simp=1/trad=0; chuyển trad học tiếp→simp=1/trad=1. (wordSets/dịch/đề vẫn dùng chung.)
[x] CHẾ ĐỘ PHỒN THỂ TOÀN CỤC: bộ chuyển 简→繁 offline — KHỚP CỤM TỪ trước (data/s2t-phrases.json,
    9924 cụm OpenCC chỉ-giữ-khác-charwise) rồi tới KÝ TỰ (data/s2t.json, 3882 mục); fix 喫→吃. js/cc.js:
    s2t() greedy longest-match + applyToDom(). Khi Cài đặt charMode="traditional", main.js
    áp chuyển TOÀN APP (sau mỗi render + MutationObserver cho nội dung động) → mọi ví dụ/câu/đề/bản dịch
    hiển thị phồn thể, dùng chung tiến độ. Trừ: module Phồn thể (view "trad*", giữ 简 minh hoạ) và nhãn
    đối chiếu / nhãn "简→繁" (class no-cc). Round-trip kiểm chứng (Học thẻ→愛, đối chiếu giữ 爱). Bước 1 của
    hướng "phồn thể đầy đủ module"; có thể nâng lên track riêng (tiến độ độc lập) sau nếu cần.
[x] Hoàn thiện SAO LƯU/KHÔI PHỤC (sửa lỗi mất dữ liệu): exportAll/importAll nay gồm đủ wordSets,
    tradSrs, tradMeta, commRecords + TÀI LIỆU/truyện trong IndexedDB (qua lessons.listMaterials/
    saveMaterial); xuất/nhập async, xác nhận GHI ĐÈ khi khôi phục, kiểm tra file hợp lệ. Loại trừ
    file .zip đề thi (Thư viện) vì tải lại được. Round-trip kiểm chứng OK. (Không gồm exam library binary.)
[x] Đánh bóng thuần-browser (đợt 2): (1) GIAO TIẾP — Sprint lưu KỶ LỤC theo thời lượng
    (store.commRecords, báo "Kỷ lục mới") + phím tắt Sprint (Space/Enter/Backspace) & Shadowing
    (Space/→/E) qua commKeyHandler; (2) LUYỆN ĐỀ — kết quả Đọc thêm số câu sai + nút "Tới câu sai
    đầu tiên" + LỊCH SỬ các lần làm (store readingHistory, điểm%/lần); (3) ONBOARDING — dashboard
    hiện thẻ "3 bước bắt đầu" (Học thẻ · Nạp truyện · Phồn thể) lần đầu, ẩn được (settings.onboardDismissed).
[x] Đánh bóng thuần-browser: trang Tiến độ thêm mục "Phồn thể 繁→简" (chữ đã học/đến hạn + chip
    bộ thủ/kỷ lục quiz) và "Dịch thuật theo truyện" (tiến độ từng truyện); thẻ SRS Phồn thể có
    phím tắt (Space hiện đáp án, 1-4 chấm) như Học thẻ; lượt chấm SRS tính vào lượt ôn/chuỗi ngày.
[x] Nâng cấp "thiết kế" (4 lớp): (1) NHÚNG FONT Saira Condensed offline (fonts/, có subset
    tiếng Việt) cho chữ display + font-mono cho số; (2) BỐ CỤC SIDEBAR PC (nav dọc trái cố định,
    menu con nhóm theo module; mobile giữ top-bar); (3) TRANG CHỦ DASHBOARD (js renderHome: hero
    lời chào + CTA + chuỗi ngày, số liệu nhanh, ô Vào nhanh 6 module; mặc định mở "home"); (4)
    HIỆU ỨNG: lật thẻ 3D (flip3d khi reveal), đếm số tăng dần (countUp), nền lưới + glow, ngoặc góc
    HUD, vạch accent, micro-animation (fadeUp/pop/shimmer/hover). Bộ icon mở rộng (js/icons.js).
    Logo "学" angular (cắt góc) + glow. Đồng bộ màn phụ: thay emoji tiêu đề Luyện đề bằng icon SVG
    (mic/sách/bàn phím/upload/download), style input[type=file] (nút angular đỏ) toàn app.
    RÀ SẠCH EMOJI trang trí toàn app (banner/tiêu đề/tab/nút/label) → bỏ hoặc thay icon SVG
    (medal Quiz→check/bulb/replay, sprint→timer, HSKK→headphone, empty→book); giữ icon loại
    file (📕🎧🖼️) + dấu ✓/✗ + mũi tên →/▶ (đơn sắc, hợp theme).
[x] Lột xác giao diện "ngầu" (esports/T1): theme TỐI mặc định (đen/đỏ neon mono đỏ-trắng),
    góc cắt chéo angular + glow theo hình cắt, chữ đậm/nhãn IN HOA. Bộ ICON SVG line
    (js/icons.js) thay emoji ở nav tầng 1, thẻ Giao tiếp, nút loa/Bỏ qua/Đã thuộc; bỏ emoji
    đầu tiêu đề H1. LAYOUT DESKTOP/PC: top bar 1 hàng (brand + nav icon), main rộng ~1080–1140,
    lưới Giao tiếp 2 cột, dashboard Tiến độ trải ngang. Sửa bug có sẵn semChipClass (crash lật thẻ).
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
[x] Dựng nav 2 tầng (js/main.js NAV config) + đổi tên: "Học tiếng Trung", "Danh sách",
    "Nguồn từ". Tầng 1 = module (Từ vựng·Luyện đề·Giao tiếp·Dịch thuật·Tiến độ·Cài đặt),
    tầng 2 = tab con (chỉ Từ vựng có 5 tab; module đơn ẩn tầng 2). Nhớ tab con gần nhất/module.
[x] Nạp nội dung (bản browser) — module "📥 Nạp nội dung" (global, nav tầng 1). Dán/upload text
    (.txt/.srt) → js/lessons.js phân tích: bóc TỪ VỰNG xếp theo nhóm HSK 1–6 (từ trong list giữ cấp
    gốc; từ NGOÀI list = cấp cao nhất của các chữ; CHỮ ngoài HSK xếp 1–6 theo ĐỘ THÔNG DỤNG — thứ hạng
    tần suất Jun Da calibrate theo phân bố của bộ HSK, data/char-rank.json; chữ hiếm/lóng/thuật ngữ → HSK6)
    + tách câu + nhận diện CHƯƠNG (第X章 / Chương N) → tạo "Bài học" (IndexedDB) gồm task vocab/shadow/
    translate nối thẳng Học thẻ/Giao tiếp/Dịch thuật (qua main.navigate). Task DỊCH chia theo chương →
    khúc, cấu hình Số phần (½,⅓)/Số câu/Số chữ (transConfigRow). Tiến độ: vocab+translate tự đếm, shadow
    thủ công. Thiết kế: NAP_NOI_DUNG_DESIGN.md. CHỜ Qwen3: gửi LINK (/ingest trafilatura/yt-dlp), tự
    dịch, sinh câu hỏi, ghép từ ghép ngoài từ điển (jieba); bóc media dùng /extract đã có.
[x] Nạp nội dung — MAP THẲNG VÀO MODULE: tài liệu đã nạp tự hiện như "nguồn" chọn được ngay trong
    Từ vựng (bộ lọc Nguồn tài liệu → matchVocab theo cardId), Giao tiếp (thanh "Tài liệu đã nạp" →
    nạp câu vào commPersonal/shadowing), Dịch thuật (bộ chọn tài liệu → nạp câu CHƯA dịch tiếp theo).
    Cache dùng chung ensureMaterials()/invalidateMaterials(); tab Nạp = upload + thư viện (xem tiến độ).
    Video shadowing (hiện player file/link) để sau (cần backend cho link).
[x] Phồn thể — module "繁 Phồn thể" (nav tầng 1, 2 tab con). Bài học: js/trad.js bóc 993 chữ HSK có
    dạng phồn thể KHÁC giản thể (so từng chữ simplified/traditional trong deck) → thẻ 简→繁 + pinyin/
    Hán Việt/nghĩa + ví dụ từ, lọc theo cấp HSK + TTS. Nhận diện thành phần: quiz đọc phồn thể→chọn
    giản thể (4 đáp án, tính điểm) + bảng 16 bộ thủ giản↔phồn thông dụng kèm ví dụ. Tất cả thuần browser.
```

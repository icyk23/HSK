# Học HSK6 · 繁简

Web app cá nhân để **ôn thi HSK6** và **học thêm chữ phồn thể**. Chạy hoàn toàn
trong trình duyệt, không cần backend, học được **offline**, và cài được như app
trên điện thoại (PWA).

## Tính năng

- 🎴 **Flashcard + SRS** — lặp lại ngắt quãng (thuật toán kiểu SM-2). Tự động
  đưa lại những từ sắp quên, mỗi ngày thêm một lượng từ mới tùy chọn.
- 📖 **Từ vựng HSK1–6** — duyệt toàn bộ 5.002 từ, lọc theo cấp HSK, cấu trúc từ
  (S1–S5) và nhóm ngữ nghĩa (A1–E2 / F1–F6); tìm theo chữ Hán, pinyin hoặc nghĩa.
- 🔊 **Luyện nghe / phát âm** — đọc bằng giọng tiếng Trung có sẵn trong trình
  duyệt (Web Speech API), miễn phí, không cần API ngoài. Có chế độ nghe-đoán.
- 📝 **Quiz** — trắc nghiệm nghĩa của từ, chấm điểm, theo dõi độ chính xác.
- 繁简 **Giản thể ↔ Phồn thể** — mỗi thẻ có cả hai dạng chữ; chọn hiển thị giản
  thể, phồn thể, hoặc cả hai.
- 📚 **Bộ thẻ tùy biến** — có sẵn bộ HSK6 khởi đầu; tự **import** từ vựng riêng
  qua CSV/TSV hoặc file JSON.
- 📊 **Tiến độ** — số từ đã học, chuỗi ngày học, biểu đồ 14 ngày.
- ⚙️ **Cá nhân hóa** — màu chủ đạo, chế độ tối, cỡ chữ Hán, tốc độ đọc, số từ
  mới/ngày, kiểu hiển thị chữ…
- 💾 Dữ liệu lưu trên thiết bị (localStorage); xuất/nhập file sao lưu bất cứ lúc nào.

## Chạy thử (local)

Cần một static server (vì app dùng ES modules + fetch JSON):

```bash
cd HSK
python3 -m http.server 8000
# mở http://localhost:8000
```

Hoặc dùng bất kỳ static server nào (`npx serve`, Live Server của VS Code…).

## Deploy miễn phí (GitHub Pages)

1. Push lên GitHub.
2. Repo → **Settings → Pages → Source: branch** (vd `main`, thư mục `/root`).
3. Mở link Pages trên điện thoại → trình duyệt sẽ gợi ý **"Thêm vào màn hình
   chính"** để cài như app.

## Thêm từ vựng riêng

Vào tab **📚 Bộ thẻ → Thêm bộ thẻ mới**, dán CSV với các cột:

```
simplified,traditional,pinyin,meaning,example
爱护,愛護,àihù,yêu quý và bảo vệ,我们要爱护环境。
```

Trường `traditional` và `example` có thể để trống. Header có thể bằng tiếng Việt
(`giản thể, phồn thể, pinyin, nghĩa, ví dụ`) hoặc bỏ hẳn (theo đúng thứ tự cột).

## Cấu trúc

```
index.html              khung app + tab
css/style.css           giao diện + hệ thống theme (biến CSS)
js/main.js              bootstrap + điều hướng tab
js/ui.js                render các màn hình
js/store.js             lưu trữ (settings, tiến độ, bộ thẻ)
js/srs.js               thuật toán lặp lại ngắt quãng
js/audio.js             phát âm (TTS)
js/decks.js             nạp bộ thẻ + parse CSV import
js/words.js             nạp kho từ HSK + nhãn nhóm + bộ lọc
data/words.json         5.002 từ HSK1–6 đã gắn nhóm (sinh từ scripts/build_vocab.py)
data/hsk6-starter.json  bộ HSK6 khởi đầu (flashcard)
scripts/build_vocab.py  Excel HSK1–6 → words.json (struct + phân loại Lớp 1–2)
sw.js, manifest.*       hỗ trợ offline / cài đặt như app
```

## Sinh lại kho từ vựng từ Excel

`data/words.json` được sinh từ file Excel HSK1–6 (6 sheet `HSK1`…`HSK6`):

```bash
pip install openpyxl opencc-python-reimplemented
python scripts/build_vocab.py "FULL_TU_VUNG_HSK1_HSK6.xlsx"
```

Script tự gán cấu trúc từ (S1–S5) và chạy phân loại Lớp 1–2 (từ chức năng + từ
khóa). Xem bộ quy tắc đầy đủ trong `VOCAB_CLASSIFICATION_SYSTEM.md`.

## Mở rộng bộ HSK6 đầy đủ

`data/hsk6-starter.json` là bộ khởi đầu cho flashcard (~50 từ). Toàn bộ 5.002 từ
HSK1–6 nằm ở `data/words.json` (tab 📖 Từ vựng).

# BỘ QUY TẮC PHÂN LOẠI TỪ VỰNG TIẾNG TRUNG
## Dùng cho app học HSK — Áp dụng cho từ trong danh sách lẫn từ ngoài danh sách

> **Mục đích:** Mọi từ vựng đưa vào app — dù từ HSK1–6, bóc từ video, truyện, hay tài liệu
> chuyên ngành — đều được phân nhóm bằng pipeline 3 lớp dưới đây. Kết quả cuối cùng
> bao giờ cũng có đủ `struct_group` và `semantic_group`.
> Người dùng có thể **sửa thủ công** nhóm bất kỳ từ nào trong app.

---

## PHẦN 1 — NỀN TẢNG: CẤU TẠO TỪ TIẾNG TRUNG

Tiếng Trung có 4 kiểu cấu tạo từ:

### 1.1 Từ đơn (单纯词) — 1 hình vị
Một chữ Hán, không phân tách thêm được.
Ví dụ: `人` (người), `山` (núi), `走` (đi), `好` (tốt)

### 1.2 Từ ghép (合成词) — 2+ hình vị, chiếm ~90% HSK4–6
| Kiểu | Cơ chế | Ví dụ trong file |
|------|--------|-----------------|
| Đẳng lập (联合) | A+B cùng nghĩa/tương phản | 学习, 道路, 买卖, 作息 |
| Chính phụ (偏正) | B bổ nghĩa cho A | 火车, 电话, 大学, 高速 |
| Động bổ (动补) | Động từ + kết quả | 提高, 打破, 改变, 完成 |
| Chủ vị (主谓) | Câu rút gọn → từ | 地震, 头疼, 年轻 |
| Động tân (动宾) | Động từ + tân ngữ | 毕业, 握手, 开心, 点头 |

### 1.3 Từ phái sinh (派生词) — gốc + tiền/hậu tố
**Hậu tố hay gặp:**
`子` → danh từ: 桌子, 椅子, 孩子 · `者` → người làm: 记者, 学者, 读者
`员` → thành viên: 演员, 队员 · `家` → chuyên gia: 作家, 科学家
`化` → "trở thành": 现代化, 国际化 · `性` → trừu tượng: 可能性, 重要性
`感` → cảm giác: 安全感, 幸福感

**Tiền tố hay gặp:**
`不/非/无` → phủ định · `反` → ngược lại

### 1.4 Thành ngữ (成语) — cụm 4 chữ, nghĩa không suy từ từng chữ
Ví dụ: `爱不释手`, `安居乐业`, `拔苗助长`, `半途而废`, `不可思议`

---

## PHẦN 2 — HỆ THỐNG NHÓM (2 CẤP)

### CẤP 1 — NHÓM CẤU TRÚC (struct_group)
App tự gán 100% theo số chữ. Không cần AI.

| Mã | Tên | Điều kiện |
|----|-----|-----------|
| S1 | Đơn âm | 1 chữ Hán |
| S2 | Song âm | 2 chữ Hán |
| S3 | Tam âm | 3 chữ Hán |
| S4 | Thành ngữ | 4 chữ + đánh dấu 成语 trong CC-CEDICT hoặc nghĩa không giải thích theo từng chữ được |
| S5 | Cụm dài | 4+ chữ, không phải thành ngữ thuần túy |

---

### CẤP 2 — NHÓM NGỮ NGHĨA (semantic_group)
12 nhóm nội dung + 1 nhóm từ chức năng. Gán bằng pipeline 3 lớp (xem Phần 3).

#### NHÓM A — CON NGƯỜI & XÃ HỘI
**A1 · Thân thể & sức khỏe**
Nhận dạng: bộ phận cơ thể, bệnh tật, triệu chứng, y tế, thuốc, cảm giác thể chất
Ví dụ: 身体, 头, 手, 脚, 癌症, 疼痛, 健康, 医院, 药, 手术

**A2 · Cảm xúc & tâm lý**
Nhận dạng: cảm xúc, trạng thái tâm lý, tính cách, thái độ
Ví dụ: 高兴, 难过, 担心, 害怕, 生气, 失望, 满意, 自信, 爱心, 情绪

**A3 · Quan hệ & giao tiếp**
Nhận dạng: quan hệ gia đình/xã hội, hoạt động giao tiếp, lễ nghi
Ví dụ: 父母, 朋友, 同事, 握手, 打招呼, 道谢, 道歉, 联系, 关系

**A4 · Cuộc sống hàng ngày**
Nhận dạng: ăn uống, mặc, ở, đi lại, mua sắm, giải trí thường nhật
Ví dụ: 吃饭, 穿衣, 睡觉, 买东西, 逛街, 做饭, 洗澡, 锻炼, 休息

#### NHÓM B — CÔNG VIỆC & HỌC TẬP
**B1 · Học thuật & nhà trường**
Nhận dạng: môn học, hoạt động học, trường lớp, kỳ thi, nghiên cứu
Ví dụ: 学校, 老师, 考试, 成绩, 知识, 研究, 论文, 毕业, 专业

**B2 · Nghề nghiệp & công sở**
Nhận dạng: tên nghề, hoạt động công việc, chức vụ, quy trình
Ví dụ: 工作, 公司, 职业, 经理, 员工, 合同, 任务, 完成, 负责, 安排

**B3 · Kinh tế & tài chính**
Nhận dạng: tiền bạc, giao dịch, kinh doanh, thị trường, đầu tư
Ví dụ: 钱, 银行, 买卖, 价格, 经济, 市场, 投资, 利润, 消费, 收入

#### NHÓM C — TƯ TƯỞNG & NHẬN THỨC
**C1 · Tư duy & lý luận**
Nhận dạng: hoạt động nhận thức, phân tích, phán đoán, quan điểm, nguyên tắc
Ví dụ: 认为, 分析, 判断, 理解, 思考, 逻辑, 道理, 原则, 理论

**C2 · Ngôn ngữ & biểu đạt**
Nhận dạng: ngôn ngữ, chữ viết, diễn đạt, văn chương, dịch thuật
Ví dụ: 语言, 翻译, 表达, 描述, 文章, 词语, 说明, 解释, 汉字

#### NHÓM D — TỰ NHIÊN & MÔI TRƯỜNG
**D1 · Tự nhiên & địa lý**
Nhận dạng: địa hình, thời tiết, thiên nhiên, sinh vật, môi trường
Ví dụ: 山, 河, 气候, 温度, 植物, 动物, 地震, 环境, 污染, 资源

**D2 · Không gian & thời gian**
Nhận dạng: phương hướng, vị trí, thời điểm, tần suất
Ví dụ: 上下左右, 以前, 以后, 经常, 偶尔, 最近, 将来, 附近, 周围

#### NHÓM E — XÃ HỘI & VĂN HÓA
**E1 · Chính trị & pháp luật**
Nhận dạng: chính quyền, luật pháp, quyền lợi, chính sách, tổ chức
Ví dụ: 法律, 政府, 权利, 义务, 选举, 民主, 制度, 政策, 国家

**E2 · Văn hóa & nghệ thuật**
Nhận dạng: phong tục, tôn giáo, nghệ thuật, lịch sử, truyền thống
Ví dụ: 文化, 历史, 传统, 艺术, 音乐, 绘画, 节日, 习俗

#### NHÓM F — TỪ CHỨC NĂNG (danh sách đóng)
| Mã | Loại | Ví dụ |
|----|------|-------|
| F1 | Liên từ | 和, 但是, 因为, 所以, 虽然, 如果, 既然, 否则, 而且, 不过 |
| F2 | Giới từ | 在, 从, 到, 对, 把, 被, 为了, 关于, 按照, 除了 |
| F3 | Trợ từ | 了, 过, 着, 吗, 吧, 呢, 啊, 的, 地, 得, 嘛, 啦, 哟 |
| F4 | Phó từ | 很, 非常, 太, 最, 也, 都, 就, 才, 还, 已经, 一直, 一定, 曾经, 突然 |
| F5 | Đại từ | 我, 你, 他, 她, 它, 我们, 你们, 他们, 这, 那, 谁, 什么, 哪, 怎么 |
| F6 | Lượng từ | 个, 本, 张, 条, 件, 辆, 只, 把, 次, 遍, 种, 位, 名, 块, 点, 些 |

---

## PHẦN 3 — PIPELINE PHÂN LOẠI 3 LỚP

> Pipeline này chạy cho mọi từ: cả 5.002 từ HSK lúc import, và từng từ mới bóc ra sau này.
> Ưu tiên lớp trên → chỉ xuống lớp dưới khi lớp trên không xác định được.

```
┌─────────────────────────────────────────────────────────┐
│  INPUT: simplified + meaning_vi + example_zh + source   │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │  LỚP 1 — TỪ CHỨC NĂNG  │  App tự tra danh sách đóng ~80 từ
          │  Độ phủ: ~10%           │  Độ tin cậy: 100%
          │  Kết quả: F1–F6         │
          └────────────┬────────────┘
                  Không khớp
          ┌────────────▼──────────────────┐
          │  LỚP 2 — TỪ KHÓA NGHĨA VIỆT  │  App tra bảng keyword
          │  Độ phủ: ~55% còn lại         │  Độ tin cậy: ~85%
          │  Kết quả: A1–E2               │
          └────────────┬──────────────────┘
                  Không khớp / xung đột
          ┌────────────▼──────────────────────────────────┐
          │  LỚP 3 — QWEN3 CÓ NGỮ CẢNH                   │
          │  Độ phủ: ~35% còn lại                         │  Độ tin cậy: ~90%
          │  Input: từ + nghĩa + câu ví dụ + nguồn        │
          │  Kết quả: A1–E2 + lý do ngắn                  │
          └────────────┬──────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │  LƯU KẾT QUẢ           │
          │  semantic_group         │
          │  classification_source  │  "rule" / "keyword" / "ai"
          │  classification_conf    │  0.0–1.0
          └─────────────────────────┘
                       │
          ┌────────────▼────────────────────────────────────┐
          │  NGƯỜI DÙNG CÓ THỂ SỬA THỦ CÔNG BẤT KỲ LÚC NÀO │
          │  Khi sửa: classification_source = "manual"       │
          │  Từ đã sửa thủ công KHÔNG bao giờ bị ghi đè      │
          └─────────────────────────────────────────────────┘
```

### Bảng từ khóa Lớp 2 (tra trong meaning_vi)

| Từ khóa xuất hiện trong nghĩa | → Nhóm |
|-------------------------------|--------|
| bệnh, ung thư, đau, sốt, thuốc, y tế, phẫu thuật, bác sĩ, bệnh viện, cơ thể, sức khỏe | A1 |
| vui, buồn, sợ, tức, yêu, ghét, lo, cảm xúc, tâm lý, tính cách, cảm giác, tâm trạng | A2 |
| gia đình, bạn bè, đồng nghiệp, chào, xin lỗi, cảm ơn, quan hệ, giao tiếp, lịch sự | A3 |
| ăn, mặc, ngủ, nghỉ, mua, giải trí, hàng ngày, sinh hoạt, nhà ở, đi lại | A4 |
| học, thi, trường, giáo viên, môn học, nghiên cứu, kiến thức, giáo dục, sinh viên | B1 |
| làm việc, công ty, nghề, chức vụ, hợp đồng, nhiệm vụ, nhân viên, quản lý | B2 |
| tiền, ngân hàng, kinh tế, thị trường, đầu tư, lợi nhuận, tiêu dùng, thu nhập, giá | B3 |
| suy nghĩ, phân tích, lý luận, quan điểm, nguyên tắc, lý thuyết, phán đoán, logic | C1 |
| ngôn ngữ, dịch, chữ, văn, giải thích, diễn đạt, mô tả, từ ngữ, câu | C2 |
| núi, sông, biển, thời tiết, động vật, thực vật, môi trường, ô nhiễm, tài nguyên | D1 |
| trên, dưới, trái, phải, trước, sau, thời gian, khi, lúc, thường xuyên, đôi khi, gần đây | D2 |
| luật, chính phủ, quyền, bầu cử, chính sách, dân chủ, nhà nước, pháp luật | E1 |
| văn hóa, lịch sử, nghệ thuật, âm nhạc, hội họa, lễ hội, phong tục, truyền thống | E2 |

### Prompt Qwen3 cho Lớp 3

```
Phân loại từ tiếng Trung sau vào đúng 1 nhóm. Trả lời JSON duy nhất, không giải thích dài.

Từ: {simplified}
Nghĩa tiếng Việt: {meaning_vi}
Câu ví dụ: {example_zh}
Nguồn tài liệu: {source}

Các nhóm:
A1=thân thể/sức khỏe, A2=cảm xúc/tâm lý, A3=quan hệ/giao tiếp, A4=cuộc sống hàng ngày,
B1=học thuật/trường, B2=nghề nghiệp/công sở, B3=kinh tế/tài chính,
C1=tư duy/lý luận, C2=ngôn ngữ/biểu đạt,
D1=tự nhiên/địa lý, D2=không gian/thời gian,
E1=chính trị/pháp luật, E2=văn hóa/nghệ thuật

Trả về: {"group": "XX", "confidence": 0.0-1.0, "reason": "1 câu ngắn"}
Nếu từ có thể thuộc 2 nhóm, ưu tiên nhóm phù hợp với nguồn tài liệu hơn.
```

### 3 cột bổ sung trong bảng `words` cho pipeline này
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `classification_source` | text | "rule" / "keyword" / "ai" / "manual" |
| `classification_conf` | float | 0.0–1.0 (rule=1.0, keyword=0.85, ai=từ Qwen3, manual=1.0) |
| `needs_review` | bool | True nếu ai confidence < 0.7 → hiển thị badge "cần xem lại" trong app |

---

## PHẦN 4 — THÀNH PHẦN HÁN TỰ HAY GẶP (50 thành phần thực tế từ file HSK1–6)

Học các thành phần này giúp đoán nghĩa từ lạ. App dùng danh sách này để sinh bài học
"Nhận diện thành phần" trong module phồn thể và gợi ý liên kết từ cùng gốc.

### Nhóm hành động (thường đứng đầu từ ghép)
| Thành phần | Âm HV | Xuất hiện tiêu biểu | Gợi nhớ |
|-----------|-------|---------------------|---------|
| 发 fā | phát | 发展, 发现, 发生, 出发, 发挥 | "phát" → bùng phát, nảy sinh |
| 动 dòng | động | 运动, 活动, 行动, 感动, 移动 | "động" → chuyển động |
| 打 dǎ | đả | 打算, 打折, 打招呼, 打扰, 打听 | nhiều nghĩa → học theo từng cụm |
| 开 kāi | khai | 开始, 开心, 开发, 公开, 开展 | "khai" → mở ra, bắt đầu |
| 出 chū | xuất | 出现, 提出, 出发, 出口, 突出 | "xuất" → đi ra, hiện ra |
| 成 chéng | thành | 成功, 完成, 成绩, 成为, 形成 | "thành" → thành công, hoàn thành |
| 合 hé | hợp | 合适, 合理, 合同, 结合, 综合 | "hợp" → phù hợp, kết hợp |
| 反 fǎn | phản | 反对, 反应, 反正, 违反, 相反 | "phản" → ngược lại, phản ứng |

### Nhóm trạng thái/tính chất (thường đứng cuối)
| Thành phần | Âm HV | Xuất hiện tiêu biểu | Gợi nhớ |
|-----------|-------|---------------------|---------|
| 心 xīn | tâm | 开心, 担心, 小心, 爱心, 中心 | "tâm" → cảm xúc, trung tâm |
| 气 qì | khí | 天气, 生气, 空气, 勇气, 语气 | "khí" → không khí, tinh thần |
| 理 lǐ | lý | 道理, 管理, 整理, 合理, 理解 | "lý" → lý lẽ, quản lý |
| 力 lì | lực | 能力, 努力, 压力, 实力, 影响力 | "lực" → sức mạnh, khả năng |
| 感 gǎn | cảm | 感觉, 感动, 安全感, 幸福感 | "cảm" → cảm nhận |
| 实 shí | thực | 实现, 实际, 事实, 其实, 现实 | "thực" → thực tế, hiện thực |
| 明 míng | minh | 说明, 证明, 聪明, 文明, 明显 | "minh" → rõ ràng, văn minh |

### Nhóm con người/xã hội
| Thành phần | Âm HV | Xuất hiện tiêu biểu | Gợi nhớ |
|-----------|-------|---------------------|---------|
| 人 rén | nhân | 工人, 个人, 人口, 成人, 感人 | "nhân" → người |
| 生 shēng | sinh | 学生, 生活, 产生, 发生, 生命 | "sinh" → sống, nảy sinh |
| 公 gōng | công | 公司, 公共, 公平, 公开, 公里 | "công" → chung, công cộng |
| 自 zì | tự | 自己, 自信, 自然, 自由, 自动 | "tự" → tự mình |
| 主 zhǔ | chủ | 主要, 主人, 民主, 主动, 做主 | "chủ" → chủ thể, chính |

### Nhóm phủ định (tiền tố)
| Thành phần | Âm HV | Kết hợp phổ biến |
|-----------|-------|-----------------|
| 不 bù | bất | 不安, 不满, 不得不, 不耐烦, 不要紧 (63 lần — nhiều nhất file) |
| 无 wú | vô | 无聊, 无论, 无奈, 无所谓, 无论如何 |
| 非 fēi | phi | 非常, 非法, 非正式, 是非 |

---

## PHẦN 5 — ÁP DỤNG VÀO APP

### 5.1 Lúc import Excel (5.002 từ HSK) — chạy một lần
```
for mỗi từ:
  1. gán struct_group theo độ dài (instant)
  2. if từ in danh_sách_F → semantic_group = F*, source = "rule", conf = 1.0
  3. elif any(kw in meaning_vi for kw in KEYWORD_MAP) → semantic_group = A*/B*/..., source = "keyword", conf = 0.85
  4. else → đưa vào batch Qwen3 (gọi cuối cùng một lần cho toàn bộ)
  5. if ai_conf < 0.7 → needs_review = True
```

### 5.2 Lúc bóc từ từ video/truyện — chạy realtime
Pipeline y hệt, nhưng Qwen3 ở lớp 3 được truyền thêm `source` (vd `story:Tam Quốc`) để
chọn đúng nhóm khi từ đa nghĩa theo ngữ cảnh.

### 5.3 Sửa thủ công trong app
- Mọi từ đều có icon ✏️ cạnh nhãn nhóm
- Khi click → dropdown chọn lại nhóm
- Lưu: `classification_source = "manual"`, `classification_conf = 1.0`, `needs_review = False`
- Từ có `classification_source = "manual"` không bao giờ bị pipeline ghi đè

### 5.4 Format lưu
`struct_group`: chuỗi "S1"–"S5"
`semantic_group`: chuỗi "A1"–"E2" hoặc "F1"–"F6"
`context_tags`: JSON array, ví dụ `["tài_chính","hợp_đồng"]` — dùng cho từ bóc ngoài HSK

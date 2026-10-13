# BÁO CÁO NGHIỆM THU CUỐI CÙNG: HOÀN THIỆN THUẬT TOÁN CHIA PHỤ ĐỀ YOUTUBE ĐIỆN ẢNH VOXLAB (`VOXLAB_YOUTUBE_SUBTITLE_FINAL_OPTIMIZATION_REPORT.md`)

**Dự án:** VoxLab (`lucnguyen911/VOXLAB`)  
**Nhánh:** `master`  
**File kiểm chứng thực tế:** `C:\Users\lucng\Downloads\15.wav` (21 phút 43,07 giây) & `C:\Users\lucng\Downloads\15.srt`  

---

## 1. NGUYÊN NHÂN GỐC RỄ CỦA 3 NHÓM LỖI TRONG `15.srt`

### Nhóm 1 — Cue quá ngắn (`< 0.8s`) và tốc độ đọc quá cao (`> 20 CPS`)
1. **Trường hợp Cue 12–13 (`It's happening.` — `0,375s`, `40,0 CPS`):**
   - Trong `15.wav`, phân đoạn ASR số 6 (`25,400s -> 29,000s`) kết thúc bằng câu *"a quiet rebellion is happening."*.
   - Ngay tại mốc cắt cửa sổ 30 giây của Whisper (`29,000s`), âm thanh thực tế trong `15.wav` từ `29,000s` đến `29,340s` là **khoảng lặng hoàn toàn (`-41,65 dBFS` đến `-66,8 dBFS`)**.
   - Whisper tạo ra 2 token ảo (hallucination) ở đầu phân đoạn số 7:
     - `"It's"`: `29,000s -> 29,060s` (`raw_duration = 0,060s`, `probability = 0,4132`)
     - `"happening."`: `29,060s -> 29,060s` (**`raw_duration = 0,000s`**, `probability = 0,0034`)
   - Trước khi sửa, `build_word_sequence()` ép `if w_end <= w_start: w_end = w_start + 0.05` làm mất dấu hiệu `raw_duration = 0.000s`, khiến cụm hallucination này đi vào bộ tối ưu DP và tạo thành Cue 13 dài `0,375s` (`40,0 CPS`).
2. **Trường hợp Cue 109 (`or VPP.` — `0,780s`) và các cue vượt `20 CPS`:**
   - `_merge_safe_fragment_cues()` trước đây không gộp các mảnh câu cuối ngắn `< 0.80s` khi `_standalone_is_valid()` trả về `True` do có dấu chấm câu, và hàm chi phí `_cue_cost()` chưa phạt tăng dần từ ngưỡng `17,5 CPS` để ưu tiên các điểm ngắt giữ tốc độ đọc trong vùng `14–18 CPS`.

### Nhóm 2 — Tách sai tên riêng, tên sản phẩm, chính sách và cụm từ gắn kết (`Powerwall 3`, `Tesla Powerwall 3`, `NEM 3.0`, `that it depends`)
1. **Thiếu bảo vệ thực thể `Tên sản phẩm / Chính sách + Số phiên bản`:**
   - Hàm `_is_proper_noun_pair()` chỉ kiểm tra `w1[0].isupper() and w2[0].isupper()`, trả về `False` khi từ thứ hai là chữ số hoặc phiên bản (`3`, `3.0`, `9001`, `17`). Do đó `Powerwall | 3` và `NEM | 3.0` không nằm trong `cue_protected` và `line_protected`.
2. **Xung đột chi phí tại Cue 118 (`your Powerwall / 3 can automatically discharge`):**
   - Trong `_boundary_features()`, quy tắc `short subject-predicate split` cộng phạt `+680.0` tại ranh giới `3 | can` ngay cả khi đang xuống dòng nội bộ (`line_wrap=True`), làm cho điểm cắt sai `Powerwall | 3` (`cost = 160`) rẻ hơn điểm cắt đúng `your Powerwall 3 | can automatically discharge` (`cost = 840`).
3. **ASR chèn dấu chấm giả giữa tên sản phẩm và số đọc thành chữ tại Cue 14 (`Tesla Powerwall. Three`):**
   - Ở `31,24s -> 33,12s`, Whisper tách `"Powerwall."` và `"Three"` qua ranh giới segment (`gap = 0,56s`).
4. **Tách `that it | depends` tại Cue 423–424:**
   - Quy tắc trạng từ đuôi `-ly` trong `build_protected_boundary_map()` khóa cứng `entirely | on` (trạng từ đứng sau động từ trước giới từ), khiến toàn bộ cụm 10 từ `"depends entirely on who you are and where you live."` bị khóa cứng và buộc DP phải cắt ngay sau `"that it"`. Đồng thời `"it"` và `"you"` chưa được đưa vào tập đại từ chủ ngữ của mệnh đề phụ (`that it depends`).

### Nhóm 3 — Xuống dòng chưa cân bằng ngữ nghĩa (Cue 4: `For millions / of Americans and Europeans,`)
1. `millions | of` chưa được khóa trong `line_protected` (`QUANTIFIER_OF_HEADS + "of"`).
2. Quy tắc cặp danh từ đẳng lập (`X and Y`) khóa cứng cả `Americans | and` lẫn `and | Europeans` trong `line_protected` ngay cả khi cụm giới từ dài (`For millions of Americans and Europeans,`, 40 ký tự), ép bộ xuống dòng phải ngắt tại `millions | of` (`12 / 27` ký tự) thay vì ngắt tự nhiên trước `and` (`For millions of Americans / and Europeans,`, `25 / 14` ký tự).

---

## 2. KẾT QUẢ ĐỐI CHIẾU `It's happening.` VỚI MASTER WAV VÀ ASR GỐC

| Tiêu chí kiểm tra | Dữ liệu thực tế từ `15.wav` & `large-v3-turbo` | Kết luận |
| :--- | :--- | :--- |
| **Segment trước (`SEG 6`)** | `25,400s -> 29,000s`: `"But in a few garage corners, a quiet rebellion is happening."` (`prob = 0,994`) | Lời nói thật, rõ ràng (`-17,8 dBFS`) |
| **Token nghi vấn (`SEG 7` đầu)** | `"It's"` (`29,000s -> 29,060s`, `prob = 0,4132`), `"happening."` (`29,060s -> 29,060s`, **`raw_duration = 0,000s`**, **`prob = 0,0034`**) | Dấu hiệu đặc trưng của Whisper 30s-window boundary hallucination |
| **Năng lượng âm thanh trong `15.wav` (`29,000s -> 29,340s`)** | **`RMS = -41,65 dBFS`** (từng cửa sổ 100ms từ `29,0s -> 29,3s` đạt `-58,5 dBFS` đến `-66,8 dBFS`) | **Khoảng lặng tuyệt đối — không có tiếng người nói** |
| **Hành xử khi có `wav_path`** | Xác minh âm học `< -35,0 dBFS` + `raw_duration <= 0,015s` + `min_prob < 0,05` -> Loại bỏ hallucination đã xác minh, ghi nhận `verified_silent_hallucination: True, action: "removed"` | Đúng quy định Mục 2 |
| **Hành xử khi KHÔNG có `wav_path`** | Tuyệt đối không xóa từ; giữ nguyên trong phụ đề và ghi nhận `verified_silent_hallucination: False, action: "kept_unverified"` | Đúng quy định Mục 2 (đã kiểm chứng bằng unit test) |

---

## 3. DANH SÁCH FILE ĐÃ SỬA VÀ GIẢI THÍCH THAY ĐỔI

1. **[subtitle_optimizer.py](file:///f:/Source%20Code%20Tool/Voxlab/sidecar/voxlab_sidecar/subtitle_optimizer.py)**:
   - Lưu `raw_duration` gốc của từng từ trong `build_word_sequence()` trước khi chuẩn hóa thời lượng tối thiểu; chuẩn hóa trường hợp thực thể bị ASR tách qua dấu chấm giả (`Powerwall. Three` -> `Powerwall 3`).
   - Bổ sung `filter_asr_hallucinations()` kết hợp kiểm tra xác suất/thời lượng token ASR và đo năng lượng âm học RMS (`_measure_window_rms_db`) trên Master WAV.
   - Bổ sung `_is_entity_designator_pair()` và mở rộng `build_protected_boundary_map()` để bảo vệ `Powerwall 3`, `Tesla Powerwall 3`, `Tesla Model 3`, `NEM 3.0`, `ISO 9001`, `iPhone 17`, cụm `called/named/like the + Entity`, cụm định lượng `millions of / thousands of / billions of`, mệnh đề phụ `that it depends`, và phân biệt cặp danh từ đẳng lập (`vegetables and eggs`, `rau và trứng`) với liên từ nối hai mệnh đề (`and then I went home`, `và sau đó tôi đi về`).
   - Cải tiến `_boundary_features()`, `_wrap_words()`, `_cue_cost()` và `_merge_safe_fragment_cues()` để cân bằng dòng theo đơn vị ngữ nghĩa, phạt sớm `CPS > 17,5` và gộp an toàn các mảnh cue `< 0,80s`.
2. **[protectedSpans.ts](file:///f:/Source%20Code%20Tool/Voxlab/src/services/subtitle/protectedSpans.ts)** & **[candidates.ts](file:///f:/Source%20Code%20Tool/Voxlab/src/services/subtitle/candidates.ts)**:
   - Đồng bộ nhận diện Protected Spans (`Tesla Powerwall 3`, `Powerwall 3`, `NEM 3.0`, `Tesla Model 3`, `1.55 kilowatt hours`, `8,300 pounds`, `$290,000`, `millions of`, v.v.), quy tắc không tách cặp danh từ đẳng lập tại `and`/`và`, và cân bằng dòng ngữ nghĩa trong `wrapCueTextBalanced()`.
3. **[test_subtitle_optimizer.py](file:///f:/Source%20Code%20Tool/Voxlab/sidecar/tests/test_subtitle_optimizer.py)** & **[subtitle_pipeline.test.ts](file:///f:/Source%20Code%20Tool/Voxlab/src/services/subtitle/__tests__/subtitle_pipeline.test.ts)**:
   - Bổ sung đầy đủ các bài kiểm thử hồi quy cho toàn bộ danh sách câu và cụm bắt buộc ở Mục 2, 3, 4, 5 và 7B.

---

## 4. BẢNG SO SÁNH TRƯỚC / SAU CỦA TẤT CẢ CÁC CUE LỖI TRONG `15.srt`

| Vị trí trong `15.srt` cũ | Trước khi sửa (`15.srt`) | Sau khi sửa (`15_optimized.srt`) | Đánh giá |
| :--- | :--- | :--- | :--- |
| **Cue 4** (`00:00:08,280`) | `For millions`<br>`of Americans and Europeans,` (`12 / 27` ký tự) | `For millions of Americans`<br>`and Europeans,` (`25 / 14` ký tự, `2,54s`, `15,4 CPS`) | Giữ nguyên `millions of`, xuống dòng tự nhiên trước `and` |
| **Cue 12–13** (`00:00:27,340`) | Cue 12: `a quiet rebellion is happening.`<br>Cue 13 (`0,375s`, `40 CPS`): `It's happening.` | Cue 12 (`1,88s`, `16,5 CPS`):<br>`a quiet rebellion is happening.`<br>*(Hallucination im lặng `-41,65 dBFS` đã được loại bỏ)* | Triệt tiêu hoàn toàn cue rác `0,375s` / `40 CPS` |
| **Cue 14** (`00:00:29,240`) | `Homeowners using the new Tesla`<br>`Powerwall Three` | `Homeowners using`<br>`the new Tesla Powerwall 3` (`16 / 25` ký tự, `3,88s`, `10,6 CPS`) | Chuẩn hóa `Powerwall 3` và giữ trọn cụm `Tesla Powerwall 3` trên cùng 1 dòng |
| **Cue 108–109** (`00:04:36,460`) | Cue 108: `is called a virtual power plant,`<br>Cue 109 (`0,780s`): `or VPP.` | Cue 105 (`2,76s`, `14,1 CPS`):<br>`is called a virtual power plant,`<br>`or VPP.` | Gộp mảnh ngắn `0,780s` thành cue 2 dòng cân đối |
| **Cue 118** (`00:05:02,460`) | `your Powerwall`<br>`3 can automatically discharge` | Cue 114 (`3,24s`, `13,3 CPS`):<br>`your Powerwall 3`<br>`can automatically discharge` | Không tách `Powerwall` và `3` giữa hai dòng |
| **Cue 363–364** (`00:16:09,280`) | Cue 363: `A battery like the Powerwall`<br>Cue 364: `3 is ultimately just` / `a storage tank;` | Cue 355 (`3,86s`, `12,4 CPS`):<br>`A battery like the Powerwall 3`<br>`is ultimately just` | Không tách `Powerwall 3` giữa hai cue |
| **Cue 394–395** (`00:17:39,500`) | Cue 394: `the introduction` / `of a policy called NEM`<br>Cue 395: `3.0 dramatically slashed...` | Cue 385 (`4,44s`, `9,5 CPS`):<br>`the introduction of a policy`<br>`called NEM 3.0` | Giữ nguyên `called NEM 3.0` trong cùng dòng và cùng cue |
| **Cue 421–422** (`00:18:58,720`) | Cue 421: `Can the Tesla Powerwall`<br>Cue 422: `3 actually end` / `your electric bills forever?` | Cue 414 (`1,98s`, `12,6 CPS`):<br>`Can the Tesla Powerwall 3`<br>Cue 415 (`2,48s`, `17,7 CPS`):<br>`actually end your electric bills`<br>`forever?` | Giữ trọn `Tesla Powerwall 3` trong Cue 414 |
| **Cue 423–424** (`00:19:03,180`) | Cue 423: `The honest answer is that it`<br>Cue 424: `depends entirely on who you` / `are and where you live.` | Cue 416 (`3,18s`, `13,8 CPS`):<br>`The honest answer is`<br>`that it depends entirely`<br>Cue 417 (`2,60s`, `12,7 CPS`):<br>`on who you are`<br>`and where you live.` | Không cắt rời `that it` khỏi động từ `depends`; cân bằng 2 dòng tự nhiên |

---

## 5. THỐNG KÊ ĐỐI CHIẾU TOÀN BỘ FILE SRT (`15.srt` TRƯỚC VÀ SAU KHI SỬA)

| Chỉ số kỹ thuật | Trước khi sửa (`15.srt`) | Sau khi sửa (`15_optimized.srt`) | Mục tiêu nghiệm thu |
| :--- | :---: | :---: | :---: |
| **Tổng số cue** | 484 | **479** | ~460–490 cue điện ảnh |
| **Số cue vượt 2 dòng** | 0 | **0** | `0` |
| **Số dòng vượt 32 ký tự (16:9)** | 0 | **0** (Max = `32`) | `0` |
| **Số cue chồng lấn thời gian (Overlap)** | 0 | **0** | `0` |
| **Số cue quá dài (`> 6,0s`)** | 0 | **0** (Max = `5,64s`) | `0` |
| **Số cue quá ngắn (`< 0,8s`)** | 2 (`0,375s`, `0,780s`) | **0** (Min = **`0,920s`**) | `0` (`>= 0,8s`) |
| **Thời lượng trung bình mỗi cue** | `2,60s` | **`2,63s`** | `2,0–3,5s` |
| **CPS trung bình** | `14,50 CPS` | **`14,30 CPS`** | `14–18 CPS` |
| **CPS cao nhất (Max CPS)** | `40,00 CPS` | **`19,44 CPS`** | `<= 20,0 CPS` |
| **Số cue vượt `20 CPS`** | 19 cue | **0 cue** | Tối thiểu hóa / `0` |
| **Số lỗi tách `Powerwall 3` / `NEM 3.0`** | 5 vị trí | **0 vị trí** | `0` |
| **Cảnh báo chất lượng (`quality_warnings`)** | — | **0** | `0` |

---

## 6. KẾT QUẢ CHẠY BỘ KIỂM THỬ VÀ BUILD TOÀN HỆ THỐNG

1. **Python Unit & Acceptance Tests (`141` tests, bao gồm `14` bài kiểm thử chuyên sâu trong `test_subtitle_optimizer.py`):**
   ```text
   .\sidecar\.venv\Scripts\python.exe -m unittest discover -s sidecar/tests -p "test_*.py" -v
   Ran 141 tests in 6.091s — OK
   ```
2. **TypeScript Subtitle Pipeline Specification Tests (`25` tests trong `subtitle_pipeline.test.ts`):**
   ```text
   npx tsx --test src/services/subtitle/__tests__/subtitle_pipeline.test.ts
   tests 25 | pass 25 | fail 0
   ```
3. **TypeScript Typecheck & Production Build:**
   ```text
   npx tsc --noEmit -> Exit code 0
   npm run build    -> ✓ built in 3.77s (Exit code 0)
   ```
4. **Rust Tauri Backend Check:**
   ```text
   cargo check --manifest-path src-tauri/Cargo.toml -> Finished `dev` profile in 0.23s (Exit code 0)
   ```

# BÁO CÁO KỸ THUẬT: KHẮC PHỤC CẢNH BÁO VẤP TỪ GIẢ VÀ HOÀN THIỆN CĂN CHỈNH TTS VOXLAB

**Dự án:** VOXLAB — Bộ công cụ tạo và kiểm soát chất lượng giọng đọc TTS  
**Nhánh:** `master`  
**Phiên bản kiểm tra & cập nhật:** `v2.2.0`  
**Ngày thực hiện:** 11/10/2026  

---

## 1. TỔNG QUAN VÀ MỤC TIÊU XỬ LÝ

Trong quá trình người dùng sử dụng VoxLab để kiểm tra chất lượng giọng đọc (TTS Quality Validation) với câu kịch bản:
> *"Picture roughly three hundred cars filling it, row after row, and not one of them has a steering wheel."*

Mặc dù người dùng nghe thực tế thấy đoạn âm thanh đọc cụm **`row after row`** hoàn toàn bình thường, tự nhiên và đúng 100% kịch bản, hệ thống VoxLab trước đây lại báo lỗi:
> **`Vấp từ — row — 00:05`**

Đồng thời, hệ thống chuẩn hóa số (Number Normalizer) còn gặp hạn chế:
1. **Số thứ tự (Ordinals):** Các từ thứ tự tiếng Anh như `twenty third`, `twenty eighth`, `first`, `second` bị tách rời hoặc không nhận diện tương đương với dạng số viết hoa/viết tắt (`23rd`, `28th`, `23`, `28`).
2. **Dãy số phân cách bởi dấu phẩy:** Cụm kịch bản như `"sixty nine, one hundred twenty six, one hundred fifty eight"` bị gộp nối tiếp thành một số khổng lồ duy nhất `702758` do hàm phân tích số nuốt xuyên qua dấu phẩy.
3. **Cơ chế tái kiểm tra (Re-validation):** Khi hệ thống cập nhật thuật toán phát hiện lỗi hoặc sửa lỗi cảnh báo giả, người dùng không có cách nào để chạy lại kiểm tra chất lượng trên file WAV đã sinh mà phải tốn thời gian tổng hợp lại toàn bộ giọng đọc từ đầu.

---

## 2. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)

### 2.1. Cảnh báo vấp từ giả trên `row after row`
* **Vị trí mã nguồn:** `sidecar/voxlab_sidecar/audio_quality.py::detect_acoustic_stutter()` (dòng 1044–1054 ở commit `68c9d43`).
* **Cơ chế gây lỗi:**
  1. Trong đoạn âm thanh `row after row`, mô hình phát hiện 2 đợt năng lượng âm thanh (bursts): Burst 1 rơi vào từ `row` thứ nhất (vị trí ASR index 0), Burst 2 rơi vào từ `row` thứ hai (vị trí ASR index 2).
  2. Ở giữa 2 từ `row` này là từ `after` (ASR index 1). Vì `after` là từ ngắn (~0.2s) và có khoảng trũng năng lượng nhẹ, khoảng cách giữa 2 bursts thỏa mãn điều kiện `0.01s <= valley_sec <= 0.40s`.
  3. Cả 2 từ `row` do cùng một giọng đọc phát âm nên có đặc trưng âm phổ (spectral profile) tương đồng cao (`cos_sim >= 0.85`) và độ dài gần bằng nhau (`abs(dur1 - dur2) <= 0.055`).
  4. Thuật toán cũ kiểm tra:
     ```python
     if w_idx1 is not None and w_idx2 is not None and w_idx1 != w_idx2:
         if word1_clean == word2_clean:
             if word1_clean not in intentional_repeats:
                 is_verified_stutter = True
                 stutter_word = word1_clean
     ```
  5. Vì `w_idx1 = 0` và `w_idx2 = 2` thỏa mãn `w_idx1 != w_idx2`, và `word1_clean == word2_clean == "row"`.
  6. Biến `intentional_repeats` trước đó chỉ được tính khi 2 từ giống nhau nằm **liền kề nhau** trong kịch bản (`text_words[idx] == text_words[idx+1]`). Do trong kịch bản có từ `after` nằm giữa, `"row"` không nằm trong `intentional_repeats`.
  7. Thuật toán hoàn toàn **bỏ quên việc kiểm tra xem 2 từ ASR có phải là 2 từ liền kề hay không** (`abs(w_idx2 - w_idx1) == 1`). Hệ thống đã ghép một từ ở đầu câu với một từ lặp lại ở cuối câu và coi đó là hiện tượng vấp âm lặp từ!
  8. Hậu quả: Hệ thống gán `is_verified_stutter = True` và trả về `SUSPECTED_STUTTER` trên từ `row` tại thời điểm 00:05.

### 2.2. Hạn chế của Bộ Chuẩn Hóa Số (Number Normalizer)
1. **Nuốt xuyên dấu ngắt câu (Missing Boundary Check):**
   Trong `parse_english_number_phrase` và `parse_vietnamese_number_phrase`, vòng lặp đọc từ số (`EN_ONES`, `EN_TENS`, `EN_SCALES`) tiếp tục duyệt các token mà không kiểm tra dấu phân cách (dấu phẩy `,`, dấu chấm phẩy `;`, gạch ngang `—`, xuống dòng `\n`). Do đó, `"sixty nine, one hundred twenty six, one hundred fifty eight"` bị cộng dồn: `60 + 9 + 100 + 20 + 6 + 100 + 50 + 8` thành `702758`.
2. **Thiếu hỗ trợ số thứ tự (Ordinals):**
   Các từ `first`, `second`, `third`, `twenty third`, `twenty eighth` không có trong từ điển số đếm, dẫn đến việc không thể nhận diện được chúng tương đương với các cách viết số thứ tự như `23rd`, `28th`, `1st` hay số thường `23`, `28`.

---

## 3. CÁC THAY ĐỔI ĐÃ TRIỂN KHAI

### 3.1. Sửa thuật toán phát hiện vấp âm trong `detect_acoustic_stutter()`
* **Quy tắc bắt buộc về tính liền kề (Adjacency Requirement):**
  Hai burst âm thanh chỉ có thể là vấp âm hoặc lặp từ nếu chúng thuộc về **cùng một từ** (`w_idx1 == w_idx2`) hoặc **hai từ phát âm liên tiếp ngay sát nhau** trong ASR (`abs(w_idx2 - w_idx1) == 1`).
  Nếu giữa 2 từ có từ khác xen vào (như từ `after` trong `row after row`), hai từ đó là hai từ độc lập trong câu, tuyệt đối không thể là hiện tượng vấp âm:
  ```python
  if abs(w_idx2 - w_idx1) != 1:
      continue
  ```
* **Căn chỉnh nhận biết vị trí kịch bản (Position-Aware Alignment):**
  Nếu 2 từ liền kề nhau có cùng nội dung (`word1_clean == word2_clean`), hệ thống sử dụng căn chỉnh `SequenceMatcher` để kiểm tra:
  - Nếu cả `w_idx1` và `w_idx2` đều thuộc danh sách các từ khớp hợp lệ trong kịch bản (`equal_asr_indices`), hoặc số lượng từ trong ASR không vượt quá số lượng từ trong kịch bản (`asr_count <= src_count`): Bỏ qua, đây là sự lặp lại có chủ đích trong kịch bản (ví dụ: `that that` trong *"I know that that is true"*).
  - Nếu một trong hai từ là từ chèn thêm ngoài kịch bản (`asr_count > src_count`): Báo lỗi vấp từ / lặp từ thật (`row row after row`).

### 3.2. Căn chỉnh phát hiện lặp từ trong `analyze_word_alignment_issues()`
* Loại bỏ việc bỏ qua lặp từ dựa trên tập hợp toàn cục `if w_clean in intentional_repeats: continue` vốn làm lọt lỗi khi mô hình đọc lặp quá số lần quy định (ví dụ đọc 3 lần `that that that` khi kịch bản chỉ có 2 lần).
* Thay thế bằng so khớp số lượng chuẩn xác theo ngữ cảnh:
  ```python
  src_count = source_words_clean.count(w_clean)
  asr_count = asr_words_clean.count(w_clean)
  if asr_count <= src_count:
      continue
  ```

### 3.3. Nâng cấp toàn diện Bộ Chuẩn Hóa Số (`number_normalizer.py`)
1. **Bổ sung từ điển số thứ tự tiếng Anh và tiếng Việt:**
   - `EN_ORDINALS`: `first`, `second`, `third`, ..., `twentieth`, `thirtieth`, ..., `hundredth`, `thousandth`.
   - `VI_ORDINALS`: `nhất`, `nhì`, `tư`.
   - Hàm `format_ordinal(num)`: Chuyển đổi chính xác 1 $\rightarrow$ `1st`, 2 $\rightarrow$ `2nd`, 3 $\rightarrow$ `3rd`, 23 $\rightarrow$ `23rd`, 28 $\rightarrow$ `28th`, 123 $\rightarrow$ `123rd`.
2. **Hỗ trợ số thứ tự ghép & số có gạch nối:**
   - Xử lý `twenty third` $\rightarrow$ `23rd`, `twenty eighth` $\rightarrow$ `28th`.
   - Xử lý số có gạch nối như `twenty-third` $\rightarrow$ `23rd`, `sixty-nine` $\rightarrow$ `69`, `fifty-five` $\rightarrow$ `55`.
3. **Cơ chế ngắt theo ranh giới mệnh đề / dấu câu:**
   - Hàm `has_trailing_boundary(token)` và `is_word_boundary(w_idx)` kiểm tra dấu phân cách sau mỗi từ số.
   - Khi kết thúc một số và gặp dấu phẩy `,` hoặc dấu chấm phẩy `;`, hệ thống lập tức chốt giá trị số hiện tại và kết thúc biểu thức số, không gộp tiếp sang từ kế tiếp.
   - `"sixty nine, one hundred twenty six, one hundred fifty eight"` được tách và chuẩn hóa chính xác thành: `['69', '126', '158']`.
4. **Mở rộng tương đương số thứ tự (`are_number_expressions_equivalent`):**
   - Loại bỏ hậu tố thứ tự (`st`, `nd`, `rd`, `th`) và tiền tố tiếng Việt (`thứ`, `thu`) khi so sánh giá trị số.
   - Nhận diện `twenty third` $\equiv$ `23rd` $\equiv$ `23`.
   - Nhận diện `twenty eighth` $\equiv$ `28th` $\equiv$ `28`.
   - Nhận diện `thứ nhất` $\equiv$ `thứ 1` $\equiv$ `1`.

### 3.4. Bổ sung cơ chế Tái kiểm tra chất lượng (Re-validation Mechanism)
1. **Theo dõi phiên bản bộ thẩm định chất lượng (`validatorVersion: "2.2.0"`):**
   - Bổ sung trường `validatorVersion?: string;` trong giao diện `AudioQualityReview` (`src/types/ui.ts`).
   - Thêm hằng số `QUALITY_VALIDATOR_VERSION = "2.2.0"` và hàm `isReviewOutdated(chunk)` trong `src/services/audio/qualityValidator.ts`.
2. **Nút "Kiểm tra lại" không cần tạo lại giọng đọc:**
   - Trong `src/views/TtsWorkspace.tsx`, bổ sung hàm `handleRevalidateChunk(chunkId)` và trạng thái `revalidatingChunkIds`.
   - Hiển thị nút **"Kiểm tra lại"** kèm biểu tượng `RefreshCw` và tooltip phiên bản ngay trong khu vực xem chi tiết cảnh báo của từng đoạn.
   - Khi người dùng nhấn nút, hệ thống chỉ chạy kiểm tra chất lượng (ASR + phân tích âm thanh) trên file WAV hiện có, cập nhật tức thời bảng cảnh báo mà không tốn tài nguyên và thời gian gọi lại TTS engine.

---

## 4. KẾT QUẢ KIỂM THỬ VÀ XÁC MINH

### 4.1. Bộ kiểm thử Python (`sidecar/tests/`)
Chạy toàn bộ 105 bài kiểm thử unit tests của Sidecar:
```
Ran 105 tests in 5.094s
OK
```
* `test_row_after_row_no_false_stutter`: Xác minh `Picture roughly three hundred cars filling it, row after row...` trả về chính xác **0 cảnh báo** (không còn báo vấp từ giả trên `row`).
* `test_row_row_after_row_flags_stutter`: Xác minh khi cố tình đọc lặp `row row after row`, hệ thống phát hiện chính xác `REPEATED_WORD` / `SUSPECTED_STUTTER`.
* `test_excessive_repeat_that_that_that_flags_repetition`: Xác minh khi kịch bản có 2 từ `that that` nhưng giọng đọc đọc 3 lần `that that that`, hệ thống cảnh báo đúng từ thừa.
* `test_comma_separated_number_sequences`: Xác minh chuỗi `"sixty nine, one hundred twenty six, one hundred fifty eight"` chuẩn hóa thành `['69', '126', '158']` mà không bị gộp số.
* `test_english_ordinals_and_hyphenated`: Kiểm tra đầy đủ các số thứ tự `first`, `second`, `third`, `fourth`, `twenty third`, `twenty eighth`, `twenty-third`, `sixty-nine`.
* `test_ordinal_number_equivalence`: Kiểm tra tính tương đương số giữa chữ viết thường, số thứ tự và số đếm thông thường.

### 4.2. Bộ kiểm thử TypeScript/Node (`src/services/audio/__tests__/`)
Chạy toàn bộ 19 bài kiểm thử unit tests của Quality Validator:
```
✔ Audio Quality Validator Tests (3.3638ms)
ℹ tests 19
ℹ pass 19
ℹ fail 0
```
* Bài test `V19` kiểm tra phát hiện đánh giá chất lượng cũ (`isReviewOutdated`) và liên kết phiên bản `validatorVersion: "2.2.0"`.

### 4.3. Kiểm tra biên dịch toàn hệ thống
* **Frontend Vite / React:** `npm run build` thành công, không có lỗi TypeScript hay cảnh báo biến không sử dụng (`tsc && vite build`).
* **Backend Rust / Tauri:** `cargo check --manifest-path src-tauri/Cargo.toml` biên dịch thành công 100%.

---

## 5. KẾT LUẬN

Hệ thống kiểm tra chất lượng giọng đọc TTS của VoxLab tại phiên bản **v2.2.0** đã giải quyết triệt để vấn đề cảnh báo vấp từ giả trên cụm từ lặp hợp lệ theo kịch bản như `row after row`, hỗ trợ toàn diện các dạng số thứ tự và dãy số ngăn cách bởi dấu câu, đồng thời cung cấp công cụ cho phép người dùng chủ động tái kiểm tra chất lượng file âm thanh đã sinh bất cứ lúc nào.

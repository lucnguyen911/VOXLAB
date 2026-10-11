# BÁO CÁO KỸ THUẬT: TỐI ƯU THUẬT TOÁN HẬU KIỂM TTS VOXLAB — TRIỆT TIÊU CẢNH BÁO SAI

**Dự án:** VoxLab  
**Repository:** `lucnguyen911/VOXLAB`  
**Nhánh:** `master`  
**Ngày thực hiện:** 11/10/2026  

---

## 1. TỔNG QUAN & MỤC TIÊU ĐẠT ĐƯỢC

Trong đợt thử nghiệm với các tệp âm thanh thực tế `VoxLab_01_Matt_auto_signals.wav` và `VoxLab_04_Matt_auto_signals.wav`, hệ thống hậu kiểm TTS (TTS Quality Validation) phát sinh 2 nhóm cảnh báo sai nghiêm trọng:

1. **Cảnh báo vấp âm sai (`SUSPECTED_STUTTER`):**
   - Từ `children` đọc hoàn toàn sạch, chuẩn tại 00:08 nhưng bị gán huy hiệu `Vấp từ` (khoảng 8.31s – 8.61s).
   - Từ `over` đọc hoàn toàn sạch, chuẩn tại 00:25 nhưng bị gán huy hiệu `Vấp từ` (khoảng 25.91s – 26.17s).
2. **Cảnh báo nuốt chữ sai do cách viết số (`SUSPECTED_SWALLOWED`):**
   - Kịch bản gốc ghi `three hundred cars`, Whisper ASR ghi nhận `300 cars` $\rightarrow$ bị cảnh báo nuốt từ `three`, `hundred`.
   - Kịch bản gốc ghi `over fifty five should`, Whisper ASR ghi nhận `over 55 should` $\rightarrow$ bị cảnh báo nuốt từ `fifty`, `five`.

### Kết quả sau khi tối ưu:
- **Tệp `VoxLab_01_Matt_auto_signals.wav`:** Trạng thái **`pass`** (0 lỗi/cảnh báo, triệt tiêu hoàn toàn false positive `three hundred` $\rightarrow$ `300`).
- **Tệp `VoxLab_04_Matt_auto_signals.wav`:** Trạng thái **`pass`** (0 lỗi/cảnh báo, triệt tiêu hoàn toàn false positive trên `children`, `over` và `fifty five` $\rightarrow$ `55`).
- **Bảo toàn 100% phát hiện lỗi thật (True Positives):**
  - Test 11 phát âm thừa từ ngoài kịch bản (`should`) $\rightarrow$ Phát hiện chính xác `EXTRA_WORD`.
  - Test 10 phát âm thừa từ ngoài kịch bản (`Eat`) $\rightarrow$ Phát hiện chính xác `EXTRA_WORD`.
  - Test 11 phát âm sai (`steering` $\rightarrow$ `steelering`) $\rightarrow$ Phát hiện chính xác `SUSPECTED_MISPRONUNCIATION`.
  - Nuốt một phần số (kịch bản `three hundred`, đọc `three`) $\rightarrow$ Phát hiện chính xác `SUSPECTED_SWALLOWED` tại `hundred`.
  - Nuốt một phần số (kịch bản `fifty five`, đọc `50`) $\rightarrow$ Phát hiện chính xác `SUSPECTED_SWALLOWED` tại `five`.
  - Lặp từ ngoài ý muốn không có trong kịch bản (`that that`) $\rightarrow$ Phát hiện chính xác `REPEATED_WORD`.
  - Lặp từ có chủ đích trong kịch bản (`that that`) $\rightarrow$ Bỏ qua an toàn, không báo động giả.
  - Nghỉ bất thường không dấu ngắt (> 0.5s) $\rightarrow$ Phát hiện chính xác `ABNORMAL_PAUSE`.

---

## 2. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)

### 2.1. Lỗi A — Cảnh báo vấp âm sai trên từ đa âm tiết (`children`, `over`)
* **Vị trí mã nguồn:** `sidecar/voxlab_sidecar/audio_quality.py::detect_acoustic_stutter()` (dòng 1021–1031).
* **Cơ chế gây lỗi:**
  - Thuật toán trích xuất các xung năng lượng âm thanh (energy bursts) và đo độ tương đồng phổ cosin (`cos_sim`) qua 32 dải tần FFT.
  - Từ đa âm tiết tự nhiên như `child-ren` (/tʃɪl/ + /drən/) hoặc `o-ver` (/oʊ/ + /vər/) đều có 2 âm tiết nối tiếp nhau, ngăn cách bởi một điểm trũng năng lượng tự nhiên do phụ âm tắc/xát (/d/, /v/).
  - Trong giọng đọc TTS phòng thu sạch, năng lượng và cấu trúc formant dải thấp của 2 âm tiết trong cùng một từ có độ tương đồng cosin đạt $\ge 0.90$ với độ sâu trũng $\le 0.20 \times \text{peak}$.
  - Đoạn mã trước đây kiểm tra:
    ```python
    elif w_idx1 is not None and w_idx2 is not None and w_idx1 == w_idx2:
        if cos_sim >= 0.90 and min_gap_rms <= 0.20 * min_burst_peak:
            is_verified_stutter = True  # SAI! Gán nhầm âm tiết thường thành vấp âm
    ```
  - Do `w_idx1 == w_idx2` (cùng rơi vào 1 từ duy nhất trong ASR với xác suất rất cao $> 0.96$), việc chỉ dựa vào đặc tính âm học thô để kết luận vấp âm nội từ đã biến mọi từ đa âm tiết thông thường thành ứng viên vấp âm.

### 2.2. Lỗi B — Cảnh báo thiếu từ sai do biểu diễn số (`three hundred` vs `300`, `fifty five` vs `55`)
* **Vị trí mã nguồn:** `sidecar/voxlab_sidecar/audio_quality.py::analyze_word_alignment_issues()`.
* **Cơ chế gây lỗi:**
  - `difflib.SequenceMatcher` so khớp trực tiếp trên danh sách các từ thô đã làm sạch.
  - Kịch bản gốc chứa 2 từ độc lập: `['three', 'hundred']` hoặc `['fifty', 'five']`.
  - Mô hình Whisper ASR tự động chuẩn hóa văn bản nói thành ký tự số: `['300']` hoặc `['55']`.
  - Phép đối sánh sinh ra thao tác thay thế không đồng đều (`replace` opcode) với $i_2 - i_1 = 2 > j_2 - j_1 = 1$.
  - Thuật toán kiểm tra từng từ trong kịch bản gốc: `are_words_equivalent('three', '300')` $\rightarrow$ `False`, `are_words_equivalent('hundred', '300')` $\rightarrow$ `False`.
  - Kết quả: cả `three` và `hundred` bị đưa vào danh sách `unrepresented_content_indices`, kích hoạt cảnh báo `SUSPECTED_SWALLOWED`.

---

## 3. GIẢI PHÁP TRIỂN KHAI

### 3.1. Xây dựng Module Chuẩn hóa Số Học: `number_normalizer.py`
Xây dựng một module chuẩn hóa chuyên dụng tại `sidecar/voxlab_sidecar/number_normalizer.py`:
- **Hỗ trợ biểu thức số ghép tiếng Anh:**
  - Số nguyên chữ: `three hundred` $\rightarrow$ `300`, `fifty five` $\rightarrow$ `55`, `one hundred fifty eight` $\rightarrow$ `158`, `two million` $\rightarrow$ `2000000`.
  - Số thập phân: `three point one four` $\rightarrow$ `3.14`.
  - Giờ phút: `ten thirty` $\rightarrow$ `10:30`.
  - Năm: `twenty twenty six` $\rightarrow$ `2026`.
  - Phần trăm & số âm: `fifty percent` $\rightarrow$ `50%`, `minus five` $\rightarrow$ `-5`.
- **Hỗ trợ biểu thức số ghép tiếng Việt:**
  - `ba trăm` $\rightarrow$ `300`, `năm mươi lăm` $\rightarrow$ `55`, `hai nghìn không trăm hai mươi sáu` $\rightarrow$ `2026`.
  - `ba phẩy một bốn` $\rightarrow$ `3.14`, `mười giờ ba mươi` $\rightarrow$ `10:30`, `năm mươi phần trăm` $\rightarrow$ `50%`.
- **Bảo vệ định dạng đặc thù:**
  - Bảo toàn địa chỉ IP (`127.0.0.1` giữ nguyên, không gộp nhầm thành `127001`).
  - Chuẩn hóa dấu phân tách hàng nghìn: `1,000` $\rightarrow$ `1000`, `10.000.000` $\rightarrow$ `10000000`.
- **Cấu trúc `NormalizedSpan` giữ nguyên chỉ số gốc:**
  ```python
  class NormalizedSpan(NamedTuple):
      canonical: str      # Giá trị chuẩn hóa (ví dụ "300")
      orig_start: int     # Chỉ số từ bắt đầu trong mảng từ gốc
      orig_end: int       # Chỉ số từ kết thúc trong mảng từ gốc
      is_number: bool     # Cờ đánh dấu có phải số hay không
  ```

### 3.2. Tích hợp Đối sánh Theo Khoảng (`Span-based Sequence Alignment`)
Trong `audio_quality.py::analyze_word_alignment_issues()`:
1. Chuyển đổi cả `source_words` và `asr_words` sang các `NormalizedSpan` thông qua `collapse_number_tokens(words, language)`.
2. Chạy `SequenceMatcher` trên danh sách `canonical`:
   - `['roughly', '300', 'cars']` đối sánh với `['roughly', '300', 'cars']` $\rightarrow$ Khớp hoàn hảo `equal`!
3. Ánh xạ chính xác khoảng chỉ số ASR sang kịch bản nguồn (`asr_to_source`), bảo đảm các phép kiểm tra dấu câu và thời gian nghỉ (`ABNORMAL_PAUSE`) hoạt động chính xác đến từng từ.
4. Khi xảy ra `replace` hoặc `delete`, chuyển đổi ngược từ span index sang khoảng từ gốc `orig_i1..orig_i2` và `orig_j1..orig_j2` để kiểm tra nuốt chữ hoặc phát âm sai thật sự.

### 3.3. Tối ưu Phát hiện Vấp Âm Trong `detect_acoustic_stutter()`
- Áp dụng nguyên tắc phối hợp âm vị / văn bản:
  - Khi `w_idx1 == w_idx2`: 2 xung năng lượng nằm trong cùng một từ ASR được nhận dạng đơn lẻ với độ tin cậy cao.
  - **Không phát cảnh báo vấp âm** chỉ dựa trên độ tương đồng cosin nếu từ đó là từ đơn sạch bình thường (`children`, `over`).
  - Chỉ xác nhận vấp âm nội từ khi có dấu hiệu lặp văn bản/âm tiết phối hợp (ví dụ: ASR nhận dạng `mo-mo-mobile` hoặc `ch-children`).
  - Khi không có dữ liệu ASR (ví dụ bài kiểm thử sóng âm tổng hợp), ngưỡng âm học thuần túy (`cos_sim >= 0.92`, `min_gap_rms <= 0.20 * min_burst_peak`) vẫn được duy trì an toàn.

---

## 4. MA TRẬN KIỂM CHỨNG & KẾT QUẢ TEST

| Tình huống kiểm thử | Trước khi sửa | Sau khi sửa | Đánh giá |
| :--- | :--- | :--- | :--- |
| `VoxLab_04`: `children` tại 00:08 | Cảnh báo sai `SUSPECTED_STUTTER` | **Không báo lỗi** (`pass`) | **Đạt** |
| `VoxLab_04`: `over` tại 00:25 | Cảnh báo sai `SUSPECTED_STUTTER` | **Không báo lỗi** (`pass`) | **Đạt** |
| `VoxLab_01`: `three hundred` $\rightarrow$ `300` | Cảnh báo sai `SUSPECTED_SWALLOWED` | **Không báo lỗi** (`pass`) | **Đạt** |
| `VoxLab_04`: `fifty five` $\rightarrow$ `55` | Cảnh báo sai `SUSPECTED_SWALLOWED` | **Không báo lỗi** (`pass`) | **Đạt** |
| Thừa từ Test 11 (`should`) | Báo `EXTRA_WORD` | **Báo `EXTRA_WORD`** | **Bảo toàn** |
| Thừa từ Test 10 (`Eat`) | Báo `EXTRA_WORD` | **Báo `EXTRA_WORD`** | **Bảo toàn** |
| Phát âm sai Test 11 (`steering` $\rightarrow$ `steelering`) | Báo `SUSPECTED_MISPRONUNCIATION` | **Báo `SUSPECTED_MISPRONUNCIATION`** | **Bảo toàn** |
| Nuốt từ số (`three hundred` $\rightarrow$ `three`) | Báo `SUSPECTED_SWALLOWED` | **Báo `SUSPECTED_SWALLOWED`** | **Bảo toàn** |
| Nuốt từ số (`fifty five` $\rightarrow$ `50`) | Báo `SUSPECTED_SWALLOWED` | **Báo `SUSPECTED_SWALLOWED`** | **Bảo toàn** |
| Lặp từ ngoài kịch bản (`that that`) | Báo `REPEATED_WORD` | **Báo `REPEATED_WORD`** | **Bảo toàn** |
| Lặp từ trong kịch bản (`that that`) | Không báo lỗi | **Không báo lỗi** | **Bảo toàn** |
| Nghỉ dài không dấu ngắt (> 0.5s) | Báo `ABNORMAL_PAUSE` | **Báo `ABNORMAL_PAUSE`** | **Bảo toàn** |
| Số không tương đương (`300` vs `30`, `55` vs `50`) | Báo `SUSPECTED_SWALLOWED` | **Báo `SUSPECTED_SWALLOWED`** | **Bảo toàn** |
| Địa chỉ IP (`127.0.0.1` vs `127001`) | Không khớp | **Không khớp (phát hiện lỗi)** | **Bảo toàn** |

---

## 5. KẾT QUẢ CHẠY TOÀN BỘ SUITE KIỂM THỬ DỰ ÁN

1. **Python Sidecar Test Suite:**
   ```
   Ran 97 tests in 4.695s - OK
   ```
   (Bao gồm 51 tests trong `test_audio_quality.py`, 6 tests mới trong `test_number_normalizer.py`, cùng toàn bộ các bộ test pipeline TTS, clone, audio ops, protocol).
2. **TypeScript / Frontend Quality Validator Tests:**
   ```
   tests 18, suites 1, pass 18, fail 0 (162.8ms)
   ```
3. **Frontend Production Build:**
   ```
   tsc && vite build - built in 3.69s (Exit code 0)
   ```
4. **Rust Backend Check:**
   ```
   cargo check --manifest-path src-tauri/Cargo.toml - Finished in 0.23s (Exit code 0)
   ```
5. **Tuân thủ quy chuẩn CONSTRAINTS.md:**
   - 0 comment ức chế (`@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`).
   - Mọi ngưỡng thuật toán mới đều được chú thích `# TUNING REQUIRED (CONSTRAINTS.md section 7.2)`.

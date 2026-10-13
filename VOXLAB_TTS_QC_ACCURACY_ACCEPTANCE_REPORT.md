# VOXLAB TTS QC ACCURACY ACCEPTANCE REPORT

## 1. Bối cảnh và Mục tiêu

Báo cáo này ghi nhận kết quả điều tra nguyên nhân gốc, nâng cấp thuật toán hậu kiểm chất lượng giọng đọc (TTS Quality Control) và nghiệm thu thực tế trên bộ **85 chunk WAV** (`chunk_01_1791893386998.wav` .. `chunk_85_1791893622218.wav`) cùng tệp nhật ký thực tế `VoxLab_TTS_Log_If_you_are_over_fifty_five_yo_20261013_191514.txt`.

- **Mô hình ASR sử dụng:** `faster-whisper-large-v3-turbo` (`CUDA float16`) đồng bộ duy nhất từ cấu hình tab Phụ đề.
- **Phiên bản Validator:** nâng lên `2.6.0` để tự động làm mới các đánh giá cũ bị cảnh báo giả trong bộ nhớ đệm.

---

## 2. Phân tích Nguyên nhân Gốc của 20 Chunk Cảnh báo Cũ (29 Nghi vấn)

Lưu ý về đánh số trong log cũ: `ttsLogExporter.ts` trước khi sửa đã cộng `+ 1` vào `chunk.index` vốn đã đánh số từ `1..85`, khiến `chunk_02` hiển thị thành `[ĐOẠN 03] (ID: chunk_02)`. Lỗi hiển thị chỉ số đoạn này đã được khắc phục.

| STT | Chunk ID | Cảnh báo cũ | Văn bản kịch bản gốc | Token Raw từ Whisper (`large-v3-turbo`) | Nguyên nhân gốc | Kết quả sau sửa |
|---|---|---|---|---|---|---|
| 1 | `chunk_02` | `SUSPECTED_SWALLOWED` (`eighty`, `thousand`) | `up to eighty two thousand pounds` | `["up", "to", "82", ",000", "pounds"]` | Whisper tách BPE `82,000` thành 2 token `["82", ",000"]`, bộ chuẩn hóa cũ xuất thành `["82", "000"]` thay vì `"82000"`. | **Đạt (Pass)** |
| 2 | `chunk_04` | `EXTRA_WORD` (`Bye`) | `...and here is why.` | Primary: `"... why."` (`endSec=18.10s`, âm tiết kéo dài tới `18.30s`) | `recover_unaligned_words` cắt lát `[18.10, 18.59]` ngay giữa đuôi nguyên âm của `"why."`, khiến Whisper nhận diện nhầm đuôi âm tiết thành `"Bye"`. | **Đạt (Pass)** |
| 3 | `chunk_11` | `SUSPECTED_SWALLOWED` (`fifteen`, `thousand`, `four`, `hundred`), `SUSPECTED_STUTTER` (`55`) | `fifteen thousand four hundred miles ... fifty five` | `["15", "400", "miles", ..., "55"]` | (1) `["15", "400"]` chưa được gộp thành `"15400"`; (2) `detect_acoustic_stutter` dùng regex `^(\w{1,3})\1+` khớp nhầm chữ số lặp `"55"`. | **Đạt (Pass)** |
| 4 | `chunk_15` | `REPEATED_WORD` (`instead`) | `...used in the sentence instead.` | Primary: `"... instead."` (`endSec=9.82s`, âm tiết `-stead` kéo tới `10.26s`) | `recover_unaligned_words` cắt lát `[9.82, 10.56]` chứa nửa sau `-stead` của từ cuối, làm Whisper chép lại `"instead"` lần 2. | **Đạt (Pass)** |
| 5 | `chunk_29` | `SUSPECTED_SWALLOWED` (`two`, `thousand`, `eight`, `hundred`) | `two thousand eight hundred cycles` | `["2", ",800", "cycles"]` | Whisper tách `2,800` thành `["2", ",800"]` (`["2", "800"]` != `"2800"`). | **Đạt (Pass)** |
| 6 | `chunk_33` | `SUSPECTED_SWALLOWED`, `EXTRA_WORD` (`-70`) | `sixty to seventy percent` | `["60", "-70", "%"]` | Whisper định dạng khoảng phần trăm bằng dấu gạch nối `60 -70 %`; token `"-70"` bị hiểu nhầm là số âm thay vì dải `"to 70%"`. | **Đạt (Pass)** |
| 7 | `chunk_40` | `SUSPECTED_SWALLOWED` (`two`, `hundred`, `and`, `fifty`, `thousand`), `SUSPECTED_STUTTER` (`88`) | `two hundred and fifty thousand ... eighty eight` | `["250", ",000", ..., "88"]` | (1) BPE tách `["250", ",000"]`; (2) regex stutter khớp nhầm số `"88"`. | **Đạt (Pass)** |
| 8 | `chunk_42` | `SUSPECTED_SWALLOWED` (`eight`, `thousand`) | `seven to eight thousand` | `["7", ",000", "to", "8", ",000"]` | Cả 2 đầu khoảng số trong ASR đều có `,000` trong khi kịch bản dùng chung từ chỉ bậc `"thousand"` ở cuối (`seven [thousand] to eight thousand`). | **Đạt (Pass)** |
| 9 | `chunk_43` | `SUSPECTED_SWALLOWED` (`eight`, `thousand`), `ABNORMAL_PAUSE` (`stations` - `guided` `0.62s`) | `seven to eight thousand ... stations guided by lasers` | `["7", ",000", "to", "8", ",000", ..., "stations,", "guided"]` | (1) Dải số dùng chung bậc `"thousand"`; (2) Khoảng lặng thực tế giữa `"stations"` và `"guided"` chỉ `0.40s` (`< 0.526s`) do âm xát `-s` kéo dài từ `7.86s` đến `8.08s`, và đây là cụm phân từ có dấu phẩy ngữ điệu. | **Đạt (Pass)** |
| 10 | `chunk_49` | `EXTRA_WORD` (`time`) | `...backed by a real guarantee.` | Primary: `"... guarantee."` (`endSec=22.10s`, âm tiết `-tee` kết thúc tại `22.30s`) | `recover_unaligned_words` cắt lát `[22.10, 22.62]` ngay tại âm bật `/t/` của `"guarantee"`, khiến âm tiết `-tee` bị đoán thành `"time"`. | **Đạt (Pass)** |
| 11 | `chunk_51` | `SUSPECTED_SWALLOWED` (`one`, `hundred`, `thousand`) | `one hundred thousand miles` | `["100", ",000", "miles"]` | BPE tách `["100", ",000"]`. | **Đạt (Pass)** |
| 12 | `chunk_53` | `SUSPECTED_SWALLOWED` (`two`, `hundred`, `ninety`, `thousand`, `dollars`, `one`, `eighty`) | `two hundred and ninety thousand dollars ... one hundred and eighty thousand` | `["$290", ",000", ..., "$180", ",000"]` | Ký hiệu tiền tệ `$` + BPE tách `,000` + từ `"dollars"` đi kèm số. | **Đạt (Pass)** |
| 13 | `chunk_54` | `SUSPECTED_SWALLOWED` (`seven`, `hundred`, `seventy`, `million`, `one`, `eighty`, `thousand`, `ten`) | `seven hundred and seventy million ... one hundred and eighty thousand ... one hundred and ten thousand` | `["770", "million", ..., "$180", ",000", ..., "$110", ",000"]` | Kết hợp chữ số + từ chỉ bậc (`"770"` + `"million"`) và tiền tệ `$` + `,000`. | **Đạt (Pass)** |
| 14 | `chunk_58` | `SUSPECTED_SWALLOWED` (`three`, `hundred`, `thousand`, `dollars`) | `three hundred thousand dollars` | `["$300", ",000"]` | Tiền tệ `$` + `,000` + `"dollars"`. | **Đạt (Pass)** |
| 15 | `chunk_59` | `SUSPECTED_SWALLOWED` (`two`, `hundred`, `ninety`, `thousand`, `dollars`) | `two hundred and ninety thousand dollars` | `["$290", ",000"]` | Tiền tệ `$` + `,000` + `"dollars"`. | **Đạt (Pass)** |
| 16 | `chunk_61` | `SUSPECTED_SWALLOWED` (`hundred`, `thousand`, `one`, `point`, `five`, `hours`), `SUSPECTED_STUTTER` (`55`) | `a hundred thousand kilowatt hours ... one point five five kilowatt hours ... one hundred and fifty five thousand` | `["100", ",000", "kilowatt", "hours", ..., "1", ".55", "kWh,", ..., "155", ",000"]` | (1) `"a hundred thousand"` có mạo từ `"a"` đứng trước bậc số; (2) `"kilowatt hours"` vs `"kWh"` làm lệch span thập phân `1.55`; (3) regex stutter khớp nhầm `".55"`. | **Đạt (Pass)** |
| 17 | `chunk_63` | `SUSPECTED_SWALLOWED` (`one`, `thousand`, `fifteen`, `five`, `hundred`) | `One hundred thousand miles ... fifteen thousand five hundred` | `["100", "000", "miles", ..., "$15", ",500"]` | BPE tách `["100", "000"]` và `["$15", ",500"]`. | **Đạt (Pass)** |
| 18 | `chunk_64` | `SUSPECTED_SWALLOWED` (`forty`, `six`, `thousand`, `two`, `hundred`, `fifty`) | `forty six thousand ... two hundred and fifty thousand` | `["$46", ",000", ..., "250", ",000"]` | Tiền tệ `$` + BPE tách `,000`. | **Đạt (Pass)** |
| 19 | `chunk_73` | `SUSPECTED_SWALLOWED` (`four`, `six`, `eight`, `zero`) | `four six eight zero cell architecture` | `["4680", "cell", "architecture"]` | Chuỗi đọc từng chữ số `"four six eight zero"` trước đó bị cộng dồn (`4+6+8+0 = 18`) thay vì ghép thành `"4680"`. | **Đạt (Pass)** |
| 20 | `chunk_80` | `SUSPECTED_SWALLOWED` (`fifty`, `thousand`, `dollar`) | `Tesla's fifty thousand dollar` | `["Tesla's", "50", ",000"]` | `TOKEN_PATTERN` cũ tách `"Tesla's"` thành `["Tesla", "s"]` và `["50", ",000"]` thiếu `"dollar"`. | **Đạt (Pass)** |

---

## 3. Kết quả Trước và Sau Sửa trên Bộ 85 Chunk Thực tế

| Chỉ số | Trước khi sửa | Sau khi sửa (`v2.6.0`) |
|---|---|---|
| Tổng số chunk | 85 | 85 |
| Đạt (`pass`) | 65 | **85** |
| Cảnh báo (`warning`) | 20 (29 nghi vấn giả) | **0** |
| Lỗi (`error`) | 0 | **0** |
| Chưa kiểm chứng (`unverified`) | 0 | **0** |

---

## 4. Kết quả Kiểm thử Phát hiện Lỗi Thật (Không làm yếu bộ lọc)

Toàn bộ các bài kiểm thử phát hiện lỗi đọc thật trong `sidecar/tests/test_audio_quality.py` và `sidecar/tests/test_number_normalizer.py` đều vượt qua tuyệt đối (**81/81 bài test Python PASS**, **TypeScript test suite PASS**):

1. **Đọc thừa từ thật ở đầu/giữa câu (`Eat`, `should`, `It's`):**
   - `test_extra_word_detection_eat_test_10`: phát hiện chính xác `EXTRA_WORD` (`eat`).
   - `test_extra_word_detection_should_test_11`: phát hiện chính xác `EXTRA_WORD` (`should`).
   - `test_case_a_extra_word_carrier_hallucination`: phát hiện chính xác `EXTRA_WORD` (`It's`).
   - `test_case_b_unexpected_letter_spelling_bot_t`: phát hiện chính xác `UNEXPECTED_LETTER_SPELLING` (`T` sau `BOT`).
2. **Nuốt từ thật và nuốt từ ngắt thập phân (`point` / `phẩy`):**
   - `test_mandatory_diesel_fuel_missing_freight`: phát hiện `MISSING_WORD` (`freight`).
   - `test_rapid_response_mobile_service_swallowed`: phát hiện `SUSPECTED_SWALLOWED` (`response mobile service`).
   - `test_swallowed_number_part_detected`: phát hiện nuốt `"hundred"` trong `"three hundred"` -> `"three"` và nuốt `"five"` trong `"fifty five"` -> `"50"`.
   - `test_decimal_actual_swallowed_point_flags_missing_word` & `test_group_b_all_swallowed_decimals_flagged_both_fast_and_slow`: phát hiện đầy đủ lỗi nuốt `"point"` ở cả tốc độ đọc nhanh và đọc chậm.
3. **Đọc sai số thật (`8,300` thay vì `8,200`, `2.4` thay vì `2.8`, `50` thay vì `300`):**
   - `test_wrong_cardinal_number_8200_vs_8300_flagged`: phát hiện chính xác `SUSPECTED_MISPRONUNCIATION` (`8200` vs `8300`) kèm đầy đủ metadata `sourceExcerpt`, `asrRawExcerpt`, `asrNormalizedExcerpt`, `tokenSource`.
   - `test_decimal_mispronunciation_wrong_numbers_flagged`: phát hiện `SUSPECTED_MISPRONUNCIATION` (`2.8` vs `2.4` / `2 4`).
   - `test_non_equivalent_numbers_detected`: phát hiện `SUSPECTED_MISPRONUNCIATION` (`300` vs `50`).
4. **Lặp từ / Vấp âm thật & Nghỉ bất thường thật:**
   - `test_mandatory_stutter_at_that_comfortable`: phát hiện `SUSPECTED_STUTTER` (`that that comfortable`).
   - `test_row_row_after_row_flags_stutter` & `test_excessive_repeat_that_that_that_flags_repetition`: phát hiện lặp từ thật.
   - `test_mandatory_diesel_fuel_abnormal_pause`: phát hiện `ABNORMAL_PAUSE` (`0.58s` giữa `diesel` và `fuel`).

---

## 5. Đồng bộ Mô hình ASR & Tự động Khôi phục `Chưa kiểm chứng`

- Toàn bộ 4 mô hình Whisper cục bộ (`large-v3-turbo`, `large-v3`, `medium`, `small`) đã được cài đặt đầy đủ tại `C:\Users\lucng\AppData\Roaming\com.voxlab.app\models\`.
- Hậu kiểm TTS luôn lấy mô hình ASR đang chọn tại tab Phụ đề thông qua `loadSubtitleSettings().model` và `AsrLifecycleManager` dùng chung một phiên bản trong bộ nhớ.
- Khi `QUALITY_VALIDATOR_VERSION = "2.6.0"` hoặc khi mô hình ASR sẵn sàng trở lại, `isReviewOutdated()` tự động kích hoạt hậu kiểm ngầm để cập nhật trạng thái mà không yêu cầu người dùng bấm kiểm tra thủ công hay tạo lại audio.

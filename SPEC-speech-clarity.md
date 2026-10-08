# SPEC-speech-clarity: Tối ưu độ rõ chữ và nhịp đọc tự nhiên cho VoxLab

**Version:** 1.0.0  
**Target Release:** VoxLab v0.1.0  
**Status:** In-Progress Specification & Verification  
**Author:** AI Pair Programmer & Audio Engineering Team  

---

## 1. Mục tiêu và Phạm vi (Objective & Scope)

Nâng cao chất lượng âm thanh tổng hợp của VoxLab cho cả ba mô hình cục bộ:
- **OmniVoice**
- **Chatterbox Turbo**
- **Qwen3-TTS 1.7B Base**

### Vấn đề cần khắc phục:
1. Mô hình đọc nhanh bất thường, nuốt chữ hoặc phát âm không đầy đủ.
2. Các từ bị dính vào nhau (crowded / merged words), thiếu khoảng chuyển tiếp âm học tự nhiên.
3. Nhịp đọc giật cục hoặc dao động quá lớn giữa các cụm từ trong cùng một đoạn.
4. Ngắt nghỉ bất thường giữa những từ không có dấu câu.

### Nguyên tắc bất biến (Non-Negotiable Constraints):
- **Cơ chế chia đoạn**: Giữ nguyên tối đa 3 câu/đoạn, giới hạn 600 ký tự. Không chuyển thành 1 câu/đoạn.
- **Cài đặt người dùng**: Giữ nguyên phạm vi tốc độ 0.5×–1.5×, thông số nâng cao mặc định và cài đặt ngắt nghỉ dấu câu.
- **Bảo vệ âm sắc**: Không chèn khoảng lặng tùy tiện vào giữa các từ. Không thay đổi cao độ, âm sắc hoặc chất giọng clone.
- **Kiểm soát chủ động**: Thuật toán xử lý âm thanh giãn thời gian (Pitch-Preserving Time Stretch) **mặc định TẮT**, chỉ kích hoạt khi người dùng bật công tắc "Tối ưu độ rõ giọng đọc".

---

## 2. Kiến trúc Hệ thống & Luồng Xử lý (System Architecture)

```
[Kịch bản (Text)] ────────► [TTS Model]
                                  │
                                  ▼
                         [Raw Audio (WAV)]
                                  │
                 ┌────────────────┴────────────────┐
                 │ Optimize Clarity Toggle == On?  │
                 ├────────────────┬────────────────┤
                 │ YES            │ NO (Default)   │
                 ▼                ▼                │
          [Pitch-Preserving  [Keep Raw Audio]      │
            Time Stretch]         │                │
          (rate = 0.95x)          │                │
                 │                │                │
                 └────────┬───────┘                │
                          ▼                        │
              [Enhanced Quality Validator] ◄───────┘
              (Technical + Faster-Whisper ASR)
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
      [Metrics Analysis]      [Issue Classification]
      - WPM (Words/Min)       - Pass (Đạt)
      - Pace Variance         - Warning (Vàng: CROWDED, RAPID, OMISSION, PAUSE)
      - Word Durations        - Error (Đỏ: File rỗng, hỏng, < 0.2s)
      - Inter-word Gaps       - Unverified (Chưa kiểm chứng: thiếu Faster-Whisper)
```

---

## 3. Thuật toán Phân tích Tốc độ & Độ rõ chữ (Pace & Clarity Analysis)

### 3.1. Phân tích Tốc độ Nói Thực tế (WPM & Effective WPM)
- Tổng số từ nguồn $N_{\text{src}}$, tổng thời lượng âm thanh $T_{\text{sec}}$.
- Tốc độ đọc thô: $\text{WPM} = \frac{N_{\text{src}}}{T_{\text{sec}}} \times 60$.
- Tốc độ chuẩn hóa theo cài đặt người dùng: $\text{WPM}_{\text{effective}} = \frac{\text{WPM}}{\text{UserSpeed}}$.
- Ngưỡng cảnh báo tốc độ dồn dập (`RAPID_PACE`):
  - **Tiếng Anh**: $\text{WPM}_{\text{effective}} > 240$ WPM (thông thường 130–170 WPM).
  - **Tiếng Việt**: $\text{WPM}_{\text{effective}} > 290$ từ/phút (thông thường 160–210 từ/phút).
  - Chỉ đánh giá khi đoạn có độ dài tối thiểu $\ge 2.0$ giây và $N_{\text{src}} \ge 6$ từ để tránh báo giả ở các câu chào ngắn.

### 3.2. Phát hiện Dính chữ & Dồn chữ (`CROWDED_WORDS`)
- Điều kiện xác định dồn chữ:
  1. Tồn tại chuỗi $\ge 3$ từ liên tiếp trong kết quả ASR có khoảng cách giữa các từ $\text{gap} \le 0.02$s (hoặc dính âm).
  2. Thời lượng từng từ trong chuỗi cực ngắn ($< 0.09$s mỗi từ).
  3. Độ tin cậy nhận diện ASR của các từ $\ge 0.50$.
  4. Trong văn bản gốc, các từ này được phân tách bằng dấu cách thông thường, không phải từ ghép nối (hyphenated).
- Hành vi: Gắn cờ Cảnh báo vàng kèm vị trí thời gian và các từ bị dính để người dùng nghe thẩm định.

### 3.3. Phát hiện Nghi vấn Nuốt từ (`POSSIBLE_OMISSION`)
- Điều kiện:
  1. Một từ có nghĩa (độ dài $\ge 4$ ký tự, không thuộc danh sách stopword phụ như "the", "and", "của", "và") có trong văn bản nguồn nhưng hoàn toàn vắng mặt trong chuỗi ASR.
  2. Các từ xung quanh có độ tin cậy ASR cao ($\ge 0.65$).
  3. Khoảng thời gian trống giữa từ trước và từ sau quá ngắn ($< 0.12$s), không đủ khả năng phát âm âm tiết đó.
- Hành vi: Gắn cờ Cảnh báo vàng: "Nghi vấn nuốt từ hoặc phát âm không đầy đủ tại 'X'". Tuyệt đối không tự ý kéo dài âm thanh để bù từ bị thiếu.

### 3.4. Giữ nguyên Phát hiện Ngắt nghỉ Bất thường (`ABNORMAL_PAUSE`)
- Phát hiện khoảng nghỉ $\ge 0.50$s giữa 2 từ liên tiếp không có dấu câu.
- Trường hợp bắt buộc: Câu `"It is the staggering cost of moving freight on diesel fuel, an economic burden baked into every physical product sold across the nation."` không được bị ngắt giữa "diesel" và "fuel".

---

## 4. Giải pháp Xử lý Âm thanh: Pitch-Preserving Time Stretch

- **Thư viện sử dụng**: `librosa.effects.time_stretch` (sử dụng thuật toán Phase Vocoder tiêu chuẩn công nghiệp).
- **Hệ số kéo giãn**: `rate = 0.95` (khi bật tùy chọn tối ưu, thời lượng giãn nhẹ khoảng $\approx 5.2\%$, mở rộng các vi khoảng chuyển tiếp giữa phụ âm và nguyên âm mà không làm thay đổi tần số cơ bản $F_0$).
- **Phạm vi bảo vệ**:
  - Không thay đổi cao độ giọng đọc (Pitch Preserved).
  - Không thay đổi âm sắc người nói (Speaker Timbre Preserved).
  - Ngăn ngừa hiện tượng clip bằng cách kiểm soát biên độ `np.clip(stretched, -1.0, 1.0)`.
  - Mặc định **TẮT** trên giao diện (`optimizeClarity = false`).

---

## 5. Thiết kế Giao diện Người dùng (UI/UX)

- Trong thanh **TTS Inspector → NÂNG CAO**:
  - Bổ sung công tắc (Toggle): **Tối ưu độ rõ giọng đọc** (`t.inspector.optimizeClarity`).
  - Chú thích: *"Áp dụng thuật toán vi giãn nhịp đọc có bảo toàn cao độ nhằm giảm hiện tượng dính chữ khi mô hình đọc quá nhanh."*
  - Mặc định: **Tắt** (`false`).
- Trong **Thanh trạng thái chất lượng (Quality Review)**:
  - Cảnh báo mới (`RAPID_PACE`, `CROWDED_WORDS`, `POSSIBLE_OMISSION`, `ABNORMAL_PAUSE`) hiển thị dưới dạng badge vàng kèm giải thích rõ ràng.
  - Vẫn cho phép **Nghe thử** và **Ghép & xuất**.
  - Người dùng có thể bấm **Tạo lại đoạn** hoặc bật **Tối ưu độ rõ giọng đọc** rồi tạo lại.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  normalizeNumber,
  normalizeUnit,
  normalizeCurrency,
  normalizeTime,
  normalizeDate,
  normalizePercent,
  normalizeRatio,
  normalizeDivision,
  normalizeVersion,
  detectLanguage,
  resolveLanguage,
  classifyTextTokens,
} from "../index";

const ALL_GROUPS = ["whitespace", "punctuation", "unicode", "numbers"] as const;
const DEFAULT_GROUPS = ["whitespace", "punctuation", "unicode"] as const;

describe("Locale-Aware Normalization & Token Classification Regression Tests", () => {
  // --- 1. DIRECT API TESTS ---
  describe("Direct Normalization Functions API", () => {
    it("normalizeNumber: supports Vietnamese, English, and undetermined fallback", () => {
      // Vietnamese
      assert.equal(normalizeNumber("3.14", "vi"), "ba phẩy một bốn");
      assert.equal(normalizeNumber("1,5", "vi"), "một phẩy năm");
      assert.equal(normalizeNumber("15,000", "vi"), "mười lăm nghìn");
      assert.equal(normalizeNumber(25, "vi"), "hai mươi lăm");

      // English
      assert.equal(normalizeNumber("3.14", "en"), "three point one four");
      assert.equal(normalizeNumber("15,000", "en"), "fifteen thousand");

      // Undetermined (no silent English fallback)
      assert.equal(normalizeNumber("3.14"), "3.14");
      assert.equal(normalizeNumber("15,000"), "15,000");
    });

    it("normalizeUnit: verbalizes units per locale", () => {
      // Vietnamese
      assert.equal(normalizeUnit("2", "kg", "vi"), "hai ki-lô-gam");
      assert.equal(normalizeUnit("30", "km/h", "vi"), "ba mươi ki-lô-mét trên giờ");
      assert.equal(normalizeUnit("20", "°C", "vi"), "hai mươi độ C");

      // English
      assert.equal(normalizeUnit("2", "kg", "en"), "two kilograms");
      assert.equal(normalizeUnit("30", "km/h", "en"), "thirty kilometers per hour");

      // Undetermined
      assert.equal(normalizeUnit("2", "kg"), "2 kg");
    });

    it("normalizeCurrency: verbalizes currencies per locale", () => {
      // Vietnamese
      assert.equal(normalizeCurrency("15,000", "₫", "vi"), "mười lăm nghìn đồng");
      assert.equal(normalizeCurrency("25", "$", "vi"), "hai mươi lăm đô la");
      assert.equal(normalizeCurrency("119", "$", "vi", { scale: "B" }), "một trăm mười chín tỷ đô la");

      // English
      assert.equal(normalizeCurrency("25", "$", "en"), "twenty five dollars");
      assert.equal(normalizeCurrency("119", "$", "en", { scale: "B" }), "one hundred and nineteen billion dollars");

      // Undetermined
      assert.equal(normalizeCurrency("15000", "₫"), "₫15000");
    });

    it("normalizeTime: verbalizes valid times and rejects invalid ones", () => {
      // Vietnamese
      assert.equal(normalizeTime("10:30", "vi"), "mười giờ ba mươi phút");
      assert.equal(normalizeTime("09:05", "vi"), "chín giờ năm phút");
      assert.equal(normalizeTime("23:59", "vi"), "hai mươi ba giờ năm mươi chín phút");
      assert.equal(normalizeTime("10:30:45", "vi"), "mười giờ ba mươi phút bốn mươi lăm giây");

      // Invalid time (25:80 -> NOT TIME, preserved)
      assert.equal(normalizeTime("25:80", "vi"), "25:80");

      // English
      assert.equal(normalizeTime("10:30", "en"), "ten thirty");
      assert.equal(normalizeTime("09:05", "en"), "nine oh five");

      // Undetermined
      assert.equal(normalizeTime("10:30"), "10:30");
    });

    it("normalizeRatio: verbalizes ratios per locale (Vietnamese 'trên')", () => {
      assert.equal(normalizeRatio("16:9", "vi"), "mười sáu trên chín");
      assert.equal(normalizeRatio("4:3", "vi"), "bốn trên ba");
      assert.equal(normalizeRatio("16:9", "en"), "sixteen to nine");
      assert.equal(normalizeRatio("16:9"), "16:9");
    });

    it("normalizeDivision: verbalizes division per locale (Vietnamese 'chia')", () => {
      assert.equal(normalizeDivision("16:9", "vi"), "mười sáu chia chín");
      assert.equal(normalizeDivision("4:3", "vi"), "bốn chia ba");
      assert.equal(normalizeDivision("16:9", "en"), "sixteen divided by nine");
      assert.equal(normalizeDivision("16:9"), "16:9");
    });

    it("normalizePercent: verbalizes percentages per locale", () => {
      assert.equal(normalizePercent("50", "vi"), "năm mươi phần trăm");
      assert.equal(normalizePercent("13.5", "vi"), "mười ba phẩy năm phần trăm");
      assert.equal(normalizePercent("50", "en"), "fifty percent");
      assert.equal(normalizePercent("50"), "50%");
    });

    it("normalizeVersion: preserves version tokens without decimal mangling", () => {
      assert.equal(normalizeVersion("v2.0", "vi"), "v2.0");
      assert.equal(normalizeVersion("v1.2.3", "vi"), "v1.2.3");
      assert.equal(normalizeVersion("v2.0"), "v2.0");
    });

    it("normalizeDate: verbalizes formatted dates", () => {
      assert.equal(normalizeDate("2026-10-06", "vi"), "ngày 6 tháng 10 năm 2026");
      assert.equal(normalizeDate("06/10/2026", "vi"), "ngày 6 tháng 10 năm 2026");
    });
  });

  // --- 2. LANGUAGE DETECTION TESTS ---
  describe("Language Detection & Resolution", () => {
    it("detects Vietnamese unequivocally when diacritics or words exist", () => {
      assert.equal(detectLanguage("Xin chào các bạn"), "vi");
      assert.equal(detectLanguage("Mốc thời gian 10:30 và số 3.14"), "vi");
      assert.equal(detectLanguage("Hệ thống xử lý giọng nói"), "vi");
    });

    it("detects English when English vocabulary is dominant without Vietnamese diacritics", () => {
      assert.equal(detectLanguage("The system consumes 1.2 MW."), "en");
      assert.equal(detectLanguage("The project costs $119B."), "en");
      assert.equal(detectLanguage("Production increased by 13.5%."), "en");
    });

    it("returns undefined for undetermined numeric/symbolic text (NO silent English default)", () => {
      assert.equal(detectLanguage("10:30"), undefined);
      assert.equal(detectLanguage("15,000"), undefined);
      assert.equal(detectLanguage("3.14"), undefined);
      assert.equal(detectLanguage("127.0.0.1"), undefined);
    });

    it("resolveLanguage respects caller explicit language over auto-detection", () => {
      assert.equal(resolveLanguage("10:30", { language: "vi" }), "vi");
      assert.equal(resolveLanguage("10:30", { language: "en" }), "en");
      assert.equal(resolveLanguage("10:30", { language: "auto" }), undefined);
      assert.equal(resolveLanguage("Xin chào 10:30", { language: "auto" }), "vi");
    });
  });

  // --- 3. TOKEN CLASSIFICATION PRIORITY ---
  describe("Token Classification Priority", () => {
    it("URL & Email: Priority 1 protects colons and numbers inside URLs", () => {
      const tokens = classifyTextTokens("Truy cập https://example.com:8080/test và gửi email test@example.com.");
      const urlToken = tokens.find((t) => t.type === "url");
      assert.ok(urlToken);
      assert.equal(urlToken.raw, "https://example.com:8080/test");

      const emailToken = tokens.find((t) => t.type === "email");
      assert.ok(emailToken);
      assert.equal(emailToken.raw, "test@example.com");
    });

    it("IP address: Priority 2 protects dots inside IP from decimals", () => {
      const tokens = classifyTextTokens("IP là 127.0.0.1 và 192.168.1.1.");
      const ipTokens = tokens.filter((t) => t.type === "ip");
      assert.equal(ipTokens.length, 2);
      assert.equal(ipTokens[0].raw, "127.0.0.1");
      assert.equal(ipTokens[1].raw, "192.168.1.1");
    });

    it("TIME: Priority 3 parses valid HH:MM and HH:MM:SS", () => {
      const tokens = classifyTextTokens("Họp lúc 10:30 và 09:05 và 23:59 cũng như 10:30:45.");
      const timeTokens = tokens.filter((t) => t.type === "time");
      assert.equal(timeTokens.length, 4);
      assert.equal(timeTokens[0].raw, "10:30");
      assert.equal(timeTokens[1].raw, "09:05");
      assert.equal(timeTokens[2].raw, "23:59");
      assert.equal(timeTokens[3].raw, "10:30:45");
    });

    it("Invalid time 25:80 is NOT classified as time", () => {
      const tokens = classifyTextTokens("Giá trị 25:80 không hợp lệ.");
      const timeTokens = tokens.filter((t) => t.type === "time");
      assert.equal(timeTokens.length, 0);
    });

    it("RATIO vs TIME disambiguation via context", () => {
      const script = "Video có tỷ lệ 16:9 và bắt đầu lúc 10:30.";
      const tokens = classifyTextTokens(script);

      const ratio = tokens.find((t) => t.type === "ratio");
      assert.ok(ratio);
      assert.equal(ratio.raw, "16:9");

      const time = tokens.find((t) => t.type === "time");
      assert.ok(time);
      assert.equal(time.raw, "10:30");
    });

    it("PUNCTUATION colon: separated between words without time/ratio confusion", () => {
      const script = "Chú ý: nội dung. Nam nói: xin chào. Kết quả: thành công.";
      const tokens = classifyTextTokens(script);
      const punctColons = tokens.filter((t) => t.type === "punctuation" && t.raw === ":");
      assert.equal(punctColons.length, 3);
    });
  });

  // --- 4. REQUIRED REGRESSION TESTS (USER SECTION 7) ---
  describe("User Section 7 - Required Regression Tests Matrix", () => {
    // TIME
    it("TIME: 10:30 -> mười giờ ba mươi phút", () => {
      const res = normalizeText("10:30", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res.normalizedText, "mười giờ ba mươi phút");
    });

    it("TIME: 09:05 -> chín giờ năm phút", () => {
      const res = normalizeText("09:05", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res.normalizedText, "chín giờ năm phút");
    });

    it("TIME: 23:59 -> hai mươi ba giờ năm mươi chín phút", () => {
      const res = normalizeText("23:59", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res.normalizedText, "hai mươi ba giờ năm mươi chín phút");
    });

    it("TIME: 10:30:45 -> mười giờ ba mươi phút bốn mươi lăm giây", () => {
      const res = normalizeText("10:30:45", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res.normalizedText, "mười giờ ba mươi phút bốn mươi lăm giây");
    });

    it("TIME in context: lúc 16:09", () => {
      const res = normalizeText("bắt đầu lúc 16:09", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "bắt đầu lúc mười sáu giờ chín phút");
    });

    it("TIME in context: thời gian 10:30", () => {
      const res = normalizeText("thời gian 10:30", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "thời gian mười giờ ba mươi phút");
    });

    it("TIME in context: cuộc họp lúc 08:05", () => {
      const res = normalizeText("cuộc họp lúc 08:05", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "cuộc họp lúc tám giờ năm phút");
    });

    // RATIO (User specified: tỷ lệ 16:9, khung hình 16:9, màn hình 16:9, aspect ratio 16:9 -> mười sáu trên chín)
    it("RATIO: tỷ lệ 16:9", () => {
      const res = normalizeText("tỷ lệ 16:9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "tỷ lệ mười sáu trên chín");
    });

    it("RATIO: khung hình 16:9", () => {
      const res = normalizeText("khung hình 16:9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "khung hình mười sáu trên chín");
    });

    it("RATIO: màn hình 16:9", () => {
      const res = normalizeText("màn hình 16:9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "màn hình mười sáu trên chín");
    });

    it("RATIO: aspect ratio 16:9 (explicit vi or Vietnamese context)", () => {
      const res1 = normalizeText("aspect ratio 16:9", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res1.normalizedText, "aspect ratio mười sáu trên chín");

      const res2 = normalizeText("Video có aspect ratio 16:9", [...ALL_GROUPS]);
      assert.equal(res2.normalizedText, "Video có aspect ratio mười sáu trên chín");
    });

    it("RATIO: tỷ lệ khung hình 16:9", () => {
      const res = normalizeText("tỷ lệ khung hình 16:9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "tỷ lệ khung hình mười sáu trên chín");
    });

    it("RATIO: khung hình 4:3", () => {
      const res = normalizeText("khung hình 4:3", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "khung hình bốn trên ba");
    });

    // DIVISION (User specified: 16:9 = ..., 16 chia 9, phép chia 16:9 -> mười sáu chia chín)
    it("DIVISION: 16:9 = 1.77 (explicit vi and auto-detected with context)", () => {
      const res1 = normalizeText("16:9 = 1.77", [...ALL_GROUPS], { language: "vi" });
      assert.equal(res1.normalizedText, "mười sáu chia chín = một phẩy bảy bảy");

      const res2 = normalizeText("Kết quả 16:9 = 1.77", [...ALL_GROUPS]);
      assert.equal(res2.normalizedText, "Kết quả mười sáu chia chín = một phẩy bảy bảy");
    });

    it("DIVISION: phép chia 16:9", () => {
      const res = normalizeText("phép chia 16:9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "phép chia mười sáu chia chín");
    });

    it("DIVISION: 16 chia 9", () => {
      const res = normalizeText("16 chia 9", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "mười sáu chia chín");
    });

    // PUNCTUATION
    it("PUNCTUATION: Chú ý: nội dung", () => {
      const res = normalizeText("Chú ý: nội dung", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Chú ý: nội dung");
    });

    it("PUNCTUATION: Nam nói: xin chào", () => {
      const res = normalizeText("Nam nói: xin chào", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Nam nói: xin chào");
    });

    it("PUNCTUATION: Kết quả: thành công", () => {
      const res = normalizeText("Kết quả: thành công", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Kết quả: thành công");
    });

    // IP
    it("IP: 127.0.0.1 is protected and not decimalized", () => {
      const res = normalizeText("Kết nối đến 127.0.0.1 ngay", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Kết nối đến 127.0.0.1 ngay");
    });

    it("IP: 192.168.1.1 is protected and not decimalized", () => {
      const res = normalizeText("Địa chỉ 192.168.1.1 nội bộ", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Địa chỉ 192.168.1.1 nội bộ");
    });

    // VERSION
    it("VERSION: v2.0 is protected and not decimalized", () => {
      const res = normalizeText("phiên bản v2.0 mới nhất", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "phiên bản v2.0 mới nhất");
    });

    it("VERSION: v1.2.3 is protected and not decimalized", () => {
      const res = normalizeText("cập nhật lên v1.2.3 hôm nay", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "cập nhật lên v1.2.3 hôm nay");
    });

    // NUMBER
    it("NUMBER: 3.14 -> ba phẩy một bốn", () => {
      const res = normalizeText("số thập phân 3.14", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "số thập phân ba phẩy một bốn");
    });

    it("NUMBER: 1,5 -> một phẩy năm", () => {
      const res = normalizeText("giá trị 1,5 đơn vị", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "giá trị một phẩy năm đơn vị");
    });

    // CURRENCY
    it("CURRENCY: 15,000₫ -> mười lăm nghìn đồng", () => {
      const res = normalizeText("Giá là 15,000₫", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Giá là mười lăm nghìn đồng");
    });

    it("CURRENCY: $25 in Vietnamese context -> hai mươi lăm đô la", () => {
      const res = normalizeText("Chi phí $25 mỗi tháng", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Chi phí hai mươi lăm đô la mỗi tháng");
    });

    // PERCENT
    it("PERCENT: 50% -> năm mươi phần trăm", () => {
      const res = normalizeText("giảm giá 50%", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "giảm giá năm mươi phần trăm");
    });

    // UNIT
    it("UNIT: 2 kg -> hai ki-lô-gam", () => {
      const res = normalizeText("Cân nặng 2 kg", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Cân nặng hai ki-lô-gam");
    });

    it("UNIT: 30 km/h -> ba mươi ki-lô-mét trên giờ", () => {
      const res = normalizeText("Tốc độ 30 km/h", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Tốc độ ba mươi ki-lô-mét trên giờ");
    });

    it("UNIT: 20°C -> hai mươi độ C", () => {
      const res = normalizeText("Nhiệt độ 20°C", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "Nhiệt độ hai mươi độ C");
    });

    // UNIT ROOT CAUSE REGRESSION: "30 mà" does NOT match "30 m" (meters)
    it("ROOT CAUSE FIX: '30 mà không' is NOT mangled into 'thirty meters'", () => {
      const res = normalizeText("mốc thời gian 10:30 mà không hề bị ngắt quãng", [...ALL_GROUPS]);
      assert.equal(res.normalizedText, "mốc thời gian mười giờ ba mươi phút mà không hề bị ngắt quãng");
      assert.ok(!res.normalizedText.includes("meters"));
      assert.ok(!res.normalizedText.includes("thirty"));
    });

    // URL
    it("URL: http://example.com and https://example.com:8080/test preserved", () => {
      const input = "Xem tại http://example.com hoặc https://example.com:8080/test nhé.";
      const res = normalizeText(input, [...ALL_GROUPS]);
      assert.ok(res.normalizedText.includes("http://example.com"));
      assert.ok(res.normalizedText.includes("https://example.com:8080/test"));
    });
  });

  // --- 5. UI PREVIEW VERIFICATION (USER SECTION 8) ---
  describe("User Section 8 - Mandatory UI Preview Paragraph Verification", () => {
    it("Normalizes the exact user sample paragraph into 100% Vietnamese without English pollution", () => {
      const input =
        "Với sự bùng nổ của các mô hình học sâu tại phiên bản v2.0, việc tạo ra giọng nói tự nhiên, giàu cảm xúc đã không còn là đặc quyền của các phòng thu chuyên nghiệp. Hệ thống có thể xử lý chính xác các số thập phân như 3.14 hay mốc thời gian 10:30 mà không hề bị ngắt quãng.";

      const res = normalizeText(input, [...ALL_GROUPS]);

      // 1. v2.0 is preserved and NOT mangled as decimal
      assert.ok(res.normalizedText.includes("phiên bản v2.0"));

      // 2. 3.14 is read in Vietnamese
      assert.ok(res.normalizedText.includes("ba phẩy một bốn"));

      // 3. 10:30 is read as "mười giờ ba mươi phút"
      assert.ok(res.normalizedText.includes("mười giờ ba mươi phút mà không hề bị ngắt quãng"));

      // 4. Absolute zero English pollution
      assert.ok(!res.normalizedText.includes("three"));
      assert.ok(!res.normalizedText.includes("point"));
      assert.ok(!res.normalizedText.includes("thirty"));
      assert.ok(!res.normalizedText.includes("meter"));
      assert.ok(!res.normalizedText.includes("meters"));
      assert.ok(!res.normalizedText.includes("ten"));
      assert.ok(!res.normalizedText.includes("10:"));

      const expected =
        "Với sự bùng nổ của các mô hình học sâu tại phiên bản v2.0, việc tạo ra giọng nói tự nhiên, giàu cảm xúc đã không còn là đặc quyền của các phòng thu chuyên nghiệp. Hệ thống có thể xử lý chính xác các số thập phân như ba phẩy một bốn hay mốc thời gian mười giờ ba mươi phút mà không hề bị ngắt quãng.";

      assert.equal(res.normalizedText, expected);
    });

    it("Normalizes extended paragraph with 16:9 ratio and 127.0.0.1 IP from user screenshot", () => {
      const input =
        "Với sự bùng nổ của các mô hình học sâu tại phiên bản v2.0, việc tạo ra giọng nói tự nhiên, giàu cảm xúc đã không còn là đặc quyền của các phòng thu chuyên nghiệp. Hệ thống có thể xử lý chính xác các số thập phân như 3.14 hay mốc thời gian 10:30 mà không hề bị ngắt quãng. Đồng thời, với tỷ lệ khung hình 16:9 và tốc độ truyền tải 127.0.0.1.";

      const res = normalizeText(input, [...ALL_GROUPS]);

      // v2.0 preserved
      assert.ok(res.normalizedText.includes("v2.0"));
      // 3.14 -> ba phẩy một bốn
      assert.ok(res.normalizedText.includes("ba phẩy một bốn"));
      // 10:30 -> mười giờ ba mươi phút
      assert.ok(res.normalizedText.includes("mười giờ ba mươi phút"));
      // 16:9 in ratio context -> mười sáu trên chín
      assert.ok(res.normalizedText.includes("mười sáu trên chín"));
      assert.ok(!res.normalizedText.includes("mười sáu chia chín"));
      // 127.0.0.1 preserved
      assert.ok(res.normalizedText.includes("127.0.0.1"));
      // No English words
      assert.ok(!res.normalizedText.includes("thirty"));
      assert.ok(!res.normalizedText.includes("meters"));
    });
  });

  // --- 6. SAFE DEFAULTS (OPTION 4 OFF) ---
  describe("Safe Defaults (Option 4 Numbers OFF)", () => {
    it("Does NOT modify numbers, times, ratios, or versions when Option 4 is OFF", () => {
      const input =
        "Với sự bùng nổ của các mô hình học sâu tại phiên bản v2.0, việc tạo ra giọng nói tự nhiên, giàu cảm xúc đã không còn là đặc quyền của các phòng thu chuyên nghiệp. Hệ thống có thể xử lý chính xác các số thập phân như 3.14 hay mốc thời gian 10:30 mà không hề bị ngắt quãng. Đồng thời, với tỷ lệ khung hình 16:9 và tốc độ truyền tải 127.0.0.1.";

      const res = normalizeText(input, [...DEFAULT_GROUPS]);

      // Protected spans remain exactly as in source
      assert.ok(res.normalizedText.includes("v2.0"));
      assert.ok(res.normalizedText.includes("3.14"));
      assert.ok(res.normalizedText.includes("10:30"));
      assert.ok(res.normalizedText.includes("16:9"));
      assert.ok(res.normalizedText.includes("127.0.0.1"));
      // Colon inside 10:30 and 16:9 was NOT split with space
      assert.ok(!res.normalizedText.includes("10: 30"));
      assert.ok(!res.normalizedText.includes("16: 9"));
    });
  });
});

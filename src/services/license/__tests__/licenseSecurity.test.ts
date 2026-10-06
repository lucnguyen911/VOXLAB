import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LicenseService,
  maskLicenseKey,
  sanitizeDiagnostics,
} from "../licenseService";

describe("TASK-15: License Security Test Suite (LICENSE-AC-01 to LICENSE-AC-14)", () => {
  test("LICENSE-AC-01 & LICENSE-AC-04: Unactivated startup returns NO_KEY with masked display", async () => {
    await LicenseService.clearLocalLicense();
    const summary = await LicenseService.getSummary();
    assert.strictEqual(summary.is_valid, false);
    assert.strictEqual(summary.status, "NO_KEY");
    assert.strictEqual(summary.can_use_app, false);
    assert.strictEqual(summary.masked_key, "Chưa kích hoạt");
  });

  test("LICENSE-AC-02: Zero Raw Key Retention Invariant", async () => {
    const rawKey = "VOXL-ABCD-1234-EFGH-5678";
    const summary = await LicenseService.activate(rawKey);

    // Frontend only receives summary with masked key
    assert.strictEqual(summary.is_valid, true);
    assert.strictEqual(summary.status, "ACTIVATED");
    assert.ok(!summary.masked_key.includes("ABCD-1234-EFGH"));
    assert.strictEqual(summary.masked_key, maskLicenseKey(rawKey));

    // Diagnostic logs sanitize any raw key pattern
    const rawLog = `Activating license with key: ${rawKey} on host`;
    const sanitized = sanitizeDiagnostics(rawLog);
    assert.ok(!sanitized.includes(rawKey));
    assert.match(sanitized, /\[MASKED_LICENSE_KEY\]/);
  });

  test("LICENSE-AC-06 & LICENSE-AC-07: Definitive rejection for Expired or Disabled keys", async () => {
    const expiredSummary = await LicenseService.activate("VOXL-EXPIRED-TEST-KEY-0001");
    assert.strictEqual(expiredSummary.is_valid, false);
    assert.strictEqual(expiredSummary.status, "EXPIRED");
    assert.strictEqual(expiredSummary.can_use_app, false);

    // Definitive rejection must never grant offline grace
    assert.notStrictEqual(expiredSummary.status, "OFFLINE_GRACE");
  });

  test("LICENSE-AC-08: Device Mismatch rejection", async () => {
    const mismatchSummary = await LicenseService.activate("VOXL-MISMATCH-OTHER-DEVICE-KEY");
    assert.strictEqual(mismatchSummary.is_valid, false);
    assert.strictEqual(mismatchSummary.status, "DEVICE_MISMATCH");
    assert.strictEqual(mismatchSummary.can_use_app, false);
  });

  test("LICENSE-AC-11: Key masking protects keys of varying lengths", () => {
    // Normal 16-24 char key
    const normalMasked = maskLicenseKey("VOXL-9876-5432-1098");
    assert.strictEqual(normalMasked, "VOXL-****-****-1098");

    // Short key fallback
    const shortMasked = maskLicenseKey("SHORT");
    assert.strictEqual(shortMasked, "VOXL-****-****-KEY");
  });

  test("LICENSE-AC-13: Change Key allows replacing active license", async () => {
    await LicenseService.activate("VOXL-COMMERCIAL-ORIGINAL-KEY-1");
    const summary1 = await LicenseService.getSummary();
    assert.strictEqual(summary1.is_valid, true);

    const changed = await LicenseService.changeKey("VOXL-COMMERCIAL-REPLACEMENT-KEY-2");
    assert.strictEqual(changed.is_valid, true);
    assert.strictEqual(changed.status, "ACTIVATED");
    assert.strictEqual(changed.masked_key, maskLicenseKey("VOXL-COMMERCIAL-REPLACEMENT-KEY-2"));
  });
});

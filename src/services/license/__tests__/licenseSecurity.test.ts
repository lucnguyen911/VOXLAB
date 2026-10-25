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

  test("LICENSE-AC-06 & LICENSE-AC-07: Definitive rejection for Expired, Disabled, or Device Limit keys", async () => {
    const expiredSummary = await LicenseService.activate("VOXL-EXPIRED-TEST-KEY-0001");
    assert.strictEqual(expiredSummary.is_valid, false);
    assert.strictEqual(expiredSummary.status, "EXPIRED");
    assert.strictEqual(expiredSummary.can_use_app, false);
    assert.notStrictEqual(expiredSummary.status, "OFFLINE_GRACE");

    const disabledSummary = await LicenseService.activate("VOXL-DISABLED-TEST-KEY-0002");
    assert.strictEqual(disabledSummary.is_valid, false);
    assert.strictEqual(disabledSummary.status, "DISABLED");
    assert.strictEqual(disabledSummary.can_use_app, false);

    const limitSummary = await LicenseService.activate("VOXL-LIMIT-TEST-KEY-0003");
    assert.strictEqual(limitSummary.is_valid, false);
    assert.strictEqual(limitSummary.status, "DEVICE_LIMIT");
    assert.strictEqual(limitSummary.can_use_app, false);
  });

  test("LICENSE-AC-08: Device Mismatch rejection", async () => {
    const mismatchSummary = await LicenseService.activate("VOXL-MISMATCH-OTHER-DEVICE-KEY");
    assert.strictEqual(mismatchSummary.is_valid, false);
    assert.strictEqual(mismatchSummary.status, "DEVICE_MISMATCH");
    assert.strictEqual(mismatchSummary.can_use_app, false);
  });

  test("LICENSE-AC-11: Key masking protects keys of varying lengths", () => {
    const normalMasked = maskLicenseKey("VOXL-9876-5432-1098");
    assert.strictEqual(normalMasked, "VOXL-****-****-1098");

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

  test("STAGE 3.4: Production build strictly blocks mock activation when Tauri native runtime is absent", async () => {
    LicenseService._setForceProductionModeForTest(true);
    try {
      const prodActivate = await LicenseService.activate("VOXL-COMMERCIAL-PROD-KEY-9999");
      assert.strictEqual(prodActivate.is_valid, false);
      assert.strictEqual(prodActivate.can_use_app, false);
      assert.strictEqual(prodActivate.status, "SERVER_ERROR");

      const prodVerify = await LicenseService.verify();
      assert.strictEqual(prodVerify.is_valid, false);
      assert.strictEqual(prodVerify.can_use_app, false);
    } finally {
      LicenseService._setForceProductionModeForTest(false);
    }
  });

  test("SECURITY-V3: VOXLAB-XXXX-XXXX-XXXX-XXXX masking, diagnostics sanitization, and default-enabled gate", () => {
    const v3RawKey = "VOXLAB-ABCD-1234-EFGH-5678";
    assert.strictEqual(maskLicenseKey(v3RawKey), "VOXLAB-****-****-5678");

    const diag = sanitizeDiagnostics(`RPC payload key=${v3RawKey} rejected`);
    assert.ok(!diag.includes(v3RawKey));
    assert.match(diag, /\[MASKED_LICENSE_KEY\]/);

    assert.strictEqual(LicenseService.isCommercialGateEnabled(), true);
  });
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LicenseService, maskLicenseKey } from '../licenseService';

describe('LicenseService & Masking', () => {
  beforeEach(async () => {
    await LicenseService.clearLocalLicense();
  });

  it('maskLicenseKey correctly masks normal and short keys (LICENSE-AC-11)', () => {
    assert.equal(maskLicenseKey('VOXL-1234-5678-ABCD'), 'VOXL-****-****-ABCD');
    assert.equal(maskLicenseKey('KEY-9999-XXXX-0001'), 'KEY--****-****-0001');
    assert.equal(maskLicenseKey('SHORT'), 'VOXL-****-****-KEY');
    assert.equal(maskLicenseKey(''), 'VOXL-****-****-KEY');
  });

  it('getSummary returns unactivated state when no key is configured (LICENSE-AC-01)', async () => {
    const summary = await LicenseService.getSummary();
    assert.equal(summary.is_valid, false);
    assert.equal(summary.status, 'NO_KEY');
    assert.equal(summary.can_use_app, false);
    assert.equal(summary.masked_key, 'Chưa kích hoạt');
  });

  it('activate rejects empty key gracefully', async () => {
    const summary = await LicenseService.activate('   ');
    assert.equal(summary.is_valid, false);
    assert.equal(summary.can_use_app, false);
    assert.ok(summary.error_message?.includes('Vui lòng'));
  });

  it('activate unlocks application with valid key without exposing raw key (LICENSE-AC-05, LICENSE-AC-11)', async () => {
    const rawKey = 'VOXL-VALID-KEY-9999';
    const summary = await LicenseService.activate(rawKey);

    assert.equal(summary.is_valid, true);
    assert.equal(summary.can_use_app, true);
    assert.equal(summary.status, 'ACTIVATED');
    assert.equal(summary.masked_key, 'VOXL-****-****-9999');
    // Ensure raw key is NOT present anywhere in the summary object
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes(rawKey), 'Raw key must NEVER be leaked in summary');
  });

  it('activate handles expired keys (LICENSE-AC-06)', async () => {
    const rawKey = 'VOXL-EXPIRED-TEST-0000';
    const summary = await LicenseService.activate(rawKey);

    assert.equal(summary.is_valid, false);
    assert.equal(summary.can_use_app, false);
    assert.equal(summary.status, 'EXPIRED');
  });

  it('activate handles device mismatch (LICENSE-AC-08)', async () => {
    const rawKey = 'VOXL-MISMATCH-OTHER-DEV';
    const summary = await LicenseService.activate(rawKey);

    assert.equal(summary.is_valid, false);
    assert.equal(summary.can_use_app, false);
    assert.equal(summary.status, 'DEVICE_MISMATCH');
  });

  it('changeKey allows changing license key (LICENSE-AC-13)', async () => {
    await LicenseService.activate('VOXL-KEY1-FIRST-1111');
    const updated = await LicenseService.changeKey('VOXL-KEY2-SECOND-2222');

    assert.equal(updated.is_valid, true);
    assert.equal(updated.masked_key, 'VOXL-****-****-2222');
  });

  it('clearLocalLicense removes active credentials', async () => {
    await LicenseService.activate('VOXL-VALID-KEY-9999');
    let summary = await LicenseService.getSummary();
    assert.equal(summary.is_valid, true);

    await LicenseService.clearLocalLicense();
    summary = await LicenseService.getSummary();
    assert.equal(summary.is_valid, false);
    assert.equal(summary.status, 'NO_KEY');
  });
});

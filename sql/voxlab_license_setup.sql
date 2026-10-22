-- =============================================================================
-- VOXLAB — SUPABASE LICENSE SERVER SETUP (PRODUCTION HARDENED)
-- Reference Architecture: Audio-Factory / VoxLab Security Spec (Gate E)
-- =============================================================================
-- Instructions:
-- 1. Open Supabase Dashboard -> SQL Editor -> New Query.
-- 2. Paste this entire script and click "Run".
-- 3. Verify that RLS is enabled on `licenses` and `license_devices`, and only
--    `activate_or_verify_license` is callable by `anon` / `authenticated`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLE: public.licenses
CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key TEXT UNIQUE NOT NULL,
    product_code TEXT NOT NULL DEFAULT 'VOXLAB',
    license_type TEXT NOT NULL DEFAULT 'Commercial Pro License',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired')),
    max_devices INT NOT NULL DEFAULT 1 CHECK (max_devices >= 1),
    expires_at TIMESTAMPTZ NULL,
    customer_note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voxlab_licenses_key ON public.licenses (license_key);
CREATE INDEX IF NOT EXISTS idx_voxlab_licenses_product ON public.licenses (product_code);

-- 2. TABLE: public.license_devices
CREATE TABLE IF NOT EXISTS public.license_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
    hwid TEXT NOT NULL,
    app_version TEXT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (license_id, hwid)
);

CREATE INDEX IF NOT EXISTS idx_voxlab_license_devices_license_id ON public.license_devices (license_id);
CREATE INDEX IF NOT EXISTS idx_voxlab_license_devices_hwid ON public.license_devices (hwid);

-- 3. ROW LEVEL SECURITY & DIRECT TABLE LOCKDOWN
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_devices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.licenses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.license_devices FROM PUBLIC, anon, authenticated;

-- 4. ATOMIC RPC: public.activate_or_verify_license
-- Matches `src-tauri/src/security/license_client.rs` contract:
-- Input:  p_license_key TEXT, p_hwid TEXT, p_app_version TEXT
-- Output: JSONB { status, message, expires_at (epoch seconds or null), license_type }
CREATE OR REPLACE FUNCTION public.activate_or_verify_license(
    p_license_key TEXT,
    p_hwid TEXT,
    p_app_version TEXT DEFAULT '0.1.0'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_key TEXT;
    v_clean_hwid TEXT;
    v_lic RECORD;
    v_device_exists BOOLEAN;
    v_device_count INT;
    v_expires_epoch BIGINT;
BEGIN
    v_clean_key := UPPER(TRIM(COALESCE(p_license_key, '')));
    v_clean_hwid := TRIM(COALESCE(p_hwid, ''));

    IF v_clean_key = '' THEN
        RETURN jsonb_build_object(
            'status', 'NOT_FOUND',
            'message', 'Vui lòng nhập mã bản quyền (License Key).',
            'expires_at', NULL,
            'license_type', NULL
        );
    END IF;

    IF v_clean_hwid = '' OR LENGTH(v_clean_hwid) < 16 THEN
        RETURN jsonb_build_object(
            'status', 'DEVICE_MISMATCH',
            'message', 'Định danh thiết bị phần cứng (HWID) không hợp lệ.',
            'expires_at', NULL,
            'license_type', NULL
        );
    END IF;

    -- Lock the license row with FOR UPDATE to prevent race conditions during concurrent activations
    SELECT *
    INTO v_lic
    FROM public.licenses
    WHERE UPPER(license_key) = v_clean_key
      AND (product_code = 'VOXLAB' OR product_code = 'ALL')
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'NOT_FOUND',
            'message', 'Mã bản quyền không tồn tại hoặc không dành cho VoxLab.',
            'expires_at', NULL,
            'license_type', NULL
        );
    END IF;

    v_expires_epoch := CASE
        WHEN v_lic.expires_at IS NOT NULL THEN EXTRACT(EPOCH FROM v_lic.expires_at)::BIGINT
        ELSE NULL
    END;

    -- Check disabled status
    IF v_lic.status = 'disabled' THEN
        RETURN jsonb_build_object(
            'status', 'DISABLED',
            'message', 'Mã bản quyền đã bị khóa hoặc thu hồi bởi quản trị viên.',
            'expires_at', v_expires_epoch,
            'license_type', v_lic.license_type
        );
    END IF;

    -- Check expiration
    IF v_lic.status = 'expired' OR (v_lic.expires_at IS NOT NULL AND v_lic.expires_at < NOW()) THEN
        IF v_lic.status <> 'expired' THEN
            UPDATE public.licenses
            SET status = 'expired', updated_at = NOW()
            WHERE id = v_lic.id;
        END IF;

        RETURN jsonb_build_object(
            'status', 'EXPIRED',
            'message', 'Mã bản quyền đã hết hạn sử dụng.',
            'expires_at', v_expires_epoch,
            'license_type', v_lic.license_type
        );
    END IF;

    -- Check if this HWID is already bound to the license
    SELECT EXISTS (
        SELECT 1
        FROM public.license_devices
        WHERE license_id = v_lic.id
          AND hwid = v_clean_hwid
    ) INTO v_device_exists;

    IF v_device_exists THEN
        UPDATE public.license_devices
        SET last_seen_at = NOW(),
            app_version = COALESCE(NULLIF(TRIM(p_app_version), ''), app_version)
        WHERE license_id = v_lic.id
          AND hwid = v_clean_hwid;

        RETURN jsonb_build_object(
            'status', 'VALID',
            'message', 'Xác thực bản quyền thành công.',
            'expires_at', v_expires_epoch,
            'license_type', v_lic.license_type
        );
    END IF;

    -- Count existing bound devices for this license
    SELECT COUNT(*)
    INTO v_device_count
    FROM public.license_devices
    WHERE license_id = v_lic.id;

    IF v_device_count >= v_lic.max_devices THEN
        RETURN jsonb_build_object(
            'status', CASE WHEN v_lic.max_devices = 1 THEN 'DEVICE_MISMATCH' ELSE 'DEVICE_LIMIT' END,
            'message', CASE
                WHEN v_lic.max_devices = 1 THEN 'Mã bản quyền này đã được kích hoạt trên một thiết bị khác.'
                ELSE format('Mã bản quyền đã đạt giới hạn tối đa (%s/%s thiết bị).', v_device_count, v_lic.max_devices)
            END,
            'expires_at', v_expires_epoch,
            'license_type', v_lic.license_type
        );
    END IF;

    -- Bind new device atomically
    INSERT INTO public.license_devices (license_id, hwid, app_version, first_seen_at, last_seen_at)
    VALUES (v_lic.id, v_clean_hwid, NULLIF(TRIM(p_app_version), ''), NOW(), NOW());

    UPDATE public.licenses
    SET updated_at = NOW()
    WHERE id = v_lic.id;

    RETURN jsonb_build_object(
        'status', 'ACTIVATED',
        'message', 'Kích hoạt bản quyền thành công trên thiết bị này.',
        'expires_at', v_expires_epoch,
        'license_type', v_lic.license_type
    );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_or_verify_license(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_or_verify_license(TEXT, TEXT, TEXT) TO anon, authenticated;

-- =============================================================================
-- ADMIN HELPER QUERIES (RUN MANUALLY IN SUPABASE SQL EDITOR AS NEEDED)
-- =============================================================================
-- 1. Create a 1-device Perpetual License:
-- INSERT INTO public.licenses (license_key, product_code, license_type, status, max_devices, expires_at, customer_note)
-- VALUES ('VOXL-PRO1-2026-ABCD', 'VOXLAB', 'Commercial Pro License', 'active', 1, NULL, 'Khách hàng A');
--
-- 2. Create a 30-day Trial License:
-- INSERT INTO public.licenses (license_key, product_code, license_type, status, max_devices, expires_at, customer_note)
-- VALUES ('VOXL-TRIAL-30D-0001', 'VOXLAB', 'Trial 30 Days', 'active', 1, NOW() + INTERVAL '30 days', 'Bản dùng thử');
--
-- 3. Reset device binding for a customer moving to a new PC:
-- DELETE FROM public.license_devices
-- WHERE license_id = (SELECT id FROM public.licenses WHERE license_key = 'VOXL-PRO1-2026-ABCD');
--
-- 4. Disable/revoke a license key:
-- UPDATE public.licenses SET status = 'disabled', updated_at = NOW() WHERE license_key = 'VOXL-PRO1-2026-ABCD';

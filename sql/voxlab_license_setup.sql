-- =============================================================================
-- VOXLAB — SUPABASE LICENSE SERVER SETUP (SECURITY V3 - CLEAN 10-COLUMN SCHEMA)
-- Project: MMO-TOOL-Manager (Aligned with audio_licenses & video_licenses)
-- =============================================================================
-- Instructions:
-- 1. Open Supabase Dashboard -> SQL Editor -> New Query.
-- 2. Paste this entire script and click "Run".
-- 3. Verify that RLS is enabled on `public.voxlab_licenses` and only
--    `activate_or_verify_voxlab_license_v3` is callable by `anon` / `authenticated`.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_voxlab_license_key()
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    raw_hex text;
BEGIN
    raw_hex := upper(replace(gen_random_uuid()::text, '-', ''));
    RETURN 'VOXLAB-' ||
           substring(raw_hex from 1 for 4) || '-' ||
           substring(raw_hex from 5 for 4) || '-' ||
           substring(raw_hex from 9 for 4) || '-' ||
           substring(raw_hex from 13 for 4);
END;
$$;

CREATE TABLE IF NOT EXISTS public.voxlab_licenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key text UNIQUE NOT NULL DEFAULT public.generate_voxlab_license_key(),
    is_active boolean NOT NULL DEFAULT true,
    max_devices integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    expired_at timestamptz,
    customer_name text,
    contact_info text,
    note text,
    device_hwids jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT voxlab_licenses_max_devices_check CHECK (max_devices >= 1 AND max_devices <= 100),
    CONSTRAINT voxlab_licenses_device_hwids_array_check CHECK (jsonb_typeof(device_hwids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_voxlab_licenses_key_upper
    ON public.voxlab_licenses (upper(btrim(license_key)));

ALTER TABLE public.voxlab_licenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.voxlab_licenses FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.activate_or_verify_voxlab_license_v3(
    p_license_key text,
    p_hwid text,
    p_hwid_version integer DEFAULT 3,
    p_legacy_candidates jsonb DEFAULT '[]'::jsonb,
    p_app_version text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    rec public.voxlab_licenses%ROWTYPE;
    v_clean_key text;
    v_clean_hwid text;
    v_current_hwids jsonb;
    v_matched boolean := false;
    v_legacy_idx integer;
    v_expires_epoch bigint;
    v_license_type text;
BEGIN
    v_clean_key := upper(btrim(coalesce(p_license_key, '')));
    v_clean_hwid := lower(btrim(coalesce(p_hwid, '')));

    IF v_clean_key = ''
       OR v_clean_hwid !~ '^[0-9a-f]{64}$'
       OR p_hwid_version <> 3 THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status', 'CLIENT_CONFIG_ERROR',
            'message', 'Dữ liệu xác thực thiết bị không hợp lệ. Vui lòng cập nhật ứng dụng.'
        );
    END IF;

    SELECT *
      INTO rec
      FROM public.voxlab_licenses
     WHERE upper(btrim(license_key)) = v_clean_key
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status', 'NOT_FOUND',
            'message', 'Key bản quyền không tồn tại.'
        );
    END IF;

    v_expires_epoch := CASE
        WHEN rec.expired_at IS NOT NULL THEN extract(epoch FROM rec.expired_at)::bigint
        ELSE NULL
    END;

    v_license_type := CASE
        WHEN rec.expired_at IS NULL THEN 'Commercial Lifetime'
        ELSE 'Commercial Subscription'
    END;

    IF NOT coalesce(rec.is_active, true) THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status', 'DISABLED',
            'message', 'Key bản quyền đã bị khóa hoặc vô hiệu hóa.',
            'expires_at', v_expires_epoch,
            'expired_at', rec.expired_at,
            'license_type', v_license_type
        );
    END IF;

    IF rec.expired_at IS NOT NULL AND rec.expired_at <= now() THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status', 'EXPIRED',
            'message', 'Key bản quyền đã hết hạn sử dụng. Vui lòng gia hạn để tiếp tục.',
            'expires_at', v_expires_epoch,
            'expired_at', rec.expired_at,
            'license_type', v_license_type
        );
    END IF;

    v_current_hwids := coalesce(rec.device_hwids, '[]'::jsonb);

    SELECT EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(v_current_hwids) AS d(val)
         WHERE lower(d.val) = v_clean_hwid
    ) INTO v_matched;

    IF v_matched THEN
        RETURN jsonb_build_object(
            'valid', true,
            'status', 'VALID',
            'message', 'Bản quyền hợp lệ.',
            'expires_at', v_expires_epoch,
            'expired_at', rec.expired_at,
            'license_type', v_license_type,
            'device_count', jsonb_array_length(v_current_hwids),
            'max_devices', rec.max_devices
        );
    END IF;

    IF p_legacy_candidates IS NOT NULL
       AND jsonb_typeof(p_legacy_candidates) = 'array'
       AND jsonb_array_length(p_legacy_candidates) > 0 THEN
        SELECT (dev.ord - 1)::integer
          INTO v_legacy_idx
          FROM jsonb_array_elements_text(v_current_hwids) WITH ORDINALITY AS dev(val, ord)
         WHERE dev.val IN (SELECT jsonb_array_elements_text(p_legacy_candidates))
         LIMIT 1;

        IF FOUND THEN
            v_current_hwids := jsonb_set(
                v_current_hwids,
                ARRAY[v_legacy_idx::text],
                to_jsonb(v_clean_hwid),
                false
            );
            UPDATE public.voxlab_licenses
               SET device_hwids = v_current_hwids
             WHERE id = rec.id;

            RETURN jsonb_build_object(
                'valid', true,
                'status', 'MIGRATED',
                'message', 'Đã chuyển đổi bản quyền sang hệ thống mới thành công!',
                'expires_at', v_expires_epoch,
                'expired_at', rec.expired_at,
                'license_type', v_license_type,
                'device_count', jsonb_array_length(v_current_hwids),
                'max_devices', rec.max_devices
            );
        END IF;
    END IF;

    IF jsonb_array_length(v_current_hwids) >= rec.max_devices THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status', CASE WHEN rec.max_devices = 1 THEN 'DEVICE_MISMATCH' ELSE 'DEVICE_LIMIT' END,
            'message', CASE
                WHEN rec.max_devices = 1 THEN 'Key đã được sử dụng ở máy khác!'
                ELSE format('Key đã đạt số thiết bị tối đa (%s/%s). Vui lòng liên hệ quản trị viên để reset thiết bị.', jsonb_array_length(v_current_hwids), rec.max_devices)
            END,
            'expires_at', v_expires_epoch,
            'expired_at', rec.expired_at,
            'license_type', v_license_type,
            'device_count', jsonb_array_length(v_current_hwids),
            'max_devices', rec.max_devices
        );
    END IF;

    v_current_hwids := v_current_hwids || jsonb_build_array(v_clean_hwid);
    UPDATE public.voxlab_licenses
       SET device_hwids = v_current_hwids
     WHERE id = rec.id;

    RETURN jsonb_build_object(
        'valid', true,
        'status', 'ACTIVATED',
        'message', 'Kích hoạt bản quyền thành công trên máy này!',
        'expires_at', v_expires_epoch,
        'expired_at', rec.expired_at,
        'license_type', v_license_type,
        'device_count', jsonb_array_length(v_current_hwids),
        'max_devices', rec.max_devices
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_voxlab_license_devices_v3(p_license_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    affected integer;
BEGIN
    UPDATE public.voxlab_licenses
       SET device_hwids = '[]'::jsonb
     WHERE upper(btrim(license_key)) = upper(btrim(p_license_key));
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_voxlab_license_device_v3(
    p_license_key text,
    p_hwid_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    affected integer;
BEGIN
    UPDATE public.voxlab_licenses
       SET device_hwids = coalesce((
           SELECT jsonb_agg(d.val)
             FROM jsonb_array_elements_text(device_hwids) AS d(val)
            WHERE lower(d.val) <> lower(btrim(p_hwid_hash))
       ), '[]'::jsonb)
     WHERE upper(btrim(license_key)) = upper(btrim(p_license_key))
       AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements_text(device_hwids) AS d(val)
            WHERE lower(d.val) = lower(btrim(p_hwid_hash))
       );
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_voxlab_license_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_voxlab_license_key() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.activate_or_verify_voxlab_license_v3(text, text, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_or_verify_voxlab_license_v3(text, text, integer, jsonb, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_reset_voxlab_license_devices_v3(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_voxlab_license_devices_v3(text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_remove_voxlab_license_device_v3(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_voxlab_license_device_v3(text, text) TO service_role;

COMMIT;

-- =============================================================================
-- ADMIN HELPER QUERIES (RUN MANUALLY IN SUPABASE SQL EDITOR OR SERVICE_ROLE BOT)
-- =============================================================================
-- 1. Tạo Key Vĩnh Viễn tự động (VOXLAB-XXXX-XXXX-XXXX-XXXX, 1 thiết bị):
-- INSERT INTO public.voxlab_licenses (customer_name, max_devices, is_active, expired_at, note)
-- VALUES ('Nguyễn Văn A', 1, true, NULL, 'Gói Vĩnh viễn')
-- RETURNING license_key;
--
-- 2. Tạo Key có thời hạn 30 ngày:
-- INSERT INTO public.voxlab_licenses (customer_name, max_devices, is_active, expired_at, note)
-- VALUES ('Khách dùng thử', 1, true, NOW() + INTERVAL '30 days', 'Gói 30 ngày')
-- RETURNING license_key;
--
-- 3. Reset toàn bộ mã máy HWID của 1 Key:
-- SELECT public.admin_reset_voxlab_license_devices_v3('VOXLAB-XXXX-XXXX-XXXX-XXXX');
--
-- 4. Khóa / vô hiệu hóa Key:
-- UPDATE public.voxlab_licenses SET is_active = false WHERE license_key = 'VOXLAB-XXXX-XXXX-XXXX-XXXX';

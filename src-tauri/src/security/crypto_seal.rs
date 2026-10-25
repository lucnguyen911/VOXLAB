//! Cryptographic primitives for Security v3.1:
//! - RFC 2104 `HMAC-SHA256` & constant-time byte comparison (`ct_eq_bytes`)
//! - Iterated 2048-round SHA-256 key derivation (`derive_kdf_key`)
//! - OS-CSPRNG-backed 256-bit random token generator (`generate_random_32`)
//! - In-memory per-process `SessionSeal` verified via `#[inline(always)]` checks

use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::hint::black_box;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const HMAC_BLOCK_SIZE: usize = 64;
pub const KDF_ROUNDS: u32 = 2048;

/// RFC 2104 HMAC-SHA256 implementation over `sha2::Sha256`.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut key_block = [0u8; HMAC_BLOCK_SIZE];
    if key.len() > HMAC_BLOCK_SIZE {
        let hashed_key = Sha256::digest(key);
        key_block[..32].copy_from_slice(&hashed_key);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; HMAC_BLOCK_SIZE];
    let mut opad = [0x5Cu8; HMAC_BLOCK_SIZE];
    for i in 0..HMAC_BLOCK_SIZE {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_digest);
    let final_digest = outer.finalize();

    // Wipe temporary key pads from stack
    for i in 0..HMAC_BLOCK_SIZE {
        unsafe {
            std::ptr::write_volatile(&mut key_block[i], 0);
            std::ptr::write_volatile(&mut ipad[i], 0);
            std::ptr::write_volatile(&mut opad[i], 0);
        }
    }

    let mut out = [0u8; 32];
    out.copy_from_slice(&final_digest);
    out
}

/// Encodes bytes as lowercase hexadecimal string.
pub fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

/// Decodes a hexadecimal string into raw bytes.
pub fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    let trimmed = hex.trim();
    if trimmed.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(trimmed.len() / 2);
    let bytes = trimmed.as_bytes();
    for chunk in bytes.chunks_exact(2) {
        let hi = (chunk[0] as char).to_digit(16)?;
        let lo = (chunk[1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

/// Constant-time byte slice equality check resistant to compiler short-circuiting.
#[inline(always)]
pub fn ct_eq_bytes(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..a.len() {
        diff |= black_box(a[i]) ^ black_box(b[i]);
    }
    black_box(diff) == 0
}

/// Constant-time hex MAC verification against expected raw 32-byte tag.
#[inline(always)]
pub fn verify_hex_mac_ct(candidate_hex: &str, expected_mac: &[u8; 32]) -> bool {
    let Some(decoded) = hex_decode(candidate_hex) else {
        return false;
    };
    ct_eq_bytes(&decoded, expected_mac)
}

/// Deterministic 2048-round iterated HMAC-SHA256 KDF shared identically between
/// Rust host and Python `ipc_auth.py` sidecar.
pub fn derive_kdf_key(seed: &[u8], rounds: u32) -> [u8; 32] {
    let mut state = [0u8; 32];
    let initial = Sha256::digest(seed);
    state.copy_from_slice(&initial);

    let mut msg = [0u8; 36];
    for round in 0..rounds {
        msg[..32].copy_from_slice(&state);
        msg[32..36].copy_from_slice(&round.to_be_bytes());
        state = hmac_sha256(seed, &msg);
    }
    state
}

/// Generates 32 cryptographically strong random bytes seeded from OS CSPRNG (`RandomState` / `ProcessPrng`),
/// monotonic/wall-clock entropy, and per-call counter hashed via SHA-256.
pub fn generate_random_32() -> [u8; 32] {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let mut hasher = Sha256::new();

    for idx in 0..8u64 {
        let rs = RandomState::new();
        let mut h = rs.build_hasher();
        h.write_u64(idx ^ COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        hasher.update(h.finish().to_le_bytes());
    }

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());

    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Returns the cached 32-byte IPC master key derived from the compile-time obfuscated seed.
pub fn ipc_master_key() -> &'static [u8; 32] {
    static IPC_KEY: OnceLock<[u8; 32]> = OnceLock::new();
    IPC_KEY.get_or_init(|| {
        let seed = super::obf::decode_ipc_auth_seed();
        derive_kdf_key(seed.as_bytes(), KDF_ROUNDS)
    })
}

/// Derives per-spawn mutual authentication session key:
/// `HMAC-SHA256(ipc_master_key, "{spawn_seed_hex}|{host_pid}|{runtime}")`.
pub fn derive_sidecar_session_key(spawn_seed_hex: &str, host_pid: u32, runtime: &str) -> [u8; 32] {
    let material = format!("{}|{}|{}", spawn_seed_hex, host_pid, runtime);
    hmac_sha256(ipc_master_key(), material.as_bytes())
}

/// Returns the cached 32-byte vault master key for DPAPI dynamic entropy and `integrity_tag` sealing.
pub fn vault_master_key() -> &'static [u8; 32] {
    static VAULT_KEY: OnceLock<[u8; 32]> = OnceLock::new();
    VAULT_KEY.get_or_init(|| {
        let seed = super::obf::decode_vault_domain_seed();
        derive_kdf_key(seed.as_bytes(), KDF_ROUNDS)
    })
}

#[derive(Clone)]
struct ActiveSessionToken {
    hwid: String,
    status: String,
    issued_at: u64,
    expires_at: Option<u64>,
    mac: [u8; 32],
}

fn process_session_secret() -> &'static [u8; 32] {
    static SECRET: OnceLock<[u8; 32]> = OnceLock::new();
    SECRET.get_or_init(generate_random_32)
}

fn session_slot() -> &'static Mutex<std::collections::HashMap<String, ActiveSessionToken>> {
    static SLOT: OnceLock<Mutex<std::collections::HashMap<String, ActiveSessionToken>>> =
        OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn compute_session_mac(
    hwid: &str,
    status: &str,
    issued_at: u64,
    expires_at: Option<u64>,
) -> [u8; 32] {
    let exp_val = expires_at.unwrap_or(0);
    let payload = format!("VOXLAB_SESSION_V3.1|{}|{}|{}|{}", hwid, status, issued_at, exp_val);
    hmac_sha256(process_session_secret(), payload.as_bytes())
}

/// Records an authenticated in-memory `SessionSeal` after valid license verification/activation.
pub fn seal_authorized_session(
    hwid: &str,
    status: &str,
    now_secs: u64,
    expires_at: Option<u64>,
) {
    let mac = compute_session_mac(hwid, status, now_secs, expires_at);
    if let Ok(mut guard) = session_slot().lock() {
        if guard.len() >= 16 && !guard.contains_key(hwid) {
            guard.clear();
        }
        guard.insert(
            hwid.to_string(),
            ActiveSessionToken {
                hwid: hwid.to_string(),
                status: status.to_string(),
                issued_at: now_secs,
                expires_at,
                mac,
            },
        );
    }
}

/// Revokes the in-memory `SessionSeal` for a specific HWID.
pub fn clear_authorized_session_for_hwid(hwid: &str) {
    if let Ok(mut guard) = session_slot().lock() {
        guard.remove(hwid);
    }
}

/// Immediately revokes all in-memory `SessionSeal` entries (on key clear or tamper lockout).
pub fn clear_authorized_session() {
    if let Ok(mut guard) = session_slot().lock() {
        guard.clear();
    }
}

/// Inlined constant-time verification of the active in-memory `SessionSeal`.
/// Expanded across call sites under LTO to prevent single-point boolean patching.
#[inline(always)]
pub fn verify_session_seal_inline(expected_hwid: &str, now_secs: u64) -> bool {
    if super::anti_tamper::is_environment_compromised() {
        return false;
    }
    let Ok(guard) = session_slot().lock() else {
        return false;
    };
    let Some(token) = guard.get(expected_hwid) else {
        return false;
    };
    if let Some(exp) = token.expires_at {
        if now_secs >= exp {
            return false;
        }
    }
    // Clock rollback tolerance: 60s
    if now_secs + 60 < token.issued_at {
        return false;
    }
    let expected = compute_session_mac(&token.hwid, &token.status, token.issued_at, token.expires_at);
    ct_eq_bytes(&token.mac, &expected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc4231_hmac_sha256_official_vectors() {
        // RFC 4231 Test Case 1: Key = 20 bytes of 0x0b, Data = "Hi There"
        let key1 = [0x0bu8; 20];
        let mac1 = hmac_sha256(&key1, b"Hi There");
        assert_eq!(
            hex_encode(&mac1),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );

        // RFC 4231 Test Case 2: Key = "Jefe", Data = "what do ya want for nothing?"
        let mac2 = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(
            hex_encode(&mac2),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );

        // RFC 4231 Test Case 6: Key > 64 bytes (131 bytes of 0xaa)
        let key6 = [0xaau8; 131];
        let mac6 = hmac_sha256(&key6, b"Test Using Larger Than Block-Size Key - Hash Key First");
        assert_eq!(
            hex_encode(&mac6),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn session_seal_verifies_and_rejects_mismatch_or_expiry() {
        let hwid = "a".repeat(64);
        seal_authorized_session(&hwid, "VALID", 1_700_000_000, Some(1_700_086_400));
        assert!(verify_session_seal_inline(&hwid, 1_700_001_000));
        // Wrong HWID
        assert!(!verify_session_seal_inline(&"b".repeat(64), 1_700_001_000));
        // Expired
        assert!(!verify_session_seal_inline(&hwid, 1_700_086_400));
        // Clock rollback
        assert!(!verify_session_seal_inline(&hwid, 1_699_999_000));

        clear_authorized_session();
        assert!(!verify_session_seal_inline(&hwid, 1_700_001_000));
    }
}

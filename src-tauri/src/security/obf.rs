//! Runtime decryption and volatile zeroization for compile-time polymorphic constants.
//! Prevents plaintext credentials, RPC endpoints, registry paths, and vault seeds from
//! appearing in `.rdata` of compiled `voxlab.exe` binaries.

use std::hint::black_box;
use std::ops::Deref;
use std::sync::atomic::{compiler_fence, Ordering};

mod raw {
    #![allow(dead_code)]
    include!(concat!(env!("OUT_DIR"), "/obf_constants.rs"));
}

/// Heap buffer whose bytes are unconditionally overwritten with `0x00` via `write_volatile`
/// on `Drop` so sensitive strings do not linger in freed heap blocks.
pub struct ZeroizingBytes {
    buf: Vec<u8>,
}

impl ZeroizingBytes {
    pub fn new(buf: Vec<u8>) -> Self {
        Self { buf }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.buf
    }

    pub fn as_str_lossy(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.buf)
    }
}

impl Deref for ZeroizingBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.buf
    }
}

impl Drop for ZeroizingBytes {
    fn drop(&mut self) {
        let ptr = self.buf.as_mut_ptr();
        let len = self.buf.len();
        for i in 0..len {
            // SAFETY: `i < len` is within allocated `Vec<u8>` bounds.
            unsafe {
                std::ptr::write_volatile(ptr.add(i), 0u8);
            }
        }
        compiler_fence(Ordering::SeqCst);
    }
}

#[inline(never)]
fn splitmix64_rt(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[inline(never)]
pub fn decrypt_polymorphic(cipher: &[u8], key_a: u64, key_b: u64) -> ZeroizingBytes {
    let cipher_ref = black_box(cipher);
    let mut state = black_box(key_a) ^ black_box(key_b);
    let mut ks_word = 0u64;
    let mut out = Vec::with_capacity(cipher_ref.len());

    for (idx, &c) in cipher_ref.iter().enumerate() {
        if idx & 7 == 0 {
            ks_word = splitmix64_rt(&mut state);
        }
        let ks_byte = ((ks_word >> ((idx & 7) * 8)) & 0xFF) as u8;
        let plain = (c ^ ks_byte).rotate_right(3).wrapping_sub(idx as u8);
        out.push(plain);
    }

    ZeroizingBytes::new(out)
}

pub fn decode_supabase_url() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_SUPABASE_URL_DATA,
        raw::OBF_SUPABASE_URL_KEY_A,
        raw::OBF_SUPABASE_URL_KEY_B,
    )
}

pub fn decode_supabase_anon_key() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_SUPABASE_ANON_KEY_DATA,
        raw::OBF_SUPABASE_ANON_KEY_KEY_A,
        raw::OBF_SUPABASE_ANON_KEY_KEY_B,
    )
}

pub fn decode_rpc_activate_path() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_RPC_ACTIVATE_PATH_DATA,
        raw::OBF_RPC_ACTIVATE_PATH_KEY_A,
        raw::OBF_RPC_ACTIVATE_PATH_KEY_B,
    )
}

pub fn decode_legacy_dpapi_entropy() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_LEGACY_DPAPI_ENTROPY_DATA,
        raw::OBF_LEGACY_DPAPI_ENTROPY_KEY_A,
        raw::OBF_LEGACY_DPAPI_ENTROPY_KEY_B,
    )
}

pub fn decode_vault_domain_seed() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_VAULT_DOMAIN_SEED_DATA,
        raw::OBF_VAULT_DOMAIN_SEED_KEY_A,
        raw::OBF_VAULT_DOMAIN_SEED_KEY_B,
    )
}

pub fn decode_ipc_auth_seed() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_IPC_AUTH_SEED_DATA,
        raw::OBF_IPC_AUTH_SEED_KEY_A,
        raw::OBF_IPC_AUTH_SEED_KEY_B,
    )
}

pub fn decode_reg_crypto_subkey() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_REG_CRYPTO_SUBKEY_DATA,
        raw::OBF_REG_CRYPTO_SUBKEY_KEY_A,
        raw::OBF_REG_CRYPTO_SUBKEY_KEY_B,
    )
}

pub fn decode_reg_machine_guid() -> ZeroizingBytes {
    decrypt_polymorphic(
        &raw::OBF_REG_MACHINE_GUID_DATA,
        raw::OBF_REG_MACHINE_GUID_KEY_A,
        raw::OBF_REG_MACHINE_GUID_KEY_B,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polymorphic_constants_decrypt_accurately_and_ciphertext_differs() {
        assert_ne!(
            &raw::OBF_RPC_ACTIVATE_PATH_DATA[..],
            b"/rest/v1/rpc/activate_or_verify_voxlab_license_v3"
        );
        let rpc = decode_rpc_activate_path();
        assert_eq!(
            rpc.as_str_lossy(),
            "/rest/v1/rpc/activate_or_verify_voxlab_license_v3"
        );

        let reg_path = decode_reg_crypto_subkey();
        assert_eq!(reg_path.as_str_lossy(), "SOFTWARE\\Microsoft\\Cryptography");

        let reg_val = decode_reg_machine_guid();
        assert_eq!(reg_val.as_str_lossy(), "MachineGuid");
    }
}

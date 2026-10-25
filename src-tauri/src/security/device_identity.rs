use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

pub const HWID_VERSION_NUM: u32 = 3;
pub const HWID_VERSION: &str = "v3";
const HWID_V3_NAMESPACE: &str = "com.voxlab.app";
const LEGACY_V1_NAMESPACE: &str = "VoxLab-HWID-v1";
const DEVICE_PROFILE_FILE: &str = "device_profile.enc";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub hwid: String,
    pub version: u32,
    pub source: String,
    pub legacy_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredDeviceProfile {
    schema_version: u32,
    hwid_version: u32,
    hwid: String,
    source: String,
    fallback_proof: String,
}

static PROCESS_IDENTITY_CACHE: OnceLock<DeviceIdentity> = OnceLock::new();

/// Normalizes a hardware identifier string:
/// Strips braces, hyphens, and whitespace, then converts to uppercase.
pub fn normalize_anchor(anchor: &str) -> String {
    anchor
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

/// Validates that a normalized hardware anchor is genuine and not an OEM placeholder
/// or all-repeating character sequence (e.g. all zeros or all Fs).
pub fn is_valid_normalized_anchor(norm: &str) -> bool {
    if norm.len() < 8 {
        return false;
    }

    const INVALID_PLACEHOLDERS: &[&str] = &[
        "TOBEFILLEDBYOEM",
        "DEFAULTSTRING",
        "NONE",
        "UNKNOWN",
        "NOTAPPLICABLE",
        "NOTSPECIFIED",
        "SYSTEMSERIALNUMBER",
        "SYSTEMPRODUCTNAME",
        "INVALID",
        "VOXLABFALLBACKDEVICESTABLEANCHOR",
    ];
    if INVALID_PLACEHOLDERS.contains(&norm) {
        return false;
    }

    if let Some(first) = norm.chars().next() {
        if norm.chars().all(|c| c == first) {
            return false;
        }
    }

    true
}

/// Generates Security v3 64-char lowercase hex SHA-256 hash:
/// sha256("com.voxlab.app|{source}|{normalized_anchor_lower}")
pub fn build_hwid_v3(source: &str, normalized_anchor: &str) -> String {
    let mut hasher = Sha256::new();
    let payload = format!(
        "{}|{}|{}",
        HWID_V3_NAMESPACE,
        source,
        normalized_anchor.to_ascii_lowercase()
    );
    hasher.update(payload.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Default v3 hash helper (uses primary `smbios_uuid` namespace when source is unspecified in pure tests).
pub fn hash_hwid(normalized_anchor: &str) -> String {
    build_hwid_v3("smbios_uuid", normalized_anchor)
}

/// Legacy v1 hash (`v1:{sha256}`) used solely for seamless migration of pre-v3 bindings.
pub fn hash_legacy_hwid_v1(normalized_anchor: &str) -> String {
    let mut hasher = Sha256::new();
    let payload = format!("{}:{}", LEGACY_V1_NAMESPACE, normalized_anchor);
    hasher.update(payload.as_bytes());
    format!("v1:{:x}", hasher.finalize())
}

fn build_fallback_proof(normalized_machine_guid: &str) -> String {
    let mut hasher = Sha256::new();
    let payload = format!(
        "{}|fallback-proof|{}",
        HWID_V3_NAMESPACE,
        normalized_machine_guid.to_ascii_lowercase()
    );
    hasher.update(payload.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn is_valid_v3_hex(hwid: &str) -> bool {
    hwid.len() == 64 && hwid.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// Tries to query SMBIOS UUID from Win32_ComputerSystemProduct via PowerShell CIM (no deprecated WMIC).
fn query_smbios_uuid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        if output.status.success() {
            let first_line = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            let norm = normalize_anchor(&first_line);
            if is_valid_normalized_anchor(&norm) {
                return Some(norm);
            }
        }
    }
    None
}

/// Fast native Win32 Registry lookup for `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
/// without spawning an external `reg.exe` process.
fn query_machine_guid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::ptr::null_mut;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
            KEY_WOW64_64KEY, REG_SZ,
        };

        let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography\0"
            .encode_utf16()
            .collect();
        let value_name: Vec<u16> = "MachineGuid\0".encode_utf16().collect();

        unsafe {
            let mut hkey: HKEY = 0;
            let open_status = RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                subkey.as_ptr(),
                0,
                KEY_READ | KEY_WOW64_64KEY,
                &mut hkey,
            );
            if open_status != 0 {
                return None;
            }

            let mut data_type: u32 = 0;
            let mut buf_u16 = [0u16; 128];
            let mut cb_data: u32 = (buf_u16.len() * std::mem::size_of::<u16>()) as u32;

            let query_status = RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                null_mut(),
                &mut data_type,
                buf_u16.as_mut_ptr() as *mut u8,
                &mut cb_data,
            );
            RegCloseKey(hkey);

            if query_status == 0 && data_type == REG_SZ && cb_data >= 2 {
                let u16_len = (cb_data as usize) / 2;
                let slice = &buf_u16[..u16_len];
                let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
                let raw = String::from_utf16_lossy(&slice[..end]);
                let norm = normalize_anchor(&raw);
                if is_valid_normalized_anchor(&norm) {
                    return Some(norm);
                }
            }
        }
    }
    None
}

fn load_stored_profile(base_dir: &Path) -> Option<StoredDeviceProfile> {
    let raw = super::license_storage::load_encrypted_secret_file(base_dir, DEVICE_PROFILE_FILE)
        .ok()
        .flatten()?;
    let parsed: StoredDeviceProfile = serde_json::from_str(&raw).ok()?;
    if parsed.schema_version != 3
        || parsed.hwid_version != HWID_VERSION_NUM
        || !is_valid_v3_hex(&parsed.hwid)
        || (parsed.source != "smbios_uuid" && parsed.source != "machine_guid")
    {
        return None;
    }
    Some(parsed)
}

fn save_stored_profile(base_dir: &Path, profile: &StoredDeviceProfile) {
    if let Ok(json) = serde_json::to_string(profile) {
        let _ =
            super::license_storage::save_encrypted_secret_file(base_dir, DEVICE_PROFILE_FILE, &json);
    }
}

/// Evaluates HWID v3 using strict primary/fallback invariant (LICENSE-AC-04):
/// Primary: SMBIOS / Motherboard UUID (`smbios_uuid`)
/// Fallback: Windows MachineGuid (`machine_guid`, only if SMBIOS is unavailable or invalid)
pub fn try_resolve_identity_from_anchors(
    smbios: Option<&str>,
    machine_guid: Option<&str>,
) -> Result<DeviceIdentity, String> {
    let valid_smbios = smbios
        .map(normalize_anchor)
        .filter(|n| is_valid_normalized_anchor(n));
    let valid_guid = machine_guid
        .map(normalize_anchor)
        .filter(|n| is_valid_normalized_anchor(n));

    let mut legacy_candidates = Vec::new();
    if let Some(ref s) = valid_smbios {
        legacy_candidates.push(hash_legacy_hwid_v1(s));
    }
    if let Some(ref g) = valid_guid {
        legacy_candidates.push(hash_legacy_hwid_v1(g));
        let guid_v3 = build_hwid_v3("machine_guid", g);
        if !legacy_candidates.contains(&guid_v3) {
            legacy_candidates.push(guid_v3);
        }
    }

    if let Some(s) = valid_smbios {
        let hwid = build_hwid_v3("smbios_uuid", &s);
        legacy_candidates.retain(|c| c != &hwid);
        return Ok(DeviceIdentity {
            hwid,
            version: HWID_VERSION_NUM,
            source: "smbios_uuid".to_string(),
            legacy_candidates,
        });
    }

    if let Some(g) = valid_guid {
        let hwid = build_hwid_v3("machine_guid", &g);
        legacy_candidates.retain(|c| c != &hwid);
        return Ok(DeviceIdentity {
            hwid,
            version: HWID_VERSION_NUM,
            source: "machine_guid".to_string(),
            legacy_candidates,
        });
    }

    Err(
        "DEVICE_ID_UNAVAILABLE: Không thể xác định định danh phần cứng đáng tin cậy (SMBIOS UUID / MachineGuid)."
            .to_string(),
    )
}

pub fn try_resolve_hwid_from_anchors(
    smbios: Option<&str>,
    machine_guid: Option<&str>,
) -> Result<String, String> {
    try_resolve_identity_from_anchors(smbios, machine_guid).map(|id| id.hwid)
}

pub fn resolve_hwid_from_anchors(smbios: Option<&str>, machine_guid: Option<&str>) -> String {
    try_resolve_hwid_from_anchors(smbios, machine_guid).unwrap_or_default()
}

/// Resolves full `DeviceIdentity` (HWID v3 + legacy migration candidates), using in-process
/// `OnceLock` cache and DPAPI-protected `device_profile.enc` fallback-proof tied to `MachineGuid`
/// (matching Audio-Factory Security v3).
pub fn get_device_identity(base_dir: Option<&Path>) -> Result<DeviceIdentity, String> {
    if let Some(cached) = PROCESS_IDENTITY_CACHE.get() {
        return Ok(cached.clone());
    }

    let smbios = query_smbios_uuid();
    let machine_guid = query_machine_guid();

    // If SMBIOS is temporarily unavailable on Windows WMI, check fallback_proof bound to MachineGuid
    if smbios.is_none() {
        if let (Some(dir), Some(ref guid)) = (base_dir, &machine_guid) {
            if let Some(stored) = load_stored_profile(dir) {
                if stored.source == "smbios_uuid"
                    && stored.fallback_proof == build_fallback_proof(guid)
                {
                    let mut legacy_candidates = vec![
                        hash_legacy_hwid_v1(guid),
                        build_hwid_v3("machine_guid", guid),
                    ];
                    legacy_candidates.retain(|c| c != &stored.hwid);
                    let recovered = DeviceIdentity {
                        hwid: stored.hwid,
                        version: HWID_VERSION_NUM,
                        source: "smbios_uuid".to_string(),
                        legacy_candidates,
                    };
                    let _ = PROCESS_IDENTITY_CACHE.set(recovered.clone());
                    return Ok(recovered);
                }
            }
        }
    }

    let mut identity =
        try_resolve_identity_from_anchors(smbios.as_deref(), machine_guid.as_deref())?;

    if let Some(dir) = base_dir {
        if let Some(prev) = load_stored_profile(dir) {
            if prev.hwid != identity.hwid && !identity.legacy_candidates.contains(&prev.hwid) {
                identity.legacy_candidates.insert(0, prev.hwid);
            }
        }
        let proof = machine_guid
            .as_deref()
            .map(build_fallback_proof)
            .unwrap_or_default();
        save_stored_profile(
            dir,
            &StoredDeviceProfile {
                schema_version: 3,
                hwid_version: identity.version,
                hwid: identity.hwid.clone(),
                source: identity.source.clone(),
                fallback_proof: proof,
            },
        );
    }

    let _ = PROCESS_IDENTITY_CACHE.set(identity.clone());
    Ok(identity)
}

/// Generates stable Windows HWID v3 (64-hex SHA-256) or returns an explicit error.
pub fn try_generate_hwid() -> Result<String, String> {
    get_device_identity(None).map(|id| id.hwid)
}

/// Generates stable Windows HWID v3 (empty string if unavailable).
pub fn generate_hwid() -> String {
    try_generate_hwid().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_anchor() {
        assert_eq!(
            normalize_anchor("{4C4C4544-004B-4E10-804D-C2C04F343232}"),
            "4C4C4544004B4E10804DC2C04F343232"
        );
        assert_eq!(normalize_anchor(" a-b_c 123 "), "ABC123");
    }

    #[test]
    fn test_hash_hwid_v3_deterministic_64_hex() {
        let anchor = "4C4C4544004B4E10804DC2C04F343232";
        let hwid1 = hash_hwid(anchor);
        let hwid2 = hash_hwid(anchor);
        assert_eq!(hwid1, hwid2);
        assert_eq!(hwid1.len(), 64);
        assert!(is_valid_v3_hex(&hwid1));
    }

    #[test]
    fn test_generate_hwid_valid() {
        let hwid = try_generate_hwid().expect("Windows machine should yield valid HWID v3");
        assert_eq!(hwid.len(), 64);
        assert!(is_valid_v3_hex(&hwid));
    }

    #[test]
    fn test_smbios_available_uses_smbios_and_includes_legacy_v1_candidate() {
        let smbios = "4C4C4544-004B-4E10-804D-C2C04F343232";
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let identity =
            try_resolve_identity_from_anchors(Some(smbios), Some(machine_guid)).unwrap();
        assert_eq!(identity.source, "smbios_uuid");
        assert_eq!(
            identity.hwid,
            build_hwid_v3("smbios_uuid", &normalize_anchor(smbios))
        );
        assert!(identity
            .legacy_candidates
            .contains(&hash_legacy_hwid_v1(&normalize_anchor(smbios))));
    }

    #[test]
    fn test_smbios_missing_falls_back_to_machine_guid() {
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(None, Some(machine_guid));
        assert_eq!(
            hwid,
            build_hwid_v3("machine_guid", &normalize_anchor(machine_guid))
        );
    }

    #[test]
    fn test_smbios_invalid_zero_or_oem_placeholder_falls_back_to_machine_guid() {
        let invalid_smbios = "00000000-0000-0000-0000-000000000000";
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(Some(invalid_smbios), Some(machine_guid));
        assert_eq!(
            hwid,
            build_hwid_v3("machine_guid", &normalize_anchor(machine_guid))
        );

        let oem_placeholder = "To be filled by O.E.M.";
        let hwid2 = resolve_hwid_from_anchors(Some(oem_placeholder), Some(machine_guid));
        assert_eq!(
            hwid2,
            build_hwid_v3("machine_guid", &normalize_anchor(machine_guid))
        );
    }

    #[test]
    fn test_rejects_when_both_anchors_missing_never_uses_shared_fallback() {
        let err = try_resolve_hwid_from_anchors(None, None).unwrap_err();
        assert!(err.contains("DEVICE_ID_UNAVAILABLE"));
        assert_eq!(resolve_hwid_from_anchors(None, None), "");
        assert_eq!(
            resolve_hwid_from_anchors(
                Some("To be filled by O.E.M."),
                Some("00000000-0000-0000-0000-000000000000")
            ),
            ""
        );
    }

    #[test]
    fn test_hwid_non_composite_independent_of_mac_and_cpuid() {
        let smbios = "4C4C4544-004B-4E10-804D-C2C04F343232";
        let guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid_mac_a = resolve_hwid_from_anchors(Some(smbios), Some(guid));
        let hwid_mac_b = resolve_hwid_from_anchors(Some(smbios), Some(guid));
        assert_eq!(hwid_mac_a, hwid_mac_b);

        let hwid_diff_guid =
            resolve_hwid_from_anchors(Some(smbios), Some("different-guid-value"));
        assert_eq!(hwid_mac_a, hwid_diff_guid);
    }
}

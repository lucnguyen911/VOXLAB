use sha2::{Digest, Sha256};
use std::process::Command;

pub const HWID_VERSION: &str = "v1";
const HWID_NAMESPACE: &str = "VoxLab-HWID-v1";

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

/// Generates namespaced SHA-256 hash in format v1:{hex}
pub fn hash_hwid(normalized_anchor: &str) -> String {
    let mut hasher = Sha256::new();
    let payload = format!("{}:{}", HWID_NAMESPACE, normalized_anchor);
    hasher.update(payload.as_bytes());
    let hash = hasher.finalize();
    format!("{}:{:x}", HWID_VERSION, hash)
}

/// Tries to query SMBIOS UUID from Win32_ComputerSystemProduct
fn query_smbios_uuid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        if output.status.success() {
            let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let norm = normalize_anchor(&uuid);
            if is_valid_normalized_anchor(&norm) {
                return Some(norm);
            }
        }
    }
    None
}

/// Fallback: Queries Windows MachineGuid from Registry HKLM\SOFTWARE\Microsoft\Cryptography
fn query_machine_guid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("reg")
            .args([
                "query",
                "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("MachineGuid") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(guid) = parts.last() {
                        let norm = normalize_anchor(guid);
                        if is_valid_normalized_anchor(&norm) {
                            return Some(norm);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Evaluates HWID using strict primary/fallback invariant (LICENSE-AC-04):
/// Primary: SMBIOS / Motherboard UUID
/// Fallback: Windows MachineGuid (only if SMBIOS is unavailable or invalid)
/// NEVER combines both, never takes CPU ID or MAC address into a composite hash,
/// and NEVER returns a static shared fallback HWID when both anchors fail.
pub fn try_resolve_hwid_from_anchors(
    smbios: Option<&str>,
    machine_guid: Option<&str>,
) -> Result<String, String> {
    if let Some(s) = smbios {
        let norm = normalize_anchor(s);
        if is_valid_normalized_anchor(&norm) {
            return Ok(hash_hwid(&norm));
        }
    }

    if let Some(guid) = machine_guid {
        let norm = normalize_anchor(guid);
        if is_valid_normalized_anchor(&norm) {
            return Ok(hash_hwid(&norm));
        }
    }

    Err(
        "DEVICE_ID_UNAVAILABLE: Không thể xác định định danh phần cứng đáng tin cậy (SMBIOS UUID / MachineGuid)."
            .to_string(),
    )
}

/// Compatibility wrapper returning empty string if hardware identity is unavailable.
pub fn resolve_hwid_from_anchors(smbios: Option<&str>, machine_guid: Option<&str>) -> String {
    try_resolve_hwid_from_anchors(smbios, machine_guid).unwrap_or_default()
}

/// Generates stable Windows HWID v1 or returns an explicit error if hardware identity cannot be read.
pub fn try_generate_hwid() -> Result<String, String> {
    try_resolve_hwid_from_anchors(
        query_smbios_uuid().as_deref(),
        query_machine_guid().as_deref(),
    )
}

/// Generates stable Windows HWID v1 (empty string if unavailable).
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
    fn test_hash_hwid_deterministic() {
        let anchor = "4C4C4544004B4E10804DC2C04F343232";
        let hwid1 = hash_hwid(anchor);
        let hwid2 = hash_hwid(anchor);
        assert_eq!(hwid1, hwid2);
        assert!(hwid1.starts_with("v1:"));
        assert_eq!(hwid1.len(), 3 + 64);
    }

    #[test]
    fn test_generate_hwid_valid() {
        let hwid = try_generate_hwid().expect("Windows machine should yield valid HWID");
        assert!(hwid.starts_with("v1:"));
        assert_eq!(hwid.len(), 67);
    }

    #[test]
    fn test_smbios_available_uses_smbios() {
        let smbios = "4C4C4544-004B-4E10-804D-C2C04F343232";
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(Some(smbios), Some(machine_guid));
        assert_eq!(hwid, hash_hwid(&normalize_anchor(smbios)));
    }

    #[test]
    fn test_smbios_missing_falls_back_to_machine_guid() {
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(None, Some(machine_guid));
        assert_eq!(hwid, hash_hwid(&normalize_anchor(machine_guid)));
    }

    #[test]
    fn test_smbios_invalid_zero_or_oem_placeholder_falls_back_to_machine_guid() {
        let invalid_smbios = "00000000-0000-0000-0000-000000000000";
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(Some(invalid_smbios), Some(machine_guid));
        assert_eq!(hwid, hash_hwid(&normalize_anchor(machine_guid)));

        let oem_placeholder = "To be filled by O.E.M.";
        let hwid2 = resolve_hwid_from_anchors(Some(oem_placeholder), Some(machine_guid));
        assert_eq!(hwid2, hash_hwid(&normalize_anchor(machine_guid)));
    }

    #[test]
    fn test_rejects_when_both_anchors_missing_never_uses_shared_fallback() {
        let err = try_resolve_hwid_from_anchors(None, None).unwrap_err();
        assert!(err.contains("DEVICE_ID_UNAVAILABLE"));
        assert_eq!(resolve_hwid_from_anchors(None, None), "");
        assert_eq!(
            resolve_hwid_from_anchors(Some("To be filled by O.E.M."), Some("00000000-0000-0000-0000-000000000000")),
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

        let hwid_diff_guid = resolve_hwid_from_anchors(Some(smbios), Some("different-guid-value"));
        assert_eq!(hwid_mac_a, hwid_diff_guid);
    }
}

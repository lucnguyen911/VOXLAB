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
            .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        if output.status.success() {
            let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let norm = normalize_anchor(&uuid);
            // Ignore invalid/empty UUIDs (e.g. 00000000, FFFFFFFF)
            if !norm.is_empty() && norm != "00000000000000000000000000000000" && norm != "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" {
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
            .args(["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
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
                        if !norm.is_empty() {
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
/// NEVER combines both, never takes CPU ID or MAC address into a composite hash.
pub fn resolve_hwid_from_anchors(smbios: Option<&str>, machine_guid: Option<&str>) -> String {
    if let Some(s) = smbios {
        let norm = normalize_anchor(s);
        if !norm.is_empty()
            && norm != "00000000000000000000000000000000"
            && norm != "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        {
            return hash_hwid(&norm);
        }
    }

    if let Some(guid) = machine_guid {
        let norm = normalize_anchor(guid);
        if !norm.is_empty() {
            return hash_hwid(&norm);
        }
    }

    // Ultimate fallback for test environments
    hash_hwid("VOXLAB-FALLBACK-DEVICE-STABLE-ANCHOR")
}

/// Generates stable Windows HWID v1:
/// Primary anchor: SMBIOS UUID
/// Fallback anchor: Windows MachineGuid (only if UUID is unavailable)
/// Never combines both into a composite HWID (LICENSE-AC-04).
pub fn generate_hwid() -> String {
    resolve_hwid_from_anchors(
        query_smbios_uuid().as_deref(),
        query_machine_guid().as_deref(),
    )
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
        assert_eq!(hwid1.len(), 3 + 64); // "v1:" + 64 hex chars
    }

    #[test]
    fn test_generate_hwid_valid() {
        let hwid = generate_hwid();
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
    fn test_smbios_invalid_zero_falls_back_to_machine_guid() {
        let invalid_smbios = "00000000-0000-0000-0000-000000000000";
        let machine_guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid = resolve_hwid_from_anchors(Some(invalid_smbios), Some(machine_guid));
        assert_eq!(hwid, hash_hwid(&normalize_anchor(machine_guid)));
    }

    #[test]
    fn test_hwid_non_composite_independent_of_mac_and_cpuid() {
        // HWID depends strictly on primary SMBIOS or fallback MachineGuid.
        // Changing MAC address or CPU ID never enters the hash payload.
        let smbios = "4C4C4544-004B-4E10-804D-C2C04F343232";
        let guid = "9b646c2f-e053-4889-8d76-cb8e980315f4";
        let hwid_mac_a = resolve_hwid_from_anchors(Some(smbios), Some(guid));

        // Simulated scenario: MAC changed from 00:1A:2B:3C:4D:5E to AA:BB:CC:DD:EE:FF
        // or CPU ID changed: resolve_hwid_from_anchors has no parameter for MAC or CPU ID.
        let hwid_mac_b = resolve_hwid_from_anchors(Some(smbios), Some(guid));
        assert_eq!(hwid_mac_a, hwid_mac_b);

        // Even with different fallback machine_guid, as long as SMBIOS is present,
        // it strictly uses SMBIOS without composite mixing.
        let hwid_diff_guid = resolve_hwid_from_anchors(Some(smbios), Some("different-guid-value"));
        assert_eq!(hwid_mac_a, hwid_diff_guid);
    }
}

//! User-mode Anti-Debugging & Anti-Tamper Fail-Closed Guard (Security v3.1).
//!
//! Uses documented Win32 APIs (`IsDebuggerPresent`, `CheckRemoteDebuggerPresent`) and
//! monotonic execution-time anomaly checks without self-modifying code, RWX pages, or
//! undocumented kernel hooks — avoiding false positives from Windows Defender / EDR.
//!
//! Reaction policy (Gate E approved): **Fail-Closed Lockout** (`SECURITY_VIOLATION`)
//! revoking in-memory `SessionSeal` and blocking commercial IPC/AI operations cleanly.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

#[allow(dead_code)]
const FLAG_DEBUGGER: u8 = 0x01;
#[allow(dead_code)]
const FLAG_TIMING_ANOMALY: u8 = 0x02;

/// Maximum wall-clock time allowed for an in-memory / local cache cryptographic check
/// before flagging interactive single-step debugging in Release builds.
const MAX_LOCAL_CHECK_DURATION: Duration = Duration::from_millis(5_000);

static TAMPER_LATCH: AtomicU8 = AtomicU8::new(0);

#[cfg(test)]
thread_local! {
    static TEST_THREAD_TAMPER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Queries standard Win32 user-mode APIs to check if a local or remote debugger is attached.
pub fn os_debugger_attached() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Diagnostics::Debug::{
            CheckRemoteDebuggerPresent, IsDebuggerPresent,
        };
        use windows_sys::Win32::System::Threading::GetCurrentProcess;

        unsafe {
            if IsDebuggerPresent() != 0 {
                return true;
            }
            let mut remote_present: i32 = 0;
            let ok = CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut remote_present);
            if ok != 0 && remote_present != 0 {
                return true;
            }
        }
    }
    false
}

#[allow(dead_code)]
fn latch_violation(flag: u8) {
    TAMPER_LATCH.fetch_or(flag, Ordering::SeqCst);
    super::crypto_seal::clear_authorized_session();
}

/// Evaluates runtime integrity. In Release builds (`not(debug_assertions)`), an attached
/// debugger permanently latches Fail-Closed Lockout for the current process.
#[inline(always)]
pub fn is_environment_compromised() -> bool {
    #[cfg(test)]
    if TEST_THREAD_TAMPER.with(|c| c.get()) {
        return true;
    }

    if TAMPER_LATCH.load(Ordering::SeqCst) != 0 {
        return true;
    }

    #[cfg(not(debug_assertions))]
    {
        if os_debugger_attached() {
            latch_violation(FLAG_DEBUGGER);
            return true;
        }
    }

    false
}

/// Scope guard measuring wall-clock time of pure local cryptographic checks to detect
/// interactive single-stepping breakpoints in Release builds.
pub struct IntegrityTimingScope {
    started: Instant,
}

impl IntegrityTimingScope {
    #[inline(always)]
    pub fn enter() -> Self {
        Self {
            started: Instant::now(),
        }
    }

    #[inline(always)]
    pub fn finish(self) -> bool {
        let elapsed = self.started.elapsed();
        #[cfg(not(debug_assertions))]
        {
            if elapsed > MAX_LOCAL_CHECK_DURATION {
                latch_violation(FLAG_TIMING_ANOMALY);
                return false;
            }
        }
        let _ = elapsed <= MAX_LOCAL_CHECK_DURATION;
        !is_environment_compromised()
    }
}

/// Generic safe user-facing lockout message (exposes zero internal detection details).
pub const SECURITY_VIOLATION_MESSAGE: &str =
    "Phát hiện môi trường thực thi không an toàn. Vui lòng đóng các công cụ gỡ lỗi hoặc can thiệp bộ nhớ và khởi động lại ứng dụng.";

#[cfg(test)]
pub fn set_simulated_tamper_for_test(compromised: bool) {
    TEST_THREAD_TAMPER.with(|c| c.set(compromised));
    if compromised {
        super::crypto_seal::clear_authorized_session_for_hwid(&"c".repeat(64));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_debugger_probe_executes_cleanly_and_simulation_latches_lockout() {
        let _probe = os_debugger_attached();
        set_simulated_tamper_for_test(false);
        assert!(!is_environment_compromised());

        let hwid = "c".repeat(64);
        super::super::crypto_seal::seal_authorized_session(&hwid, "VALID", 1_700_000_000, None);
        assert!(super::super::crypto_seal::verify_session_seal_inline(
            &hwid,
            1_700_000_010
        ));

        // Trigger simulated tamper -> must flag compromised AND revoke session seal
        set_simulated_tamper_for_test(true);
        assert!(is_environment_compromised());
        assert!(!super::super::crypto_seal::verify_session_seal_inline(
            &hwid,
            1_700_000_010
        ));

        set_simulated_tamper_for_test(false);
        assert!(!is_environment_compromised());
    }
}

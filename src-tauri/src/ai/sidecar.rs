//! Host side of the VoxLab local AI sidecar protocol (see `sidecar/PROTOCOL.md`).
//!
//! One sidecar *process* per runtime (Python environment). Runtimes exist because the three
//! TTS engines pin mutually incompatible dependencies (torch / transformers), so each lives in
//! its own environment. Only one TTS model is resident in VRAM at a time: loading a TTS model
//! in one runtime first unloads TTS in every other running runtime.
//!
//! This module has no Tauri dependency so it can be exercised by `cargo test` against the real
//! sidecar process.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const READY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiError {
    pub code: String,
    pub message: String,
}

impl AiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub runtime: String,
    pub request_id: String,
    pub pct: f64,
    pub stage: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub runtime: String,
    pub pid: u32,
    pub alive: bool,
}

pub type ProgressSink = Arc<dyn Fn(ProgressEvent) + Send + Sync>;
pub type RuntimeResolver = Arc<dyn Fn(&str) -> Result<RuntimeSpec, AiError> + Send + Sync>;

type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, AiError>>>>>;

struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    alive: Arc<AtomicBool>,
    hard_cancelled: Arc<Mutex<HashSet<String>>>,
    pid: u32,
}

impl SidecarProcess {
    fn spawn(runtime: &str, spec: &RuntimeSpec, sink: ProgressSink) -> Result<Self, AiError> {
        if !spec.program.exists() {
            return Err(AiError::new(
                "SIDECAR_NOT_FOUND",
                format!("sidecar runtime '{}' not installed ({})", runtime, spec.program.display()),
            ));
        }
        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8");
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| AiError::new("SIDECAR_SPAWN_FAILED", format!("{}: {}", runtime, e)))?;
        let pid = child.id();
        let stdin = child.stdin.take().ok_or_else(|| AiError::new("SIDECAR_SPAWN_FAILED", "no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| AiError::new("SIDECAR_SPAWN_FAILED", "no stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| AiError::new("SIDECAR_SPAWN_FAILED", "no stderr"))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let hard_cancelled = Arc::new(Mutex::new(HashSet::new()));
        let (ready_tx, ready_rx) = mpsc::channel::<()>();

        // stdout reader: protocol lines only.
        {
            let pending = pending.clone();
            let alive = alive.clone();
            let hard_cancelled = hard_cancelled.clone();
            let runtime = runtime.to_string();
            std::thread::spawn(move || {
                let mut ready_tx = Some(ready_tx);
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        eprintln!("[ai:{}] dropped non-JSON stdout line", runtime);
                        continue;
                    };
                    let id = msg.get("id").and_then(Value::as_str).map(str::to_string);
                    match msg.get("event").and_then(Value::as_str) {
                        Some("ready") => {
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(());
                            }
                            continue;
                        }
                        Some("progress") => {
                            if let (Some(id), Some(data)) = (id, msg.get("data")) {
                                sink(ProgressEvent {
                                    runtime: runtime.clone(),
                                    request_id: id,
                                    pct: data.get("pct").and_then(Value::as_f64).unwrap_or(0.0),
                                    stage: data.get("stage").and_then(Value::as_str).unwrap_or("").to_string(),
                                });
                            }
                            continue;
                        }
                        _ => {}
                    }
                    let Some(id) = id else { continue };
                    let reply = if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                        Ok(msg.get("result").cloned().unwrap_or(json!({})))
                    } else {
                        let err = msg.get("error").cloned().unwrap_or(json!({}));
                        Err(AiError::new(
                            err.get("code").and_then(Value::as_str).unwrap_or("INTERNAL"),
                            err.get("message").and_then(Value::as_str).unwrap_or("unknown error"),
                        ))
                    };
                    if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(reply);
                    }
                }
                // EOF: process exited (crash, kill or shutdown). Fail every waiter.
                alive.store(false, Ordering::SeqCst);
                let cancelled = hard_cancelled.lock().unwrap().clone();
                for (id, tx) in pending.lock().unwrap().drain() {
                    let err = if cancelled.contains(&id) {
                        AiError::new("CANCELLED", "request cancelled (sidecar terminated)")
                    } else {
                        AiError::new("SIDECAR_CRASHED", "sidecar process exited unexpectedly")
                    };
                    let _ = tx.send(Err(err));
                }
            });
        }
        // stderr: diagnostics only (the sidecar never writes secrets or user text there).
        {
            let runtime = runtime.to_string();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("[ai:{}] {}", runtime, line);
                }
            });
        }

        let mut proc = SidecarProcess { child, stdin, pending, alive, hard_cancelled, pid };
        if ready_rx.recv_timeout(READY_TIMEOUT).is_err() {
            let _ = proc.child.kill();
            return Err(AiError::new("SIDECAR_TIMEOUT", format!("runtime '{}' did not become ready", runtime)));
        }
        Ok(proc)
    }

    fn is_alive(&mut self) -> bool {
        self.alive.load(Ordering::SeqCst) && matches!(self.child.try_wait(), Ok(None))
    }

    fn send(&mut self, msg: &Value) -> Result<(), AiError> {
        let line = serde_json::to_string(msg).map_err(|e| AiError::new("INTERNAL", e.to_string()))?;
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|_| AiError::new("SIDECAR_CRASHED", "sidecar stdin closed"))
    }
}

pub struct SidecarManager {
    runtimes: Mutex<HashMap<String, SidecarProcess>>,
    resolver: RuntimeResolver,
    sink: ProgressSink,
    counter: AtomicU64,
}

impl SidecarManager {
    pub fn new(resolver: RuntimeResolver, sink: ProgressSink) -> Self {
        Self { runtimes: Mutex::new(HashMap::new()), resolver, sink, counter: AtomicU64::new(0) }
    }

    pub fn next_request_id(&self) -> String {
        format!("rq-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1)
    }

    /// Sends a request and blocks until its terminal response (or process death).
    pub fn request(&self, runtime: &str, method: &str, params: Value, request_id: Option<String>) -> Result<Value, AiError> {
        if method == "tts.load" {
            self.unload_tts_elsewhere(runtime);
        }
        let id = request_id.unwrap_or_else(|| self.next_request_id());
        let rx = {
            let mut map = self.runtimes.lock().unwrap();
            let needs_spawn = match map.get_mut(runtime) {
                Some(p) => !p.is_alive(),
                None => true,
            };
            if needs_spawn {
                // Crash recovery: a dead process is replaced transparently on next use.
                map.remove(runtime);
                let spec = (self.resolver)(runtime)?;
                let proc = SidecarProcess::spawn(runtime, &spec, self.sink.clone())?;
                map.insert(runtime.to_string(), proc);
            }
            let proc = map.get_mut(runtime).expect("runtime present");
            let (tx, rx) = mpsc::channel();
            proc.pending.lock().unwrap().insert(id.clone(), tx);
            if let Err(e) = proc.send(&json!({"id": id, "method": method, "params": params})) {
                proc.pending.lock().unwrap().remove(&id);
                return Err(e);
            }
            rx
        };
        rx.recv().unwrap_or_else(|_| Err(AiError::new("SIDECAR_CRASHED", "reply channel closed")))
    }

    /// Soft cancel asks the sidecar to stop at its next checkpoint. Hard cancel terminates the
    /// process (for engine calls that cannot be interrupted); it is respawned on next use.
    pub fn cancel(&self, runtime: &str, request_id: &str, hard: bool) -> Result<bool, AiError> {
        let mut map = self.runtimes.lock().unwrap();
        let Some(proc) = map.get_mut(runtime) else { return Ok(false) };
        if !proc.pending.lock().unwrap().contains_key(request_id) {
            return Ok(false);
        }
        if hard {
            proc.hard_cancelled.lock().unwrap().insert(request_id.to_string());
            let _ = proc.child.kill();
        } else {
            let cancel_id = format!("{}-cancel", request_id);
            proc.send(&json!({"id": cancel_id, "method": "cancel", "params": {"target": request_id}}))?;
        }
        Ok(true)
    }

    pub fn shutdown(&self, runtime: &str) {
        let proc = self.runtimes.lock().unwrap().remove(runtime);
        if let Some(mut p) = proc {
            let _ = p.send(&json!({"id": "shutdown", "method": "system.shutdown", "params": {}}));
            for _ in 0..50 {
                if matches!(p.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = p.child.kill();
        }
    }

    pub fn shutdown_all(&self) {
        let names: Vec<String> = self.runtimes.lock().unwrap().keys().cloned().collect();
        for n in names {
            self.shutdown(&n);
        }
    }

    pub fn status(&self) -> Vec<RuntimeStatus> {
        let mut map = self.runtimes.lock().unwrap();
        map.iter_mut()
            .map(|(k, p)| RuntimeStatus { runtime: k.clone(), pid: p.pid, alive: p.is_alive() })
            .collect()
    }

    fn unload_tts_elsewhere(&self, target: &str) {
        let others: Vec<String> = {
            let mut map = self.runtimes.lock().unwrap();
            map.iter_mut()
                .filter_map(|(k, p)| (k.as_str() != target && p.is_alive()).then(|| k.clone()))
                .collect()
        };
        for rt in others {
            if let Err(e) = self.request(&rt, "tts.unload", json!({}), None) {
                eprintln!("[ai:{}] tts.unload before switch failed: {}", rt, e.code);
            }
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

/// Runtime id → Python environment directory name (dev) / sidecar binary name (prod).
pub const RUNTIMES: &[(&str, &str)] = &[("core", ".venv"), ("chatterbox", ".venv-chatterbox"), ("qwen", ".venv-qwen")];

/// Development resolver: `<repo>/sidecar/<venv>/Scripts/python.exe -m voxlab_sidecar --runtime <id>`.
/// Production resolver: `<exe dir>/voxlab-sidecar-<id>(.exe)` built with PyInstaller.
pub fn default_resolver(sidecar_root: Option<PathBuf>) -> RuntimeResolver {
    Arc::new(move |runtime: &str| {
        let venv = RUNTIMES
            .iter()
            .find(|(id, _)| *id == runtime)
            .map(|(_, v)| *v)
            .ok_or_else(|| AiError::new("INVALID_REQUEST", format!("unknown runtime '{}'", runtime)))?;
        if let Some(root) = &sidecar_root {
            let python = if cfg!(windows) {
                root.join(venv).join("Scripts").join("python.exe")
            } else {
                root.join(venv).join("bin").join("python")
            };
            return Ok(RuntimeSpec {
                program: python,
                args: vec!["-m".into(), "voxlab_sidecar".into(), "--runtime".into(), runtime.into()],
                cwd: Some(root.clone()),
            });
        }
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .ok_or_else(|| AiError::new("SIDECAR_NOT_FOUND", "cannot locate executable directory"))?;
        let name = format!("voxlab-sidecar-{}{}", runtime, if cfg!(windows) { ".exe" } else { "" });
        Ok(RuntimeSpec { program: exe_dir.join(name), args: vec![], cwd: Some(exe_dir) })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar")
    }

    fn manager(events: Arc<Mutex<Vec<ProgressEvent>>>) -> SidecarManager {
        let sink: ProgressSink = Arc::new(move |e| events.lock().unwrap().push(e));
        SidecarManager::new(default_resolver(Some(dev_root())), sink)
    }

    fn core_installed() -> bool {
        dev_root().join(".venv").exists()
    }

    #[test]
    fn unknown_runtime_is_structured_error() {
        let m = manager(Arc::new(Mutex::new(vec![])));
        let err = m.request("nope", "system.ping", json!({}), None).unwrap_err();
        assert_eq!(err.code, "INVALID_REQUEST");
    }

    #[test]
    fn missing_runtime_binary_reports_not_found() {
        let resolver: RuntimeResolver = Arc::new(|_| {
            Ok(RuntimeSpec { program: PathBuf::from("Z:/missing/python.exe"), args: vec![], cwd: None })
        });
        let m = SidecarManager::new(resolver, Arc::new(|_| {}));
        assert_eq!(m.request("core", "system.ping", json!({}), None).unwrap_err().code, "SIDECAR_NOT_FOUND");
    }

    /// Real process: ping, structured error, crash (kill) → SIDECAR_CRASHED → transparent respawn.
    #[test]
    fn real_sidecar_ping_crash_and_recovery() {
        if !core_installed() {
            eprintln!("SKIP: sidecar/.venv not present");
            return;
        }
        let m = manager(Arc::new(Mutex::new(vec![])));
        assert_eq!(m.request("core", "system.ping", json!({}), None).unwrap()["pong"], json!(true));
        let pid1 = m.status()[0].pid;

        let err = m.request("core", "no.such.method", json!({}), None).unwrap_err();
        assert_eq!(err.code, "UNKNOWN_METHOD");

        // Simulate a crash by killing the process out-of-band.
        {
            let mut map = m.runtimes.lock().unwrap();
            map.get_mut("core").unwrap().child.kill().unwrap();
        }
        std::thread::sleep(Duration::from_millis(300));
        assert!(!m.status()[0].alive);

        assert_eq!(m.request("core", "system.ping", json!({}), None).unwrap()["pong"], json!(true));
        let pid2 = m.status()[0].pid;
        assert_ne!(pid1, pid2, "sidecar must be respawned after crash");
        m.shutdown_all();
        assert!(m.status().is_empty());
    }

    /// Real process: an in-flight request fails with SIDECAR_CRASHED when the process dies,
    /// and with CANCELLED when the host hard-cancels it.
    #[test]
    fn real_sidecar_inflight_crash_and_hard_cancel() {
        if !core_installed() {
            eprintln!("SKIP: sidecar/.venv not present");
            return;
        }
        let m = Arc::new(manager(Arc::new(Mutex::new(vec![]))));
        m.request("core", "system.ping", json!({}), None).unwrap();
        let m2 = m.clone();
        let h = std::thread::spawn(move || {
            m2.request("core", "system.debug_sleep", json!({"seconds": 30}), Some("sleep-1".into()))
        });
        std::thread::sleep(Duration::from_millis(500));
        assert!(m.cancel("core", "sleep-1", true).unwrap());
        assert_eq!(h.join().unwrap().unwrap_err().code, "CANCELLED");

        let m3 = m.clone();
        let h = std::thread::spawn(move || {
            m3.request("core", "system.debug_sleep", json!({"seconds": 30}), Some("sleep-2".into()))
        });
        std::thread::sleep(Duration::from_millis(1500));
        {
            let mut map = m.runtimes.lock().unwrap();
            map.get_mut("core").unwrap().child.kill().unwrap();
        }
        assert_eq!(h.join().unwrap().unwrap_err().code, "SIDECAR_CRASHED");
        m.shutdown_all();
    }

    /// Real process: soft cancel is honoured cooperatively and the worker slot is reusable.
    #[test]
    fn real_sidecar_soft_cancel_and_progress() {
        if !core_installed() {
            eprintln!("SKIP: sidecar/.venv not present");
            return;
        }
        let events = Arc::new(Mutex::new(vec![]));
        let m = Arc::new(manager(events.clone()));
        m.request("core", "system.ping", json!({}), None).unwrap();
        let m2 = m.clone();
        let h = std::thread::spawn(move || {
            m2.request("core", "system.debug_sleep", json!({"seconds": 30}), Some("soft-1".into()))
        });
        std::thread::sleep(Duration::from_millis(1200));
        assert!(m.cancel("core", "soft-1", false).unwrap());
        assert_eq!(h.join().unwrap().unwrap_err().code, "CANCELLED");
        assert!(events.lock().unwrap().iter().any(|e| e.request_id == "soft-1" && e.stage == "sleeping"));
        let pid = m.status()[0].pid;
        m.request("core", "system.ping", json!({}), None).unwrap();
        assert_eq!(m.status()[0].pid, pid, "soft cancel must not restart the process");
        m.shutdown_all();
    }
}

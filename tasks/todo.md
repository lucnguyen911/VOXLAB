# VoxLab — Task Checklist (TODO.md)

**Document Version**: 2.0.1 (Micro Consistency Patch)  
**Status**: Initialized (Pending GATE C Approval)  
**Total Tasks**: 35  

---

## Milestone 1: Foundations, Storage Engine & Session Persistence
- [ ] **TASK-01**: Kiến trúc 4 Loại Đường dẫn & Cơ chế Bootstrap Data Root Discovery (RISK: MEDIUM)
- [ ] **TASK-02**: SQLite Storage Engine với Versioned Schema & Ordered Migrations (RISK: HIGH)
- [ ] **TASK-03**: Module Safe Data Root Migration (Copy -> Verify -> Activate/Rollback) (RISK: HIGH)
- [ ] **TASK-04**: Session, History & Chunk Cache Metadata Persistence Repository (RISK: MEDIUM)
- [ ] **TASK-05**: Secure Credential Storage Bridge cho Online Providers (RISK: MEDIUM)
- [ ] **TASK-06**: Logging & Diagnostics Implementation Module (RISK: LOW)

## Milestone 2: Early Model Feasibility & Calibration Track (Fail-Fast)
- [ ] **TASK-07**: Early Model Feasibility Spike: Đánh giá Candidate TTS Models trên Windows/CUDA (RISK: HIGH, USER APPROVAL REQUIRED: YES)
- [ ] **TASK-08**: faster-whisper Benchmark, Calibration & Auto-Selection Engine (RISK: MEDIUM)
- [ ] **TASK-09**: Online Voice Provider Feasibility & Terms/Legal Evaluation (RISK: MEDIUM, USER APPROVAL REQUIRED: YES)

## Milestone 3: Process Supervisor, Safe Queue & Worker IPC Interface
- [ ] **TASK-10**: Process Supervisor & Subprocess Lifecycle Manager (RISK: HIGH)
- [ ] **TASK-11**: Documented IPC Protocol & Capability/Version Handshake (RISK: MEDIUM)
- [ ] **TASK-12**: Safe Sequential Job Queue Orchestrator & Bounded Cancellation (RISK: HIGH)
- [ ] **TASK-13**: Hardware Diagnostics & Capability Inspection Module (RISK: LOW)

## Milestone 4: Model Discovery, Provisioning & Production Engine Adapters
- [ ] **TASK-14**: Model Discovery, Inspection & Registry Service (RISK: MEDIUM)
- [ ] **TASK-15**: Minimal User-Initiated Model Provisioning & Download Service (RISK: HIGH)
- [ ] **TASK-16**: faster-whisper Production Engine Adapter Integration (Media decode via FFmpeg, depends on TASK-13) (RISK: MEDIUM)
- [ ] **TASK-17**: Approved MVP TTS Model Set Adapter Integration (Requires TASK-07 + CHECKPOINT 1 APPROVED) (RISK: HIGH)
- [ ] **TASK-18**: Official Online Voice Provider Adapter Integration (Requires TASK-09 + CHECKPOINT 2 APPROVED) (RISK: MEDIUM)

## Milestone 5: Core Media & Text Pipelines
- [ ] **TASK-19**: Deterministic Text Normalization & Protected Spans Preservation (RISK: LOW)
- [ ] **TASK-20**: Smart Chunking Engine phân tầng theo Model Profile (RISK: MEDIUM)
- [ ] **TASK-21**: Local LLM Client (LM Studio Integration) & AI Text Actions (RISK: MEDIUM)
- [ ] **TASK-22**: Generic Translation Provider Architecture (Local LLM & Google Gemini API) (RISK: MEDIUM)
- [ ] **TASK-23**: Audio Stitching Pipeline & FFmpeg Concat Engine (RISK: MEDIUM)

## Milestone 6: Voice Profile & Voice Library Engine
- [ ] **TASK-24**: Managed Reference Audio Assets Engine (RISK: LOW)
- [ ] **TASK-25**: Voice Profile Repository & Stable Identity Management (RISK: LOW)
- [ ] **TASK-26**: Voice Library Business Logic & Safe Delete Orchestration (Requires TASK-25; TASK-18 conditional) (RISK: MEDIUM)

## Milestone 7: UI Architecture Pre-wiring & GATE D (Stitch UI/UX Gate)
- [ ] **TASK-27**: Pre-UI IPC Contracts, Domain DTOs & Typed Interfaces (RISK: LOW)
- [ ] **GATE-D**: *PHASE 6 — UI / UX DESIGN + PROTOTYPE GATE (STITCH PREFERRED)* (USER APPROVAL REQUIRED: YES)

## Milestone 8: Desktop Studio Frontend Implementation (Post-Gate D)
- [ ] **TASK-28**: Shell Layout, Top Bar, Collapsible Navigation & Bottom Job Bar (RISK: LOW)
- [ ] **TASK-29**: Workspace 1: Text to Speech Studio (Text Prep & Hybrid Chunk Studio) (RISK: HIGH)
- [ ] **TASK-30**: Workspace 2 & 3: Voice Clone & Voice Library (RISK: MEDIUM)
- [ ] **TASK-31**: Workspace 4: Standalone Transcription Studio (RISK: MEDIUM)
- [ ] **TASK-32**: Workspace 5 & 6: History & Settings (9 Nhóm chức năng) (RISK: MEDIUM)

## Milestone 9: System Hardening, Recovery & Production Packaging
- [ ] **TASK-33**: Basic Interrupted-Session Recovery & Cache Invalidation Verification (E2E) (RISK: HIGH)
- [ ] **TASK-34**: Offline Core Integrity, Zero Telemetry & Network Isolation Verification (RISK: MEDIUM)
- [ ] **TASK-35**: Production Packaging, Upgrade Migration & Downgrade Safety Verification (RISK: HIGH)

---

## Checkpoints & User Approval Gates
- [x] **GATE A**: Requirement Understanding (APPROVED)
- [x] **GATE B**: Specification (APPROVED, `SPEC.md` v2.4.0)
- [ ] **GATE C**: Implementation Plan (CURRENT GATE - PENDING USER APPROVAL)
- [ ] **CHECKPOINT 1 (Sau TASK-07)**: Báo cáo Thẩm định TTS Candidate Models $\rightarrow$ Mở khóa TASK-17
- [ ] **CHECKPOINT 2 (Sau TASK-09)**: Báo cáo Thẩm định Online Voice Providers $\rightarrow$ Mở khóa TASK-18 (hoặc Defer)
- [ ] **GATE D (Sau TASK-27)**: UI / UX Design & Prototype Gate (Stitch MCP)
- [ ] **GATE E**: High-Risk Change Gate (Nếu phát sinh)
- [ ] **GATE F**: Final Release Gate (Sau TASK-35)

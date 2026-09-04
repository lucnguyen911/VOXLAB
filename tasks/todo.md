# VoxLab — Task Checklist (TODO.md)

**Document Version**: 1.0.0  
**Status**: Initialized (Pending GATE C Approval)  
**Total Tasks**: 28  

---

## Milestone 1: Foundations, Storage Engine & Safe Data Migration
- [ ] **TASK-01**: Kiến trúc Lưu trữ 4 Đường dẫn & Cơ chế Bootstrap Data Root Discovery (RISK: MEDIUM)
- [ ] **TASK-02**: SQLite Storage Engine với Versioned Schema & Ordered Migrations (RISK: HIGH)
- [ ] **TASK-03**: Module Safe Data Root Migration (Copy -> Verify -> Activate/Rollback) (RISK: HIGH)
- [ ] **TASK-04**: Secure Credential Storage Bridge cho Online Providers (RISK: MEDIUM)

## Milestone 2: Process Supervisor, Safe Queue & Worker IPC Interface
- [ ] **TASK-05**: Process Supervisor & Subprocess Lifecycle Manager (RISK: HIGH)
- [ ] **TASK-06**: Documented IPC Protocol & Capability/Version Handshake (RISK: MEDIUM)
- [ ] **TASK-07**: Safe Sequential Job Queue Orchestrator & Bounded Cancellation (RISK: HIGH)
- [ ] **TASK-08**: Hardware Diagnostics & Capability Inspection Module (RISK: LOW)

## Milestone 3: Model Feasibility Spike & Primary Engine Adapters
- [ ] **TASK-09**: Model Feasibility Spike: Đánh giá Candidate TTS Models trên Windows/CUDA (RISK: HIGH, USER APPROVAL REQUIRED: YES)
- [ ] **TASK-10**: Adapter Tích hợp faster-whisper (Medium, Large V3, Large V3 Turbo & Auto) (RISK: MEDIUM)
- [ ] **TASK-11**: Adapter Tích hợp TTS Engine chính thức cho MVP (RISK: HIGH)

## Milestone 4: Core Text & Audio Stitching Pipelines
- [ ] **TASK-12**: Deterministic Text Normalization với Bảo vệ Protected Spans (RISK: LOW)
- [ ] **TASK-13**: Smart Chunking Engine phân tầng theo Model Profile (RISK: MEDIUM)
- [ ] **TASK-14**: Local LLM Client (LM Studio Integration) & AI Text Actions (RISK: MEDIUM)
- [ ] **TASK-15**: Generic Translation Provider Architecture (Local LLM & Google Gemini API) (RISK: MEDIUM)
- [ ] **TASK-16**: Audio Stitching Pipeline & FFmpeg Concat Engine (RISK: MEDIUM)

## Milestone 5: Voice Profile & Voice Library Engine
- [ ] **TASK-17**: Managed Reference Audio Assets Engine (RISK: LOW)
- [ ] **TASK-18**: Voice Profile Repository & Stable Identity Management (RISK: LOW)
- [ ] **TASK-19**: Voice Library Business Logic & Safe Delete Orchestration (RISK: MEDIUM)

## Milestone 6: UI / UX Design & Prototyping Gate (GATE D Pre-wiring)
- [ ] **TASK-20**: Chuẩn bị Kiến trúc Frontend, IPC Typings & State Stores (Pre-UI Gate) (RISK: MEDIUM)
- [ ] **GATE-D**: *PHASE 6 — UI / UX DESIGN + PROTOTYPE GATE (STITCH PREFERRED)* (USER APPROVAL REQUIRED: YES)

## Milestone 7: Desktop Studio Frontend Integration & Workflows
- [ ] **TASK-21**: Shell Layout, Top Bar, Collapsible Navigation & Bottom Job Bar (RISK: LOW)
- [ ] **TASK-22**: Workspace 1: Text to Speech Studio (Text Prep & Hybrid Chunk Studio) (RISK: HIGH)
- [ ] **TASK-23**: Workspace 2 & 3: Voice Clone & Voice Library (RISK: MEDIUM)
- [ ] **TASK-24**: Workspace 4: Standalone Transcription Studio (RISK: MEDIUM)
- [ ] **TASK-25**: Workspace 5 & 6: History & Settings (9 Nhóm chức năng) (RISK: MEDIUM)

## Milestone 8: System Hardening, Recovery & Packaging Verification
- [ ] **TASK-26**: Basic Interrupted-Session Recovery & Cache Invalidation Verification (RISK: HIGH)
- [ ] **TASK-27**: Offline Core Integrity, Zero Telemetry & Network Isolation Verification (RISK: MEDIUM)
- [ ] **TASK-28**: Application Update Schema Migration & Packaging Verification (RISK: HIGH)

---

## Checkpoints & Gates
- [x] **GATE A**: Requirement Understanding (APPROVED)
- [x] **GATE B**: Specification (APPROVED, `SPEC.md` v2.4.0)
- [ ] **GATE C**: Implementation Plan (CURRENT GATE - PENDING APPROVAL)
- [ ] **CHECKPOINT 1**: Hoàn thành Task 09 (Báo cáo Model Feasibility cho TTS Candidates)
- [ ] **GATE D**: UI / UX Design & Prototype Gate (Stitch MCP)
- [ ] **GATE E**: High-Risk Change Gate (Nếu phát sinh)
- [ ] **GATE F**: Final Release Gate

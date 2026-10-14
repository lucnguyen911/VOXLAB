import React, { useEffect, useRef } from "react";
import { isTauriRuntime } from "./ai/tauriBackend";

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "txt":
    case "md":
    case "srt":
    case "vtt":
      return "text/plain";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "webm":
      return "video/webm";
    case "avi":
      return "video/x-msvideo";
    default:
      return "application/octet-stream";
  }
}

function joinPath(dir: string, child: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${child}`;
}

/**
 * Recursively expands file and directory paths in Tauri desktop runtime into a flat list of file paths.
 */
export async function expandTauriPaths(paths: string[]): Promise<string[]> {
  if (!isTauriRuntime() || paths.length === 0) return paths;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result: string[] = [];

    const visit = async (p: string): Promise<void> => {
      try {
        const children = await invoke<string[]>("fs_list_dir", { path: p });
        if (Array.isArray(children) && children.length > 0) {
          for (const child of children) {
            await visit(joinPath(p, child));
          }
          return;
        }
      } catch {
        // Not a directory or cannot list; treat as file below
      }
      result.push(p);
    };

    for (const p of paths) {
      if (p) await visit(p);
    }
    return result;
  } catch {
    return paths;
  }
}

/**
 * Loads native file paths from Tauri drag-drop into standard File objects with `.path` attached.
 */
export async function loadFilesFromTauriPaths(paths: string[]): Promise<File[]> {
  const expanded = await expandTauriPaths(paths);
  if (expanded.length === 0) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const files: File[] = [];

  for (const filePath of expanded) {
    try {
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const stat = await invoke<{ size: number; mtimeMs: number } | null>("fs_stat", {
        path: filePath,
      }).catch(() => null);
      const lastModified = stat?.mtimeMs ? Math.round(stat.mtimeMs) : Date.now();
      const mimeType = guessMimeType(fileName);

      let file: File;
      if (["txt", "md", "srt", "vtt"].includes(ext)) {
        const text = await invoke<string>("fs_read_text", { path: filePath });
        file = new File([text], fileName, { type: mimeType, lastModified });
      } else {
        const rawBytes = await invoke<number[]>("fs_read_bytes", { path: filePath });
        const bytes = new Uint8Array(rawBytes);
        file = new File([bytes], fileName, { type: mimeType, lastModified });
      }

      try {
        Object.defineProperty(file, "path", {
          value: filePath,
          writable: false,
          configurable: true,
        });
      } catch {
        (file as any).path = filePath;
      }

      files.push(file);
    } catch (err) {
      console.warn("[fileDropHelper] Failed to read dropped file path:", filePath, err);
    }
  }

  return files;
}

/**
 * Utility to extract all files from a DragEvent or DataTransfer, seamlessly supporting
 * individual files, multiple files, and directory folders (via WebKit FileSystem Entry API).
 */
export async function extractFilesFromDropEvent(e: React.DragEvent): Promise<File[]> {
  const items = e.dataTransfer?.items;
  const collectedFiles: File[] = [];

  if (items && items.length > 0) {
    const readEntry = async (entry: any): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        return new Promise<void>((resolve) => {
          entry.file(
            (file: File) => {
              collectedFiles.push(file);
              resolve();
            },
            () => resolve()
          );
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        return new Promise<void>((resolve) => {
          dirReader.readEntries(
            async (entries: any[]) => {
              const promises: Promise<void>[] = [];
              for (const child of entries) {
                if (child.isFile) {
                  promises.push(
                    new Promise<void>((res) => {
                      child.file(
                        (f: File) => {
                          collectedFiles.push(f);
                          res();
                        },
                        () => res()
                      );
                    })
                  );
                } else if (child.isDirectory) {
                  promises.push(readEntry(child));
                }
              }
              await Promise.all(promises);
              resolve();
            },
            () => resolve()
          );
        });
      }
    };

    const promises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) {
        promises.push(readEntry(entry));
      }
    }
    await Promise.all(promises);
  }

  // Fallback if webkitGetAsEntry didn't collect anything or was not available
  if (collectedFiles.length === 0 && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      collectedFiles.push(e.dataTransfer.files[i]);
    }
  }

  return collectedFiles;
}

export interface TauriDropZoneOptions {
  enabled?: boolean;
  onDragStateChange?: (isOver: boolean) => void;
  onDropFiles?: (files: File[]) => void | Promise<void>;
  onDropPaths?: (paths: string[]) => void | Promise<void>;
}

interface RegisteredDropZone {
  id: number;
  getElement: () => HTMLElement | null;
  getOptions: () => TauriDropZoneOptions;
  isHovered: boolean;
}

let nextZoneId = 1;
const registeredZones = new Map<number, RegisteredDropZone>();
let globalListenerInitialized = false;
let lastHoveredZoneId: number | null = null;

function findHitZone(rawX: number, rawY: number): RegisteredDropZone | null {
  if (typeof window === "undefined") return null;
  const dpr = window.devicePixelRatio || 1;
  const cssX = rawX / dpr;
  const cssY = rawY / dpr;

  let bestZone: RegisteredDropZone | null = null;
  let bestArea = Infinity;

  for (const zone of registeredZones.values()) {
    const opts = zone.getOptions();
    if (opts.enabled === false) continue;
    const el = zone.getElement();
    if (!el || !el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const hitScaled =
      cssX >= rect.left && cssX <= rect.right && cssY >= rect.top && cssY <= rect.bottom;
    const hitRaw =
      dpr !== 1 &&
      rawX >= rect.left &&
      rawX <= rect.right &&
      rawY >= rect.top &&
      rawY <= rect.bottom;

    if (hitScaled || hitRaw) {
      const area = rect.width * rect.height;
      if (area <= bestArea) {
        bestArea = area;
        bestZone = zone;
      }
    }
  }

  return bestZone;
}

function clearAllHoverStates() {
  lastHoveredZoneId = null;
  for (const zone of registeredZones.values()) {
    if (zone.isHovered) {
      zone.isHovered = false;
      zone.getOptions().onDragStateChange?.(false);
    }
  }
}

function ensureGlobalTauriDragDropListener() {
  if (globalListenerInitialized || !isTauriRuntime()) return;
  globalListenerInitialized = true;

  import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) => {
      const webview = getCurrentWebview();
      return webview.onDragDropEvent(async (event) => {
        const payload = event.payload as {
          type: "enter" | "over" | "drop" | "leave";
          paths?: string[];
          position?: { x: number; y: number };
        };

        if (payload.type === "leave") {
          clearAllHoverStates();
          return;
        }

        if (payload.type === "enter" || payload.type === "over") {
          const pos = payload.position || { x: -1, y: -1 };
          const hit = findHitZone(pos.x, pos.y);
          lastHoveredZoneId = hit ? hit.id : null;

          for (const zone of registeredZones.values()) {
            const shouldHover = hit?.id === zone.id;
            if (zone.isHovered !== shouldHover) {
              zone.isHovered = shouldHover;
              zone.getOptions().onDragStateChange?.(shouldHover);
            }
          }
          return;
        }

        if (payload.type === "drop") {
          const pos = payload.position || { x: 0, y: 0 };
          let hit = findHitZone(pos.x, pos.y);
          if (!hit && lastHoveredZoneId !== null) {
            const fallback = registeredZones.get(lastHoveredZoneId);
            if (fallback && fallback.getOptions().enabled !== false) {
              hit = fallback;
            }
          }

          clearAllHoverStates();

          const paths = payload.paths || [];
          if (!hit || paths.length === 0) return;

          const opts = hit.getOptions();
          if (opts.onDropPaths) {
            await opts.onDropPaths(paths);
            return;
          }
          if (opts.onDropFiles) {
            const files = await loadFilesFromTauriPaths(paths);
            if (files.length > 0) {
              await opts.onDropFiles(files);
            }
          }
        }
      });
    })
    .catch((err) => {
      globalListenerInitialized = false;
      console.warn("[fileDropHelper] Could not attach Tauri onDragDropEvent listener:", err);
    });
}

/**
 * Hook that binds a specific allowed DOM container ref to Tauri's native window drag-drop
 * events (with exact coordinate hit-testing) so only drops inside the allowed zone are accepted.
 */
export function useTauriDropZone<T extends HTMLElement>(
  elementRef: React.RefObject<T | null>,
  options: TauriDropZoneOptions
): void {
  const optionsRef = useRef<TauriDropZoneOptions>(options);
  optionsRef.current = options;

  useEffect(() => {
    ensureGlobalTauriDragDropListener();
    const id = nextZoneId++;
    registeredZones.set(id, {
      id,
      getElement: () => elementRef.current,
      getOptions: () => optionsRef.current,
      isHovered: false,
    });

    return () => {
      const z = registeredZones.get(id);
      if (z?.isHovered) {
        z.getOptions().onDragStateChange?.(false);
      }
      registeredZones.delete(id);
      if (lastHoveredZoneId === id) {
        lastHoveredZoneId = null;
      }
    };
  }, [elementRef]);
}

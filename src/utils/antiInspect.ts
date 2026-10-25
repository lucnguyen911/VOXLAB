/**
 * Production WebView2 anti-inspection hardening (Security v3.1).
 *
 * Active strictly in production builds (`import.meta.env.PROD === true`) so local
 * development and automated browser verification with Chrome DevTools remain unobstructed.
 * Preserves standard text-editing shortcuts (Ctrl+C/V/X/A/Z) and context menus inside
 * editable inputs (`<input>`, `<textarea>`, `[contenteditable="true"]`).
 */

function isProductionEnv(): boolean {
  try {
    const metaEnv = (import.meta as unknown as { env?: { PROD?: boolean } })?.env;
    return metaEnv?.PROD === true;
  } catch {
    return false;
  }
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

let installed = false;

export function installProductionAntiInspect(): void {
  if (installed || typeof window === "undefined" || !isProductionEnv()) {
    return;
  }
  installed = true;

  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // Block F12 (DevTools) & F5 (arbitrary WebView reload)
      if (key === "F12" || key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+Shift+I / J / C / K (Inspector, Console, Element Picker)
      if (ctrlOrMeta && e.shiftKey && (key === "I" || key === "J" || key === "C" || key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+U (View Source), Ctrl+S (Save HTML), Ctrl+P (Print DOM), Ctrl+R (Reload)
      if (ctrlOrMeta && !e.shiftKey && (key === "U" || key === "S" || key === "P" || key === "R")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true }
  );

  window.addEventListener(
    "contextmenu",
    (e: MouseEvent) => {
      if (!isEditableElement(e.target)) {
        e.preventDefault();
      }
    },
    { capture: true }
  );
}

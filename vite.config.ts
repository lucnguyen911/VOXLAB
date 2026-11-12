import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import JavaScriptObfuscator from "javascript-obfuscator";

const nodeEnv = (
  globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const host = nodeEnv?.TAURI_DEV_HOST;

function voxlabProductionObfuscator(): Plugin {
  return {
    name: "voxlab-production-obfuscator",
    apply: "build",
    enforce: "post",
    renderChunk(code, chunk) {
      if (chunk.name === "vendor" || chunk.fileName.includes("vendor")) {
        return null;
      }
      const isHighSecurityChunk = chunk.name === "sec" || chunk.fileName.includes("sec-");
      const result = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        simplify: true,
        ignoreImports: true,
        target: "browser-no-eval",
        identifierNamesGenerator: "hexadecimal",
        renameGlobals: false,
        numbersToExpressions: false,
        splitStrings: false,
        stringArray: true,
        stringArrayEncoding: isHighSecurityChunk ? ["rc4"] : ["base64"],
        stringArrayThreshold: isHighSecurityChunk ? 0.9 : 0.35,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        stringArrayCallsTransform: isHighSecurityChunk,
        stringArrayCallsTransformThreshold: isHighSecurityChunk ? 0.75 : 0,
        forceTransformStrings: [
          "ai_",
          "fs_",
          "license",
          "update",
          "sidecar",
          "supabase",
          "whisper",
          "omnivoice",
          "chatterbox",
          "qwen",
          "kokoro",
        ],
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        sourceMap: false,
      });
      return {
        code: result.getObfuscatedCode(),
        map: null,
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === "production" ? [voxlabProductionObfuscator()] : []),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Security v3.2: zero sourcemaps, strip debugger & legal comments, obfuscate app chunks in production
  esbuild:
    mode === "production"
      ? {
          drop: ["debugger"],
          legalComments: "none",
        }
      : undefined,
  build: {
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
          if (
            id.includes("services/license") ||
            id.includes("services\\license") ||
            id.includes("services/updater") ||
            id.includes("services\\updater") ||
            id.includes("tauriBackend") ||
            id.includes("geminiKeyStore")
          ) {
            return "sec";
          }
        },
      },
    },
  },
}));

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
        stringArrayEncoding: ["rc4"],
        stringArrayThreshold: 0.95,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.75,
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
        },
      },
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const nodeEnv = (
  globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const host = nodeEnv?.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react()],

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

  // Security v3.1: zero sourcemaps, strip debugger & legal comments in production bundles
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
  },
}));

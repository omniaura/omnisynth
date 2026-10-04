import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import electron from "vite-plugin-electron/simple";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    solid(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: { external: ["electron"] },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            // CJS: Electron loads ESM preloads asynchronously, so the renderer
            // could boot before window.omnisynth exists.
            rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "preload.cjs" } },
          },
        },
      },
    }),
  ],
  // Electron loads the renderer from file:// in production, so assets must be relative.
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});

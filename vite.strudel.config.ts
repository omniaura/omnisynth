import { defineConfig } from "vite";
export default defineConfig({
  root: "strudel",
  base: "/strudel/",
  build: { outDir: "../dist/strudel", emptyOutDir: true, target: "es2022" },
});

import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { createAsrMiddleware } from "./server/asr-middleware.mjs";
import {
  copyVadAssets,
  createVadAssetMiddleware,
} from "./server/vad-assets.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "resonance-vad-assets",
      configureServer(server) {
        server.middlewares.use(createVadAssetMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createVadAssetMiddleware());
      },
      async closeBundle() {
        await copyVadAssets(path.resolve(__dirname, "dist/vad"));
      },
    },
    {
      name: "resonance-asr-server",
      configureServer(server) {
        server.middlewares.use(createAsrMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createAsrMiddleware());
      },
    },
    react(),
    tailwindcss(),
    viteSingleFile(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

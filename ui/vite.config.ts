import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { createBackendMiddleware } from "./server/backend-middleware.mjs";
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
      name: "resonance-backend-server",
      configureServer(server) {
        server.middlewares.use(createBackendMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createBackendMiddleware());
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

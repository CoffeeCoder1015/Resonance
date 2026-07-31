import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-pill',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(directory, 'pill.html')
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(directory, 'src')
    }
  }
});

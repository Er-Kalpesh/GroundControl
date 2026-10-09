import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/dashboard', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:9876', '/healthz': 'http://127.0.0.1:9876' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: false },
});

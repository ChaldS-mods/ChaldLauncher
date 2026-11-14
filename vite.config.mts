import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${root}src/renderer`,
  base: './',
  plugins: [react()],
  build: {
    outDir: `${root}dist/renderer`,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: `${root}src/renderer/index.html`,
        overlay: `${root}src/renderer/overlay.html`,
      },
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    root,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

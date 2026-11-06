import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  resolve: {
    // use the shared TypeScript source directly (ESM), not the CommonJS build used by the API
    alias: { '@gitcity/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
});

import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { port: 5190, strictPort: true },
  preview: { port: 4190, strictPort: true },
  build: { target: 'es2022' },
  worker: { format: 'iife' },
});

import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // important for Electron
  server: {
    port: 5173
  }
});

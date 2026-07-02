import { defineConfig } from 'vite';
import { warspaceMultiplayerPlugin } from './vite-plugin-warspace-mp.js';

export default defineConfig({
  base: './',
  plugins: [warspaceMultiplayerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,
  },
});

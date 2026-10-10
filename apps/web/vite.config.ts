import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { vendorAssets, vendorFiles } from './vendorAssets';

const vendor = vendorFiles(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  plugins: [react(), vendorAssets(vendor.files)],
  define: {
    __VENDOR_PATHS__: JSON.stringify(vendor.paths),
  },
  build: {
    // The big-screen chunk carries three.js and the post-processing effects (~280 kB gzipped);
    // phones never load it.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // Phones reach the dev server through a cloudflared quick tunnel.
    allowedHosts: ['.trycloudflare.com'],
  },
});

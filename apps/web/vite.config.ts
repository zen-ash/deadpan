import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Phones reach the dev server through a cloudflared quick tunnel.
    allowedHosts: ['.trycloudflare.com'],
  },
});

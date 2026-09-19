import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The studio is a local tool, not a deployment. It binds to localhost and
 * talks to the local API on 5174; there is no base path and no service worker
 * because it is never published anywhere.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  define: {
    __STUDIO_API__: JSON.stringify(process.env.REFRAIN_STUDIO_API ?? 'http://127.0.0.1:5174'),
  },
});

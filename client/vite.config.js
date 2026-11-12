// Vite config: React plugin and a dev proxy so the browser talks to one origin.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // The browser only ever calls localhost:5173. Vite forwards /api to the API, so the session
    // cookie is first-party (same origin) and no CORS preflight is needed. Production does the
    // same with a Vercel rewrite.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  test: {
    // A browser-like DOM for React Testing Library.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
});

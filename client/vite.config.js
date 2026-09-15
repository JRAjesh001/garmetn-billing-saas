import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev mode: Vite serves the React app on :5173 and proxies /api to Express (:3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});

import { defineConfig } from "vite";

const backend = process.env.VITE_BACKEND_URL || "http://localhost:8787";

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true
      },
      "/health": {
        target: backend,
        changeOrigin: true
      }
    }
  }
});

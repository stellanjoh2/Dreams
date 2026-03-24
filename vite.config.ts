import { defineConfig } from 'vite';

/** GitHub Pages project URL: https://<user>.github.io/<repo>/ */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Dreams/' : '/',
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
}));

import { defineConfig } from 'vite';

/** GitHub Pages project URL: https://<user>.github.io/<repo>/ */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Dreams/' : '/',
  server: {
    /**
     * Bind explicitly — `host: true` makes Vite call `os.networkInterfaces()`, which throws in some
     * sandboxes and can break `npm run dev` entirely. Use `npm run dev:lan` when you need other devices.
     */
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
}));

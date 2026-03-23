import { defineConfig } from 'vite';

/** GitHub Pages project URL: https://<user>.github.io/<repo>/ */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Dreams/' : '/',
}));

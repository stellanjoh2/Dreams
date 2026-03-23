/**
 * Resolve a path to a file in `public/` for the current deploy base
 * (`/` locally, `/Dreams/` on GitHub Pages).
 */
export function publicUrl(rootRelativePath: string): string {
  const trimmed = rootRelativePath.startsWith('/') ? rootRelativePath.slice(1) : rootRelativePath;
  const base = import.meta.env.BASE_URL;
  return `${base}${trimmed}`;
}

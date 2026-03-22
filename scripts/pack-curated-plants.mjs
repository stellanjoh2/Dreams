/**
 * Converts every `public/plants/curated-src/*.gltf` into a single embedded
 * `public/plants/curated/*.glb` (textures + bin inlined). Run after editing sources in Blender.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'public/plants/curated-src');
const outDir = join(root, 'public/plants/curated');
mkdirSync(outDir, { recursive: true });

const inputs = readdirSync(srcDir).filter((f) => f.endsWith('.gltf'));
if (inputs.length === 0) {
  console.error('No .gltf files in', srcDir);
  process.exit(1);
}

for (const name of inputs) {
  const inPath = join(srcDir, name);
  const outPath = join(outDir, name.replace(/\.gltf$/i, '.glb'));
  console.log('pack:', name, '→', outPath.replace(root + '/', ''));
  execSync(`npx --yes @gltf-transform/cli@4 copy "${inPath}" "${outPath}"`, {
    stdio: 'inherit',
    cwd: root,
  });
}
console.log('Done. Loaded at runtime from /plants/curated/*.glb');

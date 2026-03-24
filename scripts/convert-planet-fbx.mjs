/**
 * Converts selected FBX planets to GLB using FBX2glTF (see `fbx2gltf` devDependency).
 * Usage: node scripts/convert-planet-fbx.mjs
 */
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const convert = require('fbx2gltf');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'public/assets/planets_lowpoly_fbx');
const outDir = join(root, 'public/assets/planets_lowpoly_glb');

/** Source FBX indices → output basename (no extension). */
const PICKS = [
  [5, 'planet_05'],
  [14, 'planet_14'],
  [22, 'planet_22'],
  [33, 'planet_33'],
  [41, 'planet_41'],
];

mkdirSync(outDir, { recursive: true });

for (const [id, name] of PICKS) {
  const src = join(srcDir, `${id}.fbx`);
  const dest = join(outDir, `${name}.glb`);
  await convert(src, dest, []);
  console.log('wrote', dest);
}

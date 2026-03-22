#!/usr/bin/env node
/**
 * Print animation clip names from a .glb (JSON chunk).
 * Usage: node scripts/list-glb-animations.mjs [path/to/file.glb]
 * Default: public/assets/low_poly_cactus_enemy.glb
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const defaultGlb = path.join(root, 'public/assets/low_poly_cactus_enemy.glb');
const target = path.resolve(process.argv[2] ?? defaultGlb);

if (!fs.existsSync(target)) {
  console.error('File not found:', target);
  process.exit(1);
}

const buf = fs.readFileSync(target);
if (buf.toString('ascii', 0, 4) !== 'glTF') {
  console.error('Not a GLB (missing glTF magic).');
  process.exit(1);
}

const jsonChunkLength = buf.readUInt32LE(12);
const jsonStart = 20;
const jsonBytes = buf.subarray(jsonStart, jsonStart + jsonChunkLength);
const text = new TextDecoder('utf-8').decode(jsonBytes);
let gltf;
try {
  gltf = JSON.parse(text);
} catch {
  console.error('Failed to parse GLB JSON chunk.');
  process.exit(1);
}

const anims = gltf.animations ?? [];
console.log('File:', target);
console.log('Animations:', anims.length);
anims.forEach((a, i) => {
  const name = a.name ?? '';
  const ch = Array.isArray(a.channels) ? a.channels.length : 0;
  console.log(`  [${i}] "${name}" (${ch} channels)`);
});

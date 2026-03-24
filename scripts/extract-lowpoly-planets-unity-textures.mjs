/**
 * Pulls PNG textures from `lowpoly_planets.unitypackage` (gzip tar of GUID folders).
 * Unity stores each imported PNG as raw bytes in `<guid>/asset` with path in `<guid>/pathname`.
 *
 * Usage: node scripts/extract-lowpoly-planets-unity-textures.mjs
 */
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const unityPackage = join(root, 'public/assets/lowpoly_planets.unitypackage');
const outDir = join(root, 'public/assets/planets_lowpoly_textures');
const tmpDir = join(root, 'public/assets/_unitypackage_extract_tmp');

if (!existsSync(unityPackage)) {
  console.error('Missing', unityPackage);
  process.exit(1);
}

mkdirSync(tmpDir, { recursive: true });
execFileSync('tar', ['-xzf', unityPackage, '-C', tmpDir], { stdio: 'inherit' });

const entries = readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory());
const wanted = new Map([
  ['Assets/Lowpoly Planets by Ake Studio/textures/Base Color.png', 'base_color.png'],
  ['Assets/Lowpoly Planets by Ake Studio/textures/Emission.png', 'emission.png'],
]);

for (const { name: guid } of entries) {
  const dir = join(tmpDir, guid);
  const pn = join(dir, 'pathname');
  const asset = join(dir, 'asset');
  if (!existsSync(pn) || !existsSync(asset)) {
    continue;
  }
  const pathText = readFileSync(pn, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const outName = wanted.get(pathText);
  if (!outName) {
    continue;
  }
  const buf = readFileSync(asset);
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    console.warn('Skip (not PNG):', pathText);
    continue;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, outName), buf);
  console.log('wrote', join('public/assets/planets_lowpoly_textures', outName), `(${buf.length} bytes)`);
}

execFileSync('rm', ['-rf', tmpDir], { stdio: 'inherit' });

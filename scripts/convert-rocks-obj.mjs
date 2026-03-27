/**
 * Converts `public/assets/free_pack_rocks_stylized.obj` → `free_pack_rocks_stylized.glb` via obj2gltf.
 * Requires network once for npx. Run: node scripts/convert-rocks-obj.mjs
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const objPath = path.join(root, 'public/assets/free_pack_rocks_stylized.obj');
const outPath = path.join(root, 'public/assets/free_pack_rocks_stylized.glb');

execSync(`npx --yes obj2gltf -i "${objPath}" -o "${outPath}"`, {
  stdio: 'inherit',
  cwd: root,
});

#!/usr/bin/env node
/**
 * Split `public/assets/stylized_low_poly_trees_pack_02.glb` into solo hero GLBs
 * (palms + weird/alien props), skipping pines and tiny clutter.
 *
 * Usage:
 *   npm run trees:extract
 *   npm run trees:extract -- --list          # print root names + world max dimension
 *   npm run trees:extract -- /path/to/pack.glb
 *
 * Outputs to `public/plants/trees-curated/*.glb` and `manifest.json` (filenames for docs).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** GLTFLoader image path uses `self` in some three releases — Node has no `self`. */
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DEFAULT_PACK = path.join(root, 'public/assets/stylized_low_poly_trees_pack_02.glb');
const OUT_DIR = path.join(root, 'public/plants/trees-curated');

const PINE = /pine|spruce|fir|conifer|needle|christmas|xmas|winter[_\s-]*tree|snow[_\s-]*tree/i;
const TINY_HINT = /\b(small|tiny|mini|xs|micro|ground|deco|rock|pebble|patch)\b/i;

/** Slots = stable output filenames; each picks the largest unused mesh root that matches. */
const SLOTS = [
  {
    out: 'solo-palm-curved.glb',
    pred: (n) => /palm|coco|areca|frond/i.test(n) && /curve|bend|lean|arc|tilt|slant/i.test(n),
  },
  {
    out: 'solo-palm-broad.glb',
    pred: (n) =>
      /palm|coco|areca|frond/i.test(n) && (/broad|fan|wide|big|round|star|disk|parasol/i.test(n) || /leaf|leaves/i.test(n)),
  },
  {
    out: 'solo-palm-generic.glb',
    pred: (n) => /palm|coco|areca|frond|tropic/i.test(n) && !PINE.test(n),
  },
  {
    out: 'solo-alien-jelly.glb',
    pred: (n) => /jelly|tentacle|squid|medusa|undersea|sea/i.test(n),
  },
  {
    out: 'solo-alien-orb.glb',
    pred: (n) => /\borg\b|glow|bulb|lantern|lamp|light|neon|lumin/i.test(n),
  },
  {
    out: 'solo-alien-crystal.glb',
    pred: (n) => /crystal|gem|shard|ice|succulent|geode/i.test(n),
  },
  {
    out: 'solo-alien-mushroom.glb',
    pred: (n) => /mushroom|shroom|fung|toadstool/i.test(n),
  },
  {
    out: 'solo-alien-weird-flora.glb',
    pred: (n) =>
      /coral|anemone|alien|fantasy|magic|blob|ufo|weird|mutant|ooze|slime|venus|flytrap|helicon|protea|star/i.test(
        n,
      ),
  },
];

function subtreeHasMesh(o) {
  let ok = false;
  o.traverse((c) => {
    if (c.isMesh && c.geometry) {
      ok = true;
    }
  });
  return ok;
}

function worldMaxDim(o) {
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) {
    return 0;
  }
  const s = box.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z);
}

function worldXZFootprint(o) {
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) {
    return 0;
  }
  const s = box.getSize(new THREE.Vector3());
  return Math.max(s.x, s.z);
}

function worldXZSpreadOfObjectCenters(children) {
  if (children.length < 2) {
    return 0;
  }
  const xs = [];
  const zs = [];
  for (const c of children) {
    c.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(c);
    if (b.isEmpty()) {
      continue;
    }
    const ctr = b.getCenter(new THREE.Vector3());
    xs.push(ctr.x);
    zs.push(ctr.z);
  }
  if (xs.length < 2) {
    return 0;
  }
  const xr = Math.max(...xs) - Math.min(...xs);
  const zr = Math.max(...zs) - Math.min(...zs);
  return Math.max(xr, zr);
}

function isSceneJunk(c) {
  return c.isLight === true || c.type === 'PerspectiveCamera' || c.type === 'OrthographicCamera';
}

function meshBearingChildren(parent) {
  return parent.children.filter((c) => !isSceneJunk(c) && subtreeHasMesh(c));
}

function countMeshesInSubtree(root) {
  let n = 0;
  root.traverse((c) => {
    if (c.isMesh && c.geometry) {
      n += 1;
    }
  });
  return n;
}

function medianSorted(sorted) {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length * 0.5);
  return sorted[mid] ?? sorted[0];
}

/** Match `treePackFallback.ts` — keep extract and runtime in sync. */
function looksLikeShelfOfProps(parent, meshKids) {
  if (meshKids.length < 5) {
    return false;
  }
  parent.updateWorldMatrix(true, true);
  const pFoot = worldXZFootprint(parent);
  const spread = worldXZSpreadOfObjectCenters(meshKids);
  const dims = meshKids.map(worldMaxDim).filter((d) => d > 1e-9);
  if (dims.length === 0) {
    return false;
  }
  dims.sort((a, b) => a - b);
  const medianDim = medianSorted(dims);
  const loosePack = pFoot > medianDim * 2.0;
  const centersSpread = spread > medianDim * 1.65;
  const coversPlate = spread > pFoot * 0.18;
  return loosePack && centersSpread && coversPlate;
}

function shouldBurstIntoSeparateProps(n, meshKids) {
  if (meshKids.length < 5) {
    return false;
  }
  if (looksLikeShelfOfProps(n, meshKids)) {
    return true;
  }
  if (meshKids.length < 6) {
    return false;
  }
  const pDim = worldMaxDim(n);
  if (pDim < 0.02) {
    return false;
  }
  let smallerThanParent = 0;
  for (const c of meshKids) {
    const d = worldMaxDim(c);
    if (d <= pDim * 0.82) {
      smallerThanParent += 1;
    }
  }
  return smallerThanParent >= Math.max(4, Math.ceil(meshKids.length * 0.5));
}

function emergencySplitMegaRoot(root) {
  const mk = meshBearingChildren(root);
  if (mk.length < 3) {
    return [root];
  }
  const meshCount = countMeshesInSubtree(root);
  if (meshCount < 18) {
    return [root];
  }
  const dim = worldMaxDim(root);
  const maxChildDim = Math.max(...mk.map(worldMaxDim));
  if (dim > maxChildDim * 2.2) {
    return mk;
  }
  return [root];
}

function flattenPackSceneToSeparateProps(scene) {
  let layer = scene.children.filter((c) => !isSceneJunk(c) && subtreeHasMesh(c));

  for (let iter = 0; iter < 22; iter += 1) {
    let changed = false;

    while (layer.length === 1) {
      const only = layer[0];
      if (!only || !subtreeHasMesh(only)) {
        break;
      }
      const mk = meshBearingChildren(only);
      if (mk.length === 0) {
        break;
      }
      if (mk.length === 1) {
        layer = mk;
        changed = true;
        continue;
      }
      if (looksLikeShelfOfProps(only, mk)) {
        layer = mk;
        changed = true;
        break;
      }
      break;
    }

    const next = [];
    let burstAny = false;
    for (const n of layer) {
      if (!subtreeHasMesh(n)) {
        continue;
      }
      const mk = meshBearingChildren(n);
      if (shouldBurstIntoSeparateProps(n, mk)) {
        next.push(...mk);
        burstAny = true;
        changed = true;
      } else {
        next.push(n);
      }
    }
    if (burstAny) {
      layer = next;
    }

    if (!changed) {
      break;
    }
  }

  let out = layer.filter((c) => subtreeHasMesh(c));
  if (out.length === 1) {
    out = emergencySplitMegaRoot(out[0]);
  }
  return out.filter((c) => subtreeHasMesh(c));
}

function collectRoots(scene) {
  const individuals = flattenPackSceneToSeparateProps(scene);
  const out = [];
  for (const o of individuals) {
    if (!subtreeHasMesh(o)) {
      continue;
    }
    const n = (o.name || '').trim() || 'Unnamed';
    if (PINE.test(n)) {
      continue;
    }
    const dim = worldMaxDim(o);
    if (dim <= 1e-6) {
      continue;
    }
    out.push({ obj: o, name: n, maxDim: dim });
  }
  return out;
}

async function loadGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const loader = new GLTFLoader();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(
      ab,
      '',
      (gltf) => resolve(gltf),
      (err) => reject(err),
    );
  });
}

async function exportRootGlb(object3d, outPath) {
  const scene = new THREE.Scene();
  scene.name = 'CuratedTree';
  const clone = object3d.clone(true);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);
  scene.add(clone);

  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error('GLTFExporter did not return binary'));
        }
      },
      (err) => reject(err),
      { binary: true },
    );
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
}

function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const packArg = argv.find((a) => !a.startsWith('--'));
  const packPath = path.resolve(packArg ?? DEFAULT_PACK);

  if (!fs.existsSync(packPath)) {
    console.error('Pack not found:', packPath);
    console.error('Copy stylized_low_poly_trees_pack_02.glb to public/assets/ (see public/assets/README.md).');
    process.exit(1);
  }

  return loadGlb(packPath).then(async (gltf) => {
    const roots = collectRoots(gltf.scene);
    if (roots.length === 0) {
      console.error('No mesh roots found under scene (check GLB structure).');
      process.exit(1);
    }

    roots.sort((a, b) => b.maxDim - a.maxDim);
    const globalMax = roots[0].maxDim;
    const minDim = Math.max(globalMax * 0.28, 0.35);

    const sized = roots.filter((r) => r.maxDim >= minDim && !TINY_HINT.test(r.name));
    if (sized.length === 0) {
      console.warn('Size filter removed all roots; using top 12 by dimension instead.');
    }
    const pool = sized.length > 0 ? sized : roots.slice(0, 12);

    if (listOnly) {
      console.log('Pack:', packPath);
      console.log('Roots (name | world maxDim):');
      for (const r of roots.sort((a, b) => b.maxDim - a.maxDim)) {
        console.log(`  ${r.maxDim.toFixed(3)}\t${r.name}`);
      }
      console.log(`\nminDim cutoff used for export: ${minDim.toFixed(3)} (global max ${globalMax.toFixed(3)})`);
      return;
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const used = new Set();
    const written = [];

    for (const slot of SLOTS) {
      const hits = pool
        .filter((r) => !used.has(r.obj.uuid) && slot.pred(r.name.toLowerCase()))
        .sort((a, b) => b.maxDim - a.maxDim);
      const pick = hits[0];
      if (!pick) {
        console.warn('[skip]', slot.out, '— no matching root (see --list for names)');
        continue;
      }
      used.add(pick.obj.uuid);
      const outPath = path.join(OUT_DIR, slot.out);
      await exportRootGlb(pick.obj, outPath);
      written.push(slot.out);
      console.log('wrote', path.relative(root, outPath), '<-', pick.name, `(${pick.maxDim.toFixed(2)})`);
    }

    if (written.length === 0) {
      console.error('No slots matched. Run: npm run trees:extract -- --list');
      console.error('Then adjust SLOTS predicates in scripts/extract-curated-trees.mjs to match your mesh names.');
      process.exit(1);
    }

    const manifestPath = path.join(OUT_DIR, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(written, null, 2)}\n`);
    console.log('\nWrote manifest:', path.relative(root, manifestPath));
    console.log('Done. Runtime loads from /plants/trees-curated/*.glb');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

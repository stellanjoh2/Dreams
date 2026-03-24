import * as THREE from 'three';

const PINE = /pine|spruce|fir|conifer|needle|christmas|xmas|winter[_\s-]*tree|snow[_\s-]*tree/i;
const TINY_HINT = /\b(small|tiny|mini|xs|micro|ground|pebble|patch|cluster)\b/i;

function subtreeHasMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry) {
      found = true;
    }
  });
  return found;
}

function isSceneJunk(c: THREE.Object3D): boolean {
  return (
    (c as THREE.Light).isLight === true ||
    c.type === 'PerspectiveCamera' ||
    c.type === 'OrthographicCamera'
  );
}

function meshBearingChildren(parent: THREE.Object3D): THREE.Object3D[] {
  return parent.children.filter((c) => !isSceneJunk(c) && subtreeHasMesh(c));
}

function countMeshesInSubtree(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry) {
      n += 1;
    }
  });
  return n;
}

export function worldMaxDim(o: THREE.Object3D): number {
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) {
    return 0;
  }
  const s = box.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z);
}

function worldXZFootprint(o: THREE.Object3D): number {
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) {
    return 0;
  }
  const s = box.getSize(new THREE.Vector3());
  return Math.max(s.x, s.z);
}

/** Max XZ span between child world AABB centers — large for vendor “showroom” grids, small for one composite tree. */
function worldXZSpreadOfObjectCenters(children: THREE.Object3D[]): number {
  if (children.length < 2) {
    return 0;
  }
  const xs: number[] = [];
  const zs: number[] = [];
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

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length * 0.5);
  return sorted[mid] ?? sorted[0]!;
}

/**
 * True when `meshKids` look like separate props laid out on a large plate (vendor pack),
 * not a single hero made of a few sub-meshes.
 */
function looksLikeShelfOfProps(parent: THREE.Object3D, meshKids: THREE.Object3D[]): boolean {
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

function shouldBurstIntoSeparateProps(n: THREE.Object3D, meshKids: THREE.Object3D[]): boolean {
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

/** Last resort: one huge node with many direct children — split into those children. */
function emergencySplitMegaRoot(root: THREE.Object3D): THREE.Object3D[] {
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

/**
 * Vendor packs often ship as **nested** groups holding a grid of props.
 * Drill single-child chains, then burst shelves that pass spatial / count heuristics.
 */
export function flattenPackSceneToSeparateProps(scene: THREE.Object3D): THREE.Object3D[] {
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

    const next: THREE.Object3D[] = [];
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
    out = emergencySplitMegaRoot(out[0]!);
  }
  return out.filter((c) => subtreeHasMesh(c));
}

/**
 * Curated GLBs should be solo, but bad exports / manual copies can still contain a mini-pack.
 * Returns one Object3D to pass into `createNormalizedPlantVariant`.
 */
export function pickLargestSoloTreeSource(scene: THREE.Object3D): THREE.Object3D {
  const picks = extractLargeSoloTreeTemplates(scene, 1);
  if (picks.length > 0) {
    return picks[0]!;
  }
  const flat = flattenPackSceneToSeparateProps(scene);
  if (flat.length === 0) {
    return scene;
  }
  flat.sort((a, b) => worldMaxDim(b) - worldMaxDim(a));
  return flat[0]!;
}

/**
 * Pack fallback: alien / colourful props; skip pines and palm-y names when the author named them.
 * The stylized numbered pack (`Tree033_32`, …) matches via `tree` prefix so we still get variety.
 */
export function isPreferredScatterTreeFromPackName(rawName: string): boolean {
  const n = rawName.trim().toLowerCase();
  if (PINE.test(n)) {
    return false;
  }
  if (/^tree[\w]*$/i.test(n) || /^tree_/i.test(n)) {
    return true;
  }
  if (/palm|coco|areca|frond|broad|parasol|banana|fern/i.test(n)) {
    return false;
  }
  return /jelly|tentacle|squid|medusa|orb|mushroom|shroom|fung|crystal|gem|shard|ice\b|geode|alien|fantasy|coral|anemone|glow|neon|flower|blossom|flora|petal|pink|magenta|red\b|crimson|venus|flytrap|magic|blob|ufo|ooze|slime|lantern|lamp|light/i.test(
    n,
  );
}

export type ExtractLargeSoloTreeOptions = {
  /** If set, prefer roots whose names pass this test; if none match, falls back to unfiltered pool. */
  namePred?: (meshRootName: string) => boolean;
};

/**
 * When curated solo GLBs are missing, pick **individual** large trees from the monolithic pack.
 */
export function extractLargeSoloTreeTemplates(
  scene: THREE.Object3D,
  maxCount = 8,
  options?: ExtractLargeSoloTreeOptions,
): THREE.Object3D[] {
  const individuals = flattenPackSceneToSeparateProps(scene);
  if (individuals.length === 0) {
    return [];
  }

  const scored = individuals
    .map((obj) => {
      const n = (obj.name || '').trim().toLowerCase();
      if (PINE.test(n)) {
        return null;
      }
      const dim = worldMaxDim(obj);
      if (dim <= 1e-6) {
        return null;
      }
      let bonus = 0;
      if (/palm|jelly|orb|crystal|mushroom|coral|alien|fantasy|glow|neon|tropic/i.test(n)) {
        bonus += dim * 0.1;
      }
      if (TINY_HINT.test(n)) {
        bonus -= dim * 0.45;
      }
      return { obj, dim, score: dim + bonus };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (scored.length === 0) {
    return [];
  }

  scored.sort((a, b) => b.score - a.score);
  const largest = scored[0].dim;
  const minDim = Math.max(largest * 0.22, 0.28);
  const sized = scored.filter((s) => s.dim >= minDim);
  let usePool = sized.length > 0 ? sized : scored.slice(0, Math.min(maxCount + 3, scored.length));

  if (options?.namePred) {
    const pred = options.namePred;
    const filtered = usePool.filter((s) => pred((s.obj.name || '').trim()));
    if (filtered.length > 0) {
      usePool = filtered;
    }
  }

  const picked: THREE.Object3D[] = [];
  for (const { obj } of usePool) {
    if (picked.length >= maxCount) {
      break;
    }
    picked.push(obj.clone(true));
  }

  return picked;
}

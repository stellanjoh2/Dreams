# Plants (curated)

Runtime loads **binary GLBs** from `curated/` (see `WorldManager.CURATED_PLANT_PROFILES`).

## Purple spike (`candy-spike-purple`)

- **Source:** `curated-src/candy-spike-purple.gltf` (starts as a copy of the old spike-a slice; shares `../stylized_low_poly_plants_02_pack_gltf/scene.bin` + textures until you replace geometry).
- **Output:** `curated/candy-spike-purple.glb` — produced by the pack step below.

### Blender workflow (recommended for a clean pivot)

1. Import `curated-src/candy-spike-purple.gltf` (or append only the **Plant.047** subtree you care about).
2. **Apply** rotation & scale (`Ctrl+A` → *All Transforms*).
3. Set origin to ground contact: select visible mesh, **Origin → Geometry to Origin** then move the object so the **bottom center** of the plant sits at world `(0, 0, 0)` (or use *Set Origin → 3D Cursor* on the bottom face).
4. Export **glTF 2.0** back to `curated-src/candy-spike-purple.gltf` (embedded or external bin is fine).
5. From repo root:

   ```bash
   npm run plants:pack
   ```

   This uses `@gltf-transform/cli` **copy** (`.glb` output embeds buffers/textures) for the game.

### Pack all curated plants

```bash
npm run plants:pack
```

Regenerates every `curated-src/*.gltf` → `curated/*.glb`.

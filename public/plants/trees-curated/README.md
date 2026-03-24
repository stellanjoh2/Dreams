# Curated solo trees (assets on disk)

**Runtime:** the game **does not** load or scatter these trees right now — keep this folder and `public/assets/stylized_low_poly_trees_pack_02.glb` so you can wire them back in later.

These **individual `.glb` files** are **generated** from your purchased pack — same idea as `public/plants/curated/` for small plants.

## One-time setup

1. Copy the full vendor file to:
   - `public/assets/stylized_low_poly_trees_pack_02.glb`
2. List mesh root names + sizes (debug):
   - `npm run trees:list`
3. Export palms + alien/weird props into this folder:
   - `npm run trees:extract`

The script writes stable filenames (`solo-palm-*.glb`, `solo-alien-*.glb`) and `manifest.json`. The game loads **five** alien / colourful heroes: `solo-alien-weird-flora`, `solo-alien-mushroom`, `solo-alien-jelly`, `solo-alien-orb`, `solo-alien-crystal` (see `WorldManager.CURATED_TREE_PROFILES`). No big green broad palms.

**If these files are missing**, the game falls back to the **full pack** at `public/assets/stylized_low_poly_trees_pack_02.glb`, **unpacks** nested/grid groups, then prefers roots whose names look alien/colourful — numbered `Tree033_32`-style names are all accepted (`isPreferredScatterTreeFromPackName` in `treePackFallback.ts`). You still need that GLB in `public/assets/` for any trees to show.

## If a slot is skipped

Pack mesh names vary. If the extractor warns `[skip]`, open `scripts/extract-curated-trees.mjs`, adjust the `SLOTS` predicates to match names from `npm run trees:list`, then run `npm run trees:extract` again.

## Do not commit vendor art

Only commit **your** curated outputs if your license allows; the full marketplace pack usually stays local.

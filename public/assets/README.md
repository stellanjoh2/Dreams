Place downloadable 3D assets here. They are served at `/assets/…` (e.g. `school_of_fish.glb` → `/assets/school_of_fish.glb`).

**Cactus enemy:** `low_poly_cactus_enemy.glb` — placed on platform tiles without plants (`CactusEnemySystem`). Plays one **idle** clip (name heuristics, else first clip); faces the player. In dev, the console logs clip names and the chosen idle. List names locally: `npm run gltf:list-animations -- public/assets/low_poly_cactus_enemy.glb`. **Materials:** the file may embed many glTF maps; at runtime `sanitizeCactusShading` keeps **only base color** (`map`) — normal, ORM, emissive, env, displacement, physical extras, etc. are cleared.

**Cactus proximity SFX:** `cactus_enemy_indie_g_#3-1774200378182.wav` — loaded from `/assets/cactus_enemy_indie_g_%233-1774200378182.wav` (see `AUDIO_CACTUS_ENEMY_PROXIMITY_URLS`). The `#` in the filename is fine on disk; URLs must use `%23`.

**Fishing boat:** `fishing_boat_stylized.glb` — near spawn on the water with procedural sway (`FishingBoatProp`). Embedded **glTF animations** (e.g. flag) are played automatically via `AnimationMixer` when present (`gltf.animations`). Clips whose names match `flag|wave|wind|…` are preferred; otherwise **all** clips in the file are started. Tweak `BOAT_*` / `MODEL_UP_FIX` in `FishingBoatProp.ts` for placement and orientation.

**Reef fish pack:** `school_of_fish.glb` is expected to be a single scene with multiple species and a **swimming** animation clip (as in common Sketchfab/Unity-style packs). If your purchase shipped **separate** `.glb` files per species, drop them here and we can wire them in `FishSchoolsSystem` (see `MODEL_URL` / future multi-URL list).

**Textures:** The original pack used **`KHR_materials_pbrSpecularGlossiness`** (diffuse + spec/gloss PNGs embedded in the GLB). **Three.js r183 no longer implements that extension**, so those maps were ignored and fish looked untextured. The active `school_of_fish.glb` here was converted with `gltf-transform metalrough` to **`pbrMetallicRoughness`** (baseColor + metallicRoughness, etc.). The unconverted file is kept as `school_of_fish_specgloss_source.glb` if you need it elsewhere.

# SFX (`/audio/sfx/…`)

Drop WAVs here so fetches succeed (Vite serves `public/` at the site root).

**Cactus proximity** (required name if you use the default URL list):

- `cactus_enemy_indie_g_#3-1774200378182.wav`  
  The `#` is fine in the **filename on disk**. The game requests it as `…_g_%233-1774200378182.wav`.

Or rename to `cactus_enemy_proximity.wav` (also checked).

The project also checks **`public/assets/cactus_enemy_indie_g_#3-1774200378182.wav`** first — see `AUDIO_CACTUS_ENEMY_PROXIMITY_URLS`.

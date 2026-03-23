# Audio (served at `/audio/…`)

- **SFX:** `public/audio/sfx/` — URLs in `src/config/audioAssets.ts` (`AUDIO_JUMP_URLS`, `AUDIO_JUMP_PAD_URLS`, `AUDIO_CACTUS_ENEMY_PROXIMITY_URLS`, elevator lists). If a filename contains `#`, use `%23` in the path string. **Cactus line:** see `public/audio/sfx/README.md`.
- **Music:** `AUDIO_MUSIC_URLS` in `src/config/audioAssets.ts` — first URL that loads wins. Default BGM is `public/audio/music/clamshell-beach.mp3`, then older fallbacks under `public/audio/music/`.

Background music starts after the first successful audio unlock (Play / pointer lock). Jump plays on normal jumps only (not jump pads).

**Elevator up:** one-shot when the lift leaves the bottom dwell. **Elevator down:** looped while descending (spatial panner follows the platform), **fades out and stops** when the lift reaches the bottom dwell. URLs: `AUDIO_ELEVATOR_*` in `src/config/audioAssets.ts`.

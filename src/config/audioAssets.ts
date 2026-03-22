/**
 * Put files under `public/audio/…` — first URL that loads wins.
 * `#` in a filename must be encoded as `%23` in the path.
 */
export const AUDIO_JUMP_URLS = [
  // Your project file (hash encoded for URL)
  '/audio/sfx/jump_sound_for_game_%234-1774190937039.wav',
  '/audio/sfx/jump.ogg',
  '/audio/sfx/jump.mp3',
  '/audio/sfx/jump.wav',
] as const;

export const AUDIO_JUMP_PAD_URLS = [
  '/audio/sfx/jump_pad_boost_sound_%233-1774191613211.wav',
  '/audio/sfx/jump_pad.ogg',
  '/audio/sfx/jump_pad.mp3',
  '/audio/sfx/jump_pad.wav',
] as const;

export const AUDIO_ELEVATOR_DOWN_URLS = [
  '/audio/sfx/elevator_down_sound__%231-1774191355713.wav',
  '/audio/sfx/elevator_down.ogg',
  '/audio/sfx/elevator_down.mp3',
  '/audio/sfx/elevator_down.wav',
] as const;

export const AUDIO_ELEVATOR_UP_URLS = [
  '/audio/sfx/elevator_up_sound_in_%231-1774191233416.wav',
  '/audio/sfx/elevator_up.ogg',
  '/audio/sfx/elevator_up.mp3',
  '/audio/sfx/elevator_up.wav',
] as const;

/** One-shot when the player steps into cactus “too close” radius (spatial SFX at cactus). */
export const AUDIO_CACTUS_ENEMY_PROXIMITY_URLS = [
  // Default project path (same folder as `low_poly_cactus_enemy.glb`)
  '/assets/cactus_enemy_indie_g_%233-1774200378182.wav',
  '/audio/sfx/cactus_enemy_indie_g_%233-1774200378182.wav',
  '/audio/sfx/cactus_enemy_indie_g_3-1774200378182.wav',
  '/audio/sfx/cactus_enemy_proximity.wav',
  '/assets/cactus_enemy_proximity.wav',
] as const;

export const AUDIO_MUSIC_URLS = [
  // Primary BGM — `public/audio/music/clamshell-beach.mp3`
  '/audio/music/clamshell-beach.mp3',
  '/audio/music/in-my-heart.mp3',
  '/audio/music/music.ogg',
  '/audio/music/music.mp3',
  '/audio/music/bgm.ogg',
  '/audio/music/bgm.mp3',
  '/audio/music/theme.ogg',
  '/audio/music/theme.mp3',
] as const;

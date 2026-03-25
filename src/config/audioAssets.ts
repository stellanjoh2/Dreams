import { publicUrl } from './publicUrl';

/**
 * Put files under `public/audio/…` — first URL that loads wins.
 * `#` in a filename must be encoded as `%23` in the path.
 */
export const AUDIO_JUMP_URLS = [
  // Your project file (hash encoded for URL)
  publicUrl('audio/sfx/jump_sound_for_game_%234-1774190937039.wav'),
  publicUrl('audio/sfx/jump.ogg'),
  publicUrl('audio/sfx/jump.mp3'),
  publicUrl('audio/sfx/jump.wav'),
] as const;

export const AUDIO_JUMP_PAD_URLS = [
  publicUrl('audio/sfx/jump_pad_boost_sound_%233-1774191613211.wav'),
  publicUrl('audio/sfx/jump_pad.ogg'),
  publicUrl('audio/sfx/jump_pad.mp3'),
  publicUrl('audio/sfx/jump_pad.wav'),
] as const;

export const AUDIO_ELEVATOR_DOWN_URLS = [
  publicUrl('audio/sfx/elevator_down_sound__%231-1774191355713.wav'),
  publicUrl('audio/sfx/elevator_down.ogg'),
  publicUrl('audio/sfx/elevator_down.mp3'),
  publicUrl('audio/sfx/elevator_down.wav'),
] as const;

export const AUDIO_ELEVATOR_UP_URLS = [
  publicUrl('audio/sfx/elevator_up_sound_in_%231-1774191233416.wav'),
  publicUrl('audio/sfx/elevator_up.ogg'),
  publicUrl('audio/sfx/elevator_up.mp3'),
  publicUrl('audio/sfx/elevator_up.wav'),
] as const;

/** Underwater death: delay before post-death tail / respawn pacing (see `PlayerController`). */
export const DROWNING_SOUND_PHASE_SECONDS = 2;

/**
 * One-shot when the player collects a crystal.
 * Prefer ASCII filename first — `#` in paths breaks some hosts and `fetch()` URL fragments.
 */
export const AUDIO_CRYSTAL_PICKUP_URLS = [
  publicUrl('audio/sfx/magical_crystals_pickup.wav'),
  publicUrl('audio/sfx/magical_crystals_pic_%232-1774468619428.wav'),
  publicUrl('audio/sfx/crystal_pickup.wav'),
] as const;

/** One-shot when the player drowns (underwater death). */
export const AUDIO_CACTUS_PLAYER_DEATH_URLS = [
  publicUrl('audio/sfx/cactus_player_death__%233-1774251334913.wav'),
  publicUrl('audio/sfx/cactus_player_death.wav'),
] as const;

/** One-shot when the player steps into cactus “too close” radius (spatial SFX at cactus). */
export const AUDIO_CACTUS_ENEMY_PROXIMITY_URLS = [
  // Default project path (same folder as `low_poly_cactus_enemy.glb`)
  publicUrl('assets/cactus_enemy_indie_g_%233-1774200378182.wav'),
  publicUrl('audio/sfx/cactus_enemy_indie_g_%233-1774200378182.wav'),
  publicUrl('audio/sfx/cactus_enemy_indie_g_3-1774200378182.wav'),
  publicUrl('audio/sfx/cactus_enemy_proximity.wav'),
  publicUrl('assets/cactus_enemy_proximity.wav'),
] as const;

export const AUDIO_MUSIC_URLS = [
  // Primary BGM (first decodable wins) — `in-my-heart` preferred over `clamshell-beach`
  publicUrl('audio/music/in-my-heart.mp3'),
  publicUrl('audio/music/clamshell-beach.mp3'),
  publicUrl('audio/music/music.ogg'),
  publicUrl('audio/music/music.mp3'),
  publicUrl('audio/music/bgm.ogg'),
  publicUrl('audio/music/bgm.mp3'),
  publicUrl('audio/music/theme.ogg'),
  publicUrl('audio/music/theme.mp3'),
] as const;

import * as THREE from 'three';
import {
  AUDIO_CACTUS_ENEMY_PROXIMITY_URLS,
  AUDIO_ELEVATOR_DOWN_URLS,
  AUDIO_ELEVATOR_UP_URLS,
  AUDIO_JUMP_PAD_URLS,
  AUDIO_JUMP_URLS,
  AUDIO_MUSIC_URLS,
} from '../config/audioAssets';
import { DEFAULT_FX_SETTINGS } from '../config/defaults';
import type { AudioVolumeSettings } from '../fx/FxSettings';
import {
  BLOCK_UNIT,
  MOVING_ELEVATORS,
  getMovingElevatorDriverWave,
  getMovingElevatorTopY,
} from '../world/TerrainLayout';

const BGM_GAIN = 0.32;
const SFX_GAIN = 0.55;
const JUMP_PAD_GAIN = 0.52;
const ELEVATOR_UP_GAIN = 0.42;
const ELEVATOR_DOWN_GAIN = 0.38;
/** Bus gain for cactus line (stereo SFX bus — not spatial). */
const CACTUS_ENEMY_PROXIMITY_GAIN = Math.min(1, SFX_GAIN * 2.1);

/** Set `true` to restore elevator up/down SFX (samples or procedural). */
const ELEVATOR_SFX_ENABLED = false;

/** Driver wave below this = dwell at bottom; crossing upward starts the “going up” motion. */
const ELEVATOR_ASCENT_EDGE = 0.14;
/** Driver wave above this = dwell at top; crossing downward starts descent. */
const ELEVATOR_TOP_DWELL_EDGE = 0.86;

async function fetchFirstDecodableUrl(
  context: AudioContext,
  urls: readonly string[],
): Promise<AudioBuffer | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const raw = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(raw.slice(0));
      return buffer;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export class AudioSystem {
  private context: AudioContext | null = null;
  private unlockPromise: Promise<void> | null = null;

  private jumpBuffer: AudioBuffer | null = null;
  private jumpPadBuffer: AudioBuffer | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private elevatorUpBuffer: AudioBuffer | null = null;
  private elevatorDownBuffer: AudioBuffer | null = null;
  private cactusEnemyProximityBuffer: AudioBuffer | null = null;
  /** Blocks overlapping cactus aggro lines; drives idle animation “threatened” speed in world. */
  private cactusAggroVoicePlaying = false;
  private musicStarted = false;
  private bgmGain: GainNode | null = null;
  /** Master gain for all sound effects (not music). */
  private sfxBus: GainNode | null = null;
  private musicVolume = 1;
  private fxVolume = 1;

  private readonly prevElevatorDriverWave = new Map<string, number>();
  /** Looped spatial “down” motor per lift; stopped when bottom dwell is reached. */
  private readonly activeElevatorDown = new Map<
    string,
    {
      source: AudioScheduledSourceNode;
      panner: PannerNode;
      gain: GainNode;
      /** Procedural path only: e.g. lowpass between osc and panner. */
      extraDisconnect?: AudioNode[];
    }
  >();
  private readonly listenerPos = new THREE.Vector3();
  private readonly listenerFwd = new THREE.Vector3();
  private readonly listenerUp = new THREE.Vector3(0, 1, 0);

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    // Resume before loading/decoding so `startBackgroundMusicIfNeeded()` sees a running context.
    // Otherwise bootstrap can finish first, skip BGM while suspended, and never retry.
    if (this.context.state !== 'running') {
      await this.context.resume();
    }

    if (!this.unlockPromise) {
      this.unlockPromise = this.bootstrapGameplayAudio();
    }

    await this.unlockPromise;

    this.startBackgroundMusicIfNeeded();
  }

  /** Load SFX + music once; start looping BGM (idempotent). */
  private async bootstrapGameplayAudio(): Promise<void> {
    const ctx = this.context;
    if (!ctx) {
      return;
    }

    const [jump, jumpPad, music, elevatorUp, elevatorDown, cactusProximity] = await Promise.all([
      fetchFirstDecodableUrl(ctx, AUDIO_JUMP_URLS),
      fetchFirstDecodableUrl(ctx, AUDIO_JUMP_PAD_URLS),
      fetchFirstDecodableUrl(ctx, AUDIO_MUSIC_URLS),
      fetchFirstDecodableUrl(ctx, AUDIO_ELEVATOR_UP_URLS),
      fetchFirstDecodableUrl(ctx, AUDIO_ELEVATOR_DOWN_URLS),
      fetchFirstDecodableUrl(ctx, AUDIO_CACTUS_ENEMY_PROXIMITY_URLS),
    ]);

    this.jumpBuffer = jump;
    this.jumpPadBuffer = jumpPad;
    this.musicBuffer = music;
    this.elevatorUpBuffer = elevatorUp;
    this.elevatorDownBuffer = elevatorDown;
    this.cactusEnemyProximityBuffer = cactusProximity;

    this.ensureSfxBus();
    this.startBackgroundMusicIfNeeded();
    this.initDefaultListener();
    this.applyStoredVolumeToBuses();
  }

  /**
   * Safe listener pose before the first camera-linked update (some HRTF/equal-power paths behave
   * badly with an all-zero listener).
   */
  private initDefaultListener(): void {
    const ctx = this.context;
    if (!ctx || !ctx.listener.positionX) {
      return;
    }

    const t = ctx.currentTime;
    const l = ctx.listener;
    l.positionX.setValueAtTime(0, t);
    l.positionY.setValueAtTime(2, t);
    l.positionZ.setValueAtTime(8, t);
    l.forwardX.setValueAtTime(0, t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(-1, t);
    l.upX.setValueAtTime(0, t);
    l.upY.setValueAtTime(1, t);
    l.upZ.setValueAtTime(0, t);
  }

  /** Apply multipliers after buses exist (also called from App settings). */
  applyVolumeSettings(settings?: AudioVolumeSettings | null): void {
    const d = DEFAULT_FX_SETTINGS.audio;
    const s = settings ?? d;
    let m = Number(s.musicVolume);
    let f = Number(s.fxVolume);
    if (!Number.isFinite(m)) {
      m = d.musicVolume;
    }
    if (!Number.isFinite(f)) {
      f = d.fxVolume;
    }
    this.musicVolume = THREE.MathUtils.clamp(m, 0, 1);
    this.fxVolume = THREE.MathUtils.clamp(f, 0, 1);
    this.applyStoredVolumeToBuses();
  }

  private applyStoredVolumeToBuses(): void {
    const ctx = this.context;
    if (!ctx) {
      return;
    }

    const t = ctx.currentTime;
    if (this.bgmGain) {
      this.bgmGain.gain.cancelScheduledValues(t);
      this.bgmGain.gain.setValueAtTime(BGM_GAIN * this.musicVolume, t);
    }
    if (this.sfxBus) {
      this.sfxBus.gain.cancelScheduledValues(t);
      this.sfxBus.gain.setValueAtTime(this.fxVolume, t);
    }
  }

  private ensureSfxBus(): void {
    const ctx = this.context;
    if (!ctx || this.sfxBus) {
      return;
    }

    const bus = ctx.createGain();
    const t = ctx.currentTime;
    bus.gain.setValueAtTime(this.fxVolume, t);
    bus.connect(ctx.destination);
    this.sfxBus = bus;
  }

  private getSfxOutput(): AudioNode {
    if (this.sfxBus) {
      return this.sfxBus;
    }
    if (!this.context) {
      throw new Error('AudioSystem.getSfxOutput: no AudioContext');
    }
    return this.context.destination;
  }

  private startBackgroundMusicIfNeeded(): void {
    const ctx = this.context;
    if (!ctx || this.musicStarted || !this.musicBuffer) {
      return;
    }

    if (ctx.state !== 'running') {
      return;
    }

    this.musicStarted = true;

    const master = ctx.createGain();
    const t0 = ctx.currentTime;
    master.gain.setValueAtTime(BGM_GAIN * this.musicVolume, t0);
    master.connect(ctx.destination);
    this.bgmGain = master;

    const playLoop = (): void => {
      if (!this.context || !this.musicBuffer || !this.bgmGain) {
        return;
      }

      const source = this.context.createBufferSource();
      source.buffer = this.musicBuffer;
      source.loop = true;
      source.connect(this.bgmGain);
      source.start(this.context.currentTime);
    };

    playLoop();
  }

  /**
   * Keeps the Web Audio listener on the camera for PannerNode distance attenuation.
   * Call each frame while the game view is active (e.g. pointer locked).
   */
  setListenerFromCamera(camera: THREE.Camera): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    const listener = ctx.listener;
    const t = ctx.currentTime;

    camera.getWorldPosition(this.listenerPos);
    camera.getWorldDirection(this.listenerFwd);

    if (listener.positionX) {
      listener.positionX.setValueAtTime(this.listenerPos.x, t);
      listener.positionY.setValueAtTime(this.listenerPos.y, t);
      listener.positionZ.setValueAtTime(this.listenerPos.z, t);
      listener.forwardX.setValueAtTime(this.listenerFwd.x, t);
      listener.forwardY.setValueAtTime(this.listenerFwd.y, t);
      listener.forwardZ.setValueAtTime(this.listenerFwd.z, t);
      listener.upX.setValueAtTime(this.listenerUp.x, t);
      listener.upY.setValueAtTime(this.listenerUp.y, t);
      listener.upZ.setValueAtTime(this.listenerUp.z, t);
    }
  }

  /**
   * Up: one-shot when leaving bottom dwell. Down: looped spatial clip while descending, stopped at bottom dwell.
   */
  tickElevatorSounds(elapsed: number, camera: THREE.Camera | null): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    /** Must run even when elevator SFX is off — otherwise `PannerNode` sources (e.g. cactus) stay muted. */
    if (camera) {
      this.setListenerFromCamera(camera);
    }

    if (!ELEVATOR_SFX_ENABLED) {
      for (const id of [...this.activeElevatorDown.keys()]) {
        this.stopElevatorDownSound(id);
      }
      for (const platform of MOVING_ELEVATORS) {
        const wave = getMovingElevatorDriverWave(elapsed, platform);
        this.prevElevatorDriverWave.set(platform.id, wave);
      }
      return;
    }

    const t = ctx.currentTime;

    for (const platform of MOVING_ELEVATORS) {
      const wave = getMovingElevatorDriverWave(elapsed, platform);
      const prev = this.prevElevatorDriverWave.get(platform.id);

      const topY = getMovingElevatorTopY(elapsed, platform);
      const y = topY - BLOCK_UNIT * 0.5;
      const { x, z } = platform;
      const downPlaying = this.activeElevatorDown.get(platform.id);

      if (prev !== undefined) {
        if (prev <= ELEVATOR_ASCENT_EDGE && wave > ELEVATOR_ASCENT_EDGE) {
          if (downPlaying) {
            this.stopElevatorDownSound(platform.id);
          }
          if (this.elevatorUpBuffer) {
            this.playPositionalOneShot(this.elevatorUpBuffer, x, y, z, ELEVATOR_UP_GAIN);
          } else {
            this.playProceduralElevatorUp(x, y, z);
          }
        }
      }

      const downVoice = this.activeElevatorDown.get(platform.id);

      if (prev !== undefined) {
        if (downVoice) {
          if (prev > ELEVATOR_ASCENT_EDGE && wave <= ELEVATOR_ASCENT_EDGE) {
            this.stopElevatorDownSound(platform.id);
          } else {
            downVoice.panner.positionX.setValueAtTime(x, t);
            downVoice.panner.positionY.setValueAtTime(y, t);
            downVoice.panner.positionZ.setValueAtTime(z, t);
          }
        } else if (prev > ELEVATOR_TOP_DWELL_EDGE && wave <= ELEVATOR_TOP_DWELL_EDGE) {
          this.startElevatorDownSound(platform.id, x, y, z);
        }
      }

      this.prevElevatorDriverWave.set(platform.id, wave);
    }
  }

  private startElevatorDownSound(id: string, x: number, y: number, z: number): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.activeElevatorDown.has(id)) {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4.5;
    panner.maxDistance = 72;
    panner.rolloffFactor = 1.35;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.positionX.setValueAtTime(x, t);
    panner.positionY.setValueAtTime(y, t);
    panner.positionZ.setValueAtTime(z, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ELEVATOR_DOWN_GAIN, t);

    const buffer = this.elevatorDownBuffer;
    let source: AudioScheduledSourceNode;
    let extraDisconnect: AudioNode[] | undefined;
    if (buffer) {
      const bufSrc = ctx.createBufferSource();
      bufSrc.buffer = buffer;
      bufSrc.loop = true;
      bufSrc.connect(panner);
      source = bufSrc;
    } else {
      /** Motor hum when no `elevator_down` sample is present. */
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(54, t);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, t);
      filter.Q.setValueAtTime(0.7, t);
      osc.connect(filter);
      filter.connect(panner);
      source = osc;
      extraDisconnect = [filter];
    }

    panner.connect(gain);
    gain.connect(this.getSfxOutput());
    source.start(t);

    const voice = { source, panner, gain, extraDisconnect };
    this.activeElevatorDown.set(id, voice);
  }

  private stopElevatorDownSound(id: string): void {
    const voice = this.activeElevatorDown.get(id);
    if (!voice) {
      return;
    }

    this.activeElevatorDown.delete(id);

    const ctx = this.context;
    if (!ctx) {
      this.disconnectElevatorDownGraph(voice);
      return;
    }

    const t = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
    voice.gain.gain.linearRampToValueAtTime(0, t + 0.042);
    const stopT = t + 0.048;
    voice.source.onended = (): void => {
      this.disconnectElevatorDownGraph(voice);
    };

    try {
      voice.source.stop(stopT);
    } catch {
      this.disconnectElevatorDownGraph(voice);
    }
  }

  private disconnectElevatorDownGraph(voice: {
    source: AudioScheduledSourceNode;
    panner: PannerNode;
    gain: GainNode;
    extraDisconnect?: AudioNode[];
  }): void {
    if (voice.extraDisconnect) {
      for (const node of voice.extraDisconnect) {
        try {
          node.disconnect();
        } catch {
          /* */
        }
      }
    }
    try {
      voice.source.disconnect();
    } catch {
      /* */
    }
    try {
      voice.panner.disconnect();
    } catch {
      /* */
    }
    try {
      voice.gain.disconnect();
    } catch {
      /* */
    }
  }

  /** Mechanical “clunk + whine” when no elevator-up sample is present. */
  private playProceduralElevatorUp(x: number, y: number, z: number): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4.5;
    panner.maxDistance = 72;
    panner.rolloffFactor = 1.35;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.positionX.setValueAtTime(x, t);
    panner.positionY.setValueAtTime(y, t);
    panner.positionZ.setValueAtTime(z, t);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(ELEVATOR_UP_GAIN * 0.85, t + 0.028);
    env.gain.linearRampToValueAtTime(0, t + 0.26);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(310, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.2);

    osc.connect(panner);
    panner.connect(env);
    env.connect(this.getSfxOutput());
    osc.start(t);
    osc.stop(t + 0.28);
    osc.onended = (): void => {
      try {
        osc.disconnect();
        panner.disconnect();
        env.disconnect();
      } catch {
        /* */
      }
    };
  }

  private playPositionalOneShot(
    buffer: AudioBuffer,
    x: number,
    y: number,
    z: number,
    gainLinear: number,
  ): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4.5;
    panner.maxDistance = 72;
    panner.rolloffFactor = 1.35;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;

    panner.positionX.setValueAtTime(x, t);
    panner.positionY.setValueAtTime(y, t);
    panner.positionZ.setValueAtTime(z, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainLinear, t);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.getSfxOutput());
    source.start(t);
    source.onended = (): void => {
      source.disconnect();
      panner.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Cactus voice when the player enters proximity. Ensures **unlock + decode** (fixes silent failure
   * when this ran before `AudioContext` was running or before bootstrap finished). Falls back to
   * `<audio>` if `decodeAudioData` fails for the WAV.
   */
  /** True while the cactus proximity line is audibly playing (Web Audio or HTML5 fallback). */
  isCactusAggroVoicePlaying(): boolean {
    return this.cactusAggroVoicePlaying;
  }

  playCactusEnemyProximity(_x: number, _y: number, _z: number): void {
    void (async (): Promise<void> => {
      await this.unlock();
      const ctx = this.context;
      if (!ctx) {
        return;
      }
      if (ctx.state !== 'running') {
        await ctx.resume().catch(() => {
          /* */
        });
      }
      if (ctx.state !== 'running') {
        return;
      }

      if (this.cactusAggroVoicePlaying) {
        return;
      }

      let buf = this.cactusEnemyProximityBuffer;
      if (!buf) {
        buf = await fetchFirstDecodableUrl(ctx, AUDIO_CACTUS_ENEMY_PROXIMITY_URLS);
        this.cactusEnemyProximityBuffer = buf;
      }

      if (buf) {
        this.playCactusEnemyProximityFromBuffer(buf);
      } else {
        this.playCactusEnemyHtml5Fallback();
      }
    })();
  }

  private playCactusEnemyProximityFromBuffer(buf: AudioBuffer): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    if (this.cactusAggroVoicePlaying) {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(CACTUS_ENEMY_PROXIMITY_GAIN, t);
    bus.connect(this.getSfxOutput());

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(bus);
    this.cactusAggroVoicePlaying = true;
    source.start(t);
    source.onended = (): void => {
      this.cactusAggroVoicePlaying = false;
      bus.disconnect();
    };
  }

  /** When Web Audio decode fails, browser `<audio>` often still plays the same URL. */
  private playCactusEnemyHtml5Fallback(): void {
    this.tryPlayCactusHtml5FromUrlIndex(0);
  }

  private tryPlayCactusHtml5FromUrlIndex(index: number): void {
    if (index >= AUDIO_CACTUS_ENEMY_PROXIMITY_URLS.length) {
      return;
    }
    if (this.cactusAggroVoicePlaying) {
      return;
    }
    const el = new Audio(AUDIO_CACTUS_ENEMY_PROXIMITY_URLS[index]);
    el.setAttribute('playsInline', 'true');
    el.volume = Math.min(1, CACTUS_ENEMY_PROXIMITY_GAIN);
    this.cactusAggroVoicePlaying = true;
    el.addEventListener(
      'ended',
      () => {
        this.cactusAggroVoicePlaying = false;
      },
      { once: true },
    );
    void el.play().catch(() => {
      this.cactusAggroVoicePlaying = false;
      this.tryPlayCactusHtml5FromUrlIndex(index + 1);
    });
  }

  playJump(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    if (!this.jumpBuffer) {
      if (this.unlockPromise) {
        void this.unlockPromise.then(() => {
          if (this.context?.state !== 'running') {
            return;
          }
          if (this.jumpBuffer) {
            this.playJumpNow();
          } else {
            this.playProceduralJump();
          }
        });
      }
      return;
    }

    this.playJumpNow();
  }

  private playJumpNow(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.jumpBuffer) {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(SFX_GAIN, t);
    bus.connect(this.getSfxOutput());

    const source = ctx.createBufferSource();
    source.buffer = this.jumpBuffer;
    source.connect(bus);
    source.start(t);
    source.onended = (): void => {
      bus.disconnect();
    };
  }

  /** Short “whoop” when no jump sample file loaded (`public/audio/sfx/…`). */
  private playProceduralJump(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.connect(this.getSfxOutput());
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.42 * SFX_GAIN, t + 0.018);
    env.gain.linearRampToValueAtTime(0, t + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(88, t + 0.12);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + 0.17);
    osc.onended = (): void => {
      try {
        env.disconnect();
      } catch {
        /* */
      }
    };
  }

  playJumpPad(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    if (!this.jumpPadBuffer) {
      if (this.unlockPromise) {
        void this.unlockPromise.then(() => {
          if (this.context?.state !== 'running') {
            return;
          }
          if (this.jumpPadBuffer) {
            this.playJumpPadNow();
          } else {
            this.playProceduralJumpPad();
          }
        });
      }
      return;
    }

    this.playJumpPadNow();
  }

  private playJumpPadNow(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.jumpPadBuffer) {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(JUMP_PAD_GAIN, t);
    bus.connect(this.getSfxOutput());

    const source = ctx.createBufferSource();
    source.buffer = this.jumpPadBuffer;
    source.connect(bus);
    source.start(t);
    source.onended = (): void => {
      bus.disconnect();
    };
  }

  /** Brighter burst when no jump-pad sample file is present. */
  private playProceduralJumpPad(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    this.ensureSfxBus();

    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.connect(this.getSfxOutput());
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.48 * JUMP_PAD_GAIN, t + 0.022);
    env.gain.linearRampToValueAtTime(0, t + 0.22);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + 0.24);
    osc.onended = (): void => {
      try {
        env.disconnect();
      } catch {
        /* */
      }
    };
  }

  playCrystalPickup(): void {
    if (!this.context || this.context.state !== 'running') {
      return;
    }

    this.ensureSfxBus();

    const start = this.context.currentTime;
    const gain = this.context.createGain();
    gain.connect(this.getSfxOutput());
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);

    const notes = [659.25, 987.77, 1318.51];
    notes.forEach((frequency, index) => {
      const osc = this.context!.createOscillator();
      const oscGain = this.context!.createGain();

      osc.type = index === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, start + 0.35);

      oscGain.gain.setValueAtTime(0.0001, start);
      oscGain.gain.exponentialRampToValueAtTime(0.05 / (index + 1), start + 0.04);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6 + index * 0.12);

      osc.connect(oscGain);
      oscGain.connect(gain);
      osc.start(start + index * 0.03);
      osc.stop(start + 0.8 + index * 0.1);
    });
  }
}

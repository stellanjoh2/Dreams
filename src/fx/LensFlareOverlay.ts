import * as THREE from 'three';
import { ENABLE_EMISSIVE_LENS_FLARE } from '../config/defaults';

type OrbDef = {
  ratio: number;
  size: number;
  blur: number;
  opacity: number;
  scaleBoost: number;
};

const ORBS: OrbDef[] = [
  { ratio: 0, size: 280, blur: 5, opacity: 0.72, scaleBoost: 0.44 },
  { ratio: 0.14, size: 96, blur: 0, opacity: 0.48, scaleBoost: 0.22 },
  { ratio: 0.3, size: 176, blur: 3.5, opacity: 0.3, scaleBoost: 0.3 },
  { ratio: 0.54, size: 118, blur: 1.2, opacity: 0.34, scaleBoost: 0.2 },
  { ratio: 0.82, size: 210, blur: 6, opacity: 0.22, scaleBoost: 0.34 },
  { ratio: 1.12, size: 128, blur: 0, opacity: 0.28, scaleBoost: 0.16 },
];

/** Multiplies sun ghost pixel sizes from `ORBS` (emissive flare keeps its own scale). */
const SUN_FLARE_ORB_PIXEL_SCALE = 1.42;

/** World-space emissive sources (jump pads, crystals, etc.) that can drive a secondary flare. */
export type LensFlareEmissiveCandidate = {
  x: number;
  y: number;
  z: number;
  /** Relative brightness 0–1+ */
  intensity: number;
  /** Optional CSS hex tint for the flare */
  color?: string;
};

type FlareElements = {
  root: HTMLDivElement;
  dirt: HTMLDivElement;
  halo: HTMLDivElement;
  ring: HTMLDivElement;
  streakPrimary: HTMLDivElement;
  streakSecondary: HTMLDivElement;
  orbs: HTMLDivElement[];
  /** Sun-only extras */
  prism?: HTMLDivElement;
  greenGhostHalo?: HTMLDivElement;
  sunGhostWarmLg?: HTMLDivElement;
  sunGhostWarmMd?: HTMLDivElement;
  sunGhostPurple?: HTMLDivElement;
  sunGhostFaintA?: HTMLDivElement;
  sunGhostFaintB?: HTMLDivElement;
  sunGhostSparkA?: HTMLDivElement;
  sunGhostSparkB?: HTMLDivElement;
};

const EMISSIVE_ORB_SCALE = 0.58;
/** World units: geometry at the flare anchor (pad top, crystal) must not count as “blocking”. */
const EMISSIVE_OCCLUSION_MARGIN = 0.45;

function buildFlareElements(
  mount: HTMLElement,
  rootClass: string,
  orbSizeScale: number,
  sunCinematic = false,
): FlareElements {
  const root = document.createElement('div');
  root.className = sunCinematic ? `${rootClass} lens-flare-root--sun` : rootClass;

  const dirt = document.createElement('div');
  dirt.className = 'lens-flare-dirt';
  root.append(dirt);

  const halo = document.createElement('div');
  halo.className = 'lens-flare-halo';
  root.append(halo);

  const ring = document.createElement('div');
  ring.className = 'lens-flare-ring';
  root.append(ring);

  const streakPrimary = document.createElement('div');
  streakPrimary.className = 'lens-flare-streak lens-flare-streak--primary';
  root.append(streakPrimary);

  const streakSecondary = document.createElement('div');
  streakSecondary.className = 'lens-flare-streak lens-flare-streak--secondary';
  root.append(streakSecondary);

  const orbs: HTMLDivElement[] = [];
  for (const orb of ORBS) {
    const element = document.createElement('div');
    element.className = 'lens-flare-orb';
    const s = orb.size * orbSizeScale;
    element.style.width = `${s}px`;
    element.style.height = `${s}px`;
    element.style.filter = `blur(${orb.blur}px)`;
    orbs.push(element);
    root.append(element);
  }

  let prism: HTMLDivElement | undefined;
  let greenGhostHalo: HTMLDivElement | undefined;
  let sunGhostWarmLg: HTMLDivElement | undefined;
  let sunGhostWarmMd: HTMLDivElement | undefined;
  let sunGhostPurple: HTMLDivElement | undefined;
  let sunGhostFaintA: HTMLDivElement | undefined;
  let sunGhostFaintB: HTMLDivElement | undefined;
  let sunGhostSparkA: HTMLDivElement | undefined;
  let sunGhostSparkB: HTMLDivElement | undefined;
  if (sunCinematic) {
    sunGhostSparkA = document.createElement('div');
    sunGhostSparkA.className = 'lens-flare-ghost lens-flare-ghost--spark';
    root.append(sunGhostSparkA);

    sunGhostWarmLg = document.createElement('div');
    sunGhostWarmLg.className = 'lens-flare-ghost lens-flare-ghost--warm-lg';
    root.append(sunGhostWarmLg);

    sunGhostFaintA = document.createElement('div');
    sunGhostFaintA.className = 'lens-flare-ghost lens-flare-ghost--faint';
    root.append(sunGhostFaintA);

    greenGhostHalo = document.createElement('div');
    greenGhostHalo.className = 'lens-flare-ghost lens-flare-green-ghost-halo';
    root.append(greenGhostHalo);

    sunGhostWarmMd = document.createElement('div');
    sunGhostWarmMd.className = 'lens-flare-ghost lens-flare-ghost--warm-md';
    root.append(sunGhostWarmMd);

    sunGhostPurple = document.createElement('div');
    sunGhostPurple.className = 'lens-flare-ghost lens-flare-ghost--purple-wedge';
    root.append(sunGhostPurple);

    prism = document.createElement('div');
    prism.className = 'lens-flare-prism';
    root.append(prism);

    sunGhostFaintB = document.createElement('div');
    sunGhostFaintB.className = 'lens-flare-ghost lens-flare-ghost--faint';
    root.append(sunGhostFaintB);

    sunGhostSparkB = document.createElement('div');
    sunGhostSparkB.className = 'lens-flare-ghost lens-flare-ghost--spark';
    root.append(sunGhostSparkB);
  }

  mount.append(root);
  return {
    root,
    dirt,
    halo,
    ring,
    streakPrimary,
    streakSecondary,
    orbs,
    prism,
    greenGhostHalo,
    sunGhostWarmLg,
    sunGhostWarmMd,
    sunGhostPurple,
    sunGhostFaintA,
    sunGhostFaintB,
    sunGhostSparkA,
    sunGhostSparkB,
  };
}

function applyFlareColor(
  root: HTMLDivElement,
  orbs: HTMLDivElement[],
  hex: string,
  orbHighlightAlpha: [number, number] = [0.92, 0.52],
  dramatic = false,
): void {
  const color = new THREE.Color(hex);
  const rgb = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;
  const strong = `rgba(${rgb}, ${dramatic ? 0.94 : 0.84})`;
  const mid = `rgba(${rgb}, ${dramatic ? 0.48 : 0.34})`;
  const soft = `rgba(${rgb}, ${dramatic ? 0.22 : 0.14})`;

  root.style.setProperty('--lens-flare-strong', strong);
  root.style.setProperty('--lens-flare-mid', mid);
  root.style.setProperty('--lens-flare-soft', soft);
  root.style.setProperty('--lens-flare-rgb', rgb);

  orbs.forEach((orb, index) => {
    const alpha =
      index === 0
        ? orbHighlightAlpha[0]
        : dramatic
          ? Math.min(0.72, orbHighlightAlpha[1] + 0.12)
          : orbHighlightAlpha[1];
    orb.style.background = `radial-gradient(circle, rgba(255,255,255,${alpha}) 0%, ${strong} 20%, ${mid} 46%, ${soft} 68%, transparent 100%)`;
  });
}

export class LensFlareOverlay {
  private readonly sun: FlareElements;
  private readonly emissive: FlareElements;
  private readonly projected = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly center = new THREE.Vector2();
  private readonly sunScreen = new THREE.Vector2();
  private readonly rayDirection = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private occlusionObjects: THREE.Object3D[] | null = null;
  private color = '#ffcc98';
  private intensity = 1;
  private visibility = 0;
  private targetVisibility = 0;
  private lastUpdateTime = 0;
  private lastSunOcclusionCheckTime = 0;
  private sunOccluded = false;
  /** Smoothed 0–1: sun on-screen but blocked by geometry (drives a small exposure dip). */
  private sunGeometryOcclusionDamp = 0;
  private emissiveVisibility = 0;
  private emissiveTargetVisibility = 0;
  private lastEmissiveColor = '';

  constructor(mount: HTMLElement) {
    this.sun = buildFlareElements(mount, 'lens-flare-root', SUN_FLARE_ORB_PIXEL_SCALE, true);
    this.emissive = buildFlareElements(mount, 'lens-flare-root lens-flare-root--emissive', EMISSIVE_ORB_SCALE, false);
    this.setColor(this.color);
    applyFlareColor(this.emissive.root, this.emissive.orbs, '#d8f6ff', [0.88, 0.48], false);
    this.lastEmissiveColor = '#d8f6ff';
    if (!ENABLE_EMISSIVE_LENS_FLARE) {
      this.emissive.root.style.display = 'none';
    }
  }

  setColor(hex: string): void {
    this.color = hex;
    applyFlareColor(this.sun.root, this.sun.orbs, hex, [0.96, 0.58], true);
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, value);
  }

  /** Damped 0–1 sun flare strength (on-screen sun, not occluded) — drives post-process lens dirt boost. */
  getSunFlareVisibility(): number {
    return this.visibility;
  }

  /** Damped 0–1 — sun in view frustum but raycast hits world geometry before the sun. */
  getSunGeometryOcclusion01(): number {
    return this.sunGeometryOcclusionDamp;
  }

  setOcclusionObjects(objects: THREE.Object3D[] | null): void {
    this.occlusionObjects = objects && objects.length > 0 ? objects : null;
  }

  update(
    camera: THREE.Camera,
    worldTarget: THREE.Vector3,
    viewportWidth: number,
    viewportHeight: number,
    delta = 1 / 60,
    emissiveCandidates?: readonly LensFlareEmissiveCandidate[],
  ): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      this.hideSun();
      this.hideEmissive();
      return;
    }

    this.updateSunFlare(camera, worldTarget, viewportWidth, viewportHeight, delta);
    if (ENABLE_EMISSIVE_LENS_FLARE) {
      this.updateEmissiveFlare(camera, emissiveCandidates, viewportWidth, viewportHeight, delta);
    } else {
      this.emissiveVisibility = 0;
      this.emissiveTargetVisibility = 0;
      this.hideEmissive();
    }
  }

  hide(): void {
    this.hideSun();
    this.hideEmissive();
  }

  private hideSun(): void {
    this.sun.root.classList.remove('is-visible');
    this.sun.root.style.opacity = '0';
  }

  private hideEmissive(): void {
    this.emissive.root.classList.remove('is-visible');
    this.emissive.root.style.opacity = '0';
  }

  private updateSunFlare(
    camera: THREE.Camera,
    worldTarget: THREE.Vector3,
    viewportWidth: number,
    viewportHeight: number,
    delta: number,
  ): void {
    this.worldPosition.copy(worldTarget);
    this.projected.copy(this.worldPosition).project(camera);

    const inFront = this.projected.z > -1 && this.projected.z < 1;
    const inBounds = Math.abs(this.projected.x) < 1.4 && Math.abs(this.projected.y) < 1.4;

    if (!inFront || !inBounds) {
      this.targetVisibility = 0;
      this.visibility = THREE.MathUtils.damp(this.visibility, 0, 18, delta);
      if (this.visibility <= 0.002) {
        this.hideSun();
      }
      return;
    }

    const sunX = (this.projected.x * 0.5 + 0.5) * viewportWidth;
    const sunY = (-this.projected.y * 0.5 + 0.5) * viewportHeight;

    this.center.set(viewportWidth * 0.5, viewportHeight * 0.5);
    this.sunScreen.set(sunX, sunY);

    const distanceFromCenter = this.center.distanceTo(this.sunScreen) / Math.max(viewportWidth, viewportHeight);
    const edgeFade = THREE.MathUtils.clamp(1 - distanceFromCenter * 0.92, 0, 1);
    const boundsFade = THREE.MathUtils.clamp(1.2 - Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y)), 0, 1);
    const baseVisibility = edgeFade * boundsFade * this.intensity * 1.22;

    const now = this.getNowSeconds();
    if (now - this.lastSunOcclusionCheckTime >= 0.075) {
      this.lastSunOcclusionCheckTime = now;
      this.sunOccluded = this.checkSunOcclusion(camera, worldTarget);
    }
    this.targetVisibility = this.sunOccluded ? 0 : baseVisibility;

    const occTarget = this.sunOccluded ? 1 : 0;
    const occFade = occTarget < this.sunGeometryOcclusionDamp ? 16 : 7;
    this.sunGeometryOcclusionDamp = THREE.MathUtils.damp(
      this.sunGeometryOcclusionDamp,
      occTarget,
      occFade,
      delta,
    );

    const fadeSpeed = this.targetVisibility < this.visibility ? 18 : 6;
    this.visibility = THREE.MathUtils.damp(this.visibility, this.targetVisibility, fadeSpeed, delta);

    if (this.visibility <= 0.01) {
      this.hideSun();
      return;
    }

    this.sun.root.classList.add('is-visible');
    this.sun.root.style.opacity = this.visibility.toFixed(3);

    this.placeFlareElements(
      this.sun,
      sunX,
      sunY,
      viewportWidth,
      viewportHeight,
      distanceFromCenter,
      this.visibility,
      1,
    );
  }

  private updateEmissiveFlare(
    camera: THREE.Camera,
    candidates: readonly LensFlareEmissiveCandidate[] | undefined,
    viewportWidth: number,
    viewportHeight: number,
    delta: number,
  ): void {
    if (!candidates || candidates.length === 0) {
      this.emissiveTargetVisibility = 0;
      this.emissiveVisibility = THREE.MathUtils.damp(this.emissiveVisibility, 0, 20, delta);
      if (this.emissiveVisibility <= 0.002) {
        this.hideEmissive();
      }
      return;
    }

    let best: LensFlareEmissiveCandidate | null = null;
    let bestScore = 0;
    const camPos = camera.position;

    for (const c of candidates) {
      if (!(c.intensity > 0.08)) {
        continue;
      }

      this.worldPosition.set(c.x, c.y, c.z);
      this.projected.copy(this.worldPosition).project(camera);

      const inFront = this.projected.z > -1 && this.projected.z < 1;
      if (!inFront) {
        continue;
      }

      const inBounds = Math.abs(this.projected.x) < 1.35 && Math.abs(this.projected.y) < 1.35;
      if (!inBounds) {
        continue;
      }

      const distCam = camPos.distanceTo(this.worldPosition);
      const screenX = (this.projected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-this.projected.y * 0.5 + 0.5) * viewportHeight;
      this.center.set(viewportWidth * 0.5, viewportHeight * 0.5);
      this.sunScreen.set(screenX, screenY);
      const distanceFromCenter = this.center.distanceTo(this.sunScreen) / Math.max(viewportWidth, viewportHeight);
      const edgeFade = THREE.MathUtils.clamp(1 - distanceFromCenter * 0.95, 0, 1);
      const boundsFade = THREE.MathUtils.clamp(1.15 - Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y)), 0, 1);

      const distFalloff = 1 / (distCam * 0.11 + 1);
      const score = c.intensity * edgeFade * boundsFade * distFalloff;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best || bestScore < 0.028) {
      this.emissiveTargetVisibility = 0;
      this.emissiveVisibility = THREE.MathUtils.damp(this.emissiveVisibility, 0, 20, delta);
      if (this.emissiveVisibility <= 0.002) {
        this.hideEmissive();
      }
      return;
    }

    const c = best;
    this.worldPosition.set(c.x, c.y, c.z);
    // One raycast for the winner only (was: raycast per candidate — heavy on big worlds).
    if (this.isEmissiveOccluded(camera, this.worldPosition)) {
      this.emissiveTargetVisibility = 0;
      this.emissiveVisibility = THREE.MathUtils.damp(this.emissiveVisibility, 0, 20, delta);
      if (this.emissiveVisibility <= 0.002) {
        this.hideEmissive();
      }
      return;
    }

    this.projected.copy(this.worldPosition).project(camera);
    const sunX = (this.projected.x * 0.5 + 0.5) * viewportWidth;
    const sunY = (-this.projected.y * 0.5 + 0.5) * viewportHeight;
    this.center.set(viewportWidth * 0.5, viewportHeight * 0.5);
    this.sunScreen.set(sunX, sunY);
    const distanceFromCenter = this.center.distanceTo(this.sunScreen) / Math.max(viewportWidth, viewportHeight);
    const edgeFade = THREE.MathUtils.clamp(1 - distanceFromCenter * 0.95, 0, 1);
    const boundsFade = THREE.MathUtils.clamp(1.15 - Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y)), 0, 1);

    const emissiveGain = THREE.MathUtils.clamp(bestScore * 1.15, 0, 1) * this.intensity * 0.72;
    this.emissiveTargetVisibility = emissiveGain * edgeFade * boundsFade;

    const fadeSpeed = this.emissiveTargetVisibility < this.emissiveVisibility ? 22 : 8;
    this.emissiveVisibility = THREE.MathUtils.damp(
      this.emissiveVisibility,
      this.emissiveTargetVisibility,
      fadeSpeed,
      delta,
    );

    if (this.emissiveVisibility <= 0.008) {
      this.hideEmissive();
      return;
    }

    const tint = c.color ?? '#e2f4ff';
    if (tint !== this.lastEmissiveColor) {
      this.lastEmissiveColor = tint;
      applyFlareColor(this.emissive.root, this.emissive.orbs, tint, [0.9, 0.5], false);
    }

    this.emissive.root.classList.add('is-visible');
    this.emissive.root.style.opacity = this.emissiveVisibility.toFixed(3);

    this.placeFlareElements(
      this.emissive,
      sunX,
      sunY,
      viewportWidth,
      viewportHeight,
      distanceFromCenter,
      this.emissiveVisibility,
      EMISSIVE_ORB_SCALE,
    );
  }

  private placeFlareElements(
    elements: FlareElements,
    sunX: number,
    sunY: number,
    viewportWidth: number,
    viewportHeight: number,
    distanceFromCenter: number,
    visibility: number,
    globalScale: number,
  ): void {
    const dirX = this.center.x - sunX;
    const dirY = this.center.y - sunY;
    const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    const dirLen = Math.hypot(dirX, dirY) || 1;
    const perpX = (-dirY / dirLen) * 140;
    const perpY = (dirX / dirLen) * 140;
    const distanceNorm = THREE.MathUtils.clamp(distanceFromCenter, 0, 1);
    const shimmer = 0.96 + Math.sin(this.getNowSeconds() * 2.2) * 0.02;

    const g = globalScale;
    const sunAxisFlare = elements.prism != null;
    const orbChainBoost = sunAxisFlare ? 1.24 : 1;

    if (sunAxisFlare) {
      this.placeOrb(elements.halo, sunX, sunY, (1.05 + visibility * 0.48) * g, 0);
      this.placeOrb(elements.ring, sunX, sunY, (0.98 + visibility * 0.28) * g, 0);
    } else {
      this.placeOrb(
        elements.halo,
        sunX,
        sunY,
        (1.05 + visibility * 0.48) * g,
        0.78 * visibility,
      );
      this.placeOrb(
        elements.ring,
        sunX,
        sunY,
        (0.98 + visibility * 0.28) * g,
        0.28 * visibility,
      );
    }

    ORBS.forEach((orb, index) => {
      const el = elements.orbs[index];
      const x = sunX + dirX * orb.ratio;
      const y = sunY + dirY * orb.ratio;
      const scale = shimmer * (0.88 + visibility * orb.scaleBoost * (1 - orb.ratio * 0.18)) * g;

      const onSunDisk = sunAxisFlare && orb.ratio < 0.02;
      const orbMul = onSunDisk ? 0 : orbChainBoost;

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = String(
        Math.min(
          1,
          orb.opacity * visibility * 1.12 * orbMul * (1 - distanceNorm * 0.14),
        ),
      );
      el.style.transform = `translate(-50%, -50%) scale(${scale})`;
    });

    const streakDim = sunAxisFlare ? 0 : 1;
    const streakW = sunAxisFlare ? 0.28 : 1;
    const streakWidth = viewportWidth * (0.58 + visibility * 0.12) * g * streakW;
    this.placeStreak(
      elements.streakPrimary,
      sunX,
      sunY,
      angle,
      streakWidth,
      0.72 * visibility * streakDim,
      1.12 * g,
    );
    this.placeStreak(
      elements.streakSecondary,
      sunX,
      sunY,
      angle + 90,
      viewportWidth * 0.26 * g * streakW,
      0.3 * visibility * streakDim * 0.85,
      (0.95 + visibility * 0.22) * g,
    );

    const edgeFade = THREE.MathUtils.clamp(1 - distanceFromCenter * 0.92, 0, 1);
    const dirtDriftX = dirX * 0.04;
    const dirtDriftY = dirY * 0.04;
    elements.dirt.style.opacity = String(0.26 * visibility * (0.65 + edgeFade * 0.35));
    elements.dirt.style.transform = `translate(${dirtDriftX.toFixed(2)}px, ${dirtDriftY.toFixed(2)}px) scale(${1 + visibility * 0.04})`;

    const v = visibility;
    const edge = (1 - distanceNorm * 0.14) * v;

    if (elements.sunGhostSparkA) {
      const r = 0.08;
      elements.sunGhostSparkA.style.left = `${sunX + dirX * r}px`;
      elements.sunGhostSparkA.style.top = `${sunY + dirY * r}px`;
      elements.sunGhostSparkA.style.opacity = String(0.55 * edge);
      elements.sunGhostSparkA.style.transform = `translate(-50%, -50%) scale(${0.9 + v * 0.2})`;
    }
    if (elements.sunGhostWarmLg) {
      const r = 0.2;
      elements.sunGhostWarmLg.style.left = `${sunX + dirX * r}px`;
      elements.sunGhostWarmLg.style.top = `${sunY + dirY * r}px`;
      elements.sunGhostWarmLg.style.opacity = '0';
      elements.sunGhostWarmLg.style.transform = `translate(-50%, -50%) scale(${0.92 + v * 0.15})`;
    }
    if (elements.sunGhostFaintA) {
      const r = 0.12;
      elements.sunGhostFaintA.style.left = `${sunX + dirX * r + perpX * 0.55}px`;
      elements.sunGhostFaintA.style.top = `${sunY + dirY * r + perpY * 0.55}px`;
      elements.sunGhostFaintA.style.opacity = String(0.85 * edge);
      elements.sunGhostFaintA.style.transform = `translate(-50%, -50%) scale(${1.05 + v * 0.08})`;
    }
    const greenGhostFar = 1.36;
    const ggx = sunX + dirX * greenGhostFar;
    const ggy = sunY + dirY * greenGhostFar;
    if (elements.greenGhostHalo) {
      elements.greenGhostHalo.style.left = `${ggx}px`;
      elements.greenGhostHalo.style.top = `${ggy}px`;
      elements.greenGhostHalo.style.opacity = String(0.5 * edge);
      elements.greenGhostHalo.style.transform = `translate(-50%, -50%) scale(${0.96 + v * 0.12})`;
    }
    if (elements.sunGhostWarmMd) {
      const r = 0.76;
      elements.sunGhostWarmMd.style.left = `${sunX + dirX * r}px`;
      elements.sunGhostWarmMd.style.top = `${sunY + dirY * r}px`;
      elements.sunGhostWarmMd.style.opacity = String(0.48 * edge);
      elements.sunGhostWarmMd.style.transform = `translate(-50%, -50%) scale(${0.9 + v * 0.12})`;
    }
    if (elements.sunGhostPurple) {
      const r = 1.06;
      elements.sunGhostPurple.style.left = `${sunX + dirX * r}px`;
      elements.sunGhostPurple.style.top = `${sunY + dirY * r}px`;
      elements.sunGhostPurple.style.opacity = String(0.5 * edge);
      elements.sunGhostPurple.style.transform = `translate(-50%, -50%) rotate(${angle + 18}deg) scale(${0.95 + v * 0.1})`;
    }
    if (elements.prism) {
      const pr = 2.14;
      const prismX = sunX + dirX * pr;
      const prismY = sunY + dirY * pr;
      const halfDiag = Math.hypot(viewportWidth, viewportHeight) * 0.5;
      const distFromScreenCenter = Math.hypot(prismX - this.center.x, prismY - this.center.y);
      const radialT = THREE.MathUtils.clamp(distFromScreenCenter / (halfDiag * 0.32), 0, 1);
      const prismCenterFade = radialT * radialT * (3 - 2 * radialT);
      /** 0 when sun is near viewport center, 1 when sun sits out toward the edges (full “hero” prism). */
      const prismSunEdge = THREE.MathUtils.smoothstep(distanceNorm, 0.1, 0.34);
      const prismOpacityMul = THREE.MathUtils.lerp(0.2, 1, prismSunEdge);
      const prismLenMul = THREE.MathUtils.lerp(0.48, 1, prismSunEdge);
      const prismThickMul = THREE.MathUtils.lerp(0.36, 1, prismSunEdge);
      const baseS = 1.1 + v * 0.18;
      const sx = baseS * prismLenMul;
      const sy = baseS * prismThickMul;
      elements.prism.style.left = `${prismX}px`;
      elements.prism.style.top = `${prismY}px`;
      elements.prism.style.opacity = String(0.78 * edge * prismCenterFade * prismOpacityMul);
      elements.prism.style.transform = `translate(-50%, -50%) rotate(${angle}deg) skewX(-12deg) scale(${sx}, ${sy})`;
    }
    if (elements.sunGhostFaintB) {
      const r = 0.36;
      elements.sunGhostFaintB.style.left = `${sunX + dirX * r - perpX * 0.45}px`;
      elements.sunGhostFaintB.style.top = `${sunY + dirY * r - perpY * 0.45}px`;
      elements.sunGhostFaintB.style.opacity = String(0.75 * edge);
      elements.sunGhostFaintB.style.transform = `translate(-50%, -50%) scale(${1.1 + v * 0.06})`;
    }
    if (elements.sunGhostSparkB) {
      const r = 0.98;
      elements.sunGhostSparkB.style.left = `${sunX + dirX * r}px`;
      elements.sunGhostSparkB.style.top = `${sunY + dirY * r}px`;
      elements.sunGhostSparkB.style.opacity = String(0.5 * edge);
      elements.sunGhostSparkB.style.transform = `translate(-50%, -50%) scale(${0.85 + v * 0.15})`;
    }
  }

  /** Sun: same world raycast as emissive; meshes tagged `userData.lensflare === 'no-occlusion'` are skipped. */
  private checkSunOcclusion(camera: THREE.Camera, worldTarget: THREE.Vector3): boolean {
    const list = this.occlusionObjects;
    if (!list || list.length === 0) {
      return false;
    }

    const dist = camera.position.distanceTo(worldTarget);
    if (dist < 0.001) {
      return false;
    }

    this.rayDirection.copy(worldTarget).sub(camera.position).normalize();
    this.raycaster.set(camera.position, this.rayDirection);
    this.raycaster.near = 0.02;
    this.raycaster.far = dist;
    this.intersections.length = 0;
    this.raycaster.intersectObjects(list, true, this.intersections);
    return this.intersections.some(
      (hit) => hit.object.visible !== false && hit.object.userData?.lensflare !== 'no-occlusion',
    );
  }

  /**
   * Ground props: the ray always hits the mesh near the anchor, which wrongly occluded every emissive.
   * Only treat hits clearly *in front* of the anchor as blocking.
   */
  private isEmissiveOccluded(camera: THREE.Camera, worldTarget: THREE.Vector3): boolean {
    if (!this.occlusionObjects || this.occlusionObjects.length === 0) {
      return false;
    }

    const distToTarget = camera.position.distanceTo(worldTarget);
    if (distToTarget < 0.05) {
      return false;
    }

    this.rayDirection.copy(worldTarget).sub(camera.position).normalize();
    this.raycaster.set(camera.position, this.rayDirection);
    this.raycaster.near = 0.02;
    this.raycaster.far = distToTarget;
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.occlusionObjects, true, this.intersections);

    const cutoff = distToTarget - EMISSIVE_OCCLUSION_MARGIN;
    for (const hit of this.intersections) {
      if (hit.object.visible === false) {
        continue;
      }
      if (hit.object.userData?.lensflare === 'no-occlusion') {
        continue;
      }
      if (hit.distance < cutoff) {
        return true;
      }
    }
    return false;
  }

  private placeOrb(element: HTMLDivElement, x: number, y: number, scale: number, opacity: number): void {
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.opacity = String(opacity);
    element.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  private placeStreak(
    element: HTMLDivElement,
    x: number,
    y: number,
    angle: number,
    width: number,
    opacity: number,
    scale: number,
  ): void {
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.width = `${width}px`;
    element.style.opacity = String(opacity);
    element.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;
  }

  private getNowSeconds(): number {
    const nowMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = nowMs;
    }

    return nowMs / 1000;
  }
}

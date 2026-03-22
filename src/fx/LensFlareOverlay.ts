import * as THREE from 'three';

type OrbDef = {
  ratio: number;
  size: number;
  blur: number;
  opacity: number;
  scaleBoost: number;
};

const ORBS: OrbDef[] = [
  { ratio: 0, size: 220, blur: 1, opacity: 1, scaleBoost: 0.46 },
  { ratio: 0.14, size: 68, blur: 0, opacity: 0.34, scaleBoost: 0.18 },
  { ratio: 0.3, size: 128, blur: 3, opacity: 0.18, scaleBoost: 0.24 },
  { ratio: 0.54, size: 88, blur: 1, opacity: 0.2, scaleBoost: 0.15 },
  { ratio: 0.82, size: 156, blur: 5, opacity: 0.12, scaleBoost: 0.28 },
  { ratio: 1.12, size: 94, blur: 0, opacity: 0.18, scaleBoost: 0.12 },
];

export class LensFlareOverlay {
  private readonly root: HTMLDivElement;
  private readonly dirt: HTMLDivElement;
  private readonly halo: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly streakPrimary: HTMLDivElement;
  private readonly streakSecondary: HTMLDivElement;
  private readonly orbs: HTMLDivElement[] = [];
  private readonly projected = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly center = new THREE.Vector2();
  private readonly sunScreen = new THREE.Vector2();
  private readonly rayDirection = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private occlusionObjects: THREE.Object3D[] | null = null;
  private color = '#ffdba0';
  private intensity = 1;
  private visibility = 0;
  private targetVisibility = 0;
  private lastUpdateTime = 0;
  private lastOcclusionCheckTime = 0;
  private occluded = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'lens-flare-root';

    this.dirt = document.createElement('div');
    this.dirt.className = 'lens-flare-dirt';
    this.root.append(this.dirt);

    this.halo = document.createElement('div');
    this.halo.className = 'lens-flare-halo';
    this.root.append(this.halo);

    this.ring = document.createElement('div');
    this.ring.className = 'lens-flare-ring';
    this.root.append(this.ring);

    this.streakPrimary = document.createElement('div');
    this.streakPrimary.className = 'lens-flare-streak lens-flare-streak--primary';
    this.root.append(this.streakPrimary);

    this.streakSecondary = document.createElement('div');
    this.streakSecondary.className = 'lens-flare-streak lens-flare-streak--secondary';
    this.root.append(this.streakSecondary);

    for (const orb of ORBS) {
      const element = document.createElement('div');
      element.className = 'lens-flare-orb';
      element.style.width = `${orb.size}px`;
      element.style.height = `${orb.size}px`;
      element.style.filter = `blur(${orb.blur}px)`;
      this.orbs.push(element);
      this.root.append(element);
    }

    mount.append(this.root);
    this.setColor(this.color);
  }

  setColor(hex: string): void {
    this.color = hex;
    const color = new THREE.Color(hex);
    const rgb = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;
    const strong = `rgba(${rgb}, 0.84)`;
    const mid = `rgba(${rgb}, 0.34)`;
    const soft = `rgba(${rgb}, 0.14)`;

    this.root.style.setProperty('--lens-flare-strong', strong);
    this.root.style.setProperty('--lens-flare-mid', mid);
    this.root.style.setProperty('--lens-flare-soft', soft);
    this.root.style.setProperty('--lens-flare-rgb', rgb);

    this.orbs.forEach((orb, index) => {
      const alpha = index === 0 ? 0.92 : 0.52;
      orb.style.background = `radial-gradient(circle, rgba(255,255,255,${alpha}) 0%, ${strong} 20%, ${mid} 46%, ${soft} 68%, transparent 100%)`;
    });
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, value);
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
  ): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      this.hide();
      return;
    }

    this.worldPosition.copy(worldTarget);
    this.projected.copy(this.worldPosition).project(camera);

    const inFront = this.projected.z > -1 && this.projected.z < 1;
    const inBounds = Math.abs(this.projected.x) < 1.4 && Math.abs(this.projected.y) < 1.4;

    if (!inFront || !inBounds) {
      this.targetVisibility = 0;
      this.visibility = THREE.MathUtils.damp(this.visibility, 0, 18, delta);
      if (this.visibility <= 0.002) {
        this.hide();
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
    const baseVisibility = edgeFade * boundsFade * this.intensity;

    this.updateOcclusion(camera, worldTarget);
    this.targetVisibility = this.occluded ? 0 : baseVisibility;

    const fadeSpeed = this.targetVisibility < this.visibility ? 18 : 6;
    this.visibility = THREE.MathUtils.damp(this.visibility, this.targetVisibility, fadeSpeed, delta);

    if (this.visibility <= 0.01) {
      this.hide();
      return;
    }

    this.root.classList.add('is-visible');
    this.root.style.opacity = this.visibility.toFixed(3);

    const dirX = this.center.x - sunX;
    const dirY = this.center.y - sunY;
    const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    const distanceNorm = THREE.MathUtils.clamp(distanceFromCenter, 0, 1);
    const shimmer = 0.96 + Math.sin(this.getNowSeconds() * 2.2) * 0.02;

    this.placeOrb(this.halo, sunX, sunY, 1.08 + this.visibility * 0.45, 0.72 * this.visibility);
    this.placeOrb(this.ring, sunX, sunY, 0.94 + this.visibility * 0.26, 0.3 * this.visibility);

    ORBS.forEach((orb, index) => {
      const element = this.orbs[index];
      const x = sunX + dirX * orb.ratio;
      const y = sunY + dirY * orb.ratio;
      const scale = shimmer * (0.82 + this.visibility * orb.scaleBoost * (1 - orb.ratio * 0.22));

      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.opacity = String(orb.opacity * this.visibility * (1 - distanceNorm * 0.2));
      element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    });

    const streakWidth = viewportWidth * (0.46 + this.visibility * 0.08);
    this.placeStreak(this.streakPrimary, sunX, sunY, angle, streakWidth, 0.52 * this.visibility, 1);
    this.placeStreak(
      this.streakSecondary,
      sunX,
      sunY,
      angle + 90,
      viewportWidth * 0.19,
      0.18 * this.visibility,
      0.86 + this.visibility * 0.18,
    );

    const dirtDriftX = dirX * 0.04;
    const dirtDriftY = dirY * 0.04;
    this.dirt.style.opacity = String(0.16 * this.visibility * (0.65 + edgeFade * 0.35));
    this.dirt.style.transform = `translate(${dirtDriftX.toFixed(2)}px, ${dirtDriftY.toFixed(2)}px) scale(${1 + this.visibility * 0.04})`;
  }

  hide(): void {
    this.root.classList.remove('is-visible');
    this.root.style.opacity = '0';
  }

  private updateOcclusion(camera: THREE.Camera, worldTarget: THREE.Vector3): void {
    if (!this.occlusionObjects || this.occlusionObjects.length === 0) {
      this.occluded = false;
      return;
    }

    const now = this.getNowSeconds();
    if (now - this.lastOcclusionCheckTime < 0.075) {
      return;
    }

    this.lastOcclusionCheckTime = now;
    this.rayDirection.copy(worldTarget).sub(camera.position).normalize();
    this.raycaster.set(camera.position, this.rayDirection);
    this.raycaster.far = camera.position.distanceTo(worldTarget);
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.occlusionObjects, true, this.intersections);
    this.occluded = this.intersections.some(
      (hit) => hit.object.visible !== false && hit.object.userData?.lensflare !== 'no-occlusion',
    );
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

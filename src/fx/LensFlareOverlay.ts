import * as THREE from 'three';

type OrbDef = {
  ratio: number;
  size: number;
  blur: number;
  opacity: number;
};

const ORBS: OrbDef[] = [
  { ratio: 0, size: 170, blur: 2, opacity: 1 },
  { ratio: 0.22, size: 72, blur: 0, opacity: 0.34 },
  { ratio: 0.48, size: 112, blur: 1, opacity: 0.2 },
  { ratio: 0.82, size: 58, blur: 0, opacity: 0.24 },
  { ratio: 1.08, size: 138, blur: 4, opacity: 0.12 },
];

export class LensFlareOverlay {
  private readonly root: HTMLDivElement;
  private readonly streak: HTMLDivElement;
  private readonly orbs: HTMLDivElement[] = [];
  private readonly projected = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly center = new THREE.Vector2();
  private readonly sunScreen = new THREE.Vector2();
  private color = '#ffdba0';
  private intensity = 1;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'lens-flare-root';

    this.streak = document.createElement('div');
    this.streak.className = 'lens-flare-streak';
    this.root.append(this.streak);

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
    const strong = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
      color.b * 255,
    )}, 0.82)`;
    const soft = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
      color.b * 255,
    )}, 0.18)`;

    this.streak.style.background = `linear-gradient(90deg, transparent 0%, ${soft} 18%, ${strong} 50%, ${soft} 82%, transparent 100%)`;

    this.orbs.forEach((orb, index) => {
      const alpha = index === 0 ? 0.8 : 0.4;
      orb.style.background = `radial-gradient(circle, rgba(255,255,255,${alpha}) 0%, ${strong} 24%, ${soft} 55%, transparent 100%)`;
    });
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, value);
  }

  update(
    camera: THREE.Camera,
    worldTarget: THREE.Vector3,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      this.hide();
      return;
    }

    this.worldPosition.copy(worldTarget);
    this.projected.copy(this.worldPosition).project(camera);

    const inFront = this.projected.z > -1 && this.projected.z < 1;
    const inBounds = Math.abs(this.projected.x) < 1.35 && Math.abs(this.projected.y) < 1.35;

    if (!inFront || !inBounds) {
      this.hide();
      return;
    }

    const sunX = (this.projected.x * 0.5 + 0.5) * viewportWidth;
    const sunY = (-this.projected.y * 0.5 + 0.5) * viewportHeight;

    this.center.set(viewportWidth * 0.5, viewportHeight * 0.5);
    this.sunScreen.set(sunX, sunY);

    const distanceFromCenter = this.center.distanceTo(this.sunScreen) / Math.max(viewportWidth, viewportHeight);
    const visibility = THREE.MathUtils.clamp((1 - distanceFromCenter * 0.9) * this.intensity, 0, 1);

    if (visibility <= 0.02) {
      this.hide();
      return;
    }

    this.root.classList.add('is-visible');
    this.root.style.opacity = visibility.toFixed(3);

    const dirX = this.center.x - sunX;
    const dirY = this.center.y - sunY;

    ORBS.forEach((orb, index) => {
      const element = this.orbs[index];
      const x = sunX + dirX * orb.ratio;
      const y = sunY + dirY * orb.ratio;
      const scale = 0.8 + visibility * 0.35 * (1 - orb.ratio * 0.4);

      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.opacity = String(orb.opacity * visibility);
      element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    });

    const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    this.streak.style.left = `${sunX}px`;
    this.streak.style.top = `${sunY}px`;
    this.streak.style.width = `${viewportWidth * 0.42}px`;
    this.streak.style.opacity = String(0.55 * visibility);
    this.streak.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${0.86 + visibility * 0.4})`;
  }

  hide(): void {
    this.root.classList.remove('is-visible');
    this.root.style.opacity = '0';
  }
}

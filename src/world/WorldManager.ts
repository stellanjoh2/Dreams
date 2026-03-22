import * as THREE from 'three';
import type { FxSettings } from '../fx/FxSettings';
import { isFresnelCapableMaterial, updateFresnelMaterial } from '../materials/FresnelMaterial';
import { PropFactory } from './PropFactory';
import { AmbientDustSystem } from './AmbientDustSystem';
import { TerrainGenerator } from './TerrainGenerator';
import { TerrainPhysics } from './TerrainPhysics';
import { PATH_PADS } from './TerrainLayout';
import type { CrystalInstance } from '../systems/CrystalSystem';

export class WorldManager {
  readonly scene = new THREE.Scene();

  private readonly worldRoot = new THREE.Group();
  private readonly props = new PropFactory();
  private readonly ambientDust = new AmbientDustSystem();
  private readonly terrain = new TerrainGenerator();
  private readonly terrainPhysics = new TerrainPhysics();
  private readonly driftingClouds: THREE.Object3D[] = [];
  private readonly sunAnchor = new THREE.Vector3(32, 42, -84);
  private readonly sunTargetPosition = new THREE.Vector3(0, 4, 10);

  private sunMesh?: THREE.Mesh;
  private skyDome?: THREE.Mesh;
  private ambientLight?: THREE.AmbientLight;
  private hemiLight?: THREE.HemisphereLight;
  private sunLight?: THREE.DirectionalLight;
  private sunLightTarget?: THREE.Object3D;
  private coolLight?: THREE.PointLight;
  private readonly sunWorldPosition = new THREE.Vector3();
  private readonly respawnPoints = PATH_PADS.map(
    ([x, y, z, , sy]) => new THREE.Vector3(x, y + sy * 0.5 + 0.04, z),
  );
  private readonly terrainSnapPosition = new THREE.Vector3();
  private readonly terrainSnapNormal = new THREE.Vector3();
  private readonly terrainSnapUp = new THREE.Vector3(0, 1, 0);
  private readonly terrainSnapLocal = new THREE.Vector3();
  private readonly terrainSnapAlignQuaternion = new THREE.Quaternion();
  private readonly terrainSnapYawQuaternion = new THREE.Quaternion();
  private readonly terrainSnapIdentityQuaternion = new THREE.Quaternion();
  private nextRespawnIndex = 0;

  constructor() {
    this.scene.add(this.worldRoot);
  }

  build(settings: FxSettings): CrystalInstance[] {
    this.scene.background = new THREE.Color('#8fb7ff');
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(settings.atmosphere.skyColor),
      settings.atmosphere.fogDensity,
    );

    this.buildSkyDome();
    this.buildLights(settings);
    this.buildSun();
    this.worldRoot.add(this.terrain.createGround());
    this.buildLandmarks();
    this.buildClouds();
    this.worldRoot.add(this.ambientDust.points);
    this.ambientDust.applySettings(settings.particles);

    return this.buildCrystals();
  }

  update(delta: number, elapsed: number): void {
    for (const [index, cloud] of this.driftingClouds.entries()) {
      cloud.position.x += delta * (0.18 + index * 0.015);
      cloud.position.z += Math.sin(elapsed * 0.1 + index) * delta * 0.2;
      cloud.position.y += Math.sin(elapsed * 0.25 + index * 1.2) * delta * 0.04;

      if (cloud.position.x > 52) {
        cloud.position.x = -52;
      }
    }

    if (this.sunMesh) {
      const pulse = 1 + Math.sin(elapsed * 0.45) * 0.03;
      this.sunMesh.scale.setScalar(0.38 * pulse);
    }

    this.ambientDust.update(elapsed);
  }

  applyFxSettings(settings: FxSettings): void {
    this.scene.background = new THREE.Color('#8fb7ff');

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(settings.atmosphere.skyColor);
      this.scene.fog.density = settings.atmosphere.fogDensity;
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = settings.atmosphere.ambientIntensity;
    }

    if (this.hemiLight) {
      this.hemiLight.intensity = settings.atmosphere.hemiIntensity;
    }

    if (this.sunMesh?.material instanceof THREE.MeshBasicMaterial) {
      this.sunMesh.material.color.set('#fff3be');
    }

    if (this.sunLight) {
      this.sunLight.intensity = 2.8 * settings.atmosphere.sunGlow;
      this.sunLight.color.set('#ffe6b0');
    }

    this.ambientDust.applySettings(settings.particles);

    this.worldRoot.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];

      materials.forEach((material: THREE.Material) => {
        if (material && isFresnelCapableMaterial(material)) {
          updateFresnelMaterial(
            material,
            settings.fresnel.color,
            settings.fresnel.strength,
            settings.fresnel.radius,
          );
        }
      });
    });
  }

  getSunWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.sunMesh) {
      return target.set(0, 26, -90);
    }

    this.sunMesh.getWorldPosition(this.sunWorldPosition);
    return target.copy(this.sunWorldPosition);
  }

  getGroundHeightAt(x: number, z: number): number | null {
    return this.terrainPhysics.getGroundHeightAt(x, z);
  }

  resolveTerrainCollisions(position: THREE.Vector3, radius: number, grounded: boolean): void {
    this.terrainPhysics.resolvePlayerCollisions(position, radius, grounded);
  }

  getRespawnPoint(target = new THREE.Vector3()): THREE.Vector3 {
    const point = this.respawnPoints[this.nextRespawnIndex % this.respawnPoints.length];
    this.nextRespawnIndex += 1;
    return target.copy(point);
  }

  private buildLights(settings: FxSettings): void {
    this.ambientLight = new THREE.AmbientLight('#fff4fb', settings.atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(
      '#8eb2ff',
      '#ffc1de',
      settings.atmosphere.hemiIntensity,
    );
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#ffe6b0', 2.8 * settings.atmosphere.sunGlow);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1536, 1536);
    this.sunLight.shadow.bias = -0.00008;
    this.sunLight.shadow.normalBias = 0.01;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 180;
    this.sunLight.shadow.camera.left = -90;
    this.sunLight.shadow.camera.right = 90;
    this.sunLight.shadow.camera.top = 90;
    this.sunLight.shadow.camera.bottom = -90;
    this.scene.add(this.sunLight);

    this.sunLightTarget = new THREE.Object3D();
    this.sunLightTarget.position.copy(this.sunTargetPosition);
    this.scene.add(this.sunLightTarget);
    this.sunLight.target = this.sunLightTarget;
    this.syncSunLighting();

    this.coolLight = new THREE.PointLight('#8ebeff', 1.8, 140, 2);
    this.coolLight.position.set(22, 12, 16);
    this.scene.add(this.coolLight);
  }

  private buildSun(): void {
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(7.8, 28, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#fff3be'),
      }),
    );
    this.sunMesh.scale.setScalar(0.38);
    this.sunMesh.position.copy(this.sunAnchor);
    this.scene.add(this.sunMesh);
  }

  private buildSkyDome(): void {
    const skyTexture = this.createSkyGradientTexture();
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });

    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 28), skyMaterial);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);
  }

  private buildLandmarks(): void {
    this.buildPinkGrove();
    this.buildCrystalValley();
    this.buildSunClearing();
    this.buildSilentRocks();
  }

  private buildPinkGrove(): void {
    const grove = new THREE.Group();
    grove.position.set(-24, 0, -12);

    const colors = ['#ff9fd5', '#ffc6e6', '#ffcf9f'];

    for (let index = 0; index < 9; index += 1) {
      const rock = this.props.createCandyRock(colors[index % colors.length], [
        3 + (index % 3),
        2 + (index % 2) * 1.1,
        2.6 + (index % 4) * 0.45,
      ]);
      const localX = (index % 3) * 6 - 6;
      const localZ = Math.floor(index / 3) * 5 - 5;
      this.placeObjectOnTerrain(
        grove,
        rock,
        grove.position.x + localX,
        grove.position.z + localZ,
        rock.scale.y * 0.48,
        index * 0.42,
        0.28,
      );
      grove.add(rock);
    }

    for (let index = 0; index < 5; index += 1) {
      const tree = this.props.createTree('#ffe1b5', '#ff9bd3');
      const localX = -9 + index * 4.5;
      const localZ = -8 + (index % 2) * 5;
      this.placeObjectOnTerrain(
        grove,
        tree,
        grove.position.x + localX,
        grove.position.z + localZ,
        0,
        index * 0.58,
        0.18,
      );
      grove.add(tree);
    }

    this.worldRoot.add(grove);
  }

  private buildCrystalValley(): void {
    const valley = new THREE.Group();
    valley.position.set(18, 0, -16);

    for (let index = 0; index < 7; index += 1) {
      const monolith = this.props.createMonolith('#88a1ff', [
        2 + (index % 2) * 0.7,
        5 + (index % 3) * 2.3,
        2 + (index % 4) * 0.6,
      ]);
      const localX = index * 3.8 - 10;
      const localZ = Math.sin(index) * 6;
      this.placeObjectOnTerrain(
        valley,
        monolith,
        valley.position.x + localX,
        valley.position.z + localZ,
        monolith.scale.y * 0.5,
        index * 0.35,
        0.12,
      );
      valley.add(monolith);
    }

    this.worldRoot.add(valley);
  }

  private buildSunClearing(): void {
    const clearing = new THREE.Group();
    clearing.position.set(4, 0, 22);

    for (let index = 0; index < 8; index += 1) {
      const cactus = this.props.createCactus(index % 2 === 0 ? '#5d93a5' : '#7eb38e');
      cactus.scale.setScalar(0.8 + (index % 3) * 0.24);
      const localX = -16 + index * 4.4;
      const localZ = Math.sin(index * 0.6) * 7;
      this.placeObjectOnTerrain(
        clearing,
        cactus,
        clearing.position.x + localX,
        clearing.position.z + localZ,
        0,
        index * 0.44,
        0.22,
      );
      clearing.add(cactus);
    }

    for (let index = 0; index < 5; index += 1) {
      const rock = this.props.createCandyRock(index % 2 === 0 ? '#ffd18d' : '#ffab91', [
        1.6 + index * 0.35,
        1.4,
        1.7 + index * 0.4,
      ]);
      const localX = -10 + index * 5.5;
      const localZ = -7 + index * 3.2;
      this.placeObjectOnTerrain(
        clearing,
        rock,
        clearing.position.x + localX,
        clearing.position.z + localZ,
        rock.scale.y * 0.48,
        index * 0.39,
        0.26,
      );
      clearing.add(rock);
    }

    this.worldRoot.add(clearing);
  }

  private buildSilentRocks(): void {
    const rocks = new THREE.Group();
    rocks.position.set(-18, 0, 22);

    const layout = [
      [-8, 6, -4],
      [-2, 9, 2],
      [5, 7, -1],
      [10, 11, 5],
      [2, 5, 8],
    ] as const;

    for (const [x, height, z] of layout) {
      const monolith = this.props.createMonolith('#cfd6ff', [2.1, height, 2.2]);
      this.placeObjectOnTerrain(
        rocks,
        monolith,
        rocks.position.x + x,
        rocks.position.z + z,
        height * 0.5,
        x * 0.08,
        0.1,
      );
      rocks.add(monolith);
    }

    this.worldRoot.add(rocks);
  }

  private buildClouds(): void {
    const cloudPositions = [
      [-26, 19, -18],
      [4, 18, -8],
      [26, 21, 3],
      [14, 16, 18],
      [-8, 22, 14],
    ] as const;

    for (const [x, y, z] of cloudPositions) {
      const cloud = this.props.createCloud('#fff1ff');
      cloud.position.set(x, y, z);
      cloud.scale.setScalar((1.3 + (x + z) * 0.005) * 2.2);
      this.driftingClouds.push(cloud);
      this.worldRoot.add(cloud);
    }
  }

  private placeObjectOnTerrain(
    parent: THREE.Group,
    object: THREE.Object3D,
    worldX: number,
    worldZ: number,
    heightOffset: number,
    yaw: number,
    tiltAmount: number,
  ): void {
    const sample = this.terrainPhysics.getNearestSpawnSurface(worldX, worldZ);

    if (!sample) {
      object.position.set(worldX - parent.position.x, heightOffset, worldZ - parent.position.z);
      object.rotation.y = yaw;
      return;
    }

    this.terrainSnapPosition.copy(sample.position);
    this.terrainSnapPosition.y += heightOffset;
    this.terrainSnapLocal.copy(this.terrainSnapPosition).sub(parent.position);
    object.position.copy(this.terrainSnapLocal);

    this.terrainSnapNormal.copy(sample.normal);
    this.terrainSnapAlignQuaternion.setFromUnitVectors(this.terrainSnapUp, this.terrainSnapNormal);
    this.terrainSnapIdentityQuaternion.identity().slerp(this.terrainSnapAlignQuaternion, tiltAmount);
    this.terrainSnapYawQuaternion.setFromAxisAngle(this.terrainSnapUp, yaw);
    object.quaternion.copy(this.terrainSnapIdentityQuaternion).multiply(this.terrainSnapYawQuaternion);
  }

  private syncSunLighting(): void {
    if (!this.sunLight || !this.sunLightTarget) {
      return;
    }

    this.sunLight.position.copy(this.sunAnchor);
    this.sunLightTarget.position.copy(this.sunTargetPosition);
    this.sunLight.target.updateMatrixWorld();
  }

  private createSkyGradientTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 512;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Candy Lands could not create the sky gradient context.');
    }

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#5f95ff');
    gradient.addColorStop(0.28, '#8fa7ff');
    gradient.addColorStop(0.62, '#d3b4ff');
    gradient.addColorStop(1, '#ffbfdc');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildCrystals(): CrystalInstance[] {
    const placements = [
      [-8, 8, '#9af6ff'],
      [-20, -10, '#ffb7fb'],
      [17, -14, '#84b7ff'],
      [25, 6, '#98fff1'],
      [5, 28, '#ffd4ff'],
      [-14, 24, '#c7f1ff'],
      [11, 15, '#9bf4ff'],
    ] as const;

    return placements.map(([x, z, color], index) => {
      const crystal = this.props.createCrystal(color);
      this.placeObjectOnTerrain(
        this.worldRoot,
        crystal,
        x,
        z,
        1.18,
        index * 0.73,
        0.08,
      );
      this.worldRoot.add(crystal);

      const basePosition = crystal.position.clone();

      return {
        id: `crystal-${index}`,
        mesh: crystal,
        basePosition,
        collected: false,
        respawnAt: 0,
      };
    });
  }
}

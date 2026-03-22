import * as THREE from 'three';

let metallicFlakeOrmTexture: THREE.DataTexture | null = null;

const hashNoise = (x: number, y: number, seed: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const getMetallicFlakeOrmTextureBase = (): THREE.DataTexture => {
  if (metallicFlakeOrmTexture) {
    return metallicFlakeOrmTexture;
  }

  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = hashNoise(x * 0.7, y * 0.7, 0.31);
      const fine = hashNoise(x * 3.1, y * 3.1, 0.73);
      const sparkleMask = hashNoise(x * 5.7, y * 5.7, 1.91);
      const sparkle = sparkleMask > 0.82 ? (sparkleMask - 0.82) / 0.18 : 0;
      const microFlake = hashNoise(x * 11.3, y * 11.3, 2.41);
      const microSparkle = microFlake > 0.86 ? (microFlake - 0.86) / 0.14 : 0;
      const flakeBand = hashNoise(x * 17.8, y * 17.8, 3.11);
      const flakeAccent = flakeBand > 0.9 ? (flakeBand - 0.9) / 0.1 : 0;
      const combinedSparkle = THREE.MathUtils.clamp(
        sparkle * 0.95 + microSparkle * 0.9 + flakeAccent * 0.55,
        0,
        1,
      );

      // Green channel drives roughness, blue drives metalness.
      const roughness = THREE.MathUtils.clamp(
        0.76 + coarse * 0.055 - combinedSparkle * 0.48 + fine * 0.03,
        0,
        1,
      );
      const metalness = THREE.MathUtils.clamp(
        0.79 + coarse * 0.14 + combinedSparkle * 0.6 + fine * 0.07,
        0,
        1,
      );
      const index = (y * size + x) * 4;

      data[index] = 255;
      data[index + 1] = Math.round(roughness * 255);
      data[index + 2] = Math.round(metalness * 255);
      data[index + 3] = 255;
    }
  }

  metallicFlakeOrmTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  metallicFlakeOrmTexture.wrapS = THREE.RepeatWrapping;
  metallicFlakeOrmTexture.wrapT = THREE.RepeatWrapping;
  metallicFlakeOrmTexture.magFilter = THREE.LinearFilter;
  metallicFlakeOrmTexture.minFilter = THREE.LinearMipmapLinearFilter;
  metallicFlakeOrmTexture.generateMipmaps = true;
  metallicFlakeOrmTexture.needsUpdate = true;
  return metallicFlakeOrmTexture;
};

export const createMetallicFlakeOrmTexture = (repeat = 6): THREE.DataTexture => {
  const texture = getMetallicFlakeOrmTextureBase().clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(repeat, repeat);
  texture.needsUpdate = true;
  return texture;
};

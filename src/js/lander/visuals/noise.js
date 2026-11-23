// Hash-based value noise for building geometry and textures on the CPU.
// Deterministic per seed, no lookup tables, so any point can be sampled.

function hash(ix, iy, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x61c88647);
  h ^= Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1] on a unit lattice. */
export function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = fade(x - ix);
  const v = fade(y - iy);
  const a = hash(ix, iy, 0, seed);
  const b = hash(ix + 1, iy, 0, seed);
  const c = hash(ix, iy + 1, 0, seed);
  const d = hash(ix + 1, iy + 1, 0, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function noise3(x, y, z, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(y - iy);
  const w = fade(z - iz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const layer = (k) => {
    const a = hash(ix, iy, k, seed);
    const b = hash(ix + 1, iy, k, seed);
    const c = hash(ix, iy + 1, k, seed);
    const d = hash(ix + 1, iy + 1, k, seed);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  return lerp(layer(iz), layer(iz + 1), w);
}

/** Fractal sum of `octaves` of noise2, roughly in [-1, 1]. */
export function fbm2(x, y, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x, y, seed + i);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

export function fbm3(x, y, z, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z, seed + i);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged fractal in [0, 1]: sharp crests where the noise crosses zero. */
export function ridged2(x, y, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(noise2(x, y, seed + i));
    const s = r * r * weight;
    weight = Math.min(1, s * 2);
    sum += amp * s;
    norm += amp;
    x *= 2.1;
    y *= 2.1;
    amp *= 0.5;
  }
  return sum / norm;
}

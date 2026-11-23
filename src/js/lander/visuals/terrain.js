// The ground around the play plane, as a 3D heightfield.
//
// The sim only knows one line of ground: its profile on the plane (z = 0).
// This builds a landscape that holds that line exactly and keeps it readable
// from the camera:
//   - In front (z > 0) the ground runs toward the camera, built so every
//     point lands on screen below the profile at its screen x. Nothing in
//     front can hide the line the lander touches down on.
//   - Behind (z < 0) a short ledge drops off steeply, faster than the eye's
//     line of sight over it, so the profile reads as a crest against a near
//     ridge and far mountains. Those are authored by where they should land
//     on screen and lifted into world heights: real 3D terrain, shaped for
//     this camera.
//   - Around the pad the ground is flattened in both x and z for the pad
//     plate to sit on.
//
// Fine relief and albedo are added per pixel on the GPU (see
// `terrainMaterial`): gradient noise leans the shading normal, with each
// octave faded out once it is smaller than a few pixels so distant and
// grazing ground doesn't shimmer.
import * as THREE from "three";
import { PAD_WIDTH } from "../sim.js";
import { fbm2, ridged2 } from "./noise.js";
import { rng } from "../rng.js";

export const PAD_DEPTH = 60; // pad plate size along z

const FRONT_Z = 460; // nearest row, past the bottom of the frame
const BACK_Z = -6500; // farthest row, hidden behind the far range
const SPLIT_Z = -1100; // hidden valley between the near ridge and far range
const NEAR_COLUMNS = 400; // across the frame, from FRONT_Z to SPLIT_Z
const FAR_COLUMNS = 240; // beyond SPLIT_Z, where less detail shows
const MARGIN = 1.25; // rows are this much wider than the frustum, for shadows
const GROUND = 75; // nominal ground height, world y, for row spacing
const FRONT_LIFT = 40; // extra screen fall of the front ground: it rises toward the line
const LEDGE = 8; // world-flat ground behind the profile before the drop
const CREST_DROP = 90; // screen px the ground behind the crest drops away
const CREST_DROP_LENGTH = 35;
const PIXELS_PER_ROW = 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Smooth maximum of a and b, blending over k.
const smoothMax = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
};

/** `profile` sampled per px over [0, width] and box-blurred twice. */
function blurProfile(profile, width, radius) {
  let a = Float32Array.from({ length: width + 1 }, (_, x) => profile(x));
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let x = 0; x <= width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[clamp(x + k, 0, width)];
      b[x] = sum / (2 * radius + 1);
    }
    a = b;
  }
  return (x) => {
    const cx = clamp(x, 0, width);
    const i = Math.min(Math.floor(cx), width - 1);
    return lerp(a[i], a[i + 1], cx - i);
  };
}

/** `fn` sampled every 2 px over [from, to], linearly interpolated, clamped. */
function table(from, to, fn) {
  const n = Math.ceil((to - from) / 2);
  const v = Float32Array.from({ length: n + 1 }, (_, i) => fn(from + 2 * i));
  return (x) => {
    const t = clamp((x - from) / 2, 0, n);
    const i = Math.min(Math.floor(t), n - 1);
    return lerp(v[i], v[i + 1], t - i);
  };
}

/** Height and albedo of the landscape around `sim`'s current world. */
export function createTerrainField(sim, view, seed) {
  const { height: H, distance: D, eye, centerX: xc, width: W } = view;
  const profile = (x) => H - sim.groundAt(x);
  const padX = sim.world.padX;
  const padH = H - sim.world.padY;
  const random = rng(seed);
  const rand = (a, b) => a + random() * (b - a);

  // Craters: bowl, raised rim, and a bright young ejecta ring on some.
  const craters = [];
  const addCrater = (x, z, r) => {
    const young = random() < 0.3;
    craters.push({
      x, z, r,
      reach: r * 2.2,
      depth: r * rand(0.18, 0.3),
      rim: r * rand(0.06, 0.12),
      bright: young ? rand(0.25, 0.45) : rand(0, 0.08),
    });
  };
  for (let i = 0; i < 70; i++) {
    const r = 3 + Math.pow(random(), 2.5) * 30;
    const z = rand(r * 1.5 + 45, 360);
    const hw = (W / 2) * ((D - z) / D) * MARGIN;
    const x = rand(xc - hw, xc + hw);
    if (Math.abs(x - padX) < PAD_WIDTH / 2 + r * 2 + 10 && z < PAD_DEPTH / 2 + r * 2 + 10) continue;
    addCrater(x, z, r);
  }
  for (let i = 0; i < 110; i++) {
    // On the faces of the near ridge and the far range, sized to read on screen.
    const u = rand(250, 3400);
    const g = (D + u) / D;
    const hw = (W / 2) * g;
    addCrater(rand(xc - hw, xc + hw), -u, (rand(3, 8) + Math.pow(random(), 3) * 14) * g);
  }

  // Bucket craters on a grid so each sample only looks at nearby ones.
  const CELL = 64;
  const buckets = new Map();
  for (const c of craters) {
    for (let i = Math.floor((c.x - c.reach) / CELL); i <= Math.floor((c.x + c.reach) / CELL); i++) {
      for (let j = Math.floor((c.z - c.reach) / CELL); j <= Math.floor((c.z + c.reach) / CELL); j++) {
        const key = i * 4096 + j;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
      }
    }
  }
  const none = [];

  function craterAt(x, z) {
    let h = 0;
    let bright = 0;
    for (const c of buckets.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || none) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz) / c.r;
      if (d >= 2.2) continue;
      if (d < 1) {
        h += c.rim - (c.rim + c.depth) * (1 - d * d);
        bright -= 0.08 * (1 - d);
      } else {
        const fall = Math.exp(-(((d - 1) / 0.35) ** 2));
        h += c.rim * fall;
        bright += c.bright * Math.exp(-(((d - 1) / 0.6) ** 2));
      }
    }
    return [h, bright];
  }

  // The profile blurred, for the ground in front to relax toward: extruding
  // the raw profile toward the camera would furrow it along z.
  const smoothed = blurProfile(profile, W, 40);
  // Where the ridges peak along depth, per screen column.
  const nearAt = table(-W, 2 * W, (xs) => 520 + 160 * fbm2(xs / 260, 3.5, seed + 22, 3));
  const farAt = table(-W, 2 * W, (xs) => 3200 + 700 * fbm2(xs / 400, 9.5, seed + 24, 3));

  // Away from the profile line, height is authored as where it should land
  // on screen (plane y, up), per screen column xs and depth, then lifted to
  // the world height that projects there. That keeps the layering of the 2D
  // art (ground line, near ridge, far mountains) under real perspective.
  const lift = (y, d) => eye + ((y - eye) * d) / D; // screen y at distance d

  function base(x, z) {
    if (z >= 0) {
      const d = D - z;
      const xs = xc + ((x - xc) * D) / d;
      const s = profile(xs);
      const smooth = smoothed(xs);
      // Screen distance below the profile: grows like flat ground's would.
      // Off the smoothed profile, or its fine detail furrows the ground.
      const fall = Math.max(eye - smooth, 0) + FRONT_LIFT;
      const below = (fall * z) / d;
      // Relax toward the smoothed profile, but never above 60% of `below`:
      // that and the bumps (a quarter) keep everything under the line.
      const y = Math.min(lerp(s, smooth, smoothstep(0, 80, z)), s + 0.6 * below) - below;
      const amp = Math.min((0.25 * fall * z) / D, 4);
      return lift(y, d) + fbm2(x / 70, z / 70, seed + 11, 4) * amp;
    }
    const u = -z;
    const d = D + u;
    const xs = xc + ((x - xc) * D) / d;
    const s = profile(xs);
    // A world-flat ledge, then a drop steeper than the line of sight.
    const crest = s + ((eye - s) * u) / d - CREST_DROP * (1 - Math.exp(-Math.max(0, u - LEDGE) / CREST_DROP_LENGTH));
    const nearTop = 122 + 24 * fbm2(xs / 120, u / 260, seed + 21, 3);
    const nearPeak = nearAt(xs);
    const near = nearTop - 140 * ((u - nearPeak) / (u < nearPeak ? 280 : 420)) ** 2;
    const farTop = 150 + 70 * ridged2(xs / 210, u / 650, seed + 23, 4) + 8 * fbm2(xs / 30, u / 120, seed + 25, 2);
    const farPeak = farAt(xs);
    const far = farTop - 220 * ((u - farPeak) / (u < farPeak ? 1900 : 2600)) ** 2;
    const y = smoothMax(smoothMax(crest, near, 10), far, 14);
    // World roughness, scaled with distance so it reads the same on screen.
    const g = d / D;
    const rough = fbm2(x / (70 * g), z / (70 * g), seed + 3, 3) * 4 * g * smoothstep(LEDGE, 90, u);
    return lift(y, d) + rough;
  }

  function sample(x, z) {
    let h = base(x, z);
    const [ch, bright] = craterAt(x, z);
    // No craters on the profile line itself, where the sim's ground rules.
    const fade = z >= 0 ? smoothstep(10, 50, z) : smoothstep(LEDGE, 60, -z);
    h += ch * fade;
    // Pad site: flat under the plate, blending out. Not on the profile line,
    // which the sim already flattened.
    const dx = Math.abs(x - padX) - (PAD_WIDTH / 2 + 4);
    const dz = Math.abs(z) - (PAD_DEPTH / 2 + 4);
    const d = Math.max(dx, dz);
    const w = (d <= 0 ? 1 : 1 - smoothstep(0, 30, d)) * (1 - Math.exp(-((z / 6) ** 2)));
    h = lerp(h, padH - 1.5, w);
    // In front, never above the height that lands on the ground line in this
    // point's screen column. The front is built to stay below it, but the
    // pad's flattening (and the odd crater rim) can lift it where the line
    // drops away beside the pad, hiding the line the player lands on.
    if (z > 0) {
      const k = D / (D - z);
      h = Math.min(h, eye + (profile(xc + (x - xc) * k) - eye) / k);
    }
    return [h, bright * fade];
  }

  return {
    padX,
    heightAt: (x, z) => sample(x, z)[0],
    sample,
  };
}

/** Rows (z values) spaced so each covers a pixel or two of screen height. */
function rowDepths(view) {
  const { distance: D, eye } = view;
  const near = [0];
  for (let z = 0; z < FRONT_Z;) {
    z += clamp((PIXELS_PER_ROW * (D - z) ** 2) / ((eye - GROUND + FRONT_LIFT) * D), 0.8, 50);
    near.push(Math.min(z, FRONT_Z));
  }
  // Behind, screen height is authored per depth (see `base`), so the steps
  // follow how fast it climbs: fine over the crest and the ridge faces the
  // camera sees, coarse in the hidden valleys and behind the far range.
  for (let u = 0; u < -SPLIT_Z;) {
    u += u < 60 ? 2 : u < 250 ? 8 : 5;
    near.unshift(-Math.min(u, -SPLIT_Z));
  }
  const far = [SPLIT_Z];
  for (let u = -SPLIT_Z; u < -BACK_Z;) {
    u += u < 5000 ? 14 : 120;
    far.unshift(-Math.min(u, -BACK_Z));
  }
  // Far to near. The two grids meet at SPLIT_Z with different column counts;
  // the T-junctions there are out of sight in the valley.
  return [{ rows: far, columns: FAR_COLUMNS }, { rows: near, columns: NEAR_COLUMNS }];
}

/** The landscape mesh for `field`, frustum-shaped so detail is even on screen. */
export function buildTerrainGeometry(field, view) {
  const { width: W, distance: D, centerX: xc } = view;
  const grids = rowDepths(view);
  const vertexCount = grids.reduce((n, g) => n + g.rows.length * (g.columns + 1), 0);
  const indexCount = grids.reduce((n, g) => n + (g.rows.length - 1) * g.columns * 6, 0);
  const position = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);
  let p = 0;
  let q = 0;
  for (const { rows, columns } of grids) {
    const first = p / 3;
    for (const z of rows) {
      const hw = (W / 2) * ((D - z) / D) * MARGIN;
      // Ranges behind the crest are darker, as the 2D art's ridges were, so
      // the ground line stands out against them.
      const layer = z >= 0 ? 1 : lerp(1, 0.6, smoothstep(30, 400, -z)) * lerp(1, 0.8, smoothstep(1500, 3500, -z));
      for (let i = 0; i <= columns; i++) {
        const x = xc - hw + (2 * hw * i) / columns;
        const [h, bright] = field.sample(x, z);
        position[p] = x;
        position[p + 1] = h;
        position[p + 2] = z;
        // Linear albedo: grey regolith, brighter ejecta. Mottling is per pixel.
        const v = 0.26 * layer * (1 + bright);
        color[p] = v;
        color[p + 1] = v * 0.985;
        color[p + 2] = v * 0.96;
        p += 3;
      }
    }
    const cols = columns + 1;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let i = 0; i < columns; i++) {
        const a = first + r * cols + i;
        const b = a + cols;
        // Rows run far to near, so (a, b, a+1) faces up.
        index[q++] = a;
        index[q++] = b;
        index[q++] = a + 1;
        index[q++] = a + 1;
        index[q++] = b;
        index[q++] = b + 1;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Boulders scattered on the landscape, kept off the profile line and pad. */
export function buildBoulders(field, view, seed, material) {
  const { width: W, distance: D, centerX: xc } = view;
  const random = rng(seed + 5);
  const rand = (a, b) => a + random() * (b - a);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  // Knock the icosphere into a rock: jitter each distinct vertex once.
  const pos = geometry.attributes.position;
  const jitter = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, rand(0.75, 1.15));
    const s = jitter.get(key);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
  }
  geometry.computeVertexNormals();

  const placed = [];
  const tryPlace = (x, z, r) => {
    if (Math.abs(x - field.padX) < PAD_WIDTH / 2 + r + 12 && Math.abs(z) < PAD_DEPTH / 2 + r + 12) return;
    placed.push([x, z, r]);
  };
  for (let i = 0; i < 160; i++) {
    const r = rand(0.7, 2.6) * (random() < 0.12 ? 2 : 1);
    // In front, far enough out that its top stays below the profile line.
    const z = rand(Math.max(14 * r, 20), 360);
    const hw = (W / 2) * ((D - z) / D);
    tryPlace(rand(xc - hw, xc + hw), z, r);
  }
  for (let i = 0; i < 90; i++) {
    const u = rand(240, 1800);
    const hw = (W / 2) * ((D + u) / D);
    tryPlace(rand(xc - hw, xc + hw), -u, rand(3, 9) * (1 + u / 900));
  }
  const mesh = new THREE.InstancedMesh(geometry, material, placed.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  placed.forEach(([x, z, r], i) => {
    e.set(rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3));
    q.setFromEuler(e);
    s.set(r * rand(0.9, 1.3), r * rand(0.6, 0.9), r * rand(0.9, 1.3));
    t.set(x, field.heightAt(x, z) - 0.3 * r, z);
    mesh.setMatrixAt(i, m.compose(t, q, s));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------ GPU detail

// Gradient noise with its analytic derivative, (value, d/dx, d/dy), off an
// integer hash so it stays clean thousands of cells from the origin.
const GRADIENT_NOISE_GLSL = /* glsl */ `
uint gnHash(uvec2 p) {
  p = p * uvec2(1597334673u, 3812015801u);
  uint n = (p.x ^ p.y) * 1597334673u;
  return n ^ (n >> 16);
}
vec2 gnGrad(ivec2 c) {
  float a = float(gnHash(uvec2(c))) * (6.2831853 / 4294967296.0);
  return vec2(cos(a), sin(a));
}
vec3 gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  ivec2 c = ivec2(i);
  vec2 ga = gnGrad(c);
  vec2 gb = gnGrad(c + ivec2(1, 0));
  vec2 gc = gnGrad(c + ivec2(0, 1));
  vec2 gd = gnGrad(c + ivec2(1, 1));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
         + du * (u.yx * k + vec2(vb - va, vc - va));
  return vec3(v, d);
}
`;

const DETAIL_GLSL = /* glsl */ `
varying vec3 vGroundPos;
// Coarsest relief wavelength, its slope, and how both shrink per octave.
const float DETAIL_LAMBDA = 40.0;
const float DETAIL_SLOPE = 0.2;
const int DETAIL_OCTAVES = 8;
// An octave fades in between these many pixels per wavelength.
const float DETAIL_PX_LOST = 1.5;
const float DETAIL_PX_SEEN = 5.0;

float groundFootprint() {
  return max(max(fwidth(vGroundPos.x), fwidth(vGroundPos.z)), 1e-4);
}

// Lean the view-space normal the way finer relief would.
vec3 groundDetailNormal(vec3 n, float footprint) {
  vec2 p = vGroundPos.xz;
  vec2 slope = vec2(0.0);
  float lambda = DETAIL_LAMBDA;
  float amp = DETAIL_SLOPE;
  for (int i = 0; i < DETAIL_OCTAVES; i++) {
    float seen = smoothstep(DETAIL_PX_LOST, DETAIL_PX_SEEN, lambda / footprint);
    if (seen > 0.0) slope += amp * seen * gradientNoise(p / lambda + float(i) * 19.7).yz;
    lambda *= 0.5;
    amp *= 0.62;
  }
  vec3 tilt = (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz;
  return normalize(n + tilt);
}

float groundDetailAlbedo(float footprint) {
  vec2 p = vGroundPos.xz;
  // Broad patches of lighter and darker regolith, then finer grain.
  float m = 0.6 * gradientNoise(p / 170.0 + 1.7).x + 0.5 * gradientNoise(p / 23.0 + 7.3).x;
  m += 0.35 * smoothstep(DETAIL_PX_LOST, DETAIL_PX_SEEN, 6.0 / footprint) * gradientNoise(p / 6.0 + 3.1).x;
  return 1.0 + 0.3 * m;
}
`;

/** Lunar regolith: rough, vertex-coloured, with per-pixel relief. */
export function terrainMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  material.onBeforeCompile = (shader) => {
    const need = ["#include <common>", "#include <begin_vertex>", "#include <color_fragment>", "#include <normal_fragment_maps>"];
    for (const chunk of need) {
      if (!shader.vertexShader.includes(chunk) && !shader.fragmentShader.includes(chunk)) {
        throw new Error(`three.js standard material changed: ${chunk} missing`);
      }
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGroundPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRADIENT_NOISE_GLSL}\n${DETAIL_GLSL}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat groundFp = groundFootprint();\ndiffuseColor.rgb *= groundDetailAlbedo(groundFp);")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = groundDetailNormal(normal, groundFp);");
  };
  return material;
}

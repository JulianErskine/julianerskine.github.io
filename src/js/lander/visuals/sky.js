// Everything beyond the landscape: the black sky with the Milky Way, stars,
// and the Earth, lit by the same sun as the ground.
import * as THREE from "three";
import { fbm3, noise3 } from "./noise.js";
import { rng } from "../rng.js";

const SKY_RADIUS = 15000;
const STAR_RADIUS = 14000;
const EARTH_DISTANCE = 12000;
// Milky Way: the band is the set of directions d with dot(d, BAND_AXIS) near
// BAND_OFFSET; this tilts it up to the right across the top of the frame.
const BAND_AXIS = new THREE.Vector3(-0.33, 0.94, 0.06).normalize();
const BAND_OFFSET = 0.11;
const BAND_WIDTH = 0.06;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBandAxis;
uniform float uBandOffset;
uniform float uBandWidth;
uniform vec3 uBandColor;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                 mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                 mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.45, d.y));
  float off = (dot(d, uBandAxis) - uBandOffset) / uBandWidth;
  float band = exp(-off * off);
  float glow = fbm(d * 9.0);
  float lanes = smoothstep(0.45, 0.7, fbm(d * 21.0 + 4.0));
  col += uBandColor * band * (0.35 + glow) * (1.0 - 0.6 * lanes * band);
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vColor * core * core, 1.0);
}`;

const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const ATMOSPHERE_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = 1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0);
  float lit = smoothstep(-0.25, 0.6, dot(normalize(vNormal), uSunDir));
  gl_FragColor = vec4(uColor * pow(rim, 2.5) * lit * 1.6, 1.0);
}`;

function randomDirection(random, out = new THREE.Vector3()) {
  const u = random() * 2 - 1;
  const a = random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}

function buildStars(random, pixelRatio) {
  const count = 3600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = ["#ffffff", "#c8d7ff", "#ffebd2", "#dfe6ff"].map((c) => new THREE.Color(c));
  const d = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (i < 1400) {
      // Crowded along the Milky Way: a direction in the band, then a nudge.
      randomDirection(random, d);
      side.copy(BAND_AXIS).multiplyScalar(BAND_OFFSET + (random() + random() + random() - 1.5) * BAND_WIDTH * 0.8);
      d.addScaledVector(BAND_AXIS, -d.dot(BAND_AXIS)).normalize().multiplyScalar(Math.sqrt(1 - side.lengthSq())).add(side);
    } else {
      randomDirection(random, d);
    }
    d.multiplyScalar(STAR_RADIUS).toArray(positions, i * 3);
    const bright = i < 1400 ? 0.15 + random() * 0.35 : 0.3 + Math.pow(random(), 2) * 1.2;
    const big = random() < 0.04;
    tints[Math.floor(random() * tints.length)].clone().multiplyScalar(big ? bright * 4 : bright).toArray(colors, i * 3);
    sizes[i] = big ? 3.2 + random() * 1.6 : 1.4 + Math.pow(random(), 3) * 1.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { uPixelRatio: { value: pixelRatio } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1;
  points.frustumCulled = false;
  return points;
}

/** Equirectangular day-side colour and cloud textures from noise. */
function earthTextures(seed) {
  const w = 384;
  const h = 192;
  const surface = document.createElement("canvas");
  const clouds = document.createElement("canvas");
  surface.width = clouds.width = w;
  surface.height = clouds.height = h;
  const sImg = surface.getContext("2d").createImageData(w, h);
  const cImg = clouds.getContext("2d").createImageData(w, h);
  const deep = new THREE.Color("#0a2458");
  const shelf = new THREE.Color("#1f5da6");
  const green = new THREE.Color("#4c7a38");
  const dry = new THREE.Color("#b39a66");
  const ice = new THREE.Color("#eef3f8");
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const px = Math.cos(lat) * Math.cos(lon);
      const py = Math.sin(lat);
      const pz = Math.cos(lat) * Math.sin(lon);
      const land = fbm3(px * 1.8, py * 1.8, pz * 1.8, seed, 5) + 0.04;
      const polar = Math.abs(lat) > 1.15 + 0.08 * noise3(px * 6, py * 6, pz * 6, seed + 9);
      if (polar) {
        c.copy(ice);
      } else if (land > 0.06) {
        const arid = fbm3(px * 3, py * 3, pz * 3, seed + 5, 3) + 0.45 * Math.exp(-(((Math.abs(lat) - 0.42) / 0.18) ** 2));
        c.lerpColors(green, dry, THREE.MathUtils.clamp(arid * 1.4, 0, 1));
      } else {
        c.lerpColors(deep, shelf, THREE.MathUtils.clamp(1 + (land - 0.06) * 12, 0, 1));
      }
      const i = (y * w + x) * 4;
      sImg.data[i] = c.r * 255;
      sImg.data[i + 1] = c.g * 255;
      sImg.data[i + 2] = c.b * 255;
      sImg.data[i + 3] = 255;
      // Clouds: stretched along latitude, thicker away from the subtropics.
      const cl = fbm3(px * 5, py * 11, pz * 5, seed + 21, 5);
      const cover = THREE.MathUtils.smoothstep(cl, -0.05, 0.45) * (0.45 + 0.55 * Math.abs(Math.sin(lat * 2.2)));
      cImg.data[i] = cImg.data[i + 1] = cImg.data[i + 2] = 255;
      cImg.data[i + 3] = cover * 210;
    }
  }
  surface.getContext("2d").putImageData(sImg, 0, 0);
  clouds.getContext("2d").putImageData(cImg, 0, 0);
  // The canvas pixels were written from Colors in sRGB terms.
  const make = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { surface: make(surface), clouds: make(clouds) };
}

function buildEarth(view, camera, sunDir, seed) {
  const group = new THREE.Group();
  const target = view.planeToWorld(view.width - 85, 72);
  const dir = target.sub(camera.position).normalize();
  group.position.copy(camera.position).addScaledVector(dir, EARTH_DISTANCE);
  const radius = (20 * EARTH_DISTANCE) / view.distance;
  // Axial tilt, and a bit of a turn so a continent faces us.
  group.rotation.set(0, 0, -0.41);

  const { surface, clouds } = earthTextures(seed);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    new THREE.MeshStandardMaterial({ map: surface, roughness: 0.75, metalness: 0, fog: false, envMapIntensity: 0 }),
  );
  const cloudLayer = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, 64, 32),
    new THREE.MeshStandardMaterial({
      map: clouds, transparent: true, depthWrite: false, roughness: 1, fog: false, envMapIntensity: 0,
    }),
  );
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.07, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      uniforms: { uSunDir: { value: sunDir.clone() }, uColor: { value: new THREE.Color(0.25, 0.5, 1.0) } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  group.add(globe, cloudLayer, atmosphere);
  return {
    group,
    update(dt) {
      globe.rotation.y += dt * 0.02;
      cloudLayer.rotation.y += dt * 0.026;
    },
  };
}

export function createSky(view, camera, sunDir, pixelRatio, seed = 7) {
  const random = rng(seed);
  const group = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color("#010208") },
        uHorizon: { value: new THREE.Color("#0b1122") },
        uBandAxis: { value: BAND_AXIS },
        uBandOffset: { value: BAND_OFFSET },
        uBandWidth: { value: BAND_WIDTH },
        uBandColor: { value: new THREE.Color(0.018, 0.02, 0.034) },
      },
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  dome.position.copy(camera.position);
  dome.renderOrder = -2;
  const stars = buildStars(random, pixelRatio);
  stars.position.copy(camera.position);
  const earth = buildEarth(view, camera, sunDir, seed);
  group.add(dome, stars, earth.group);
  return { group, update: earth.update };
}

/**
 * Image-based light for the metal and glass on the lander: black sky above,
 * sunlit regolith below. Without it, metals reflect nothing and go black.
 */
export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: SKY_VERT,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 sky = vec3(0.004, 0.006, 0.014);
          vec3 ground = vec3(0.32, 0.31, 0.3) * (0.6 + 0.4 * smoothstep(0.0, -0.6, d.y));
          vec3 earthshine = vec3(0.05, 0.07, 0.12) * smoothstep(0.2, 0.9, d.y);
          gl_FragColor = vec4(mix(ground, sky + earthshine, smoothstep(-0.04, 0.04, d.y)), 1.0);
        }`,
    }),
  ));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0, 0.1, 1000).texture;
  pmrem.dispose();
  return texture;
}

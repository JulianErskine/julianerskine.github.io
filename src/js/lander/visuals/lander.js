// The lander as a 3D model, built in the sim's body units (see sim.js) but
// with y pointing up: model (x, y, z) = body (x, -y) plus depth. The side the
// camera sees matches the 2D outline the sim's contact points come from.
import * as THREE from "three";
import { MAIN_NOZZLE, RCS_JETS, SCALE } from "../sim.js";
import { rng } from "../rng.js";

// Body point (y down) -> model point (y up).
const m = ([x, y], z = 0) => new THREE.Vector3(x, -y, z);

/** Crinkled foil: a normal map of random flat facets. */
function foilNormalMap(seed) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d");
  c.fillStyle = "rgb(128,128,255)";
  c.fillRect(0, 0, size, size);
  const random = rng(seed);
  const facet = () => {
    const nx = (random() * 2 - 1) * 0.55;
    const ny = (random() * 2 - 1) * 0.55;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return `rgb(${(nx * 0.5 + 0.5) * 255 | 0},${(ny * 0.5 + 0.5) * 255 | 0},${(nz * 0.5 + 0.5) * 255 | 0})`;
  };
  for (let i = 0; i < 900; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 6 + random() * 22;
    c.fillStyle = facet();
    c.beginPath();
    for (let k = 0; k < 3 + (random() * 3 | 0); k++) {
      const a = random() * Math.PI * 2;
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7);
    }
    c.closePath();
    c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

/** Thin cylinder from a to b. */
function strut(a, b, radius, material) {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

// Additive exhaust cone: hot white at the nozzle, cooling along its length,
// fading at the edges seen side-on.
const PLUME_VERT = /* glsl */ `
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vAlong = -position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const PLUME_FRAG = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uIntensity;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float body = pow(facing, 1.5);
  vec3 col = mix(uHot, uCool, smoothstep(0.0, 0.6, vAlong));
  float fade = 1.0 - smoothstep(0.25, 1.0, vAlong);
  gl_FragColor = vec4(col * body * fade * uIntensity, 1.0);
}`;

function plume(radius, hot, cool, intensity) {
  // Unit length, base at the origin, tip at y = -1.
  const geometry = new THREE.ConeGeometry(radius, 1, 24, 6, true);
  geometry.rotateX(Math.PI);
  geometry.translate(0, -0.5, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    uniforms: {
      uHot: { value: new THREE.Color(...hot) },
      uCool: { value: new THREE.Color(...cool) },
      uIntensity: { value: intensity },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}

export function createLanderModel(seed = 3) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(SCALE);
  root.add(body);

  const foil = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#e3b23c"),
    metalness: 0.85,
    roughness: 0.38,
    normalMap: foilNormalMap(seed),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  const hull = new THREE.MeshStandardMaterial({ color: new THREE.Color("#c9cdd3"), metalness: 0.35, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color("#9aa0a9"), metalness: 0.8, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color("#2a2f38"), metalness: 0.6, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color("#0a1220"), metalness: 0.1, roughness: 0.06, envMapIntensity: 2 });
  const white = new THREE.MeshStandardMaterial({ color: new THREE.Color("#e5e7eb"), metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide });

  // Descent stage: an octagonal box in gold foil, flat faces to the sides,
  // spanning body y -2..8.
  const octRadius = 11.5 / Math.cos(Math.PI / 8);
  const descent = new THREE.Mesh(new THREE.CylinderGeometry(octRadius, octRadius, 10, 8, 1), foil);
  descent.rotation.y = Math.PI / 8;
  descent.position.y = -3;
  body.add(descent);

  // Ascent stage: the 2D cabin outline, extruded.
  const outline = [[-9, -2], [-9.5, -7], [-6.5, -12.5], [1, -14], [6.5, -12], [9, -7.5], [9, -2]];
  const cabinShape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], -p[1])));
  const depth = 13;
  const cabinGeometry = new THREE.ExtrudeGeometry(cabinShape, {
    depth, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 2,
  });
  cabinGeometry.translate(0, 0, -depth / 2);
  body.add(new THREE.Mesh(cabinGeometry, hull));
  // Dark band where the stages join.
  const band = new THREE.Mesh(new THREE.BoxGeometry(18.6, 1.2, depth + 1.8), dark);
  band.position.y = 2.4;
  body.add(band);
  // Front window, with the glass catching the sky.
  const windowShape = new THREE.Shape([[-6.5, -9.5], [-2.5, -11.8], [-2, -8]].map((p) => new THREE.Vector2(p[0], -p[1])));
  const pane = new THREE.Mesh(new THREE.ShapeGeometry(windowShape), glass);
  pane.position.z = depth / 2 + 0.85;
  body.add(pane);
  // Docking hatch, antenna mast and dish.
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 1.8, 16), steel);
  hatch.position.y = 14.7;
  body.add(hatch);
  body.add(strut(m([4, -13]), m([6.5, -18]), 0.25, steel));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.8), white);
  dish.position.copy(m([6.5, -18]));
  dish.rotation.z = -0.7;
  body.add(dish);

  // RCS quads on each side, nozzles up and down.
  for (const s of [-1, 1]) {
    const quad = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), dark);
    quad.position.set(s * 10.5, 8.5, 0);
    body.add(quad);
    for (const dir of [-1, 1]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 0.9, 10, 1, true), steel);
      nozzle.position.set(s * 10.5, 8.5 + dir * 1.9, 0);
      if (dir > 0) nozzle.rotation.x = Math.PI;
      body.add(nozzle);
    }
  }

  // Descent engine bell, body y 8..13.
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 4.5, 5, 24, 1, true), dark);
  bell.material = dark.clone();
  bell.material.side = THREE.DoubleSide;
  bell.position.y = -10.5;
  body.add(bell);

  // Four legs: two on the play plane (the ones the sim's FEET are), one
  // toward the camera and one away. Footpad bottoms sit at body y = 15.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const at = (r, y) => new THREE.Vector3(dx * r, y, dz * r);
    body.add(strut(at(10, 0), at(15, -14.4), 0.55, steel));
    body.add(strut(at(8, -7.5), at(14.2, -11.5), 0.4, steel));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 1.1, 18), steel);
    pad.position.copy(at(15, -14.45));
    body.add(pad);
  }

  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Exhaust: main plume (outer and core) and one puff per RCS nozzle.
  const nozzle = m(MAIN_NOZZLE);
  const mainOuter = plume(4.4, [2.4, 1.9, 1.1], [1.2, 0.3, 0.04], 1);
  const mainCore = plume(2.2, [4, 3.6, 3], [2, 1, 0.25], 1);
  for (const p of [mainOuter, mainCore]) {
    p.position.copy(nozzle);
    body.add(p);
  }
  const puffs = {};
  for (const [command, jets] of Object.entries(RCS_JETS)) {
    puffs[command] = jets.map(({ at, dir }) => {
      const p = plume(1.5, [2.2, 2.3, 2.6], [0.8, 0.85, 1.0], 1.1);
      p.position.copy(m(at)).add(new THREE.Vector3(0, -dir * 0.6, 0));
      // Plumes point -y; flip the ones that fire up.
      if (dir < 0) p.rotation.z = Math.PI;
      body.add(p);
      return p;
    });
  }

  // Engine glow on the ground and the craft's underside.
  const engineLight = new THREE.PointLight(0xffa64d, 0, 260, 1.6);
  engineLight.position.copy(nozzle).add(new THREE.Vector3(0, -14, 0));
  body.add(engineLight);

  return {
    root,
    /** Show plumes and light for this frame's thruster state. */
    setThrust(state, random = Math.random) {
      const burning = state.main;
      mainOuter.visible = mainCore.visible = burning;
      if (burning) {
        const len = 14 + random() * 8; // body units, as the 2D flame
        mainOuter.scale.set(1, len, 1);
        mainCore.scale.set(1, len * 0.55, 1);
      }
      engineLight.intensity = burning ? 900 * (0.85 + random() * 0.3) : 0;
      for (const [command, on] of [["left", state.rcsLeft], ["right", state.rcsRight]]) {
        for (const p of puffs[command]) {
          p.visible = on;
          if (on) p.scale.set(1, 4 + random() * 2, 1);
        }
      }
    },
  };
}

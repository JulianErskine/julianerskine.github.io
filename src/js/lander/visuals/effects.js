// Exhaust, dust, explosions and debris. Purely visual: they read the sim's
// state and the landscape's height but never feed back into the game.
// World coordinates (y up), see view.js.
import * as THREE from "three";
import { GRAVITY, MAIN_NOZZLE, RCS_JETS } from "../sim.js";

const MAX_PARTICLES = 1200;
const MAX_DEBRIS = 48;
const FIRE = 0;
const GAS = 1;
const DUST = 2;

const rand = (a, b) => a + Math.random() * (b - a);

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vColor.a * smoothstep(1.0, 0.2, r);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

// Linear colours: fire is pushed past 1 so the bloom catches it.
const FIRE_COLORS = ["#dc501e", "#ffaa3c", "#fff0c8"].map((c, i) => new THREE.Color(c).multiplyScalar([1.6, 2.4, 3.2][i]));
const GAS_COLOR = new THREE.Color("#e6ebf5");
const DUST_COLOR = new THREE.Color("#a5a5aa").multiplyScalar(0.8);
const DEBRIS_COLORS = ["#d4a017", "#9ca3af", "#e5e7eb", "#6b4c06", "#4b5563"].map((c) => new THREE.Color(c));

function pointCloud(blending) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: { uScale: { value: 1 } },
    blending,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}

export function createEffects(view) {
  const group = new THREE.Group();
  const additive = pointCloud(THREE.AdditiveBlending);
  const smoke = pointCloud(THREE.NormalBlending);
  group.add(smoke, additive);

  const debrisMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.4 }),
    MAX_DEBRIS,
  );
  debrisMesh.castShadow = true;
  debrisMesh.count = 0;
  debrisMesh.frustumCulled = false;
  group.add(debrisMesh);

  // Explosion: a light and a billboard flare.
  const flashLight = new THREE.PointLight(0xffb060, 0, 600, 1.4);
  const flare = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          vec3 col = mix(vec3(4.0, 3.4, 2.4), vec3(2.0, 0.6, 0.15), smoothstep(0.0, 0.8, r));
          gl_FragColor = vec4(col * uT * (1.0 - smoothstep(0.0, 1.0, r)), 1.0);
        }`,
      uniforms: { uT: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  flare.renderOrder = 4;
  flare.visible = false;
  group.add(flashLight, flare);

  let particles = [];
  let debris = [];
  let flash = null;
  let heightAt = () => -Infinity;

  const add = (p) => {
    if (particles.length < MAX_PARTICLES) particles.push(p);
  };

  // Emit from a nozzle (body units) along a body-frame direction, as the
  // sim's thrust does, with a little spread out of the plane.
  function emitJet(sim, kind, nozzle, dirY, rate, speed, life, size, dt) {
    const { state, height } = sim;
    const n = Math.floor(rate * dt + Math.random());
    const [nx, ny] = sim.bodyToPlane(nozzle[0], nozzle[1]);
    const base = state.angle + (dirY > 0 ? Math.PI / 2 : -Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const a = base + rand(-0.14, 0.14);
      const v = speed * rand(0.8, 1.2);
      const l = life * rand(0.7, 1.2);
      add({
        kind, x: nx, y: height - ny, z: 0,
        vx: state.vx + Math.cos(a) * v,
        vy: -(state.vy + Math.sin(a) * v),
        vz: rand(-0.14, 0.14) * v,
        life: l, maxLife: l, size, gravity: false,
      });
    }
  }

  function kickDust(p) {
    // Thrown out along the ground, away from where the blast came from.
    const out = Math.atan2(p.vz, p.vx) + rand(-0.9, 0.9);
    const v = rand(40, 140);
    const l = rand(0.6, 1.4);
    add({
      kind: DUST, x: p.x, y: heightAt(p.x, p.z) + 0.5, z: p.z,
      vx: Math.cos(out) * v, vy: rand(5, 45), vz: Math.sin(out) * v,
      life: l, maxLife: l, size: rand(1, 2.5), gravity: true,
    });
  }

  function explode(event) {
    const at = view.planeToWorld(event.x, event.y);
    flash = { x: at.x, y: at.y, t: 1 };
    for (let i = 0; i < 70; i++) {
      // Random direction on a sphere.
      const u = rand(-1, 1);
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(1 - u * u);
      const v = rand(20, 160);
      const l = rand(0.5, 1.2);
      add({
        kind: FIRE, x: at.x, y: at.y, z: 0,
        vx: r * Math.cos(a) * v, vy: u * v, vz: r * Math.sin(a) * v * 0.6,
        life: l, maxLife: l, size: rand(2, 4), gravity: false,
      });
    }
    debris = [];
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI); // upward half of the plane
      const v = rand(40, 150);
      const l = rand(2.5, 4);
      const s = rand(1.2, 2.8);
      debris.push({
        x: at.x, y: at.y, z: rand(-4, 4),
        vx: Math.cos(a) * v + event.vx * 0.3, vy: Math.sin(a) * v, vz: rand(-0.5, 0.5) * v,
        life: l, maxLife: l,
        scale: new THREE.Vector3(s, s * rand(0.2, 0.8), s * rand(0.5, 1.2)),
        rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
        spinAxis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
        spin: rand(4, 14),
        color: DEBRIS_COLORS[i % DEBRIS_COLORS.length],
      });
    }
  }

  function update(dt, sim) {
    const { state } = sim;
    if (state.status === "flying") {
      if (state.main) emitJet(sim, FIRE, MAIN_NOZZLE, 1, 150, 230, 0.45, 2.2, dt);
      for (const [command, on] of [["left", state.rcsLeft], ["right", state.rcsRight]]) {
        if (!on) continue;
        for (const { at, dir } of RCS_JETS[command]) emitJet(sim, GAS, at, dir, 60, 90, 0.3, 1.2, dt);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      let dead = p.life <= 0;
      if (!dead) {
        if (p.gravity) p.vy -= GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y <= heightAt(p.x, p.z)) {
          if (p.kind === FIRE && Math.random() < 0.6) kickDust(p);
          dead = true;
        }
      }
      if (dead) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
      }
    }

    const q = new THREE.Quaternion();
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        debris.splice(i, 1);
        continue;
      }
      d.vy -= GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const g = heightAt(d.x, d.z) + d.scale.y * 0.5;
      if (d.y <= g) {
        d.y = g;
        d.vy *= -0.3;
        d.vx *= 0.6;
        d.vz *= 0.6;
        d.spin *= 0.5;
      }
      d.rot.multiply(q.setFromAxisAngle(d.spinAxis, d.spin * dt));
    }

    if (flash) {
      flash.t -= dt * 2.5;
      if (flash.t <= 0) flash = null;
    }
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  function sync(camera, renderer) {
    // Point size: world diameter -> pixels at the depth of the point.
    const scaleUniform = (renderer.getDrawingBufferSize(new THREE.Vector2()).y * camera.projectionMatrix.elements[5]) / 2;
    additive.material.uniforms.uScale.value = scaleUniform;
    smoke.material.uniforms.uScale.value = scaleUniform;
    const fill = (points, keep) => {
      const pos = points.geometry.attributes.position.array;
      const col = points.geometry.attributes.aColor.array;
      const size = points.geometry.attributes.aSize.array;
      let n = 0;
      for (const p of particles) {
        if (!keep(p)) continue;
        const k = p.life / p.maxLife;
        let c;
        let a;
        let s = p.size;
        if (p.kind === FIRE) {
          c = FIRE_COLORS[k > 0.7 ? 2 : k > 0.4 ? 1 : 0];
          a = k * 0.8;
          s *= 1.6 - k;
        } else if (p.kind === GAS) {
          c = GAS_COLOR;
          a = k * 0.6;
          s *= 2 - k;
        } else {
          c = DUST_COLOR;
          a = k * 0.6;
        }
        pos[n * 3] = p.x;
        pos[n * 3 + 1] = p.y;
        pos[n * 3 + 2] = p.z;
        col[n * 4] = c.r;
        col[n * 4 + 1] = c.g;
        col[n * 4 + 2] = c.b;
        col[n * 4 + 3] = a;
        size[n] = s * 2; // radius -> diameter
        n++;
      }
      const g = points.geometry;
      g.setDrawRange(0, n);
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    };
    fill(additive, (p) => p.kind === FIRE);
    fill(smoke, (p) => p.kind !== FIRE);

    debrisMesh.count = Math.min(debris.length, MAX_DEBRIS);
    for (let i = 0; i < debrisMesh.count; i++) {
      const d = debris[i];
      const shrink = Math.min(1, d.life * 2);
      position.set(d.x, d.y, d.z);
      scale.copy(d.scale).multiplyScalar(shrink);
      debrisMesh.setMatrixAt(i, matrix.compose(position, d.rot, scale));
      debrisMesh.setColorAt(i, d.color);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;

    if (flash) {
      flashLight.position.set(flash.x, flash.y + 10, 20);
      flashLight.intensity = 25000 * flash.t;
      flare.visible = true;
      flare.position.set(flash.x, flash.y, 10);
      flare.scale.setScalar(90 * (1.2 - flash.t));
      flare.material.uniforms.uT.value = flash.t;
    } else {
      flashLight.intensity = 0;
      flare.visible = false;
    }
  }

  return {
    group,
    explode,
    update,
    sync,
    /** New world: forget everything in flight and use its ground. */
    reset(field) {
      particles = [];
      debris = [];
      flash = null;
      heightAt = field.heightAt;
    },
  };
}

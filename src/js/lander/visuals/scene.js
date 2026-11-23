// three.js view of the lander sim: builds the scene from the sim's world,
// mirrors its state each frame, and renders with bloom.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createView, createCamera } from "./view.js";
import { createTerrainField, buildTerrainGeometry, buildBoulders, terrainMaterial } from "./terrain.js";
import { createSky, createEnvironment } from "./sky.js";
import { createLanderModel } from "./lander.js";
import { createPad } from "./pad.js";
import { createEffects } from "./effects.js";

// Toward the sun: low in the upper left, a touch behind the plane. Side
// light models the lander and leaves the ridge faces turned toward the
// camera dimmer than the ground, so the ground line reads against them; the
// lander's shadow falls down and to the right, as in the 2D art.
const SUN_DIR = new THREE.Vector3(-0.78, 0.62, -0.1).normalize();

export function createVisuals(canvas, sim) {
  const view = createView(sim.width, sim.height);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(view.width, view.height, false);
  canvas.style.width = `${view.width}px`;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = createCamera(view);
  scene.environment = createEnvironment(renderer);
  // No air on the Moon, but distance has to read somehow: far ranges fade
  // toward the sky, like the darker ridges of the 2D art.
  scene.fog = new THREE.Fog(new THREE.Color("#070a14"), 550, 5000);

  const sun = new THREE.DirectionalLight(0xfff3e2, 2.6);
  sun.target.position.set(view.centerX, 80, 60);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 1500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -460, right: 460, top: 460, bottom: -460, near: 200, far: 3000 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);
  // Earthshine and scatter off the ground, so shadows aren't pure black.
  scene.add(new THREE.HemisphereLight(0x5a6c99, 0x3b3a38, 0.35));

  const sky = createSky(view, camera, SUN_DIR, pixelRatio);
  scene.add(sky.group);

  const groundMaterial = terrainMaterial();
  const boulderMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8a8b8f"), roughness: 0.95, metalness: 0, flatShading: true,
  });
  let terrain = null;
  let boulders = null;
  let field = null;

  const pad = createPad();
  scene.add(pad.group);
  const lander = createLanderModel();
  scene.add(lander.root);
  const effects = createEffects(view);
  scene.add(effects.group);

  // Rendered at full resolution with MSAA, then bloom, then tone mapping.
  const target = new THREE.WebGLRenderTarget(view.width * pixelRatio, view.height * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(view.width, view.height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(view.width, view.height), 0.45, 0.4, 0.9));
  composer.addPass(new OutputPass());

  // Scenery comes from the round's seed too, so a seed shows the same place.
  function rebuildWorld(seed) {
    field = createTerrainField(sim, view, seed);
    if (terrain) {
      scene.remove(terrain, boulders);
      terrain.geometry.dispose();
      boulders.geometry.dispose();
      boulders.dispose();
    }
    terrain = new THREE.Mesh(buildTerrainGeometry(field, view), groundMaterial);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    boulders = buildBoulders(field, view, seed, boulderMaterial);
    scene.add(terrain, boulders);
    pad.place(sim.world.padX, sim.height - sim.world.padY);
    effects.reset(field);
  }

  function handle(event) {
    if (event.type === "reset") rebuildWorld(event.seed);
    else if (event.type === "crashed") effects.explode(event);
  }

  const landerPos = new THREE.Vector3();
  return {
    /** Advance visual-only state by dt; `t` is the clock in seconds. */
    update(dt, t) {
      for (const event of sim.events) handle(event);
      sim.events.length = 0;
      const { state } = sim;
      lander.root.visible = state.status !== "crashed";
      view.planeToWorld(state.x, state.y, landerPos);
      lander.root.position.copy(landerPos);
      lander.root.rotation.z = -state.angle; // plane angles are clockwise
      lander.setThrust(state);
      pad.update(t, state.status === "landed");
      effects.update(dt, sim);
      sky.update(dt);
    },
    render() {
      effects.sync(camera, renderer);
      composer.render();
    },
  };
}

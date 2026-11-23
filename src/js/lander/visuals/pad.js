// The landing pad: a plate with hazard-striped ends straddling the play
// plane, and a blinking green beacon on a mast at each corner.
import * as THREE from "three";
import { PAD_WIDTH } from "../sim.js";
import { PAD_DEPTH } from "./terrain.js";

const THICKNESS = 4;
const STRIPE = 10; // width of the striped ends
const MAST = 7;

function plateTexture(top) {
  const w = 512;
  const h = top ? Math.round((w * PAD_DEPTH) / PAD_WIDTH) : 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  const grad = c.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#c9cdd4");
  grad.addColorStop(1, "#9ba1ab");
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  // Plate seams.
  c.strokeStyle = "rgba(40,45,55,0.35)";
  c.lineWidth = 2;
  for (let x = w / 7; x < w; x += w / 7) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  // Striped ends.
  const sw = (STRIPE / PAD_WIDTH) * w;
  for (const x0 of [0, w - sw]) {
    c.save();
    c.beginPath();
    c.rect(x0, 0, sw, h);
    c.clip();
    c.fillStyle = "#facc15";
    c.fillRect(x0, 0, sw, h);
    c.strokeStyle = "#111";
    c.lineWidth = 12;
    for (let x = x0 - h; x < x0 + sw + h; x += 32) {
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x + h, 0);
      c.stroke();
    }
    c.restore();
  }
  if (top) {
    // Touchdown mark.
    c.strokeStyle = "rgba(255,255,255,0.85)";
    c.lineWidth = 8;
    c.beginPath();
    c.arc(w / 2, h / 2, h * 0.28, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.fillRect(w / 2 - h * 0.18, h / 2 - 4, h * 0.36, 8);
  } else {
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.fillRect(w / 2 - (6 / PAD_WIDTH) * w, h * 0.3, (12 / PAD_WIDTH) * w, h * 0.25);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createPad() {
  const group = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ map: plateTexture(false), metalness: 0.3, roughness: 0.55 });
  const top = new THREE.MeshStandardMaterial({ map: plateTexture(true), metalness: 0.3, roughness: 0.6 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(PAD_WIDTH, THICKNESS, PAD_DEPTH), [side, side, top, side, side, side]);
  // Top just proud of the ground the sim lands on, so the terrain under it
  // never shows through.
  plate.position.y = 0.3 - THICKNESS / 2;
  plate.castShadow = true;
  plate.receiveShadow = true;
  group.add(plate);

  const mastMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#4b515b"), metalness: 0.6, roughness: 0.4 });
  const lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 3.2, 0.9) });
  const lampOff = new THREE.MeshStandardMaterial({ color: new THREE.Color("#163d22"), roughness: 0.3 });
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(0.3, 1.6, 0.6),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Left side (0) and right side (1) blink out of phase, as in the 2D game.
  const sides = [[], []];
  const lights = [];
  const inset = 1.75;
  [-1, 1].forEach((sx, i) => {
    const x = sx * (PAD_WIDTH / 2 - inset);
    for (const sz of [-1, 1]) {
      const z = sz * (PAD_DEPTH / 2 - inset);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, MAST, 8), mastMaterial);
      mast.position.set(x, MAST / 2, z);
      mast.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), lampOff);
      lamp.position.set(x, MAST + 0.9, z);
      const glow = new THREE.Sprite(glowMaterial);
      glow.position.copy(lamp.position);
      glow.scale.setScalar(8);
      group.add(mast, lamp, glow);
      sides[i].push({ lamp, glow });
    }
    const light = new THREE.PointLight(0x4ade80, 0, 90, 1.5);
    light.position.set(x, MAST + 2, 0);
    group.add(light);
    lights.push(light);
  });

  return {
    group,
    /** Put the pad's top centre at world (x, y). */
    place(x, y) {
      group.position.set(x, y, 0);
    },
    update(t, steady) {
      sides.forEach((lamps, i) => {
        const on = steady || Math.floor(t * 2 + i * 0.5) % 2 === 0;
        for (const { lamp, glow } of lamps) {
          lamp.material = on ? lampOn : lampOff;
          glow.visible = on;
        }
        lights[i].intensity = on ? 60 : 0;
      });
    },
  };
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d");
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

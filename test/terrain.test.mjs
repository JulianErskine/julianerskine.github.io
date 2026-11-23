// The 3D landscape built around the sim's ground line (visuals/terrain.js):
// it must hold that line exactly and never hide it from the camera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/js/lander/sim.js";
import { createView } from "../src/js/lander/visuals/view.js";
import { createTerrainField, buildTerrainGeometry } from "../src/js/lander/visuals/terrain.js";

const W = 640;
const H = 400;
const SEEDS = [0, 1, 2, 3, 42, 4242, 99999];

function setup(seed) {
  const sim = createSim({ width: W, height: H, seed });
  const view = createView(W, H);
  return { sim, view, field: createTerrainField(sim, view, seed) };
}

test("on the play plane (z = 0) the landscape is exactly the sim's ground", () => {
  for (const seed of SEEDS) {
    const { sim, field } = setup(seed);
    for (let x = 0; x <= W; x += 0.5) {
      const expected = H - sim.groundAt(x); // world y is up
      assert.ok(Math.abs(field.heightAt(x, 0) - expected) < 1e-9, `seed ${seed}, x ${x}: ${field.heightAt(x, 0)} vs ${expected}`);
    }
  }
});

test("nothing in front of the play plane rises above the ground line on screen", () => {
  // The camera looks down -z from (centerX, eye, distance). A point at depth
  // z > 0 lands on screen where a plane point at screen x `xs` and height
  // `onScreen` would; it must not be above the ground line there.
  for (const seed of SEEDS) {
    const { sim, view, field } = setup(seed);
    const { distance: D, eye, centerX: xc } = view;
    let worst = -Infinity;
    for (let z = 0.5; z < 450; z += z < 40 ? 0.5 : 3) {
      const k = D / (D - z);
      for (let xs = 0; xs <= W; xs += 1) {
        const x = xc + (xs - xc) / k; // world x that lands at screen x = xs
        const onScreen = eye + (field.heightAt(x, z) - eye) * k;
        worst = Math.max(worst, onScreen - (H - sim.groundAt(xs)));
      }
    }
    assert.ok(worst <= 0.01, `seed ${seed}: foreground pokes ${worst.toFixed(3)} px above the ground line`);
  }
});

test("the landscape mesh is well formed", () => {
  const { view, field } = setup(4242);
  const geometry = buildTerrainGeometry(field, view);
  const position = geometry.attributes.position.array;
  assert.ok(position.length > 0);
  assert.ok(position.every(Number.isFinite), "non-finite vertex");
  const count = position.length / 3;
  const index = geometry.index.array;
  assert.equal(index.length % 3, 0);
  assert.ok(index.every((i) => i < count), "index out of range");
  assert.ok(geometry.attributes.normal.array.every(Number.isFinite), "non-finite normal");
});

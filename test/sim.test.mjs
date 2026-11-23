// The game itself: seeded worlds, physics, and the touchdown rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSim, wrapAngle, STEP, GRAVITY, MAIN_THRUST, RCS_ACCEL, FUEL_MAX, MAIN_BURN, RCS_BURN,
  PAD_WIDTH, FEET, SCALE,
} from "../src/js/lander/sim.js";
import { rng } from "../src/js/lander/rng.js";

const W = 640;
const H = 400;
const FOOT_DROP = FEET[0][1] * SCALE;
const NONE = { left: false, right: false, up: false };
const steps = (seconds) => Math.round(seconds / STEP);

function run(sim, seconds, input = NONE) {
  for (let i = 0; i < steps(seconds); i++) sim.step(STEP, input);
}

/** A sim with the craft parked mid-air, still, upright, full tank. */
function hovering(seed = 1) {
  const sim = createSim({ width: W, height: H, seed });
  Object.assign(sim.state, { x: W / 2, y: 100, vx: 0, vy: 0, angle: 0, spin: 0 });
  return sim;
}

test("rng: a seed always gives the same sequence in [0, 1)", () => {
  const a = rng(42);
  const b = rng(42);
  const values = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(values, Array.from({ length: 1000 }, () => b()));
  assert.ok(values.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(values.slice(0, 10), Array.from({ length: 10 }, rng(43)));
});

test("a seed names an environment: same seed, same world and start", () => {
  const a = createSim({ width: W, height: H, seed: 1234 });
  const b = createSim({ width: W, height: H, seed: 99 });
  b.reset(1234);
  assert.deepEqual(Array.from(a.world.ground), Array.from(b.world.ground));
  assert.equal(a.world.padX, b.world.padX);
  assert.equal(a.world.padY, b.world.padY);
  assert.deepEqual(a.state, b.state);
  assert.equal(b.seed, 1234);

  const c = createSim({ width: W, height: H, seed: 1235 });
  assert.notDeepEqual(Array.from(a.world.ground), Array.from(c.world.ground));
});

test("reset() without a seed replays the current one; it emits a reset event", () => {
  const sim = createSim({ width: W, height: H, seed: 7 });
  const start = structuredClone(sim.state);
  run(sim, 1, { left: false, right: false, up: true });
  sim.events.length = 0;
  sim.reset();
  assert.deepEqual(sim.state, start);
  assert.deepEqual(sim.events, [{ type: "reset", seed: 7 }]);
});

test("worlds stay playable: ground in bounds, a flat pad inside the plane", () => {
  for (let seed = 0; seed < 300; seed++) {
    const { world, state } = createSim({ width: W, height: H, seed });
    assert.equal(world.ground.length, W + 1);
    for (const g of world.ground) assert.ok(g >= H - 150 && g <= H - 18, `seed ${seed}: ground ${g}`);
    assert.ok(world.padX - PAD_WIDTH / 2 >= 30 && world.padX + PAD_WIDTH / 2 <= W - 30, `seed ${seed}: pad at ${world.padX}`);
    assert.ok(world.padY >= H - 100 && world.padY <= H - 40, `seed ${seed}: pad height ${world.padY}`);
    // Flat under the whole pad (and a little past it).
    for (let x = Math.ceil(world.padX - PAD_WIDTH / 2 - 4); x <= world.padX + PAD_WIDTH / 2 + 4; x++) {
      assert.ok(Math.abs(world.ground[x] - world.padY) < 1e-3, `seed ${seed}: pad not flat at x=${x}`);
    }
    assert.equal(state.status, "flying");
    assert.equal(state.fuel, FUEL_MAX);
    assert.ok(state.x >= W * 0.3 && state.x <= W * 0.7);
  }
});

test("gravity: a dead-stick craft accelerates down at GRAVITY", () => {
  const sim = hovering();
  run(sim, 1);
  assert.ok(Math.abs(sim.state.vy - GRAVITY) < 1e-9, `vy ${sim.state.vy}`);
  assert.ok(Math.abs(sim.state.y - (100 + GRAVITY / 2)) < 0.2, `fell to ${sim.state.y}`);
  assert.equal(sim.state.vx, 0);
  assert.equal(sim.state.fuel, FUEL_MAX);
});

test("main engine: pushes along the craft's axis and burns MAIN_BURN per second", () => {
  const sim = hovering();
  run(sim, 1, { left: false, right: false, up: true });
  assert.ok(Math.abs(sim.state.vy - (GRAVITY - MAIN_THRUST)) < 1e-9, `vy ${sim.state.vy}`);
  assert.ok(Math.abs(sim.state.fuel - (FUEL_MAX - MAIN_BURN)) < 1e-9, `fuel ${sim.state.fuel}`);

  // Tilted clockwise, the push has a rightward component.
  const tilted = hovering();
  tilted.state.angle = 0.3;
  run(tilted, 1, { left: false, right: false, up: true });
  assert.ok(Math.abs(tilted.state.vx - MAIN_THRUST * Math.sin(0.3)) < 1e-6, `vx ${tilted.state.vx}`);
});

test("RCS: right spins clockwise, left counter-clockwise, both cancel; each burns RCS_BURN", () => {
  const right = hovering();
  run(right, 1, { left: false, right: true, up: false });
  assert.ok(Math.abs(right.state.spin - RCS_ACCEL) < 1e-9);
  assert.ok(right.state.angle > 0);
  assert.ok(Math.abs(right.state.fuel - (FUEL_MAX - RCS_BURN)) < 1e-9);
  // RCS only turns the craft: no translation from it.
  assert.equal(right.state.vx, 0);

  const left = hovering();
  run(left, 1, { left: true, right: false, up: false });
  assert.ok(Math.abs(left.state.spin + RCS_ACCEL) < 1e-9);

  const both = hovering();
  run(both, 1, { left: true, right: true, up: false });
  assert.equal(both.state.spin, 0);
  assert.ok(Math.abs(both.state.fuel - (FUEL_MAX - 2 * RCS_BURN)) < 1e-9);
});

test("an empty tank fires nothing", () => {
  const sim = hovering();
  sim.state.fuel = 0;
  run(sim, 1, { left: true, right: false, up: true });
  assert.equal(sim.state.main, false);
  assert.equal(sim.state.rcsLeft, false);
  assert.equal(sim.state.spin, 0);
  assert.ok(Math.abs(sim.state.vy - GRAVITY) < 1e-9);
  assert.equal(sim.state.fuel, 0);
});

test("walls: the craft stays 20 px inside the sides and top, losing speed into them", () => {
  const sim = hovering();
  Object.assign(sim.state, { x: 25, vx: -200 });
  run(sim, 0.2);
  assert.equal(sim.state.x, 20);
  assert.equal(sim.state.vx, 0);

  Object.assign(sim.state, { x: W - 25, vx: 200 });
  run(sim, 0.2);
  assert.equal(sim.state.x, W - 20);

  Object.assign(sim.state, { y: 25, vy: -200 });
  run(sim, 0.2);
  assert.ok(sim.state.y >= 20 && sim.state.y < 21, `y ${sim.state.y}`);
  assert.ok(sim.state.vy >= 0, `vy ${sim.state.vy}`);
});

/** A sim with the craft's feet a hair above the pad at x, moving as given. */
function overPad(fields = {}, seed = 3) {
  const sim = createSim({ width: W, height: H, seed });
  const { padX, padY } = sim.world;
  Object.assign(sim.state, { x: padX, y: padY - FOOT_DROP - 0.01, vx: 0, vy: 10, angle: 0, spin: 0 }, fields);
  sim.events.length = 0;
  return sim;
}

function touchDown(sim) {
  for (let i = 0; i < steps(2) && sim.state.status === "flying"; i++) sim.step(STEP, NONE);
  return sim.state;
}

test("touchdown on the pad, slow and upright: landed, settled on the pad", () => {
  const sim = overPad();
  const state = touchDown(sim);
  assert.equal(state.status, "landed");
  assert.equal(state.y, sim.world.padY - FOOT_DROP);
  assert.deepEqual([state.vx, state.vy, state.spin, state.angle], [0, 0, 0, 0]);
  assert.deepEqual(sim.events, [{ type: "landed" }]);
  assert.match(state.message, /landed/);
});

test("touchdown needs both feet on the pad", () => {
  const edge = PAD_WIDTH / 2 - FOOT_DROP; // centre offset that puts a foot on the pad's edge
  const inside = overPad({ x: overPad().world.padX + edge - 1 });
  assert.equal(touchDown(inside).status, "landed");
  const outside = overPad({ x: overPad().world.padX + edge + 1 });
  assert.equal(touchDown(outside).status, "missed");
  assert.deepEqual(outside.events, [{ type: "missed" }]);
});

test("touchdown off the pad on flat ground: missed, but safe", () => {
  // Flat ground (under 4 px of relief, so the hull stays clear) well away
  // from the pad, in the first world that has some.
  let sim;
  let x;
  for (let seed = 0; seed < 100 && x === undefined; seed++) {
    sim = createSim({ width: W, height: H, seed });
    const { ground, padX } = sim.world;
    for (let cx = 40; cx < W - 40; cx++) {
      if (Math.abs(cx - padX) < PAD_WIDTH + 40) continue;
      const span = ground.slice(cx - 20, cx + 21);
      if (Math.max(...span) - Math.min(...span) < 4) {
        x = cx;
        break;
      }
    }
  }
  assert.ok(x !== undefined, "no flat ground away from the pad in 100 worlds");
  const top = Math.min(sim.groundAt(x - FOOT_DROP), sim.groundAt(x + FOOT_DROP));
  Object.assign(sim.state, { x, y: top - FOOT_DROP - 0.01, vx: 0, vy: 5, angle: 0, spin: 0 });
  assert.equal(touchDown(sim).status, "missed");
});

test("crash rules: too fast, too fast sideways, tilted, spinning, hull first", () => {
  const cases = [
    [{ vy: 40 }, /^Too fast/],
    [{ vx: 25 }, /^Too fast/],
    [{ angle: 0.3 }, /^Touched down tilted/],
    [{ spin: 1 }, /^Touched down tilted/],
    [{ angle: Math.PI / 2, y: overPad().world.padY - 13, vy: 20 }, /^Hull struck/],
  ];
  for (const [fields, message] of cases) {
    const sim = overPad(fields);
    const state = touchDown(sim);
    assert.equal(state.status, "crashed", JSON.stringify(fields));
    assert.match(state.message, message);
    const [event] = sim.events;
    assert.equal(event.type, "crashed");
    for (const k of ["x", "y", "vx", "vy"]) assert.ok(Number.isFinite(event[k]), `crash event ${k}`);
  }
});

test("a finished round ignores input", () => {
  const sim = overPad();
  touchDown(sim);
  const done = structuredClone(sim.state);
  run(sim, 1, { left: true, right: true, up: true });
  assert.deepEqual(sim.state, done);
});

test("altitude is the lowest foot's height above the ground under it", () => {
  const sim = overPad({ y: overPad().world.padY - FOOT_DROP - 30 });
  assert.ok(Math.abs(sim.altitude() - 30) < 1e-9);
});

test("wrapAngle maps any angle into (-pi, pi]", () => {
  for (const a of [0, 1, -1, Math.PI - 1e-9, 3 * Math.PI / 2, -7, 100]) {
    const w = wrapAngle(a);
    assert.ok(w > -Math.PI - 1e-12 && w <= Math.PI + 1e-12);
    assert.ok(Math.abs(Math.sin(w) - Math.sin(a)) < 1e-9 && Math.abs(Math.cos(w) - Math.cos(a)) < 1e-9);
  }
});

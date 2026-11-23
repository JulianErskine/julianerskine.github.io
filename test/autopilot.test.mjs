// The shared autopilot machinery (autopilot.js) and the PID controller.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, STEP } from "../src/js/lander/sim.js";
import { createAutopilot, createApproach, highestGround } from "../src/js/lander/autopilot.js";
import { createPidAutopilot } from "../src/js/lander/autopilot_pid.js";

const W = 640;
const H = 400;

/** A controller that returns a fixed command and records its calls. */
function fixed(throttle, torque, rate = 1 / STEP) {
  const calls = [];
  return {
    calls,
    resets: 0,
    rate,
    telemetry: { mine: true },
    reset() {
      this.resets++;
    },
    command(dt) {
      calls.push(dt);
      return { throttle, torque };
    },
  };
}

function flyFor(pilot, sim, n) {
  const inputs = [];
  for (let i = 0; i < n; i++) {
    const input = { ...pilot.update(STEP) };
    inputs.push(input);
    // Keep the craft airborne and the round going: only the inputs matter here.
    Object.assign(sim.state, { y: 100, vy: 0, fuel: 100 });
  }
  return inputs;
}

test("duty cycles become on/off pulses with the same average", () => {
  for (const [throttle, torque] of [[0.3, 0.5], [0.77, -0.25], [0, 1], [1, -1], [0.05, 0.01]]) {
    const sim = createSim({ width: W, height: H, seed: 1 });
    const pilot = createAutopilot(sim, fixed(throttle, torque));
    const n = 2000;
    const inputs = flyFor(pilot, sim, n);
    const up = inputs.filter((i) => i.up).length / n;
    const turn = (inputs.filter((i) => i.right).length - inputs.filter((i) => i.left).length) / n;
    assert.ok(Math.abs(up - throttle) <= 1 / n, `throttle ${throttle}: on ${up}`);
    assert.ok(Math.abs(turn - torque) <= 1 / n, `torque ${torque}: net ${turn}`);
    assert.ok(inputs.every((i) => !(i.left && i.right)), "never both RCS directions at once");
  }
});

test("out-of-range commands are clamped, not accumulated", () => {
  const sim = createSim({ width: W, height: H, seed: 1 });
  const pilot = createAutopilot(sim, fixed(5, -7));
  const inputs = flyFor(pilot, sim, 100);
  assert.ok(inputs.every((i) => i.up && i.left && !i.right));
});

test("a controller runs at its rate and its command holds in between", () => {
  const sim = createSim({ width: W, height: H, seed: 1 });
  const controller = fixed(1, 0, 25); // every 8 sim steps at 200 Hz
  const pilot = createAutopilot(sim, controller);
  flyFor(pilot, sim, 80);
  const period = Math.round(1 / (25 * STEP));
  assert.equal(controller.calls.length, 80 / period);
  assert.ok(controller.calls.every((dt) => Math.abs(dt - period * STEP) < 1e-12));
});

test("a rate that isn't a whole number of sim steps is refused", () => {
  const sim = createSim({ width: W, height: H, seed: 1 });
  assert.throws(() => createAutopilot(sim, fixed(0, 0, 1 / (2.5 * STEP))), /whole number of sim steps/);
  assert.throws(() => createAutopilot(sim, fixed(0, 0, 2 / STEP)), /whole number of sim steps/);
});

test("no input and no controller calls once the round is over; reset reaches the controller", () => {
  const sim = createSim({ width: W, height: H, seed: 1 });
  const controller = fixed(1, 1);
  const pilot = createAutopilot(sim, controller);
  assert.equal(pilot.telemetry, controller.telemetry);
  sim.state.status = "crashed";
  for (let i = 0; i < 10; i++) assert.deepEqual(pilot.update(STEP), { left: false, right: false, up: false });
  assert.equal(controller.calls.length, 0);
  pilot.reset();
  assert.equal(controller.resets, 1);
});

test("approach: commits when lined up and slow, gives up only past the outer band", () => {
  const sim = createSim({ width: W, height: H, seed: 1 });
  const approach = createApproach(sim);
  const at = (dx, vx) => {
    Object.assign(sim.state, { x: sim.world.padX + dx, vx });
    return approach.update();
  };
  assert.equal(at(10, 0), false); // not lined up yet
  assert.equal(at(3, 10), false); // lined up but too fast sideways
  assert.equal(at(3, 2), true); // commits
  assert.equal(at(-12, 15), true); // drifting, still inside the outer band
  assert.equal(at(15, 0), false); // gives up
  at(3, 2);
  approach.reset();
  assert.equal(at(10, 0), false);
});

test("highestGround is the smallest plane y over the span", () => {
  const sim = createSim({ width: W, height: H, seed: 5 });
  let expected = Infinity;
  for (let x = 100; x <= 300; x += 2) expected = Math.min(expected, sim.groundAt(x));
  assert.equal(highestGround(sim, 100, 300), expected);
  assert.ok(highestGround(sim, 0, W) <= highestGround(sim, 100, 300));
});

function flyRound(seed, makePilot) {
  const sim = createSim({ width: W, height: H, seed });
  const pilot = makePilot(sim);
  pilot.reset();
  let n = 0;
  while (sim.state.status === "flying" && n * STEP < 120) {
    sim.step(STEP, pilot.update(STEP));
    n++;
  }
  return { ...sim.state, steps: n };
}

test("PID lands from the start of a round in nearly every environment", () => {
  const outcomes = {};
  for (let seed = 0; seed < 100; seed++) {
    const { status } = flyRound(seed, createPidAutopilot);
    outcomes[status] = (outcomes[status] || 0) + 1;
  }
  assert.ok((outcomes.landed || 0) >= 95, `PID outcomes over 100 seeds: ${JSON.stringify(outcomes)}`);
});

test("PID rounds are reproducible", () => {
  const first = flyRound(4242, createPidAutopilot);
  flyRound(777, createPidAutopilot);
  assert.deepEqual(flyRound(4242, createPidAutopilot), first);
});

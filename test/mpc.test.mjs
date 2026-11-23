// The acados MPC, as compiled to wasm (src/js/lander/mpc/, built by
// `make mpc`). These check the contract, not how well it flies: the
// formulation is expected to change.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createSim, STEP, GRAVITY, MAIN_THRUST, RCS_ACCEL } from "../src/js/lander/sim.js";
import { loadMpc, createMpcAutopilot } from "../src/js/lander/autopilot_mpc.js";

const W = 640;
const H = 400;
let mod;

before(async () => {
  mod = await loadMpc();
});

// The sim's dynamics with continuous inputs: throttle T in [0, 1], torque
// tau in [-1, 1]. Written from sim.js's constants, not from ocp.py.
function deriv([, , vx, vy, th, om], [T, tau]) {
  return [vx, vy, MAIN_THRUST * T * Math.sin(th), GRAVITY - MAIN_THRUST * T * Math.cos(th), om, RCS_ACCEL * tau];
}

function integrate(x, u, dt, substeps = 2000) {
  const h = dt / substeps;
  let s = x.slice();
  const add = (a, b, k) => a.map((v, i) => v + k * b[i]);
  for (let i = 0; i < substeps; i++) {
    const k1 = deriv(s, u);
    const k2 = deriv(add(s, k1, h / 2), u);
    const k3 = deriv(add(s, k2, h / 2), u);
    const k4 = deriv(add(s, k3, h), u);
    s = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  return s;
}

test("the solver starts and reports a sane horizon", () => {
  assert.ok(mod._mpc_horizon() > 0);
  assert.ok(mod._mpc_stage_dt() > 0);
});

test("the MPC's model is the sim's physics (else: run `make mpc`)", () => {
  // From a few states, compare the plan's first stage with integrating
  // sim.js's dynamics under the plan's first input.
  const states = [
    [200, 100, 20, -10, 0.2, 0.3],
    [400, 250, -30, 25, -0.5, -0.4],
    [320, 150, 0, 0, 0, 0],
  ];
  for (const x0 of states) {
    mod._mpc_reset();
    mod._mpc_set_reference(320, 300, GRAVITY / MAIN_THRUST);
    for (let k = 0; k <= mod._mpc_horizon(); k++) mod._mpc_set_floor(k, 1e4);
    for (let i = 0; i < 5; i++) mod._mpc_solve(...x0, 1);
    const u = [mod._mpc_u(0), mod._mpc_u(1)];
    assert.ok(u[0] >= -1e-6 && u[0] <= 1 + 1e-6 && u[1] >= -1 - 1e-6 && u[1] <= 1 + 1e-6, `input ${u} out of bounds`);
    for (let i = 0; i < 6; i++) assert.ok(Math.abs(mod._mpc_x(0, i) - x0[i]) < 1e-9, "plan doesn't start at the state");
    const expected = integrate(x0, u, mod._mpc_stage_dt());
    const planned = Array.from({ length: 6 }, (_, i) => mod._mpc_x(1, i));
    const names = ["x", "y", "vx", "vy", "angle", "spin"];
    planned.forEach((v, i) => {
      assert.ok(Math.abs(v - expected[i]) < 1e-4, `${names[i]}: MPC predicts ${v}, sim.js physics give ${expected[i]}`);
    });
  }
});

function flyRound(seed, onStep = () => {}) {
  const sim = createSim({ width: W, height: H, seed });
  const pilot = createMpcAutopilot(sim, mod);
  pilot.reset();
  let n = 0;
  while (sim.state.status === "flying" && n * STEP < 60) {
    const input = pilot.update(STEP);
    onStep(n, input, pilot.telemetry);
    sim.step(STEP, input);
    n++;
  }
  return { ...sim.state, steps: n };
}

test("after a reset the engines stay off while the plan warms up, then it flies", () => {
  let warmSteps = 0;
  let firstBurn = Infinity;
  flyRound(4242, (n, input, telemetry) => {
    if (telemetry.warmingUp) {
      warmSteps = n + 1;
      assert.deepEqual(input, { left: false, right: false, up: false }, `engine fired while warming up (step ${n})`);
    }
    if (input.up && firstBurn === Infinity) firstBurn = n;
  });
  assert.ok(warmSteps > 0 && warmSteps * STEP <= 0.25, `warm-up lasted ${warmSteps * STEP} s`);
  assert.ok(firstBurn < Infinity, "never fired the main engine");
});

test("commands stay finite and within the engines' range", () => {
  flyRound(777, (n, input, telemetry) => {
    assert.ok(Number.isFinite(telemetry.throttle) && telemetry.throttle >= -1e-6 && telemetry.throttle <= 1 + 1e-6, `throttle ${telemetry.throttle}`);
    assert.ok(Number.isFinite(telemetry.torque) && Math.abs(telemetry.torque) <= 1 + 1e-6, `torque ${telemetry.torque}`);
    assert.ok(Number.isFinite(telemetry.solveMs));
  });
});

test("MPC rounds are reproducible, even with another round in between", () => {
  const first = flyRound(4242);
  flyRound(777);
  assert.deepEqual(flyRound(4242), first);
});

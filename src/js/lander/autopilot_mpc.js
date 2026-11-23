// MPC controller for the lander (see autopilot.js for what a controller is):
// a nonlinear model predictive controller generated with acados and compiled
// to WebAssembly. tools/lander-mpc/ builds `mpc/lander_mpc.{js,wasm}`; the
// formulation is in tools/lander-mpc/ocp.py.
//
// It re-plans at RATE: the inputs over the next few seconds from the current
// state, one real-time SQP iteration warm-started from the last plan. Its
// first planned input is the command until the next re-plan.
//
// After a reset there's no plan to warm-start from. Rather than iterate to
// convergence in one go (a long, uneven solve), the first WARMUP_PLANS
// re-plans run one iteration each like any other, while the engines stay
// off: the craft freefalls for that short time.
//
// The solver only knows the terrain through a per-stage floor: before each
// re-plan, the ground under the last plan's path (plus clearance for the
// feet) bounds how low the craft's centre may go at that stage. Over the pad
// the floor sits just under the touchdown point, which is where the cost
// pulls the craft once it's lined up; until then the target hovers APPROACH
// px above it.
import { GRAVITY, MAIN_THRUST, PAD_WIDTH, wrapAngle } from "./sim.js";
import { createAutopilot, createApproach, highestGround, FOOT_DROP } from "./autopilot.js";

const RATE = 100; // re-plans per second
const WARMUP_PLANS = 10; // 0.1 s of freefall after a reset
const SINK = 4; // px below contact the target sits, so the craft settles onto the pad
const APPROACH = 30; // px above contact the target hovers until lined up
const CLEARANCE = 8; // px the feet keep above terrain off the pad
const FOOTPRINT = 22; // px either side of the centre the feet may be over
const ON_PAD = PAD_WIDTH / 2 - FOOT_DROP; // max centre offset with both feet on the pad
const HOVER = GRAVITY / MAIN_THRUST;

let loading = null;

/** Load and start the wasm solver once; resolves to the module. */
export function loadMpc() {
  loading ??= import("./mpc/lander_mpc.js")
    .then((m) => m.default())
    .then((mod) => {
      const status = mod._mpc_init();
      if (status !== 0) throw new Error(`acados solver failed to start (status ${status})`);
      return mod;
    });
  return loading;
}

/** An MPC pilot for `sim`, using a module from loadMpc(). One at a time per module. */
export function createMpcAutopilot(sim, mod) {
  const horizon = mod._mpc_horizon();
  const stageDt = mod._mpc_stage_dt();
  const approach = createApproach(sim);
  const telemetry = { status: 0, solveMs: 0, throttle: 0, torque: 0, warmingUp: true };
  let plans = 0;

  function reset() {
    mod._mpc_reset();
    approach.reset();
    plans = 0;
    telemetry.throttle = telemetry.torque = 0;
    telemetry.warmingUp = true;
  }

  // Lowest the centre may go (largest plane y) with its feet around x.
  function floorAt(x) {
    const { padX, padY } = sim.world;
    if (Math.abs(x - padX) <= ON_PAD) return padY - FOOT_DROP + SINK + 2;
    return highestGround(sim, x - FOOTPRINT, x + FOOTPRINT) - FOOT_DROP - CLEARANCE;
  }

  function command() {
    const s = sim.state;
    const { padX, padY } = sim.world;
    const contact = padY - FOOT_DROP;
    mod._mpc_set_reference(padX, approach.update() ? contact + SINK : contact - APPROACH, HOVER);
    // Floors along the last plan's path; with no plan yet, along a straight
    // coast from here.
    for (let k = 0; k <= horizon; k++) {
      const x = plans === 0 ? s.x + s.vx * k * stageDt : mod._mpc_x(k, 0);
      mod._mpc_set_floor(k, floorAt(x));
    }
    telemetry.status = mod._mpc_solve(s.x, s.y, s.vx, s.vy, wrapAngle(s.angle), s.spin, 1);
    telemetry.solveMs = mod._mpc_solve_time() * 1000;
    plans++;
    telemetry.warmingUp = plans < WARMUP_PLANS;
    const throttle = mod._mpc_u(0);
    const torque = mod._mpc_u(1);
    // Engines off while warming up; and a failed QP can leave NaNs, so coast
    // rather than fire on garbage.
    telemetry.throttle = !telemetry.warmingUp && Number.isFinite(throttle) ? throttle : 0;
    telemetry.torque = !telemetry.warmingUp && Number.isFinite(torque) ? torque : 0;
    return { throttle: telemetry.throttle, torque: telemetry.torque };
  }

  return createAutopilot(sim, { rate: RATE, reset, command, telemetry });
}

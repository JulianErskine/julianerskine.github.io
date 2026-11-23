// What every autopilot shares. A controller only decides a throttle and a
// torque at its own rate; `createAutopilot` turns that into a pilot with the
// same interface as the keys:
//
//   update(dt) -> { left, right, up }   once per sim step
//   reset()                             on restart and on pilot change
//   telemetry                           the controller's, for the HUD
//
// A controller is { rate, reset(), command(dt) -> { throttle, torque },
// telemetry }: `rate` in Hz (a whole number of sim steps per tick), `command`
// called once per tick with the tick's dt, its result held until the next.
// `throttle` in [0, 1] is the main engine's duty, `torque` in [-1, 1] the
// RCS's, + clockwise.
//
// The engines are only on or off, so commands go through first-order
// sigma-delta modulation: over many steps the on-time matches the duty.
// Also here: landing logic and terrain queries the controllers have in common.
import { FEET, SCALE, STEP } from "./sim.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Craft centre to the bottom of its feet, plane px. */
export const FOOT_DROP = FEET[0][1] * SCALE;

export function createAutopilot(sim, controller) {
  const period = Math.round(1 / (controller.rate * STEP));
  if (period < 1 || Math.abs(period * STEP * controller.rate - 1) > 1e-9) {
    throw new Error(`autopilot rate ${controller.rate} Hz isn't a whole number of sim steps`);
  }
  const input = { left: false, right: false, up: false };
  let steps = 0;
  let command = { throttle: 0, torque: 0 };
  let main = 0;
  let rcs = 0;

  function reset() {
    controller.reset();
    steps = 0;
    command = { throttle: 0, torque: 0 };
    main = rcs = 0;
    input.left = input.right = input.up = false;
  }

  function update() {
    if (sim.state.status !== "flying") {
      main = rcs = 0;
      input.left = input.right = input.up = false;
      return input;
    }
    if (steps % period === 0) command = controller.command(period * STEP);
    steps++;
    main += clamp(command.throttle, 0, 1);
    input.up = main >= 0.5;
    if (input.up) main -= 1;
    rcs += clamp(command.torque, -1, 1);
    const pulse = rcs >= 0.5 ? 1 : rcs <= -0.5 ? -1 : 0;
    rcs -= pulse;
    input.right = pulse > 0; // right spins clockwise
    input.left = pulse < 0;
    return input;
  }

  return { update, reset, telemetry: controller.telemetry };
}

const LINED_UP = 6; // px from the pad centre, and px/s sideways
const GIVE_UP = 14; // px from the pad centre

/**
 * Whether to commit to the pad: true once the craft is within LINED_UP px
 * of the pad centre and moving sideways slower than LINED_UP px/s, false
 * again if it drifts more than GIVE_UP px off. Going straight for the pad
 * tends to touch down mid-correction, tilted.
 */
export function createApproach(sim) {
  let descending = false;
  return {
    reset() {
      descending = false;
    },
    update() {
      const dx = Math.abs(sim.state.x - sim.world.padX);
      if (dx > GIVE_UP) descending = false;
      else if (dx < LINED_UP && Math.abs(sim.state.vx) < LINED_UP) descending = true;
      return descending;
    },
  };
}

/** Highest ground (smallest plane y) over [from, to], sampled every 2 px. */
export function highestGround(sim, from, to) {
  let top = Infinity;
  for (let x = from; x <= to; x += 2) top = Math.min(top, sim.groundAt(x));
  return top;
}

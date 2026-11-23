// PID controller for the lander (see autopilot.js for what a controller is).
//
// Cascaded loops, outer to inner, every sim step:
//   - Horizontal: position error -> wanted vx -> PID -> wanted x acceleration.
//   - Vertical: height above where it may go (the pad once lined up over it,
//     else a clearance over the highest ground on the way) -> wanted vy ->
//     PID -> wanted vertical thrust.
//   - The thrust vector those two ask for gives the tilt to hold; an attitude
//     PID turns tilt error into RCS torque.
import { GRAVITY, MAIN_THRUST, RCS_ACCEL, STEP, wrapAngle } from "./sim.js";
import { createAutopilot, createApproach, highestGround, FOOT_DROP } from "./autopilot.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createPid({ kp, ki = 0, kd = 0, iLimit = Infinity }) {
  let integral = 0;
  let previous = null;
  return {
    reset() {
      integral = 0;
      previous = null;
    },
    // `rate` is the error's derivative when it's known directly (e.g. from a
    // measured velocity); otherwise it's differenced from the last error.
    update(error, dt, rate) {
      integral = clamp(integral + error * dt, -iLimit, iLimit);
      const derivative = rate ?? (previous === null ? 0 : (error - previous) / dt);
      previous = error;
      return kp * error + ki * integral + kd * derivative;
    },
  };
}

const CLEARANCE = 30; // px above the highest ground on the way to the pad
const MAX_DESCENT = 45; // px/s
const MAX_CLIMB = 25; // px/s
const TOUCHDOWN = 5; // px/s descent kept up to contact
const BRAKING = 25; // px/s^2 deceleration the descent profile plans on
const MAX_TILT = 0.6; // rad
const MAX_TILT_LANDING = 0.05; // rad, in the last few px over the pad

export function createPidAutopilot(sim) {
  const vxPid = createPid({ kp: 1.2, ki: 0.15, iLimit: 30 });
  const vyPid = createPid({ kp: 2.5, ki: 0.6, iLimit: 25 });
  const tiltPid = createPid({ kp: 16, kd: 7 });
  const approach = createApproach(sim);
  const telemetry = { target: 0, vxWanted: 0, vyWanted: 0, tiltWanted: 0, throttle: 0 };

  function reset() {
    for (const pid of [vxPid, vyPid, tiltPid]) pid.reset();
    approach.reset();
  }

  function command(dt) {
    const s = sim.state;
    const { padX, padY } = sim.world;

    // Vertical: how far it may still descend, and how fast to do it.
    const dx = padX - s.x;
    const landing = approach.update();
    const floor = landing ? padY : highestGround(sim, Math.min(s.x, padX) - 25, Math.max(s.x, padX) + 25) - CLEARANCE;
    const height = floor - (s.y + FOOT_DROP);
    // Fast while there's room to brake, slowing toward the floor.
    let vyWanted = height >= 0
      ? Math.min(MAX_DESCENT, 0.8 * Math.sqrt(2 * BRAKING * height))
      : Math.max(-MAX_CLIMB, 0.8 * height);
    if (landing) vyWanted = Math.max(vyWanted, TOUCHDOWN);
    // Plane y is down: a positive error means descend faster, i.e. less thrust.
    const descendAccel = vyPid.update(vyWanted - s.vy, dt);
    const liftWanted = clamp(GRAVITY - descendAccel, 0, MAIN_THRUST);

    // Horizontal: no sideways travel while below the clearance.
    const travel = landing ? 1 : clamp(1 + height / 20, 0, 1);
    const vxWanted = clamp(0.5 * dx, -40, 40) * travel;
    const sideAccel = clamp(vxPid.update(vxWanted - s.vx, dt), -35, 35);

    // Tilt so the thrust that gives the lift also gives the side push.
    const tiltLimit = landing ? clamp((MAX_TILT * height) / 60, MAX_TILT_LANDING, MAX_TILT) : MAX_TILT;
    const tiltWanted = clamp(Math.atan2(sideAccel, Math.max(liftWanted, 1)), -tiltLimit, tiltLimit);
    const tiltError = wrapAngle(tiltWanted - s.angle);
    const spinAccel = tiltPid.update(tiltError, dt, -s.spin);

    // Throttle for the lift at the current tilt; the tilt brings the side
    // push. Fading out as the craft points away from where it should, so an
    // upset (say, handed over upside down) isn't driven into the ground.
    const cos = Math.cos(s.angle);
    const aligned = clamp((cos - 0.2) / 0.3, 0, 1) * clamp((1 - Math.abs(tiltError)) / 0.5, 0, 1);
    const throttle = clamp(liftWanted / (MAIN_THRUST * Math.max(cos, 0.5)), 0, 1) * aligned;

    Object.assign(telemetry, { target: floor, vxWanted, vyWanted, tiltWanted, throttle });
    return { throttle, torque: spinAccel / RCS_ACCEL };
  }

  return createAutopilot(sim, { rate: 1 / STEP, reset, command, telemetry });
}

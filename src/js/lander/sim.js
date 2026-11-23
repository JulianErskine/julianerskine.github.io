// Lunar lander simulation: world generation, game state and rigid-body
// physics. No DOM, no rendering; the visuals read this and draw it.
//
// The craft is a rigid body: the main engine (input.up) pushes along its own
// axis, the RCS thruster quads (input.left/right) fire as a couple and only
// rotate it, so moving sideways means tilting and burning.
//
// Everything lives on one vertical plane, in the plane's own units: x to the
// right, y DOWN, in px of the original 2D game, `width` x `height`. Angles are
// clockwise as seen on that plane. The visuals map this into 3D (y up, the
// plane at z = 0); a future 3D sim would replace `ground` with a heightfield.
import { rng } from "./rng.js";

export const GRAVITY = 40; // px/s^2
export const MAIN_THRUST = 100; // px/s^2 along the craft's axis
export const RCS_ACCEL = 2.4; // rad/s^2
export const FUEL_MAX = 100;
export const MAIN_BURN = 9; // fuel %/s
export const RCS_BURN = 2; // fuel %/s per firing direction
export const PAD_WIDTH = 70;
export const SAFE_VY = 35; // px/s
export const SAFE_VX = 20; // px/s
export const SAFE_TILT = 0.2; // rad, ~11 degrees
export const SAFE_SPIN = 0.8; // rad/s
export const SCALE = 1.2; // lander body units -> px

// Lander geometry in body units: origin at the descent stage centre, y down.
// FEET and HULL are the contact points; the nozzles are where thrust exits.
export const FEET = [[-15, 15], [15, 15]];
export const HULL = [
  [-11.5, 6.5], [11.5, 6.5], [-11.5, 0], [11.5, 0], [-9.5, -7],
  [9, -7.5], [-6.5, -12.5], [6.5, -12], [0, -15.5],
];
export const MAIN_NOZZLE = [0, 13];
export const RCS_X = 10.5;
// Which RCS nozzles fire for each command, and which way their jets point
// (body y: -1 up, +1 down). Left: left quad fires up, right quad fires down,
// so the couple turns the craft counter-clockwise.
export const RCS_JETS = {
  left: [{ at: [-RCS_X, -10.5], dir: -1 }, { at: [RCS_X, -6.5], dir: 1 }],
  right: [{ at: [RCS_X, -10.5], dir: -1 }, { at: [-RCS_X, -6.5], dir: 1 }],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The sim is stepped at this fixed dt: with the same seed and the same input
// every step, a round plays out identically.
export const STEP = 1 / 200; // s; 200 Hz, so the MPC's 100 Hz is every 2 steps

/**
 * A sim whose world and starting state come from `seed` (any 32-bit
 * integer): `reset(seed)` rebuilds both, so a seed names an environment.
 */
export function createSim({ width, height, seed }) {
  let random; // reseeded by reset()
  const rand = (a, b) => a + random() * (b - a);

  // 1D value noise: random knots every `step` px, cosine-interpolated.
  function noise1d(step, amp) {
    const knots = Array.from({ length: Math.ceil(width / step) + 2 }, () => rand(-1, 1));
    return (x) => {
      const i = Math.floor(x / step);
      const s = (1 - Math.cos((x / step - i) * Math.PI)) / 2;
      return amp * lerp(knots[i], knots[i + 1], s);
    };
  }

  function makeWorld() {
    const fns = [[160, 45], [60, 18], [18, 5], [6, 1.5]].map(([s, a]) => noise1d(s, a));
    const ground = new Float32Array(width + 1);
    for (let x = 0; x <= width; x++) ground[x] = height - 75 + fns.reduce((s, f) => s + f(x), 0);
    const padX = rand(PAD_WIDTH / 2 + 30, width - PAD_WIDTH / 2 - 30);
    const padY = clamp(ground[Math.round(padX)], height - 100, height - 40);
    // Flatten the pad site and blend it into the surrounding terrain.
    for (let x = 0; x <= width; x++) {
      const d = Math.abs(x - padX) - (PAD_WIDTH / 2 + 4);
      const w = d <= 0 ? 1 : 1 - smoothstep(d / 30);
      ground[x] = clamp(lerp(ground[x], padY, w), height - 150, height - 18);
    }
    return { ground, padX, padY };
  }

  const sim = {
    width,
    height,
    seed,
    world: null,
    state: null,
    // Things that happened since the last drain, for the visuals and sound:
    // { type: "reset" | "landed" | "missed" | "crashed", ... }.
    events: [],
    reset,
    step,
    groundAt,
    bodyToPlane,
    altitude,
  };

  function reset(nextSeed = sim.seed) {
    sim.seed = nextSeed >>> 0;
    random = rng(sim.seed);
    sim.world = makeWorld();
    sim.state = {
      x: rand(width * 0.3, width * 0.7),
      y: 50,
      vx: rand(-40, 40),
      vy: 0,
      angle: 0,
      spin: 0,
      fuel: FUEL_MAX,
      main: false,
      rcsLeft: false,
      rcsRight: false,
      status: "flying", // flying | landed | missed | crashed
      message: "",
    };
    sim.events.push({ type: "reset", seed: sim.seed });
  }

  function groundAt(x) {
    const cx = clamp(x, 0, width);
    const i = Math.min(Math.floor(cx), width - 1);
    return lerp(sim.world.ground[i], sim.world.ground[i + 1], cx - i);
  }

  // Body units -> plane coordinates for the craft's current pose.
  function bodyToPlane(px, py) {
    const { x, y, angle } = sim.state;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [x + (px * c - py * s) * SCALE, y + (px * s + py * c) * SCALE];
  }

  // Height of the lowest foot above the ground under it.
  function altitude() {
    return Math.max(0, Math.min(...FEET.map(([fx, fy]) => {
      const [x, y] = bodyToPlane(fx, fy);
      return groundAt(x) - y;
    })));
  }

  function step(dt, input) {
    const state = sim.state;
    if (state.status !== "flying") return;

    const fuelled = state.fuel > 0;
    state.main = input.up && fuelled;
    state.rcsLeft = input.left && fuelled;
    state.rcsRight = input.right && fuelled;

    let ax = 0;
    let ay = GRAVITY;
    let burn = 0;
    if (state.main) {
      ax += Math.sin(state.angle) * MAIN_THRUST;
      ay -= Math.cos(state.angle) * MAIN_THRUST;
      burn += MAIN_BURN;
    }
    if (state.rcsLeft) {
      state.spin -= RCS_ACCEL * dt;
      burn += RCS_BURN;
    }
    if (state.rcsRight) {
      state.spin += RCS_ACCEL * dt;
      burn += RCS_BURN;
    }
    state.fuel = Math.max(0, state.fuel - burn * dt);

    state.vx += ax * dt;
    state.vy += ay * dt;
    state.angle += state.spin * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;

    // Soft walls at the edges and the top of the plane.
    if (state.x < 20 || state.x > width - 20) {
      state.x = clamp(state.x, 20, width - 20);
      state.vx = 0;
    }
    if (state.y < 20) {
      state.y = 20;
      state.vy = Math.max(0, state.vy);
    }

    checkContact();
  }

  function checkContact() {
    const state = sim.state;
    const below = ([x, y]) => y >= groundAt(x);
    const feet = FEET.map(([x, y]) => bodyToPlane(x, y));
    const hullHit = HULL.some(([x, y]) => below(bodyToPlane(x, y)));
    if (!hullHit && !feet.some(below)) return;

    const padL = sim.world.padX - PAD_WIDTH / 2;
    const onPad = feet.every(([x]) => x >= padL && x <= padL + PAD_WIDTH);
    const gentle = Math.abs(state.vy) < SAFE_VY && Math.abs(state.vx) < SAFE_VX;
    const upright = Math.abs(wrapAngle(state.angle)) < SAFE_TILT && Math.abs(state.spin) < SAFE_SPIN;
    state.main = state.rcsLeft = state.rcsRight = false;

    if (!hullHit && gentle && upright) {
      state.vx = state.vy = state.spin = 0;
      if (onPad) {
        state.status = "landed";
        state.angle = 0;
        state.y = sim.world.padY - FEET[0][1] * SCALE;
        state.message = "The Eagle has landed! Space to fly again.";
      } else {
        state.status = "missed";
        state.message = "Safe touchdown, but off the pad. Space to retry.";
      }
      sim.events.push({ type: state.status });
      return;
    }
    // Pose and velocity at impact, for the explosion.
    const impact = { x: state.x, y: state.y, vx: state.vx, vy: state.vy };
    state.status = "crashed";
    const why = hullHit ? "Hull struck the ground" : !upright ? "Touched down tilted" : "Too fast";
    state.message = `${why}: crashed. Space to retry.`;
    sim.events.push({ type: "crashed", ...impact });
  }

  reset();
  return sim;
}

// Lander page entry: input (keys or an autopilot), environment seeds, the
// fixed-step sim loop with variable-rate rendering, and the HUD.
import { createSim, wrapAngle, STEP } from "./sim.js";
import { createPidAutopilot } from "./autopilot_pid.js";
import { loadMpc, createMpcAutopilot } from "./autopilot_mpc.js";
import { createVisuals } from "./visuals/scene.js";
import { createPlots } from "./plots.js";

const MODE_LABELS = { manual: "manual", pid: "PID", mpc: "MPC" };

const deg = (rad) => ((wrapAngle(rad) * 180) / Math.PI).toFixed(0);

const canvas = document.getElementById("sim-canvas");
const statsEl = document.getElementById("sim-stats");
const messageEl = document.getElementById("sim-message");
const plotsEl = document.getElementById("sim-plots");
const seedInput = document.getElementById("sim-seed");

const MAX_SEED = 0xffffffff;
// New random seeds stay short enough to read and type.
const randomSeed = () => Math.floor(Math.random() * 1e6);

/** Wire a button group; returns a function that shows `value` as pressed. */
function toggleGroup(id, onPick) {
  const buttons = document.querySelectorAll(`#${id} [data-value]`);
  for (const b of buttons) b.addEventListener("click", () => onPick(b.dataset.value));
  return (value) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === value));
  };
}

function showMessage(text, status) {
  messageEl.textContent = text;
  messageEl.hidden = !text;
  messageEl.dataset.status = status;
}

function start() {
  const firstSeed = randomSeed();
  seedInput.value = firstSeed;
  const sim = createSim({ width: canvas.width, height: canvas.height, seed: firstSeed });
  let visuals;
  try {
    visuals = createVisuals(canvas, sim);
  } catch (err) {
    console.error(err);
    showMessage("This simulator needs WebGL 2, which isn't available here.", "crashed");
    return;
  }

  // Autopilots by mode; manual has none. The MPC joins once its wasm solver
  // has loaded, on first use.
  const pilots = { pid: createPidAutopilot(sim) };
  const plots = createPlots(plotsEl, sim);
  let mode = "manual"; // manual | pid | mpc
  let env = "random"; // random | fixed
  const keys = { left: false, right: false, up: false };

  function selectMode(next) {
    if (next === mode) return;
    mode = next;
    pilots[mode]?.reset();
    keys.left = keys.right = keys.up = false;
    showMode(mode);
    if (sim.state.status === "flying") plots.markMode(MODE_LABELS[mode]);
  }
  const showMode = toggleGroup("sim-pilot", (next) => {
    if (next === "mpc" && !pilots.mpc) loadMpcPilot();
    else selectMode(next);
  });

  const mpcButton = document.querySelector('#sim-pilot [data-value="mpc"]');
  async function loadMpcPilot() {
    if (mpcButton.disabled) return;
    mpcButton.disabled = true;
    mpcButton.setAttribute("aria-busy", "true");
    try {
      pilots.mpc = createMpcAutopilot(sim, await loadMpc());
      selectMode("mpc");
    } catch (err) {
      console.error(err);
      mpcButton.textContent = "MPC (failed to load)";
    } finally {
      mpcButton.disabled = false;
      mpcButton.removeAttribute("aria-busy");
    }
  }
  // Switching environment mode applies from the next restart: the round
  // being flown is already the seed in the box.
  const showEnv = toggleGroup("sim-env", (next) => {
    env = next;
    showEnv(env);
  });

  // The seed in the box, or the current round's if the box doesn't hold one.
  function seedFromInput() {
    const value = Number(seedInput.value);
    return seedInput.value !== "" && Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : sim.seed;
  }

  // A new round: new world, fresh controller, empty plots.
  function restart() {
    const seed = env === "random" ? randomSeed() : seedFromInput();
    seedInput.value = seed;
    sim.reset(seed);
    for (const pilot of Object.values(pilots)) pilot.reset();
    plots.clear();
    if (mode !== "manual") plots.markMode(MODE_LABELS[mode]);
  }

  // Entering a seed means wanting that environment: fly it now.
  seedInput.addEventListener("change", () => {
    env = "fixed";
    showEnv(env);
    restart();
  });

  const KEYMAP = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "up", w: "up", W: "up",
  };
  function onKey(e, isDown) {
    // Typing in the seed box: leave its keys alone, but still let go of any
    // thruster held when focus moved there.
    if (e.target instanceof HTMLInputElement) {
      if (!isDown && KEYMAP[e.key]) keys[KEYMAP[e.key]] = false;
      return;
    }
    if (e.key === " ") {
      // Also on keyup, so Space on a focused mode button restarts rather
      // than pressing the button.
      e.preventDefault();
      if (isDown && sim.state.status !== "flying") restart();
      return;
    }
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault(); // keep arrows from scrolling the page
    if (mode === "manual") keys[k] = isDown;
  }
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    keys.left = keys.right = keys.up = false;
  });

  // Shown y-up (the sim's plane is y-down), matching the plots.
  function updateHud() {
    const { state } = sim;
    let text =
      `altitude ${sim.altitude().toFixed(0)}px` +
      ` · vx ${state.vx.toFixed(0)} vy ${(-state.vy).toFixed(0)}` +
      ` · tilt ${deg(state.angle)}°` +
      ` · fuel ${state.fuel.toFixed(0)}%`;
    if (state.status === "flying" && mode === "pid") {
      const t = pilots.pid.telemetry;
      text += ` · PID wants vx ${t.vxWanted.toFixed(0)} vy ${(-t.vyWanted).toFixed(0)} tilt ${deg(t.tiltWanted)}°`;
    } else if (state.status === "flying" && mode === "mpc") {
      const t = pilots.mpc.telemetry;
      text += t.warmingUp
        ? " · MPC warming up (engines off)"
        : ` · MPC status ${t.status}, solve ${t.solveMs.toFixed(2)} ms, throttle ${(t.throttle * 100).toFixed(0)}%`;
    }
    statsEl.textContent = text;
    if (messageEl.textContent !== state.message) showMessage(state.message, state.status);
  }

  // The sim advances in fixed STEPs, as many as the frame's time covers
  // (carrying the remainder), so a round doesn't depend on the frame rate.
  // Rendering runs once per frame at whatever dt it got.
  let last = performance.now();
  let pending = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pending += dt;
    while (pending >= STEP) {
      // Plots sample only rounds in flight, including the step that ends
      // one, so they hold still once it's over until the next restart.
      const flying = sim.state.status === "flying";
      sim.step(STEP, pilots[mode] ? pilots[mode].update(STEP) : keys);
      if (flying) plots.record(STEP);
      pending -= STEP;
    }
    visuals.update(dt, now / 1000);
    visuals.render();
    updateHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (canvas) start();

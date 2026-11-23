# Lander MPC toolchain

Builds the `/simulator/` page's MPC autopilot: a nonlinear MPC formulated
with [acados](https://docs.acados.org/) in Python, generated as C, and
compiled with Emscripten to `src/js/lander/mpc/lander_mpc.{js,wasm}`. Those
two files are committed, so the site's normal build and CI never need any of
this.

```sh
make mpc   # build the toolchain image if needed, then regenerate and recompile
```

The first run builds the image (a few minutes: it compiles acados, HPIPM and
BLASFEO to wasm); after that a rebuild takes a few seconds.

| File | Role |
|---|---|
| `ocp.py` | The optimal control problem: model, cost, constraints, horizon, solver options. **Tune here.** |
| `lander_mpc.c` | The wasm-facing API (scalar args only) around the generated `lander_acados_*` solver. |
| `build.sh` | Runs inside the image: `ocp.py` → `build/c_generated_code/`, then `emcc` → `src/js/lander/mpc/`. |
| `Dockerfile` | emsdk + acados (pinned versions), with acados, HPIPM and BLASFEO built as static wasm libraries. |
| `build/` | The generated C, kept for reading and debugging; gitignored. |

## How the pieces connect

- **Model and units** are the sim's: plane coordinates (x right, y down,
  px), angle clockwise, inputs as engine duty cycles (`T` in [0, 1], `tau` in
  [-1, 1]). `ocp.py` reads `GRAVITY`, `MAIN_THRUST` and `RCS_ACCEL` from
  `src/js/lander/sim.js`, so re-run `make mpc` after changing them.
- **Run-time inputs**, set by `src/js/lander/autopilot_mpc.js` before every
  solve: the reference (`mpc_set_reference`: target x, y and resting
  throttle, the same for all stages) and a per-stage `floor` parameter
  (`mpc_set_floor`): the largest plane y the centre may reach, from the
  terrain under the previous plan's path. It's a soft constraint.
- **Iterations**: SQP-RTI, one iteration per re-plan (100 Hz, every 2 sim
  steps), warm-started from the last plan. After a reset the first 10
  re-plans warm up from scratch at the same one iteration each, with the
  engines off (0.1 s of freefall), so no single solve is long.
- **Changing the exported API**: add the function to `lander_mpc.c`, then to
  `-sEXPORTED_FUNCTIONS` in `build.sh`, then call it as `mod._name` in
  `autopilot_mpc.js`.

## Gotchas

- acados 0.6 names generated files and symbols after `ocp.name`. It's fixed
  to `"lander"` because `lander_mpc.c` includes `acados_solver_lander.h` and
  calls `lander_acados_*`.
- The link needs `-sEMULATE_FUNCTION_POINTER_CASTS=1`. acados calls some
  function pointers declared without a prototype (e.g.
  `sim_config.dims_calculate_size`) with arguments their targets don't take.
  Native ABIs tolerate that; wasm traps with "null function or function
  signature mismatch".
- acados prints with `printf`; in the browser that goes to the console.

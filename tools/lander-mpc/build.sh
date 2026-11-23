#!/bin/sh
# Generate the lander's acados MPC solver and compile it to WebAssembly.
# Runs inside the toolchain image (tools/lander-mpc/Dockerfile); `make mpc`
# does both. Writes:
#   tools/lander-mpc/build/c_generated_code/   the generated C (not committed)
#   src/js/lander/mpc/lander_mpc.{js,wasm}     the module the page loads
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
gen="$here/build/c_generated_code"
out="$repo/src/js/lander/mpc"

rm -rf "$here/build"
mkdir -p "$gen" "$out"
cd "$here/build"
python3 "$here/ocp.py" "$gen"

# Everything acados generated except its example mains.
sources=$(find "$gen" -name '*.c' ! -name 'main_*.c')

# EMULATE_FUNCTION_POINTER_CASTS: acados declares some function pointers
# without a prototype (e.g. sim_config.dims_calculate_size) and calls them
# with arguments the target doesn't take. Native ABIs shrug that off; wasm
# checks every indirect call's signature and traps.
emcc -O3 \
  -I"$gen" \
  -I"$ACADOS_WASM_DIR/include" \
  -I"$ACADOS_WASM_DIR/include/blasfeo/include" \
  -I"$ACADOS_WASM_DIR/include/hpipm/include" \
  $sources "$here/lander_mpc.c" \
  -L"$ACADOS_WASM_DIR/lib" -lacados -lhpipm -lblasfeo -lm \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLanderMpc \
  -sENVIRONMENT=web,node \
  -sEMULATE_FUNCTION_POINTER_CASTS=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_mpc_init,_mpc_reset,_mpc_set_reference,_mpc_set_floor,_mpc_solve,_mpc_u,_mpc_x,_mpc_horizon,_mpc_stage_dt,_mpc_solve_time \
  -o "$out/lander_mpc.js"

# The container runs as root; hand the outputs back to the caller.
if [ -n "$HOST_UID" ]; then chown -R "$HOST_UID:${HOST_GID:-$HOST_UID}" "$here/build" "$out"; fi
ls -l "$out"

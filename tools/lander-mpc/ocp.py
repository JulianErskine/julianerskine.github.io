"""The lander's MPC as an acados optimal control problem; generates its C solver.

Run inside the toolchain image (see build.sh). Writes the generated code to
the directory given on the command line.

Model: the sim's rigid body on its play plane (x right, y DOWN, px, rad,
angle + clockwise), with the engines' on/off duty cycles as the inputs:

    x'  = vx                      vx' = MAIN_THRUST * T * sin(th)
    y'  = vy                      vy' = GRAVITY - MAIN_THRUST * T * cos(th)
    th' = om                      om' = RCS_ACCEL * tau

    states  (x, y, vx, vy, th, om)
    inputs  T in [0, 1] (main engine duty), tau in [-1, 1] (RCS, + clockwise)

The physics constants are read from src/js/lander/sim.js, so this model and
the game can't drift apart.

Each stage has one parameter, `floor`: the lowest the craft's centre may go
(largest plane y) at that stage. The JS side sets it from the terrain under
the previously predicted path, so the solver steers over hills; it's a soft
constraint, so a bad guess costs a penalty rather than infeasibility.
"""

import re
import sys
from pathlib import Path

import casadi as ca
import numpy as np
from acados_template import AcadosModel, AcadosOcp, AcadosOcpSolver

REPO = Path(__file__).resolve().parents[2]
SIM_JS = REPO / "src" / "js" / "lander" / "sim.js"

# Horizon: N shooting intervals over TF seconds.
N = 40
TF = 4.0


def sim_constants(*names):
    """`export const NAME = <number>;` values from sim.js."""
    source = SIM_JS.read_text()
    values = []
    for name in names:
        match = re.search(rf"^export const {name} = ([0-9.eE+-]+);", source, re.MULTILINE)
        if not match:
            sys.exit(f"ocp.py: {name} not found as a numeric export in {SIM_JS}")
        values.append(float(match.group(1)))
    return values


def build_ocp(code_dir: Path) -> AcadosOcp:
    gravity, main_thrust, rcs_accel = sim_constants("GRAVITY", "MAIN_THRUST", "RCS_ACCEL")

    x, y, vx, vy, th, om = (ca.SX.sym(n) for n in ("x", "y", "vx", "vy", "th", "om"))
    T, tau = ca.SX.sym("T"), ca.SX.sym("tau")
    floor = ca.SX.sym("floor")
    state = ca.vertcat(x, y, vx, vy, th, om)
    inputs = ca.vertcat(T, tau)

    model = AcadosModel()
    model.name = "lander"
    model.x = state
    model.u = inputs
    model.p = floor
    model.f_expl_expr = ca.vertcat(
        vx,
        vy,
        main_thrust * T * ca.sin(th),
        gravity - main_thrust * T * ca.cos(th),
        om,
        rcs_accel * tau,
    )
    # Plane y is down: staying above the floor is y - floor <= 0.
    model.con_h_expr = y - floor
    model.con_h_expr_e = y - floor

    ocp = AcadosOcp()
    ocp.model = model
    # Names the generated solver (acados_solver_lander.h, lander_acados_*),
    # which lander_mpc.c includes and calls.
    ocp.name = "lander"
    ocp.code_gen_options.code_export_directory = str(code_dir)
    ocp.code_gen_options.json_file = str(code_dir / "lander_ocp.json")
    ocp.solver_options.N_horizon = N
    ocp.solver_options.tf = TF
    ocp.parameter_values = np.array([1e4])

    # Tracking cost toward the touchdown point with zero velocity, upright,
    # hovering throttle. yref is set per stage at run time (the target moves
    # with the pad); these are placeholders.
    hover = gravity / main_thrust
    nx, nu = 6, 2
    ocp.cost.cost_type = "LINEAR_LS"
    ocp.cost.cost_type_e = "LINEAR_LS"
    ocp.cost.Vx = np.vstack([np.eye(nx), np.zeros((nu, nx))])
    ocp.cost.Vu = np.vstack([np.zeros((nx, nu)), np.eye(nu)])
    ocp.cost.Vx_e = np.eye(nx)
    #                 x     y     vx    vy    th    om    T      tau
    weights = np.array([0.5, 0.5, 0.4, 0.4, 400.0, 40.0, 300.0, 30.0])
    ocp.cost.W = np.diag(weights)
    ocp.cost.W_e = np.diag(weights[:nx]) * 10
    ocp.cost.yref = np.array([0, 0, 0, 0, 0, 0, hover, 0])
    ocp.cost.yref_e = np.zeros(nx)

    # Inputs: duty cycles.
    ocp.constraints.idxbu = np.array([0, 1])
    ocp.constraints.lbu = np.array([0.0, -1.0])
    ocp.constraints.ubu = np.array([1.0, 1.0])
    # Initial state, replaced every solve.
    ocp.constraints.x0 = np.zeros(nx)
    # Tilt within +-0.8 rad along the way (soft: an upset craft can still be
    # handed over).
    ocp.constraints.idxbx = np.array([4])
    ocp.constraints.lbx = np.array([-0.8])
    ocp.constraints.ubx = np.array([0.8])
    ocp.constraints.idxsbx = np.array([0])
    # Terrain floor, soft.
    ocp.constraints.lh = np.array([-1e6])
    ocp.constraints.uh = np.array([0.0])
    ocp.constraints.idxsh = np.array([0])
    ocp.constraints.lh_e = np.array([-1e6])
    ocp.constraints.uh_e = np.array([0.0])
    ocp.constraints.idxsh_e = np.array([0])
    # Slack penalties (linear + quadratic), for [tilt, floor] and the terminal floor.
    ocp.cost.zl = ocp.cost.zu = np.array([1e3, 1e3])
    ocp.cost.Zl = ocp.cost.Zu = np.array([1e3, 1e2])
    ocp.cost.zl_e = ocp.cost.zu_e = np.array([1e3])
    ocp.cost.Zl_e = ocp.cost.Zu_e = np.array([1e2])

    opts = ocp.solver_options
    opts.nlp_solver_type = "SQP_RTI"
    opts.qp_solver = "PARTIAL_CONDENSING_HPIPM"
    opts.hessian_approx = "GAUSS_NEWTON"
    opts.integrator_type = "ERK"
    opts.sim_method_num_stages = 4
    opts.sim_method_num_steps = 2
    opts.qp_solver_iter_max = 50
    opts.levenberg_marquardt = 1e-3
    return ocp


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: ocp.py <output dir for generated C>")
    code_dir = Path(sys.argv[1]).resolve()
    ocp = build_ocp(code_dir)
    AcadosOcpSolver.generate(ocp)
    print(f"generated acados solver for N={N}, tf={TF}s into {code_dir}")


if __name__ == "__main__":
    main()

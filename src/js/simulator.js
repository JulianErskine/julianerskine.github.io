// Tiny "lander" simulator: gravity pulls the craft down, arrow keys/WASD
// apply thrust, land gently (low speed, upright pad) to win. Vanilla JS,
// canvas 2D, no dependencies — replace/extend with whatever's more fun.
(function () {
  const canvas = document.getElementById("sim-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const statsEl = document.getElementById("sim-stats");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const GRAVITY = 220; // px/s^2
  const THRUST = 420; // px/s^2
  const DRAG = 0.15; // simple horizontal damping
  const FUEL_MAX = 100;
  const FUEL_BURN = 28; // per second of thrust
  const PAD_WIDTH = 90;
  const SAFE_VY = 70; // px/s, max safe vertical landing speed
  const SAFE_VX = 50; // px/s, max safe horizontal landing speed

  const keys = { left: false, right: false, up: false };

  function resetState() {
    return {
      x: WIDTH / 2,
      y: 40,
      vx: (Math.random() - 0.5) * 60,
      vy: 0,
      fuel: FUEL_MAX,
      status: "flying", // flying | landed | crashed
      message: "",
      padX: PAD_WIDTH / 2 + Math.random() * (WIDTH - PAD_WIDTH),
    };
  }

  let state = resetState();
  let last = performance.now();

  function onKey(e, isDown) {
    switch (e.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        keys.left = isDown;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keys.right = isDown;
        break;
      case "ArrowUp":
      case "w":
      case "W":
        keys.up = isDown;
        break;
      case " ":
        if (isDown && state.status !== "flying") state = resetState();
        break;
    }
  }
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  function step(dt) {
    if (state.status !== "flying") return;

    let thrusting = false;
    if (state.fuel > 0) {
      if (keys.up) {
        state.vy -= THRUST * dt;
        thrusting = true;
      }
      if (keys.left) {
        state.vx -= THRUST * 0.6 * dt;
        thrusting = true;
      }
      if (keys.right) {
        state.vx += THRUST * 0.6 * dt;
        thrusting = true;
      }
    }
    if (thrusting) state.fuel = Math.max(0, state.fuel - FUEL_BURN * dt);

    state.vy += GRAVITY * dt;
    state.vx *= 1 - DRAG * dt * 10;

    state.x += state.vx * dt;
    state.y += state.vy * dt;

    // keep craft on screen horizontally
    state.x = Math.max(10, Math.min(WIDTH - 10, state.x));

    const groundY = HEIGHT - 20;
    if (state.y >= groundY) {
      state.y = groundY;
      const onPad = Math.abs(state.x - state.padX) < PAD_WIDTH / 2;
      const softEnough = Math.abs(state.vy) < SAFE_VY && Math.abs(state.vx) < SAFE_VX;
      if (onPad && softEnough) {
        state.status = "landed";
        state.message = "Landed! Press space to fly again.";
      } else {
        state.status = "crashed";
        state.message = onPad
          ? "Too fast — crashed. Press space to retry."
          : "Missed the pad — crashed. Press space to retry.";
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // ground + pad
    const groundY = HEIGHT - 20;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, groundY + 10, WIDTH, HEIGHT - groundY);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(state.padX - PAD_WIDTH / 2, groundY + 6, PAD_WIDTH, 6);

    // craft
    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.fillStyle = state.status === "crashed" ? "#ef4444" : "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(10, 10);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    if (keys.up && state.fuel > 0 && state.status === "flying") {
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(-5, 10);
      ctx.lineTo(5, 10);
      ctx.lineTo(0, 22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (state.message) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(state.message, WIDTH / 2, HEIGHT / 2);
    }

    if (statsEl) {
      statsEl.textContent =
        `altitude ${(groundY - state.y).toFixed(0)}px` +
        ` · vx ${state.vx.toFixed(0)} vy ${state.vy.toFixed(0)}` +
        ` · fuel ${state.fuel.toFixed(0)}%`;
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();

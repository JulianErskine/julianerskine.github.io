// Time-series plots of a lander round: thrust, fuel, velocities, position
// relative to the pad. Plain canvas 2D. Samples are taken only while the
// craft is flying, so when the round ends the plots stop where it ended;
// `clear()` starts them over for the next round.
//
// Sign conventions are chosen so each velocity is the derivative of the
// position plotted with it: x + right, y + up, angle + clockwise. x, y and
// angle keep one colour each across every plot (RCS torque drives the angle,
// so it shares its colour).
import { FEET, SCALE, PAD_WIDTH, SAFE_VX, SAFE_VY, SAFE_TILT, SAFE_SPIN, wrapAngle } from "./sim.js";

const SAMPLE_INTERVAL = 0.05; // s
const THRUST_SMOOTHING = 0.15; // s, time constant for on/off engines -> duty
const MIN_SPAN = 10; // s shown before the round gets that long
const HEIGHT = 150; // css px per plot
const PAD = { left: 40, right: 40, top: 16, bottom: 20 };
const FOOT_DROP = FEET[0][1] * SCALE;
const DEG = 180 / Math.PI;

const COLOR = {
  x: "#2563eb",
  y: "#ea580c",
  angle: "#7c3aed",
  main: "#475569",
  fuel: "#16a34a",
};

// Each plot has one or two y axes; series and guides say which they use.
const PLOTS = [
  {
    title: "Thrust",
    axes: [{ unit: "%", range: [-100, 100] }],
    series: [
      { key: "main", label: "main engine", color: COLOR.main },
      { key: "rcs", label: "RCS torque (+ clockwise)", color: COLOR.angle },
    ],
  },
  {
    title: "Fuel",
    axes: [{ unit: "%", range: [0, 100] }],
    series: [{ key: "fuel", label: "remaining", color: COLOR.fuel }],
  },
  {
    title: "Velocity",
    axes: [{ unit: "px/s" }, { unit: "°/s" }],
    series: [
      { key: "vx", label: "vx (+ right)", color: COLOR.x },
      { key: "vy", label: "vy (+ up)", color: COLOR.y },
      { key: "spin", label: "spin (+ clockwise)", color: COLOR.angle, axis: 1 },
    ],
    // Touchdown limits.
    guides: [
      { value: SAFE_VX, color: COLOR.x },
      { value: -SAFE_VX, color: COLOR.x },
      { value: -SAFE_VY, color: COLOR.y },
      { value: SAFE_SPIN * DEG, color: COLOR.angle, axis: 1 },
      { value: -SAFE_SPIN * DEG, color: COLOR.angle, axis: 1 },
    ],
  },
  {
    title: "Position relative to pad",
    axes: [{ unit: "px" }, { unit: "°" }],
    series: [
      { key: "x", label: "x (+ right of pad)", color: COLOR.x },
      { key: "y", label: "height (+ above pad)", color: COLOR.y },
      { key: "tilt", label: "tilt (+ clockwise)", color: COLOR.angle, axis: 1 },
    ],
    // Touchdown limits: both feet on the pad, and upright.
    guides: [
      { value: PAD_WIDTH / 2 - FOOT_DROP, color: COLOR.x },
      { value: -(PAD_WIDTH / 2 - FOOT_DROP), color: COLOR.x },
      { value: SAFE_TILT * DEG, color: COLOR.angle, axis: 1 },
      { value: -SAFE_TILT * DEG, color: COLOR.angle, axis: 1 },
    ],
  },
];

// A "nice" tick step for a span, 1/2/5 x 10^n giving about `count` ticks.
function niceStep(span, count) {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

const label = (v) => String(Math.round(v * 100) / 100);

export function createPlots(container, sim) {
  const plots = PLOTS.map((spec) => {
    const figure = document.createElement("figure");
    figure.className = "sim-plot";
    const caption = document.createElement("figcaption");
    const title = document.createElement("strong");
    title.textContent = spec.title;
    caption.append(title);
    for (const s of spec.series) {
      const item = document.createElement("span");
      item.className = "sim-plot-key";
      item.style.setProperty("--key", s.color);
      item.textContent = s.label;
      caption.append(item);
    }
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `${spec.title} over time`);
    figure.append(caption, canvas);
    container.append(figure);
    return { spec, canvas, ctx: canvas.getContext("2d") };
  });

  let samples = [];
  let modeChanges = [];
  let time = 0;
  let sinceSample = Infinity;
  let mainDuty = 0;
  let rcsDuty = 0;

  function clear() {
    samples = [];
    modeChanges = [];
    time = 0;
    sinceSample = Infinity;
    mainDuty = rcsDuty = 0;
    draw();
  }

  /** Note a pilot change at the current time, drawn as a marker. */
  function markMode(name) {
    modeChanges.push({ t: time, name });
    draw();
  }

  /**
   * Call after each sim step with that step's dt, while the round was
   * flying at the start of the step (so the final, ending step is kept).
   */
  function record(dt) {
    const s = sim.state;
    time += dt;
    // Engines are on or off each frame; smooth them into a duty cycle.
    const k = 1 - Math.exp(-dt / THRUST_SMOOTHING);
    mainDuty += ((s.main ? 1 : 0) - mainDuty) * k;
    rcsDuty += ((s.rcsRight ? 1 : 0) - (s.rcsLeft ? 1 : 0) - rcsDuty) * k;
    sinceSample += dt;
    if (sinceSample < SAMPLE_INTERVAL && s.status === "flying") return;
    sinceSample = 0;
    const { padX, padY } = sim.world;
    // The sim's plane has y down; plot y up.
    samples.push({
      t: time,
      main: mainDuty * 100,
      rcs: rcsDuty * 100,
      fuel: s.fuel,
      x: s.x - padX,
      y: padY - (s.y + FOOT_DROP),
      tilt: wrapAngle(s.angle) * DEG,
      vx: s.vx,
      vy: -s.vy,
      spin: s.spin * DEG,
    });
    draw();
  }

  // Y ranges for a plot's axes: fixed, or fitted to the data and guides on
  // each. Fitted axes always include 0 and are given the same number of
  // ticks below and above it, so a second axis's ticks land on the grid.
  function axisRanges(spec) {
    const fitted = spec.axes.map((axis, i) => {
      if (axis.range) return null;
      let lo = 0;
      let hi = 0;
      for (const s of spec.series) {
        if ((s.axis || 0) !== i) continue;
        for (const smp of samples) {
          lo = Math.min(lo, smp[s.key]);
          hi = Math.max(hi, smp[s.key]);
        }
      }
      for (const g of spec.guides || []) {
        if ((g.axis || 0) !== i) continue;
        lo = Math.min(lo, g.value);
        hi = Math.max(hi, g.value);
      }
      const margin = (hi - lo) * 0.08 || 10;
      lo -= margin;
      hi += margin;
      const step = niceStep(hi - lo, 4);
      return { step, below: Math.ceil(-lo / step - 1e-9), above: Math.ceil(hi / step - 1e-9) };
    });
    const below = Math.max(0, ...fitted.map((f) => (f ? f.below : 0)));
    const above = Math.max(0, ...fitted.map((f) => (f ? f.above : 0)));
    return spec.axes.map((axis, i) => {
      if (axis.range) {
        const [lo, hi] = axis.range;
        return { lo, hi, step: niceStep(hi - lo, 4) };
      }
      const { step } = fitted[i];
      return { lo: -below * step, hi: above * step, step };
    });
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const span = Math.max(MIN_SPAN, time);
    for (const { spec, canvas, ctx } of plots) {
      const w = canvas.clientWidth || 300;
      const h = HEIGHT;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const left = PAD.left;
      const right = w - (spec.axes.length > 1 ? PAD.right : 8);
      const top = PAD.top;
      const bottom = h - PAD.bottom;
      const X = (t) => left + (t / span) * (right - left);
      const axes = axisRanges(spec).map((r) => ({
        ...r,
        Y: (v) => bottom - ((v - r.lo) / (r.hi - r.lo)) * (bottom - top),
      }));

      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#5c5c66";

      // Left axis owns the grid; the right axis gets tick labels only.
      axes.forEach((a, i) => {
        const x = i === 0 ? left - 5 : right + 5;
        ctx.textAlign = i === 0 ? "right" : "left";
        ctx.textBaseline = "middle";
        for (let v = Math.ceil(a.lo / a.step) * a.step; v <= a.hi + 1e-9; v += a.step) {
          const y = Math.round(a.Y(v)) + 0.5;
          if (i === 0) {
            ctx.strokeStyle = Math.abs(v) < 1e-9 ? "#b8b8c0" : "#ececf0";
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
          }
          ctx.fillText(label(v), x, y);
        }
        ctx.textBaseline = "bottom";
        ctx.fillText(spec.axes[i].unit, x, top - 3);
      });
      const tStep = niceStep(span, 5);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let t = 0; t <= span + 1e-9; t += tStep) {
        const x = Math.round(X(t)) + 0.5;
        ctx.strokeStyle = "#ececf0";
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillText(`${label(t)}s`, x, bottom + 4);
      }

      // Guides (dashed) and pilot changes (dotted, labelled).
      ctx.setLineDash([4, 3]);
      ctx.globalAlpha = 0.5;
      for (const g of spec.guides || []) {
        const y = axes[g.axis || 0].Y(g.value);
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([1, 3]);
      ctx.strokeStyle = "#1b1b1f";
      ctx.fillStyle = "#1b1b1f";
      ctx.textAlign = "left";
      for (const m of modeChanges) {
        const x = Math.round(X(m.t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillText(m.name, x + 3, top + 1);
      }
      ctx.setLineDash([]);

      // Series.
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      for (const s of spec.series) {
        const { Y } = axes[s.axis || 0];
        ctx.strokeStyle = s.color;
        ctx.beginPath();
        samples.forEach((smp, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(smp.t), Y(smp[s.key])));
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#b8b8c0";
      ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
    }
  }

  window.addEventListener("resize", draw);
  draw();
  return { record, clear, markMode };
}

/* simulation.js
   Live simulation, one tick per second: production, kiln upsets, automated capture vents, permit alarms, fence-line sensors. */

/* ═════════════════════════════════════════════════════════════════════════
   3. LIVE SIMULATION (1 tick per second)
   ═════════════════════════════════════════════════════════════════════════ */
const live = {
  wind: { dir: 0.15, speed: 5.5 },   // radians (0 = blowing toward east), m/s
  lines: Object.fromEntries(LINES.map((L) => [L.id, {
    status: "running", prod: L.base, gross: L.base * INTENSITY * L.intensityF, released: L.base * INTENSITY * L.intensityF, captureRate: 0,
    upset: null, vent: { open: false, since: 0, captured: 0, above: 0, below: 0 },
    over: 0, alarm: false, spark: [],
  }])),
  hour: null,
  nextUpset: T0 + 22000,
  firstUpset: true,
};
(function initHour() {
  const start = floorHour(T0), f = (T0 - start) / HOUR;
  live.hour = { t: start };
  for (const L of LINES) live.hour[L.id] = { clinker: L.base * f, gross: L.base * f * INTENSITY * L.intensityF, captured: 0, ventMin: 0, runFrac: 1 };
})();

const actor = { you: "you (operator)" };
const newEvents = [];
function liveEvent(k, text, line) {
  const e = { t: Date.now(), k, text, line, live: true };
  events.push(e); newEvents.push(e);
  ui.onEvent(e);
}

function startUpset(lineId, factor, seconds) {
  const s = live.lines[lineId];
  if (s.status !== "running") return false;
  s.upset = { factor, until: Date.now() + seconds * 1000 };
  liveEvent("upset", `${lineById(lineId).name} kiln running hot. Stack sensor and air scanner detect rising CO2.`, lineId);
  return true;
}

function shutdown(lineId, by) {
  const s = live.lines[lineId];
  if (s.status === "stopped" || s.status === "stopping") return;
  s.status = "stopping";
  liveEvent("shutdown", `${lineById(lineId).name} shutdown started by ${by}. Production ramping down.`, lineId);
}
function restart(lineId, by) {
  const s = live.lines[lineId];
  if (s.status !== "stopped") return;
  s.status = "starting";
  liveEvent("restart", `${lineById(lineId).name} restart started by ${by}.`, lineId);
}

function groundPpm(x, z) {
  // Simple Gaussian plume per stack, carried by the wind
  const wx = Math.cos(live.wind.dir), wz = Math.sin(live.wind.dir);
  let add = 0;
  for (const L of LINES) {
    const q = (live.lines[L.id].released / 95) ** 2;   // squared so upsets stand out from normal running
    if (q <= 0.001) continue;
    const p = STACK_POS[L.id], dx = x - p.x, dz = z - p.z;
    const d = dx * wx + dz * wz;
    if (d <= 0) continue;
    const c = -dx * wz + dz * wx, sig = 6 + 0.2 * d;
    add += q * 130 * Math.exp(-(c * c) / (2 * sig * sig)) * Math.exp(-d / 260) * (d / (d + 30));
  }
  return AMBIENT_PPM + add;
}

function tick(dt) {
  const now = Date.now();
  // wind wanders slowly
  live.wind.dir += (Math.random() - 0.5) * 0.02;
  live.wind.dir = clamp(live.wind.dir, -0.7, 0.9);
  live.wind.speed = clamp(live.wind.speed + (Math.random() - 0.5) * 0.15, 3.5, 8);

  // scheduled upsets keep the demo lively
  if (now >= live.nextUpset) {
    const pick = live.firstUpset ? "L1" : LINES[Math.floor(Math.random() * 2)].id;
    startUpset(pick, live.firstUpset ? 1.55 : 1.2 + Math.random() * 0.35, live.firstUpset ? 75 : 30 + Math.random() * 30);
    live.firstUpset = false;
    live.nextUpset = now + (150 + Math.random() * 110) * 1000;
  }

  // hour rollover → write the finished hour into history
  if (floorHour(now) !== live.hour.t) {
    history.push(live.hour);
    live.hour = { t: floorHour(now) };
    for (const L of LINES) live.hour[L.id] = { clinker: 0, gross: 0, captured: 0, ventMin: 0, runFrac: 1 };
  }

  for (const L of LINES) {
    const s = live.lines[L.id];
    if (s.status === "stopping") { s.prod = Math.max(0, s.prod - L.base / 10 * dt); if (s.prod === 0) { s.status = "stopped"; liveEvent("shutdown", `${L.name} stopped. No clinker production.`, L.id); } }
    else if (s.status === "starting") { s.prod = Math.min(L.base, s.prod + L.base / 15 * dt); if (s.prod >= L.base) { s.status = "running"; liveEvent("restart", `${L.name} back at full production rate.`, L.id); } }
    else if (s.status === "running") s.prod = L.base + (Math.random() - 0.5) * 1.5;
    if (s.upset && (now > s.upset.until || s.status !== "running")) s.upset = null;

    const factor = s.upset ? s.upset.factor : 1;
    s.gross = s.prod * INTENSITY * L.intensityF * factor * (1 + (Math.random() - 0.5) * 0.01);

    // automated carbon-capture vent
    const v = s.vent;
    if (!v.open) {
      v.above = s.gross > VENT_TRIGGER ? v.above + dt : 0;
      if (v.above >= 3) {
        Object.assign(v, { open: true, since: now, captured: 0, below: 0 });
        liveEvent("vent", `${L.vent} opened automatically. ${L.name} CO2 at ${round(s.gross)} t/h (trigger ${VENT_TRIGGER} t/h).`, L.id);
      }
    } else {
      v.below = s.gross < VENT_TRIGGER - 5 ? v.below + dt : 0;
      if (v.below >= 6 || s.status === "stopped") {
        v.open = false; v.above = 0;
        liveEvent("vent", `${L.vent} closed after ${fmtDur(now - v.since)}. Captured ${round(v.captured, 2)} t CO2.`, L.id);
      }
    }
    s.captureRate = v.open ? Math.min(s.gross * CAPTURE_FRAC, CAPTURE_MAX) : 0;
    s.released = s.gross - s.captureRate;
    if (v.open) v.captured += s.captureRate * dt / 3600;

    // permit-limit alarm
    if (s.released > PERMIT_LIMIT) {
      s.over += dt;
      if (s.alarm && s.exceedance) s.exceedance.peak = Math.max(s.exceedance.peak, s.released);
      if (s.over >= 10 && !s.alarm) {
        s.alarm = true;
        s.exceedance = { line: L.id, start: now - 10000, end: null, peak: s.released, cause: s.upset ? "Kiln upset (hot running)" : "Under investigation", action: null, live: true };
        exceedances.push(s.exceedance);
        liveEvent("alarm", `${L.name} released CO2 above permit limit (${round(s.released)} t/h vs ${PERMIT_LIMIT} t/h)${v.open ? ` with ${L.vent} at full capacity` : ""}.`, L.id);
      }
    } else if (s.released < PERMIT_LIMIT - 3) {
      if (s.alarm) {
        liveEvent("info", `${L.name} back within permit limit (${round(s.released)} t/h).`, L.id);
        if (s.exceedance) {
          s.exceedance.end = now;
          s.exceedance.action = ["stopping", "stopped"].includes(s.status) ? "Line shut down by operator" : "Returned within limit as upset cleared";
          s.exceedance = null;
        }
      }
      s.alarm = false; s.over = 0;
    }

    // accumulate into the current hour
    const hr = live.hour[L.id];
    hr.clinker += s.prod * dt / 3600;
    hr.gross += s.gross * dt / 3600;
    hr.captured += s.captureRate * dt / 3600;
    if (v.open) hr.ventMin += dt / 60;

    s.spark.push(s.released);
    if (s.spark.length > 90) s.spark.shift();
  }

  // fence-line sensors
  for (const sn of SENSORS) {
    sn.ppm = groundPpm(sn.x, sn.z) + (Math.random() - 0.5) * 3;
    if (sn.ppm > SENSOR_ALERT && now - sn.lastAlert > 90000) {
      sn.lastAlert = now;
      liveEvent("sensor", `Fence sensor ${sn.id} reads ${Math.round(sn.ppm)} ppm.`);
    }
  }
}

/* plant.js
   The plant: constants, the two kiln lines, sensors, and synthetic history (hourly for 30 days, daily back to 1 January). */

/* ═════════════════════════════════════════════════════════════════════════
   1. PLANT MODEL + CONSTANTS
   Two clinker lines. Each has a kiln, a stack and an automated carbon-capture
   vent. All numbers are synthetic but in realistic ranges for cement.
   ═════════════════════════════════════════════════════════════════════════ */
const HOUR = 3600e3, DAY = 24 * HOUR;
const INTENSITY = 0.84;         // t CO2 per t clinker
const VENT_TRIGGER = 105;       // t/h gross CO2 that opens a vent
const PERMIT_LIMIT = 112;       // t/h released CO2 per line
const CAPTURE_FRAC = 0.4, CAPTURE_MAX = 30; // vent captures 40% up to 30 t/h
const AMBIENT_PPM = 420;
const SENSOR_ALERT = 520;       // fence-line ppm that raises an air alert

const LINES = [
  { id: "L1", name: "Line 1", vent: "CV-1", base: 118, z: -30, intensityF: 1.0 },
  { id: "L2", name: "Line 2", vent: "CV-2", base: 112, z: 24, intensityF: 1.025 },  // older kiln, slightly less efficient
];
const lineById = (id) => LINES.find((l) => l.id === id);
const STACK_POS = { L1: { x: -42, z: -42 }, L2: { x: -42, z: 12 } };
const STACK_H = 62;

const SENSORS = [
  ["N1", -80, -82], ["N2", 0, -82], ["N3", 80, -82],
  ["E1", 118, -30], ["E2", 118, 30],
  ["S1", 80, 82], ["S2", 0, 82], ["S3", -80, 82],
  ["W1", -118, 30], ["W2", -118, -30],
].map(([id, x, z]) => ({ id, x, z, ppm: AMBIENT_PPM, lastAlert: 0 }));

/** The most recent completed night shift, 22:00 to 06:00. */
function lastNightRange(now = Date.now()) {
  const end = new Date(now); end.setHours(6, 0, 0, 0);
  if (new Date(now).getHours() < 6) end.setDate(end.getDate() - 1);
  return [end.getTime() - 8 * HOUR, end.getTime()];
}

/* ═════════════════════════════════════════════════════════════════════════
   2. SEVEN DAYS OF HISTORY (hourly) + EVENT LOG
   Includes a scripted story for last night so the copilot has something to
   find: a Line 2 kiln upset, a long vent run, an alarm and a manual shutdown.
   ═════════════════════════════════════════════════════════════════════════ */
const T0 = Date.now();
const history = [];   // [{t, L1:{clinker,gross,captured,ventMin,runFrac}, L2:{…}}]
const events = [];    // [{t, k, line?, text}]
const addEvent = (t, k, text, line) => { events.push({ t, k, text, line }); };

const archive = [];      // daily records from 1 January up to the hourly history
const exceedances = [];  // permit-limit exceedance register
const INTENSITY_TARGET = 0.85;    // site permit target, t CO2 released per t clinker (synthetic)
const ANNUAL_CAP = 1720000;       // t CO2 released per calendar year (synthetic permit cap)
const CALCINATION = 0.525;        // t CO2 per t clinker from limestone calcination (process emissions)
const PERMIT_ID = "HR-ETS-0417";
const HIST_DAYS = 30;
const dayFactor = (t, lineId) => 1 + 0.022 * Math.sin(Math.floor(t / DAY) * 1.7 + (lineId === "L2" ? 1.3 : 0)); // fuel mix varies

(function buildHistory() {
  const rng = mulberry(20261005);
  const curHour = floorHour(T0);
  const start = floorDay(curHour - HIST_DAYS * DAY);   // midnight, so the daily archive meets it exactly
  const [ns] = lastNightRange(T0);
  const ov = {}; // overrides keyed "L2@<hourStart>"
  const set = (line, t, o) => { ov[`${line}@${t}`] = { ...(ov[`${line}@${t}`] || {}), ...o }; };
  const busy = (line, t) => !!ov[`${line}@${t}`] || (t >= ns - 2 * HOUR && t <= ns + 9 * HOUR);

  // Planned maintenance on Line 2, four days ago 06:00 to 14:00
  const maintStart = floorDay(T0) - 4 * DAY + 6 * HOUR;
  for (let h = 0; h < 8; h++) set("L2", maintStart + h * HOUR, { runFrac: 0 });
  addEvent(maintStart, "maintenance", "Line 2 stopped for planned refractory maintenance.", "L2");
  addEvent(maintStart + 8 * HOUR, "restart", "Line 2 restarted after planned maintenance.", "L2");

  // Last night's story
  const at = (h, m) => ns + h * HOUR + m * 60000;   // h hours after 22:00
  set("L1", ns + 1 * HOUR, { ventMin: 12, factor: 1.08 });
  addEvent(at(1, 40), "vent", "CV-1 opened automatically. Line 1 CO2 at 107 t/h (trigger 105 t/h).", "L1");
  addEvent(at(1, 52), "vent", "CV-1 closed after 12 min. Captured 6 t CO2.", "L1");
  set("L2", ns + 4 * HOUR, { ventMin: 46, factor: 1.45 });
  set("L2", ns + 5 * HOUR, { ventMin: 5, factor: 1.15, runFrac: 0.18 });
  set("L2", ns + 6 * HOUR, { runFrac: 0.92 });
  addEvent(at(4, 11), "upset", "Line 2 kiln feed unstable. Stack CO2 climbing.", "L2");
  addEvent(at(4, 14), "vent", "CV-2 opened automatically. Line 2 CO2 at 121 t/h (trigger 105 t/h).", "L2");
  addEvent(at(4, 33), "alarm", "Line 2 released CO2 above permit limit (116 t/h vs 112 t/h) with CV-2 at full capacity.", "L2");
  addEvent(at(4, 41), "sensor", "Fence sensor E2 reads 548 ppm, downwind of Line 2.", "L2");
  addEvent(at(5, 5), "shutdown", "Line 2 shut down by night shift operator. Reason: kiln feed instability.", "L2");
  addEvent(at(5, 5), "vent", "CV-2 closed after 51 min. Captured 25.5 t CO2.", "L2");
  addEvent(at(5, 7), "info", "Line 2 back within permit limit after shutdown.", "L2");
  addEvent(at(5, 48), "restart", "Line 2 restart started by night shift operator.", "L2");
  addEvent(at(6, 10), "info", "Line 2 back at full production rate.", "L2");
  exceedances.push({ line: "L2", start: at(4, 33), end: at(5, 7), peak: 116.4, cause: "Kiln feed instability", action: "Line shut down by night shift operator" });

  // A few earlier exceedances in the last 30 days, each cleared by reducing kiln feed
  const CAUSES = ["Fuel quality variation", "Raw meal chemistry drift", "Kiln ring formation", "Cooler grate fault"];
  for (const d of [6, 13, 22]) {
    const L = LINES[Math.floor(rng() * 2)];
    const hour = floorDay(T0) - d * DAY + (2 + Math.floor(rng() * 20)) * HOUR;
    if (busy(L.id, hour)) continue;
    const m = 5 + Math.floor(rng() * 20), dur = 14 + Math.floor(rng() * 26), peak = round(113 + rng() * 6);
    set(L.id, hour, { ventMin: 45, factor: 1.42 });
    const cause = CAUSES[Math.floor(rng() * CAUSES.length)];
    addEvent(hour + (m - 4) * 60000, "upset", `${L.name}: ${cause.toLowerCase()}. Stack CO2 climbing.`, L.id);
    addEvent(hour + (m - 2) * 60000, "vent", `${L.vent} opened automatically. ${L.name} CO2 at ${round(peak + 25)} t/h (trigger 105 t/h).`, L.id);
    addEvent(hour + m * 60000, "alarm", `${L.name} released CO2 above permit limit (${peak} t/h vs ${PERMIT_LIMIT} t/h) with ${L.vent} at full capacity.`, L.id);
    addEvent(hour + (m + 6) * 60000, "sensor", `Fence sensor ${["E1", "E2", "S1"][Math.floor(rng() * 3)]} reads ${525 + Math.floor(rng() * 30)} ppm.`, L.id);
    addEvent(hour + (m + dur) * 60000, "info", `${L.name} back within permit limit after kiln feed was reduced.`, L.id);
    exceedances.push({ line: L.id, start: hour + m * 60000, end: hour + (m + dur) * 60000, peak, cause, action: "Kiln feed reduced; returned within limit" });
  }

  // Occasional short vent runs
  for (let d = 1; d <= HIST_DAYS; d++) for (const L of LINES) {
    if (rng() > 0.65) continue;
    const hour = floorDay(T0) - d * DAY + Math.floor(rng() * 24) * HOUR;
    if (busy(L.id, hour)) continue;
    if (hour < start || hour >= curHour) continue;
    const m = Math.floor(rng() * 40), dur = 6 + Math.floor(rng() * 15);
    set(L.id, hour, { ventMin: dur, factor: 1.07 });
    const peak = L.base * INTENSITY * L.intensityF * 1.07 + 1.5;
    const cap = round(Math.min(peak * CAPTURE_FRAC, CAPTURE_MAX) * dur / 60);
    addEvent(hour + m * 60000, "vent", `${L.vent} opened automatically. ${L.name} CO2 at ${round(peak)} t/h (trigger 105 t/h).`, L.id);
    addEvent(hour + (m + dur) * 60000, "vent", `${L.vent} closed after ${dur} min. Captured ${cap} t CO2.`, L.id);
  }

  for (let t = start; t < curHour; t += HOUR) {
    const rec = { t };
    for (const L of LINES) {
      const o = ov[`${L.id}@${t}`] || {};
      const runFrac = o.runFrac ?? 1, factor = o.factor ?? 1, ventMin = o.ventMin ?? 0;
      const clinker = (L.base + gauss(rng) * 2.5) * runFrac;
      const gross = clinker * INTENSITY * L.intensityF * dayFactor(t, L.id) * factor * (1 + gauss(rng) * 0.012);
      const captured = Math.min((gross / Math.max(runFrac, 0.05)) * CAPTURE_FRAC, CAPTURE_MAX) * ventMin / 60;
      rec[L.id] = { clinker, gross, captured, ventMin, runFrac };
    }
    history.push(rec);
  }

  // Daily archive from 1 January, including each line's annual kiln shutdown
  const yearStart = new Date(new Date(T0).getFullYear(), 0, 1).getTime();
  const annual = { L1: [yearStart + 40 * DAY, 12], L2: [yearStart + 68 * DAY, 14] };   // [start, days]
  for (const L of LINES) {
    const [ms, days] = annual[L.id];
    if (ms < start) {
      addEvent(ms + 6 * HOUR, "maintenance", `${L.name} stopped for its annual kiln shutdown (${days} days).`, L.id);
      addEvent(ms + days * DAY + 6 * HOUR, "restart", `${L.name} restarted after its annual kiln shutdown.`, L.id);
    }
  }
  for (let t = yearStart; t + DAY <= start; t += DAY) {
    const rec = { t, end: t + DAY, daily: true };
    for (const L of LINES) {
      const [ms, days] = annual[L.id];
      const runFrac = t >= ms && t < ms + days * DAY ? 0 : 1;
      const clinker = (L.base * 24 + gauss(rng) * 18) * runFrac;
      const ventMin = runFrac ? Math.max(0, Math.round(gauss(rng) * 10 + 6)) : 0;
      const gross = clinker * INTENSITY * L.intensityF * dayFactor(t, L.id) * (1 + gauss(rng) * 0.008) + ventMin * 0.05;
      rec[L.id] = { clinker, gross, captured: Math.min(gross / 24 * CAPTURE_FRAC, CAPTURE_MAX) * ventMin / 60, ventMin, runFrac };
      if (runFrac && rng() < 0.025) {
        const st = t + (1 + Math.floor(rng() * 22)) * HOUR, dur = 12 + Math.floor(rng() * 30), peak = round(113 + rng() * 5);
        const cause = CAUSES[Math.floor(rng() * CAUSES.length)];
        exceedances.push({ line: L.id, start: st, end: st + dur * 60000, peak, cause, action: "Kiln feed reduced; returned within limit" });
        addEvent(st, "alarm", `${L.name} released CO2 above permit limit (${peak} t/h vs ${PERMIT_LIMIT} t/h).`, L.id);
        if (rng() < 0.7) addEvent(st + 5 * 60000, "sensor", `Fence sensor ${["E1", "E2", "S1"][Math.floor(rng() * 3)]} reads ${523 + Math.floor(rng() * 25)} ppm.`, L.id);
        addEvent(st + dur * 60000, "info", `${L.name} back within permit limit.`, L.id);
      }
    }
    archive.push(rec);
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t > T0) events.splice(i, 1);
  events.sort((a, b) => a.t - b.t);
  exceedances.sort((a, b) => a.start - b.start);
})();

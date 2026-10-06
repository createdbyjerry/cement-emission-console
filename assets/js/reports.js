/* reports.js
   Queries over the plant data: production reports, event log, live status and the regulatory compliance summary. */

/* ═════════════════════════════════════════════════════════════════════════
   4. QUERIES (what the copilot's tools return)
   ═════════════════════════════════════════════════════════════════════════ */
const PERIODS = ["last_night", "today", "yesterday", "last_24_hours", "last_7_days", "last_30_days", "year_to_date", "last_hour"];
const yearStartOf = (t) => new Date(new Date(t).getFullYear(), 0, 1).getTime();
function resolvePeriod(input = {}) {
  const now = Date.now();
  if (input.start && input.end) {
    const a = Date.parse(input.start), b = Date.parse(input.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new Error("start and end must be ISO times with start before end");
    return { label: "custom", a: Math.max(a, yearStartOf(now)), b: Math.min(b, now) };
  }
  const p = input.period || "last_24_hours";
  const today = floorDay(now);
  const map = {
    last_night: () => lastNightRange(now), today: () => [today, now], yesterday: () => [today - DAY, today],
    last_24_hours: () => [now - DAY, now], last_7_days: () => [now - 7 * DAY, now], last_30_days: () => [now - 30 * DAY, now],
    year_to_date: () => [yearStartOf(now), now], last_hour: () => [now - HOUR, now],
  };
  if (!map[p]) throw new Error(`period must be one of ${PERIODS.join(", ")}`);
  const [a, b] = map[p]();
  return { label: p, a, b };
}

function records() {
  const cur = { ...live.hour, end: Date.now() };
  return [...archive, ...history.map((r) => ({ ...r, end: r.t + HOUR })), cur];
}

function productionReport(input) {
  const { label, a, b } = resolvePeriod(input);
  const lines = {};
  for (const L of LINES) lines[L.id] = { clinker_t: 0, co2_gross_t: 0, co2_captured_t: 0, vent_minutes: 0, running_hours: 0 };
  const span = b - a;
  const gran = span <= 36 * HOUR ? "hour" : span <= 62 * DAY ? "day" : "month";
  const keyOf = (t) => gran === "hour" ? floorHour(t) : gran === "day" ? floorDay(t) : new Date(new Date(t).getFullYear(), new Date(t).getMonth(), 1).getTime();
  const buckets = new Map();
  for (const r of records()) {
    if (r.end <= a || r.t >= b) continue;
    const ov = Math.min(b, r.end) - Math.max(a, r.t);
    const f = ov / (r.end - r.t);
    const key = keyOf(Math.max(a, r.t));
    if (!buckets.has(key)) buckets.set(key, { t: key, L1: { clinker: 0, gross: 0, captured: 0, ventMin: 0 }, L2: { clinker: 0, gross: 0, captured: 0, ventMin: 0 } });
    const bk = buckets.get(key);
    for (const L of LINES) {
      const x = r[L.id], o = lines[L.id], bl = bk[L.id];
      o.clinker_t += x.clinker * f; o.co2_gross_t += x.gross * f; o.co2_captured_t += x.captured * f;
      o.vent_minutes += x.ventMin * f; o.running_hours += (x.runFrac ?? 1) * f * (r.end - r.t) / HOUR;
      bl.clinker += x.clinker * f; bl.gross += x.gross * f; bl.captured += x.captured * f; bl.ventMin += x.ventMin * f;
    }
  }
  const site = { clinker_t: 0, co2_gross_t: 0, co2_captured_t: 0 };
  for (const L of LINES) {
    const o = lines[L.id];
    o.co2_released_t = o.co2_gross_t - o.co2_captured_t;
    o.intensity_t_co2_per_t = o.clinker_t > 0 ? round(o.co2_released_t / o.clinker_t, 3) : null;
    site.clinker_t += o.clinker_t; site.co2_gross_t += o.co2_gross_t; site.co2_captured_t += o.co2_captured_t;
    for (const k of ["clinker_t", "co2_gross_t", "co2_captured_t", "co2_released_t", "vent_minutes", "running_hours"]) o[k] = round(o[k]);
  }
  site.co2_released_t = round(site.co2_gross_t - site.co2_captured_t);
  site.intensity_t_co2_per_t = site.clinker_t > 0 ? round(site.co2_released_t / site.clinker_t, 3) : null;
  for (const k of ["clinker_t", "co2_gross_t", "co2_captured_t"]) site[k] = round(site[k]);
  const fmtBucket = (t) => gran === "hour" ? fmtTime(t) : gran === "day" ? fmtDay(t) : new Date(t).toLocaleDateString([], { month: "short" });
  const series = [...buckets.values()].sort((x, y) => x.t - y.t).map((bk) => {
    const rel = (L) => bk[L].gross - bk[L].captured, clk = bk.L1.clinker + bk.L2.clinker;
    return {
      label: fmtBucket(bk.t), start: bk.t,
      L1_released_t: round(rel("L1")), L2_released_t: round(rel("L2")), clinker_t: round(clk),
      intensity: clk > 0 ? round((rel("L1") + rel("L2")) / clk, 3) : null,
      L1_intensity: bk.L1.clinker > 0 ? round(rel("L1") / bk.L1.clinker, 3) : null,
      L2_intensity: bk.L2.clinker > 0 ? round(rel("L2") / bk.L2.clinker, 3) : null,
      detail: bk,
    };
  });
  return { period: label, from: fmtStamp(a), to: fmtStamp(b), a, b, site, lines, series_granularity: gran, series };
}

/** Everything a regulator asks for, for one reporting period. Shared by the dashboard, exports and copilot. */
function complianceSummary(input) {
  const r = productionReport(input);
  const ytd = productionReport({ period: "year_to_date" });
  const now = Date.now(), y0 = yearStartOf(now), y1 = new Date(new Date(now).getFullYear() + 1, 0, 1).getTime();
  const elapsed = (now - y0) / (y1 - y0);
  const ex = exceedances.filter((e) => e.start < r.b && (e.end ?? now) > r.a).map((e) => ({
    line: e.line, start: fmtStamp(e.start), end: e.end ? fmtStamp(e.end) : "ongoing",
    duration_min: Math.max(1, Math.round(((e.end ?? now) - e.start) / 60000)), peak_released_t_per_h: round(e.peak),
    limit_t_per_h: PERMIT_LIMIT, cause: e.cause, action: e.action || "In progress", _start: e.start, _end: e.end,
  }));
  const calcination = round(r.site.clinker_t * CALCINATION);
  const days = Math.max(1, Math.round((r.b - r.a) / DAY));
  // Monitoring data availability: synthetic, slightly lower on the older line
  const avail = (id) => round(99.2 + 0.6 * ((Math.sin(r.a / DAY + (id === "L2" ? 2 : 0)) + 1) / 2), 1);
  return {
    site: "Halden Ridge Cement Works", permit: PERMIT_ID,
    period: r.period, from: r.from, to: r.to, a: r.a, b: r.b,
    totals: {
      clinker_t: r.site.clinker_t, co2_gross_t: round(r.site.co2_gross_t), co2_captured_t: r.site.co2_captured_t,
      co2_released_t: r.site.co2_released_t,
      capture_pct_of_gross: r.site.co2_gross_t > 0 ? round(r.site.co2_captured_t / r.site.co2_gross_t * 100, 2) : 0,
      intensity_t_co2_per_t: r.site.intensity_t_co2_per_t, intensity_target: INTENSITY_TARGET,
      intensity_status: r.site.intensity_t_co2_per_t > INTENSITY_TARGET ? "above target" : "within target",
    },
    by_source_gross: { calcination_t: calcination, fuel_combustion_t: round(r.site.co2_gross_t - calcination) },
    by_line: LINES.map((L) => ({ line: L.id, name: L.name, ...r.lines[L.id],
      intensity_status: r.lines[L.id].intensity_t_co2_per_t > INTENSITY_TARGET ? "above target" : "within target",
      data_availability_pct: avail(L.id) })),
    exceedances: { count: ex.length, total_minutes: ex.reduce((a, e) => a + e.duration_min, 0), register: ex },
    air: { fence_line_alerts: events.filter((e) => e.k === "sensor" && e.t >= r.a && e.t <= r.b).length, alert_threshold_ppm: SENSOR_ALERT },
    annual_cap: { cap_t: ANNUAL_CAP, ytd_released_t: ytd.site.co2_released_t, used_pct: round(ytd.site.co2_released_t / ANNUAL_CAP * 100),
      year_elapsed_pct: round(elapsed * 100), projected_year_end_t: Math.round(ytd.site.co2_released_t / elapsed),
      status: ytd.site.co2_released_t / elapsed > ANNUAL_CAP ? "projected to exceed cap" : "on track" },
    days, series_granularity: r.series_granularity, series: r.series,
  };
}

function eventLog(input) {
  const { label, a, b } = resolvePeriod(input);
  const kinds = Array.isArray(input?.kinds) && input.kinds.length ? input.kinds.map(String) : null;
  const list = events.filter((e) => e.t >= a && e.t <= b && (!kinds || kinds.includes(e.k)) && (!input?.line || e.line === input.line));
  return { period: label, from: fmtStamp(a), to: fmtStamp(b), total: list.length,
    events: list.slice(-40).map((e) => ({ time: fmtStamp(e.t), kind: e.k, line: e.line || null, text: e.text })) };
}

function liveStatus() {
  const hottest = SENSORS.reduce((m, s) => (s.ppm > m.ppm ? s : m));
  return {
    time: fmtStamp(Date.now()),
    wind: { toward_degrees_from_east: Math.round(live.wind.dir * 180 / Math.PI), speed_m_s: round(live.wind.speed) },
    permit_limit_t_per_h: PERMIT_LIMIT, vent_trigger_t_per_h: VENT_TRIGGER,
    lines: LINES.map((L) => {
      const s = live.lines[L.id];
      return { line: L.id, name: L.name, status: s.status, clinker_t_per_h: round(s.prod), co2_gross_t_per_h: round(s.gross),
        co2_released_t_per_h: round(s.released), vent: s.vent.open ? { id: L.vent, open: true, open_for: fmtDur(Date.now() - s.vent.since), capturing_t_per_h: round(s.captureRate) } : { id: L.vent, open: false },
        over_permit_limit: s.released > PERMIT_LIMIT, alarm_active: s.alarm, upset_in_progress: !!s.upset };
    }),
    air: { highest_sensor: hottest.id, highest_ppm: Math.round(hottest.ppm), ambient_ppm: AMBIENT_PPM },
  };
}

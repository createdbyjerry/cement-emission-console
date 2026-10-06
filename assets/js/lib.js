/* lib.js
   Small helpers shared by the prototype and the design system page:
   numbers and dates, DOM builders, the SVG chart, and design-token access. */

/* ── numbers and dates ── */
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const floorHour = (t) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
const floorDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtTime = (t, sec) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: sec ? "2-digit" : undefined, hour12: false });
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const fmtStamp = (t) => (floorDay(t) === floorDay(Date.now()) ? "Today " : fmtDay(t) + " ") + fmtTime(t);
const fmtDur = (ms) => { if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} s`; const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

const pad2 = (n) => String(n).padStart(2, "0");
const fmtAbs = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtDate = (t) => fmtAbs(t).slice(0, 10);
const num = (v, d = 0) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const f3 = (v) => v == null ? "-" : Number(v).toFixed(3);

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}


/* ── charts ── */
function buildChart(spec) {
  const kind = spec.kind === "bar" ? "bar" : "line";
  const labels = (Array.isArray(spec.labels) ? spec.labels : []).map(String).slice(0, 60);
  const series = (Array.isArray(spec.series) ? spec.series : []).slice(0, 4).map((x) => ({ name: String(x.name || ""), values: (x.values || []).map((v) => v == null ? null : Number(v)) }));
  if (!labels.length || !series.length || series.some((x) => x.values.length !== labels.length || x.values.some((v) => v !== null && !Number.isFinite(v))))
    throw new Error("labels must be non-empty and every series needs one finite number (or null for a gap) per label");

  const W = 320, H = 150, L = 34, B = 18, T = 6;
  const vals = series.flatMap((x) => x.values).filter((v) => v !== null);
  const refV = spec.reference_line && Number.isFinite(Number(spec.reference_line.value)) ? Number(spec.reference_line.value) : null;
  if (refV !== null) vals.push(refV);
  let min, max;
  if (kind === "line" && vals.length && Math.min(...vals) > 0) {
    // line charts fit the axis to the data so small changes are visible
    const lo = Math.min(...vals), hi = Math.max(...vals), padV = (hi - lo || hi * 0.05) * 0.25;
    min = lo - padV; max = hi + padV;
  } else {
    max = Math.max(...vals, 0) * 1.1 || 1;
    min = Math.min(0, ...vals);
  }
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const n = labels.length, step = (W - L) / n;
  const colors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": String(spec.title || "Chart") });
  for (let i = 0; i <= 3; i++) {
    const v = min + (max - min) * i / 3;
    svg.append(s("line", { class: "grid", x1: L, x2: W, y1: y(v), y2: y(v) }), s("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end" }, String(max - min < 1 ? round(v, 3) : round(v, v < 10 ? 1 : 0))));
  }
  const every = Math.ceil(n / 7);
  labels.forEach((lb, i) => { if (i % every === 0) svg.append(s("text", { x: L + step * (i + 0.5), y: H - 4, "text-anchor": "middle" }, lb.length > 9 ? lb.slice(0, 9) : lb)); });
  series.forEach((ser, si) => {
    if (kind === "bar") {
      const bw = (step * 0.75) / series.length;
      ser.values.forEach((v, i) => v !== null && svg.append(s("rect", { x: L + step * i + step * 0.125 + bw * si, y: Math.min(y(v), y(0)), width: Math.max(bw - 1, 1), height: Math.abs(y(0) - y(v)), fill: colors[si], rx: 1 })));
    } else {
      // break the line wherever a value is missing (for example a line that was shut down)
      let run = [];
      const flush = () => { if (run.length) svg.append(s("polyline", { fill: "none", stroke: colors[si], "stroke-width": 2, points: run.join(" ") })); run = []; };
      ser.values.forEach((v, i) => { if (v === null) flush(); else run.push(`${L + step * (i + 0.5)},${y(v)}`); });
      flush();
    }
  });
  if (spec.reference_line && Number.isFinite(Number(spec.reference_line.value))) {
    const rv = Number(spec.reference_line.value);
    svg.append(s("line", { x1: L, x2: W, y1: y(rv), y2: y(rv), stroke: "var(--color-status-alarm)", "stroke-dasharray": "4 3" }),
      s("text", { x: W, y: y(rv) - 3, "text-anchor": "end", fill: "var(--color-status-alarm)" }, String(spec.reference_line.label || rv)));
  }
  const unit = spec.unit ? ` (${spec.unit})` : "";
  return (h("figure", { class: "chart frame" }, h("h4", {}, String(spec.title || "Chart") + unit), svg,
    h("div", { class: "legend" }, series.map((x, i) => h("span", {}, h("i", { style: `background:${colors[i]}` }), x.name)))));
}


/* ── design tokens ──
   Values come from assets/css/tokens.css, which is generated from tokens/tokens.json.
   JavaScript reads them at runtime so the 3D scene and PDF follow the same tokens as the CSS. */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const tokenNumber = (name, fallback) => { const n = parseFloat(token(name)); return Number.isFinite(n) ? n : fallback; };
const tokenSeconds = (name, fallback) => { const v = token(name), n = parseFloat(v); return Number.isFinite(n) ? (v.endsWith("ms") ? n / 1000 : n) : fallback; };
/** A colour token as [r, g, b] (0-255). The browser resolves aliases, hex and rgba for us. */
function tokenRgb(name, fallback = [128, 128, 128]) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  document.body.append(probe);
  const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  probe.remove();
  return parts.length === 3 && token(name) ? parts : fallback;
}

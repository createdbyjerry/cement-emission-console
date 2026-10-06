/* copilot.js
   The copilot. Live mode uses Claude when the page runs as a Claude artifact; everywhere else it uses scripted demo answers. */

/* ═════════════════════════════════════════════════════════════════════════
   6. COPILOT
   Live mode: real Claude with page tools. Claude can read records, draw
   charts and recommend a shutdown. Only the operator can shut anything down.
   ═════════════════════════════════════════════════════════════════════════ */
const copilot = { sample: null, live: false, turns: [], ctl: null, running: false };

const periodSchema = { type: "string", enum: PERIODS, description: "Named time window. last_night = most recent 22:00 to 06:00 shift." };
/** Strip page-only fields so tool results stay small. */
function forTool(r) {
  const { a, b, ...rest } = r;
  if (rest.series) rest.series = rest.series.map(({ detail, start, ...x }) => x);
  if (rest.exceedances) rest.exceedances = { ...rest.exceedances, register: rest.exceedances.register.slice(-25).map(({ _start, _end, ...x }) => x) };
  return rest;
}
const TOOLS = [
  { name: "get_live_status", description: "Current status of both lines: production, CO2 from kiln and released, vents, alarms, wind, highest fence-line air reading.",
    execute: () => { chatTool("Checked live plant status"); return liveStatus(); } },
  { name: "get_production_report", description: "Totals and a time series for a period: clinker tonnes, CO2 gross, captured and released, intensity (t CO2 per t clinker), vent minutes, running hours, per line and site-wide.",
    inputSchema: { type: "object", properties: { period: periodSchema, start: { type: "string", description: "Optional ISO start, overrides period" }, end: { type: "string" } } },
    execute: (i) => { const r = productionReport(i); chatTool(`Pulled production report: ${r.from} to ${r.to}`); return forTool(r); } },
  { name: "get_compliance_summary", description: "Regulatory summary for a period: released CO2, intensity vs the permit target, CO2 by source (calcination vs fuel), capture, permit-limit exceedance register, fence-line alerts, monitoring data availability, and year-to-date use of the annual cap.",
    inputSchema: { type: "object", properties: { period: { type: "string", enum: ["last_7_days", "last_30_days", "year_to_date"] } }, required: ["period"] },
    execute: (i) => { const r = complianceSummary(i); chatTool(`Pulled compliance summary: ${r.from} to ${r.to}`); return forTool(r); } },
  { name: "get_event_log", description: "Logged events for a period: vent openings and closings, alarms, kiln upsets, air sensor alerts, shutdowns, restarts, maintenance.",
    inputSchema: { type: "object", properties: { period: periodSchema, kinds: { type: "array", items: { type: "string", enum: ["vent", "alarm", "upset", "sensor", "shutdown", "restart", "maintenance", "info"] } }, line: { type: "string", enum: ["L1", "L2"] } } },
    execute: (i) => { const r = eventLog(i); chatTool(`Read event log: ${r.total} events, ${r.from} to ${r.to}`); return r; } },
  { name: "show_chart", description: "Draw a chart in the chat for the operator. Use for trends and comparisons. Values must come from tool results.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, kind: { type: "string", enum: ["line", "bar"] }, unit: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
      reference_line: { type: "object", properties: { value: { type: "number" }, label: { type: "string" } } } },
      required: ["title", "kind", "labels", "series"] },
    execute: (i) => { renderChart(i); return "Chart shown to the operator."; } },
  { name: "propose_shutdown", description: "Recommend that the operator shut down a line. Shows them a card with Shut down and Keep running buttons. You cannot shut anything down yourself.",
    inputSchema: { type: "object", properties: { line: { type: "string", enum: ["L1", "L2"] }, reason: { type: "string", description: "One or two sentences citing the live numbers" } }, required: ["line", "reason"] },
    execute: (i) => {
      const L = lineById(String(i.line));
      if (!L) throw new Error("line must be L1 or L2");
      if (["stopped", "stopping"].includes(live.lines[L.id].status)) throw new Error(`${L.name} is already ${live.lines[L.id].status}`);
      renderProposal(L.id, String(i.reason || ""));
      return "Recommendation shown. The operator will decide.";
    } },
];

function instructions() {
  return `You are the copilot in the emissions console of Halden Ridge Cement Works, a cement plant with two clinker lines (Line 1 = L1, Line 2 = L2). Each line has a kiln, a stack and an automated carbon-capture vent (CV-1, CV-2). A vent opens by itself when a line's kiln CO2 exceeds ${VENT_TRIGGER} t/h and captures up to 40% (max ${CAPTURE_MAX} t/h). The permit limit for released CO2 is ${PERMIT_LIMIT} t/h per line. Fence-line sensors read CO2 in the air; ambient is about ${AMBIENT_PPM} ppm and readings above ${SENSOR_ALERT} ppm raise an air alert.

Regulatory context (permit ${PERMIT_ID}): released-CO2 intensity target ${INTENSITY_TARGET} t CO2 per t clinker; annual cap ${ANNUAL_CAP.toLocaleString()} t CO2 released per calendar year; every period above the hourly limit is logged in an exceedance register. The console has an Overview dashboard with PDF and CSV report exports.

The current local time is ${fmtStamp(Date.now())}. "Last night" means the most recent 22:00 to 06:00 shift.

Rules:
- Use the tools for every number. Never estimate or invent figures. For regulatory or compliance questions use get_compliance_summary.
- Answer in plain language for a plant operator, 2 to 5 short sentences. Use times as written in the tool results.
- When a trend or comparison would help, call show_chart with values taken from a tool result.
- You cannot shut down equipment. If live data shows a line above the permit limit with its vent at capacity, or the operator asks whether to shut down and the data supports it, call propose_shutdown. The operator decides.
- If asked about something the tools don't cover, say so briefly.`;
}

async function askLive(q) {
  copilot.turns.push({ role: "user", content: q });
  const input = [{ role: "user", content: instructions() }, ...copilot.turns.slice(-10)];
  const ctl = new AbortController();
  copilot.ctl = ctl;
  refreshComposer();
  const thinking = chatSys("Claude is thinking…");
  let bubble = null, sealed = 0, seen = 0;
  const seal = () => { if (bubble) { sealed = seen; bubble = null; } };
  const tools = TOOLS.map((t) => ({ ...t, execute: (i) => { seal(); thinking.remove(); return t.execute(i || {}); } }));
  try {
    const { text } = await copilot.sample(input, { tools, modelTier: "quick", signal: ctl.signal,
      onText: ({ text }) => { thinking.remove(); seen = text.length; const part = text.slice(sealed).trim(); if (!part) return; if (!bubble) bubble = chatAgent(""); bubble.textContent = part; } });
    copilot.turns.push({ role: "assistant", content: text.slice(sealed).trim() || text });
  } catch (e) {
    thinking.remove();
    copilot.turns.pop();
    if (e?.code === "cancelled") chatSys("Stopped.");
    else if (["not_granted", "sampling_disabled", "tools_unavailable", "capability_disabled", "not_declared"].includes(e?.code)) {
      setDemoMode("Claude isn't available here, so the copilot switched to scripted demo answers.");
      return askDemo(q);
    } else if (e?.code === "rate_limited") chatErr("Claude is rate-limited right now. Try again in a minute.");
    else chatErr(`Claude couldn't answer (${e?.code || "error"}). Try again.`);
  }
}

/* ── Demo copilot: scripted answers built from the same tools ── */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function askDemo(q) {
  const t = q.toLowerCase();
  const call = (name, input) => TOOLS.find((x) => x.name === name).execute(input || {});
  await pause(400);
  if (/complian|regulat|exceed|annual|cap\b|permit/.test(t)) {
    const period = /year|annual|ytd|cap\b/.test(t) ? "year_to_date" : /week|7/.test(t) ? "last_7_days" : "last_30_days";
    const c = call("get_compliance_summary", { period });
    await pause(300);
    call("show_chart", { title: "Released CO2 intensity vs target", kind: "line", unit: "t CO2 per t clinker", labels: c.series.map((p) => p.label),
      series: [{ name: "Line 1", values: c.series.map((p) => p.L1_intensity) }, { name: "Line 2", values: c.series.map((p) => p.L2_intensity) }],
      reference_line: { value: INTENSITY_TARGET, label: "Target" } });
    const above = c.by_line.filter((l) => l.intensity_status === "above target").map((l) => l.name);
    chatAgent(`For ${c.from} to ${c.to}: ${c.totals.co2_released_t.toLocaleString()} t CO2 released at ${f3(c.totals.intensity_t_co2_per_t)} t per tonne of clinker (target ${f3(INTENSITY_TARGET)}), ${above.length ? `with ${above.join(" and ")} above target` : "within target on both lines"}. There ${c.exceedances.count === 1 ? "was 1 permit-limit exceedance" : `were ${c.exceedances.count} permit-limit exceedances`} totalling ${c.exceedances.total_minutes} min. Year to date the plant has used ${c.annual_cap.used_pct}% of its annual cap with ${c.annual_cap.year_elapsed_pct}% of the year gone, so it's ${c.annual_cap.status}. The Overview tab has the full register and PDF/CSV exports.`);
  } else if (/night|overnight|shift/.test(t)) {
    const r = call("get_production_report", { period: "last_night" });
    await pause(300);
    const ev = call("get_event_log", { period: "last_night", kinds: ["vent", "alarm", "shutdown", "upset"] });
    await pause(300);
    call("show_chart", { title: "Released CO2 by hour, last night", kind: "bar", unit: "t", labels: r.series.map((p) => p.label),
      series: [{ name: "Line 1", values: r.series.map((p) => p.L1_released_t) }, { name: "Line 2", values: r.series.map((p) => p.L2_released_t) }] });
    const alarms = ev.events.filter((e) => e.kind === "alarm").length, shuts = ev.events.filter((e) => e.kind === "shutdown");
    chatAgent(`Last night (${r.from} to ${r.to}) the plant made ${r.site.clinker_t.toLocaleString()} t of clinker and released ${r.site.co2_released_t.toLocaleString()} t of CO2, with ${r.site.co2_captured_t} t captured by the vents. Line 2 ran ${r.lines.L2.running_hours} of 8 hours: ${alarms ? `it had ${alarms} permit-limit alarm and ` : ""}${shuts.length ? `was shut down at ${shuts[0].time.split(" ").pop()}` : "ran normally"}. Vents ran ${r.lines.L1.vent_minutes} min on Line 1 and ${r.lines.L2.vent_minutes} min on Line 2.`);
  } else if (/vent|capture/.test(t)) {
    const ev = call("get_event_log", { period: "last_24_hours", kinds: ["vent"] });
    const opens = ev.events.filter((e) => /opened/.test(e.text));
    chatAgent(opens.length ? `Vents opened ${opens.length} time${opens.length > 1 ? "s" : ""} in the last 24 hours:\n` + ev.events.map((e) => `${e.time}: ${e.text}`).join("\n") : "No vent activity in the last 24 hours.");
  } else if (/week|trend|compare|intensity|analytic|report/.test(t)) {
    const r = call("get_production_report", { period: "last_7_days" });
    await pause(300);
    call("show_chart", { title: "CO2 intensity by day", kind: "line", unit: "t CO2 per t clinker", labels: r.series.map((p) => p.label), series: [{ name: "Site", values: r.series.map((p) => p.intensity) }] });
    const worst = r.series.filter((p) => p.intensity).reduce((m, p) => (p.intensity > m.intensity ? p : m));
    chatAgent(`Over the last 7 days the plant made ${r.site.clinker_t.toLocaleString()} t of clinker and released ${r.site.co2_released_t.toLocaleString()} t of CO2, an intensity of ${r.site.intensity_t_co2_per_t} t CO2 per tonne. The highest day was ${worst.label} at ${worst.intensity}. Line 1 averaged ${r.lines.L1.intensity_t_co2_per_t} and Line 2 ${r.lines.L2.intensity_t_co2_per_t}.`);
  } else if (/shut|now|right now|should|status|live/.test(t)) {
    const st = call("get_live_status");
    const bad = st.lines.find((l) => l.over_permit_limit && l.vent.open);
    if (bad) {
      call("propose_shutdown", { line: bad.line, reason: `${bad.name} is releasing ${bad.co2_released_t_per_h} t/h, above the ${PERMIT_LIMIT} t/h permit limit, and ${bad.vent.id} is already capturing at full capacity.` });
      chatAgent(`${bad.name} is over the permit limit right now even with its vent working at capacity. I've put a shutdown recommendation above; the decision is yours.`);
    } else {
      chatAgent(st.lines.map((l) => `${l.name} is ${l.status}, releasing ${l.co2_released_t_per_h} t/h${l.vent.open ? ` with ${l.vent.id} capturing ${l.vent.capturing_t_per_h} t/h` : ""}.`).join(" ") + ` Highest air reading is ${st.air.highest_ppm} ppm at ${st.air.highest_sensor}. Nothing needs a shutdown.`);
    }
  } else {
    chatAgent("In demo mode I can answer questions about last night, vent activity, weekly trends and intensity, and whether anything needs shutting down right now. Try one of the suggestions.");
  }
}

async function ask(q) {
  if (copilot.running || !q.trim()) return;
  $("suggest")?.remove();
  chatUser(q);
  copilot.running = true; refreshComposer();
  try { await (copilot.live ? askLive(q) : askDemo(q)); }
  finally { copilot.running = false; copilot.ctl = null; refreshComposer(); }
}
function refreshComposer() {
  const stop = copilot.running && copilot.ctl;
  $("send").textContent = stop ? "Stop" : "Ask";
  $("send").classList.toggle("stop", !!stop);
  $("send").disabled = copilot.running && !stop;
  $("ask").disabled = copilot.running;
}
$("send").onclick = () => { if (copilot.ctl) { copilot.ctl.abort(); return; } const q = $("ask").value; $("ask").value = ""; ask(q); };
$("ask").addEventListener("keydown", (e) => { if (e.key === "Enter") $("send").click(); });

const SUGGESTIONS = ["How did last night's production go?", "Summarize our permit compliance for the last 30 days", "When did the vents activate in the last 24 hours?", "Show me CO2 intensity over the last week", "Should I shut anything down right now?"];
$("suggest").append(...SUGGESTIONS.map((q) => h("button", { onclick: () => ask(q) }, q)));

function setDemoMode(msg) {
  copilot.live = false;
  $("mode").dataset.mode = "demo";
  $("mode").textContent = "Demo mode: scripted copilot";
  if (msg) chatSys(msg);
}

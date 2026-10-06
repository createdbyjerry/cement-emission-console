/* ui.js
   Emissions console UI: floating stats, line cards, event log, tabs, chat rendering and recommendation cards. */

/* ═════════════════════════════════════════════════════════════════════════
   5. UI
   ═════════════════════════════════════════════════════════════════════════ */
const ui = {
  selected: null,
  confirming: null,       // line id awaiting shutdown confirmation
  tab: "chat",
  unseen: 0,

  renderSite() {
    const r = productionReport({ period: "today" });
    const deg = Math.round(live.wind.dir * 180 / Math.PI);
    const toward = deg > 20 ? "south-east" : deg < -20 ? "north-east" : "east";
    const stat = (value, unit, label) => h("div", {}, h("b", {}, value, h("small", {}, unit)), h("span", {}, label));
    $("stats").replaceChildren(
      h("div", { class: "caption" }, "Today so far", h("span", {}, "since 00:00")),
      h("div", { class: "grid" },
        stat(r.site.clinker_t.toLocaleString(), "t", "Clinker produced"),
        stat(r.site.co2_released_t.toLocaleString(), "t", "CO2 released"),
        stat(r.site.co2_captured_t.toLocaleString(), "t", "CO2 captured by vents"),
        stat(String(round(live.wind.speed)), "m/s", `Wind toward ${toward}`)));
  },

  cards: {},
  renderLines() {
    for (const L of LINES) {
      const st = live.lines[L.id];
      const sig = [st.status, ui.confirming === L.id, st.alarm, st.vent.open, ui.selected === L.id].join("|");
      let ref = ui.cards[L.id];
      if (!ref || ref.sig !== sig) {
        const fresh = ui.buildCard(L);
        fresh.sig = sig;
        if (ref) ref.el.replaceWith(fresh.el); else $("lines").append(fresh.el);
        fresh.el.classList.toggle("hover", ui.hoverLine === L.id);
        ui.cards[L.id] = ref = fresh;
      }
      // values that change every second are updated in place
      const over = st.released > PERMIT_LIMIT;
      ref.prod.textContent = `${round(st.prod)} t/h`;
      ref.rel.textContent = `${round(st.released)} t/h`;
      ref.rel.className = over ? "over" : "";
      ref.gross.textContent = `${round(st.gross)} t/h`;
      ref.vent.textContent = st.vent.open ? `${L.vent} capturing ${round(st.captureRate)} t/h` : `${L.vent} idle`;
      ref.poly.setAttribute("points", st.spark.map((v, i) => `${(i / 89) * 200},${26 - (v / 150) * 26}`).join(" "));
    }
  },

  buildCard(L) {
    const st = live.lines[L.id], v = st.vent;
    const status = { running: "Running", stopping: "Shutting down", stopped: "Stopped", starting: "Starting" }[st.status];
    const W = 200, H = 26, max = 150, ly = H - (PERMIT_LIMIT / max) * H;
    const poly = s("polyline", { class: "val", points: "" });
    const spark = s("svg", { class: "spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" },
      s("line", { class: "lim", x1: 0, x2: W, y1: ly, y2: ly }), poly);
    const rerender = () => ui.renderLines();

    let actions;
    if (ui.confirming === L.id) {
      actions = h("div", { class: "actions" },
        h("span", { class: "confirm" }, `Stop clinker production on ${L.name}? About ${L.base} t/h of output will stop.`),
        h("button", { class: "btn danger", onclick: () => { ui.confirming = null; shutdown(L.id, actor.you); rerender(); } }, `Shut down ${L.name}`),
        h("button", { class: "btn", onclick: () => { ui.confirming = null; rerender(); } }, "Cancel"));
    } else if (st.status === "running" || st.status === "starting") {
      actions = h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { ui.confirming = L.id; rerender(); } }, "Shut down…"));
    } else if (st.status === "stopped") {
      actions = h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => restart(L.id, actor.you) }, `Restart ${L.name}`));
    } else actions = h("div", { class: "actions" }, h("span", { class: "confirm" }, "Ramping down…"));

    const prod = h("b"), rel = h("b"), gross = h("b");
    const vent = h("span", { class: "pill vent" + (v.open ? "" : " idle") });
    const el = h("article", { class: "lcard frame" + (ui.selected === L.id ? " selected" : ""), "data-alarm": String(st.alarm),
      onclick: (e) => { if (!e.target.closest("button")) ui.select(L.id); },
      onmouseenter: () => ui.setHover(L.id), onmouseleave: () => ui.setHover(null) },
      h("div", { class: "top" }, h("h3", {}, L.name), h("span", { class: "pill " + st.status }, status), vent),
      h("div", { class: "nums" },
        h("div", {}, prod, h("span", {}, "Clinker output")),
        h("div", {}, rel, h("span", {}, `CO2 released (limit ${PERMIT_LIMIT})`)),
        h("div", {}, gross, h("span", {}, "CO2 from kiln"))),
      spark,
      st.alarm ? h("div", { class: "msg alarm" }, `Above permit limit${v.open ? " even with the vent at full capacity" : ""}. Shutting down would stop it.`) : null,
      actions);
    return { el, prod, rel, gross, vent, poly };
  },

  hoverLine: null,
  setHover(id) {
    if (ui.hoverLine === id) return;
    ui.hoverLine = id;
    scene.hover(id);
    for (const L of LINES) ui.cards[L.id]?.el.classList.toggle("hover", id === L.id);
  },

  select(id) {
    ui.selected = ui.selected === id ? null : id;
    ui.renderLines();
    scene.highlight(ui.selected);
  },

  renderEvents() {
    const box = $("events");
    const recent = events.filter((e) => e.t >= Date.now() - 2 * DAY).slice().reverse();
    const groups = new Map();
    for (const e of recent) {
      const key = e.live ? "Since you opened the console" : floorDay(e.t) === floorDay(Date.now()) ? "Earlier today" : fmtDay(e.t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const kindName = { vent: "Vent", alarm: "Alarm", upset: "Upset", sensor: "Air", shutdown: "Shutdown", restart: "Restart", maintenance: "Maintenance", info: "Info" };
    const ul = h("div", { class: "events" });
    for (const [g, list] of groups) {
      ul.append(h("h5", {}, g));
      for (const e of list) ul.append(h("div", { class: "ev", "data-k": e.k }, h("time", {}, fmtTime(e.t, e.live)), h("span", {}, h("span", { class: "kind" }, kindName[e.k] || e.k), e.text)));
    }
    box.replaceChildren(ul);
  },

  onEvent(e) {
    if (ui.tab === "log") ui.renderEvents();
    if (e.k === "alarm" || e.k === "sensor" || (e.k === "info" && /permit limit/.test(e.text))) overview.render();   // the overview is always on screen
    if (["alarm", "vent", "shutdown", "restart", "sensor", "upset"].includes(e.k) && !(ui.tab === "log" && !(typeof layout !== "undefined" && layout.collapsed))) { ui.unseen++; ui.setBadge(); }
    ui.renderLines();
  },

  setTab(t) {
    ui.tab = t;
    $("tabChat").setAttribute("aria-selected", String(t === "chat"));
    $("tabLog").setAttribute("aria-selected", String(t === "log"));
    $("paneChat").hidden = t !== "chat";
    $("paneLog").hidden = t !== "log";
    $("composer").hidden = t !== "chat";
    if (t === "log") { ui.unseen = 0; ui.setBadge(); ui.renderEvents(); }
  },

  // Unseen-event count, on the Event log tab and on the collapsed panel rail
  setBadge() {
    for (const id of ["badge", "railBadge"]) { $(id).hidden = !ui.unseen; $(id).textContent = ui.unseen; }
  },
};
$("tabChat").onclick = () => ui.setTab("chat");
$("tabLog").onclick = () => ui.setTab("log");
$("simUpset").onclick = () => {
  const running = LINES.filter((L) => live.lines[L.id].status === "running" && !live.lines[L.id].upset);
  if (!running.length) return;
  const L = running[Math.floor(Math.random() * running.length)];
  startUpset(L.id, 1.4 + Math.random() * 0.2, 60);
};

/* ── chat rendering ── */
function chatAdd(el) { $("chat").append(el); el.scrollIntoView({ block: "nearest" }); return el; }
const chatUser = (t) => chatAdd(h("div", { class: "msg-user" }, t));
function chatAgent(t) { const b = h("span", {}, t); chatAdd(h("div", { class: "msg-agent" }, h("span", { class: "who" }, copilot.live ? "Claude" : "Demo script"), b)); return b; }
const chatTool = (t) => chatAdd(h("div", { class: "msg-tool" }, t));
const chatSys = (t) => chatAdd(h("div", { class: "msg-sys" }, t));
const chatErr = (t) => chatAdd(h("div", { class: "msg-err" }, t));

const renderChart = (spec) => chatAdd(buildChart(spec));
function renderProposal(lineId, reason) {
  const L = lineById(lineId);
  const card = h("div", { class: "proposal frame", role: "group", "aria-label": `Recommendation to shut down ${L.name}` },
    h("h4", {}, `Recommendation: shut down ${L.name}`), h("p", {}, reason));
  const actions = h("div", { class: "actions" },
    h("button", { class: "btn danger", onclick: () => { shutdown(L.id, `${actor.you}, on copilot recommendation`); done("You shut it down."); } }, `Shut down ${L.name}`),
    h("button", { class: "btn", onclick: () => { liveEvent("info", `Operator kept ${L.name} running after a copilot shutdown recommendation.`, L.id); done("You kept it running."); } }, "Keep running"));
  const done = (t) => actions.replaceWith(h("div", { class: "done" }, t));
  card.append(actions);
  chatAdd(card);
}

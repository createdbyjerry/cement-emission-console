/* overview.js
   The regulatory overview dashboard and its exports (PDF report, emissions CSV, exceedance register CSV). */

/* ═════════════════════════════════════════════════════════════════════════
   8. REGULATORY OVERVIEW + EXPORTS
   ═════════════════════════════════════════════════════════════════════════ */
const PERIOD_NAMES = { last_7_days: "Last 7 days", last_30_days: "Last 30 days", year_to_date: "Year to date" };

// File saving: the Claude viewer's downloads capability, or a normal browser download elsewhere
const downloadsReady = window.claude?.use ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);
async function saveFile(filename, data) {
  const dl = await downloadsReady;
  if (dl) {
    try { await dl.save({ filename, data }); return { ok: true, msg: `Saved ${filename}` }; }
    catch (e) {
      const m = { declined: "Download cancelled.", rate_limited: "A download prompt is already open." }[e?.code];
      return { ok: false, msg: m || `Couldn't save the file (${e?.code || "error"}).` };
    }
  }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, msg: `Downloaded ${filename}` };
}

const csvCell = (v) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const fileStem = (c) => `halden-ridge_${c.period.replace(/_/g, "-")}_${fmtDate(c.a)}_to_${fmtDate(c.b)}`;

function emissionsCsv(c) {
  const rows = [["period_start", "granularity", "line", "clinker_t", "co2_from_kiln_t", "co2_captured_t", "co2_released_t", "released_intensity_t_per_t", "vent_minutes"]];
  for (const p of c.series) for (const L of LINES) {
    const d = p.detail[L.id], rel = d.gross - d.captured;
    rows.push([fmtAbs(p.start), c.series_granularity, L.name, round(d.clinker), round(d.gross), round(d.captured, 2), round(rel), d.clinker > 0 ? round(rel / d.clinker, 3) : "", Math.round(d.ventMin)]);
  }
  return toCsv(rows);
}
function registerCsv(c) {
  const rows = [["line", "start", "end", "duration_min", "peak_released_t_per_h", "permit_limit_t_per_h", "cause", "action"]];
  for (const e of c.exceedances.register) rows.push([lineById(e.line).name, fmtAbs(e._start), e._end ? fmtAbs(e._end) : "ongoing", e.duration_min, e.peak_released_t_per_h, e.limit_t_per_h, e.cause, e.action]);
  return toCsv(rows);
}

function buildPdf(c) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16, BOTTOM = 280;
  let y = 0;
  // Print palette from the design tokens (color.print.*)
  const P = {
    header: tokenRgb("--color-print-header", [14, 20, 24]), headerText: tokenRgb("--color-print-header-text", [225, 225, 220]),
    accent: tokenRgb("--color-print-accent", [247, 201, 72]), text: tokenRgb("--color-print-text", [28, 32, 36]),
    muted: tokenRgb("--color-print-muted", [105, 112, 116]), rule: tokenRgb("--color-print-rule", [225, 228, 230]),
    head: tokenRgb("--color-print-table-head", [238, 240, 241]), flag: tokenRgb("--color-print-flag", [190, 45, 35]),
  };
  const ink = () => doc.setTextColor(...P.text), muted = () => doc.setTextColor(...P.muted);
  const font = (size, style = "normal") => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 18; } };

  // Header band
  doc.setFillColor(...P.header); doc.rect(0, 0, W, 30, "F");
  doc.setFillColor(...P.accent); doc.rect(0, 30, W, 1.4, "F");
  font(16, "bold"); doc.setTextColor(...P.accent); doc.text("Emissions compliance report", M, 13);
  font(9.5); doc.setTextColor(...P.headerText);
  doc.text(`${c.site}    Permit ${c.permit}`, M, 20.5);
  doc.text(`Reporting period: ${fmtAbs(c.a)} to ${fmtAbs(c.b)} (${PERIOD_NAMES[c.period] || c.period})`, M, 26);
  y = 39;
  font(8.5); muted();
  doc.text(`Generated ${fmtAbs(Date.now())}. Prototype: all figures are synthetic and for demonstration only.`, M, y); y += 8;

  const section = (title) => { ensure(14); font(12, "bold"); ink(); doc.text(title, M, y); doc.setDrawColor(...P.accent); doc.setLineWidth(0.6); doc.line(M, y + 1.8, M + 14, y + 1.8); y += 7.5; };
  const kv = (rows) => {
    font(9.5);
    for (const [k, v, flag] of rows) {
      ensure(7); muted(); doc.text(k, M, y);
      if (flag) doc.setTextColor(...P.flag); else ink();
      doc.setFont("helvetica", "bold"); doc.text(String(v), M + 72, y); doc.setFont("helvetica", "normal");
      doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.line(M, y + 2, W - M, y + 2); y += 6.6;
    }
    y += 3;
  };
  const table = (heads, rows, widths, aligns = []) => {
    const rowH = (cells) => Math.max(...cells.map((t, i) => doc.splitTextToSize(String(t), widths[i] - 2).length)) * 3.9 + 2.4;
    const head = () => {
      font(8, "bold"); doc.setFillColor(...P.head); doc.rect(M, y - 4, W - 2 * M, 6.4, "F"); ink();
      let x = M; heads.forEach((hd, i) => { doc.text(hd, aligns[i] === "r" ? x + widths[i] - 1.5 : x + 1, y, { align: aligns[i] === "r" ? "right" : "left" }); x += widths[i]; });
      y += 5.4;
    };
    ensure(14); head();
    font(8);
    for (const r of rows) {
      const hgt = rowH(r);
      if (y + hgt > BOTTOM) { doc.addPage(); y = 18; head(); font(8); }
      let x = M; ink();
      r.forEach((cell, i) => {
        const lines = doc.splitTextToSize(String(cell), widths[i] - 2);
        doc.text(lines, aligns[i] === "r" ? x + widths[i] - 1.5 : x + 1, y, { align: aligns[i] === "r" ? "right" : "left" });
        x += widths[i];
      });
      y += hgt - 1.2;
      doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.line(M, y - 2.6, W - M, y - 2.6);
    }
    y += 4;
  };

  const t = c.totals;
  section("1. Summary");
  kv([
    ["Clinker produced", `${num(t.clinker_t)} t`],
    ["CO2 from kilns (gross)", `${num(t.co2_gross_t)} t`],
    ["CO2 captured by vents", `${num(t.co2_captured_t, 1)} t (${t.capture_pct_of_gross}% of gross)`],
    ["CO2 released to air", `${num(t.co2_released_t)} t`],
    ["Released intensity", `${f3(t.intensity_t_co2_per_t)} t CO2 per t clinker (target ${f3(t.intensity_target)}, ${t.intensity_status})`, t.intensity_status !== "within target"],
    ["Permit-limit exceedances", `${c.exceedances.count} (${c.exceedances.total_minutes} min above ${PERMIT_LIMIT} t/h)`, c.exceedances.count > 0],
    ["Fence-line air alerts", `${c.air.fence_line_alerts} (threshold ${c.air.alert_threshold_ppm} ppm)`],
    ["Annual cap, year to date", `${c.annual_cap.used_pct}% used, ${c.annual_cap.year_elapsed_pct}% of year elapsed (${c.annual_cap.status})`, c.annual_cap.status !== "on track"],
    ["Projected year-end release", `${num(c.annual_cap.projected_year_end_t)} t of ${num(c.annual_cap.cap_t)} t cap`],
  ]);

  section("2. Emissions by line");
  table(["Line", "Clinker t", "Released t", "Intensity", "Captured t", "Vent min", "Running h", "Data avail."],
    c.by_line.map((l) => [l.name, num(l.clinker_t), num(l.co2_released_t), `${f3(l.intensity_t_co2_per_t)}${l.intensity_status === "above target" ? " *" : ""}`, num(l.co2_captured_t, 1), num(l.vent_minutes), num(l.running_hours), `${l.data_availability_pct}%`]),
    [22, 22, 24, 22, 22, 20, 22, 24], ["l", "r", "r", "r", "r", "r", "r", "r"]);
  font(7.5); muted(); doc.text(`* above the ${INTENSITY_TARGET} t CO2 per t clinker target`, M, y - 2); y += 4;

  section("3. CO2 by source (gross, before capture)");
  const g = c.totals.co2_gross_t || 1;
  kv([
    ["Calcination (process)", `${num(c.by_source_gross.calcination_t)} t (${round(c.by_source_gross.calcination_t / g * 100)}%)`],
    ["Fuel combustion", `${num(c.by_source_gross.fuel_combustion_t)} t (${round(c.by_source_gross.fuel_combustion_t / g * 100)}%)`],
  ]);

  section("4. Permit-limit exceedance register");
  if (!c.exceedances.register.length) { font(9.5); ink(); doc.text("No exceedances in this period.", M, y); y += 9; }
  else table(["Line", "Start", "End", "Min", "Peak t/h", "Cause", "Action"],
    c.exceedances.register.map((e) => [lineById(e.line).name, fmtAbs(e._start), e._end ? fmtAbs(e._end) : "ongoing", e.duration_min, e.peak_released_t_per_h, e.cause, e.action]),
    [16, 27, 27, 11, 15, 38, 44], ["l", "l", "l", "r", "r", "l", "l"]);

  section(`5. Released CO2 by ${c.series_granularity}`);
  table([c.series_granularity === "month" ? "Month" : "Date", "Clinker t", "Line 1 released t", "Line 2 released t", "Intensity"],
    c.series.map((p) => [c.series_granularity === "month" ? p.label : fmtDate(p.start), num(p.clinker_t), num(p.L1_released_t), num(p.L2_released_t), f3(p.intensity)]),
    [36, 34, 38, 38, 32], ["l", "r", "r", "r", "r"]);

  section("6. Method and notes");
  font(8.8); ink();
  for (const para of [
    "CO2 from kilns is measured continuously by stack monitoring on each line. CO2 released is kiln CO2 minus CO2 captured by the automated capture vents (CV-1, CV-2).",
    `Calcination emissions are calculated at ${CALCINATION} t CO2 per tonne of clinker; fuel combustion is the remainder of measured kiln CO2.`,
    `An exceedance is any period where released CO2 stays above the hourly permit limit of ${PERMIT_LIMIT} t/h for more than 10 seconds. Times are local plant time.`,
    "Data availability is the share of the period with valid stack monitoring data.",
  ]) { const lines = doc.splitTextToSize(para, W - 2 * M); ensure(lines.length * 4.2 + 2); doc.text(lines, M, y); y += lines.length * 4.2 + 2; }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); font(7.5); muted();
    doc.text(`${c.site}  Permit ${c.permit}  ${fmtDate(c.a)} to ${fmtDate(c.b)}`, M, 290);
    doc.text(`Page ${i} of ${pages}`, W - M, 290, { align: "right" });
  }
  return doc.output("blob");
}

const overview = {
  period: "last_30_days",
  summary: null,
  liveEl: null,

  render() {
    const c = overview.summary = complianceSummary({ period: overview.period });
    const t = c.totals, box = $("overview");
    const kpi = (label, value, unit, ...sub) => h("div", { class: "kpi frame" }, h("div", { class: "lbl" }, label), h("div", { class: "val" }, value, unit ? h("small", {}, unit) : null), ...sub);

    const status = h("span", { class: "export-status", "aria-live": "polite" });
    const exportBtn = (label, make, primary) => h("button", { class: "btn" + (primary ? " primary" : ""), onclick: async () => {
      status.className = "export-status"; status.textContent = "Preparing…";
      try { const r = await make(); status.textContent = r.msg; status.classList.toggle("bad", !r.ok); }
      catch (e) { status.textContent = `Export failed: ${e.message}`; status.classList.add("bad"); }
    } }, label);
    const pdfReady = !!window.jspdf?.jsPDF;

    const capUsed = c.annual_cap.used_pct, capEl = c.annual_cap.year_elapsed_pct;
    const linesAbove = c.by_line.filter((l) => l.intensity_status === "above target");
    const g = t.co2_gross_t || 1, calcPct = round(c.by_source_gross.calcination_t / g * 100);

    // Released CO2 per line per bucket, with the daily equivalent of the hourly limit
    const relChart = buildChart({ title: `Released CO2 by line, per ${c.series_granularity}`, kind: "bar", unit: "t",
      labels: c.series.map((p) => p.label),
      series: [{ name: "Line 1", values: c.series.map((p) => p.L1_released_t) }, { name: "Line 2", values: c.series.map((p) => p.L2_released_t) }],
      reference_line: c.series_granularity === "day" ? { value: PERMIT_LIMIT * 24, label: "Daily equivalent of permit limit" } : null });
    const intChart = buildChart({ title: "Released intensity vs target", kind: "line", unit: "t CO2 per t clinker",
      labels: c.series.map((p) => p.label),
      series: [{ name: "Line 1", values: c.series.map((p) => p.L1_intensity) }, { name: "Line 2", values: c.series.map((p) => p.L2_intensity) }],
      reference_line: { value: INTENSITY_TARGET, label: `Target ${f3(INTENSITY_TARGET)}` } });

    overview.liveEl = h("div", { class: "live-strip" });
    box.replaceChildren(
      h("div", { class: "ov-head" },
        h("div", {}, h("h2", {}, "Regulatory overview"),
          h("p", {}, `Permit ${PERMIT_ID}. Figures for ${c.from} to ${c.to}. The numbers a regulator reviews, ready to export.`)),
        h("div", { class: "seg", role: "group", "aria-label": "Reporting period" }, Object.entries(PERIOD_NAMES).map(([k, v]) =>
          h("button", { "aria-pressed": String(overview.period === k), onclick: () => { overview.period = k; overview.render(); } }, v)))),
      h("div", { class: "exports frame" }, h("span", { class: "label" }, "Export this period"),
        pdfReady ? exportBtn("Compliance report (PDF)", () => saveFile(`${fileStem(c)}_compliance-report.pdf`, buildPdf(c)), true)
                 : h("span", { class: "export-status bad" }, "PDF export unavailable (library didn't load)."),
        exportBtn("Emissions data (CSV)", () => saveFile(`${fileStem(c)}_emissions.csv`, emissionsCsv(c))),
        exportBtn("Exceedance register (CSV)", () => saveFile(`${fileStem(c)}_exceedances.csv`, registerCsv(c))),
        status),
      overview.liveEl,
      h("div", { class: "kpis" },
        kpi("CO2 released to air", num(t.co2_released_t), "t", h("div", { class: "sub" }, `${num(t.co2_gross_t)} t from kilns, ${num(t.co2_captured_t, 1)} t captured`)),
        kpi("Released intensity", f3(t.intensity_t_co2_per_t), "t CO2 / t clinker",
          h("div", { class: "sub" }, `Target ${f3(INTENSITY_TARGET)}. `, h("span", { class: t.intensity_status === "above target" ? "bad" : "good" },
            t.intensity_status === "above target" ? "Above target" : "Within target"), linesAbove.length ? ` (${linesAbove.map((l) => l.name).join(", ")} above)` : "")),
        kpi("Permit-limit exceedances", String(c.exceedances.count), "",
          h("div", { class: "sub" }, c.exceedances.count ? h("span", { class: "bad" }, `${c.exceedances.total_minutes} min above ${PERMIT_LIMIT} t/h`) : "None this period")),
        kpi("Annual cap used", `${capUsed}`, "%",
          h("div", { class: "capbar", title: `${capUsed}% used, ${capEl}% of the year elapsed` }, h("i", { style: `width:${Math.min(capUsed, 100)}%` }), h("em", { style: `left:${capEl}%` })),
          h("div", { class: "sub" }, `${capEl}% of the year gone. `, h("span", { class: c.annual_cap.status === "on track" ? "good" : "bad" }, c.annual_cap.status === "on track" ? "On track" : "Projected over cap"),
            `, ${num(c.annual_cap.projected_year_end_t / 1e6, 2)} of ${num(ANNUAL_CAP / 1e6, 2)} Mt projected`)),
        kpi("CO2 captured", num(t.co2_captured_t, 1), "t", h("div", { class: "sub" }, `${t.capture_pct_of_gross}% of kiln CO2. Vents ran ${num(c.by_line.reduce((a, l) => a + l.vent_minutes, 0) / 60, 1)} h`)),
        kpi("Monitoring data captured", `${Math.min(...c.by_line.map((l) => l.data_availability_pct))}`, "% min",
          h("div", { class: "sub" }, `${c.by_line.map((l) => `${l.name} ${l.data_availability_pct}%`).join(", ")}. ${c.air.fence_line_alerts} fence-line air alert${c.air.fence_line_alerts === 1 ? "" : "s"}`))),
      h("div", { class: "ov-grid" }, relChart, intChart),
      h("div", { class: "ov-grid" },
        h("section", { class: "box frame" }, h("h3", {}, "CO2 by source, before capture"),
          h("div", { class: "splitbar", role: "img", "aria-label": `Calcination ${calcPct}%, fuel combustion ${round(100 - calcPct)}%` },
            h("span", { style: `width:${calcPct}%;background:var(--color-chart-1)` }), h("span", { style: `width:${100 - calcPct}%;background:var(--color-chart-3)` })),
          h("div", { class: "srcrow" }, h("span", {}, h("i", { style: "background:var(--color-chart-1)" }), "Calcination (process)"), h("span", {}, `${num(c.by_source_gross.calcination_t)} t, ${calcPct}%`)),
          h("div", { class: "srcrow" }, h("span", {}, h("i", { style: "background:var(--color-chart-3)" }), "Fuel combustion"), h("span", {}, `${num(c.by_source_gross.fuel_combustion_t)} t, ${round(100 - calcPct)}%`)),
          h("p", { class: "note" }, "Calcination CO2 comes from turning limestone into clinker and can't be cut by burning cleaner fuel.")),
        h("section", { class: "box frame" }, h("h3", {}, "By line"),
          h("div", { class: "table-wrap" }, h("table", { class: "data" },
            h("thead", {}, h("tr", {}, ["Line", "Released t", "Intensity", "Captured t", "Running h"].map((x, i) => h("th", { class: i ? "num" : "" }, x)))),
            h("tbody", {}, c.by_line.map((l) => h("tr", {},
              h("td", {}, l.name), h("td", { class: "num" }, num(l.co2_released_t)),
              h("td", { class: "num" + (l.intensity_status === "above target" ? " over" : "") }, f3(l.intensity_t_co2_per_t)),
              h("td", { class: "num" }, num(l.co2_captured_t, 1)), h("td", { class: "num" }, num(l.running_hours))))))))),
      h("section", { class: "box frame" }, h("h3", {}, `Exceedance register (${c.exceedances.count})`),
        c.exceedances.register.length ? h("div", { class: "table-wrap" }, h("table", { class: "data" },
          h("thead", {}, h("tr", {}, ["Start", "Duration", "Line", "Peak", "Cause", "Action taken"].map((x, i) => h("th", { class: i === 1 || i === 3 ? "num" : "" }, x)))),
          h("tbody", {}, c.exceedances.register.slice().reverse().map((e) => h("tr", {},
            h("td", {}, e.start), h("td", { class: "num" }, `${e.duration_min} min`), h("td", {}, lineById(e.line).name),
            h("td", { class: "num over" }, `${e.peak_released_t_per_h} t/h`), h("td", {}, e.cause), h("td", {}, e.action))))))
          : h("p", { class: "note" }, "No exceedances in this period.")),
      h("p", { class: "method" }, `Released CO2 is kiln CO2 measured at each stack minus CO2 captured by the vents. Calcination is calculated at ${CALCINATION} t CO2 per tonne of clinker. An exceedance is released CO2 above ${PERMIT_LIMIT} t/h for more than 10 seconds. All figures are synthetic.`));
    overview.renderLive();
  },

  renderLive() {
    const el = overview.liveEl;
    if (!el) return;
    const bad = LINES.filter((L) => live.lines[L.id].alarm);
    el.className = "live-strip" + (bad.length ? " alarm" : "");
    el.replaceChildren(
      h("b", {}, bad.length ? "Live: permit limit exceeded" : "Live: within permit limits"),
      ...LINES.map((L) => { const st = live.lines[L.id]; return h("span", {}, `${L.name} ${st.status === "running" ? `${round(st.released)} t/h` : st.status}`); }),
      bad.length ? h("button", { class: "btn danger", onclick: () => views.set("console") }, "Open emissions console") : null);
  },
};

const views = {
  current: "console",
  set(v) {
    views.current = v;
    $("overview").hidden = v !== "overview";
    $("console").hidden = v !== "console";
    $("viewOverview").setAttribute("aria-pressed", String(v === "overview"));
    $("viewConsole").setAttribute("aria-pressed", String(v === "console"));
    if (v === "overview") overview.render();
    else overview.liveEl = null;
  },
};
$("viewOverview").onclick = () => views.set("overview");
$("viewConsole").onclick = () => views.set("console");

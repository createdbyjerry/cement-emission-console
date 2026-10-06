/* layout.js
   Floating layout: the 3D view fills the screen, and the app bar, side panel and line-card dock
   float above it. Handles collapsing and expanding the side panel, and tells the 3D camera how
   much of the canvas each floating container covers so the plant stays centred in the open area. */

const layout = (() => {
  const panel = $("panel"), toggle = $("panelToggle"), body = $("panelBody");
  const stacked = matchMedia("(max-width: 860px)");   // = layout.breakpoint token
  const KEY = "halden.panelCollapsed";
  const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  const write = (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* storage unavailable: state lasts this visit */ } };

  function setCollapsed(collapsed, { save = true, focus = false } = {}) {
    layout.collapsed = ui.panelCollapsed = collapsed;
    panel.dataset.collapsed = String(collapsed);
    document.body.dataset.panel = collapsed ? "collapsed" : "expanded";
    const label = collapsed ? "Expand panel" : "Collapse panel";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = label;
    toggle.querySelector(".sr-only").textContent = label;
    body.inert = collapsed;   // keep collapsed content out of the tab order and screen readers
    if (save) write(collapsed);
    if (!collapsed && ui.tab === "log") { ui.unseen = 0; ui.setBadge(); ui.renderEvents(); }
    if (focus && !collapsed) (ui.tab === "chat" ? $("ask") : $("tabLog")).focus({ preventScroll: true });
    measure();
  }

  /* Report the area each floating container covers to the 3D camera. While the panel animates,
     the ResizeObserver fires every frame, so the plant glides along with it. */
  function measure() {
    if (stacked.matches) { scene.setInsets({ left: 0, top: 0, right: 0, bottom: 0 }); return; }
    const W = innerWidth, H = innerHeight;
    const bar = document.querySelector(".bar").getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const dock = $("console").hidden ? null : $("lines").getBoundingClientRect();
    document.body.style.setProperty("--dock-h", `${dock?.height || 0}px`);   // keeps the hover HUD above the dock
    scene.setInsets({
      left: 0,
      top: bar.bottom,
      right: Math.max(0, W - p.left),
      bottom: dock && dock.height ? Math.max(0, H - dock.top) : 0,
    });
  }

  toggle.addEventListener("click", () => setCollapsed(!layout.collapsed, { focus: true }));
  for (const b of panel.querySelectorAll(".rail-btn")) {
    b.addEventListener("click", () => { ui.setTab(b.dataset.tab); setCollapsed(false, { focus: true }); });
  }
  // "\" toggles the panel, unless the operator is typing
  addEventListener("keydown", (e) => {
    if (e.key !== "\\" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); setCollapsed(!layout.collapsed);
  });

  const ro = new ResizeObserver(measure);
  ro.observe(panel); ro.observe($("lines")); ro.observe(document.querySelector(".bar"));
  addEventListener("resize", measure);
  stacked.addEventListener("change", measure);

  // Start without animating into the saved state
  document.documentElement.classList.add("no-motion");
  const api = { collapsed: false, setCollapsed, measure };
  queueMicrotask(() => {
    setCollapsed(read(), { save: false });
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("no-motion")));
  });
  return api;
})();

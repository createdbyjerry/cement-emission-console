/* layout.js
   Floating layout: the 3D view fills the screen and is always visible. The overview column (left) and the
   side panel (right) each collapse to a rail and expand again. This file handles both, fades the overview's
   cards where they scroll under its top and bottom bars, and tells the 3D camera how much of the canvas the
   floating containers cover so the plant stays centred in the open area between them. */

const layout = (() => {
  const stacked = matchMedia("(max-width: 860px)");   // = layout.breakpoint token
  const store = {
    read: (key) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } },
    write: (key, v) => { try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* storage unavailable: state lasts this visit */ } },
  };

  /* One collapsible column. `bodyAttr` is the attribute on <body> that console.css reads to move the
     overlays and the line-card dock along with it. */
  function collapsible({ el, toggle, inner, key, bodyAttr, noun, onExpand }) {
    const c = {
      collapsed: false,
      set(collapsed, { save = true, focus = false } = {}) {
        c.collapsed = collapsed;
        el.dataset.collapsed = String(collapsed);
        document.body.dataset[bodyAttr] = collapsed ? "collapsed" : "expanded";
        const label = `${collapsed ? "Expand" : "Collapse"} ${noun}`;
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.title = label;
        toggle.querySelector(".sr-only").textContent = label;
        inner.inert = collapsed && !stacked.matches;   // keep collapsed content out of the tab order and screen readers
        if (save) store.write(key, collapsed);
        if (!collapsed) onExpand?.({ focus });
        measure();
      },
      toggle(opts) { c.set(!c.collapsed, opts); },
    };
    toggle.addEventListener("click", () => c.toggle({ focus: true }));
    c.restore = () => c.set(store.read(key), { save: false });
    return c;
  }

  // Right: copilot and event log
  const panel = collapsible({ el: $("panel"), toggle: $("panelToggle"), inner: $("panelBody"), key: "halden.panelCollapsed", bodyAttr: "panel", noun: "panel",
    onExpand({ focus }) {
      if (ui.tab === "log") { ui.unseen = 0; ui.setBadge(); ui.renderEvents(); }
      if (focus) (ui.tab === "chat" ? $("ask") : $("tabLog")).focus({ preventScroll: true });
    } });
  for (const b of $("panel").querySelectorAll(".rail-btn")) {
    b.addEventListener("click", () => { ui.setTab(b.dataset.tab); panel.set(false, { focus: true }); });
  }

  // Left: regulatory overview
  const dash = collapsible({ el: $("dash"), toggle: $("dashToggle"), inner: $("dashBody"), key: "halden.dashCollapsed", bodyAttr: "dash", noun: "overview",
    onExpand({ focus }) { requestAnimationFrame(updateFades); if (focus) $("period").querySelector("[aria-pressed=true]")?.focus({ preventScroll: true }); } });
  for (const b of [$("dashExpand"), ...$("dash").querySelectorAll(".dash-rail .rail-btn")]) b.addEventListener("click", () => dash.set(false, { focus: true }));
  $("dash").querySelector(".dash-rail").addEventListener("click", (e) => { if (!e.target.closest("button")) dash.set(false, { focus: true }); });

  /* Scroll edges: a card fades out where it meets the top or bottom bar, but only on the side where there
     is more to scroll to. At the very top or bottom the list simply ends against the bar. */
  const scroller = $("dashScroll");
  function updateFades() {
    const max = scroller.scrollHeight - scroller.clientHeight;
    scroller.dataset.moreAbove = String(scroller.scrollTop > 1);
    scroller.dataset.moreBelow = String(scroller.scrollTop < max - 1);
  }
  scroller.addEventListener("scroll", updateFades, { passive: true });

  /* Report the area each floating container covers to the 3D camera. While a column animates, the
     ResizeObserver fires every frame, so the plant glides along with it. */
  function measure() {
    if (stacked.matches) { scene.setInsets({ left: 0, top: 0, right: 0, bottom: 0 }); return; }
    const W = innerWidth, H = innerHeight;
    const bar = document.querySelector(".bar").getBoundingClientRect();
    const p = $("panel").getBoundingClientRect();
    const d = $("dash").getBoundingClientRect();
    const dock = $("lines").getBoundingClientRect();
    document.body.style.setProperty("--dock-h", `${dock.height || 0}px`);   // keeps the hover HUD above the dock
    scene.setInsets({
      left: Math.max(0, d.right),
      top: bar.bottom,
      right: Math.max(0, W - p.left),
      bottom: dock.height ? Math.max(0, H - dock.top) : 0,
    });
    updateFades();
  }

  // Shortcuts, unless the operator is typing: "\" toggles the side panel, "[" toggles the overview
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key === "\\") { e.preventDefault(); panel.toggle(); }
    else if (e.key === "[") { e.preventDefault(); dash.toggle(); }
  });

  const ro = new ResizeObserver(measure);
  for (const el of [$("panel"), $("dash"), $("lines"), document.querySelector(".bar"), $("overview")]) ro.observe(el);
  addEventListener("resize", measure);
  stacked.addEventListener("change", () => { panel.set(panel.collapsed, { save: false }); dash.set(dash.collapsed, { save: false }); });

  // Start without animating into the saved state
  document.documentElement.classList.add("no-motion");
  const api = {
    get collapsed() { return panel.collapsed; },
    get dashCollapsed() { return dash.collapsed; },
    setCollapsed: (v, o) => panel.set(v, o),
    setDashCollapsed: (v, o) => dash.set(v, o),
    measure, updateFades,
  };
  queueMicrotask(() => {
    panel.restore(); dash.restore();
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("no-motion")));
  });
  return api;
})();

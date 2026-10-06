/* main.js
   Boot: runs the simulation every second and detects whether Claude is available. */

/* ═════════════════════════════════════════════════════════════════════════
   9. BOOT
   ═════════════════════════════════════════════════════════════════════════ */
function everySecond() {
  tick(1);
  scene.updateSensors();
  ui.renderSite();
  ui.renderLines();
  $("clock").textContent = fmtTime(Date.now(), true);
  $("consoleDot").hidden = !(views.current === "overview" && LINES.some((L) => live.lines[L.id].alarm));
  if (views.current === "overview") overview.renderLive();
}
everySecond();
setInterval(everySecond, 1000);

(async () => {
  let sample = null;
  try { sample = window.claude?.use ? await window.claude.use("sample") : null; } catch { sample = null; }
  let tools = false;
  if (sample) { try { tools = !!(await sample.limits())?.tools; } catch { tools = false; } }
  if (sample && tools) {
    copilot.sample = sample; copilot.live = true;
    $("mode").dataset.mode = "live"; $("mode").textContent = "Live: Claude";
  } else setDemoMode();
})();

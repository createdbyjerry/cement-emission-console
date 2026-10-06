/* scene.js
   The 3D plant (Three.js), drawn as a flat technical drawing: orthographic camera, unlit fills, token-coloured outlines. */

/* ═════════════════════════════════════════════════════════════════════════
   7. 3D PLANT (Three.js). x = east, z = south, y = up. 1 unit = 1 m (roughly).
   ═════════════════════════════════════════════════════════════════════════ */
const scene = (() => {
  /* Flat "technical drawing" rendering: orthographic camera (no perspective),
     unlit dark fills, yellow outlines. Reads like a 2D schematic from any angle. */
  const container = $("viewport");
  // Every colour and opacity comes from the design tokens (tokens/tokens.json)
  const color3 = (name, fallback) => { const [r, g, b] = tokenRgb(name, fallback); return new THREE.Color(r / 255, g / 255, b / 255); };
  const ACCENT = color3("--color-scene-outline", [247, 201, 72]);
  const HOVER = color3("--color-scene-outline-hover", [255, 255, 255]);
  const BG = color3("--color-surface-bg", [10, 14, 17]);
  const FILL = color3("--color-scene-fill", [14, 20, 24]), FILL_HI = color3("--color-scene-fill-selected", [58, 48, 12]);
  const GROUND = color3("--color-scene-ground", [12, 17, 20]);
  const DIM = tokenNumber("--scene-dim-outline-opacity", 0.4);
  const SCAN_PERIOD = tokenSeconds("--motion-scanner-period", 10);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(BG);
  container.prepend(renderer.domElement);
  const world = new THREE.Scene();

  const VIEW = tokenNumber("--scene-view-height", 200); // world units visible vertically at zoom 1
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -3000, 3000);
  camera.position.set(-230, 220, 300);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(8, 10, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minZoom = 0.6; controls.maxZoom = 4;

  const fillMat = () => new THREE.MeshBasicMaterial({ color: FILL, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = () => new THREE.LineBasicMaterial({ color: ACCENT });
  const dimEdge = () => new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: DIM });

  const clickable = [], groupsByLine = { L1: [], L2: [] }, labels = [];
  const label = (text, pos) => { const el = h("span", {}, text); $("labels").append(el); labels.push({ el, pos }); };
  function solid(geo, x, y, z, { line, dim, rot } = {}) {
    const m = new THREE.Mesh(geo, fillMat());
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), dim ? dimEdge() : edgeMat()));
    world.add(m);
    if (line) { m.userData.line = line; clickable.push(m); groupsByLine[line].push(m); }
    return m;
  }
  const box = (w, hh, d, x, y, z, opt) => solid(new THREE.BoxGeometry(w, hh, d), x, y + hh / 2, z, opt);
  const cyl = (r, hh, x, y, z, opt, seg = 12) => solid(new THREE.CylinderGeometry(r, r, hh, seg), x, y + hh / 2, z, opt);
  const loop = (pts, mat) => { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.3, z))), mat); world.add(l); return l; };

  // Ground: dark plane, faint yellow grid, site pad and road outlines
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(340, 240), new THREE.MeshBasicMaterial({ color: GROUND }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  const grid = new THREE.GridHelper(340, 34, ACCENT, ACCENT);
  grid.material.transparent = true; grid.material.opacity = tokenNumber("--scene-grid-opacity", 0.07); grid.position.y = 0.1; world.add(grid);
  loop([[-125, -88], [125, -88], [125, 88], [-125, 88]], dimEdge());
  for (const [x0, z0, x1, z1] of [[-115, -9, 115, -1], [56, -80, 64, 80], [-74, -80, -66, 80]])
    loop([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.18 }));
  // Fence: dashed
  const fence = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-120, -85], [120, -85], [120, 85], [-120, 85]].map(([x, z]) => new THREE.Vector3(x, 1, z))),
    new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.55 }));
  fence.computeLineDistances(); world.add(fence);

  // Stockpiles + raw mill
  for (const [x, z, r] of [[-100, -50, 14], [-104, -15, 11], [-98, 40, 13]]) solid(new THREE.ConeGeometry(r, r * 0.8, 8), x, r * 0.4, z, { dim: true });
  label("Limestone stockpiles", new THREE.Vector3(-100, 16, -10));
  box(16, 18, 22, -75, 0, -15); label("Raw mill", new THREE.Vector3(-75, 22, -15));

  // Kiln lines: stepped preheater tower, rotary kiln, piers, cooler, stack, capture vent
  const vents = {};
  for (const L of LINES) {
    const z = L.z, o = { line: L.id };
    box(15, 20, 15, -30, 0, z, o); box(12, 16, 12, -30, 20, z, o); box(9, 14, 9, -30, 36, z, o);
    solid(new THREE.CylinderGeometry(3.2, 3.2, 60, 10), 8, 7, z, { line: L.id, rot: [0, 0, Math.PI / 2 - 0.04] });
    for (const px of [-12, 8, 28]) box(2, 5, 6, px, 0, z, { line: L.id, dim: true });
    box(12, 10, 12, 44, 0, z, o);
    const sp = STACK_POS[L.id];
    cyl(2.6, STACK_H, sp.x, 0, sp.z, o, 8);
    box(10, 7, 10, sp.x - 14, 0, sp.z, o);
    const fan = solid(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 10), sp.x - 14, 7.5, sp.z, o);
    const blade = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6.6, 0.3, 0.9)), edgeMat());
    blade.position.y = 0.6; fan.add(blade);
    solid(new THREE.CylinderGeometry(0.9, 0.9, 13, 6), sp.x - 7, 20, sp.z, { line: L.id, rot: [0, 0, Math.PI / 2] });
    vents[L.id] = fan;
    label(`${L.name} kiln`, new THREE.Vector3(10, 16, z));
    label(`${L.vent} vent`, new THREE.Vector3(sp.x - 14, 13, sp.z));
  }
  // Silos + cement mill
  for (const [x, z] of [[80, -40], [94, -40], [80, -26], [94, -26]]) cyl(6, 30, x, 0, z);
  label("Clinker silos", new THREE.Vector3(87, 36, -33));
  box(20, 16, 16, 86, 0, 30); label("Cement mill", new THREE.Vector3(86, 20, 30));

  // Fence-line sensors: a post and a diamond that shifts yellow → red with CO2
  const sensorMeshes = [];
  for (const sn of SENSORS) {
    const post = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sn.x, 0, sn.z), new THREE.Vector3(sn.x, 6, sn.z)]), dimEdge());
    world.add(post);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), new THREE.MeshBasicMaterial({ color: ACCENT }));
    head.position.set(sn.x, 8, sn.z); head.userData.sensor = sn.id; world.add(head); sensorMeshes.push(head);
  }

  // Air scanner mast + sweeping beam
  cyl(0.8, 28, 20, 0, 60, {}, 6);
  label("Air scanner", new THREE.Vector3(20, 31, 60));   // just above the mast top
  // Scanner: an upright circle centred on the top of the mast, spinning about the mast
  const beamPivot = new THREE.Object3D(); beamPivot.position.set(20, 28, 60); world.add(beamPivot);
  const SCAN_R = 125;   // large enough to sweep the whole site; the part below ground is hidden by the ground plane
  const glow = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d"), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.45, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  beamPivot.add(new THREE.Mesh(new THREE.CircleGeometry(SCAN_R, 64),
    new THREE.MeshBasicMaterial({ color: ACCENT, map: glow, transparent: true, opacity: tokenNumber("--scene-scanner-opacity", 0.255), side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
  const hub = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: ACCENT }));
  beamPivot.add(hub);

  // Shared yellow → orange → red scale for sensors and smoke
  const RAMP = [tokenRgb("--color-emission-low", [247, 201, 72]), tokenRgb("--color-emission-mid", [255, 138, 61]), tokenRgb("--color-emission-high", [255, 74, 61])];
  function ramp(k) {
    const t = k * 2, i = Math.min(1, Math.floor(t)), f = t - i, a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function updateSensors() {
    for (const m of sensorMeshes) {
      const sn = SENSORS.find((x) => x.id === m.userData.sensor);
      const [r, g, b] = ramp(clamp((sn.ppm - 430) / 140, 0, 1));
      m.material.color.setRGB(r / 255, g / 255, b / 255);
    }
  }

  // Stack plumes: glowing particles, pale yellow when normal, red when high
  const sprite = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const plumes = {};
  for (const L of LINES) {
    const N = 320, geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3).fill(-9999), col = new Float32Array(N * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 7, map: sprite, vertexColors: true, transparent: true, opacity: tokenNumber("--scene-plume-opacity", 0.6), depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    pts.frustumCulled = false; world.add(pts);
    plumes[L.id] = { N, pos, col, age: new Float32Array(N).fill(99), geo, acc: 0, next: 0 };
  }
  function updatePlumes(dt) {
    const wx = Math.cos(live.wind.dir), wz = Math.sin(live.wind.dir), ws = live.wind.speed;
    for (const L of LINES) {
      const p = plumes[L.id], st = live.lines[L.id], sp = STACK_POS[L.id];
      const [r, g, b] = ramp(clamp((st.released - 80) / 45, 0, 1));
      const dim = tokenNumber("--scene-plume-brightness", 0.5);
      p.acc += dt * 45 * (st.released / 95);
      while (p.acc >= 1) {
        p.acc -= 1; const i = p.next; p.next = (p.next + 1) % p.N;
        p.age[i] = 0; p.pos[i * 3] = sp.x + (Math.random() - 0.5) * 2; p.pos[i * 3 + 1] = STACK_H + 1; p.pos[i * 3 + 2] = sp.z + (Math.random() - 0.5) * 2;
        p.col[i * 3] = r / 255 * dim; p.col[i * 3 + 1] = g / 255 * dim; p.col[i * 3 + 2] = b / 255 * dim;
      }
      for (let i = 0; i < p.N; i++) {
        if (p.age[i] > 10) { p.pos[i * 3 + 1] = -9999; continue; }
        p.age[i] += dt;
        const rise = Math.max(0, 5 - p.age[i] * 0.6);
        p.pos[i * 3] += (wx * ws * 1.6 + (Math.random() - 0.5) * 3) * dt;
        p.pos[i * 3 + 1] += rise * dt;
        p.pos[i * 3 + 2] += (wz * ws * 1.6 + (Math.random() - 0.5) * 3) * dt;
      }
      p.geo.attributes.position.needsUpdate = true; p.geo.attributes.color.needsUpdate = true;
    }
  }

  // Picking + hover
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects([...clickable, ...sensorMeshes], false)[0]?.object || null;
  };
  let down = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null;
    const o = pick(e);
    if (o?.userData.line) ui.select(o.userData.line);
  });
  let queued = false;
  el.addEventListener("pointerleave", () => ui.setHover(null));
  el.addEventListener("pointermove", (e) => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const o = pick(e);
      el.style.cursor = o?.userData.line ? "pointer" : "grab";
      ui.setHover(o?.userData.line || null);
      if (o?.userData.line) { const st = live.lines[o.userData.line]; $("hud").textContent = `${lineById(o.userData.line).name}: ${st.status}, releasing ${round(st.released)} t/h CO2`; }
      else if (o?.userData.sensor) { const sn = SENSORS.find((x) => x.id === o.userData.sensor); $("hud").textContent = `Fence sensor ${sn.id}: ${Math.round(sn.ppm)} ppm CO2`; }
    });
  });

  function resize() {
    const w = container.clientWidth, hh = container.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh);
    const a = w / hh;
    Object.assign(camera, { left: -VIEW * a / 2, right: VIEW * a / 2, top: VIEW / 2, bottom: -VIEW / 2 });
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let sweep = 0, lastSweep = Date.now();
  const v3 = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update();
    updatePlumes(dt);
    if (!reduce) beamPivot.rotation.y -= dt * (Math.PI * 2 / SCAN_PERIOD);
    sweep += dt;
    if (sweep >= SCAN_PERIOD) { sweep = 0; lastSweep = Date.now(); }
    const scanText = `Air scanner sweeping every ${round(SCAN_PERIOD)} s. Last full pass ${fmtTime(lastSweep, true)}.`;
    if ($("scanner").textContent !== scanText) $("scanner").textContent = scanText;
    for (const L of LINES) {
      const fan = vents[L.id], open = live.lines[L.id].vent.open;
      fan.material.color.copy(open ? ACCENT : FILL);   // solid yellow = vent capturing
      if (open && !reduce) fan.rotation.y += dt * 9;
    }
    const w = container.clientWidth, hh = container.clientHeight;
    for (const lb of labels) {
      v3.copy(lb.pos).project(camera);
      lb.el.style.left = `${(v3.x * 0.5 + 0.5) * w}px`; lb.el.style.top = `${(-v3.y * 0.5 + 0.5) * hh}px`;
    }
    renderer.render(world, camera);
  });

  return {
    updateSensors,
    hover(lineId) {
      for (const id of ["L1", "L2"]) for (const m of groupsByLine[id]) for (const edge of m.children) {
        if (!edge.isLineSegments) continue;
        edge.userData.baseOpacity ??= edge.material.opacity;
        const on = id === lineId;
        edge.material.color.copy(on ? HOVER : ACCENT);
        edge.material.opacity = on ? 1 : edge.userData.baseOpacity;
      }
    },
    highlight(lineId) {
      for (const id of ["L1", "L2"]) for (const m of groupsByLine[id]) m.material.color.copy(id === lineId ? FILL_HI : FILL);
    },
  };
})();

(function () {
  const canvas = document.getElementById("sceneCanvas");
  const frame = document.getElementById("sceneFrame");
  const labelLayer = document.getElementById("labelLayer");
  const lensLayer = document.getElementById("lensLayer");
  const zoomSlider = document.getElementById("zoomSlider");
  const zoomLabel = document.getElementById("zoomLabel");
  const viewModeLabel = document.getElementById("viewModeLabel");
  const depthTitle = document.getElementById("depthTitle");
  const breadcrumb = document.getElementById("breadcrumb");
  const selectedTitle = document.getElementById("selectedTitle");
  const selectedStatus = document.getElementById("selectedStatus");
  const metricGrid = document.getElementById("metricGrid");
  const calcChain = document.getElementById("calcChain");
  const codeSnippet = document.getElementById("codeSnippet");
  const evidenceChip = document.getElementById("evidenceChip");
  const agentLog = document.getElementById("agentLog");
  const agentForm = document.getElementById("agentForm");
  const agentInput = document.getElementById("agentInput");
  const searchInput = document.getElementById("searchInput");
  const miniFocus = document.getElementById("miniFocus");
  const ctx = canvas.getContext("2d");

  const depthModes = [
    { key: "global", label: "Proyecto", title: "Vista de proyecto", min: 0 },
    { key: "systems", label: "Sistemas", title: "Vista por sistemas", min: 1.08 },
    { key: "element", label: "Elemento", title: "Vista de elemento", min: 1.82 },
    { key: "calculation", label: "Calculo", title: "Vista de cadena de calculo", min: 2.76 },
    { key: "evidence", label: "Evidencia", title: "Vista de evidencia y reporte", min: 3.78 }
  ];

  const state = {
    zoom: 0.78,
    panX: 20,
    panY: 2,
    selectedId: "girder-v14",
    hoverId: null,
    scenario: "uls",
    dragging: false,
    dragStart: null,
    layers: {
      geometry: true,
      loads: true,
      calculations: true,
      code: true,
      report: true
    },
    screenBounds: new Map()
  };

  const entities = [
    {
      id: "deck",
      name: "Tablero T-01",
      short: "Tablero",
      kind: "system",
      status: "ok",
      color: "#3d968a",
      x: -4.8,
      y: -1.18,
      z: 2.45,
      w: 9.6,
      d: 2.36,
      h: 0.28,
      breadcrumb: "PVI Alameda / Superestructura / Tablero T-01",
      metrics: [
        ["Espesor", "0.22 m"],
        ["Volumen", "142 m3"],
        ["Cuantia", "92 kg/m3"],
        ["SLS", "OK"]
      ],
      chain: [
        ["Geometria", "geometry/deck.py :: deck_surface()"],
        ["Cargas permanentes", "loads/dead.py :: asphalt_weight()"],
        ["Distribucion", "analysis/slab.py :: tributary_width()"],
        ["Reporte", "docx/sections.cs :: RenderDeck()"]
      ],
      code: "deck = Deck(width=11.20, thickness=0.22)\nloads.add_dead(\"asphalt\", 23.0 * 0.08)\ncheck = slab_serviceability(deck, loads.sls())",
      report: "Capitulo 3.1 / Tabla 3 / Figura 2"
    },
    {
      id: "girder-v14",
      name: "Viga V-14",
      short: "V-14",
      kind: "element",
      status: "warning",
      color: "#d49336",
      x: -4.65,
      y: -0.42,
      z: 1.86,
      w: 9.25,
      d: 0.32,
      h: 0.55,
      breadcrumb: "PVI Alameda / Superestructura / Viga V-14",
      metrics: [
        ["Utilizacion", "0.84"],
        ["M_ed", "428 kNm"],
        ["Phi M_n", "512 kNm"],
        ["Controla", "ULS-03"]
      ],
      chain: [
        ["Propiedades", "geometry/sections.py :: i_girder_props()"],
        ["Carga tributaria", "loads/live.py :: lane_loads()"],
        ["Combinacion", "combos/uls.py :: uls_03()"],
        ["Flexion", "design/flexure.py :: check_flexure()"],
        ["DOCX", "report/word.cs :: RenderFlexureTable()"]
      ],
      code: "def check_flexure(section, demand, code):\n    phi_mn = code.phi * section.mn\n    ratio = demand.m_ed / phi_mn\n    return CheckResult(ratio=ratio, limit=1.0)",
      report: "Capitulo 4.2 / Tabla 7 / Ecuacion 12"
    },
    {
      id: "girder-v15",
      name: "Viga V-15",
      short: "V-15",
      kind: "element",
      status: "ok",
      color: "#b98232",
      x: -4.65,
      y: 0.42,
      z: 1.86,
      w: 9.25,
      d: 0.32,
      h: 0.55,
      breadcrumb: "PVI Alameda / Superestructura / Viga V-15",
      metrics: [
        ["Utilizacion", "0.76"],
        ["M_ed", "396 kNm"],
        ["Phi M_n", "519 kNm"],
        ["Controla", "ULS-02"]
      ],
      chain: [
        ["Propiedades", "geometry/sections.py :: i_girder_props()"],
        ["Live load", "loads/live.py :: lane_loads()"],
        ["Combinacion", "combos/uls.py :: uls_02()"],
        ["Flexion", "design/flexure.py :: check_flexure()"]
      ],
      code: "ratio = demand.m_ed / (phi * section.mn)\nassert ratio <= 1.0",
      report: "Capitulo 4.2 / Tabla 7"
    },
    {
      id: "abutment-e2",
      name: "Estribo E-02",
      short: "E-02",
      kind: "system",
      status: "ok",
      color: "#7866b7",
      x: 4.75,
      y: -1.45,
      z: 0.55,
      w: 0.72,
      d: 2.9,
      h: 1.72,
      breadcrumb: "PVI Alameda / Infraestructura / Estribo E-02",
      metrics: [
        ["Deslizamiento", "1.72 FS"],
        ["Volcamiento", "2.31 FS"],
        ["Presion max", "188 kPa"],
        ["Apoyo", "OK"]
      ],
      chain: [
        ["Empuje", "loads/soil.py :: active_pressure()"],
        ["Reacciones", "analysis/bearings.py :: bearing_forces()"],
        ["Estabilidad", "design/abutment.py :: stability_check()"],
        ["Reporte", "docx/sections.cs :: RenderAbutment()"]
      ],
      code: "ka = rankine_active(phi=32)\nsliding_fs = resisting_force / driving_force",
      report: "Capitulo 5.1 / Tabla 10"
    },
    {
      id: "foundation-f3",
      name: "Pilotes F-03",
      short: "F-03",
      kind: "system",
      status: "ok",
      color: "#548d58",
      x: -0.45,
      y: -1.0,
      z: -0.55,
      w: 1.0,
      d: 2.0,
      h: 0.55,
      breadcrumb: "PVI Alameda / Fundaciones / Pilotes F-03",
      metrics: [
        ["Axial", "0.63"],
        ["Lateral", "0.58"],
        ["Asiento", "11 mm"],
        ["Grupo", "OK"]
      ],
      chain: [
        ["Reacciones", "analysis/reactions.py :: pier_base()"],
        ["Suelo", "soil/profile.py :: layer_stack()"],
        ["Capacidad", "design/piles.py :: axial_capacity()"],
        ["DOCX", "report/word.cs :: RenderPileGroup()"]
      ],
      code: "q_allow = skin_friction(profile) + end_bearing(layer)\nratio = axial_load / q_allow",
      report: "Capitulo 6.3 / Tabla 14"
    },
    {
      id: "pier-p3",
      name: "Pila P-03",
      short: "P-03",
      kind: "system",
      status: "ok",
      color: "#6f8a8a",
      x: -0.3,
      y: -0.72,
      z: 0.1,
      w: 0.6,
      d: 1.44,
      h: 1.82,
      breadcrumb: "PVI Alameda / Infraestructura / Pila P-03",
      metrics: [
        ["Compresion", "0.49"],
        ["Corte", "0.54"],
        ["Momento", "0.67"],
        ["Ductilidad", "OK"]
      ],
      chain: [
        ["Reacciones", "analysis/reactions.py :: pier_top()"],
        ["Sismo", "loads/seismic.py :: transverse_case()"],
        ["Interaccion", "design/columns.py :: pm_interaction()"],
        ["DOCX", "report/word.cs :: RenderPier()"]
      ],
      code: "pm = interaction_diagram(column, rebar)\nstatus = pm.contains(n_ed, m_ed)",
      report: "Capitulo 5.4 / Figura 11"
    }
  ];

  const projectEntity = {
    id: "project",
    name: "PVI Alameda",
    short: "Proyecto",
    status: "ok",
    breadcrumb: "PVI Alameda / Modelo canonico",
    metrics: [
      ["Entidades", "246"],
      ["Checks", "128/131"],
      ["Archivos py", "38"],
      ["Reporte", "DOCX 92%"]
    ],
    chain: [
      ["Modelo 3D", "scene_graph/root.inspx"],
      ["Grafo calculo", "calc_graph/demand_and_design"],
      ["Ejecucion", "python workers + cache de resultados"],
      ["Reporte", ".NET OpenXML package"]
    ],
    code: "model = InspyroModel.open(\"pvi_alameda.inspx\")\nmodel.transaction(\"agent\", edit_geometry=True)\nmodel.run(\"ULS envelope\")",
    report: "Memoria estructural completa"
  };

  const allEntities = [projectEntity].concat(entities);

  function resizeCanvas() {
    const rect = frame.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }

  function currentDepth() {
    let active = depthModes[0];
    for (const mode of depthModes) {
      if (state.zoom >= mode.min) active = mode;
    }
    return active;
  }

  function selectedEntity() {
    return allEntities.find((entity) => entity.id === state.selectedId) || projectEntity;
  }

  function projection(point) {
    const rect = frame.getBoundingClientRect();
    const scale = 31 * state.zoom;
    const isoX = (point.x - point.y) * 0.86;
    const isoY = (point.x + point.y) * 0.43 - point.z * 0.92;
    return {
      x: rect.width * 0.5 + isoX * scale + state.panX,
      y: rect.height * 0.57 + isoY * scale + state.panY
    };
  }

  function shade(hex, amount) {
    const color = hex.replace("#", "");
    const num = parseInt(color, 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function boxCorners(entity) {
    const x0 = entity.x;
    const y0 = entity.y;
    const z0 = entity.z;
    const x1 = entity.x + entity.w;
    const y1 = entity.y + entity.d;
    const z1 = entity.z + entity.h;
    return {
      a: projection({ x: x0, y: y0, z: z0 }),
      b: projection({ x: x1, y: y0, z: z0 }),
      c: projection({ x: x1, y: y1, z: z0 }),
      d: projection({ x: x0, y: y1, z: z0 }),
      e: projection({ x: x0, y: y0, z: z1 }),
      f: projection({ x: x1, y: y0, z: z1 }),
      g: projection({ x: x1, y: y1, z: z1 }),
      h: projection({ x: x0, y: y1, z: z1 })
    };
  }

  function path(points, fill, stroke, lineWidth) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }

  function drawBox(entity) {
    const corners = boxCorners(entity);
    const selected = entity.id === state.selectedId;
    const hovered = entity.id === state.hoverId;
    const stroke = selected ? "#fff3c0" : hovered ? "#ffffff" : "rgba(255,255,255,0.28)";
    const width = selected ? 2.6 : hovered ? 2 : 1;
    const base = entity.color;
    path([corners.a, corners.b, corners.f, corners.e], shade(base, -28), stroke, width);
    path([corners.b, corners.c, corners.g, corners.f], shade(base, -42), stroke, width);
    path([corners.e, corners.f, corners.g, corners.h], shade(base, 10), stroke, width);

    const points = Object.values(corners);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    state.screenBounds.set(entity.id, {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      minX,
      maxX,
      minY,
      maxY
    });

    if (entity.status === "warning") {
      ctx.save();
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = "rgba(255, 207, 122, 0.92)";
      ctx.lineWidth = 2;
      ctx.strokeRect(minX - 7, minY - 7, maxX - minX + 14, maxY - minY + 14);
      ctx.restore();
    }
  }

  function drawGround() {
    const rect = frame.getBoundingClientRect();
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 1) {
      const a = projection({ x: -6, y: i, z: -0.65 });
      const b = projection({ x: 6, y: i, z: -0.65 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const c = projection({ x: i, y: -3, z: -0.65 });
      const d = projection({ x: i, y: 3, z: -0.65 });
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    const horizon = ctx.createLinearGradient(0, rect.height * 0.15, 0, rect.height);
    horizon.addColorStop(0, "rgba(255,255,255,0.08)");
    horizon.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.restore();
  }

  function drawLoadArrows() {
    if (!state.layers.loads || state.zoom < 1.1) return;
    const anchors = [
      projection({ x: -3.4, y: -0.7, z: 3.2 }),
      projection({ x: -1.2, y: 0.15, z: 3.25 }),
      projection({ x: 1.2, y: -0.15, z: 3.25 }),
      projection({ x: 3.4, y: 0.7, z: 3.2 })
    ];
    ctx.save();
    anchors.forEach((anchor, index) => {
      const length = 36 + (index % 2) * 12;
      ctx.strokeStyle = index === 1 ? "rgba(212,147,54,0.92)" : "rgba(97,180,165,0.82)";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y - length);
      ctx.lineTo(anchor.x, anchor.y - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(anchor.x - 5, anchor.y - 9);
      ctx.lineTo(anchor.x + 5, anchor.y - 9);
      ctx.lineTo(anchor.x, anchor.y);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawCalculationGraph() {
    if (!state.layers.calculations || state.zoom < 2.76) return;
    const selected = selectedEntity();
    const bounds = state.screenBounds.get(selected.id) || state.screenBounds.get("girder-v14");
    if (!bounds || selected.id === "project") return;
    const nodes = selected.chain.slice(0, 5).map((item, index) => ({
      name: item[0],
      detail: item[1],
      x: bounds.x + (index - 2) * 92 * Math.min(state.zoom, 3.8) / 3,
      y: bounds.y - 145 - Math.sin(index * 0.8) * 22
    }));

    ctx.save();
    ctx.strokeStyle = "rgba(112, 218, 197, 0.72)";
    ctx.lineWidth = 2;
    for (let i = 0; i < nodes.length - 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y);
      ctx.stroke();
    }
    nodes.forEach((node, index) => {
      ctx.beginPath();
      ctx.arc(node.x, node.y, index === 3 ? 19 : 15, 0, Math.PI * 2);
      ctx.fillStyle = index === 3 ? "rgba(212,147,54,0.94)" : "rgba(61,150,138,0.94)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.82)";
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawReportLinks() {
    if (!state.layers.report || state.zoom < 3.78) return;
    const selected = selectedEntity();
    const bounds = state.screenBounds.get(selected.id);
    if (!bounds || selected.id === "project") return;
    const doc = { x: bounds.x + 250, y: bounds.y - 48 };
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(255, 238, 180, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bounds.x + 20, bounds.y - 12);
    ctx.lineTo(doc.x, doc.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(255,255,255,0.52)";
    roundRect(doc.x - 36, doc.y - 48, 72, 96, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#3e5752";
    ctx.fillRect(doc.x - 23, doc.y - 25, 46, 5);
    ctx.fillRect(doc.x - 23, doc.y - 10, 38, 5);
    ctx.fillRect(doc.x - 23, doc.y + 5, 46, 5);
    ctx.restore();
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function render() {
    const rect = frame.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.screenBounds.clear();

    drawGround();
    if (state.layers.geometry) {
      entities
        .slice()
        .sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z))
        .forEach(drawBox);
    }
    drawLoadArrows();
    drawCalculationGraph();
    drawReportLinks();
    renderLabels();
    updateHud();
  }

  function labelHtml(entity, mode) {
    if (mode.key === "global") {
      if (entity.id === "deck") return ["Superestructura", "4 elementos, 1 advertencia"];
      if (entity.id === "pier-p3") return ["Infraestructura", "pila + fundaciones OK"];
      if (entity.id === "abutment-e2") return ["Extremos", "apoyos y empujes OK"];
      return null;
    }
    if (mode.key === "systems") {
      return [entity.name, entity.kind === "element" ? "miembro longitudinal" : "sistema fisico"];
    }
    if (mode.key === "element") {
      const util = entity.metrics[0] ? entity.metrics[0][1] : "OK";
      return [entity.name, entity.metrics[0][0] + " " + util];
    }
    if (mode.key === "calculation") {
      return [entity.short, entity.chain[entity.chain.length - 2][1]];
    }
    return [entity.short, entity.report];
  }

  function renderLabels() {
    const mode = currentDepth();
    labelLayer.innerHTML = "";
    lensLayer.innerHTML = "";
    const visible = entities.filter((entity) => {
      if (mode.key === "global") return ["deck", "pier-p3", "abutment-e2"].includes(entity.id);
      if (mode.key === "systems") return entity.kind === "system" || entity.id.startsWith("girder");
      if (mode.key === "element") return entity.id === state.selectedId || entity.kind === "element";
      return entity.id === state.selectedId;
    });

    visible.forEach((entity) => {
      const bounds = state.screenBounds.get(entity.id);
      const copy = labelHtml(entity, mode);
      if (!bounds || !copy) return;
      const label = document.createElement("div");
      label.className = "scene-label" + (entity.status === "warning" ? " warning" : "") + (mode.key === "global" ? " micro" : "");
      label.style.left = bounds.x + "px";
      label.style.top = (bounds.minY - 10) + "px";
      label.innerHTML = "<strong>" + copy[0] + "</strong><span>" + copy[1] + "</span>";
      labelLayer.appendChild(label);
    });

    if (mode.key === "calculation" && state.layers.calculations) {
      renderCalculationLabels();
    }
    if (mode.key === "evidence") {
      renderEvidenceLabels();
    }
  }

  function renderCalculationLabels() {
    const selected = selectedEntity();
    const bounds = state.screenBounds.get(selected.id);
    if (!bounds || selected.id === "project") return;
    selected.chain.slice(0, 5).forEach((item, index) => {
      const label = document.createElement("div");
      label.className = "calc-node-label";
      label.style.left = bounds.x + (index - 2) * 92 * Math.min(state.zoom, 3.8) / 3 + "px";
      label.style.top = bounds.y - 205 - Math.sin(index * 0.8) * 22 + "px";
      label.innerHTML = "<strong>" + item[0] + "</strong><span>" + item[1] + "</span>";
      lensLayer.appendChild(label);
    });
  }

  function renderEvidenceLabels() {
    const selected = selectedEntity();
    const bounds = state.screenBounds.get(selected.id);
    if (!bounds || selected.id === "project") return;
    const items = [];
    if (state.layers.code) {
      items.push({
        title: "Python exacto",
        code: selected.chain[Math.max(0, selected.chain.length - 2)][1] + "\n" + selected.code.split("\n").slice(0, 2).join("\n"),
        x: bounds.x - 280,
        y: bounds.y - 130
      });
    }
    if (state.layers.report) {
      items.push({
        title: "DOCX vinculado",
        code: selected.report + "\ncaption_id: SEQ Tabla\nsource_ref: " + selected.id,
        x: bounds.x + 150,
        y: bounds.y - 165
      });
    }
    items.forEach((item) => {
      const note = document.createElement("div");
      note.className = "evidence-note";
      note.style.left = item.x + "px";
      note.style.top = item.y + "px";
      note.innerHTML = "<strong>" + item.title + "</strong><code>" + item.code + "</code>";
      lensLayer.appendChild(note);
    });
  }

  function updateHud() {
    const mode = currentDepth();
    zoomLabel.textContent = state.zoom.toFixed(2) + "x";
    viewModeLabel.textContent = mode.label;
    depthTitle.textContent = mode.title;
    breadcrumb.textContent = selectedEntity().breadcrumb;
    zoomSlider.value = Math.round(state.zoom * 100);

    document.querySelectorAll(".mode-button").forEach((button) => {
      const target = parseFloat(button.dataset.zoomTarget);
      button.classList.toggle("active", Math.abs(target - state.zoom) < 0.34);
    });
    document.querySelectorAll(".ladder-step").forEach((step) => {
      step.classList.toggle("active", step.dataset.step === mode.key);
    });
    updateMiniFocus();
  }

  function updateMiniFocus() {
    const selected = selectedEntity();
    const map = {
      project: [44, 23],
      deck: [24, 24],
      "girder-v14": [44, 24],
      "girder-v15": [50, 31],
      "abutment-e2": [78, 27],
      "foundation-f3": [48, 48],
      "pier-p3": [48, 36]
    };
    const point = map[selected.id] || map.project;
    miniFocus.style.left = point[0] + "px";
    miniFocus.style.top = point[1] + "px";
  }

  function updateInspector() {
    const entity = selectedEntity();
    selectedTitle.textContent = entity.name;
    selectedStatus.textContent = entity.status === "warning" ? "Warning" : "OK";
    selectedStatus.className = "status-pill " + (entity.status === "warning" ? "status-warning" : "status-running");
    metricGrid.innerHTML = entity.metrics.map((metric) => (
      '<div class="metric-tile"><span>' + metric[0] + '</span><strong>' + metric[1] + '</strong></div>'
    )).join("");
    calcChain.innerHTML = entity.chain.map((step) => (
      "<li><div><strong>" + step[0] + "</strong><span>" + step[1] + "</span></div></li>"
    )).join("");
    codeSnippet.textContent = entity.code;
    evidenceChip.textContent = entity.report.includes("DOCX") ? "DOCX" : "Trace";

    document.querySelectorAll(".tree-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.select === entity.id);
    });
  }

  function focusSelectedEntity() {
    const entity = selectedEntity();
    const rect = frame.getBoundingClientRect();
    if (entity.id === "project") {
      state.panX = 20;
      state.panY = 2;
      return;
    }
    const scale = 31 * state.zoom;
    const center = {
      x: entity.x + entity.w / 2,
      y: entity.y + entity.d / 2,
      z: entity.z + entity.h / 2
    };
    const isoX = (center.x - center.y) * 0.86;
    const isoY = (center.x + center.y) * 0.43 - center.z * 0.92;
    state.panX = rect.width * 0.48 - rect.width * 0.5 - isoX * scale;
    state.panY = rect.height * 0.52 - rect.height * 0.57 - isoY * scale;
  }

  function setSelected(id, focus) {
    if (!allEntities.some((entity) => entity.id === id)) return;
    state.selectedId = id;
    if (focus) focusSelectedEntity();
    updateInspector();
    render();
  }

  function zoomTo(value, focus) {
    state.zoom = Math.max(0.6, Math.min(4.7, value));
    if (focus !== false) focusSelectedEntity();
    render();
  }

  function hitTest(x, y) {
    const hits = entities.filter((entity) => {
      const bounds = state.screenBounds.get(entity.id);
      if (!bounds) return false;
      return x >= bounds.minX - 8 && x <= bounds.maxX + 8 && y >= bounds.minY - 8 && y <= bounds.maxY + 8;
    });
    hits.sort((a, b) => {
      const ab = state.screenBounds.get(a.id);
      const bb = state.screenBounds.get(b.id);
      const da = Math.hypot(x - ab.x, y - ab.y);
      const db = Math.hypot(x - bb.x, y - bb.y);
      return da - db;
    });
    return hits[0] || null;
  }

  function framePoint(event) {
    const rect = frame.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function addAgentMessage(role, text) {
    const message = document.createElement("div");
    message.className = "agent-message " + role;
    message.textContent = text;
    agentLog.appendChild(message);
    agentLog.scrollTop = agentLog.scrollHeight;
  }

  function agentAnswer(text) {
    const lower = text.toLowerCase();
    if (lower.includes("v-14") || lower.includes("flexion") || lower.includes("uls")) {
      setSelected("girder-v14", true);
      zoomTo(3.25);
      return "V-14 controla por flexion en ULS-03. La cadena visible une carga de carril, combinacion y check_flexure(); el reporte apunta a capitulo 4.2 tabla 7.";
    }
    if (lower.includes("docx") || lower.includes("word")) {
      zoomTo(4.25);
      return "La evidencia DOCX queda enlazada desde cada entidad: tabla, ecuacion, caption y source_ref. En una implementacion real lo generaria un servicio .NET OpenXML.";
    }
    if (lower.includes("pilote") || lower.includes("fundacion")) {
      setSelected("foundation-f3", true);
      zoomTo(2.2);
      return "F-03 combina reacciones de pila, perfil de suelo y capacidad axial. La vista de elemento muestra axial 0.63, lateral 0.58 y asiento 11 mm.";
    }
    return "Puedo navegar la escena, seleccionar entidades y elevar el nivel de detalle. En el producto real esta consulta viajaria por MCP con contexto del nodo seleccionado.";
  }

  function bindEvents() {
    window.addEventListener("resize", resizeCanvas);

    frame.addEventListener("wheel", (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      zoomTo(state.zoom * (1 + direction * 0.09), false);
    }, { passive: false });

    frame.addEventListener("pointerdown", (event) => {
      const point = framePoint(event);
      const hit = hitTest(point.x, point.y);
      if (hit) {
        setSelected(hit.id, false);
        return;
      }
      state.dragging = true;
      state.dragStart = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      frame.setPointerCapture(event.pointerId);
    });

    frame.addEventListener("pointermove", (event) => {
      const point = framePoint(event);
      if (state.dragging && state.dragStart) {
        state.panX = state.dragStart.panX + event.clientX - state.dragStart.x;
        state.panY = state.dragStart.panY + event.clientY - state.dragStart.y;
        render();
        return;
      }
      const hit = hitTest(point.x, point.y);
      const nextHover = hit ? hit.id : null;
      if (nextHover !== state.hoverId) {
        state.hoverId = nextHover;
        render();
      }
    });

    frame.addEventListener("pointerup", (event) => {
      state.dragging = false;
      state.dragStart = null;
      if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    });

    zoomSlider.addEventListener("input", (event) => {
      zoomTo(Number(event.target.value) / 100);
    });

    document.getElementById("zoomOutButton").addEventListener("click", () => zoomTo(state.zoom - 0.28));
    document.getElementById("zoomInButton").addEventListener("click", () => zoomTo(state.zoom + 0.28));
    document.getElementById("resetViewButton").addEventListener("click", () => {
      state.panX = 20;
      state.panY = 2;
      zoomTo(0.78, false);
    });
    document.getElementById("runTraceButton").addEventListener("click", () => {
      setSelected("girder-v14", true);
      zoomTo(3.25);
      addAgentMessage("assistant", "Traza activa: cargas -> ULS-03 -> flexion -> DOCX.");
    });
    document.getElementById("docxTraceButton").addEventListener("click", () => {
      zoomTo(4.25);
      addAgentMessage("assistant", "Evidencia DOCX visible para " + selectedEntity().name + ".");
    });
    document.getElementById("agentPingButton").addEventListener("click", () => {
      addAgentMessage("assistant", "Agente MCP simulado conectado al nodo " + selectedEntity().name + ".");
    });

    document.querySelectorAll("[data-zoom-target]").forEach((button) => {
      button.addEventListener("click", () => zoomTo(parseFloat(button.dataset.zoomTarget)));
    });

    document.querySelectorAll("[data-select]").forEach((button) => {
      button.addEventListener("click", () => setSelected(button.dataset.select, true));
    });

    document.querySelectorAll("[data-layer]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        state.layers[checkbox.dataset.layer] = checkbox.checked;
        render();
      });
    });

    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scenario = button.dataset.scenario;
        document.querySelectorAll("[data-scenario]").forEach((item) => item.classList.toggle("selected", item === button));
        addAgentMessage("assistant", "Escenario activo: " + button.querySelector("strong").textContent + ".");
      });
    });

    agentForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = agentInput.value.trim();
      if (!text) return;
      agentInput.value = "";
      addAgentMessage("user", text);
      window.setTimeout(() => addAgentMessage("assistant", agentAnswer(text)), 220);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const query = searchInput.value.toLowerCase();
      const found = allEntities.find((entity) => (
        entity.name.toLowerCase().includes(query) ||
        entity.short.toLowerCase().includes(query) ||
        entity.chain.some((step) => step.join(" ").toLowerCase().includes(query))
      ));
      if (found) {
        setSelected(found.id, true);
        zoomTo(query.includes("docx") ? 4.25 : 2.2);
      }
    });
  }

  bindEvents();
  updateInspector();
  resizeCanvas();
}());

const SVG_NS = "http://www.w3.org/2000/svg";

const CHANNELS = 3;
const CHANNEL_W = 7;
const DIVIDER_W = 2.5;
const WALL_W = 1.25;
const LENGTH = 100;
const LABEL_BAND = 2;
const BODY_LEN = 1;
const TOP_LEN = 2;
const OVERHANG = (TOP_LEN - BODY_LEN) / 2;

const totalW = WALL_W * 2 + CHANNELS * CHANNEL_W + (CHANNELS - 1) * DIVIDER_W;
const MM = 10;
const CORE_COLORS = ["#8d6e63", "#6d8b74", "#7a8494", "#a6845a", "#6f7f8c"];

/** Intervalo informado. A posição física é derivada da recuperação acumulada. */
/** @type {{ id: string, avancoMm: number, recuperacaoMm: number, info: string }[]} */
let taquinhos = [];
/** @type {null | { depthUm: number, tapeUm: number, physicalUm: number, intervalIndex: number }} */
let consulta = null;

const PAD_L = 3.6;
const PAD_R = 3.8;
const PAD_T = 0.35;
const PAD_B = 1.4;

const BOX_GAP = 8;

const layout = {
  boxes: /** @type {{ ox: number, y0: number, channelX: number[] }[]} */ ([]),
};

function parseMetersToMm(raw) {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (text === "") return { ok: false, reason: "empty" };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, reason: "invalid" };
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 3 || whole.length > 7) return { ok: false, reason: "precision" };
  const mm = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  if (!Number.isSafeInteger(mm)) return { ok: false, reason: "invalid" };
  return { ok: true, mm };
}

function formatMeters(mm) {
  const whole = Math.floor(Math.abs(mm) / 1000);
  const frac = String(Math.abs(mm) % 1000).padStart(3, "0");
  const digits = mm % 10 === 0 ? frac.slice(0, 2) : frac;
  return `${whole},${digits} m`;
}

function formatCmFromMm(mm) {
  if (mm % 10 === 0) return `${mm / 10} cm`;
  return `${(mm / 10).toFixed(1)} cm`;
}

/** Medida de testemunho para o múltiplo de 5 cm: 0–2 desce, 3–4 sobe, 5–7 fica, 8–9 sobe. */
function roundCoreMm(mm) {
  const cm = Math.floor(mm / MM);
  const ones = cm % 10;
  const base = cm - ones;
  let roundedCm = base;
  if (ones <= 2) roundedCm = base;
  else if (ones <= 7) roundedCm = base + 5;
  else roundedCm = base + 10;
  return roundedCm * MM;
}

function formatMetersUm(um) {
  const abs = Math.abs(Math.round(um));
  const whole = Math.floor(abs / 1000000);
  const padded = String(abs % 1000000).padStart(6, "0");
  let frac = padded.replace(/0+$/, "");
  if (frac.length < 2) frac = padded.slice(0, 2);
  return `${whole},${frac} m`;
}

function formatCmUm(um) {
  const abs = Math.abs(Math.round(um));
  const cm = Math.floor(abs / 10000);
  const rest = String(abs % 10000).padStart(4, "0");
  const frac = rest.replace(/0+$/, "");
  return frac ? `${cm},${frac} cm` : `${cm} cm`;
}

function findIntervalAtDepth(intervals, depthMm) {
  for (let i = 0; i < intervals.length; i++) {
    const interval = intervals[i];
    const last = i === intervals.length - 1;
    const inside =
      depthMm >= interval.profundidadeInicialMm &&
      (depthMm < interval.profundidadeFinalMm ||
        (last && depthMm === interval.profundidadeFinalMm));
    if (inside) return interval;
  }
  return null;
}

function tapeUmFromDepth(interval, depthMm) {
  const offsetMm = depthMm - interval.profundidadeInicialMm;
  if (interval.avancoMm <= 0 || offsetMm < 0) return null;
  const numerator = interval.recuperacaoMm * offsetMm * 1000;
  const denominator = interval.avancoMm;
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function depthUmFromTape(interval, tapeUm) {
  if (interval.recuperacaoMm <= 0 || tapeUm < 0) return null;
  const numerator = interval.avancoMm * tapeUm;
  const denominator = interval.recuperacaoMm;
  const extraUm = Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
  return interval.profundidadeInicialMm * 1000 + extraUm;
}

function accumulateIntervals(items) {
  let advanceMm = 0;
  let recoveryMm = 0;
  return items.map((item, index) => {
    const placed = {
      ...item,
      index,
      profundidadeInicialMm: advanceMm,
      profundidadeFinalMm: advanceMm + item.avancoMm,
      recuperacaoInicialMm: recoveryMm,
      recuperacaoFinalMm: recoveryMm + item.recuperacaoMm,
    };
    advanceMm = placed.profundidadeFinalMm;
    recoveryMm = placed.recuperacaoFinalMm;
    return placed;
  });
}

function recoverySegments(startMm, endMm) {
  const lengthMm = LENGTH * MM;
  const segments = [];
  let cursor = startMm;
  while (cursor < endMm) {
    const channelIndex = Math.floor(cursor / lengthMm);
    const channelEnd = (channelIndex + 1) * lengthMm;
    const segEnd = Math.min(endMm, channelEnd);
    segments.push({
      channelIndex,
      box: Math.floor(channelIndex / CHANNELS),
      channel: channelIndex % CHANNELS,
      localStartMm: cursor - channelIndex * lengthMm,
      localEndMm: segEnd - channelIndex * lengthMm,
      lengthMm: segEnd - cursor,
    });
    cursor = segEnd;
  }
  return segments;
}

function placement(depthMm) {
  const lengthMm = LENGTH * MM;
  const topMm = TOP_LEN * MM;
  let chosen = null;
  const limit = Math.max(4, Math.floor(depthMm / lengthMm) + 3);
  for (let channelIndex = 0; channelIndex < limit && !chosen; channelIndex++) {
    const origin = channelIndex * lengthMm;
    for (let local = 1; local <= 97; local += 2) {
      const start = origin + local * MM;
      const end = start + topMm;
      const beforeSlot = depthMm < start;
      const insideSlot = depthMm >= start && depthMm < end;
      if (beforeSlot || insideSlot) {
        chosen = { start, end, channelIndex };
        break;
      }
    }
  }
  if (!chosen) chosen = { start: MM, end: MM + topMm, channelIndex: 0 };

  const box = Math.floor(chosen.channelIndex / CHANNELS);
  const channel = chosen.channelIndex % CHANNELS;
  return {
    box,
    channel,
    slotStart: chosen.channelIndex * LENGTH,
    topStart: chosen.start / MM,
    topEnd: chosen.end / MM,
    bodyStart: chosen.start / MM + OVERHANG,
    bodyEnd: chosen.end / MM - OVERHANG,
    shifted: !(depthMm >= chosen.start && depthMm < chosen.end),
  };
}

function currentIntervals() {
  return accumulateIntervals(taquinhos);
}

function boxCount() {
  let maxBox = 0;
  for (const interval of currentIntervals()) {
    if (interval.recuperacaoMm <= 0) continue;
    maxBox = Math.max(maxBox, placement(interval.recuperacaoFinalMm).box);
  }
  return maxBox + 1;
}

function boxOrigin(index) {
  return PAD_L + index * (totalW + BOX_GAP);
}

function xu(cm) {
  return cm;
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  return node;
}

function frisoCms() {
  const marks = [0, 1];
  for (let cm = 3; cm <= LENGTH - 1; cm += 2) marks.push(cm);
  marks.push(LENGTH);
  return marks;
}

function addFrisos(group, xEdge, y0, direction) {
  const len = 0.28;
  for (const cm of frisoCms()) {
    const y = y0 + cm;
    group.appendChild(
      el("line", {
        x1: xEdge,
        y1: y,
        x2: xEdge + direction * len,
        y2: y,
        stroke: "#c4c4c4",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
  }
}

function drawCmGrid(group, x, y, w) {
  const g = el("g", {
    class: "cm-grid",
    "shape-rendering": "crispEdges",
  });

  for (let i = 1; i < CHANNEL_W; i++) {
    g.appendChild(
      el("line", {
        x1: x + xu(i),
        y1: y,
        x2: x + xu(i),
        y2: y + LENGTH,
        stroke: "#3a3a3a",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
  }

  for (let cm = 0; cm <= LENGTH; cm++) {
    const major = cm % 10 === 0;
    const mid = cm % 5 === 0;
    g.appendChild(
      el("line", {
        x1: x,
        y1: y + cm,
        x2: x + w,
        y2: y + cm,
        stroke: major ? "#6e6e6e" : mid ? "#4a4a4a" : "#333333",
        "stroke-width": major ? 1.25 : 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
  }

  group.appendChild(g);
}

function addSideCmTicks(group, xEdge, y0, direction) {
  const minor = 0.22;
  const major = 0.4;
  for (let cm = 0; cm <= LENGTH; cm++) {
    const y = y0 + cm;
    const len = cm % 10 === 0 ? major : minor;
    group.appendChild(
      el("line", {
        x1: xEdge,
        y1: y,
        x2: xEdge + direction * len,
        y2: y,
        stroke: "#8eb8d4",
        "stroke-width": cm % 10 === 0 ? 1.4 : 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    if (cm % 10 === 0) {
      const label = el("text", {
        x: xEdge + direction * (major + 0.2),
        y: y + 0.32,
        "text-anchor": direction < 0 ? "end" : "start",
        fill: "#b7d4ea",
        "font-size": 0.85,
        "font-family": "Segoe UI, system-ui, sans-serif",
      });
      label.textContent = String(cm);
      group.appendChild(label);
    }
  }
}

function drawBox(parent, boxIndex) {
  const ox = boxOrigin(boxIndex);
  const y0 = PAD_T + LABEL_BAND;
  const channelX = [];
  const shell = el("g", { class: "tray-top" });

  shell.appendChild(
    el("rect", {
      x: ox,
      y: PAD_T,
      width: xu(totalW),
      height: LENGTH + LABEL_BAND,
      rx: 0.25,
      fill: "#1c1c1c",
      stroke: "#f2f2f2",
      "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
    }),
  );

  const title = el("text", {
    x: ox + 0.4,
    y: PAD_T + 1.35,
    fill: "#f2f2f2",
    "font-size": 1.05,
    "font-weight": "600",
    "font-family": "Segoe UI, system-ui, sans-serif",
  });
  title.textContent = `Caixa ${boxIndex + 1}`;
  shell.appendChild(title);

  let x = ox + xu(WALL_W);

  for (let i = 0; i < CHANNELS; i++) {
    channelX[i] = x;

    shell.appendChild(
      el("rect", {
        x,
        y: y0,
        width: xu(CHANNEL_W),
        height: LENGTH,
        fill: "#0a0a0a",
      }),
    );
    drawCmGrid(shell, x, y0, xu(CHANNEL_W));
    addFrisos(shell, x, y0, 1);
    addFrisos(shell, x + xu(CHANNEL_W), y0, -1);

    const slotStart = (boxIndex * CHANNELS + i) * LENGTH;
    const range = el("text", {
      x: x + xu(CHANNEL_W) / 2,
      y: y0 + 3.4,
      "text-anchor": "middle",
      fill: "#d0d0d0",
      "font-size": 0.95,
      "font-family": "Segoe UI, system-ui, sans-serif",
    });
    range.textContent = `${i + 1} · ${slotStart}–${slotStart + LENGTH}`;
    shell.appendChild(range);

    x += xu(CHANNEL_W);

    if (i < CHANNELS - 1) {
      shell.appendChild(
        el("rect", {
          x,
          y: y0,
          width: xu(DIVIDER_W),
          height: LENGTH,
          fill: "#2a2a2a",
          stroke: "#777",
          "stroke-width": 1,
          "vector-effect": "non-scaling-stroke",
        }),
      );
      x += xu(DIVIDER_W);
    }
  }

  addSideCmTicks(shell, ox, y0, -1);
  addSideCmTicks(shell, ox + xu(totalW), y0, 1);

  parent.appendChild(shell);
  layout.boxes[boxIndex] = { ox, y0, channelX };
}

function buildTopView() {
  const root = document.getElementById("tray-root");
  const svg = document.getElementById("tray-svg");
  if (!root || !svg) return;
  root.replaceChildren();
  layout.boxes = [];

  const count = boxCount();
  for (let i = 0; i < count; i++) drawBox(root, i);

  applyCamera();
}

function renderCores(intervals) {
  const root = document.getElementById("cores-root");
  if (!root) return;
  root.replaceChildren();

  intervals.forEach((interval, index) => {
    if (interval.recuperacaoMm <= 0) return;
    const fill = CORE_COLORS[index % CORE_COLORS.length];
    for (const seg of recoverySegments(interval.recuperacaoInicialMm, interval.recuperacaoFinalMm)) {
      const box = layout.boxes[seg.box];
      if (!box) continue;
      const x = box.channelX[seg.channel];
      if (x == null) continue;
      const height = seg.lengthMm / MM;
      if (height <= 0) continue;
      root.appendChild(
        el("rect", {
          class: "core",
          "data-id": interval.id,
          "data-length-mm": seg.lengthMm,
          x,
          y: box.y0 + seg.localStartMm / MM,
          width: xu(CHANNEL_W),
          height,
          fill,
          opacity: 0.42,
        }),
      );
    }
  });
}

function renderTaquinhos(intervals) {
  const root = document.getElementById("taquinhos-root");
  if (!root) return;
  root.replaceChildren();

  const yBoxes = layout.boxes;

  for (const t of intervals) {
    if (t.recuperacaoMm <= 0) continue;
    const place = placement(t.recuperacaoFinalMm);
    const box = yBoxes[place.box];
    if (!box) continue;
    const left = box.channelX[place.channel];
    if (left == null) continue;
    const cx = left;
    const localTop = place.topStart - place.slotStart;
    const localBody = place.bodyStart - place.slotStart;
    const topY = box.y0 + localTop;
    const bodyY = box.y0 + localBody;

    const g = el("g", { class: "taquinho", "data-id": t.id });

    g.appendChild(
      el("rect", {
        x: cx,
        y: topY,
        width: xu(CHANNEL_W),
        height: TOP_LEN,
        fill: "#f6d36b",
        stroke: "#a16207",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
        rx: 0.08,
      }),
    );

    g.appendChild(
      el("rect", {
        x: cx,
        y: bodyY,
        width: xu(CHANNEL_W),
        height: BODY_LEN,
        fill: "#c2410c",
        stroke: "#7c2d12",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );

    g.appendChild(
      el("line", {
        x1: cx,
        y1: topY + TOP_LEN / 2,
        x2: cx + xu(CHANNEL_W),
        y2: topY + TOP_LEN / 2,
        stroke: "#451a03",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );

    const label = el("text", {
      x: cx + xu(CHANNEL_W) + 0.2,
      y: topY + TOP_LEN / 2 + 0.3,
      fill: "#f6d36b",
      "font-size": 0.7,
      "font-family": "Segoe UI, system-ui, sans-serif",
    });
    const depthLabel = formatMeters(t.profundidadeFinalMm);
    label.textContent = t.info ? `${depthLabel} ${truncate(t.info, 12)}` : depthLabel;
    g.appendChild(label);

    root.appendChild(g);
  }
}

function truncate(s, max) {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatCm(n) {
  return Number.isInteger(n) ? `${n} cm` : `${n.toFixed(1)} cm`;
}

function renderList(intervals) {
  const list = document.getElementById("taquinho-list");
  const empty = document.getElementById("list-empty");
  const summary = document.getElementById("accum-summary");
  if (!list || !empty) return;

  list.replaceChildren();

  for (const t of intervals) {
    const li = document.createElement("li");
    const hasCore = t.recuperacaoMm > 0;
    if (!hasCore) li.classList.add("is-empty-recovery");
    const place = hasCore ? placement(t.recuperacaoFinalMm) : null;
    const where = place
      ? `Caixa ${place.box + 1} · canaleta ${place.channel + 1}`
      : "Sem ocupação na caixa";
    li.innerHTML = `
      <div>
        <strong>Taquinho ${t.index + 1} · ${where}</strong>
        <span class="meta">avanço ${formatMeters(t.avancoMm)} · recuperação ${formatMeters(t.recuperacaoMm)}</span>
        <span class="meta">profundidade ${formatMeters(t.profundidadeInicialMm)}–${formatMeters(t.profundidadeFinalMm)}</span>
        <span class="meta">recuperação acumulada ${formatMeters(t.recuperacaoInicialMm)}–${formatMeters(t.recuperacaoFinalMm)}</span>
        ${
          place
            ? `<span class="meta">fim do testemunho ${formatCmFromMm(t.recuperacaoFinalMm)} → friso ${formatCm(place.topStart)}–${formatCm(place.topEnd)}</span>`
            : ""
        }
        ${place?.shifted ? `<span class="meta">não cabe no vão de 1 cm; entra no próximo friso de 2 cm</span>` : ""}
        ${t.info ? `<span class="meta">${escapeHtml(t.info)}</span>` : ""}
      </div>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-remove";
    btn.textContent = "Remover";
    btn.addEventListener("click", () => {
      taquinhos = taquinhos.filter((x) => x.id !== t.id);
      clearConsulta();
      showNote("");
      renderAll();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }

  empty.hidden = intervals.length > 0;
  if (summary) {
    const last = intervals[intervals.length - 1];
    if (!last) {
      summary.hidden = true;
      summary.textContent = "";
    } else {
      summary.hidden = false;
      summary.textContent = `Avanço acumulado ${formatMeters(last.profundidadeFinalMm)} · Recuperação acumulada ${formatMeters(last.recuperacaoFinalMm)}`;
    }
  }
}

function renderIntervalOptions(intervals) {
  const select = document.querySelector("#inverse-form select[name=intervalo]");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  if (intervals.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhum intervalo";
    select.appendChild(option);
    return;
  }
  for (const interval of intervals) {
    const option = document.createElement("option");
    option.value = String(interval.index);
    option.textContent = `Taquinho ${interval.index + 1} · ${formatMeters(interval.profundidadeInicialMm)}–${formatMeters(interval.profundidadeFinalMm)}`;
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function physicalPlace(physicalUm) {
  const lengthUm = LENGTH * MM * 1000;
  const channelIndex = Math.floor(physicalUm / lengthUm);
  const localUm = physicalUm - channelIndex * lengthUm;
  return {
    box: Math.floor(channelIndex / CHANNELS),
    channel: channelIndex % CHANNELS,
    localUm,
  };
}

function renderConsulta() {
  const root = document.getElementById("marks-root");
  if (!root) return;
  root.replaceChildren();
  if (!consulta) return;
  const place = physicalPlace(consulta.physicalUm);
  const box = layout.boxes[place.box];
  if (!box) return;
  const x = box.channelX[place.channel];
  if (x == null) return;
  const y = box.y0 + place.localUm / 10000;

  const mark = el("g", { class: "depth-mark" });
  mark.appendChild(
    el("line", {
      x1: x,
      y1: y,
      x2: x + xu(CHANNEL_W),
      y2: y,
      stroke: "#7dd3fc",
      "stroke-width": 1.6,
      "vector-effect": "non-scaling-stroke",
    }),
  );
  const label = el("text", {
    x: x + xu(CHANNEL_W) + 0.15,
    y: y - 0.2,
    fill: "#7dd3fc",
    "font-size": 0.65,
    "font-family": "Segoe UI, system-ui, sans-serif",
  });
  label.textContent = formatMetersUm(consulta.depthUm);
  mark.appendChild(label);
  root.appendChild(mark);
}

function renderAll() {
  const intervals = currentIntervals();
  renderList(intervals);
  renderIntervalOptions(intervals);
  buildTopView();
  renderCores(intervals);
  renderTaquinhos(intervals);
  renderConsulta();
}

function clearConsulta() {
  consulta = null;
  for (const id of ["locate-result", "inverse-result"]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.hidden = true;
    node.textContent = "";
    node.classList.remove("is-error");
  }
}

function showCalcResult(id, message, isError) {
  const node = document.getElementById(id);
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(msg) {
  const elErr = document.getElementById("form-error");
  if (!elErr) return;
  if (msg) {
    elErr.textContent = msg;
    elErr.hidden = false;
  } else {
    elErr.hidden = true;
    elErr.textContent = "";
  }
}

function showNote(msg) {
  const note = document.getElementById("form-note");
  if (!note) return;
  if (msg) {
    note.textContent = msg;
    note.hidden = false;
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function bindForm() {
  const form = document.getElementById("taquinho-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    showError("");
    showNote("");

    const data = new FormData(form);
    const info = String(data.get("info") || "").trim();
    const avanco = parseMetersToMm(data.get("avanco"));
    const recuperacao = parseMetersToMm(data.get("recuperacao"));

    if (!avanco.ok || avanco.mm <= 0) {
      showError(
        avanco.reason === "precision"
          ? "Use no máximo 3 casas decimais no avanço."
          : "Informe o avanço em metros, maior que zero.",
      );
      return;
    }
    if (!recuperacao.ok || recuperacao.mm < 0) {
      showError(
        recuperacao.reason === "precision"
          ? "Use no máximo 3 casas decimais na recuperação."
          : "Informe a recuperação em metros, a partir de zero.",
      );
      return;
    }

    const registeredRecovery = roundCoreMm(recuperacao.mm);
    taquinhos.push({
      id: crypto.randomUUID(),
      avancoMm: avanco.mm,
      recuperacaoMm: registeredRecovery,
      info,
    });

    clearConsulta();
    showNote(
      registeredRecovery === recuperacao.mm
        ? ""
        : `Recuperação registrada como ${formatMeters(registeredRecovery)} (ajuste para múltiplo de 5 cm).`,
    );
    renderAll();
    form.avanco.value = "";
    form.recuperacao.value = "";
    form.info.value = "";
    form.avanco.focus();
  });
}

function bindLocate() {
  const form = document.getElementById("locate-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseMetersToMm(new FormData(form).get("profundidade"));
    if (!parsed.ok) {
      consulta = null;
      renderConsulta();
      showCalcResult(
        "locate-result",
        parsed.reason === "precision"
          ? "Use no máximo 3 casas decimais na profundidade."
          : "Informe a profundidade em metros.",
        true,
      );
      return;
    }

    const intervals = currentIntervals();
    const interval = findIntervalAtDepth(intervals, parsed.mm);
    if (!interval) {
      consulta = null;
      renderConsulta();
      showCalcResult("locate-result", "Essa profundidade não está em nenhum intervalo informado.", true);
      return;
    }
    if (interval.recuperacaoMm === 0) {
      consulta = null;
      renderConsulta();
      showCalcResult(
        "locate-result",
        `O taquinho ${interval.index + 1} não tem testemunho recuperado, então não há onde medir na trena.`,
        true,
      );
      return;
    }

    const tapeUm = tapeUmFromDepth(interval, parsed.mm);
    const physicalUm = interval.recuperacaoInicialMm * 1000 + tapeUm;
    consulta = {
      depthUm: parsed.mm * 1000,
      tapeUm,
      physicalUm,
      intervalIndex: interval.index,
    };
    const place = physicalPlace(physicalUm);
    showCalcResult(
      "locate-result",
      `No taquinho ${interval.index + 1} (${formatMeters(interval.profundidadeInicialMm)}–${formatMeters(interval.profundidadeFinalMm)}), a profundidade ${formatMeters(parsed.mm)} fica a ${formatMetersUm(tapeUm)} (${formatCmUm(tapeUm)}) do início do testemunho. Na caixa: canaleta ${place.channel + 1} da caixa ${place.box + 1}, a ${formatCmUm(place.localUm)} do topo.`,
      false,
    );
    renderConsulta();
  });
}

function bindInverse() {
  const form = document.getElementById("inverse-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const index = Number(data.get("intervalo"));
    const intervals = currentIntervals();
    const interval = intervals.find((item) => item.index === index);
    if (!interval) {
      showCalcResult("inverse-result", "Escolha um intervalo com taquinho informado.", true);
      return;
    }

    const tape = parseMetersToMm(data.get("trena"));
    if (!tape.ok) {
      showCalcResult(
        "inverse-result",
        tape.reason === "precision"
          ? "Use no máximo 3 casas decimais na distância da trena."
          : "Informe a distância medida na trena, em metros.",
        true,
      );
      return;
    }
    if (interval.recuperacaoMm === 0) {
      consulta = null;
      renderConsulta();
      showCalcResult(
        "inverse-result",
        "Não é possível calcular a profundidade: a recuperação deste intervalo é zero.",
        true,
      );
      return;
    }
    const tapeUm = tape.mm * 1000;
    if (tapeUm > interval.recuperacaoMm * 1000) {
      showCalcResult(
        "inverse-result",
        "A distância é maior que a recuperação deste intervalo.",
        true,
      );
      return;
    }

    const depthUm = depthUmFromTape(interval, tapeUm);
    const physicalUm = interval.recuperacaoInicialMm * 1000 + tapeUm;
    consulta = {
      depthUm,
      tapeUm,
      physicalUm,
      intervalIndex: interval.index,
    };
    const place = physicalPlace(physicalUm);
    showCalcResult(
      "inverse-result",
      `A ${formatMetersUm(tapeUm)} (${formatCmUm(tapeUm)}) do início do testemunho do taquinho ${interval.index + 1}, a profundidade é ${formatMetersUm(depthUm)}. Na caixa: canaleta ${place.channel + 1} da caixa ${place.box + 1}, a ${formatCmUm(place.localUm)} do topo.`,
      false,
    );
    renderConsulta();
  });
}

const camera = {
  zoom: 1,
  cx: 0,
  cy: 0,
};

function fullSize() {
  const n = boxCount();
  return {
    w: PAD_L + n * totalW + Math.max(0, n - 1) * BOX_GAP + PAD_R,
    h: PAD_T + LABEL_BAND + LENGTH + PAD_B,
  };
}

function applyCamera() {
  const svg = document.getElementById("tray-svg");
  if (!svg) return;
  const full = fullSize();
  const w = full.w / camera.zoom;
  const h = full.h / camera.zoom;
  let x = camera.cx - w / 2;
  let y = camera.cy - h / 2;
  x = Math.min(Math.max(0, x), Math.max(0, full.w - w));
  y = Math.min(Math.max(0, y), Math.max(0, full.h - h));
  camera.cx = x + w / 2;
  camera.cy = y + h / 2;
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  const label = document.getElementById("zoom-label");
  if (label) label.textContent = `${Math.round(camera.zoom * 100)}%`;
}

function svgPoint(event) {
  const svg = document.getElementById("tray-svg");
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: camera.cx, y: camera.cy };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function setZoom(next, anchor) {
  const zoom = Math.min(16, Math.max(1, next));
  if (anchor) {
    const scale = camera.zoom / zoom;
    camera.cx = anchor.x + (camera.cx - anchor.x) * scale;
    camera.cy = anchor.y + (camera.cy - anchor.y) * scale;
  }
  camera.zoom = zoom;
  applyCamera();
}

function bindZoom() {
  const svg = document.getElementById("tray-svg");
  if (!svg) return;
  const full = fullSize();
  camera.cx = full.w / 2;
  camera.cy = full.h / 2;
  applyCamera();

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      setZoom(camera.zoom * factor, svgPoint(event));
    },
    { passive: false },
  );

  let dragging = false;
  let last = null;

  svg.addEventListener("pointerdown", (event) => {
    if (camera.zoom <= 1) return;
    dragging = true;
    svg.classList.add("is-panning");
    svg.setPointerCapture(event.pointerId);
    last = svgPoint(event);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!dragging || !last) return;
    const point = svgPoint(event);
    camera.cx -= point.x - last.x;
    camera.cy -= point.y - last.y;
    applyCamera();
    last = svgPoint(event);
  });

  const endDrag = () => {
    dragging = false;
    last = null;
    svg.classList.remove("is-panning");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  document.getElementById("zoom-in")?.addEventListener("click", () => {
    setZoom(camera.zoom * 1.25, { x: camera.cx, y: camera.cy });
  });
  document.getElementById("zoom-out")?.addEventListener("click", () => {
    setZoom(camera.zoom / 1.25, { x: camera.cx, y: camera.cy });
  });
  document.getElementById("zoom-reset")?.addEventListener("click", () => {
    const size = fullSize();
    camera.zoom = 1;
    camera.cx = size.w / 2;
    camera.cy = size.h / 2;
    applyCamera();
  });
}

if (typeof document !== "undefined") {
  buildTopView();
  bindForm();
  bindLocate();
  bindInverse();
  bindZoom();
  renderAll();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseMetersToMm,
    accumulateIntervals,
    recoverySegments,
    placement,
    formatMeters,
    roundCoreMm,
    findIntervalAtDepth,
    tapeUmFromDepth,
    depthUmFromTape,
    formatMetersUm,
    formatCmUm,
  };
}

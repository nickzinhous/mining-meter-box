const SVG_NS = "http://www.w3.org/2000/svg";

const CHANNELS = 3;
const CHANNEL_W = 7;
const DIVIDER_W = 2.5;
const WALL_W = 1.25;
const LENGTH = 100;
const LABEL_BAND = 4.2;
const BODY_LEN = 1;
const TOP_LEN = 2;
const OVERHANG = (TOP_LEN - BODY_LEN) / 2;

const totalW = WALL_W * 2 + CHANNELS * CHANNEL_W + (CHANNELS - 1) * DIVIDER_W;
const MM = 10;
const MATERIAL_COLORS = [
  { name: "Branco", hex: "#efeae2" },
  { name: "Cinza claro", hex: "#c5c1b8" },
  { name: "Cinza", hex: "#8e8a84" },
  { name: "Cinza escuro", hex: "#4e555c" },
  { name: "Preto", hex: "#2a2e33" },
  { name: "Amarelo", hex: "#e2c15a" },
  { name: "Ocre", hex: "#c4843c" },
  { name: "Marrom", hex: "#8d5a32" },
  { name: "Marrom escuro", hex: "#5c3a28" },
  { name: "Vermelho", hex: "#a3453c" },
  { name: "Rosa", hex: "#c4898a" },
  { name: "Roxo", hex: "#6d5a78" },
  { name: "Azul", hex: "#4c6280" },
  { name: "Verde", hex: "#3f6f62" },
  { name: "Verde oliva", hex: "#6a7344" },
];
const DEFAULT_MATERIAL = MATERIAL_COLORS[7];

/** Intervalo informado. A posição física é derivada da recuperação acumulada. */
/** @type {{ id: string, avancoMm: number, recuperacaoMm: number, info: string, color: string }[]} */
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

/** @type {{ id: string, box: number, boxLeft: number, boxRight: number, y0: number, anchorX: number, anchorY: number, lines: string[] }[]} */
let tagAnchors = [];
let freshId = null;
/** @type {null | Record<string, any>} */
let probePin = null;

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
  const rounded = Math.round(Math.abs(mm));
  const whole = Math.floor(rounded / 1000);
  const frac = String(rounded % 1000).padStart(3, "0");
  const digits = rounded % 10 === 0 ? frac.slice(0, 2) : frac;
  return `${whole},${digits} m`;
}

function metersLabel(mm) {
  return formatMeters(mm).replace(/ m$/, "");
}

function depthSpan(interval) {
  return `${metersLabel(interval.profundidadeInicialMm)}–${formatMeters(interval.profundidadeFinalMm)}`;
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

/**
 * Profundidade no furo a partir de um ponto do testemunho recuperado.
 * A posição física na caixa não entra nessa conta.
 * Sem registro de onde a amostra foi perdida, o avanço é distribuído
 * linearmente sobre a recuperação. Se avanço e recuperação coincidem,
 * cada milímetro recuperado corresponde ao mesmo milímetro de profundidade.
 * Se há perda, o resultado é uma estimativa, não a posição geológica exata.
 */
function estimateDepthUm(interval, offsetMm) {
  if (!interval || interval.recuperacaoMm <= 0 || offsetMm < 0) return null;
  const capped = Math.min(offsetMm, interval.recuperacaoMm);
  return depthUmFromTape(interval, Math.round(capped * 1000));
}

function findIntervalAtRecovery(intervals, recoveryMm) {
  let lastWithCore = null;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i].recuperacaoMm > 0) lastWithCore = intervals[i];
  }
  for (let i = 0; i < intervals.length; i++) {
    const interval = intervals[i];
    if (interval.recuperacaoMm <= 0) continue;
    const last = interval === lastWithCore;
    const inside =
      recoveryMm >= interval.recuperacaoInicialMm &&
      (recoveryMm < interval.recuperacaoFinalMm ||
        (last && recoveryMm === interval.recuperacaoFinalMm));
    if (inside) return interval;
  }
  return null;
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

/** A canaleta enche da base para o topo: 0 cm fica embaixo. */
function yFromBase(y0, cmFromBase) {
  return y0 + LENGTH - cmFromBase;
}

function normalizeHex(value) {
  const text = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_MATERIAL.hex;
}

function materialName(hex) {
  const match = MATERIAL_COLORS.find((color) => color.hex === normalizeHex(hex));
  return match ? match.name : "Personalizada";
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
    const y = yFromBase(y0, cm);
    group.appendChild(
      el("line", {
        x1: xEdge,
        y1: y,
        x2: xEdge + direction * len,
        y2: y,
        stroke: "var(--grid-strong)",
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
        stroke: "var(--grid)",
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
        stroke: major ? "var(--grid-strong)" : mid ? "var(--grid-mid)" : "var(--grid)",
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
    const y = yFromBase(y0, cm);
    const len = cm % 10 === 0 ? major : minor;
    group.appendChild(
      el("line", {
        x1: xEdge,
        y1: y,
        x2: xEdge + direction * len,
        y2: y,
        stroke: "var(--tick)",
        "stroke-width": cm % 10 === 0 ? 1.4 : 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    if (cm % 10 === 0) {
      const label = el("text", {
        x: xEdge + direction * (major + 0.2),
        y: y + 0.32,
        "text-anchor": direction < 0 ? "end" : "start",
        fill: "var(--text)",
        "font-size": 0.85,
        "font-family": "Inter, Segoe UI, system-ui, sans-serif",
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
  const bodyH = LENGTH + LABEL_BAND;

  shell.appendChild(
    el("rect", {
      x: ox + 0.18,
      y: PAD_T + 0.22,
      width: xu(totalW),
      height: bodyH,
      rx: 0.45,
      fill: "#000",
      opacity: 0.28,
    }),
  );
  shell.appendChild(
    el("rect", {
      x: ox,
      y: PAD_T,
      width: xu(totalW),
      height: bodyH,
      rx: 0.45,
      fill: "var(--box)",
      stroke: "var(--box-edge)",
      "stroke-width": 1.6,
      "vector-effect": "non-scaling-stroke",
    }),
  );
  shell.appendChild(
    el("rect", {
      x: ox,
      y: PAD_T,
      width: xu(totalW),
      height: LABEL_BAND - 0.15,
      rx: 0.45,
      fill: "var(--box-edge)",
    }),
  );
  shell.appendChild(
    el("rect", {
      x: ox + 0.28,
      y: PAD_T + 0.28,
      width: xu(totalW) - 0.56,
      height: bodyH - 0.56,
      rx: 0.3,
      fill: "none",
      stroke: "var(--box-highlight)",
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
    }),
  );

  const title = el("text", {
    x: ox + 0.55,
    y: PAD_T + 1.55,
    fill: "var(--box-ink)",
    "font-size": 1.15,
    "font-weight": "700",
    "font-family": "Inter, Segoe UI, system-ui, sans-serif",
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
        rx: 0.08,
        fill: "var(--channel)",
        stroke: "var(--box-edge)",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    drawCmGrid(shell, x, y0, xu(CHANNEL_W));
    addFrisos(shell, x, y0, 1);
    addFrisos(shell, x + xu(CHANNEL_W), y0, -1);

    const slotStart = (boxIndex * CHANNELS + i) * LENGTH;
    const range = el("text", {
      x: x + xu(CHANNEL_W) / 2,
      y: PAD_T + 3.35,
      "text-anchor": "middle",
      fill: "var(--box-ink)",
      "font-size": 0.78,
      "font-family": "Inter, Segoe UI, system-ui, sans-serif",
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
          fill: "var(--divider)",
          stroke: "var(--box-edge)",
          "stroke-width": 1,
          "vector-effect": "non-scaling-stroke",
        }),
      );
      shell.appendChild(
        el("line", {
          x1: x + xu(DIVIDER_W) / 2,
          y1: y0 + 1,
          x2: x + xu(DIVIDER_W) / 2,
          y2: y0 + LENGTH - 1,
          stroke: "var(--box-highlight)",
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

  intervals.forEach((interval) => {
    if (interval.recuperacaoMm <= 0) return;
    const fill = normalizeHex(interval.color);
    for (const seg of recoverySegments(interval.recuperacaoInicialMm, interval.recuperacaoFinalMm)) {
      const box = layout.boxes[seg.box];
      if (!box) continue;
      const x = box.channelX[seg.channel];
      if (x == null) continue;
      const height = seg.lengthMm / MM;
      if (height <= 0) continue;
      const inset = 0.16;
      const y = yFromBase(box.y0, seg.localEndMm / MM);
      const absStart = seg.channelIndex * LENGTH * MM + seg.localStartMm;
      const absEnd = seg.channelIndex * LENGTH * MM + seg.localEndMm;
      root.appendChild(
        el("rect", {
          class: "core",
          "data-id": interval.id,
          "data-length-mm": seg.lengthMm,
          "data-abs-start-mm": absStart,
          "data-abs-end-mm": absEnd,
          "data-channel-index": seg.channelIndex,
          "data-box": seg.box,
          "data-channel": seg.channel,
          x: x + inset,
          y,
          width: xu(CHANNEL_W) - inset * 2,
          height,
          rx: 0.05,
          fill,
          opacity: 0.92,
        }),
      );
      root.appendChild(
        el("line", {
          class: "core-seam",
          x1: x + inset,
          y1: y,
          x2: x + xu(CHANNEL_W) - inset,
          y2: y,
          stroke: "var(--core-seam)",
          "stroke-width": 1.25,
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "none",
        }),
      );
    }
  });
}

function renderTaquinhos(intervals) {
  const root = document.getElementById("taquinhos-root");
  if (!root) return;
  root.replaceChildren();
  tagAnchors = [];

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
    const topY = yFromBase(box.y0, localTop + TOP_LEN);
    const bodyY = yFromBase(box.y0, localBody + BODY_LEN);
    const lines = [
      `A: ${formatMeters(t.avancoMm)}`,
      `R: ${formatMeters(t.recuperacaoMm)}`,
      `P: ${depthSpan(t)}`,
    ];

    const g = el("g", { class: "taquinho", "data-id": t.id, "pointer-events": "none" });
    const title = el("title");
    title.textContent = `Avanço ${lines[0].slice(3)}. Recuperação ${lines[1].slice(3)}. Profundidade ${lines[2].slice(3)}.`;
    g.appendChild(title);

    g.appendChild(
      el("rect", {
        x: cx,
        y: topY,
        width: xu(CHANNEL_W),
        height: TOP_LEN,
        fill: "var(--taquinho)",
        stroke: "var(--taquinho-ink)",
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
        fill: "var(--taquinho-ink)",
        opacity: 0.16,
      }),
    );

    g.appendChild(
      el("line", {
        x1: cx + 0.2,
        y1: topY + TOP_LEN / 2,
        x2: cx + xu(CHANNEL_W) - 0.2,
        y2: topY + TOP_LEN / 2,
        stroke: "var(--taquinho-ink)",
        "stroke-width": 1.2,
        "vector-effect": "non-scaling-stroke",
      }),
    );

    root.appendChild(g);
    tagAnchors.push({
      id: t.id,
      box: place.box,
      boxLeft: box.ox,
      boxRight: box.ox + totalW,
      y0: box.y0,
      anchorX: cx + xu(CHANNEL_W),
      anchorY: topY + TOP_LEN / 2,
      lines,
    });
  }

  layoutCoreTags();
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
    li.dataset.id = t.id;
    if (t.id === freshId) li.classList.add("is-fresh");
    const color = normalizeHex(t.color);
    li.style.borderLeftColor = color;
    const hasCore = t.recuperacaoMm > 0;
    if (!hasCore) li.classList.add("is-empty-recovery");
    const place = hasCore ? placement(t.recuperacaoFinalMm) : null;
    const where = place
      ? `Caixa ${place.box + 1} · canaleta ${place.channel + 1}`
      : "Sem testemunho na caixa";
    const depth = depthSpan(t);
    const recovered = `${formatMeters(t.recuperacaoInicialMm).replace(" m", "")}–${formatMeters(t.recuperacaoFinalMm)}`;
    li.innerHTML = `
      <div class="card-body">
        <div class="card-head">
          <strong><span class="swatch" style="background:${color}"></span>Taquinho ${t.index + 1}</strong>
          <span class="chip">${where}</span>
        </div>
        <dl class="specs">
          <div><dt>P · Profundidade</dt><dd>${depth}</dd></div>
          <div><dt>A · Avanço</dt><dd>${formatMeters(t.avancoMm)}</dd></div>
          <div><dt>R · Recuperação</dt><dd>${formatMeters(t.recuperacaoMm)}</dd></div>
          <div><dt>Na caixa</dt><dd>${hasCore ? recovered : "—"}</dd></div>
          <div><dt>Cor</dt><dd>${escapeHtml(materialName(color))}</dd></div>
        </dl>
        ${
          place?.shifted
            ? `<p class="card-note">O bloco não coube no fim da canaleta e passou para o vão de ${formatCm(place.topStart)} a ${formatCm(place.topEnd)}.</p>`
            : ""
        }
        ${t.info ? `<p class="card-info">${escapeHtml(t.info)}</p>` : ""}
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
  const y = yFromBase(box.y0, place.localUm / 10000);

  const mark = el("g", { class: "depth-mark" });
  mark.appendChild(
    el("line", {
      x1: x,
      y1: y,
      x2: x + xu(CHANNEL_W),
      y2: y,
      stroke: "var(--accent)",
      "stroke-width": 1.6,
      "vector-effect": "non-scaling-stroke",
    }),
  );
  root.appendChild(mark);
}

function renderAll() {
  if (probePin && !taquinhos.some((item) => item.id === probePin.id)) {
    probePin = null;
    hideProbeTip();
    clearProbeDrawing();
  }
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
    const id = crypto.randomUUID();
    freshId = id;
    taquinhos.push({
      id,
      avancoMm: avanco.mm,
      recuperacaoMm: registeredRecovery,
      info,
      color: normalizeHex(data.get("cor")),
    });

    clearConsulta();
    showNote(
      registeredRecovery === recuperacao.mm
        ? ""
        : `Recuperação registrada como ${formatMeters(registeredRecovery)} (ajuste para múltiplo de 5 cm).`,
    );
    renderAll();
    document.querySelector("#taquinho-list li.is-fresh")?.scrollIntoView({ block: "nearest" });
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
      `No taquinho ${interval.index + 1} (${formatMeters(interval.profundidadeInicialMm)}–${formatMeters(interval.profundidadeFinalMm)}), a profundidade ${formatMeters(parsed.mm)} fica a ${formatMetersUm(tapeUm)} (${formatCmUm(tapeUm)}) do início do testemunho. Na caixa: canaleta ${place.channel + 1} da caixa ${place.box + 1}, a ${formatCmUm(place.localUm)} da base.`,
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
      `A ${formatMetersUm(tapeUm)} (${formatCmUm(tapeUm)}) do início do testemunho do taquinho ${interval.index + 1}, a profundidade é ${formatMetersUm(depthUm)}. Na caixa: canaleta ${place.channel + 1} da caixa ${place.box + 1}, a ${formatCmUm(place.localUm)} da base.`,
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
  svg.classList.toggle("is-zoomed", camera.zoom > 1);
  const label = document.getElementById("zoom-label");
  if (label) label.textContent = `${Math.round(camera.zoom * 100)}%`;
  layoutCoreTags();
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
    const target = event.target;
    if (target instanceof Element && target.closest(".core, .taquinho")) return;
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

function selectMaterialColor(hex) {
  const normalized = normalizeHex(hex);
  const hidden = document.querySelector("#taquinho-form input[name=cor]");
  const current = document.getElementById("color-current");
  const custom = document.getElementById("color-custom");
  const palette = document.getElementById("color-palette");
  if (hidden) hidden.value = normalized;
  const match = MATERIAL_COLORS.some((color) => color.hex === normalized);
  if (current) current.textContent = materialName(normalized);
  palette?.querySelectorAll(".swatch-btn").forEach((button) => {
    const on = button.dataset.hex === normalized;
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  document.querySelector(".swatch-custom")?.classList.toggle("is-selected", !match);
  if (custom) custom.value = normalized;
}

function bindPalette() {
  const palette = document.getElementById("color-palette");
  const custom = document.getElementById("color-custom");
  if (!palette) return;

  for (const color of MATERIAL_COLORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch-btn";
    button.style.background = color.hex;
    button.title = color.name;
    button.setAttribute("aria-label", color.name);
    button.dataset.hex = color.hex;
    button.addEventListener("click", () => selectMaterialColor(color.hex));
    palette.appendChild(button);
  }

  custom?.addEventListener("input", () => selectMaterialColor(custom.value));
  selectMaterialColor(DEFAULT_MATERIAL.hex);
}

const AUTH_USERS_KEY = "mmb-users";
const AUTH_SESSION_KEY = "mmb-session";
let authMode = "login";

function sha256(bytes) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const maxWord = 2 ** 32;
  const words = [];
  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter += 1;
    }
  }

  const bitLength = bytes.length * 8;
  const withPad = bytes.slice();
  withPad.push(0x80);
  while ((withPad.length % 64) !== 56) withPad.push(0);
  const lengthWords = [Math.floor(bitLength / maxWord), bitLength >>> 0];
  for (let i = 0; i < withPad.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (withPad[i] << ((3 - (i % 4)) * 8));
  }
  words.push(lengthWords[0], lengthWords[1]);

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice();
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        (hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0)) |
        0;
      const temp2 =
        ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) |
        0;
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  let result = "";
  for (let i = 0; i < 8; i++) {
    for (let shift = 3; shift >= 0; shift--) {
      const byte = (hash[i] >> (shift * 8)) & 255;
      result += byte.toString(16).padStart(2, "0");
    }
  }
  return result;
}

async function sha256Hex(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return sha256(bytes);
}

function loadUsers() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (user) =>
        user &&
        typeof user.key === "string" &&
        typeof user.username === "string" &&
        typeof user.hash === "string",
    );
  } catch {
    return [];
  }
}

function readSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    if (!raw || typeof raw.username !== "string" || !raw.username.trim()) return null;
    return { username: raw.username.trim() };
  } catch {
    return null;
  }
}

function showApp(username) {
  document.documentElement.classList.add("has-session");
  const login = document.getElementById("login-screen");
  const app = document.querySelector(".app");
  if (login) login.hidden = true;
  if (app) app.hidden = false;
  const node = document.getElementById("current-user");
  if (node) node.textContent = username;
  requestAnimationFrame(() => layoutCoreTags());
}

function showLoginScreen() {
  document.documentElement.classList.remove("has-session");
  const login = document.getElementById("login-screen");
  const app = document.querySelector(".app");
  if (login) login.hidden = false;
  if (app) app.hidden = true;
  document.querySelector("#login-form input[name=usuario]")?.focus();
}

function showLoginError(message) {
  const node = document.getElementById("login-error");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  const title = document.getElementById("login-title");
  const lead = document.getElementById("login-lead");
  const submit = document.getElementById("login-submit");
  const toggle = document.getElementById("login-toggle");
  const password = document.querySelector("#login-form input[name=senha]");
  if (title) title.textContent = isLogin ? "Entrar" : "Criar acesso";
  if (lead) {
    lead.textContent = isLogin
      ? "Informe o usuário e a senha para abrir a caixa."
      : "Defina um usuário e uma senha para este navegador.";
  }
  if (submit) submit.textContent = isLogin ? "Entrar" : "Criar acesso e entrar";
  if (toggle) toggle.textContent = isLogin ? "Criar acesso" : "Já tenho acesso";
  if (password) password.autocomplete = isLogin ? "current-password" : "new-password";
  showLoginError("");
}

function validUsername(name) {
  const text = name.trim();
  if (text.length < 2 || text.length > 40) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}._ -]*$/u.test(text);
}

function bindAuth() {
  const form = document.getElementById("login-form");
  document.getElementById("login-toggle")?.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem(AUTH_SESSION_KEY);
    const formLogin = document.getElementById("login-form");
    if (formLogin instanceof HTMLFormElement) formLogin.reset();
    setAuthMode("login");
    showLoginScreen();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginError("");
    const data = new FormData(form);
    const username = String(data.get("usuario") || "").trim();
    const password = String(data.get("senha") || "");
    if (!validUsername(username)) {
      showLoginError("Use um usuário de 2 a 40 caracteres, começando com letra ou número.");
      return;
    }
    if (password.length < 4 || password.length > 72) {
      showLoginError("A senha precisa ter entre 4 e 72 caracteres.");
      return;
    }

    const users = loadUsers();
    const key = username.toLocaleLowerCase("pt-BR");
    const hash = await sha256Hex(password);
    const existing = users.find((user) => user.key === key);

    if (authMode === "register") {
      if (existing) {
        showLoginError("Já existe um acesso com esse usuário.");
        return;
      }
      users.push({ key, username, hash });
      localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    } else if (!existing || existing.hash !== hash) {
      showLoginError("Usuário ou senha incorretos.");
      return;
    }

    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: existing?.username || username }));
    if (form instanceof HTMLFormElement) form.reset();
    setAuthMode("login");
    showApp(existing?.username || username);
  });
}

function layoutCoreTags() {
  const layer = document.getElementById("tag-layer");
  const svg = document.getElementById("tray-svg");
  const leaders = document.getElementById("tag-leaders");
  if (!layer || !svg) return;
  layer.replaceChildren();
  if (leaders) leaders.replaceChildren();
  const ctm = svg.getScreenCTM();
  if (!ctm || tagAnchors.length === 0) return;
  const wrap = layer.getBoundingClientRect();
  if (wrap.width < 8 || wrap.height < 8) return;
  const vb = svg.viewBox.baseVal;
  const scale = svg.getBoundingClientRect().height / vb.height;
  if (!Number.isFinite(scale) || scale <= 0.2) return;

  const tagPx = 62;
  const tagSvg = tagPx / scale;
  const groups = new Map();
  for (const anchor of tagAnchors) {
    const list = groups.get(anchor.box) || [];
    list.push(anchor);
    groups.set(anchor.box, list);
  }
  for (const anchors of groups.values()) {
    anchors.sort((a, b) => a.anchorY - b.anchorY);
    let cursor = -Infinity;
    for (const anchor of anchors) {
      const min = anchor.y0;
      const max = Math.max(min, anchor.y0 + LENGTH - tagSvg);
      let top = anchor.anchorY - tagSvg / 2;
      if (top < cursor) top = cursor;
      anchor.tagY = Math.min(Math.max(top, min), max);
      cursor = anchor.tagY + tagSvg + 6 / scale;
    }
  }

  const toClient = (x, y) => {
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    return point.matrixTransform(ctm);
  };

  tagAnchors.forEach((anchor, index) => {
    const tag = document.createElement("div");
    tag.className = "core-tag";
    tag.dataset.id = anchor.id;
    tag.style.zIndex = String(2 + index);
    for (const line of anchor.lines) {
      const span = document.createElement("span");
      span.textContent = line;
      tag.appendChild(span);
    }
    tag.title = anchor.lines.join("\n");
    layer.appendChild(tag);
    const width = tag.offsetWidth || 148;
    const height = tag.offsetHeight || tagPx;
    const origin = toClient(anchor.boxRight + 0.45, anchor.tagY);
    let left = origin.x - wrap.left;
    let top = origin.y - wrap.top;
    left = Math.min(Math.max(4, left), Math.max(4, wrap.width - width - 4));
    top = Math.min(Math.max(4, top), Math.max(4, wrap.height - height - 4));
    tag.style.left = `${left}px`;
    tag.style.top = `${top}px`;

    if (!leaders) return;
    leaders.appendChild(
      el("path", {
        d: `M ${anchor.anchorX} ${anchor.anchorY} H ${anchor.boxRight} V ${anchor.tagY + tagSvg / 2}`,
        fill: "none",
        stroke: "var(--taquinho)",
        "stroke-width": 1.25,
        "vector-effect": "non-scaling-stroke",
        "stroke-linejoin": "round",
        opacity: 0.9,
        "pointer-events": "none",
      }),
    );
  });
}

function holeName() {
  const value = document.getElementById("hole-id")?.value.trim() || "";
  return value || "não informado";
}

function hideProbeTip() {
  const tip = document.getElementById("probe-tip");
  if (!tip) return;
  tip.hidden = true;
  tip.replaceChildren();
}

function clearProbeDrawing() {
  document.getElementById("probe-root")?.replaceChildren();
}

function setActiveInterval(id) {
  document.querySelectorAll(".is-hot").forEach((node) => node.classList.remove("is-hot"));
  if (!id) return;
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((node) => node.classList.add("is-hot"));
}

function clearHover() {
  clearProbeDrawing();
  if (!probePin) {
    hideProbeTip();
    setActiveInterval(null);
    return;
  }
  drawProbe(probePin);
  setActiveInterval(probePin.id);
}

function drawProbe(reading) {
  const root = document.getElementById("probe-root");
  if (!root) return;
  root.replaceChildren();
  if (!reading || reading.x == null) return;
  root.appendChild(
    el("line", {
      x1: reading.x,
      y1: reading.y,
      x2: reading.x + CHANNEL_W,
      y2: reading.y,
      stroke: "var(--accent)",
      "stroke-width": 2,
      "vector-effect": "non-scaling-stroke",
      "pointer-events": "none",
    }),
  );
}

function readingFromPointer(core, point) {
  const intervals = currentIntervals();
  const interval = intervals.find((item) => item.id === core.getAttribute("data-id"));
  if (!interval || interval.recuperacaoMm <= 0) return null;
  const channelIndex = Number(core.getAttribute("data-channel-index"));
  const boxIndex = Number(core.getAttribute("data-box"));
  const box = layout.boxes[boxIndex];
  if (!box) return null;
  const startMm = Number(core.getAttribute("data-abs-start-mm"));
  const endMm = Number(core.getAttribute("data-abs-end-mm"));
  const localCm = Math.min(LENGTH, Math.max(0, box.y0 + LENGTH - point.y));
  const absMm = Math.min(endMm, Math.max(startMm, channelIndex * LENGTH * MM + localCm * MM));
  const offsetMm = Math.round(absMm - interval.recuperacaoInicialMm);
  const depthUm = estimateDepthUm(interval, offsetMm);
  if (depthUm == null) return null;
  const place = physicalPlace(Math.round(absMm * 1000));
  return {
    id: interval.id,
    index: interval.index,
    info: interval.info,
    box: place.box,
    channel: place.channel,
    offsetMm,
    depthUm,
    estimated: interval.avancoMm !== interval.recuperacaoMm,
    profundidadeInicialMm: interval.profundidadeInicialMm,
    profundidadeFinalMm: interval.profundidadeFinalMm,
    x: box.channelX[place.channel],
    y: yFromBase(box.y0, (absMm - channelIndex * LENGTH * MM) / MM),
  };
}

function tipRow(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

function placeTip(tip, clientX, clientY) {
  tip.hidden = false;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const rect = tip.getBoundingClientRect();
  const margin = 8;
  let left = clientX + 14;
  let top = clientY + 14;
  if (left + rect.width > window.innerWidth - margin) left = clientX - rect.width - 14;
  if (top + rect.height > window.innerHeight - margin) top = clientY - rect.height - 14;
  left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showReadingTip(reading, clientX, clientY, pinned) {
  const tip = document.getElementById("probe-tip");
  if (!tip) return;
  tip.replaceChildren();
  const dl = document.createElement("dl");
  const maneuver = reading.info
    ? `Taquinho ${reading.index + 1} · ${reading.info}`
    : `Taquinho ${reading.index + 1}`;
  tipRow(dl, "Furo", holeName());
  tipRow(dl, "Caixa", String(reading.box + 1).padStart(2, "0"));
  tipRow(dl, "Canaleta", String(reading.channel + 1).padStart(2, "0"));
  tipRow(dl, reading.estimated ? "Profundidade estimada" : "Profundidade", formatMetersUm(reading.depthUm));
  tipRow(dl, "Manobra", maneuver);
  tipRow(dl, "Intervalo original", depthSpan(reading));
  tipRow(dl, "Posição no testemunho", formatMeters(reading.offsetMm));
  tip.appendChild(dl);
  if (reading.estimated) {
    const note = document.createElement("p");
    note.className = "probe-note";
    note.textContent =
      "A perda foi distribuída linearmente entre o início e o fim da manobra. Não há registro do ponto em que o testemunho faltou.";
    tip.appendChild(note);
  }
  const pin = document.createElement("p");
  pin.className = "probe-pin-note";
  pin.textContent = pinned
    ? "Fixado. Clique em outro ponto para mover, ou fora do testemunho para soltar."
    : "Clique para fixar.";
  tip.appendChild(pin);
  placeTip(tip, clientX, clientY);
}

function showTagTip(interval, clientX, clientY) {
  const tip = document.getElementById("probe-tip");
  if (!tip || probePin) return;
  tip.replaceChildren();
  const dl = document.createElement("dl");
  const place = interval.recuperacaoMm > 0 ? placement(interval.recuperacaoFinalMm) : null;
  tipRow(dl, "A · Avanço", formatMeters(interval.avancoMm));
  tipRow(dl, "R · Recuperação", formatMeters(interval.recuperacaoMm));
  tipRow(dl, "P · Profundidade", depthSpan(interval));
  if (place) tipRow(dl, "Na caixa", `Caixa ${place.box + 1} · canaleta ${place.channel + 1}`);
  if (interval.info) tipRow(dl, "Informação", interval.info);
  tip.appendChild(dl);
  placeTip(tip, clientX, clientY);
}

function bindProbe() {
  const svg = document.getElementById("tray-svg");
  const layer = document.getElementById("tag-layer");
  if (!svg) return;

  svg.addEventListener("pointermove", (event) => {
    if (probePin || svg.classList.contains("is-panning") || event.pointerType === "touch") return;
    const core = event.target instanceof Element ? event.target.closest(".core") : null;
    if (!core) {
      clearHover();
      return;
    }
    const reading = readingFromPointer(core, svgPoint(event));
    if (!reading) return;
    drawProbe(reading);
    showReadingTip(reading, event.clientX, event.clientY, false);
    setActiveInterval(reading.id);
  });

  svg.addEventListener("pointerleave", () => {
    if (!probePin) clearHover();
  });

  svg.addEventListener("pointerdown", (event) => {
    const core = event.target instanceof Element ? event.target.closest(".core") : null;
    if (!core) {
      if (probePin) {
        probePin = null;
        clearHover();
      }
      return;
    }
    const reading = readingFromPointer(core, svgPoint(event));
    if (!reading) return;
    probePin = reading;
    drawProbe(reading);
    showReadingTip(reading, event.clientX, event.clientY, true);
    setActiveInterval(reading.id);
  });

  const showTag = (event) => {
    if (probePin || event.pointerType === "touch") return;
    const tag = event.target instanceof Element ? event.target.closest(".core-tag") : null;
    if (!tag) return;
    const interval = currentIntervals().find((item) => item.id === tag.dataset.id);
    if (!interval) return;
    clearProbeDrawing();
    showTagTip(interval, event.clientX, event.clientY);
    setActiveInterval(interval.id);
  };
  layer?.addEventListener("pointermove", showTag);
  layer?.addEventListener("pointerdown", (event) => {
    const tag = event.target instanceof Element ? event.target.closest(".core-tag") : null;
    if (!tag) return;
    const interval = currentIntervals().find((item) => item.id === tag.dataset.id);
    if (!interval) return;
    showTagTip(interval, event.clientX, event.clientY);
    setActiveInterval(interval.id);
  });
  layer?.addEventListener("pointerleave", () => {
    if (!probePin) clearHover();
  });

  window.addEventListener("resize", () => layoutCoreTags());
}

const THEME_KEY = "mmb-theme";
const HOLE_KEY = "mmb-hole";
const PALETTES = [
  {
    id: "mineracao",
    name: "Mineração",
    description: "Terra, madeira e mineral.",
    colors: { box: "#8a6244", channel: "#1b1612", bg: "#f4efe6", text: "#2a241c", taquinho: "#e2b657", accent: "#b4532a" },
  },
  {
    id: "clara",
    name: "Clara neutra",
    description: "Fundo claro e leitura técnica.",
    colors: { box: "#d5dbe3", channel: "#f4f7fb", bg: "#f3f5f8", text: "#1c2430", taquinho: "#1d4e89", accent: "#0f766e" },
  },
  {
    id: "escura",
    name: "Escura",
    description: "Alto contraste. É o padrão do sistema.",
    colors: { box: "#243044", channel: "#0b1018", bg: "#0f1115", text: "#e8eef7", taquinho: "#38bdf8", accent: "#38bdf8" },
  },
  {
    id: "suave",
    name: "Suave",
    description: "Tons discretos.",
    colors: { box: "#e6dfd4", channel: "#fbfaf7", bg: "#f7f4ef", text: "#3d4654", taquinho: "#8d735b", accent: "#6e8b74" },
  },
  {
    id: "geologia",
    name: "Geologia",
    description: "Ardósia e verde de alteração.",
    colors: { box: "#24312c", channel: "#0e1512", bg: "#121816", text: "#e7f2ec", taquinho: "#d4a656", accent: "#3dbe9a" },
  },
];
const THEME_FIELDS = [
  ["box", "Cor externa da caixa"],
  ["channel", "Fundo da canaleta"],
  ["bg", "Fundo da interface"],
  ["text", "Texto"],
  ["taquinho", "Taquinho"],
  ["accent", "Destaque"],
];
const DEFAULT_THEME = {
  paletteId: "escura",
  colors: { ...PALETTES.find((palette) => palette.id === "escura").colors },
};

function hexToRgb(hex) {
  const safe = normalizeHex(hex);
  return [parseInt(safe.slice(1, 3), 16), parseInt(safe.slice(3, 5), 16), parseInt(safe.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  const byte = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function mixHex(a, b, t) {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return rgbToHex(
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  );
}

function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function channelLuma(hex) {
  const linear = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const hi = Math.max(channelLuma(a), channelLuma(b));
  const lo = Math.min(channelLuma(a), channelLuma(b));
  return (hi + 0.05) / (lo + 0.05);
}

function inkFor(hex) {
  return contrastRatio(hex, "#f8fafc") >= contrastRatio(hex, "#142033") ? "#f8fafc" : "#142033";
}

function paintTheme(element, colors) {
  if (!element) return;
  const box = normalizeHex(colors.box);
  const channel = normalizeHex(colors.channel);
  const bg = normalizeHex(colors.bg);
  const text = normalizeHex(colors.text);
  const taquinho = normalizeHex(colors.taquinho);
  const accent = normalizeHex(colors.accent);
  const set = (name, value) => element.style.setProperty(name, value);
  set("--bg", bg);
  set("--text", text);
  set("--accent", accent);
  set("--box", box);
  set("--channel", channel);
  set("--taquinho", taquinho);
  set("--taquinho-ink", inkFor(taquinho));
  set("--box-ink", inkFor(box));
  set("--surface", mixHex(bg, text, 0.075));
  set("--surface-2", mixHex(bg, text, 0.12));
  set("--muted", mixHex(bg, text, 0.62));
  set("--stage", mixHex(bg, "#000000", 0.14));
  set("--accent-deep", mixHex(accent, "#000000", 0.28));
  set("--accent-ink", inkFor(accent));
  set("--border", rgba(text, 0.16));
  set("--box-edge", mixHex(box, text, 0.22));
  set("--box-highlight", rgba(text, 0.16));
  set("--divider", mixHex(box, channel, 0.55));
  set("--grid", mixHex(channel, text, 0.14));
  set("--grid-mid", mixHex(channel, text, 0.26));
  set("--grid-strong", mixHex(channel, text, 0.4));
  set("--tick", accent);
  set("--tag-bg", mixHex(bg, text, 0.1));
  set("--core-seam", rgba(inkFor(channel), 0.55));
  set("--shadow", "0 18px 40px rgba(0, 0, 0, 0.28)");
}

function themeFromColors(paletteId, colors) {
  return {
    paletteId,
    colors: {
      box: normalizeHex(colors.box),
      channel: normalizeHex(colors.channel),
      bg: normalizeHex(colors.bg),
      text: normalizeHex(colors.text),
      taquinho: normalizeHex(colors.taquinho),
      accent: normalizeHex(colors.accent),
    },
  };
}

function loadTheme() {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
    if (raw?.colors) return themeFromColors(raw.paletteId || "custom", raw.colors);
  } catch {
    /* preferência ausente ou inválida */
  }
  return themeFromColors(DEFAULT_THEME.paletteId, DEFAULT_THEME.colors);
}

let appliedTheme = null;
let draftTheme = null;

function showContrast(colors) {
  const node = document.getElementById("theme-contrast");
  if (!node) return;
  const ratio = contrastRatio(colors.bg, colors.text);
  if (ratio < 4.5) {
    node.hidden = false;
    node.textContent = `Contraste de ${ratio.toFixed(1)}:1 entre fundo e texto. Para leitura confortável, use pelo menos 4,5:1.`;
    return;
  }
  node.hidden = true;
  node.textContent = "";
}

function syncThemeControls() {
  for (const [key] of THEME_FIELDS) {
    const input = document.querySelector(`#theme-fields input[data-theme-key="${key}"]`);
    if (input) input.value = draftTheme.colors[key];
  }
  document.querySelectorAll("#palette-list button").forEach((button) => {
    const on = button.dataset.palette === draftTheme.paletteId;
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  paintTheme(document.getElementById("theme-preview"), draftTheme.colors);
  showContrast(draftTheme.colors);
}

function setDraft(theme, { apply }) {
  draftTheme = themeFromColors(theme.paletteId, theme.colors);
  syncThemeControls();
  if (apply) applyDraft();
}

function applyDraft() {
  appliedTheme = themeFromColors(draftTheme.paletteId, draftTheme.colors);
  paintTheme(document.documentElement, appliedTheme.colors);
  localStorage.setItem(THEME_KEY, JSON.stringify(appliedTheme));
  showContrast(appliedTheme.colors);
}

function bindTheme() {
  appliedTheme = loadTheme();
  draftTheme = themeFromColors(appliedTheme.paletteId, appliedTheme.colors);
  paintTheme(document.documentElement, appliedTheme.colors);

  const list = document.getElementById("palette-list");
  const fields = document.getElementById("theme-fields");
  const panel = document.getElementById("theme-panel");
  const open = document.getElementById("theme-open");
  if (!list || !fields || !panel || !open) return;

  for (const palette of PALETTES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-choice";
    button.dataset.palette = palette.id;
    button.title = palette.description;
    const swatch = document.createElement("span");
    swatch.className = "palette-dots";
    swatch.setAttribute("aria-hidden", "true");
    for (const key of ["bg", "box", "channel", "taquinho", "accent"]) {
      const dot = document.createElement("i");
      dot.style.background = palette.colors[key];
      swatch.appendChild(dot);
    }
    const name = document.createElement("span");
    name.textContent = palette.name;
    button.append(swatch, name);
    button.addEventListener("mouseenter", () => {
      paintTheme(document.getElementById("theme-preview"), palette.colors);
    });
    button.addEventListener("mouseleave", () => {
      paintTheme(document.getElementById("theme-preview"), draftTheme.colors);
    });
    button.addEventListener("click", () => setDraft(palette, { apply: true }));
    list.appendChild(button);
  }

  for (const [key, label] of THEME_FIELDS) {
    const field = document.createElement("label");
    field.className = "theme-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "color";
    input.dataset.themeKey = key;
    input.value = draftTheme.colors[key];
    input.addEventListener("input", () => {
      draftTheme = themeFromColors("custom", { ...draftTheme.colors, [key]: input.value });
      syncThemeControls();
    });
    input.addEventListener("change", () => applyDraft());
    field.append(caption, input);
    fields.appendChild(field);
  }

  syncThemeControls();
  open.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    open.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
  document.getElementById("theme-apply")?.addEventListener("click", () => applyDraft());
  document.getElementById("theme-reset")?.addEventListener("click", () => {
    setDraft(DEFAULT_THEME, { apply: true });
  });
  document.addEventListener("pointerdown", (event) => {
    if (panel.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (panel.contains(target) || open.contains(target)) return;
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    probePin = null;
    clearHover();
    if (!panel.hidden) {
      panel.hidden = true;
      open.setAttribute("aria-expanded", "false");
    }
  });
}

function bindHole() {
  const input = document.getElementById("hole-id");
  if (!input) return;
  try {
    input.value = localStorage.getItem(HOLE_KEY) || "";
  } catch {
    input.value = "";
  }
  input.addEventListener("input", () => {
    localStorage.setItem(HOLE_KEY, input.value);
  });
}

if (typeof document !== "undefined") {
  bindPalette();
  bindAuth();
  bindTheme();
  bindHole();
  buildTopView();
  bindForm();
  bindLocate();
  bindInverse();
  bindZoom();
  bindProbe();
  renderAll();
  const session = readSession();
  if (session) showApp(session.username);
  else showLoginScreen();
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
    findIntervalAtRecovery,
    tapeUmFromDepth,
    depthUmFromTape,
    estimateDepthUm,
    formatMetersUm,
    formatCmUm,
    depthSpan,
  };
}

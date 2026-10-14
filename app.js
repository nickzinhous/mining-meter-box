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

/** Intervalo informado. O testemunho ocupa a recuperação; recuperação zero ainda marca um taquinho, um friso à frente. */
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

let freshId = null;
let selectedId = null;
let editingId = null;
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

function normalizeGeo(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const clip = (value, max) => String(value || "").trim().slice(0, max);
  return {
    litologia: clip(source.litologia, 40),
    alteracao: clip(source.alteracao, 24),
    fraturamento: clip(source.fraturamento, 24),
    mineralizacao: clip(source.mineralizacao, 80),
    observacoes: clip(source.observacoes, 400),
  };
}

function geoIsEmpty(geo) {
  const value = normalizeGeo(geo);
  return !value.litologia && !value.alteracao && !value.fraturamento && !value.mineralizacao && !value.observacoes;
}

function meterSlices(intervals) {
  if (!intervals.length) return [];
  const end = intervals[intervals.length - 1].profundidadeFinalMm;
  const count = Math.ceil(end / 1000);
  const buckets = [];
  for (let meter = 0; meter < count; meter += 1) {
    const from = meter * 1000;
    const to = Math.min((meter + 1) * 1000, end);
    let advance = 0;
    let recovery = 0;
    let bestId = null;
    let bestSlice = 0;
    for (const interval of intervals) {
      const start = Math.max(from, interval.profundidadeInicialMm);
      const stop = Math.min(to, interval.profundidadeFinalMm);
      const slice = stop - start;
      if (slice <= 0 || interval.avancoMm <= 0) continue;
      advance += slice;
      recovery += (slice / interval.avancoMm) * interval.recuperacaoMm;
      if (slice > bestSlice) {
        bestSlice = slice;
        bestId = interval.id;
      }
    }
    buckets.push({
      from,
      to,
      advance,
      recovery,
      id: bestId,
      pct: advance > 0 ? (recovery / advance) * 100 : 0,
    });
  }
  return buckets;
}

function auditIntervals(intervals) {
  const issues = [];
  for (let i = 0; i < intervals.length; i += 1) {
    const item = intervals[i];
    const label = `Taquinho ${item.index + 1} (${depthSpan(item)})`;
    if (!(item.avancoMm > 0)) {
      issues.push({ level: "erro", id: item.id, text: `${label}: o avanço precisa ser maior que zero.` });
    }
    if (item.recuperacaoMm < 0) {
      issues.push({ level: "erro", id: item.id, text: `${label}: a recuperação não pode ser negativa.` });
    }
    if (item.recuperacaoMm > item.avancoMm) {
      issues.push({
        level: "erro",
        id: item.id,
        text: `${label}: Erro de validação: a recuperação não pode ser maior que o avanço da manobra. Verifique os valores informados antes de continuar.`,
      });
    }
    if (item.profundidadeFinalMm < item.profundidadeInicialMm) {
      issues.push({ level: "erro", id: item.id, text: `${label}: a profundidade final ficou menor que a inicial.` });
    }
    if (i > 0 && item.profundidadeInicialMm !== intervals[i - 1].profundidadeFinalMm) {
      issues.push({
        level: "erro",
        id: item.id,
        text: `Há um vão ou uma sobreposição de profundidade entre o taquinho ${intervals[i - 1].index + 1} e o taquinho ${item.index + 1}.`,
      });
    }
  }
  const spans = [];
  for (const item of intervals) {
    if (item.recuperacaoMm <= 0) continue;
    for (const seg of recoverySegments(item.physicalInicialMm, item.physicalFinalMm)) {
      const origin = seg.channelIndex * LENGTH * MM;
      spans.push({
        id: item.id,
        n: item.index + 1,
        start: origin + seg.localStartMm,
        end: origin + seg.localEndMm,
      });
    }
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i].start < spans[i - 1].end) {
      issues.push({
        level: "erro",
        id: spans[i].id,
        text: `Os taquinhos ${spans[i - 1].n} e ${spans[i].n} ocupam o mesmo trecho da caixa. Nada foi movido automaticamente.`,
      });
    }
  }
  return issues;
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

/** Metro inteiro da profundidade, no ponto físico em que ele cai na caixa. */
function meterMarkPositions(intervals) {
  if (!intervals.length) return [];
  const end = intervals[intervals.length - 1].profundidadeFinalMm;
  const max = Math.floor(end / 1000);
  const marks = [];
  for (let meter = 1; meter <= max; meter += 1) {
    const depthMm = meter * 1000;
    const closed = intervals.find((interval) => interval.profundidadeFinalMm === depthMm);
    const interval = closed || findIntervalAtDepth(intervals, depthMm);
    if (!interval) continue;
    let physicalMm = interval.physicalFinalMm;
    if (interval.recuperacaoMm > 0) {
      const tapeUm = tapeUmFromDepth(interval, depthMm);
      if (tapeUm == null) continue;
      physicalMm = interval.physicalInicialMm + tapeUm / 1000;
    }
    const lengthMm = LENGTH * MM;
    let channelIndex = Math.floor(Math.max(0, physicalMm) / lengthMm);
    let localMm = physicalMm - channelIndex * lengthMm;
    if (localMm === 0 && physicalMm > 0 && channelIndex > 0) {
      channelIndex -= 1;
      localMm = lengthMm;
    }
    const localCm = localMm / MM;
    marks.push({
      meter,
      box: Math.floor(channelIndex / CHANNELS),
      channel: channelIndex % CHANNELS,
      localCm: Math.min(LENGTH, Math.max(0, localCm)),
    });
  }
  return marks;
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

const RECOVERY_LIMIT_MESSAGE =
  "Erro de validação: a recuperação não pode ser maior que o avanço da manobra. Verifique os valores informados antes de continuar.";

function recoveryExceedsAdvance(advanceMm, recoveryMm) {
  return recoveryMm > advanceMm || roundCoreMm(recoveryMm) > advanceMm;
}

/** Primeiro encaixe de taquinho que termina depois de `mm`. */
function markerFrom(mm) {
  let slot = placement(mm);
  if (slot.topEnd * MM <= mm) slot = placement(slot.topEnd * MM);
  return slot;
}

/**
 * Recuperação zero não deposita testemunho, mas o taquinho da manobra
 * não pode encostar no anterior: pula um friso e marca o encaixe seguinte.
 */
function placeZeroRecovery(afterMarkerEndMm) {
  const skipped = markerFrom(afterMarkerEndMm);
  return markerFrom(skipped.topEnd * MM);
}

function accumulateIntervals(items) {
  let advanceMm = 0;
  let recoveryMm = 0;
  let occupiedMm = 0;
  let lastMarkerEndMm = 0;
  return items.map((item, index) => {
    const recuperacaoInicialMm = recoveryMm;
    const recuperacaoFinalMm = recoveryMm + item.recuperacaoMm;
    const placed = {
      ...item,
      index,
      profundidadeInicialMm: advanceMm,
      profundidadeFinalMm: advanceMm + item.avancoMm,
      recuperacaoInicialMm,
      recuperacaoFinalMm,
      physicalInicialMm: occupiedMm,
      physicalFinalMm: occupiedMm,
    };
    if (item.recuperacaoMm > 0) {
      const materialEnd = occupiedMm + item.recuperacaoMm;
      const block = placement(materialEnd);
      placed.physicalInicialMm = occupiedMm;
      placed.physicalFinalMm = materialEnd;
      occupiedMm = block.shifted ? block.topEnd * MM : materialEnd;
      lastMarkerEndMm = block.topEnd * MM;
    } else {
      const marker = placeZeroRecovery(lastMarkerEndMm);
      const point = marker.topStart * MM;
      placed.physicalInicialMm = point;
      placed.physicalFinalMm = point;
      lastMarkerEndMm = marker.topEnd * MM;
      occupiedMm = lastMarkerEndMm;
    }
    advanceMm = placed.profundidadeFinalMm;
    recoveryMm = recuperacaoFinalMm;
    return placed;
  });
}

function intervalBlock(interval) {
  if (!interval || interval.physicalFinalMm == null) return null;
  return placement(interval.physicalFinalMm);
}

/** Marcador de encerramento. Não é manobra: não soma avanço, recuperação nem profundidade. */
function fimMarker(intervals, ended) {
  if (!ended || !intervals?.length) return null;
  const last = intervals[intervals.length - 1];
  const block = intervalBlock(last);
  if (!block) return null;
  return placeZeroRecovery(block.topEnd * MM);
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

function boxesFor(intervals, ended) {
  let maxBox = 0;
  let any = false;
  for (const interval of intervals) {
    const block = intervalBlock(interval);
    if (!block) continue;
    any = true;
    maxBox = Math.max(maxBox, block.box);
  }
  const fim = fimMarker(intervals, ended);
  if (fim) {
    any = true;
    maxBox = Math.max(maxBox, fim.box);
  }
  return any ? maxBox + 1 : 0;
}

function boxCount() {
  return Math.max(1, boxesFor(currentIntervals(), Boolean(currentHole()?.ended)));
}

function boxOrigin(index) {
  return PAD_L + index * (totalW + BOX_GAP);
}

function xu(cm) {
  return cm;
}

/** 0 cm fica na base da canaleta; a posição cresce para cima. */
function yFromBase(y0, cmFromBase) {
  return y0 + (LENGTH - cmFromBase);
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
        y: cm === 0 ? y - 0.15 : cm === LENGTH ? y + 0.85 : y + 0.32,
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

function drawBox(parent, boxIndex, originX) {
  const ox = originX == null ? boxOrigin(boxIndex) : originX;
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

  const head = el("g", { class: "box-head" });
  head.appendChild(
    el("rect", {
      x: ox + 0.55,
      y: PAD_T + 0.42,
      width: xu(totalW) - 1.1,
      height: LABEL_BAND - 0.95,
      rx: 0.22,
      fill: "color-mix(in srgb, var(--box-ink) 7%, transparent)",
    }),
  );
  head.appendChild(
    el("line", {
      class: "box-head-rule",
      x1: ox + 0.7,
      y1: y0 - 0.08,
      x2: ox + xu(totalW) - 0.7,
      y2: y0 - 0.08,
      stroke: "color-mix(in srgb, var(--box-ink) 28%, transparent)",
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
    }),
  );
  const title = el("text", {
    class: "box-head-title",
    x: ox + xu(totalW) / 2,
    y: PAD_T + 1.48,
    "text-anchor": "middle",
    fill: "var(--box-ink)",
    "font-size": 1.28,
    "font-weight": "700",
  });
  title.textContent = `CAIXA ${String(boxIndex + 1).padStart(2, "0")}`;
  head.appendChild(title);
  shell.appendChild(head);

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
      class: "box-head-range",
      x: x + xu(CHANNEL_W) / 2,
      y: PAD_T + 3.42,
      "text-anchor": "middle",
      fill: "var(--box-ink)",
      "font-size": 1.08,
      "font-weight": "650",
    });
    const indexMark = el("tspan", {
      class: "box-head-index",
      fill: "var(--accent)",
      "font-weight": "700",
    });
    indexMark.textContent = String(i + 1).padStart(2, "0");
    const intervalMark = el("tspan");
    intervalMark.textContent = `  ${slotStart}–${slotStart + LENGTH}`;
    range.append(indexMark, intervalMark);
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
      head.appendChild(
        el("line", {
          class: "box-head-split",
          x1: x + xu(DIVIDER_W) / 2,
          y1: PAD_T + 2.05,
          x2: x + xu(DIVIDER_W) / 2,
          y2: y0 - 0.42,
          stroke: "color-mix(in srgb, var(--box-ink) 22%, transparent)",
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
  shell.querySelectorAll(".box-head-range").forEach((node) => {
    const width = node.getBBox().width;
    const maxW = CHANNEL_W - 0.45;
    if (width > maxW) node.setAttribute("font-size", String((1.08 * maxW) / width));
  });
  layout.boxes[boxIndex] = { ox, y0, channelX };
}

function buildTopView() {
  const root = document.getElementById("tray-root");
  const svg = document.getElementById("tray-svg");
  if (!root || !svg) return;
  root.replaceChildren();
  layout.boxes = [];

  const count = boxCount();
  if (soloBox && count > 0) {
    const index = Math.min(Math.max(focusedBox ?? 0, 0), count - 1);
    focusedBox = index;
    drawBox(root, index, PAD_L);
  } else {
    for (let i = 0; i < count; i++) drawBox(root, i);
  }

  drawMeterMarks(root, currentIntervals());
  applyCamera();
}

function drawMeterMarks(parent, intervals) {
  const marks = meterMarkPositions(intervals);
  if (!marks.length) return;
  const group = el("g", { class: "meter-marks" });
  const placed = [];
  for (const mark of marks) {
    const box = layout.boxes[mark.box];
    if (!box) continue;
    const x = box.channelX[mark.channel];
    if (x == null) continue;
    const y = yFromBase(box.y0, mark.localCm);
    const digits = String(mark.meter).length;
    const size = 1;
    const fontSize = digits >= 3 ? 0.32 : digits === 2 ? 0.42 : 0.55;
    const key = `${mark.box}:${mark.channel}:${Math.round(y * 20)}`;
    let shift = 0;
    while (placed.some((item) => item.key === key && item.shift === shift)) shift += 1;
    placed.push({ key, shift });
    const sx = x - 0.1 - size - shift;
    const sy = y;
    const chip = el("g");
    const title = el("title");
    title.textContent = `${mark.meter} m`;
    chip.appendChild(title);
    chip.appendChild(
      el("rect", {
        x: sx,
        y: sy,
        width: size,
        height: size,
        fill: "var(--box-ink)",
        stroke: "var(--box)",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    const label = el("text", {
      x: sx + size / 2,
      y: y + size / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      fill: "var(--box)",
      "font-size": fontSize,
      "font-weight": "650",
      "font-family": "Inter, Segoe UI, system-ui, sans-serif",
    });
    label.textContent = String(mark.meter);
    chip.appendChild(label);
    group.appendChild(chip);
  }
  parent.appendChild(group);
}

function renderCores(intervals) {
  const root = document.getElementById("cores-root");
  if (!root) return;
  root.replaceChildren();

  intervals.forEach((interval) => {
    if (interval.recuperacaoMm <= 0) return;
    const fill = normalizeHex(interval.color);
    for (const seg of recoverySegments(interval.physicalInicialMm, interval.physicalFinalMm)) {
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
      const classes = ["core"];
      if (interval.id === selectedId) classes.push("is-picked");
      root.appendChild(
        el("rect", {
          class: classes.join(" "),
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

function appendTaquinho(root, place, id, lines, titleText, picked) {
  const box = layout.boxes[place.box];
  if (!box) return;
  const left = box.channelX[place.channel];
  if (left == null) return;
  const localTop = place.topStart - place.slotStart;
  const localBody = place.bodyStart - place.slotStart;
  const topY = yFromBase(box.y0, localTop + TOP_LEN);
  const bodyY = yFromBase(box.y0, localBody + BODY_LEN);
  const g = el("g", {
    class: picked ? "taquinho is-picked" : "taquinho",
    "data-id": id,
    "data-label": lines.join("|"),
    "pointer-events": "none",
  });
  const title = el("title");
  title.textContent = titleText;
  g.appendChild(title);
  g.appendChild(
    el("rect", {
      class: "taquinho-block",
      x: left,
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
      x: left,
      y: bodyY,
      width: xu(CHANNEL_W),
      height: BODY_LEN,
      fill: "var(--taquinho-ink)",
      opacity: 0.16,
    }),
  );
  root.appendChild(g);
}

function renderTaquinhos(intervals) {
  const root = document.getElementById("taquinhos-root");
  if (!root) return;
  root.replaceChildren();

  for (const t of intervals) {
    const place = intervalBlock(t);
    if (!place) continue;
    const lines = [
      `A: ${formatMeters(t.avancoMm)}`,
      `R: ${formatMeters(t.recuperacaoMm)}`,
      `P: ${depthSpan(t)}`,
    ];
    if (t.geo?.litologia) lines.push(t.geo.litologia);
    appendTaquinho(
      root,
      place,
      t.id,
      lines,
      `Avanço ${lines[0].slice(3)}. Recuperação ${lines[1].slice(3)}. Profundidade ${lines[2].slice(3)}.`,
      t.id === selectedId,
    );
  }

  const fim = fimMarker(intervals, Boolean(currentHole()?.ended));
  if (fim) {
    appendTaquinho(root, fim, "fim", ["FIM"], "Fim de furo", false);
  }

  layoutTaquinhoFaces();
}

function truncate(s, max) {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatCm(n) {
  return Number.isInteger(n) ? `${n} cm` : `${n.toFixed(1)} cm`;
}

function depthBounds() {
  const read = (id) => {
    const raw = document.getElementById(id)?.value ?? "";
    if (!String(raw).trim()) return null;
    const parsed = parseMetersToMm(raw);
    return parsed.ok ? parsed.mm : null;
  };
  return { from: read("filter-from"), to: read("filter-to") };
}

function intervalMatchesDepth(interval, bounds) {
  if (bounds.from == null && bounds.to == null) return true;
  if (bounds.to != null && interval.profundidadeInicialMm > bounds.to) return false;
  if (bounds.from != null && interval.profundidadeFinalMm < bounds.from) return false;
  return true;
}

function listQuery() {
  return (document.getElementById("list-filter")?.value || "").trim().toLocaleLowerCase("pt-BR");
}

function intervalSearchText(interval) {
  const place = intervalBlock(interval);
  const where = place ? `caixa ${place.box + 1} canaleta ${place.channel + 1}` : "";
  return [
    String(interval.index + 1),
    materialName(normalizeHex(interval.color)),
    interval.info || "",
    depthSpan(interval),
    formatMeters(interval.avancoMm),
    formatMeters(interval.recuperacaoMm),
    interval.geo?.litologia || "",
    interval.geo?.alteracao || "",
    interval.geo?.fraturamento || "",
    interval.geo?.mineralizacao || "",
    interval.geo?.observacoes || "",
    where,
  ]
    .join(" ")
    .toLocaleLowerCase("pt-BR");
}

function renderList(intervals) {
  const list = document.getElementById("taquinho-list");
  const empty = document.getElementById("list-empty");
  const miss = document.getElementById("list-miss");
  const summary = document.getElementById("accum-summary");
  const filterField = document.getElementById("list-filter-field");
  const count = document.getElementById("list-count");
  if (!list || !empty) return;

  const query = listQuery();
  const bounds = depthBounds();
  const depthOn = bounds.from != null || bounds.to != null;
  if (filterField) filterField.hidden = intervals.length === 0;
  const depthFilter = document.getElementById("depth-filter");
  if (depthFilter) depthFilter.hidden = intervals.length === 0;
  list.replaceChildren();
  let shown = 0;

  for (const t of intervals) {
    if (query && !intervalSearchText(t).includes(query)) continue;
    if (!intervalMatchesDepth(t, bounds)) continue;
    shown += 1;
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (t.id === freshId) li.classList.add("is-fresh");
    if (t.id === selectedId || t.id === editingId) li.classList.add("is-picked");
    const color = normalizeHex(t.color);
    li.style.borderLeftColor = color;
    const hasCore = t.recuperacaoMm > 0;
    if (!hasCore) li.classList.add("is-empty-recovery");
    else if (t.recuperacaoMm < t.avancoMm) li.classList.add("is-partial");
    else if (t.recuperacaoMm > t.avancoMm) li.classList.add("is-excess");
    const place = intervalBlock(t);
    const where = place
      ? `Caixa ${place.box + 1} · canaleta ${place.channel + 1}`
      : "Sem testemunho na caixa";
    const depth = depthSpan(t);
    const recovered = hasCore
      ? `${metersLabel(t.physicalInicialMm)}–${formatMeters(t.physicalFinalMm)}`
      : place
        ? `${formatCm(place.topStart - place.slotStart)} da base`
        : "—";
    li.innerHTML = `
      <div class="card-body">
        <div class="card-head">
          <strong><span class="swatch" style="background:${color}"></span>Taquinho ${t.index + 1}${
            !hasCore
              ? `<span class="loss-badge is-zero">Sem testemunho</span>`
              : t.recuperacaoMm < t.avancoMm
                ? `<span class="loss-badge">Perda</span>`
                : t.recuperacaoMm > t.avancoMm
                  ? `<span class="loss-badge is-excess">R &gt; A</span>`
                  : ""
          }</strong>
          <span class="chip">${where}</span>
        </div>
        <dl class="specs">
          <div class="spec-tile"><dt><span class="spec-k">A</span> Avanço</dt><dd>${formatMeters(t.avancoMm)}</dd></div>
          <div class="spec-tile"><dt><span class="spec-k">R</span> Recuperação</dt><dd>${formatMeters(t.recuperacaoMm)}</dd></div>
          <div class="spec-tile ${ratioTone(t.avancoMm > 0 ? (t.recuperacaoMm / t.avancoMm) * 100 : null)}"><dt><span class="spec-k">%</span> Recuperação</dt><dd>${formatRatio(t.avancoMm, t.recuperacaoMm)}</dd></div>
          <div class="spec-line"><dt><span class="spec-k">P</span> Profundidade</dt><dd>${depth}</dd></div>
          <div class="spec-line"><dt>Na caixa</dt><dd>${recovered}</dd></div>
          <div class="spec-line"><dt>Cor</dt><dd>${escapeHtml(materialName(color))}</dd></div>
          ${t.geo?.litologia ? `<div class="spec-line"><dt>Litologia</dt><dd>${escapeHtml(t.geo.litologia)}</dd></div>` : ""}
          ${t.geo?.alteracao ? `<div class="spec-line"><dt>Alteração</dt><dd>${escapeHtml(t.geo.alteracao)}</dd></div>` : ""}
          ${t.geo?.fraturamento ? `<div class="spec-line"><dt>Fraturamento</dt><dd>${escapeHtml(t.geo.fraturamento)}</dd></div>` : ""}
          ${t.geo?.mineralizacao ? `<div class="spec-line"><dt>Mineralização</dt><dd>${escapeHtml(t.geo.mineralizacao)}</dd></div>` : ""}
          ${t.geo?.observacoes ? `<div class="spec-line"><dt>Observações</dt><dd>${escapeHtml(t.geo.observacoes)}</dd></div>` : ""}
        </dl>
        ${
          place?.shifted
            ? `<p class="card-note">O bloco não coube no fim da canaleta e passou para o vão de ${formatCm(place.topStart)} a ${formatCm(place.topEnd)}.</p>`
            : ""
        }
        ${t.info ? `<p class="card-info">${escapeHtml(t.info)}</p>` : ""}
      </div>`;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-quiet";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => beginEdit(t.id));
    actions.appendChild(editBtn);
    if (place) {
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "btn-quiet";
      viewBtn.textContent = "Ver";
      viewBtn.addEventListener("click", () => showInterval(t.id));
      actions.appendChild(viewBtn);
    }
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-quiet";
    copyBtn.textContent = "Copiar";
    copyBtn.addEventListener("click", () => {
      copyIntervalLine(t);
    });
    actions.appendChild(copyBtn);
    const photoBtn = document.createElement("button");
    photoBtn.type = "button";
    photoBtn.className = "btn-quiet";
    photoBtn.textContent = "Foto";
    photoBtn.addEventListener("click", () => openIntervalPhoto(t.id));
    actions.appendChild(photoBtn);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-remove";
    btn.textContent = "Remover";
    btn.addEventListener("click", async () => {
      const ok = await askConfirm(
        `Remover o taquinho ${t.index + 1} (${depthSpan(t)})? Os intervalos seguintes são recalculados. Desfazer recupera este lançamento.`,
        "Remover",
      );
      if (!ok || !taquinhos.some((item) => item.id === t.id)) return;
      snapshotLog("Taquinho removido");
      if (editingId === t.id) beginEdit(null);
      if (selectedId === t.id) selectedId = null;
      taquinhos = taquinhos.filter((x) => x.id !== t.id);
      clearConsulta();
      showNote("");
      renderAll();
    });
    actions.appendChild(btn);
    li.appendChild(actions);
    li.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      revealInterval(t.id, { zoom: false });
    });
    list.appendChild(li);
  }

  empty.hidden = intervals.length > 0;
  if (miss) miss.hidden = !(intervals.length > 0 && shown === 0);
  if (count) {
    const active = query || depthOn;
    count.textContent = !intervals.length ? "" : active ? `${shown} de ${intervals.length}` : String(intervals.length);
  }
  if (summary) summary.hidden = true;
  renderHoleStatus(intervals);
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
  if (selectedId && !taquinhos.some((item) => item.id === selectedId)) selectedId = null;
  persistHoles();
  const intervals = currentIntervals();
  renderList(intervals);
  renderIntervalOptions(intervals);
  buildTopView();
  renderCores(intervals);
  renderTaquinhos(intervals);
  renderConsulta();
  renderBoxRail();
  renderIntervalPanel();
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

    if (recoveryExceedsAdvance(avanco.mm, recuperacao.mm)) {
      showError(RECOVERY_LIMIT_MESSAGE);
      return;
    }
    const registeredRecovery = roundCoreMm(recuperacao.mm);
    const color = normalizeHex(data.get("cor"));
    const geo = readGeoForm(form);
    const roundingNote =
      registeredRecovery === recuperacao.mm
        ? ""
        : `Recuperação registrada como ${formatMeters(registeredRecovery)} (ajuste para múltiplo de 5 cm).`;

    if (editingId) {
      const current = taquinhos.find((item) => item.id === editingId);
      if (!current) {
        beginEdit(null);
        showError("Esse taquinho não está mais neste furo.");
        return;
      }
      snapshotLog("Taquinho editado");
      current.avancoMm = avanco.mm;
      current.recuperacaoMm = registeredRecovery;
      current.info = info;
      current.color = color;
      current.geo = geo;
      freshId = current.id;
      beginEdit(null);
      showNote(roundingNote || "Taquinho atualizado.");
    } else {
      snapshotLog("Taquinho adicionado");
      const id = crypto.randomUUID();
      freshId = id;
      taquinhos.push({
        id,
        avancoMm: avanco.mm,
        recuperacaoMm: registeredRecovery,
        info,
        color,
        geo,
      });
      showNote(roundingNote);
    }

    clearConsulta();
    renderAll();
    document.querySelector("#taquinho-list li.is-fresh")?.scrollIntoView({ block: "nearest" });
    form.avanco.value = "";
    form.recuperacao.value = "";
    form.info.value = "";
    writeGeoForm(form, {});
    form.avanco.focus();
  });

  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    form.requestSubmit();
  });

  const checkRecoveryLimit = () => {
    const advance = parseMetersToMm(form.avanco.value);
    const recovery = parseMetersToMm(form.recuperacao.value);
    const showingLimit = document.getElementById("form-error")?.textContent === RECOVERY_LIMIT_MESSAGE;
    if (!advance.ok || !recovery.ok) {
      if (showingLimit) showError("");
      return;
    }
    if (recoveryExceedsAdvance(advance.mm, recovery.mm)) {
      showError(RECOVERY_LIMIT_MESSAGE);
      return;
    }
    if (showingLimit) showError("");
  };
  form.avanco.addEventListener("input", checkRecoveryLimit);
  form.recuperacao.addEventListener("input", checkRecoveryLimit);
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
    locateDepth(parsed.mm, "locate-result");
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
    const physicalUm = interval.physicalInicialMm * 1000 + tapeUm;
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
let focusedBox = null;
let soloBox = false;

function renderBoxRail() {
  const rail = document.getElementById("box-rail");
  if (!rail) return;
  const count = boxCount();
  rail.hidden = count < 2;
  rail.replaceChildren();
  if (count < 2) {
    focusedBox = null;
    return;
  }
  if (focusedBox != null && focusedBox >= count) focusedBox = null;
  for (let index = 0; index < count; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.box = String(index);
    button.textContent = String(index + 1).padStart(2, "0");
    button.setAttribute("aria-label", `Ver caixa ${index + 1}`);
    const on = focusedBox === index;
    button.classList.toggle("is-current", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.addEventListener("click", () => focusBox(index));
    rail.appendChild(button);
  }
}

function focusBox(index) {
  const count = boxCount();
  if (index < 0 || index >= count) return;
  focusedBox = index;
  if (soloBox) {
    buildTopView();
    const intervals = currentIntervals();
    renderCores(intervals);
    renderTaquinhos(intervals);
    renderConsulta();
    fitCamera();
  } else {
    const box = layout.boxes[index];
    if (!box) return;
    const size = fullSize();
    const fit = Math.min(3.2, Math.max(1, size.w / (totalW + BOX_GAP)));
    camera.zoom = Math.max(camera.zoom, fit);
    camera.cx = box.ox + totalW / 2;
    camera.cy = size.h / 2;
    applyCamera();
  }
  document.querySelectorAll("#box-rail button").forEach((button) => {
    const on = Number(button.dataset.box) === index;
    button.classList.toggle("is-current", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function resetCamera() {
  const size = fullSize();
  focusedBox = null;
  camera.zoom = 1;
  camera.cx = size.w / 2;
  camera.cy = size.h / 2;
  applyCamera();
  document.querySelectorAll("#box-rail button").forEach((button) => {
    button.classList.remove("is-current");
    button.setAttribute("aria-pressed", "false");
  });
}

function fullSize() {
  const n = soloBox ? 1 : boxCount();
  return {
    w: PAD_L + n * totalW + Math.max(0, n - 1) * BOX_GAP + PAD_R,
    h: PAD_T + LABEL_BAND + LENGTH + PAD_B,
  };
}

function fitCamera() {
  const size = fullSize();
  camera.zoom = 1;
  camera.cx = size.w / 2;
  camera.cy = size.h / 2;
  applyCamera();
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
  layoutTaquinhoFaces();
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
    resetCamera();
  });
  document.getElementById("zoom-detail")?.addEventListener("click", () => {
    const size = fullSize();
    camera.zoom = 2.6;
    if (focusedBox != null && layout.boxes[focusedBox]) {
      camera.cx = layout.boxes[focusedBox].ox + totalW / 2;
    }
    camera.cy = size.h / 2;
    applyCamera();
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom(camera.zoom * 1.25, { x: camera.cx, y: camera.cy });
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoom(camera.zoom / 1.25, { x: camera.cx, y: camera.cy });
    } else if (event.key === "0") {
      event.preventDefault();
      resetCamera();
    } else if (event.key === "?") {
      event.preventDefault();
      document.getElementById("shortcuts-dialog")?.showModal();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox((focusedBox ?? 0) - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox((focusedBox ?? -1) + 1);
    } else if (event.key === "[") {
      event.preventDefault();
      stepInterval(-1);
    } else if (event.key === "]") {
      event.preventDefault();
      stepInterval(1);
    }
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
  if (current) {
    current.textContent = materialName(normalized);
    current.style.setProperty("--swatch", normalized);
  }
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
  requestAnimationFrame(() => layoutTaquinhoFaces());
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

async function ensureLocalTestUser() {
  const users = loadUsers();
  const hash = await sha256Hex("1234");
  const existing = users.find((user) => user.key === "admin");
  if (existing?.hash === hash && existing.username === "admin") return;
  if (existing) {
    existing.username = "admin";
    existing.hash = hash;
  } else {
    users.push({ key: "admin", username: "admin", hash });
  }
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

const localTestUserReady =
  typeof localStorage === "undefined" ? Promise.resolve() : ensureLocalTestUser();

function bindAuth() {
  const form = document.getElementById("login-form");
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

    await localTestUserReady;
    const users = loadUsers();
    const key = username.toLocaleLowerCase("pt-BR");
    const hash = await sha256Hex(password);
    const existing = users.find((user) => user.key === key);

    if (!existing || existing.hash !== hash) {
      showLoginError("Usuário ou senha incorretos.");
      return;
    }

    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: existing?.username || username }));
    if (form instanceof HTMLFormElement) form.reset();
    setAuthMode("login");
    showApp(existing?.username || username);
  });
}

function labelValue(line) {
  return line.replace(/^[ARP]:\s*/, "").replace(/\s*m$/, "");
}

function labelCandidates(lines) {
  if (!lines || lines.length < 3) return [lines || []];
  const short = (line) => line.replace(/\s*m$/, "");
  const tight = (line) => labelValue(line).replace(/,00/g, "");
  const a = tight(lines[0]);
  const r = tight(lines[1]);
  const p = tight(lines[2]);
  return [
    lines,
    lines.map(short),
    [short(lines[0]), short(lines[1]), `P: ${p}`],
    [`A ${a}`, `R ${r}`, `P ${p}`],
    [`A ${a}  R ${r}`, `P ${p}`],
    [`A${a} R${r} P${p}`],
    [`A${a}·R${r}·P${p}`],
    [`P${p}`],
    [p],
  ];
}

function paintTaquinhoFace(face, lines) {
  const write = (texts, fontPx) => {
    face.style.fontSize = `${fontPx}px`;
    face.replaceChildren();
    for (const text of texts) {
      const span = document.createElement("span");
      span.textContent = text;
      face.appendChild(span);
    }
    return face.scrollWidth <= face.clientWidth + 1 && face.scrollHeight <= face.clientHeight + 1;
  };

  for (const texts of labelCandidates(lines)) {
    const linesFit = Math.max(1, texts.length);
    let font = Math.min(13, Math.floor((face.clientHeight - 2) / (linesFit * 1.08)));
    while (font >= 9) {
      if (write(texts, font)) return;
      font -= 1;
    }
  }
  face.replaceChildren();
}

function layoutTaquinhoFaces() {
  const layer = document.getElementById("tag-layer");
  const svg = document.getElementById("tray-svg");
  if (!layer || !svg) return;
  layer.replaceChildren();
  const wrap = layer.getBoundingClientRect();
  if (wrap.width < 8 || wrap.height < 8) return;

  document.querySelectorAll("#taquinhos-root .taquinho").forEach((node) => {
    const block = node.querySelector(".taquinho-block");
    if (!block) return;
    const box = block.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const lines = (node.getAttribute("data-label") || "").split("|").filter(Boolean);
    if (lines.length === 0) return;
    const face = document.createElement("div");
    face.className = "taquinho-face";
    face.dataset.id = node.getAttribute("data-id") || "";
    face.title = lines.join("\n");
    face.style.left = `${box.left - wrap.left}px`;
    face.style.top = `${box.top - wrap.top}px`;
    face.style.width = `${box.width}px`;
    face.style.height = `${box.height}px`;
    layer.appendChild(face);
    paintTaquinhoFace(face, lines);
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
  const localCm = Math.min(LENGTH, Math.max(0, LENGTH - (point.y - box.y0)));
  const absMm = Math.min(endMm, Math.max(startMm, channelIndex * LENGTH * MM + localCm * MM));
  const offsetMm = Math.round(absMm - interval.physicalInicialMm);
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
  const place = intervalBlock(interval);
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
      probePin = null;
      clearHover();
      return;
    }
    const reading = readingFromPointer(core, svgPoint(event));
    if (!reading) return;
    probePin = reading;
    drawProbe(reading);
    showReadingTip(reading, event.clientX, event.clientY, true);
    setActiveInterval(reading.id);
    const place = intervalBlock(currentIntervals().find((item) => item.id === reading.id));
    if (place && soloBox && focusedBox !== place.box) {
      selectedId = reading.id;
      focusedBox = place.box;
      renderAll();
      return;
    }
    selectedId = reading.id;
    document.querySelectorAll(".core, .taquinho, #taquinho-list > li").forEach((node) => {
      const nodeId = node.dataset.id || node.getAttribute("data-id");
      node.classList.toggle("is-picked", nodeId === reading.id);
    });
    renderIntervalPanel();
    document.querySelector(`#taquinho-list li[data-id="${CSS.escape(reading.id)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const showFace = (event) => {
    const tag = event.target instanceof Element ? event.target.closest(".taquinho-face") : null;
    if (!tag) return null;
    return currentIntervals().find((item) => item.id === tag.dataset.id) || null;
  };
  layer?.addEventListener("pointermove", (event) => {
    if (probePin || event.pointerType === "touch") return;
    const interval = showFace(event);
    if (!interval) return;
    clearProbeDrawing();
    showTagTip(interval, event.clientX, event.clientY);
    setActiveInterval(interval.id);
  });
  layer?.addEventListener("pointerdown", (event) => {
    const interval = showFace(event);
    if (!interval) return;
    probePin = null;
    clearProbeDrawing();
    showTagTip(interval, event.clientX, event.clientY);
    setActiveInterval(interval.id);
  });
  layer?.addEventListener("pointerleave", () => {
    if (!probePin) clearHover();
  });

  window.addEventListener("resize", () => layoutTaquinhoFaces());
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
  const lightUi = channelLuma(bg) > 0.45;
  const surface = mixHex(bg, text, 0.075);
  set("--amber", lightUi ? "#9a5410" : "#f5b942");
  set("--danger", lightUi ? "#b42318" : "#f0a3a8");
  set("--card", lightUi ? mixHex(bg, "#ffffff", 0.45) : mixHex(bg, surface, 0.72));
  set("--card-hover", lightUi ? mixHex(bg, text, 0.06) : mixHex(bg, text, 0.11));
  set("--input-bg", lightUi ? mixHex(bg, "#ffffff", 0.72) : mixHex(surface, "#000000", 0.28));
  set("--input-bg-focus", lightUi ? "#ffffff" : mixHex(surface, "#000000", 0.42));
  set("--placeholder", mixHex(bg, text, 0.48));
  set("--hairline", rgba(text, lightUi ? 0.18 : 0.22));
  set("--shadow", lightUi ? "0 16px 34px rgba(28, 24, 18, 0.12)" : "0 18px 40px rgba(0, 0, 0, 0.32)");
  element.style.colorScheme = lightUi ? "light" : "dark";
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
    if (!document.querySelector("dialog[open]")) closeHoleMenu();
    if (document.querySelector(".workspace.is-wide")) setTrayExpanded(false);
    probePin = null;
    clearHover();
    if (!panel.hidden) {
      panel.hidden = true;
      open.setAttribute("aria-expanded", "false");
    }
  });
}

const LOG_KEY = "mmb-log";
let holes = [];
let activeHoleId = "";
let logReady = false;
const undoStack = [];

function currentHole() {
  return holes.find((hole) => hole.id === activeHoleId) || null;
}

function serializeLog(items) {
  return items.map((item) => {
    const row = {
      id: item.id,
      avancoMm: item.avancoMm,
      recuperacaoMm: item.recuperacaoMm,
      info: item.info || "",
      color: normalizeHex(item.color),
    };
    const geo = normalizeGeo(item.geo);
    if (!geoIsEmpty(geo)) row.geo = geo;
    return row;
  });
}

function sanitizeStored(items) {
  if (!Array.isArray(items)) return [];
  const stored = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const avancoMm = Number(item.avancoMm);
    const recuperacaoMm = Number(item.recuperacaoMm);
    if (!Number.isSafeInteger(avancoMm) || avancoMm <= 0) continue;
    if (!Number.isSafeInteger(recuperacaoMm) || recuperacaoMm < 0) continue;
    const row = {
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      avancoMm,
      recuperacaoMm,
      info: String(item.info || "").slice(0, 80),
      color: normalizeHex(item.color),
    };
    const geo = normalizeGeo(item.geo);
    if (!geoIsEmpty(geo)) row.geo = geo;
    stored.push(row);
  }
  return stored;
}

function sanitizeHole(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    name: String(raw.name || "").slice(0, 32),
    items: sanitizeStored(raw.items),
    ended: raw.ended === true,
  };
}

function cloneItems(items) {
  return sanitizeStored(items).map((item) => ({ ...item }));
}

function formatRatio(advanceMm, recoveryMm) {
  if (advanceMm <= 0) return "—";
  const pct = Math.round((recoveryMm / advanceMm) * 1000) / 10;
  return `${String(pct).replace(".", ",")}%`;
}

function renderHoleStatus(intervals) {
  const status = document.getElementById("hole-status");
  const next = document.getElementById("next-depth");
  const last = intervals[intervals.length - 1];
  if (status) {
    status.hidden = !last;
    if (last) {
      const advance = document.getElementById("stat-advance");
      const recovery = document.getElementById("stat-recovery");
      const ratio = document.getElementById("stat-ratio");
      const boxes = document.getElementById("stat-boxes");
      if (advance) advance.textContent = formatMeters(last.profundidadeFinalMm);
      if (recovery) recovery.textContent = formatMeters(last.recuperacaoFinalMm);
      if (ratio) ratio.textContent = formatRatio(last.profundidadeFinalMm, last.recuperacaoFinalMm);
      if (boxes) boxes.textContent = String(boxCount());
      const channels = document.getElementById("stat-channels");
      const loss = document.getElementById("stat-loss");
      if (channels) channels.textContent = String(usedChannels(intervals));
      if (loss) {
        const count = intervals.filter((interval) => interval.recuperacaoMm < interval.avancoMm).length;
        loss.textContent = String(count);
      }
      renderAudit(intervals);
      renderLithologyLegend(intervals);
      const pct = last.profundidadeFinalMm > 0
        ? Math.round((last.recuperacaoFinalMm / last.profundidadeFinalMm) * 1000) / 10
        : null;
      if (ratio) {
        ratio.classList.toggle("is-bad", pct != null && pct < 70);
        ratio.classList.toggle("is-warn", pct != null && pct >= 70 && pct < 90);
      }
    }
  }
  if (next) {
    const fimNote = currentHole()?.ended ? " Fim de furo marcado." : "";
    next.textContent = last
      ? `Próximo intervalo começa em ${formatMeters(last.profundidadeFinalMm)}.${fimNote}`
      : "O primeiro intervalo começa em 0,00 m.";
  }
  syncLogActions();
  renderHistory();
}

function syncLogActions() {
  const hasItems = taquinhos.length > 0;
  const repeat = document.getElementById("repeat-last");
  const undo = document.getElementById("undo-log");
  const copy = document.getElementById("copy-report");
  const download = document.getElementById("download-hole");
  const table = document.getElementById("download-table");
  const clear = document.getElementById("clear-hole");
  if (repeat) repeat.disabled = !hasItems || Boolean(editingId);
  if (undo) undo.disabled = undoStack.length === 0;
  if (copy) copy.disabled = !hasItems;
  if (download) download.disabled = !hasItems;
  if (table) table.disabled = !hasItems;
  if (clear) clear.disabled = !hasItems;
  const fim = document.getElementById("fim-toggle");
  if (fim) {
    const on = Boolean(currentHole()?.ended);
    fim.setAttribute("aria-pressed", on ? "true" : "false");
    fim.textContent = on ? "Desmarcar fim de furo" : "Fim de furo";
    fim.classList.toggle("is-on", on);
  }
}

function refreshHoleSelect() {
  renderHome();
}

function surveyLabel(hole, index) {
  const label = hole.name.trim() || "Sem nome";
  const shared = holes.filter((item) => (item.name.trim() || "Sem nome") === label).length;
  return shared > 1 ? `${label} (${index + 1})` : label;
}

function holeFacts(hole) {
  if (!hole.items.length) return null;
  const intervals = accumulateIntervals(hole.items);
  const last = intervals[intervals.length - 1];
  if (!last) return null;
  const pct = last.profundidadeFinalMm > 0
    ? Math.round((last.recuperacaoFinalMm / last.profundidadeFinalMm) * 1000) / 10
    : null;
  return {
    depth: formatMeters(last.profundidadeFinalMm),
    recovery: formatMeters(last.recuperacaoFinalMm),
    ratio: formatRatio(last.profundidadeFinalMm, last.recuperacaoFinalMm),
    pct,
    boxes: boxesFor(intervals, hole.ended),
  };
}

function ratioTone(pct) {
  if (pct == null) return "";
  if (pct < 70) return "is-bad";
  if (pct < 90) return "is-warn";
  return "";
}

function surveyFact(caption, value, tone) {
  const cell = document.createElement("span");
  cell.className = "survey-fact";
  if (tone) cell.classList.add(tone);
  const label = document.createElement("em");
  label.textContent = caption;
  cell.append(label, document.createTextNode(value));
  return cell;
}

function holeTouchedAt(id) {
  const list = loadHistory()[id];
  if (!Array.isArray(list) || !list.length) return null;
  const last = list[list.length - 1];
  return last && typeof last.at === "number" ? last.at : null;
}

function showHome() {
  if (logReady) persistHoles();
  document.documentElement.classList.remove("resume-work");
  document.body.classList.add("is-home");
  const home = document.getElementById("home");
  const layout = document.querySelector(".layout");
  if (home) home.hidden = false;
  if (layout) layout.hidden = true;
  try {
    sessionStorage.setItem("mmb-screen", "home");
  } catch {
    /* a tela segue na memória desta visita */
  }
  renderHome();
}

function showWorkspace() {
  document.documentElement.classList.remove("resume-work");
  document.body.classList.remove("is-home");
  const home = document.getElementById("home");
  const layout = document.querySelector(".layout");
  if (home) home.hidden = true;
  if (layout) layout.hidden = false;
  try {
    sessionStorage.setItem("mmb-screen", "work");
  } catch {
    /* a tela segue na memória desta visita */
  }
  requestAnimationFrame(() => layoutTaquinhoFaces());
}

function renderContinue(hole) {
  const bar = document.getElementById("home-continue");
  if (!bar) return;
  const listed = hole && (hole.name.trim() || hole.items.length);
  if (!listed) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  const facts = holeFacts(hole);
  const copy = document.createElement("div");
  copy.className = "continue-copy";
  const title = document.createElement("strong");
  title.textContent = hole.name.trim() || "Sem nome";
  const detail = document.createElement("span");
  if (facts) {
    detail.append(document.createTextNode(`${facts.depth} perfurados · ${facts.recovery} recuperados · `));
    const pct = document.createElement("b");
    pct.textContent = facts.ratio;
    const tone = ratioTone(facts.pct);
    if (tone) pct.className = tone;
    detail.append(pct, document.createTextNode(` · ${facts.boxes} ${facts.boxes === 1 ? "caixa" : "caixas"}`));
  } else {
    detail.textContent = "Ainda sem intervalos";
  }
  copy.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "continue-actions";
  const report = document.createElement("button");
  report.type = "button";
  report.className = "btn-quiet";
  report.textContent = "Relatório";
  report.disabled = !facts;
  report.addEventListener("click", async () => {
    await openHole(hole.id);
    await printView("report");
  });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Continuar";
  button.addEventListener("click", () => openHole(hole.id));
  actions.append(report, button);
  bar.hidden = false;
  bar.replaceChildren(copy, actions);
}

function renderHome() {
  const catalog = document.getElementById("home-catalog");
  if (!catalog) return;
  const query = (document.getElementById("home-search")?.value || "").trim().toLowerCase();
  const onlyCore = Boolean(document.getElementById("home-with-core")?.checked);
  const active = currentHole();
  renderContinue(active);

  const known = holes
    .map((hole, index) => ({ hole, index, label: surveyLabel(hole, index) }))
    .filter(({ hole }) => hole.name.trim() || hole.items.length);
  const rows = known
    .filter(({ label }) => !query || label.toLowerCase().includes(query))
    .filter(({ hole }) => !onlyCore || hole.items.length > 0);
  const count = document.getElementById("home-count");
  if (count) {
    count.replaceChildren();
    if (!known.length) {
      count.hidden = true;
    } else {
      count.hidden = false;
      const strong = document.createElement("strong");
      const caption = document.createElement("span");
      const narrowed = Boolean(query) || onlyCore;
      strong.textContent = String(narrowed ? rows.length : known.length);
      caption.textContent = narrowed
        ? (rows.length === 1 ? "furo nesta busca" : "furos nesta busca")
        : (known.length === 1 ? "furo neste navegador" : "furos neste navegador");
      count.append(strong, caption);
    }
  }

  catalog.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "survey-empty";
    empty.innerHTML = `<svg viewBox="0 0 48 28" aria-hidden="true"><rect x="1.5" y="1.5" width="45" height="25" rx="2"></rect><path d="M16.5 4.5v19M31.5 4.5v19"></path></svg>`;
    const title = document.createElement("p");
    const hint = document.createElement("p");
    if (query || onlyCore) {
      title.textContent = "Nenhuma sondagem corresponde a essa busca.";
      hint.textContent = "Limpe o filtro para ver os furos deste navegador.";
    } else {
      title.textContent = "Nenhuma sondagem neste navegador.";
      hint.textContent = "Crie um furo e lance o primeiro taquinho.";
    }
    empty.append(title, hint);
    catalog.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "survey-head";
  for (const label of ["Furo", "Profundidade", "Recuperação", "Caixas", "Atualização", ""]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.appendChild(cell);
  }
  const list = document.createElement("ul");
  list.className = "survey-list";
  for (const row of rows) {
    const item = document.createElement("li");
    item.className = "survey-row";
    if (row.hole.id === activeHoleId) item.classList.add("is-current");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "survey-open";
    const name = document.createElement("span");
    name.className = "survey-name";
    const nameText = document.createElement("b");
    nameText.textContent = row.label;
    name.appendChild(nameText);
    if (row.hole.id === activeHoleId) {
      const badge = document.createElement("span");
      badge.className = "survey-badge";
      badge.textContent = "Aberto";
      name.appendChild(badge);
    }
    if (row.hole.ended) {
      const fimBadge = document.createElement("span");
      fimBadge.className = "survey-badge";
      fimBadge.textContent = "Fim";
      name.appendChild(fimBadge);
    }
    const facts = holeFacts(row.hole);
    const depth = surveyFact("Profundidade", facts ? facts.depth : "—", facts ? "" : "is-empty");
    const recovery = surveyFact(
      "Recuperação",
      facts ? `${facts.recovery} · ${facts.ratio}` : "—",
      facts ? ratioTone(facts.pct) : "is-empty",
    );
    const boxes = surveyFact("Caixas", facts ? String(facts.boxes) : "—", facts ? "" : "is-empty");
    const touched = holeTouchedAt(row.hole.id);
    const when = document.createElement("time");
    when.className = "survey-when";
    const whenLabel = document.createElement("em");
    whenLabel.textContent = "Atualização";
    when.appendChild(whenLabel);
    if (touched) {
      const date = new Date(touched);
      when.dateTime = date.toISOString();
      when.append(document.createTextNode(date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })));
    } else {
      when.classList.add("is-empty");
      when.append(document.createTextNode("—"));
    }
    open.append(name);
    open.addEventListener("click", () => openHole(row.hole.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-quiet survey-delete";
    remove.textContent = "Excluir";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteListedHole(row.hole.id);
    });
    item.addEventListener("click", () => openHole(row.hole.id));
    item.append(open, depth, recovery, boxes, when, remove);
    list.appendChild(item);
  }
  const table = document.createElement("div");
  table.className = "survey-table";
  table.append(head, list);
  catalog.append(table);
}

function syncHoleInput() {
  const input = document.getElementById("hole-id");
  const hole = currentHole();
  if (input && hole && input.value !== hole.name) input.value = hole.name;
  refreshHoleSelect();
}

function persistHoles() {
  if (!logReady) return;
  const hole = currentHole();
  const input = document.getElementById("hole-id");
  if (hole) {
    if (input && document.activeElement !== input) hole.name = input.value.trim();
    hole.items = serializeLog(taquinhos);
  }
  localStorage.setItem(LOG_KEY, JSON.stringify({ version: 1, activeId: activeHoleId, holes }));
  localStorage.setItem(HOLE_KEY, hole?.name || "");
}

function loadHoles() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(LOG_KEY) || "null");
  } catch {
    stored = null;
  }
  if (stored && Array.isArray(stored.holes)) {
    holes = stored.holes.map(sanitizeHole).filter(Boolean);
    activeHoleId = holes.some((hole) => hole.id === stored.activeId) ? stored.activeId : holes[0]?.id || "";
  }
  if (!holes.length) {
    let name = "";
    try {
      name = localStorage.getItem(HOLE_KEY) || "";
    } catch {
      name = "";
    }
    const hole = { id: crypto.randomUUID(), name, items: [] };
    holes = [hole];
    activeHoleId = hole.id;
  }
  taquinhos = cloneItems(currentHole()?.items || []);
  logReady = true;
}

function clearListFilter() {
  const filter = document.getElementById("list-filter");
  if (filter) filter.value = "";
  for (const id of ["filter-from", "filter-to"]) {
    const input = document.getElementById(id);
    if (input) input.value = "";
  }
}

const HISTORY_KEY = "mmb-history";

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

function rememberChange(label) {
  if (!label || !activeHoleId || !logReady) return;
  const all = loadHistory();
  const list = Array.isArray(all[activeHoleId]) ? all[activeHoleId] : [];
  list.push({ at: Date.now(), label: String(label).slice(0, 80) });
  all[activeHoleId] = list.slice(-30);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch {
    /* o histórico é auxiliar; o furo continua salvo */
  }
  renderHistory();
}

function renderHistory() {
  const box = document.getElementById("change-log");
  const list = document.getElementById("change-list");
  if (!box || !list) return;
  const items = (Array.isArray(loadHistory()[activeHoleId]) ? loadHistory()[activeHoleId] : [])
    .slice()
    .reverse()
    .slice(0, 8);
  box.hidden = items.length === 0;
  list.replaceChildren();
  for (const item of items) {
    if (!item || typeof item.at !== "number" || typeof item.label !== "string") continue;
    const li = document.createElement("li");
    const time = document.createElement("time");
    const when = new Date(item.at);
    time.dateTime = when.toISOString();
    time.textContent = when.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    li.append(time, document.createTextNode(` ${item.label}`));
    list.appendChild(li);
  }
}

function usedChannels(intervals) {
  let maxIndex = -1;
  for (const interval of intervals) {
    const place = intervalBlock(interval);
    if (place) maxIndex = Math.max(maxIndex, place.box * CHANNELS + place.channel);
    if (interval.recuperacaoMm <= 0) continue;
    for (const seg of recoverySegments(interval.physicalInicialMm, interval.physicalFinalMm)) {
      maxIndex = Math.max(maxIndex, seg.channelIndex);
    }
  }
  const fim = fimMarker(intervals, Boolean(currentHole()?.ended));
  if (fim) maxIndex = Math.max(maxIndex, fim.box * CHANNELS + fim.channel);
  return maxIndex + 1;
}

function renderAudit(intervals) {
  const list = document.getElementById("audit-list");
  if (!list) return;
  const issues = auditIntervals(intervals).filter((issue) => issue.level === "erro");
  list.hidden = issues.length === 0;
  list.replaceChildren();
  for (const issue of issues) {
    const li = document.createElement("li");
    li.textContent = issue.text;
    if (issue.id) {
      li.tabIndex = 0;
      li.addEventListener("click", () => revealInterval(issue.id, { zoom: false }));
    }
    list.appendChild(li);
  }
}

function renderLithologyLegend(intervals) {
  const legend = document.getElementById("lithology-legend");
  if (!legend) return;
  const seen = new Map();
  for (const interval of intervals) {
    const name = interval.geo?.litologia?.trim();
    if (!name) continue;
    seen.set(name, normalizeHex(interval.color));
  }
  legend.hidden = seen.size === 0;
  legend.replaceChildren();
  for (const [name, color] of seen) {
    const li = document.createElement("li");
    const swatch = document.createElement("i");
    swatch.style.background = color;
    li.append(swatch, document.createTextNode(name));
    legend.appendChild(li);
  }
}

function readGeoForm(form) {
  return normalizeGeo({
    litologia: form.litologia?.value,
    alteracao: form.alteracao?.value,
    fraturamento: form.fraturamento?.value,
    mineralizacao: form.mineralizacao?.value,
    observacoes: form.observacoes?.value,
  });
}

function writeGeoForm(form, geo) {
  const value = normalizeGeo(geo);
  if (form.litologia) form.litologia.value = value.litologia;
  if (form.alteracao) form.alteracao.value = value.alteracao;
  if (form.fraturamento) form.fraturamento.value = value.fraturamento;
  if (form.mineralizacao) form.mineralizacao.value = value.mineralizacao;
  if (form.observacoes) form.observacoes.value = value.observacoes;
}

const GEO_FORM_KEY = "mmb-geo";

function geoFormEnabled() {
  try {
    return localStorage.getItem(GEO_FORM_KEY) === "1";
  } catch {
    return false;
  }
}

function applyGeoForm() {
  const on = geoFormEnabled();
  const box = document.getElementById("geo-fields");
  const button = document.getElementById("geo-toggle");
  if (box) box.hidden = !on;
  if (button) {
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.textContent = on ? "Desativar descrição geológica" : "Ativar descrição geológica";
    button.classList.toggle("is-on", on);
  }
}

function setHoleEnded(on) {
  const hole = currentHole();
  if (!hole) return;
  if (on && !taquinhos.length) {
    showError("Lance um intervalo antes de marcar o fim do furo.");
    return;
  }
  hole.ended = Boolean(on);
  showError("");
  showNote(on
    ? "Fim de furo marcado. O taquinho FIM não entra no avanço, na recuperação nem na profundidade."
    : "Fim de furo desmarcado.");
  renderAll();
}

function setGeoFormEnabled(on) {
  try {
    if (on) localStorage.setItem(GEO_FORM_KEY, "1");
    else localStorage.removeItem(GEO_FORM_KEY);
  } catch {
    /* a preferência é auxiliar; o furo continua salvo */
  }
  applyGeoForm();
}

function measuresDirty() {
  const form = document.getElementById("taquinho-form");
  if (!(form instanceof HTMLFormElement)) return false;
  return Boolean(String(form.avanco.value || "").trim() || String(form.recuperacao.value || "").trim());
}

function revealInterval(id, options = {}) {
  const interval = currentIntervals().find((item) => item.id === id);
  if (!interval) return;
  selectedId = id;
  const place = intervalBlock(interval);
  if (place) focusedBox = place.box;
  renderAll();
  if (place && options.zoom) {
    const box = layout.boxes[place.box];
    if (box) {
      camera.zoom = 3;
      camera.cx = box.ox + totalW / 2;
      camera.cy = yFromBase(box.y0, place.topStart - place.slotStart + 1);
      applyCamera();
    }
  } else if (place && !soloBox) {
    const box = layout.boxes[place.box];
    if (box) {
      const size = fullSize();
      camera.cx = box.ox + totalW / 2;
      camera.cy = size.h / 2;
      if (camera.zoom < 1.4) camera.zoom = Math.min(2.2, size.w / (totalW + BOX_GAP));
      applyCamera();
    }
  }
  document.querySelector(`#taquinho-list li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

function stepInterval(delta) {
  const intervals = currentIntervals();
  if (!intervals.length) return;
  const current = intervals.findIndex((item) => item.id === selectedId);
  const index = current < 0 ? (delta < 0 ? intervals.length - 1 : 0) : current + delta;
  const next = intervals[Math.min(intervals.length - 1, Math.max(0, index))];
  if (next) revealInterval(next.id, { zoom: false });
}

function locateDepth(mm, resultId) {
  const intervals = currentIntervals();
  const last = intervals[intervals.length - 1];
  const interval = findIntervalAtDepth(intervals, mm);
  if (!interval) {
    consulta = null;
    renderConsulta();
    showCalcResult(
      resultId,
      last
        ? `Essa profundidade não está em nenhum intervalo. O furo lançado vai até ${formatMeters(last.profundidadeFinalMm)}.`
        : "Ainda não há intervalos neste furo.",
      true,
    );
    return;
  }
  if (interval.recuperacaoMm === 0) {
    consulta = null;
    const place = intervalBlock(interval);
    selectedId = interval.id;
    revealInterval(interval.id, { zoom: true });
    showCalcResult(
      resultId,
      place
        ? `A profundidade ${formatMeters(mm)} cai no taquinho ${interval.index + 1} (${depthSpan(interval)}), sem testemunho recuperado. O taquinho está na caixa ${place.box + 1}, canaleta ${place.channel + 1}.`
        : `A profundidade ${formatMeters(mm)} cai no taquinho ${interval.index + 1} (${depthSpan(interval)}), sem testemunho recuperado.`,
      false,
    );
    return;
  }
  const tapeUm = tapeUmFromDepth(interval, mm);
  const physicalUm = interval.physicalInicialMm * 1000 + tapeUm;
  consulta = { depthUm: mm * 1000, tapeUm, physicalUm, intervalIndex: interval.index };
  revealInterval(interval.id, { zoom: true });
  const place = physicalPlace(physicalUm);
  const estimate = interval.avancoMm !== interval.recuperacaoMm ? " A posição no testemunho é uma estimativa, porque houve perda." : "";
  showCalcResult(
    resultId,
    `Taquinho ${interval.index + 1} (${depthSpan(interval)}), caixa ${place.box + 1}, canaleta ${place.channel + 1}, a ${formatCmUm(place.localUm)} da base.${estimate}`,
    false,
  );
}

function jumpTo(raw) {
  const text = String(raw || "").trim().toLocaleLowerCase("pt-BR");
  const intervals = currentIntervals();
  if (!text) return;
  if (!intervals.length) {
    showCalcResult("jump-result", "Lance um intervalo antes de localizar.", true);
    return;
  }
  const boxMatch = text.match(/caixa\s*(\d+)/);
  const channelMatch = text.match(/canaleta\s*(\d+)/);
  if (boxMatch || (channelMatch && !text.match(/\d+,\d+/) && !/taquinho/.test(text))) {
    const boxIndex = boxMatch ? Number(boxMatch[1]) - 1 : focusedBox ?? 0;
    const count = boxCount();
    if (boxIndex < 0 || boxIndex >= count) {
      showCalcResult("jump-result", `Não há caixa ${boxIndex + 1}. Este furo usa ${count} caixa(s).`, true);
      return;
    }
    focusBox(boxIndex);
    if (channelMatch) {
      const channel = Number(channelMatch[1]) - 1;
      const box = layout.boxes[boxIndex];
      if (channel < 0 || channel > 2 || !box) {
        showCalcResult("jump-result", "Cada caixa tem as canaletas 1, 2 e 3.", true);
        return;
      }
      camera.zoom = Math.max(camera.zoom, 2.4);
      camera.cx = box.channelX[channel] + CHANNEL_W / 2;
      camera.cy = fullSize().h / 2;
      applyCamera();
      showCalcResult("jump-result", `Caixa ${boxIndex + 1}, canaleta ${channel + 1}.`, false);
      return;
    }
    showCalcResult("jump-result", `Caixa ${boxIndex + 1}.`, false);
    return;
  }
  const tagMatch = text.match(/taquinho\s*(\d+)/);
  if (tagMatch) {
    const interval = intervals[Number(tagMatch[1]) - 1];
    if (!interval) {
      showCalcResult("jump-result", "Esse taquinho não existe neste furo.", true);
      return;
    }
    revealInterval(interval.id, { zoom: true });
    const where = interval.recuperacaoMm > 0 ? "" : " Sem testemunho recuperado; o taquinho marca o fim da manobra.";
    showCalcResult("jump-result", `Taquinho ${interval.index + 1}, ${depthSpan(interval)}.${where}`, interval.recuperacaoMm <= 0);
    return;
  }
  const parsed = parseMetersToMm(text.replace(/m$/i, "").trim());
  if (!parsed.ok) {
    showCalcResult("jump-result", "Informe uma profundidade, como 12,50, ou escreva caixa 2 ou taquinho 4.", true);
    return;
  }
  locateDepth(parsed.mm, "jump-result");
}

const PHOTO_DB = "pandora-photos";
let thumbUrl = "";

function photoKey(itemId, holeId = activeHoleId) {
  return `${holeId}:${itemId}`;
}

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPhoto(itemId) {
  try {
    const db = await openPhotoDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const request = tx.objectStore("photos").get(photoKey(itemId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return record && record.blob ? record : null;
  } catch {
    return null;
  }
}

async function writePhoto(itemId, blob, note) {
  const db = await openPhotoDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put({ blob, note: String(note || "").slice(0, 200), at: Date.now() }, photoKey(itemId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deletePhoto(itemId, holeId = activeHoleId) {
  try {
    const db = await openPhotoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").delete(photoKey(itemId, holeId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* a foto é auxiliar; o intervalo segue sem ela */
  }
}

async function deleteHolePhotos(holeId) {
  try {
    const db = await openPhotoDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const request = tx.objectStore("photos").getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      const store = tx.objectStore("photos");
      for (const key of keys) {
        if (String(key).startsWith(`${holeId}:`)) store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* sem fotos para remover */
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) reject(new Error("foto"));
          else resolve(blob);
        },
        "image/jpeg",
        0.72,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("foto"));
    };
    image.src = url;
  });
}

function renderIntervalPanel() {
  const panel = document.getElementById("interval-panel");
  if (!panel) return;
  const interval = currentIntervals().find((item) => item.id === selectedId);
  if (!interval) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const title = document.getElementById("interval-panel-title");
  if (title) title.textContent = `Taquinho ${interval.index + 1}`;
  const body = document.getElementById("interval-panel-body");
  if (body) {
    body.replaceChildren();
    const place = intervalBlock(interval);
    const rows = [
      ["Profundidade", depthSpan(interval)],
      ["Avanço", formatMeters(interval.avancoMm)],
      ["Recuperação", formatMeters(interval.recuperacaoMm)],
      ["Percentual", formatRatio(interval.avancoMm, interval.recuperacaoMm)],
      ["Na caixa", place ? `Caixa ${place.box + 1} · canaleta ${place.channel + 1}` : "Sem testemunho"],
    ];
    if (interval.geo?.litologia) rows.push(["Litologia", interval.geo.litologia]);
    if (interval.geo?.alteracao) rows.push(["Alteração", interval.geo.alteracao]);
    if (interval.geo?.fraturamento) rows.push(["Fraturamento", interval.geo.fraturamento]);
    if (interval.geo?.mineralizacao) rows.push(["Mineralização", interval.geo.mineralizacao]);
    if (interval.geo?.observacoes) rows.push(["Observações", interval.geo.observacoes]);
    if (interval.info) rows.push(["Informação", interval.info]);
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      body.append(dt, dd);
    }
  }
  loadPanelPhoto(interval.id);
}

async function loadPanelPhoto(itemId) {
  const slot = document.getElementById("interval-photo");
  if (!slot) return;
  slot.replaceChildren();
  const record = await readPhoto(itemId);
  if (selectedId !== itemId) return;
  if (!record) {
    const empty = document.createElement("p");
    empty.className = "photo-empty";
    empty.textContent = "Nenhuma fotografia neste intervalo.";
    slot.appendChild(empty);
    return;
  }
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(record.blob);
  const image = document.createElement("img");
  image.src = thumbUrl;
  image.alt = "Fotografia do intervalo";
  image.addEventListener("click", () => openPhoto(itemId));
  slot.appendChild(image);
  if (record.note) {
    const note = document.createElement("p");
    note.textContent = record.note;
    slot.appendChild(note);
  }
}

async function openPhoto(itemId) {
  const record = await readPhoto(itemId);
  const dialog = document.getElementById("photo-dialog");
  const image = document.getElementById("photo-full");
  const note = document.getElementById("photo-note");
  if (!record || !(dialog instanceof HTMLDialogElement) || !(image instanceof HTMLImageElement) || !(note instanceof HTMLTextAreaElement)) return;
  const url = URL.createObjectURL(record.blob);
  image.src = url;
  note.value = record.note || "";
  dialog.showModal();
  let removed = false;
  const finish = async () => {
    if (!removed && note.value.trim() !== (record.note || "")) {
      try {
        await writePhoto(itemId, record.blob, note.value.trim());
        rememberChange("Observação da fotografia atualizada");
      } catch {
        showError("Não foi possível guardar a observação da fotografia.");
      }
    }
    URL.revokeObjectURL(url);
    if (selectedId === itemId) loadPanelPhoto(itemId);
  };
  const remove = document.getElementById("photo-remove");
  if (remove) {
    remove.onclick = async (event) => {
      event.preventDefault();
      const ok = await askConfirm("Remover a fotografia deste intervalo?", "Remover");
      if (!ok) return;
      removed = true;
      await deletePhoto(itemId);
      rememberChange("Fotografia removida");
      dialog.close();
    };
  }
  dialog.addEventListener("close", () => {
    if (remove) remove.onclick = null;
    finish();
  }, { once: true });
}

let photoTargetId = null;

async function openIntervalPhoto(itemId) {
  const record = await readPhoto(itemId);
  if (record) {
    openPhoto(itemId);
    return;
  }
  photoTargetId = itemId;
  document.getElementById("interval-photo-file")?.click();
}

async function attachPhoto(itemId, file) {
  if (!file || !file.type.startsWith("image/")) {
    showError("Escolha um arquivo de imagem.");
    return;
  }
  try {
    const blob = await compressImage(file);
    const current = await readPhoto(itemId);
    await writePhoto(itemId, blob, current?.note || "");
    rememberChange("Fotografia anexada");
    showNote("Fotografia guardada neste navegador, ligada a este intervalo.");
    if (selectedId === itemId) loadPanelPhoto(itemId);
  } catch {
    showError("Não foi possível guardar a fotografia.");
  }
}

async function confirmDiscardDraft() {
  if (!measuresDirty() && !editingId) return true;
  return askConfirm("Há valores no formulário que ainda não foram salvos. Continuar e descartá-los?", "Descartar");
}

async function openHole(id) {
  if (!id) return;
  if (id !== activeHoleId) {
    if (!(await confirmDiscardDraft())) {
      syncHoleInput();
      return;
    }
    persistHoles();
    const next = holes.find((hole) => hole.id === id);
    if (!next) return;
    activeHoleId = next.id;
    taquinhos = cloneItems(next.items);
    undoStack.length = 0;
    freshId = null;
    selectedId = null;
    focusedBox = null;
    clearListFilter();
    beginEdit(null);
    clearConsulta();
    syncHoleInput();
    showNote(next.name.trim() ? `Furo ${next.name.trim()} aberto.` : "Furo sem nome aberto.");
    renderAll();
  }
  showWorkspace();
}

async function createHole() {
  const hole = currentHole();
  if (hole && !taquinhos.length && !hole.name.trim()) {
    showWorkspace();
    document.getElementById("hole-id")?.focus();
    return;
  }
  if (!(await confirmDiscardDraft())) return;
  persistHoles();
  const created = { id: crypto.randomUUID(), name: "", items: [] };
  holes.push(created);
  activeHoleId = created.id;
  taquinhos = [];
  undoStack.length = 0;
  freshId = null;
  selectedId = null;
  focusedBox = null;
  clearListFilter();
  beginEdit(null);
  clearConsulta();
  syncHoleInput();
  showNote("Novo furo. Dê um nome e lance o primeiro taquinho.");
  renderAll();
  showWorkspace();
  document.getElementById("hole-id")?.focus();
}

async function deleteListedHole(id) {
  const hole = holes.find((item) => item.id === id);
  if (!hole) return;
  if (measuresDirty() || editingId) {
    if (!(await confirmDiscardDraft())) return;
    beginEdit(null);
  }
  const label = hole.name.trim() || "sem nome";
  const ok = await askConfirm(`Excluir o furo ${label} e os taquinhos dele neste navegador?`, "Excluir");
  if (!ok) return;
  const removingActive = id === activeHoleId;
  holes = holes.filter((item) => item.id !== id);
  deleteHolePhotos(id);
  if (!holes.length) holes.push({ id: crypto.randomUUID(), name: "", items: [] });
  if (removingActive) {
    activeHoleId = holes[0].id;
    taquinhos = cloneItems(holes[0].items);
    undoStack.length = 0;
    freshId = null;
    selectedId = null;
    focusedBox = null;
    clearListFilter();
    beginEdit(null);
    clearConsulta();
  }
  syncHoleInput();
  persistHoles();
  showNote("Furo excluído deste navegador.");
  renderAll();
  showHome();
}

async function deleteHole() {
  const hole = currentHole();
  const label = hole?.name.trim() || "sem nome";
  if (!(await confirmDiscardDraft())) return;
  const ok = await askConfirm(`Excluir o furo ${label} e os taquinhos dele neste navegador?`, "Excluir");
  if (!ok) return;
  const removedId = activeHoleId;
  holes = holes.filter((item) => item.id !== removedId);
  deleteHolePhotos(removedId);
  if (!holes.length) holes.push({ id: crypto.randomUUID(), name: "", items: [] });
  activeHoleId = holes[0].id;
  taquinhos = cloneItems(holes[0].items);
  undoStack.length = 0;
  freshId = null;
  selectedId = null;
  focusedBox = null;
  clearListFilter();
  beginEdit(null);
  clearConsulta();
  syncHoleInput();
  showNote("Furo excluído deste navegador.");
  renderAll();
}

function snapshotLog(label) {
  undoStack.push(JSON.stringify(serializeLog(taquinhos)));
  if (undoStack.length > 40) undoStack.shift();
  if (label) rememberChange(label);
  syncLogActions();
}

function undoLog() {
  const raw = undoStack.pop();
  if (!raw) return;
  beginEdit(null);
  selectedId = null;
  freshId = null;
  taquinhos = sanitizeStored(JSON.parse(raw));
  clearConsulta();
  rememberChange("Alteração desfeita");
  showNote("Alteração desfeita.");
  renderAll();
}

function beginEdit(id) {
  const form = document.getElementById("taquinho-form");
  const heading = document.getElementById("form-heading");
  const submit = document.getElementById("taquinho-submit");
  const cancel = document.getElementById("edit-cancel");
  const item = id ? taquinhos.find((entry) => entry.id === id) : null;
  editingId = item ? item.id : null;
  const entry = form?.closest(".entry-block");
  if (!form || !item) {
    editingId = null;
    entry?.classList.remove("is-editing");
    if (heading) heading.textContent = "Novo taquinho";
    if (submit) submit.textContent = "Adicionar taquinho";
    if (cancel) cancel.hidden = true;
    syncLogActions();
    return;
  }
  entry?.classList.add("is-editing");
  form.avanco.value = metersLabel(item.avancoMm);
  form.recuperacao.value = metersLabel(item.recuperacaoMm);
  form.info.value = item.info || "";
  writeGeoForm(form, item.geo);
  selectMaterialColor(item.color);
  if (heading) heading.textContent = `Editar taquinho ${taquinhos.indexOf(item) + 1}`;
  if (submit) submit.textContent = "Salvar taquinho";
  if (cancel) cancel.hidden = false;
  showError("");
  showNote("Salvar recalcula a profundidade e a posição dos intervalos seguintes. O formulário guarda o que você já digitou até salvar ou cancelar.");
  renderAll();
  document.getElementById("form-title")?.scrollIntoView({ block: "nearest" });
  form.avanco.focus();
}

function showInterval(id) {
  revealInterval(id, { zoom: true });
}

function intervalLine(interval) {
  const place = intervalBlock(interval);
  const where = place ? `caixa ${place.box + 1}, canaleta ${place.channel + 1}` : "sem testemunho";
  const inbox = interval.recuperacaoMm > 0
    ? `${metersLabel(interval.physicalInicialMm)}–${formatMeters(interval.physicalFinalMm)}`
    : "—";
  const geo = interval.geo?.litologia ? ` · ${interval.geo.litologia}` : "";
  return `${interval.index + 1}. P ${depthSpan(interval)} · A ${formatMeters(interval.avancoMm)} · R ${formatMeters(interval.recuperacaoMm)} (${formatRatio(interval.avancoMm, interval.recuperacaoMm)}) · na caixa ${inbox} · ${where}${geo}${interval.info ? ` · ${interval.info}` : ""}`;
}

function reportText() {
  const intervals = currentIntervals();
  const name = currentHole()?.name.trim() || "Sem nome";
  const last = intervals[intervals.length - 1];
  if (!last) return "";
  const lines = [
    `Pandora · Furo ${name}`,
    `Avanço ${formatMeters(last.profundidadeFinalMm)}`,
    `Recuperação ${formatMeters(last.recuperacaoFinalMm)} (${formatRatio(last.profundidadeFinalMm, last.recuperacaoFinalMm)})`,
    `Caixas ${boxCount()}`,
    "",
  ];
  for (const interval of intervals) lines.push(intervalLine(interval));
  if (currentHole()?.ended) lines.push("Fim de furo");
  return lines.join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadTable() {
  const hole = currentHole();
  const intervals = currentIntervals();
  if (!hole || !intervals.length) return;
  const name = hole.name.trim() || "Sem nome";
  const rows = [[
    "Furo",
    "Taquinho",
    "Profundidade",
    "Avanço",
    "Recuperação",
    "Na caixa",
    "Caixa",
    "Canaleta",
    "Percentual",
    "Cor",
    "Informação",
    "Litologia",
    "Alteração",
    "Fraturamento",
    "Mineralização",
    "Observações",
  ]];
  for (const interval of intervals) {
    const place = intervalBlock(interval);
    const inbox = interval.recuperacaoMm > 0
      ? `${metersLabel(interval.physicalInicialMm)}–${formatMeters(interval.physicalFinalMm)}`
      : "";
    rows.push([
      name,
      String(interval.index + 1),
      depthSpan(interval),
      formatMeters(interval.avancoMm),
      formatMeters(interval.recuperacaoMm),
      inbox,
      place ? String(place.box + 1) : "",
      place ? String(place.channel + 1) : "",
      formatRatio(interval.avancoMm, interval.recuperacaoMm),
      materialName(normalizeHex(interval.color)),
      interval.info || "",
      interval.geo?.litologia || "",
      interval.geo?.alteracao || "",
      interval.geo?.fraturamento || "",
      interval.geo?.mineralizacao || "",
      interval.geo?.observacoes || "",
    ]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const safe = (hole.name.trim() || "furo").replace(/[^\p{L}\p{N}._-]+/gu, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `${safe}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showNote("Tabela do furo gerada.");
}

async function copyIntervalLine(interval) {
  try {
    await navigator.clipboard.writeText(intervalLine(interval));
    showNote("Intervalo copiado.");
  } catch {
    showError("Não foi possível copiar o intervalo.");
  }
}

function downloadHole() {
  const hole = currentHole();
  if (!hole || !taquinhos.length) return;
  persistHoles();
  const payload = { name: hole.name, items: hole.items };
  if (hole.ended) payload.ended = true;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  const safe = (hole.name.trim() || "furo").replace(/[^\p{L}\p{N}._-]+/gu, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `${safe}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showNote("Arquivo do furo gerado. Fotografias, se houver, continuam só neste navegador.");
}

function importHoleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result || ""));
      const items = sanitizeStored(raw?.items || raw?.taquinhos);
      if (!items.length) {
        showError("O arquivo não tem taquinhos válidos.");
        return;
      }
      if (items.some((item) => item.recuperacaoMm > item.avancoMm)) {
        showError(RECOVERY_LIMIT_MESSAGE);
        return;
      }
      persistHoles();
      const hole = {
        id: crypto.randomUUID(),
        name: String(raw?.name || raw?.furo || "Importado").slice(0, 32),
        items,
        ended: raw?.ended === true,
      };
      holes.push(hole);
      activeHoleId = hole.id;
      taquinhos = cloneItems(items);
      undoStack.length = 0;
      freshId = null;
      selectedId = null;
      focusedBox = null;
      clearListFilter();
      beginEdit(null);
      clearConsulta();
      syncHoleInput();
      showError("");
      showNote(`Furo ${hole.name || "importado"} aberto a partir do arquivo.`);
      renderAll();
      showWorkspace();
    } catch {
      showError("Não foi possível ler esse arquivo.");
    }
  };
  reader.readAsText(file);
}

function repeatLast() {
  const last = taquinhos[taquinhos.length - 1];
  if (!last || editingId) return;
  if (recoveryExceedsAdvance(last.avancoMm, last.recuperacaoMm)) {
    showError(RECOVERY_LIMIT_MESSAGE);
    return;
  }
  snapshotLog("Intervalo repetido");
  const id = crypto.randomUUID();
  freshId = id;
  taquinhos.push({
    id,
    avancoMm: last.avancoMm,
    recuperacaoMm: last.recuperacaoMm,
    info: last.info,
    color: last.color,
    geo: normalizeGeo(last.geo),
  });
  clearConsulta();
  showNote("Último intervalo repetido.");
  renderAll();
  document.querySelector("#taquinho-list li.is-fresh")?.scrollIntoView({ block: "nearest" });
}

async function clearHole() {
  if (!taquinhos.length) return;
  const label = currentHole()?.name.trim() || "sem nome";
  const ok = await askConfirm(`Apagar todos os taquinhos do furo ${label}? O furo continua salvo, vazio.`, "Apagar");
  if (!ok) return;
  snapshotLog("Taquinhos apagados");
  taquinhos = [];
  freshId = null;
  selectedId = null;
  beginEdit(null);
  clearConsulta();
  showNote("Taquinhos apagados. Use Desfazer para recuperar.");
  renderAll();
}

async function copyReport() {
  const text = reportText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showNote("Resumo copiado.");
  } catch {
    showError("Não foi possível copiar o resumo.");
  }
}

async function fillPrintSheet(mode) {
  const sheet = document.getElementById("print-sheet");
  if (!sheet) return;
  const intervals = currentIntervals();
  const name = currentHole()?.name.trim() || "Sem nome";
  const last = intervals[intervals.length - 1];
  const boxIndex = focusedBox ?? 0;
  const rows = intervals.filter((interval) => {
    if (mode !== "sheet") return true;
    const place = intervalBlock(interval);
    if (interval.recuperacaoMm <= 0) return Boolean(place && place.box === boxIndex);
    return recoverySegments(interval.physicalInicialMm, interval.physicalFinalMm).some((seg) => seg.box === boxIndex);
  });
  const title = mode === "sheet" ? `Ficha da caixa ${String(boxIndex + 1).padStart(2, "0")}` : "Relatório da sondagem";
  const head = last
    ? `Avanço ${formatMeters(last.profundidadeFinalMm)} · Recuperação ${formatMeters(last.recuperacaoFinalMm)} · ${formatRatio(last.profundidadeFinalMm, last.recuperacaoFinalMm)} · ${boxCount()} caixa(s) · ${usedChannels(intervals)} canaleta(s)`
    : "Nenhum intervalo lançado.";
  sheet.replaceChildren();
  const h1 = document.createElement("h1");
  h1.textContent = `Pandora · ${name}`;
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const summary = document.createElement("p");
  summary.textContent = head;
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>#</th><th>Profundidade</th><th>Avanço</th><th>Recuperação</th><th>%</th><th>Posição</th><th>Descrição</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const interval of rows) {
    const place = intervalBlock(interval);
    const where = place ? `Caixa ${place.box + 1}, canaleta ${place.channel + 1}` : "Sem testemunho";
    const geo = [
      interval.geo?.litologia,
      interval.geo?.alteracao ? `alteração ${interval.geo.alteracao}` : "",
      interval.geo?.fraturamento ? `fraturamento ${interval.geo.fraturamento}` : "",
      interval.geo?.mineralizacao,
      interval.geo?.observacoes,
      interval.info,
    ].filter(Boolean).join(" · ");
    const tr = document.createElement("tr");
    for (const value of [
      String(interval.index + 1),
      depthSpan(interval),
      formatMeters(interval.avancoMm),
      formatMeters(interval.recuperacaoMm),
      formatRatio(interval.avancoMm, interval.recuperacaoMm),
      where,
      geo,
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  sheet.append(h1, h2, summary, table);
  const fim = fimMarker(intervals, Boolean(currentHole()?.ended));
  if (fim && (mode !== "sheet" || fim.box === boxIndex)) {
    const fimNote = document.createElement("p");
    fimNote.textContent = `Fim de furo. Taquinho FIM na caixa ${fim.box + 1}, canaleta ${fim.channel + 1}. Não altera avanço, recuperação nem profundidade.`;
    sheet.append(fimNote);
  }
  const issues = auditIntervals(intervals).filter((issue) => issue.level === "erro");
  if (issues.length) {
    const issuesTitle = document.createElement("h2");
    issuesTitle.textContent = "Inconsistências";
    const list = document.createElement("ul");
    for (const issue of issues) {
      const li = document.createElement("li");
      li.textContent = issue.text;
      list.appendChild(li);
    }
    sheet.append(issuesTitle, list);
  }
  if (mode === "sheet") {
    for (const interval of rows) {
      const record = await readPhoto(interval.id);
      if (!record) continue;
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = URL.createObjectURL(record.blob);
      image.alt = `Fotografia do taquinho ${interval.index + 1}`;
      const caption = document.createElement("figcaption");
      caption.textContent = `Taquinho ${interval.index + 1}${record.note ? ` · ${record.note}` : ""}`;
      figure.append(image, caption);
      sheet.appendChild(figure);
    }
  }
  const foot = document.createElement("p");
  foot.className = "print-foot";
  foot.textContent = "Para um PDF, escolha Salvar como PDF no destino da impressão. O zero da caixa fica na base e o testemunho sobe.";
  sheet.appendChild(foot);
}

async function printView(mode) {
  const previousSolo = soloBox;
  const previousFocus = focusedBox;
  document.body.dataset.print = mode;
  if (mode === "one" || mode === "sheet") {
    if (focusedBox == null) focusedBox = 0;
    soloBox = true;
    renderAll();
    fitCamera();
  }
  if (mode === "report" || mode === "sheet") await fillPrintSheet(mode);
  const done = () => {
    window.removeEventListener("afterprint", done);
    document.body.removeAttribute("data-print");
    document.querySelectorAll("#print-sheet img").forEach((image) => {
      if (image instanceof HTMLImageElement && image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
    });
    soloBox = previousSolo;
    focusedBox = previousFocus;
    renderAll();
    const button = document.getElementById("view-solo");
    if (button) {
      button.textContent = soloBox ? "Todas as caixas" : "Uma caixa";
      button.setAttribute("aria-pressed", soloBox ? "true" : "false");
    }
  };
  window.addEventListener("afterprint", done);
  window.print();
}

function bindHole() {
  loadHoles();
  syncHoleInput();
  const input = document.getElementById("hole-id");
  input?.addEventListener("input", () => {
    const hole = currentHole();
    if (!hole || !input) return;
    hole.name = input.value.slice(0, 32);
    refreshHoleSelect();
    persistHoles();
  });
  input?.addEventListener("change", () => {
    const hole = currentHole();
    if (!hole || !input) return;
    hole.name = input.value.trim();
    input.value = hole.name;
    refreshHoleSelect();
    persistHoles();
  });
  document.getElementById("hole-new")?.addEventListener("click", createHole);
  document.getElementById("hole-delete")?.addEventListener("click", deleteHole);
  document.getElementById("home-open")?.addEventListener("click", () => showHome());
  document.getElementById("home-search")?.addEventListener("input", () => renderHome());
  document.getElementById("home-with-core")?.addEventListener("change", () => renderHome());
  document.getElementById("home-import")?.addEventListener("click", () => {
    document.getElementById("hole-file")?.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!document.body.classList.contains("is-home")) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    document.getElementById("home-search")?.focus();
  });
  document.getElementById("repeat-last")?.addEventListener("click", repeatLast);
  document.getElementById("undo-log")?.addEventListener("click", undoLog);
  document.getElementById("copy-report")?.addEventListener("click", () => {
    copyReport();
  });
  document.getElementById("download-hole")?.addEventListener("click", downloadHole);
  document.getElementById("download-table")?.addEventListener("click", downloadTable);
  document.getElementById("print-hole")?.addEventListener("click", () => {
    printView("boxes");
  });
  document.getElementById("print-one")?.addEventListener("click", () => {
    printView("one");
  });
  document.getElementById("print-report")?.addEventListener("click", () => {
    printView("report");
  });
  document.getElementById("print-sheet-btn")?.addEventListener("click", () => {
    printView("sheet");
  });
  document.getElementById("import-hole")?.addEventListener("click", () => {
    document.getElementById("hole-file")?.click();
  });
  document.getElementById("hole-file")?.addEventListener("change", (event) => {
    const fileInput = event.currentTarget;
    if (!(fileInput instanceof HTMLInputElement)) return;
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) importHoleFile(file);
  });
  document.getElementById("clear-hole")?.addEventListener("click", clearHole);
  if (document.documentElement.classList.contains("resume-work")) showWorkspace();
  else showHome();
  document.getElementById("edit-cancel")?.addEventListener("click", () => {
    const form = document.getElementById("taquinho-form");
    beginEdit(null);
    if (form instanceof HTMLFormElement) {
      form.avanco.value = "";
      form.recuperacao.value = "";
      form.info.value = "";
      writeGeoForm(form, {});
    }
    showNote("");
    renderAll();
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    event.preventDefault();
    undoLog();
  });
}

function askConfirm(message, okLabel) {
  const dialog = document.getElementById("confirm-dialog");
  const text = document.getElementById("confirm-message");
  const ok = document.getElementById("confirm-ok");
  if (!(dialog instanceof HTMLDialogElement) || !text || !ok) return Promise.resolve(window.confirm(message));
  if (dialog.open) return Promise.resolve(false);
  text.textContent = message;
  ok.textContent = okLabel || "Confirmar";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

function setTrayExpanded(expanded) {
  const workspace = document.querySelector(".workspace");
  const button = document.getElementById("tray-expand");
  workspace?.classList.toggle("is-wide", expanded);
  document.body.classList.toggle("tray-wide", expanded);
  if (button) {
    button.textContent = expanded ? "Reduzir" : "Ampliar";
    button.setAttribute("aria-pressed", expanded ? "true" : "false");
  }
  requestAnimationFrame(() => layoutTaquinhoFaces());
}

function closeHoleMenu() {
  const more = document.getElementById("hole-menu-open");
  const actions = document.getElementById("log-actions");
  if (!more || !actions || actions.hidden) return;
  actions.hidden = true;
  more.setAttribute("aria-expanded", "false");
}

function bindChrome() {
  document.getElementById("password-toggle")?.addEventListener("click", (event) => {
    event.preventDefault();
    const input = document.getElementById("login-password");
    const button = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-pressed", show ? "true" : "false");
    button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
  });

  document.querySelectorAll(".fold-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const body = document.getElementById(button.getAttribute("aria-controls") || "");
      if (!body || !(button instanceof HTMLButtonElement)) return;
      const collapse = button.getAttribute("aria-expanded") !== "false";
      button.setAttribute("aria-expanded", collapse ? "false" : "true");
      const label = button.getAttribute("aria-label") || "";
      button.setAttribute("aria-label", collapse ? label.replace(/^Recolher/, "Mostrar") : label.replace(/^Mostrar/, "Recolher"));
      body.hidden = collapse;
    });
  });

  document.getElementById("tray-expand")?.addEventListener("click", () => {
    setTrayExpanded(!document.querySelector(".workspace.is-wide"));
  });
  document.getElementById("shortcuts-open")?.addEventListener("click", () => {
    const dialog = document.getElementById("shortcuts-dialog");
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  });
  document.getElementById("list-filter")?.addEventListener("input", () => {
    renderList(currentIntervals());
  });
  for (const id of ["filter-from", "filter-to"]) {
    document.getElementById(id)?.addEventListener("input", () => {
      renderList(currentIntervals());
    });
  }

  const menu = document.getElementById("hole-menu");
  const more = document.getElementById("hole-menu-open");
  const actions = document.getElementById("log-actions");
  more?.addEventListener("click", () => {
    if (!actions || !(more instanceof HTMLButtonElement)) return;
    const open = more.getAttribute("aria-expanded") === "true";
    if (open) {
      closeHoleMenu();
      return;
    }
    actions.hidden = false;
    more.setAttribute("aria-expanded", "true");
    const theme = document.getElementById("theme-panel");
    const themeOpen = document.getElementById("theme-open");
    if (theme) theme.hidden = true;
    themeOpen?.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("pointerdown", (event) => {
    if (!actions || actions.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (menu?.contains(target)) return;
    closeHoleMenu();
  });
  actions?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("button")) return;
    closeHoleMenu();
  });

  applyGeoForm();
  document.getElementById("geo-toggle")?.addEventListener("click", () => {
    setGeoFormEnabled(!geoFormEnabled());
  });
  document.getElementById("fim-toggle")?.addEventListener("click", () => {
    setHoleEnded(!currentHole()?.ended);
  });
  document.getElementById("view-solo")?.addEventListener("click", () => {
    soloBox = !soloBox;
    const button = document.getElementById("view-solo");
    if (button) {
      button.textContent = soloBox ? "Todas as caixas" : "Uma caixa";
      button.setAttribute("aria-pressed", soloBox ? "true" : "false");
    }
    if (soloBox && focusedBox == null) focusedBox = 0;
    renderAll();
    fitCamera();
  });
  document.getElementById("jump-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("jump-query");
    if (input instanceof HTMLInputElement) jumpTo(input.value);
  });
  document.getElementById("interval-close")?.addEventListener("click", () => {
    selectedId = null;
    renderAll();
  });
  document.getElementById("interval-edit")?.addEventListener("click", () => {
    if (selectedId) beginEdit(selectedId);
  });
  document.getElementById("interval-prev")?.addEventListener("click", () => stepInterval(-1));
  document.getElementById("interval-next")?.addEventListener("click", () => stepInterval(1));
  document.getElementById("interval-photo-file")?.addEventListener("change", (event) => {
    const input = event.currentTarget;
    const itemId = photoTargetId;
    photoTargetId = null;
    if (!(input instanceof HTMLInputElement) || !itemId) return;
    const file = input.files?.[0];
    input.value = "";
    if (file) attachPhoto(itemId, file);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!measuresDirty() && !editingId) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

if (typeof document !== "undefined") {
  bindPalette();
  bindAuth();
  bindTheme();
  bindHole();
  bindChrome();
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
    yFromBase,
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
    meterSlices,
    auditIntervals,
    fimMarker,
    meterMarkPositions,
    normalizeGeo,
    geoIsEmpty,
  };
}

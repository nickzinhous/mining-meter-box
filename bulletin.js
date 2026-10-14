function tag(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cssContent(value) {
  return String(value || "").replace(/[\\"<>\n\r]/g, " ").slice(0, 80);
}

function bulletinWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sectionKicker(model) {
  return `${model.name || "Sem nome"} · ${bulletinWhen(model.generatedAt)}`;
}

function bulletinSection(id, title, model) {
  const section = tag("section", "bulletin-section");
  section.id = `boletim-${id}`;
  section.append(tag("p", "section-kicker", sectionKicker(model)));
  if (title) section.append(tag("h2", "", title));
  return section;
}

function statCard(label, value, tone) {
  const card = tag("article", tone ? `stat-card ${tone}` : "stat-card");
  card.append(tag("span", "", label), tag("strong", "", value));
  return card;
}

function drawTaquinhoCaptions(root) {
  root.querySelectorAll(".taquinho").forEach((node) => {
    const block = node.querySelector(".taquinho-block");
    if (!block) return;
    const lines = (node.getAttribute("data-label") || "").split("|").filter(Boolean).slice(0, 3);
    if (!lines.length) return;
    const x = Number(block.getAttribute("x"));
    const y = Number(block.getAttribute("y"));
    const w = Number(block.getAttribute("width"));
    const h = Number(block.getAttribute("height"));
    const font = lines.length > 2 ? 0.32 : 0.42;
    const step = font + 0.05;
    lines.forEach((line, index) => {
      const text = el("text", {
        x: x + w / 2,
        y: y + h / 2 + (index - (lines.length - 1) / 2) * step,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: "var(--taquinho-ink)",
        "font-size": font,
        "font-weight": "650",
        "font-family": "Inter, Segoe UI, system-ui, sans-serif",
      });
      text.textContent = line;
      node.appendChild(text);
    });
  });
}

function buildBulletinBox(parent, boxIndex, intervals, ended) {
  const previous = layout.boxes;
  layout.boxes = [];
  try {
    const vbW = PAD_L + totalW + PAD_R;
    const vbH = PAD_T + LABEL_BAND + LENGTH + PAD_B;
    const svg = el("svg", {
      class: "bulletin-box",
      viewBox: `0 0 ${vbW} ${vbH}`,
      width: String(vbW),
      height: String(vbH),
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
    });
    const title = el("title");
    title.textContent = `Caixa ${String(boxIndex + 1).padStart(2, "0")}. O zero fica na base.`;
    svg.append(title);
    parent.appendChild(svg);
    const root = el("g");
    svg.appendChild(root);
    drawBox(root, boxIndex, PAD_L);
    const cores = el("g");
    root.appendChild(cores);
    drawCores(cores, intervals, null);
    const tags = el("g");
    root.appendChild(tags);
    drawTaquinhos(tags, intervals, ended, null);
    drawTaquinhoCaptions(tags);
    drawMeterMarks(root, intervals);
  } finally {
    layout.boxes = previous;
  }
}

function chartText(svg, x, y, value, anchor) {
  const text = el("text", {
    x,
    y,
    "text-anchor": anchor || "start",
    fill: "#1c2430",
    "font-size": 8,
    "font-family": "Inter, Segoe UI, system-ui, sans-serif",
  });
  text.textContent = value;
  svg.appendChild(text);
}

function appendPairChart(parent, rows) {
  const width = 360;
  const labelW = 86;
  const plotW = 250;
  for (let start = 0; start < rows.length; start += 12) {
    const part = rows.slice(start, start + 12);
    const figure = tag("figure", "bulletin-chart");
    figure.append(tag("figcaption", "", start
      ? `Avanço e recuperação, intervalos ${part[0].n} a ${part[part.length - 1].n}.`
      : "Avanço e recuperação por intervalo. A barra clara é o avanço. A barra azul é a recuperação."));
    const height = 28 + part.length * 18;
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
    const max = Math.max(1, ...part.map((row) => Math.max(row.advanceMm, row.recoveryMm)));
    chartText(svg, labelW, 12, "0");
    chartText(svg, labelW + plotW, 12, formatMeters(max), "end");
    part.forEach((row, index) => {
      const y = 22 + index * 18;
      chartText(svg, 0, y + 9, String(row.n));
      svg.appendChild(el("rect", {
        x: labelW,
        y,
        width: (row.advanceMm / max) * plotW,
        height: 5,
        fill: "#c5cdd6",
      }));
      svg.appendChild(el("rect", {
        x: labelW,
        y: y + 6,
        width: Math.max(0, row.recoveryMm) / max * plotW,
        height: 5,
        fill: row.tone === "is-error" ? "#8f3d3a" : "#1d4e89",
      }));
    });
    figure.appendChild(svg);
    parent.appendChild(figure);
  }
}

function appendLostChart(parent, rows) {
  const known = rows.filter((row) => row.lostMm != null);
  if (!known.length) {
    parent.append(tag("p", "", "Não há intervalo com perda calculável. Onde a recuperação passa do avanço, a diferença não entra no gráfico."));
    return;
  }
  const width = 360;
  const labelW = 86;
  const plotW = 250;
  for (let start = 0; start < known.length; start += 12) {
    const part = known.slice(start, start + 12);
    const figure = tag("figure", "bulletin-chart");
    figure.append(tag("figcaption", "", "Comprimento não recuperado por intervalo, só onde a recuperação não passa do avanço."));
    const height = 28 + part.length * 16;
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
    const max = Math.max(1, ...part.map((row) => row.lostMm));
    chartText(svg, labelW + plotW, 12, formatMeters(max), "end");
    part.forEach((row, index) => {
      const y = 20 + index * 16;
      chartText(svg, 0, y + 8, String(row.n));
      svg.appendChild(el("rect", {
        x: labelW,
        y,
        width: (row.lostMm / max) * plotW,
        height: 8,
        fill: row.lostMm === 0 ? "#c5cdd6" : "#8f3d3a",
      }));
    });
    figure.appendChild(svg);
    parent.appendChild(figure);
  }
}

function appendPercentChart(parent, slices) {
  if (!slices.length) return;
  for (let start = 0; start < slices.length; start += 24) {
    const part = slices.slice(start, start + 24);
    const figure = tag("figure", "bulletin-chart");
    const over = part.some((slice) => slice.pct > 100);
    figure.append(tag("figcaption", "", over
      ? "Recuperação percentual ao longo da profundidade. Um ponto acima de 100% indica registro inválido e fica no topo da escala."
      : "Recuperação percentual ao longo da profundidade. Em perda, cada metro reparte o avanço de forma linear. Isso estima o trecho; não localiza a perda."));
    const plot = { l: 32, t: 16, w: 300, h: 110 };
    const height = plot.t + plot.h + 28;
    const svg = el("svg", { viewBox: `0 0 360 ${height}`, role: "img" });
    for (const mark of [0, 70, 90, 100]) {
      const y = plot.t + plot.h - (mark / 100) * plot.h;
      svg.appendChild(el("line", {
        x1: plot.l,
        y1: y,
        x2: plot.l + plot.w,
        y2: y,
        stroke: mark === 70 || mark === 90 ? "#c4a574" : "#d5dde6",
        "stroke-width": 1,
      }));
      chartText(svg, 0, y + 3, `${mark}%`);
    }
    const xOf = (index) => plot.l + (part.length === 1 ? plot.w / 2 : (index / (part.length - 1)) * plot.w);
    const yOf = (pct) => plot.t + plot.h - (Math.max(0, Math.min(100, pct)) / 100) * plot.h;
    const points = part.map((slice, index) => `${xOf(index)},${yOf(slice.pct)}`).join(" ");
    svg.appendChild(el("polyline", {
      points,
      fill: "none",
      stroke: "#1d4e89",
      "stroke-width": 1.6,
    }));
    part.forEach((slice, index) => {
      svg.appendChild(el("circle", { cx: xOf(index), cy: yOf(slice.pct), r: 2.2, fill: "#1d4e89" }));
    });
    chartText(svg, xOf(0), height - 8, part[0].label);
    if (part.length > 1) chartText(svg, xOf(part.length - 1), height - 8, part[part.length - 1].label, "end");
    figure.appendChild(svg);
    parent.appendChild(figure);
  }
}

function appendBandChart(parent, slices) {
  if (!slices.length) return;
  const width = 360;
  const labelW = 78;
  const plotW = 250;
  for (let start = 0; start < slices.length; start += 16) {
    const part = slices.slice(start, start + 16);
    const figure = tag("figure", "bulletin-chart");
    figure.append(tag("figcaption", "", "Distribuição por faixa de profundidade. Azul é o comprimento recuperado atribuído à faixa. Vermelho é a diferença, quando a recuperação da faixa não passa do avanço."));
    const height = 20 + part.length * 16;
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
    const max = Math.max(1, ...part.map((slice) => slice.advance));
    part.forEach((slice, index) => {
      const y = 8 + index * 16;
      chartText(svg, 0, y + 8, slice.label);
      const recovered = Math.max(0, slice.recovery);
      svg.appendChild(el("rect", {
        x: labelW,
        y,
        width: (recovered / max) * plotW,
        height: 8,
        fill: "#1d4e89",
      }));
      if (slice.lost != null && slice.lost > 0) {
        svg.appendChild(el("rect", {
          x: labelW + (recovered / max) * plotW,
          y,
          width: (slice.lost / max) * plotW,
          height: 8,
          fill: "#8f3d3a",
        }));
      }
    });
    figure.appendChild(svg);
    parent.appendChild(figure);
  }
}

function renderCover(model) {
  const cover = tag("header", "bulletin-cover");
  cover.id = "boletim-cover";
  const brand = tag("div", "cover-brand");
  brand.innerHTML = `<svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true"><path fill="#4e5965" d="M4 14h12l3-4H7z"/><rect x="4" y="15" width="16" height="12" rx="1.2" fill="#243044"/><rect x="6.2" y="16.2" width="2.2" height="3.2" fill="#f7f8fa"/><path fill="#c47a32" d="M12 18c1-2.4 4-5 8-7l1.4 2.2c-3.2 1.6-6 3.6-6.4 4.8z"/></svg>`;
  brand.append(tag("span", "", "Pandora"));
  cover.append(brand);
  cover.append(tag("p", "cover-kicker", "Documento técnico"));
  cover.append(tag("h1", "", "Boletim técnico de sondagem"));
  cover.append(tag("p", "cover-name", model.name || "Sem nome"));
  if (!model.name) cover.append(tag("p", "cover-missing", "Nenhum código foi cadastrado no campo Furo."));
  const facts = tag("dl", "cover-facts");
  const addFact = (label, value) => {
    facts.append(tag("dt", "", label), tag("dd", "", value));
  };
  addFact("Status", model.ended ? "Fim de furo" : "Em andamento");
  addFact("Profundidade", `0,00 m a ${formatMeters(model.stats.depth)}`);
  addFact("Caixas", String(model.boxCount));
  addFact("Canaletas ocupadas", String(model.channelCount));
  addFact("Intervalos", String(model.stats.count));
  addFact("Gerado em", bulletinWhen(model.generatedAt));
  cover.append(facts);
  if (model.fim) {
    cover.append(tag("p", "", `Marcador FIM na caixa ${model.fim.box}, canaleta ${model.fim.channel}. Ele não soma metros.`));
  }
  const rule = tag("div", "cover-depth");
  rule.append(tag("span", "", formatMeters(model.stats.depth)), tag("i", ""), tag("span", "", "0,00 m"));
  cover.append(rule);
  const index = tag("ol", "cover-index");
  for (const [id, label] of BULLETIN_SECTIONS) {
    if (!bulletinState.on.has(id) || id === "cover") continue;
    const item = tag("li", "");
    const jump = tag("button", "cover-jump", label);
    jump.type = "button";
    jump.addEventListener("click", () => {
      document.getElementById(`boletim-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    item.append(jump);
    index.append(item);
  }
  if (index.childElementCount) {
    cover.append(tag("h2", "", "Conteúdo"));
    cover.append(index);
  }
  cover.append(tag("p", "cover-note", "Entram só os dados desta sondagem. Projeto, área, empresa e responsável não aparecem porque o registro não tem esses campos."));
  return cover;
}

function renderSummary(model) {
  const section = bulletinSection("summary", "Resumo da sondagem", model);
  const text = bulletinNarrative(model);
  section.append(tag("p", "bulletin-lead", text.lead));
  const grid = tag("div", "stat-grid");
  const stats = model.stats;
  grid.append(statCard("Profundidade final", formatMeters(stats.depth)));
  grid.append(statCard("Avanço acumulado", formatMeters(stats.advance)));
  grid.append(statCard("Recuperado", formatMeters(stats.recovery)));
  grid.append(statCard("Não recuperado", stats.lost == null ? "não fechado" : formatMeters(stats.lost), stats.lost == null ? "is-error" : ""));
  grid.append(statCard("Recuperação", stats.advance > 0 ? formatRatio(stats.advance, stats.recovery) : "—", stats.invalid ? "is-error" : ""));
  grid.append(statCard("Intervalos", String(stats.count)));
  grid.append(statCard("Caixas", String(model.boxCount)));
  grid.append(statCard("Recuperação parcial", String(stats.partial)));
  grid.append(statCard("Recuperação zero", String(stats.zero), stats.zero ? "is-bad" : ""));
  grid.append(statCard("Pendências", String(model.issues.length), model.issues.length ? "is-error" : ""));
  section.append(grid);
  if (stats.invalid) {
    section.append(tag("p", "bulletin-note", "O percentual usa os comprimentos salvos. Ele não deve ser tratado como indicador fechado enquanto houver recuperação maior que o avanço."));
  }
  return section;
}

function renderTable(model) {
  const section = bulletinSection("table", "Avanços e recuperações", model);
  section.append(tag("p", "", "Cada linha é um intervalo salvo, na ordem do furo. O percentual do total é a soma das recuperações dividida pela soma dos avanços, não a média dos percentuais."));
  const table = tag("table", "bulletin-table");
  const head = tag("thead", "");
  const headRow = tag("tr", "");
  for (const label of ["#", "De", "Até", "Avanço", "Recuperação", "Perda", "%", "Caixa", "Canaleta", "Na caixa", "Observações"]) {
    headRow.append(tag("th", "", label));
  }
  head.append(headRow);
  const body = tag("tbody", "");
  for (const row of model.rows) {
    const tr = tag("tr", row.tone);
    tr.dataset.intervalId = row.id || "";
    tr.title = `Taquinho ${row.n}. ${row.marker ? `Marcador em ${row.marker}.` : ""}`;
    const cells = [String(row.n), row.from, row.to, row.advance, row.recovery, row.lost, row.ratio, row.boxes, row.where, row.core || "Sem testemunho", row.info || "—"];
    cells.forEach((value, index) => {
      const td = tag("td", index >= 1 && index <= 6 ? "num" : "", value);
      tr.append(td);
    });
    body.append(tr);
  }
  const stats = model.stats;
  const total = tag("tr", "is-total");
  const totalCells = [
    "Total",
    "",
    "",
    formatMeters(stats.advance),
    formatMeters(stats.recovery),
    stats.lost == null ? "não fechado" : formatMeters(stats.lost),
    stats.advance > 0 ? formatRatio(stats.advance, stats.recovery) : "—",
    "",
    "",
    "",
    `${model.rows.length} intervalos`,
  ];
  totalCells.forEach((value, index) => {
    total.append(tag(index === 0 ? "th" : "td", index >= 3 && index <= 6 ? "num" : "", value));
  });
  body.append(total);
  table.append(head, body);
  section.append(table);
  section.append(tag("p", "bulletin-note", "Linha vermelha: recuperação zero, abaixo de 70% ou registro inválido. Linha âmbar: de 70% a menos de 90%. A coluna Na caixa é o testemunho recuperado, da base para cima. A canaleta do taquinho pode ficar alguns centímetros à frente, no vão do marcador."));
  return section;
}

function renderMethod(model) {
  const section = bulletinSection("method", "Memória de cálculo", model);
  const stats = model.stats;
  const paragraphs = [
    `Avanço acumulado: soma dos comprimentos perfurados de cada manobra. Nesta sondagem, ${formatMeters(stats.advance)}.`,
    `Recuperação acumulada: soma dos comprimentos recuperados. Nesta sondagem, ${formatMeters(stats.recovery)}.`,
    stats.advance > 0
      ? `Recuperação percentual: recuperação acumulada dividida pelo avanço acumulado, vezes 100. Resultado: ${formatRatio(stats.advance, stats.recovery)}. Não é a média simples dos percentuais de cada manobra.`
      : "Recuperação percentual: não calculada, porque o avanço acumulado é zero.",
    stats.lost == null
      ? `Comprimento perdido: avanço menos recuperação, apenas na manobra em que a recuperação não passa do avanço. O total do furo não fecha. A soma só dos intervalos válidos é ${formatMeters(stats.lostValid)}.`
      : `Comprimento perdido: avanço menos recuperação em cada manobra. Soma: ${formatMeters(stats.lost)}.`,
    "A profundidade geológica segue a soma dos avanços, a partir de zero. A posição física na caixa segue o comprimento recuperado, colocado da base para cima. As duas medidas não são a mesma coisa.",
    "O taquinho ocupa um vão de 2 cm e pode empurrar o testemunho seguinte alguns centímetros. Esse deslocamento não é profundidade e não é perda.",
    "Recuperação zero não deposita testemunho. O taquinho dessa manobra fica um friso à frente do anterior. A profundidade aumenta o avanço. O ponto da perda dentro da manobra não foi registrado, então o boletim não inventa essa posição.",
    "O marcador Fim de furo, quando existe, não é manobra e não soma avanço, recuperação nem profundidade.",
    "Os números são os milímetros salvos, escritos em metros. O boletim não altera o cadastro e não substitui um valor digitado por outro.",
  ];
  for (const text of paragraphs) section.append(tag("p", "", text));
  return section;
}

function renderBoxes(model, sheet) {
  const section = bulletinSection("boxes", "Caixas de testemunho", model);
  sheet.append(section);
  section.append(tag("p", "", "O desenho é o da caixa no Pandora. O zero fica na base e o testemunho sobe. O quadrado na parede tem 1 cm de lado na escala da caixa e marca o metro inteiro da profundidade. A, R e P no taquinho são o avanço, a recuperação e a profundidade daquela manobra."));
  const legend = tag("ul", "bulletin-legend");
  legend.append(tag("li", "legend-channel", "Canaleta"));
  legend.append(tag("li", "legend-core", "Testemunho"));
  legend.append(tag("li", "legend-tag", "Taquinho"));
  legend.append(tag("li", "legend-meter", "Metro"));
  section.append(legend);
  if (!model.boxIndexes.length) {
    section.append(tag("p", "", "Não há caixa ocupada."));
    return;
  }
  for (const index of model.boxIndexes) {
    const page = tag("div", "bulletin-box-page");
    page.append(tag("h3", "", `Caixa ${String(index + 1).padStart(2, "0")}`));
    section.append(page);
    try {
      buildBulletinBox(page, index, model.placed, model.ended);
    } catch {
      page.append(tag("p", "", `A caixa ${index + 1} não pôde ser desenhada nesta prévia.`));
    }
  }
}

function renderCharts(model) {
  const section = bulletinSection("charts", "Gráficos", model);
  if (!model.rows.length) {
    section.append(tag("p", "", "Não há intervalos para plotar."));
    return section;
  }
  appendPercentChart(section, model.slices);
  appendPairChart(section, model.rows);
  appendLostChart(section, model.rows);
  appendBandChart(section, model.slices);
  section.append(tag("p", "bulletin-note", "As faixas de profundidade repartem a recuperação na proporção do avanço quando há perda. A barra mostra essa estimativa. Ela não indica em que centímetro da manobra o testemunho faltou."));
  return section;
}

function renderGeology(model) {
  const section = bulletinSection("geology", "Descrição dos intervalos", model);
  const filled = model.rows.filter((row) => !geoIsEmpty(row.geo) || row.info);
  if (!filled.length) {
    section.append(tag("p", "", "Nenhum intervalo tem litologia, alteração, fraturamento, mineralização, observação ou informação de campo. Nada foi preenchido no lugar desses campos."));
  }
  for (const row of model.rows) {
    const lines = [];
    if (row.info) lines.push(["Informação", row.info]);
    if (row.geo.litologia) lines.push(["Litologia", row.geo.litologia]);
    if (row.geo.alteracao) lines.push(["Alteração", row.geo.alteracao]);
    if (row.geo.fraturamento) lines.push(["Fraturamento", row.geo.fraturamento]);
    if (row.geo.mineralizacao) lines.push(["Mineralização", row.geo.mineralizacao]);
    if (row.geo.observacoes) lines.push(["Observações", row.geo.observacoes]);
    lines.push(["Cor do desenho", row.colorName]);
    const block = tag("article", "geo-block");
    block.append(tag("h3", "", `Intervalo ${row.n} · ${row.depth}`));
    block.append(tag("p", "geo-place", `${row.boxes === "—" ? "" : `Caixa ${row.boxes}. `}${row.marker ? `Taquinho em ${row.marker}.` : ""}`));
    const list = tag("dl", "");
    for (const [label, value] of lines) list.append(tag("dt", "", label), tag("dd", "", value));
    block.append(list);
    if (geoIsEmpty(row.geo) && !row.info) block.append(tag("p", "bulletin-note", "Sem descrição geológica e sem informação de campo."));
    section.append(block);
  }
  return section;
}

function renderPhotos(model) {
  const section = bulletinSection("photos", "Fotografias", model);
  if (bulletinState.photoError) {
    section.append(tag("p", "", "As fotografias deste navegador não puderam ser lidas. O restante do boletim usa os intervalos salvos."));
    return section;
  }
  if (!bulletinState.photos.length) {
    section.append(tag("p", "", "Nenhuma fotografia está associada aos intervalos desta sondagem."));
    return section;
  }
  bulletinState.photos.forEach((photo, index) => {
    const figure = tag("figure", "bulletin-photo");
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = `Fotografia ${index + 1}, intervalo ${photo.n}, ${photo.depth}`;
    const caption = tag("figcaption", "", `Foto ${index + 1}. Intervalo ${photo.n}, ${photo.depth}.${photo.note ? ` ${photo.note}` : ""}`);
    figure.append(image, caption);
    section.append(figure);
  });
  return section;
}

function renderQuality(model) {
  const section = bulletinSection("quality", "Pendências e controle", model);
  section.append(tag("h3", "", "Erros confirmados"));
  if (!model.issues.length) {
    section.append(tag("p", "", "Nenhum erro foi encontrado nas verificações abaixo. Isso não corrige o cadastro porque não havia o que corrigir."));
  } else {
    const list = tag("ul", "issue-list");
    for (const issue of model.issues) {
      const item = tag("li", "", issue.text);
      if (issue.id) item.dataset.intervalId = issue.id;
      list.append(item);
    }
    section.append(list);
    section.append(tag("p", "bulletin-note", "Estes registros continuam como foram salvos. O boletim não os altera."));
  }
  const checks = tag("ul", "");
  for (const check of model.checks) checks.append(tag("li", "", check));
  section.append(tag("h3", "", "Verificações executadas"));
  section.append(checks);
  section.append(tag("h3", "", "Leitura, sem caracterizar erro"));
  const stats = model.stats;
  if (stats.zero) {
    const zeros = model.rows.filter((row) => row.valid && row.recoveryMm === 0).map((row) => `${row.n} (${row.depth})`);
    section.append(tag("p", "", `${nText(stats.zero, "Manobra com recuperação zero", "Manobras com recuperação zero")}: ${zeros.join("; ")}. O avanço entra na profundidade e o taquinho é marcado. A posição da perda dentro da manobra não foi cadastrada.`));
  } else section.append(tag("p", "", "Nenhuma manobra válida tem recuperação zero."));
  if (stats.partial) {
    section.append(tag("p", "", `${nText(stats.partial, "manobra tem recuperação parcial", "manobras têm recuperação parcial")}. A tabela marca essas linhas. A perda dessas manobras é a diferença entre avanço e recuperação, sem um ponto medido no meio do intervalo.`));
  }
  if (!model.described) section.append(tag("p", "", "Nenhum intervalo tem descrição geológica ou informação de campo. Isso é ausência de texto, não um erro de medida."));
  else {
    const missing = model.rows.length - model.described;
    if (missing) section.append(tag("p", "", `${nText(missing, "intervalo não tem", "intervalos não têm")} descrição geológica nem informação de campo.`));
  }
  return section;
}

function renderConclusion(model) {
  const section = bulletinSection("conclusion", "Conclusão", model);
  section.append(tag("p", "", bulletinNarrative(model).conclusion));
  return section;
}

function setBulletinPageMark(model) {
  const style = document.getElementById("bulletin-page-css");
  if (!style) return;
  const name = cssContent(model.name || "Sem nome");
  const when = cssContent(bulletinWhen(model.generatedAt));
  style.textContent = `@page bulletin { @top-left { content: "Sondagem ${name}"; font-family: "Segoe UI", sans-serif; font-size: 8pt; color: #5c6b7e; } @top-right { content: "${when}"; font-family: "Segoe UI", sans-serif; font-size: 8pt; color: #5c6b7e; } }`;
}

function renderBulletinSheet() {
  const sheet = document.getElementById("bulletin-sheet");
  const model = bulletinState.model;
  if (!sheet || !model) return;
  sheet.replaceChildren();
  const on = bulletinState.on;
  if (on.has("cover")) sheet.append(renderCover(model));
  if (on.has("summary")) sheet.append(renderSummary(model));
  if (on.has("table")) sheet.append(renderTable(model));
  if (on.has("method")) sheet.append(renderMethod(model));
  if (on.has("boxes")) renderBoxes(model, sheet);
  if (on.has("charts")) sheet.append(renderCharts(model));
  if (on.has("geology")) sheet.append(renderGeology(model));
  if (on.has("photos")) sheet.append(renderPhotos(model));
  if (on.has("quality")) sheet.append(renderQuality(model));
  if (on.has("conclusion")) sheet.append(renderConclusion(model));
}

function markBulletinPreset() {
  const ids = BULLETIN_SECTIONS.map(([id]) => id);
  const all = ids.every((id) => bulletinState.on.has(id));
  const short = BULLETIN_SHORT.length === bulletinState.on.size && BULLETIN_SHORT.every((id) => bulletinState.on.has(id));
  document.getElementById("bulletin-full")?.classList.toggle("is-on", all);
  document.getElementById("bulletin-short")?.classList.toggle("is-on", short);
}

function syncBulletinChecks() {
  const box = document.getElementById("bulletin-sections");
  if (!box) return;
  box.replaceChildren();
  for (const [id, label] of BULLETIN_SECTIONS) {
    const field = tag("label", "");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    input.checked = bulletinState.on.has(id);
    input.addEventListener("change", () => {
      if (input.checked) bulletinState.on.add(id);
      else bulletinState.on.delete(id);
      markBulletinPreset();
      renderBulletinSheet();
    });
    field.append(input, document.createTextNode(` ${label}`));
    box.append(field);
  }
  markBulletinPreset();
}

function applyBulletinPreset(ids) {
  bulletinState.on = new Set(ids);
  syncBulletinChecks();
  renderBulletinSheet();
}

async function loadBulletinPhotos(intervals) {
  const photos = [];
  for (const interval of intervals) {
    const record = await readPhoto(interval.id);
    if (!record?.blob) continue;
    photos.push({
      n: interval.index + 1,
      depth: depthSpan(interval),
      note: typeof record.note === "string" ? record.note.trim() : "",
      url: URL.createObjectURL(record.blob),
    });
  }
  return photos;
}

function closeBulletin() {
  if (typeof document === "undefined") return;
  bulletinState.token = (bulletinState.token || 0) + 1;
  for (const photo of bulletinState.photos) {
    if (photo.url) URL.revokeObjectURL(photo.url);
  }
  bulletinState.photos = [];
  bulletinState.model = null;
  bulletinState.photoError = false;
  const root = document.getElementById("bulletin-root");
  if (root) root.hidden = true;
  document.body.classList.remove("has-bulletin");
  document.getElementById("bulletin-sheet")?.replaceChildren();
  if (document.body.dataset.print === "bulletin") document.body.removeAttribute("data-print");
}

async function openBulletin() {
  const hole = currentHole();
  if (!hole || !taquinhos.length) {
    showError("Lance um intervalo antes de gerar o boletim.");
    return;
  }
  closeBulletin();
  const token = bulletinState.token;
  const snapshot = taquinhos.map((item) => ({ ...item, geo: item.geo ? { ...item.geo } : undefined }));
  const model = buildBulletinModel(snapshot, { name: hole.name, ended: hole.ended }, new Date());
  bulletinState.model = model;
  bulletinState.on = new Set(BULLETIN_SECTIONS.map(([id]) => id));
  try {
    bulletinState.photos = await loadBulletinPhotos(model.placed);
  } catch {
    bulletinState.photoError = true;
    bulletinState.photos = [];
  }
  if (bulletinState.token !== token) {
    for (const photo of bulletinState.photos) {
      if (photo.url) URL.revokeObjectURL(photo.url);
    }
    bulletinState.photos = [];
    return;
  }
  const root = document.getElementById("bulletin-root");
  if (!root) return;
  root.hidden = false;
  document.body.classList.add("has-bulletin");
  setBulletinPageMark(model);
  syncBulletinChecks();
  renderBulletinSheet();
  document.getElementById("bulletin-close")?.focus();
}

function printBulletin() {
  const root = document.getElementById("bulletin-root");
  if (!root || root.hidden) return;
  document.body.dataset.print = "bulletin";
  const done = () => {
    window.removeEventListener("afterprint", done);
    if (document.body.dataset.print === "bulletin") document.body.removeAttribute("data-print");
  };
  window.addEventListener("afterprint", done);
  window.print();
}

document.getElementById("bulletin-open")?.addEventListener("click", () => {
  openBulletin();
});
document.getElementById("bulletin-close")?.addEventListener("click", closeBulletin);
document.getElementById("bulletin-print")?.addEventListener("click", printBulletin);
document.getElementById("bulletin-pdf")?.addEventListener("click", printBulletin);
document.getElementById("bulletin-full")?.addEventListener("click", () => {
  applyBulletinPreset(BULLETIN_SECTIONS.map(([id]) => id));
});
document.getElementById("bulletin-short")?.addEventListener("click", () => {
  applyBulletinPreset(BULLETIN_SHORT);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const root = document.getElementById("bulletin-root");
  if (!root || root.hidden) return;
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  closeBulletin();
});

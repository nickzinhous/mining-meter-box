const assert = require("assert");
const app = require("./app.js");

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function interval(avancoMm, recuperacaoMm, id = "x") {
  return { id, avancoMm, recuperacaoMm, info: "", color: "#8d5a32" };
}

function marksOf(items) {
  return app.meterMarkPositions(app.accumulateIntervals(items));
}

check("o zero da canaleta fica na base", () => {
  assert.strictEqual(app.yFromBase(4.55, 0), 104.55);
  assert.strictEqual(app.yFromBase(4.55, 100), 4.55);
});

check("recuperação maior que o avanço é recusada", () => {
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1030), true);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1050), true);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1020), false);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1010), false);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1000), false);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 980), false);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 0), false);
});

check("até 2 cm acima do avanço fica na caixa e o taquinho mostra o arredondado", () => {
  const placed = app.accumulateIntervals([interval(1000, 1020, "a")]);
  assert.strictEqual(placed[0].recuperacaoMm, 1020);
  assert.strictEqual(placed[0].physicalFinalMm - placed[0].physicalInicialMm, 1020);
  assert.strictEqual(placed[0].profundidadeFinalMm, 1000);
  assert.strictEqual(app.formatTaquinhoMeters(1000), "1,00 m");
  assert.strictEqual(app.formatTaquinhoMeters(1010), "1,00 m");
  assert.strictEqual(app.formatTaquinhoMeters(1020), "1,00 m");
  assert.strictEqual(app.formatTaquinhoMeters(980), "1,00 m");
  const real = app.accumulateIntervals([interval(1000, 980, "b")]);
  assert.strictEqual(real[0].physicalFinalMm - real[0].physicalInicialMm, 980);
});

check("margem inicial da canaleta desloca o taquinho para o 2º friso", () => {
  const exact = app.accumulateIntervals([interval(1000, 1000, "a")]);
  const exactMark = app.placement(exact[0].physicalFinalMm);
  assert.strictEqual(exact[0].physicalFinalMm - exact[0].physicalInicialMm, 1000);
  assert.strictEqual(exactMark.channel, 1);
  assert.strictEqual(exactMark.topStart, 101);
  assert.strictEqual(exactMark.topEnd, 103);
  assert.strictEqual(exactMark.shifted, true);

  const overflow = app.accumulateIntervals([interval(1010, 1010, "b")]);
  const overflowMark = app.placement(overflow[0].physicalFinalMm);
  assert.strictEqual(overflow[0].physicalFinalMm - overflow[0].physicalInicialMm, 1010);
  assert.strictEqual(overflowMark.channel, 1);
  assert.strictEqual(overflowMark.topStart, 103);
  assert.strictEqual(overflowMark.topEnd, 105);
  assert.strictEqual(overflowMark.shifted, true);
  assert.ok(app.inChannelStartMargin(1010));
  assert.ok(!app.inChannelStartMargin(1000));
  assert.ok(!app.inChannelStartMargin(1020));

  const below = app.accumulateIntervals([interval(990, 990, "c")]);
  const belowMark = app.placement(below[0].physicalFinalMm);
  assert.strictEqual(belowMark.channel, 1);
  assert.strictEqual(belowMark.topStart, 101);

  const mid = app.accumulateIntervals([interval(1030, 1030, "d")]);
  const midMark = app.placement(mid[0].physicalFinalMm);
  assert.strictEqual(mid[0].physicalFinalMm - mid[0].physicalInicialMm, 1030);
  assert.strictEqual(midMark.topStart, 103);

  const ch2 = app.accumulateIntervals([interval(2010, 2010, "e")]);
  const ch2Mark = app.placement(ch2[0].physicalFinalMm);
  assert.strictEqual(ch2[0].physicalFinalMm - ch2[0].physicalInicialMm, 2010);
  assert.strictEqual(ch2Mark.channel, 2);
  assert.strictEqual(ch2Mark.topStart, 203);
  assert.strictEqual(ch2Mark.topEnd, 205);

  const full = app.accumulateIntervals([interval(3000, 3000, "f")]);
  assert.strictEqual(full[0].physicalFinalMm - full[0].physicalInicialMm, 3000);
  const fullMark = app.placement(full[0].physicalFinalMm);
  assert.strictEqual(fullMark.box, 1);
  assert.strictEqual(fullMark.channel, 0);
  assert.strictEqual(fullMark.topStart, 301);
});

check("1 cm no fim da caixa não recebe material e 2 cm ainda recebem", () => {
  assert.strictEqual(app.skipMinimumBoxRemainder(2990), 3000);
  assert.strictEqual(app.skipMinimumBoxRemainder(5990), 6000);
  assert.strictEqual(app.skipMinimumBoxRemainder(2980), 2980);
  assert.strictEqual(app.skipMinimumBoxRemainder(2970), 2970);
  assert.strictEqual(app.skipMinimumBoxRemainder(3000), 3000);
  const tight = app.accumulateIntervals([
    interval(4000, 2990, "a"),
    interval(1000, 500, "b"),
  ]);
  assert.strictEqual(tight[0].physicalFinalMm, 2990);
  assert.ok(tight[1].physicalInicialMm >= 3000);
  assert.strictEqual(tight[1].physicalFinalMm - tight[1].physicalInicialMm, 500);
  assert.strictEqual(tight[1].profundidadeInicialMm, 4000);
  const room = app.accumulateIntervals([
    interval(4000, 2980, "a"),
    interval(1000, 100, "b"),
  ]);
  assert.strictEqual(room[1].physicalInicialMm, 2980);
  assert.strictEqual(room[1].physicalFinalMm - room[1].physicalInicialMm, 100);
  assert.strictEqual(room[1].profundidadeInicialMm, 4000);
});

check("um metro recuperado marca o metro 1 no topo da primeira canaleta", () => {
  const marks = marksOf([interval(1000, 1000)]);
  assert.deepStrictEqual(marks, [{ meter: 1, box: 0, channel: 0, localCm: 100 }]);
});

check("três metros recuperados marcam o topo de cada canaleta", () => {
  const marks = marksOf([interval(3000, 3000)]);
  assert.deepStrictEqual(
    marks.map((mark) => [mark.meter, mark.channel, mark.localCm]),
    [
      [1, 0, 100],
      [2, 1, 100],
      [3, 2, 100],
    ],
  );
});

check("perda no meio do testemunho estima o metro sobre o que foi recuperado", () => {
  const marks = marksOf([interval(2000, 1000)]);
  assert.deepStrictEqual(
    marks.map((mark) => [mark.meter, mark.channel, mark.localCm]),
    [
      [1, 0, 50],
      [2, 0, 100],
    ],
  );
});

check("recuperação zero na primeira manobra usa o 1º friso", () => {
  const first = app.accumulateIntervals([interval(1000, 0, "a")]);
  const mark = app.placement(first[0].physicalFinalMm);
  assert.strictEqual(first[0].physicalFinalMm - first[0].physicalInicialMm, 0);
  assert.strictEqual(mark.channel, 0);
  assert.strictEqual(mark.topStart, 1);
  assert.strictEqual(mark.topEnd, 3);

  const positive = app.accumulateIntervals([interval(1000, 500, "b")]);
  const positiveMark = app.placement(positive[0].physicalFinalMm);
  assert.strictEqual(positive[0].physicalFinalMm - positive[0].physicalInicialMm, 500);
  assert.ok(positiveMark.topStart >= 1);

  const consecutive = app.accumulateIntervals([
    interval(1000, 400, "a"),
    interval(1000, 400, "b"),
  ]);
  const a = app.placement(consecutive[0].physicalFinalMm);
  const b = app.placement(consecutive[1].physicalFinalMm);
  assert.ok(b.topStart >= a.topEnd + 2);

  const sandwiched = app.accumulateIntervals([
    interval(1000, 400, "a"),
    interval(1000, 0, "b"),
    interval(1000, 400, "c"),
  ]);
  assert.strictEqual(sandwiched[1].physicalFinalMm, sandwiched[1].physicalInicialMm);
  const mid = app.placement(sandwiched[1].physicalFinalMm);
  const left = app.placement(sandwiched[0].physicalFinalMm);
  assert.ok(mid.topStart >= left.topEnd + 2);

  const twoZeros = app.accumulateIntervals([
    interval(1000, 0, "a"),
    interval(1000, 0, "b"),
  ]);
  const z0 = app.placement(twoZeros[0].physicalFinalMm);
  const z1 = app.placement(twoZeros[1].physicalFinalMm);
  assert.strictEqual(z0.topStart, 1);
  assert.ok(z1.topStart >= z0.topEnd + 2);
});

check("recuperação zero ainda posiciona o metro no taquinho, sem abrir vão de testemunho", () => {
  const placed = app.accumulateIntervals([
    interval(1500, 1500, "a"),
    interval(1500, 0, "b"),
    interval(1500, 1200, "c"),
  ]);
  assert.strictEqual(placed[1].physicalInicialMm, placed[1].physicalFinalMm);
  const marks = app.meterMarkPositions(placed);
  const two = marks.find((mark) => mark.meter === 2);
  const three = marks.find((mark) => mark.meter === 3);
  assert.ok(two && three);
  assert.deepStrictEqual([two.box, two.channel, two.localCm], [three.box, three.channel, three.localCm]);
});

check("o boletim só repete o furo informado", () => {
  const model = app.buildBulletinModel(
    [interval(1000, 800)],
    { name: "F-001", ended: false },
    new Date("2026-01-15T12:00:00Z"),
  );
  assert.strictEqual(model.name, "F-001");
  assert.strictEqual(model.stats.advance, 1000);
  assert.strictEqual(model.stats.recovery, 800);
  assert.strictEqual(model.stats.lost, 200);
  assert.ok(model.rows.length === 1);
  assert.ok(model.slices.length >= 1);
  for (const key of ["empresa", "responsavel", "local", "area"]) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(model, key), false);
  }
});

check("a caixa guarda a recuperação real e o taquinho só arredonda o texto", () => {
  const placed = app.accumulateIntervals([
    interval(1000, 980, "a"),
    interval(3000, 2970, "b"),
  ]);
  assert.strictEqual(placed[0].recuperacaoMm, 980);
  assert.strictEqual(placed[0].physicalFinalMm - placed[0].physicalInicialMm, 980);
  assert.strictEqual(placed[1].recuperacaoMm, 2970);
  assert.strictEqual(placed[1].physicalFinalMm - placed[1].physicalInicialMm, 2970);
  assert.strictEqual(app.formatMeters(980), "0,98 m");
  assert.strictEqual(app.formatMeters(2970), "2,97 m");
  assert.strictEqual(app.formatTaquinhoMeters(980), "1,00 m");
  assert.strictEqual(app.formatTaquinhoMeters(2970), "2,95 m");
  assert.strictEqual(app.formatTaquinhoMeters(placed[0].avancoMm), "1,00 m");
  assert.strictEqual(app.formatTaquinhoMeters(placed[0].profundidadeFinalMm), "1,00 m");
});

check("cortes redistribuem o material sem mudar a recuperação", () => {
  const plain = app.distributeRecovery(0, 1500, []);
  assert.strictEqual(plain.finalMm, 1500);
  assert.strictEqual(plain.segments.reduce((sum, seg) => sum + seg.lengthMm, 0), 1500);
  assert.deepStrictEqual(
    plain.segments.map((seg) => [seg.channel, seg.localStartMm, seg.localEndMm]),
    [
      [0, 0, 1000],
      [1, 0, 500],
    ],
  );

  const one = app.distributeRecovery(0, 1500, [{ id: "c1", offsetMm: 960 }]);
  assert.strictEqual(one.segments.reduce((sum, seg) => sum + seg.lengthMm, 0), 1500);
  assert.deepStrictEqual(
    one.segments.map((seg) => [seg.channel, seg.localStartMm, seg.localEndMm]),
    [
      [0, 0, 960],
      [1, 0, 540],
    ],
  );

  const two = app.distributeRecovery(0, 1500, [
    { id: "c1", offsetMm: 960 },
    { id: "c2", offsetMm: 1200 },
  ]);
  assert.strictEqual(two.segments.reduce((sum, seg) => sum + seg.lengthMm, 0), 1500);
  assert.deepStrictEqual(
    two.segments.map((seg) => [seg.channel, seg.localStartMm, seg.localEndMm]),
    [
      [0, 0, 960],
      [1, 0, 240],
      [2, 0, 300],
    ],
  );

  const placed = app.accumulateIntervals([
    { id: "a", avancoMm: 1500, recuperacaoMm: 1500, info: "", color: "#8d5a32", cortes: [{ id: "c1", offsetMm: 960 }] },
  ]);
  assert.strictEqual(placed[0].recuperacaoMm, 1500);
  assert.strictEqual(placed[0].physicalFinalMm, 1540);
  assert.strictEqual(app.roundedRecoveryMm(placed[0].recuperacaoMm), 1500);
});

check("totais e porcentagem usam a recuperação arredondada sem alterar o desenho", () => {
  const items = [interval(1000, 1020, "a"), interval(1000, 980, "b"), interval(3000, 2970, "c")];
  assert.strictEqual(app.roundedRecoveryMm(1020), 1000);
  assert.strictEqual(app.roundedRecoveryMm(980), 1000);
  assert.strictEqual(app.roundedRecoveryMm(2970), 2950);
  assert.strictEqual(app.sumRoundedRecoveryMm(items), 1000 + 1000 + 2950);
  const placed = app.accumulateIntervals([interval(1000, 1020, "a")]);
  assert.strictEqual(placed[0].physicalFinalMm - placed[0].physicalInicialMm, 1020);
  assert.strictEqual(placed[0].recuperacaoMm, 1020);
  const model = app.buildBulletinModel([interval(1000, 1020, "a")], { name: "T", items: [] }, new Date("2024-01-01T00:00:00Z"));
  assert.strictEqual(model.rows[0].recoveryMm, 1000);
  assert.strictEqual(model.rows[0].recovery, "1,00 m");
  assert.strictEqual(model.rows[0].ratio, "100%");
  assert.strictEqual(model.stats.recovery, 1000);
  assert.strictEqual(placed[0].recuperacaoMm, 1020);
});

check("a profundidade da caixa arredonda o centímetro para 0 ou 5", () => {
  const um = (meters) => Math.round(meters * 1000000);
  assert.strictEqual(app.formatBoxDepth(um(2.91)), "2,90 m");
  assert.strictEqual(app.formatBoxDepth(um(2.92)), "2,90 m");
  assert.strictEqual(app.formatBoxDepth(um(2.93)), "2,95 m");
  assert.strictEqual(app.formatBoxDepth(um(2.94)), "2,95 m");
  assert.strictEqual(app.formatBoxDepth(um(2.95)), "2,95 m");
  assert.strictEqual(app.formatBoxDepth(um(2.96)), "2,95 m");
  assert.strictEqual(app.formatBoxDepth(um(2.97)), "2,95 m");
  assert.strictEqual(app.formatBoxDepth(um(2.98)), "3,00 m");
  assert.strictEqual(app.formatBoxDepth(um(2.99)), "3,00 m");
  assert.strictEqual(app.formatBoxDepth(um(2.9)), "2,90 m");
  assert.strictEqual(app.formatBoxDepth(um(0)), "0,00 m");
});

check("o fim de uma caixa é o mesmo valor do início da seguinte", () => {
  const placed = app.accumulateIntervals([interval(3500, 3500, "a")]);
  const edges = app.boxDepthEdges(placed, false);
  assert.ok(edges.length >= 3);
  assert.strictEqual(edges[1], app.depthUmAtPhysical(placed, 3000));
  assert.strictEqual(app.formatBoxDepth(edges[0]), "0,00 m");
  assert.strictEqual(app.formatBoxDepth(edges[1]), "3,00 m");
  assert.strictEqual(app.formatBoxDepth(edges[2]), "3,50 m");
  assert.strictEqual(app.formatBoxDepth(edges[1]), app.formatBoxDepth(edges[1]));
});

if (failed) {
  console.error(`\n${failed} verificação(ões) falharam.`);
  process.exit(1);
}

console.log("\nAs regras do protótipo conferem.");

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
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1001), true);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 1000), false);
  assert.strictEqual(app.recoveryExceedsAdvance(1000, 0), false);
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

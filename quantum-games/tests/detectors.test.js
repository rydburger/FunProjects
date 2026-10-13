// Tests for ../detectors.js: the detector paradigm, noise models and decoders.
// Run with:  node quantum-games/tests/detectors.test.js
"use strict";
var assert = require("assert");
var S = require("../stabilizer.js");
var D = require("../detectors.js");
var Zoo = require("../qec-zoo-tycoon/zoo-data.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.stack || e)); }
}
var NONE = D.phenomenological({}, 0);
function quietMemory(code, q) {
  return D.createMemory({ code: code, model: D.phenomenological({}, q || 0), rng: S.seededRng(1) });
}

console.log("Detector paradigm");
test("no noise: no detector ever lights", function () {
  var mem = quietMemory(S.rotatedSurface(3));
  for (var t = 0; t < 10; t++) assert.strictEqual(D.measureRound(mem).detectors, 0);
});
test("a data error lights its syndrome once, then stays quiet", function () {
  var code = S.rotatedSurface(3), mem = quietMemory(code), E = S.single(9, 4, "X");
  D.measureRound(mem);
  var r1 = D.measureRound(mem, { inject: { E: E } });
  assert.strictEqual(r1.detectors, D.checkSyndrome(code.stabilizers, E));
  assert.notStrictEqual(r1.detectors, 0);
  assert.strictEqual(D.measureRound(mem).detectors, 0);
  // ...but the raw outcomes keep showing it.
  assert.strictEqual(D.measureRound(mem).outcomes, r1.detectors);
});
test("a measurement error lights one check in two consecutive rounds", function () {
  var mem = quietMemory(S.rotatedSurface(3));
  D.measureRound(mem);
  assert.strictEqual(D.measureRound(mem, { inject: { flips: 1 << 5 } }).detectors, 1 << 5);
  assert.strictEqual(D.measureRound(mem).detectors, 1 << 5);
  assert.strictEqual(D.measureRound(mem).detectors, 0);
});
test("measurement errors don't touch the data", function () {
  var mem = D.createMemory({ code: S.rotatedSurface(3), model: D.phenomenological({}, 0.5), rng: S.seededRng(2) });
  for (var t = 0; t < 20; t++) D.measureRound(mem);
  assert.ok(S.isIdentity(mem.E));
});
test("phenomenological DEM: data faults light their checks, meas faults two rounds", function () {
  var code = S.rotatedSurface(3), mem = D.createMemory({ code: code, model: D.phenomenological(S.channels.depolarizing(0.03), 0.01) });
  var dem = D.phenoDEM(mem, 3, { openTop: true, decompose: true });
  var meas = dem.faults.filter(function (f) { return f.kind === "meas"; });
  assert.strictEqual(meas.length, 8 * 3);
  meas.forEach(function (f) { assert.strictEqual(f.dets.length, f.round < 2 ? 2 : 1); });
  var closed = D.phenoDEM(mem, 3, { openTop: false, decompose: true });
  assert.strictEqual(closed.faults.filter(function (f) { return f.kind === "meas"; }).length, 8 * 2);
  assert.ok(D.isMatchable(dem));
});
test("matchability: surface, repetition and Shor yes; Steane no", function () {
  function matchable(code) {
    var mem = D.createMemory({ code: code, model: D.phenomenological(S.channels.depolarizing(0.03), 0.01) });
    return D.isMatchable(D.phenoDEM(mem, 2, { openTop: true, decompose: true }));
  }
  assert.ok(matchable(S.rotatedSurface(5)));
  assert.ok(matchable(S.repetition(5)));
  assert.ok(matchable(Zoo.SPECIES.owl.code));
  assert.ok(!matchable(Zoo.SPECIES.peacock.code));
  var steane = D.createMemory({ code: Zoo.SPECIES.peacock.code, model: D.phenomenological(S.channels.depolarizing(0.03), 0.01) });
  assert.throws(function () { D.matchingDecoder(steane); }, /Not matchable/);
});
test("circuit-level noise is scaffolded but not implemented yet", function () {
  var m = D.circuitLevel({ p2: 0.001 });
  assert.strictEqual(m.kind, "circuit");
  assert.throws(function () { D.createMemory({ code: S.rotatedSurface(3), model: m }); }, /not implemented/);
  assert.deepStrictEqual(D.defaultSchedule([S.fromString("XIXX")]), [[0, 2, 3]]);
});

console.log("Decoders, fault by fault");
// Run an experiment with exactly the listed faults: [{ round, E } | { round, flips }].
// noFlush: the decoder has no flush (continuous operation): after the last
// faulty round, run quiet perfect rounds until the window has drained.
function scripted(code, decoderFn, rounds, faults, q, noFlush) {
  var mem = D.createMemory({ code: code, model: D.phenomenological({ pX: 1e-3, pY: 1e-3, pZ: 1e-3 }, q === undefined ? 1e-3 : q), rng: function () { return 1; } });
  var dec = decoderFn(mem);
  for (var t = 0; t <= rounds; t++) {
    var inj = { E: S.identity(code.n), flips: 0 };
    faults.forEach(function (f) {
      if (f.round !== t) return;
      if (f.E) inj.E = S.multiply(inj.E, f.E);
      if (f.flips) inj.flips ^= f.flips;
    });
    var last = t === rounds;
    var r = D.measureRound(mem, { inject: inj, perfect: last });
    D.applyCorrection(mem, last && !noFlush ? dec.flush(r) : dec.push(r));
  }
  if (noFlush) for (var k = 0; k < 6; k++) D.applyCorrection(mem, dec.push(D.measureRound(mem, { perfect: true })));
  var R = D.residual(mem);
  return { syndrome: D.checkSyndrome(mem.checks, R), logical: S.logicalAction(code, R).any };
}
function allSingleFaults(code, rounds, types) {
  var list = [], m = code.stabilizers.length;
  for (var t = 0; t <= rounds; t++) {
    for (var q = 0; q < code.n; q++) types.forEach(function (ty) { list.push({ round: t, E: S.single(code.n, q, ty) }); });
    if (t < rounds) for (var i = 0; i < m; i++) list.push({ round: t, flips: 1 << i });
  }
  return list;
}
function matching(W) { return function (mem) { return D.matchingDecoder(mem, { window: W }); }; }

test("lookup, perfect measurements: every single-qubit error is corrected", function () {
  var code = Zoo.SPECIES.peacock.code;
  allSingleFaults(code, 0, ["X", "Y", "Z"]).forEach(function (f) {
    var out = scripted(code, function (mem) { return D.lookupDecoder(mem, 1); }, 0, [f], 0);
    assert.ok(out.syndrome === 0 && !out.logical, JSON.stringify(f));
  });
});
test("lookup is fooled by a single measurement error (single-shot decoding)", function () {
  // A flipped outcome looks like a real error, so the keeper "corrects"
  // a qubit that was fine and puts a real error into the frame.
  var code = S.rotatedSurface(3), mem = D.createMemory({ code: code, model: D.phenomenological({}, 0) });
  var dec = D.lookupDecoder(mem, 1);
  D.measureRound(mem);
  D.applyCorrection(mem, dec.push(D.measureRound(mem, { inject: { flips: 1 } })));
  assert.ok(!S.isIdentity(D.residual(mem)), "a phantom syndrome put an error into the frame");
  // Matching sees the same flip light twice in time and does nothing.
  var mem2 = D.createMemory({ code: code, model: D.phenomenological({}, 0.01) });
  var dec2 = D.matchingDecoder(mem2, { window: 3 });
  D.applyCorrection(mem2, dec2.push(D.measureRound(mem2, { perfect: true })));
  D.applyCorrection(mem2, dec2.push(D.measureRound(mem2, { perfect: true, inject: { flips: 1 } })));
  for (var t = 0; t < 3; t++) D.applyCorrection(mem2, dec2.push(D.measureRound(mem2, { perfect: true })));
  assert.ok(S.isIdentity(D.residual(mem2)));
});
[1, 2, 3, 4].forEach(function (W) {
  test("matching (window " + W + ") fixes every single fault on the d=3 surface code", function () {
    var code = S.rotatedSurface(3);
    allSingleFaults(code, 4, ["X", "Y", "Z"]).forEach(function (f) {
      var out = scripted(code, matching(W), 4, [f]);
      assert.ok(out.syndrome === 0 && !out.logical, "window " + W + ": " + JSON.stringify(f));
    });
  });
});
test("matching (window 5) fixes every pair of X or measurement faults on d=5", function () {
  var code = S.rotatedSurface(5), rounds = 3;
  // X errors are seen by the Z checks; restrict flips to those checks.
  var zMask = 0;
  code.stabilizers.forEach(function (g, i) { if (g.x === 0) zMask |= (1 << i); });
  var faults = allSingleFaults(code, rounds, ["X"]).filter(function (f) { return !f.flips || (f.flips & zMask); });
  var bad = 0;
  for (var a = 0; a < faults.length; a++) for (var b = a + 1; b < faults.length; b++) {
    var out = scripted(code, matching(5), rounds, [faults[a], faults[b]]);
    if (out.syndrome !== 0 || out.logical) bad++;
  }
  assert.strictEqual(bad, 0, bad + " of " + (faults.length * (faults.length - 1) / 2) + " pairs failed");
});

[2, 3].forEach(function (W) {
  ["peacock", "pangolin"].forEach(function (id) {
    test("space-time lookup (window " + W + ") fixes every single fault on the " + Zoo.SPECIES[id].name, function () {
      var code = Zoo.SPECIES[id].code;
      allSingleFaults(code, 4, ["X", "Y", "Z"]).forEach(function (f) {
        var out = scripted(code, function (mem) { return D.spacetimeLookupDecoder(mem, { window: W }); }, 4, [f], 1e-3, true);
        assert.ok(out.syndrome === 0 && !out.logical, JSON.stringify(f));
      });
    });
  });
});
test("spacetimeDecoder: matching for surface and Shor, a table for Steane and the (non-CSS) five-qubit code", function () {
  var model = D.phenomenological(S.channels.depolarizing(0.01), 0.01);
  function pick(code) { return D.spacetimeDecoder(D.createMemory({ code: code, model: model })).name; }
  assert.strictEqual(pick(S.rotatedSurface(3)), "matching");
  assert.strictEqual(pick(Zoo.SPECIES.owl.code), "matching");
  assert.strictEqual(pick(Zoo.SPECIES.peacock.code), "spacetime-lookup");
  assert.strictEqual(pick(Zoo.SPECIES.pangolin.code), "spacetime-lookup");
});
test("per-qubit rates and per-check flip probabilities", function () {
  var code = S.rotatedSurface(3), rates = [];
  for (var q = 0; q < 9; q++) rates.push(q === 4 ? { pX: 1 } : {});
  var q8 = [0, 0, 0, 0, 0, 0, 0, 1];
  var mem = D.createMemory({ code: code, model: D.phenomenological(rates, q8), rng: S.seededRng(3) });
  var r = D.measureRound(mem);
  assert.strictEqual(S.toString(r.noise), "IIIIXIIII");
  assert.strictEqual(r.flips, 1 << 7);
  D.setModel(mem, D.phenomenological({}, 0));
  assert.ok(S.isIdentity(D.measureRound(mem).noise));
});

console.log("Monte Carlo (seeded)");
function failRate(code, decoderFn, p, q, shots, rounds, seed) {
  var rng = S.seededRng(seed), fails = 0;
  var model = D.phenomenological(S.channels.depolarizing(p), q);
  for (var s = 0; s < shots; s++) {
    if (D.runMemory({ code: code, model: model, rng: rng, rounds: rounds, decoder: decoderFn }).failed) fails++;
  }
  return fails / shots;
}
test("when measurements are the noisy part, matching beats single-shot lookup (d=3 surface)", function () {
  // p = 0.5% data, q = 2% measurement: lookup chases phantom syndromes.
  var code = S.rotatedSurface(3);
  var look = failRate(code, function (mem) { return D.lookupDecoder(mem, 2); }, 0.005, 0.02, 3000, 6, 11);
  var mat = failRate(code, matching(3), 0.005, 0.02, 3000, 6, 11);
  assert.ok(mat < look / 3, "matching " + mat + " vs lookup " + look);
});
test("space-time lookup beats single-shot lookup on the Steane code when measurements are noisy", function () {
  var code = Zoo.SPECIES.peacock.code, rng = S.seededRng(31), model = D.phenomenological(S.channels.depolarizing(0.005), 0.02);
  function run(make) {
    var fails = 0;
    for (var s = 0; s < 1500; s++) {
      var mem = D.createMemory({ code: code, model: model, rng: rng }), dec = make(mem);
      for (var t = 0; t < 6; t++) D.applyCorrection(mem, dec.push(D.measureRound(mem)));
      for (t = 0; t < 4; t++) D.applyCorrection(mem, dec.push(D.measureRound(mem, { perfect: true, noNoise: true })));
      var R = D.residual(mem);
      if (D.checkSyndrome(mem.checks, R) !== 0 || S.logicalAction(code, R).any) fails++;
    }
    return fails / 1500;
  }
  var look = run(function (mem) { return D.lookupDecoder(mem, 1); });
  var st = run(function (mem) { return D.spacetimeLookupDecoder(mem, { window: 3 }); });
  assert.ok(st < look / 2, "space-time " + st + " vs lookup " + look);
});
test("below threshold, d=5 beats d=3; far above it, d=5 is worse", function () {
  var lo3 = failRate(S.rotatedSurface(3), matching(3), 0.01, 0.005, 1500, 5, 21);
  var lo5 = failRate(S.rotatedSurface(5), matching(5), 0.01, 0.005, 1500, 5, 22);
  assert.ok(lo5 < lo3, "p=1%: d3 " + lo3 + ", d5 " + lo5);
  var hi3 = failRate(S.rotatedSurface(3), matching(3), 0.12, 0.06, 600, 5, 23);
  var hi5 = failRate(S.rotatedSurface(5), matching(5), 0.12, 0.06, 600, 5, 24);
  assert.ok(hi5 > hi3, "p=12%: d3 " + hi3 + ", d5 " + hi5);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

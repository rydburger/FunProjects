// Tests for ../nonlocal.js: the magic square, KSB, GHZ and HLF games of
// arXiv:2512.02284. Every physics claim the pages show is checked here
// against an independent calculation (statevector or brute force).
// Run with:  node quantum-games/tests/nonlocal.test.js
"use strict";
var assert = require("assert");
var NL = require("../nonlocal.js");
var SV = NL.SV, C = NL.Clifford, Magic = NL.Magic, KSB = NL.KSB, GHZ = NL.GHZ, HLF = NL.HLF;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || "") + " expected " + b + " got " + a); }

// ---- helpers: Pauli algebra with phases, expectation values ----
// single-qubit Pauli product table: [phase exponent of i, result]
var PMUL = {
  II: [0, "I"], IX: [0, "X"], IY: [0, "Y"], IZ: [0, "Z"], XI: [0, "X"], YI: [0, "Y"], ZI: [0, "Z"],
  XX: [0, "I"], YY: [0, "I"], ZZ: [0, "I"], XY: [1, "Z"], YX: [3, "Z"], YZ: [1, "X"], ZY: [3, "X"], ZX: [1, "Y"], XZ: [3, "Y"]
};
function pmul(a, b) { // a, b: {ph (power of i), s}
  var ph = a.ph + b.ph, s = "";
  for (var i = 0; i < a.s.length; i++) { var t = PMUL[a.s[i] + b.s[i]]; ph += t[0]; s += t[1]; }
  return { ph: ph & 3, s: s };
}
function entryOp(e) { return { ph: e[1] < 0 ? 2 : 0, s: e[0] }; }
function applyPauliString(s, str, qubits) { for (var i = str.length - 1; i >= 0; i--) if (str[i] !== "I") SV.apply(s, str[i], [qubits[i]]); }
function inner(a, b) { var re = 0, im = 0; for (var i = 0; i < a.re.length; i++) { re += a.re[i] * b.re[i] + a.im[i] * b.im[i]; im += a.re[i] * b.im[i] - a.im[i] * b.re[i]; } return [re, im]; }
function expect(s, str, qubits) { var t = SV.clone(s); applyPauliString(t, str, qubits); return inner(s, t)[0]; }
function randomState(n, r) {
  var s = SV.make(n), norm = 0;
  for (var i = 0; i < s.re.length; i++) { s.re[i] = r() - 0.5; s.im[i] = r() - 0.5; norm += s.re[i] * s.re[i] + s.im[i] * s.im[i]; }
  norm = 1 / Math.sqrt(norm);
  for (var j = 0; j < s.re.length; j++) { s.re[j] *= norm; s.im[j] *= norm; }
  return s;
}
function runMoments(s, moments) { moments.forEach(function (m) { m.forEach(function (o) { SV.apply(s, o.g, o.q); }); }); }
var r = NL.rng(12345);

console.log("Statevector");
test("Y = iXZ and S^2 = Z on a random state", function () {
  var a = randomState(2, r), b = SV.clone(a);
  SV.apply(a, "Y", [1]);
  SV.apply(b, "Z", [1]); SV.apply(b, "X", [1]); // XZ|psi>, then times i
  for (var i = 0; i < 4; i++) { near(a.re[i], -b.im[i], 1e-12); near(a.im[i], b.re[i], 1e-12); }
  var c = randomState(2, r), d = SV.clone(c);
  SV.apply(c, "S", [0]); SV.apply(c, "S", [0]); SV.apply(d, "Z", [0]);
  for (var k = 0; k < 4; k++) { near(c.re[k], d.re[k], 1e-12); near(c.im[k], d.im[k], 1e-12); }
});

test("RZ(pi) = Z and RZ(pi/2) = S", function () {
  var a = randomState(2, r), b = SV.clone(a), c = SV.clone(a), d = SV.clone(a);
  SV.apply(a, "RZ", [1], Math.PI); SV.apply(b, "Z", [1]);
  SV.apply(c, "RZ", [0], Math.PI / 2); SV.apply(d, "S", [0]);
  for (var i = 0; i < 4; i++) { near(a.re[i], b.re[i], 1e-12); near(a.im[i], b.im[i], 1e-12); near(c.re[i], d.re[i], 1e-12); near(c.im[i], d.im[i], 1e-12); }
});

console.log("Magic square");
test("Table I: rows multiply to +I, columns to -I", function () {
  for (var r0 = 0; r0 < 3; r0++) {
    var p = { ph: 0, s: "II" };
    for (var c0 = 0; c0 < 3; c0++) p = pmul(p, entryOp(Magic.TABLE[r0][c0]));
    assert.deepStrictEqual(p, { ph: 0, s: "II" }, "row " + r0);
  }
  for (var c1 = 0; c1 < 3; c1++) {
    var q = { ph: 0, s: "II" };
    for (var r1 = 0; r1 < 3; r1++) q = pmul(q, entryOp(Magic.TABLE[r1][c1]));
    assert.deepStrictEqual(q, { ph: 2, s: "II" }, "col " + c1);
  }
});
test("entries in a row/column commute pairwise", function () {
  for (var i = 0; i < 3; i++) for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
    assert.ok(!NL.anticommutes(Magic.TABLE[i][a][0], Magic.TABLE[i][b][0]));
    assert.ok(!NL.anticommutes(Magic.TABLE[a][i][0], Magic.TABLE[b][i][0]));
  }
});
test("each row/column circuit really measures its three entries", function () {
  // <entry> on a random state must equal <sign * (-1)^(bits)> after the circuit
  [["row", Magic.ROW_CIRCUIT, Magic.ROW_SUB, function (l, e) { return Magic.TABLE[l][e]; }],
   ["col", Magic.COL_CIRCUIT, Magic.COL_SUB, function (l, e) { return Magic.TABLE[e][l]; }]].forEach(function (kind) {
    for (var line = 0; line < 3; line++) for (var e = 0; e < 3; e++) {
      for (var trial = 0; trial < 3; trial++) {
        var s = randomState(2, r), entry = kind[3](line, e), sub = kind[2][line][e];
        var want = entry[1] * expect(s, entry[0], [0, 1]);
        var t = SV.clone(s); runMoments(t, kind[1][line]);
        var got = sub.sign * (2 * SV.parityProb(t, sub.bits, 0) - 1);
        near(got, want, 1e-9, kind[0] + line + " entry " + e);
      }
    }
  });
});
test("Variation I wins every one of the 9 games with no noise", function () {
  for (var rr = 0; rr < 3; rr++) for (var cc = 0; cc < 3; cc++) {
    var g = Magic.variationI(rr, cc), s = SV.runCircuit(g.circuit);
    near(SV.parityProb(s, g.observables[0], g.ideal[0]), 1, 1e-9, "game " + rr + cc);
    assert.strictEqual(Magic.winProb(1, rr, cc, C.NO_NOISE), 1);
  }
});
test("Variation II: rules and cell match all hold with no noise", function () {
  for (var rr = 0; rr < 3; rr++) for (var cc = 0; cc < 3; cc++) {
    var g = Magic.variationII(rr, cc), s = SV.runCircuit(g.circuit);
    g.observables.forEach(function (o, i) { near(SV.parityProb(s, o, g.ideal[i]), 1, 1e-9, "game " + rr + cc + " check " + i); });
  }
});
test("Variation II ancilla readings are genuinely random but consistent", function () {
  // a single entry is a fair coin (it is a nonlocal correlation, not a fixed value)
  var g = Magic.variationII(1, 1), s = SV.runCircuit(g.circuit);
  near(SV.parityProb(s, [4], 0), 0.5, 1e-9);
});
test("best classical table wins exactly 8/9", function () {
  var best = 0;
  for (var m = 0; m < 512; m++) {
    var t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 9; i++) t[Math.floor(i / 3)][i % 3] = (m >> i) & 1 ? -1 : 1;
    best = Math.max(best, Magic.classicalWinRate(t));
  }
  near(best, 8 / 9, 1e-12);
});
test("paper-level noise lands near the measured 98%", function () {
  var avg = 0;
  for (var rr = 0; rr < 3; rr++) for (var cc = 0; cc < 3; cc++) avg += Magic.winProb(1, rr, cc, C.PAPER_NOISE) / 9;
  assert.ok(avg > 0.96 && avg < 0.995, "avg " + avg);
  var avg2 = 0;
  for (var r2 = 0; r2 < 3; r2++) for (var c2 = 0; c2 < 3; c2++) avg2 += Magic.winProb(2, r2, c2, C.PAPER_NOISE) / 9;
  assert.ok(avg2 < avg && avg2 > 8 / 9, "variation II " + avg2);
});

console.log("Exact fault analysis vs. forward Pauli-frame sampling");
test("k=3 distribution (Variation II, heavy noise) matches Monte Carlo", function () {
  var g = Magic.variationII(2, 2), noise = { p1: 0.02, p2: 0.06, readout: 0.04, idle: 0.01 };
  var ops = C.withNoise(g.circuit, noise), ft = C.faultTable(ops, 8, g.observables);
  var exact = C.exactDistribution(ft), shots = 200000;
  var counts = C.frameSample(ops, 8, g.observables, shots, NL.rng(7));
  var tot = 0;
  for (var p = 0; p < 8; p++) { tot += exact[p]; near((counts[p] || 0) / shots, exact[p], 0.006, "pattern " + p); }
  near(tot, 1, 1e-9);
});
test("k=1 closed form equals the convolution and the sampler", function () {
  var pat = GHZ.growth(9, NL.rng(3)), xb = GHZ.randomInputBits(9, NL.rng(4));
  var g = GHZ.circuitBits(pat, xb), noise = { p1: 0.01, p2: 0.03, readout: 0.02, idle: 0.01 };
  var ft = C.faultTable(C.withNoise(g.circuit, noise), 9, g.observables);
  var a = C.noFlipProb1(ft), b = C.exactDistribution(ft)[0];
  near(a, b, 1e-12);
  near(C.sampler(ft).okFraction(100000, NL.rng(9)), a, 0.006);
});

console.log("Kochen-Specker-Bell");
test("every noncontextual assignment has chi <= 4, and 4 is reached", function () {
  var best = -99;
  for (var m = 0; m < 512; m++) {
    var v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 9; i++) v[Math.floor(i / 3)][i % 3] = (m >> i) & 1 ? -1 : 1;
    best = Math.max(best, KSB.chiOfAssignment(v));
  }
  assert.strictEqual(best, 4);
});
test("contextual values reach 6", function () {
  var ones = [[1, 1, 1], [1, 1, 1], [1, 1, 1]], col = [[1, 1, 1], [1, 1, 1], [-1, -1, -1]];
  assert.strictEqual(KSB.chiContextual(ones, col), 6);
});
test("ideal device: chi = 6 exactly, compatible readings always agree", function () {
  var res = KSB.experiment({ reps: 40, length: 180, noise: KSB.IDEAL, rng: NL.rng(5) });
  near(res.chi, 6, 1e-12);
  near(res.pAgreeCompatible, 1, 1e-12);
  near(res.pAgreeIncompatible, 0.5, 0.03);
});
test("paper-level device noise: 4 < chi < 6", function () {
  var res = KSB.experiment({ reps: 200, length: 180, noise: KSB.PAPER_DEVICE, rng: NL.rng(6) });
  assert.ok(res.chi > 5.3 && res.chi < 5.95, "chi " + res.chi);
});

test("an ancilla phase error is cancelled by the matching virtual Z", function () {
  var nz = Object.assign({}, KSB.IDEAL, { phaseErr: 0.27, virtualZ: -0.27 });
  near(KSB.experiment({ reps: 30, noise: nz, rng: NL.rng(8) }).chi, 6, 1e-9);
});
test("net ancilla phase pi flips every reading: chi = -6; pi/2 scrambles: chi ~ 0", function () {
  near(KSB.experiment({ reps: 30, noise: Object.assign({}, KSB.IDEAL, { phaseErr: 1 }), rng: NL.rng(9) }).chi, -6, 1e-9);
  assert.ok(Math.abs(KSB.experiment({ reps: 300, noise: Object.assign({}, KSB.IDEAL, { phaseErr: 0.5 }), rng: NL.rng(10) }).chi) < 0.3);
});
test("per-Pauli agreement: compatible = 1 for all nine with no noise", function () {
  var res = KSB.experiment({ reps: 40, noise: KSB.IDEAL, rng: NL.rng(12) });
  assert.strictEqual(res.perCell.compatible.length, 9);
  res.perCell.compatible.forEach(function (v, i) { near(v, 1, 1e-12, "cell " + i); assert.ok(res.perCell.nCompatible[i] > 0); });
});

console.log("GHZ game");
test("classical optimum 1/2 + 2^-ceil(N/2), brute force N = 2..10", function () {
  for (var N = 2; N <= 10; N++) near(GHZ.classicalOptimumBrute(N), GHZ.classicalBound(N), 1e-12, "N=" + N);
});
test("X if x=0, Y if x=1 wins with certainty (N = 2..8)", function () {
  for (var N = 2; N <= 8; N++) {
    var b = []; for (var j = 0; j < N; j++) b.push(["X", "Y"]);
    near(GHZ.quantumWin(b), 1, 1e-9, "N=" + N);
  }
});
test("a wrong basis choice drops the quantum win rate", function () {
  // player 3 measures X on x=1: inputs 101 and 011 become coin flips
  near(GHZ.quantumWin([["X", "Y"], ["X", "Y"], ["X", "X"]]), 0.75, 1e-9);
  near(GHZ.quantumWin([["Z", "Z"], ["Z", "Z"], ["Z", "Z"]]), 0.5, 1e-9);
});
test("classicalWin of a hand strategy", function () {
  near(GHZ.classicalWin([[0, 1], [0, 1], [0, 1]]), 0.25, 1e-12); // y = x: only 000 wins
  near(GHZ.classicalWin([[0, 1], [0, 1], [0, 0]]), 0.75, 1e-12); // optimal: loses only on 110
});
test("chip growth patterns: matchings on lattice edges, every qubit joins once", function () {
  for (var N = 2; N <= 71; N += 7) {
    var pat = GHZ.growth(N, NL.rng(N)), seen = {}; seen[pat.root] = 1;
    pat.layers.forEach(function (layer) {
      var busy = {};
      layer.forEach(function (p) {
        assert.ok(seen[p[0]] && !seen[p[1]], "control in, target new");
        assert.ok(pat.lattice.nbrs[p[0]].indexOf(p[1]) >= 0, "nearest neighbour");
        assert.ok(!busy[p[0]] && !busy[p[1]], "matching"); busy[p[0]] = busy[p[1]] = 1;
      });
      layer.forEach(function (p) { seen[p[1]] = 1; });
    });
    assert.strictEqual(Object.keys(seen).length, N);
  }
});
test("chip circuit wins every even input on the statevector (N = 3..9)", function () {
  for (var N = 3; N <= 9; N++) {
    var pat = GHZ.growth(N, NL.rng(100 + N));
    GHZ.evenInputs(N).forEach(function (x) {
      var g = GHZ.circuit(pat, x), s = SV.runCircuit(g.circuit);
      near(SV.parityProb(s, g.observables[0], GHZ.target(x)), 1, 1e-9, "N=" + N + " x=" + x);
    });
  }
});
test("growth depth stays far below N on the chip", function () {
  var pat = GHZ.growth(71, NL.rng(1));
  assert.ok(pat.layers.length <= 16, "depth " + pat.layers.length);
});
test("noisy win rate falls with N but stays above the classical bound to 71", function () {
  var prev = 1;
  [5, 20, 40, 71].forEach(function (N) {
    var pat = GHZ.growth(N, NL.rng(N)), p = GHZ.winProbBits(pat, GHZ.randomInputBits(N, NL.rng(2 * N)), C.PAPER_NOISE);
    assert.ok(p < prev && p > GHZ.classicalBound(N), "N=" + N + " p=" + p);
    prev = p;
  });
});

test("GHZ fidelity: 1 without noise", function () {
  var f = GHZ.fidelity(GHZ.growth(6, NL.rng(1)), C.NO_NOISE, { exhaustive: true });
  near(f.FX, 1, 1e-12); near(f.FZ, 1, 1e-12);
});
test("GHZ fidelity under readout error matches the paper's Eq. S42 exactly", function () {
  var e = 0.03, N = 7, f = GHZ.fidelity(GHZ.growth(N, NL.rng(2)), { p1: 0, p2: 0, idle: 0, readout: e }, { exhaustive: true });
  near(f.FX, Math.pow(1 - 2 * e, N), 1e-12);
  near(f.FZ, Math.pow(1 - e, N) + Math.pow(e, N), 1e-12);
});
test("P_w = (1 + F^X)/2 over all games", function () {
  var N = 6, pat = GHZ.growth(N, NL.rng(3)), noise = C.PAPER_NOISE, pw = 0, n = 0;
  GHZ.evenInputs(N).forEach(function (x) { var xb = new Uint8Array(N); for (var j = 0; j < N; j++) xb[j] = (x >> j) & 1; pw += GHZ.winProbBits(pat, xb, noise); n++; });
  near(pw / n, (1 + GHZ.fidelity(pat, noise, { exhaustive: true }).FX) / 2, 1e-12);
});

console.log("Hidden linear function");
function bitsOf(n, m) { var v = new Uint32Array(HLF.words(n)); for (var i = 0; i < n; i++) if ((m >> i) & 1) HLF.bflip(v, i); return v; }
test("lattice CZ colouring gives four matchings", function () {
  var L = NL.lattice(105);
  for (var layer = 0; layer < 4; layer++) {
    var used = {};
    L.edges.filter(function (e) { return e.layer === layer; }).forEach(function (e) { assert.ok(!used[e.a] && !used[e.b]); used[e.a] = used[e.b] = 1; });
  }
});
test("kernel vectors are in the nullspace and q is linear (into {0,2}) on it", function () {
  for (var t = 0; t < 30; t++) {
    var n = 9 + (t % 4), inst = HLF.instance(n, 0.5, NL.rng(t));
    inst.kernel.forEach(function (v) { assert.ok(HLF.bzero(HLF.matVec(inst, v))); });
    // enumerate all of L by brute force and check q(x+y) = q(x)+q(y)
    var Lset = [];
    for (var m = 0; m < (1 << n); m++) { var x = bitsOf(n, m); if (HLF.bzero(HLF.matVec(inst, x))) Lset.push(x); }
    assert.strictEqual(Lset.length, 1 << inst.kernel.length);
    Lset.forEach(function (x) {
      assert.strictEqual(HLF.q(inst, x) & 1, 0);
      Lset.forEach(function (y) {
        var s = x.slice(); for (var u = 0; u < s.length; u++) s[u] ^= y[u];
        assert.strictEqual(HLF.q(inst, s), (HLF.q(inst, x) + HLF.q(inst, y)) & 3);
      });
    });
  }
});
test("solve() returns a z with q(x) = 2 z.x on all of L", function () {
  for (var t = 0; t < 20; t++) {
    var n = 10, inst = HLF.instance(n, 0.5, NL.rng(50 + t)), z = HLF.solve(inst);
    assert.ok(HLF.isSolution(inst, z));
    for (var m = 0; m < (1 << n); m++) {
      var x = bitsOf(n, m);
      if (HLF.bzero(HLF.matVec(inst, x))) assert.strictEqual(HLF.q(inst, x), (2 * HLF.bdot(z, x)) & 3);
    }
  }
});
test("the 4-layer circuit outputs exactly the solutions, uniformly (statevector)", function () {
  for (var t = 0; t < 12; t++) {
    var n = 9 + (t % 3), inst = HLF.instance(n, 0.5, NL.rng(200 + t)), s = SV.runCircuit(HLF.circuit(inst));
    var p = SV.probs(s), support = 0, rank = n - inst.kernel.length;
    for (var m = 0; m < p.length; m++) {
      var isSol = HLF.isSolution(inst, bitsOf(n, m));
      if (p[m] > 1e-12) { support++; assert.ok(isSol, "only solutions"); near(p[m], Math.pow(2, -rank), 1e-9, "uniform"); }
      else assert.ok(!isSol, "every solution appears");
    }
    assert.strictEqual(support, 1 << rank);
  }
});
test("idealSample always solves; noiseless success is 1; noise lowers it", function () {
  var inst = HLF.instance(49, 0.5, NL.rng(9));
  for (var i = 0; i < 20; i++) assert.ok(HLF.isSolution(inst, HLF.idealSample(inst, r)));
  assert.strictEqual(HLF.noisySuccess(inst, C.NO_NOISE, 200, r), 1);
  var p = HLF.noisySuccess(inst, C.PAPER_NOISE, 4000, NL.rng(3));
  assert.ok(p < 1 && p > 0.5, "p " + p);
});
test("HLF sampler agrees with exact convolution on a small instance", function () {
  var inst;
  for (var sd = 0; ; sd++) { inst = HLF.instance(16, 0.5, NL.rng(300 + sd)); if (inst.kernel.length >= 2 && inst.kernel.length <= 6) break; }
  var noise = { p1: 0.01, p2: 0.03, readout: 0.03, idle: 0.01 };
  var obs = inst.kernel.map(function (v) { return HLF.bitsToList(v, inst.n); });
  var ft = C.faultTable(C.withNoise(HLF.circuit(inst), noise), inst.n, obs);
  near(C.sampler(ft).okFraction(100000, NL.rng(11)), C.exactDistribution(ft)[0], 0.006);
});

console.log("Paper data (arXiv:2512.02284)");
function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
test("extracted magic-square points reproduce the printed averages", function () {
  near(mean(NL.PAPER.magic.fig1D), 0.9830, 0.001);
  near(mean(NL.PAPER.magic.s3I), 0.9773, 0.0003);
  near(mean(NL.PAPER.magic.s3II), 0.9355, 0.0003);
});
test("extracted KSB terms sum to the printed chi = 5.618", function () { near(mean(NL.PAPER.ksb.fig2B), 5.618, 0.001); });
test("GHZ and HLF series cover N = 3..71 and n = 9..105", function () {
  assert.strictEqual(NL.PAPER.ghz.fig3B.length, 69);
  assert.strictEqual(NL.PAPER.hlf.fig4B.length, 97);
});
test("GHZ data sit above the (ceiling) classical bound, as in Fig. 3B", function () {
  NL.PAPER.ghz.fig3B.forEach(function (p, i) { assert.ok(p > GHZ.classicalBound(i + 3)); });
});
test("paper's HLF classical steps equal ceil(log2(edges + nodes)) for square grids", function () {
  [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10]].forEach(function (g) {
    var n = g[0] * g[1], s = n + 2 * n - g[0] - g[1];
    assert.strictEqual(NL.paperClassicalLayers(n), Math.ceil(Math.log2(s)), "n=" + n);
  });
});
test("our model tracks the measured GHZ curve within 0.03", function () {
  var R = NL.rng(77);
  [10, 30, 50, 71].forEach(function (N) {
    var a = 0, k = 0;
    for (var p = 0; p < 6; p++) { var pat = GHZ.growth(N, R); for (var g = 0; g < 5; g++) { a += GHZ.winProbBits(pat, GHZ.randomInputBits(N, R), C.PAPER_NOISE); k++; } }
    near(a / k, NL.PAPER.ghz.fig3B[N - 3], 0.03, "N=" + N);
  });
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

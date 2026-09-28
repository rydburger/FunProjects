// Tests for ../stabilizer.js and the Zoo Tycoon species/biome data.
// Run with:  node quantum-games/tests/stabilizer.test.js
// No dependencies beyond Node's built-in assert.
"use strict";
var assert = require("assert");
var S = require("../stabilizer.js");
var Zoo = require("../qec-zoo-tycoon/zoo-data.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}
var P = S.fromString, str = S.toString;
var SPECIES_IDS = Object.keys(Zoo.SPECIES);
var BIOME_IDS = Object.keys(Zoo.BIOMES);

console.log("Pauli algebra");
test("string round-trip", function () {
  ["IXYZ", "XZZXI", "YYYYYYYYY", "I"].forEach(function (s) { assert.strictEqual(str(P(s)), s); });
});
test("32-qubit operators survive the sign bit", function () {
  var s = "Z" + "I".repeat(30) + "Y";
  assert.strictEqual(str(P(s)), s);
  assert.ok(P(s).x >= 0 && P(s).z >= 0);
  assert.strictEqual(S.weight(P(s)), 2);
});
test("multiply is XOR, phases dropped", function () {
  assert.strictEqual(str(S.multiply(P("XZI"), P("ZZY"))), "YIY");
  assert.ok(S.isIdentity(S.multiply(P("XYZ"), P("XYZ"))));
});
test("single-qubit commutation table", function () {
  var ops = ["I", "X", "Y", "Z"];
  ops.forEach(function (a) {
    ops.forEach(function (b) {
      var expect = a === "I" || b === "I" || a === b;
      assert.strictEqual(S.commutes(P(a), P(b)), expect, a + " vs " + b);
    });
  });
});
test("multi-qubit commutation counts anticommuting sites", function () {
  assert.ok(S.commutes(P("XX"), P("ZZ")));
  assert.ok(!S.commutes(P("XXX"), P("ZZZ")));
  assert.ok(S.commutes(P("XZZXI"), P("IXZZX")));
});
test("rank and group membership", function () {
  assert.strictEqual(S.rank([P("ZZI"), P("IZZ"), P("ZIZ")]), 2);
  assert.ok(S.inGroup([P("ZZI"), P("IZZ")], P("ZIZ")));
  assert.ok(!S.inGroup([P("ZZI"), P("IZZ")], P("ZII")));
  assert.ok(S.inGroup([P("ZZI")], S.identity(3)));
});
test("forEachPauliOfWeight enumerates C(n,w)·3^w distinct Paulis", function () {
  var seen = new Set();
  S.forEachPauliOfWeight(5, 2, function (p) {
    assert.strictEqual(S.weight(p), 2);
    seen.add(str(p));
  });
  assert.strictEqual(seen.size, 10 * 9);
});
test("seeded RNG is deterministic", function () {
  var a = S.seededRng(42), b = S.seededRng(42);
  for (var i = 0; i < 10; i++) assert.strictEqual(a(), b());
});
test("sampleNoise respects the channel", function () {
  var rng = S.seededRng(1);
  for (var i = 0; i < 200; i++) {
    var e = S.sampleNoise(9, S.channels.bitFlip(0.3), rng);
    assert.strictEqual(e.z, 0);
  }
  var n = 0, trials = 20000, rng2 = S.seededRng(2);
  for (var j = 0; j < trials; j++) n += S.weight(S.sampleNoise(1, S.channels.depolarizing(0.1), rng2));
  assert.ok(Math.abs(n / trials - 0.1) < 0.01, "empirical rate " + n / trials);
});
test("validateCode catches a broken code", function () {
  var bad = S.makeCode({ name: "bad", n: 3, stabilizers: ["XXI", "ZII"], logicalX: "XXX", logicalZ: "ZZZ" });
  assert.ok(!S.validateCode(bad).ok);
  var dep = S.makeCode({ name: "dep", n: 3, stabilizers: ["ZZI", "IZZ", "ZIZ"], logicalX: "XXX", logicalZ: "ZII" });
  assert.ok(!S.validateCode(dep).ok);
});

console.log("Species (codes)");
var EXPECTED = { tortoise: [3, 1], owl: [9, 1], peacock: [7, 1], pangolin: [5, 1], axolotl: [9, 1] };
SPECIES_IDS.forEach(function (id) {
  var sp = Zoo.SPECIES[id], code = sp.code;
  test(sp.name + " is a valid [[" + EXPECTED[id].join(",") + "]] code", function () {
    var v = S.validateCode(code);
    assert.ok(v.ok, v.errors.join("; "));
    assert.strictEqual(code.n, EXPECTED[id][0]);
    assert.strictEqual(v.k, EXPECTED[id][1]);
    assert.strictEqual(sp.layout.length, code.n, "layout has one position per qubit");
  });
});

// Brute-force minimum weight of a nontrivial logical operator restricted
// to the given single-qubit Pauli types.
function distance(code, types) {
  for (var w = 1; w <= code.n; w++) {
    var found = false;
    S.forEachPauliOfWeight(code.n, w, function (p) {
      if (found) return;
      for (var q = 0; q < code.n; q++) if (types.indexOf(S.at(p, q)) < 0 && S.at(p, q) !== "I") return;
      if (S.syndrome(code, p) === 0 && S.isLogicalError(code, p)) found = true;
    });
    if (found) return w;
  }
  return Infinity;
}
test("distances: d=3 for Owl, Peacock, Pangolin, Axolotl", function () {
  ["owl", "peacock", "pangolin", "axolotl"].forEach(function (id) {
    assert.strictEqual(distance(Zoo.SPECIES[id].code, ["X", "Y", "Z"]), 3, id);
  });
});
test("Tortoise: d=1 overall, d=3 against bit flips", function () {
  var code = Zoo.SPECIES.tortoise.code;
  assert.strictEqual(distance(code, ["X", "Y", "Z"]), 1);
  assert.strictEqual(distance(code, ["X"]), 3);
});
test("Pangolin is perfect: all 16 syndromes hit by exactly one weight-≤1 error", function () {
  var code = Zoo.SPECIES.pangolin.code, counts = new Map();
  counts.set(0, 1);
  S.forEachPauliOfWeight(5, 1, function (p) {
    var s = S.syndrome(code, p);
    counts.set(s, (counts.get(s) || 0) + 1);
  });
  assert.strictEqual(counts.size, 16);
  counts.forEach(function (c) { assert.strictEqual(c, 1); });
});

console.log("Keepers (decoders)");
["owl", "peacock", "pangolin", "axolotl"].forEach(function (id) {
  var code = Zoo.SPECIES[id].code;
  Object.keys(Zoo.KEEPERS).forEach(function (kid) {
    var keeper = Zoo.KEEPERS[kid];
    test(keeper.name + " corrects every single-qubit error on the " + Zoo.SPECIES[id].name, function () {
      var dec = S.buildLookupDecoder(code, keeper.maxWeight);
      S.forEachPauliOfWeight(code.n, 1, function (E) {
        var r = S.correct(code, dec, E).residual;
        assert.strictEqual(S.syndrome(code, r), 0, "nonzero residual syndrome for " + str(E));
        assert.ok(!S.isLogicalError(code, r), str(E) + " decoded into a logical error");
      });
    });
  });
});
test("minimum-weight table always returns a correction of the right syndrome", function () {
  SPECIES_IDS.forEach(function (id) {
    var code = Zoo.SPECIES[id].code, dec = S.buildLookupDecoder(code, 2);
    dec.table.forEach(function (C, s) {
      assert.strictEqual(S.syndrome(code, C), s);
      if (s !== 0) assert.ok(S.weight(C) >= 1 && S.weight(C) <= 2);
    });
  });
});
test("Tortoise: every single X corrected, every single Z is a logical error", function () {
  var code = Zoo.SPECIES.tortoise.code, dec = S.buildLookupDecoder(code, 1);
  for (var q = 0; q < 3; q++) {
    var rx = S.correct(code, dec, S.single(3, q, "X")).residual;
    assert.ok(S.isIdentity(rx) || !S.isLogicalError(code, rx));
    var rz = S.correct(code, dec, S.single(3, q, "Z")).residual;
    assert.strictEqual(S.syndrome(code, rz), 0);
    assert.ok(S.isLogicalError(code, rz), "Z" + q + " should flip the logical phase");
  }
});
test("logicalAction distinguishes X̄ and Z̄ flips", function () {
  var code = Zoo.SPECIES.axolotl.code;
  var ax = S.logicalAction(code, code.logicalX[0]);
  assert.deepStrictEqual([ax.x[0], ax.z[0]], [true, false]);
  var az = S.logicalAction(code, code.logicalZ[0]);
  assert.deepStrictEqual([az.x[0], az.z[0]], [false, true]);
  assert.ok(!S.logicalAction(code, code.stabilizers[0]).any);
});

console.log("Biomes (placement)");
BIOME_IDS.forEach(function (bid) {
  var biome = Zoo.BIOMES[bid];
  test(biome.name + " is home to exactly its native species", function () {
    SPECIES_IDS.forEach(function (sid) {
      var r = Zoo.checkPlacement(sid, bid);
      assert.strictEqual(r.ok, sid === biome.native, sid + " in " + bid + ": " + r.reason);
      if (!r.ok) assert.ok(r.reason && r.reason.length > 0);
    });
  });
  test(biome.name + "'s checks are independent and commute", function () {
    var ops = biome.checkOps;
    assert.strictEqual(S.rank(ops), ops.length);
    ops.forEach(function (a) { ops.forEach(function (b) { assert.ok(S.commutes(a, b)); }); });
  });
});
test("every biome lists a different generating set than its species (real group check, not ID match)", function () {
  var differing = BIOME_IDS.filter(function (bid) {
    var b = Zoo.BIOMES[bid], gens = Zoo.SPECIES[b.native].code.stabilizers.map(str);
    return b.checks.some(function (c) { return gens.indexOf(c) < 0; });
  });
  assert.strictEqual(differing.length, BIOME_IDS.length, "only " + differing.join(","));
});
test("sameStabilizerGroup rejects same-size codes (Owl vs Axolotl, both n=9)", function () {
  assert.ok(!S.sameStabilizerGroup(Zoo.SPECIES.owl.code.stabilizers, Zoo.SPECIES.axolotl.code.stabilizers));
});
test("mismatch explanation names a clashing logical when there is one", function () {
  // Tortoise habitat with an X check added in place of a Z check.
  var code = Zoo.SPECIES.tortoise.code;
  var f = S.firstForeignCheck(code, [P("XXI"), P("IZZ")]);
  assert.ok(f && f.logical, "expected a logical clash");
  assert.strictEqual(f.logical.name, "Z̄");
});
test("under-measuring habitat reports the missing check", function () {
  var code = Zoo.SPECIES.tortoise.code;
  var missing = S.missingChecks(code, [P("ZZI")]);
  assert.deepStrictEqual(missing.map(str), ["IZZ"]);
});

console.log("Monte Carlo sanity");
// Code-capacity noise, one round: E ~ depolarizing(p), decode once.
function logicalRate(code, dec, p, trials, seed) {
  var rng = S.seededRng(seed), fails = 0, ch = S.channels.depolarizing(p);
  for (var t = 0; t < trials; t++) {
    var r = S.correct(code, dec, S.sampleNoise(code.n, ch, rng)).residual;
    if (S.syndrome(code, r) === 0 && S.isLogicalError(code, r)) fails++;
  }
  return fails / trials;
}
["owl", "peacock", "pangolin", "axolotl"].forEach(function (id) {
  test(Zoo.SPECIES[id].name + ": logical rate ~ p² (beats a bare qubit at p=1%)", function () {
    var code = Zoo.SPECIES[id].code, dec = S.buildLookupDecoder(code, 2);
    var p = 0.01, trials = 40000;
    var rate = logicalRate(code, dec, p, trials, 7);
    // A bare qubit fails w.p. ~p. A d=3 code fails w.p. ~C·p² with
    // C <= C(n,2)·(pair fraction) — for n <= 9 comfortably under p/2.
    assert.ok(rate < p / 2, "rate " + rate);
    // And quadrupling p should raise the rate by clearly more than 4× (p² scaling).
    var rate4 = logicalRate(code, dec, 4 * p, trials, 8);
    assert.ok(rate4 > 8 * Math.max(rate, 1 / trials), "rate " + rate + " -> " + rate4);
  });
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

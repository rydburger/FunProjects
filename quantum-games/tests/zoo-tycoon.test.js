// Tests for the Zoo Tycoon exhibit simulation and park model.
// Run with:  node quantum-games/tests/zoo-tycoon.test.js
"use strict";
var assert = require("assert");
var S = require("../stabilizer.js");
var Z = require("../qec-zoo-tycoon/zoo-data.js");
var X = require("../qec-zoo-tycoon/exhibit-sim.js");
var Park = require("../qec-zoo-tycoon/park.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}
function exhibit(speciesId, keeperId, p, seed, channel) {
  return X.createExhibit({
    speciesId: speciesId, keeperId: keeperId,
    climate: { channel: channel || "depolarizing", p: p }, rng: S.seededRng(seed)
  });
}
function runTicks(ex, n) { for (var i = 0; i < n; i++) X.runTick(ex); return ex; }

console.log("Exhibit simulation");
test("phases cycle noise -> measure -> correct", function () {
  var ex = exhibit("axolotl", "keeper", 0.05, 1);
  assert.deepStrictEqual([1, 2, 3, 4].map(function () { return X.advancePhase(ex).phase; }),
    ["noise", "measure", "correct", "noise"]);
});
test("a tick is roundsPerTick rounds", function () {
  var ex = exhibit("peacock", "head", 0.01, 2);
  runTicks(ex, 10);
  assert.strictEqual(ex.ticks, 10);
  assert.strictEqual(ex.rounds, 30);
  var ex2 = exhibit("peacock", null, 0.01, 2);
  runTicks(ex2, 10);
  assert.strictEqual(ex2.rounds, 10);
});
test("runTick finishes a tick started mid-round", function () {
  var ex = exhibit("owl", "keeper", 0.01, 3);
  X.advancePhase(ex); X.advancePhase(ex); // noise, measure
  X.runTick(ex);
  assert.strictEqual(ex.ticks, 1);
  assert.strictEqual(ex.phase, "correct");
});
test("zero noise: never sick, always clean", function () {
  var ex = runTicks(exhibit("pangolin", null, 0, 4), 200);
  assert.strictEqual(ex.sick, 0);
  assert.ok(S.isIdentity(ex.E));
  assert.strictEqual(ex.incident, null);
});
test("a single error is always fixed by a keeper", function () {
  var ex = exhibit("axolotl", "intern", 0, 5);
  X.advancePhase(ex);                      // noise (none)
  ex.E = S.single(9, 4, "Y");              // inject Y4
  X.advancePhase(ex);                      // measure
  var ev = X.advancePhase(ex);             // correct
  assert.strictEqual(ev.sick, null);
  assert.ok(S.isIdentity(ex.E));
  assert.ok(ev.clean || ev.leftover);
  assert.ok(ex.incident && S.equals(ex.incident.before, S.single(9, 4, "Y")));
});
test("an undetectable logical is caught by the vet", function () {
  var ex = exhibit("axolotl", "keeper", 0, 6);
  X.advancePhase(ex);
  ex.E = ex.code.logicalX[0];
  X.advancePhase(ex);
  var ev = X.advancePhase(ex);
  assert.ok(ev.sick, "expected sickness");
  assert.strictEqual(ev.sick.kind, "X̄");
  assert.strictEqual(ev.sick.cause, "undetectable");
  assert.strictEqual(ex.sick, 1);
  // (the tick also completes, so one tick of recovery applies)
  assert.strictEqual(ex.health, 100 - X.SICK_HEALTH_HIT + X.RECOVERY_PER_TICK);
  assert.ok(S.isIdentity(ex.E), "vet resets the animal");
});
test("leftover stabilizers are swept away", function () {
  var ex = exhibit("owl", "keeper", 0, 7);
  X.advancePhase(ex);
  ex.E = S.fromString("ZZIIIIIII");        // Z0Z1 is a Shor stabilizer
  X.advancePhase(ex);
  var ev = X.advancePhase(ex);
  assert.strictEqual(ev.sick, null);
  assert.ok(ev.leftover);
  assert.ok(S.isIdentity(ex.E));
});
test("an intern shrugs at weight-2 syndromes the keeper knows", function () {
  var code = Z.SPECIES.axolotl.code;
  var intern = X.decoderFor("axolotl", 1), keeper = X.decoderFor("axolotl", 2);
  var found = false;
  S.forEachPauliOfWeight(9, 2, function (p) {
    var s = S.syndrome(code, p);
    if (!intern.knows(s) && keeper.knows(s)) found = true;
  });
  assert.ok(found);
});
test("no keeper is much worse than a keeper", function () {
  var none = runTicks(exhibit("axolotl", null, 0.02, 11), 3000);
  var kept = runTicks(exhibit("axolotl", "keeper", 0.02, 11), 3000);
  assert.ok(none.sick > 3 * Math.max(kept.sick, 1), "none " + none.sick + " vs keeper " + kept.sick);
});
test("Head Keeper (3 rounds/tick) beats a Keeper at the same noise", function () {
  var keeper = runTicks(exhibit("peacock", "keeper", 0.05, 12), 4000);
  var head = runTicks(exhibit("peacock", "head", 0.05, 12), 4000);
  assert.ok(head.sick < keeper.sick * 0.7, "head " + head.sick + " vs keeper " + keeper.sick);
});
test("Tortoise thrives in bit-flip climate, suffers under phase flips", function () {
  var dry = runTicks(exhibit("tortoise", "keeper", 0.01, 13, "bitFlip"), 3000);
  var wet = runTicks(exhibit("tortoise", "keeper", 0.01, 13, "phaseFlip"), 3000);
  assert.ok(wet.sick > 10 * Math.max(dry.sick, 1), "bitFlip " + dry.sick + " vs phaseFlip " + wet.sick);
});
test("health recovers per tick and is capped at 100", function () {
  var ex = exhibit("axolotl", "keeper", 0, 14);
  ex.health = 50;
  runTicks(ex, 10);
  assert.strictEqual(ex.health, 50 + 10 * X.RECOVERY_PER_TICK);
  runTicks(ex, 1000);
  assert.strictEqual(ex.health, 100);
});

console.log("Park");
function park(seed) { return Park.createPark({ rng: S.seededRng(seed || 1) }); }
test("starts with the configured funding and an empty grid", function () {
  var P = park();
  assert.strictEqual(P.cash, Z.ECONOMY.startingCash);
  assert.strictEqual(P.grid.length, P.width * P.height);
  assert.ok(P.grid.every(function (c) { return c === null; }));
  assert.strictEqual(Park.day(P), 1);
});
test("build deducts cost and occupies the footprint", function () {
  var P = park();
  var r = Park.build(P, "wetlands", 1, 1);
  assert.ok(r.ok);
  assert.strictEqual(P.cash, Z.ECONOMY.startingCash - Z.BIOMES.wetlands.cost);
  assert.strictEqual(Park.exhibitAt(P, 3, 3).id, r.exhibit.id);
  assert.strictEqual(Park.exhibitAt(P, 4, 1), null);
});
test("build rejects overlap, out-of-bounds and unaffordable", function () {
  var P = park();
  Park.build(P, "wetlands", 0, 0);
  assert.ok(!Park.canBuild(P, "riverbank", 2, 2).ok);
  assert.ok(!Park.canBuild(P, "wetlands", 10, 0).ok);
  assert.ok(Park.canBuild(P, "riverbank", 3, 0).ok);
  P.cash = 100;
  assert.ok(!Park.canBuild(P, "riverbank", 3, 0).ok);
});
test("enclosures of the same biome are numbered", function () {
  var P = park();
  Park.build(P, "riverbank", 0, 0);
  var b = Park.build(P, "riverbank", 2, 0);
  assert.strictEqual(Park.exhibitLabel(b.exhibit), "Parity Riverbank #2");
});
test("only the native species can be bought into an enclosure", function () {
  var P = park();
  var rec = Park.build(P, "forest", 0, 0).exhibit;
  var opts = Park.speciesOptions(P, rec.id);
  assert.deepStrictEqual(opts.filter(function (o) { return o.ok; }).map(function (o) { return o.speciesId; }), ["owl"]);
  assert.ok(!Park.buyAnimal(P, rec.id, "axolotl").ok);
  var cash = P.cash;
  assert.ok(Park.buyAnimal(P, rec.id, "owl").ok);
  assert.strictEqual(P.cash, cash - Z.SPECIES.owl.cost);
  assert.ok(!Park.buyAnimal(P, rec.id, "owl").ok, "already occupied");
});
test("keeper hired before the animal arrives is on duty when it does", function () {
  var P = park();
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.setKeeper(P, rec.id, "intern");
  Park.buyAnimal(P, rec.id, "tortoise");
  assert.strictEqual(rec.animal.keeperId, "intern");
  Park.setKeeper(P, rec.id, null);
  assert.strictEqual(rec.animal.keeperId, null);
});
test("a day of ticks: revenue and costs match daily rates, day event fires", function () {
  var P = park(3);
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "tortoise");
  Park.setKeeper(P, rec.id, "keeper");
  rec.animal.climate.p = 0; // no sickness: rates stay constant
  var r = Park.rates(P), cash0 = P.cash, dayEvents = [];
  for (var i = 0; i < Z.ECONOMY.ticksPerDay; i++) dayEvents = dayEvents.concat(Park.tick(P).filter(function (e) { return e.type === "day"; }));
  assert.strictEqual(dayEvents.length, 1);
  assert.strictEqual(Park.day(P), 2);
  assert.ok(Math.abs(P.cash - cash0 - r.net) < 1e-6, "cash delta " + (P.cash - cash0) + " vs net " + r.net);
  assert.ok(Math.abs(dayEvents[0].revenue - r.revenue) < 1e-6);
  assert.ok(Math.abs(dayEvents[0].expenses - (Z.BIOMES.riverbank.upkeep + Z.KEEPERS.keeper.salary)) < 1e-6);
});
test("sickness charges the vet bill and dents reputation", function () {
  var P = park(4);
  var rec = Park.build(P, "wetlands", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "axolotl");
  rec.animal.climate.p = 0;
  // Plant an undetectable logical error mid-round, just before measurement.
  X.advancePhase(rec.animal);
  rec.animal.E = rec.animal.code.logicalZ[0];
  var rep = P.reputation, cash = P.cash;
  var ev = Park.tick(P).filter(function (e) { return e.type === "sick"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].kind, "Z̄");
  assert.strictEqual(P.reputation, rep - Z.ECONOMY.sickReputationHit);
  assert.ok(Math.abs((cash - P.cash) - Z.ECONOMY.vetBill - Park.rates(P).costs / 24 + Park.rates(P).revenue / 24) < 50);
});
test("demolish frees the cells and refunds part of the cost", function () {
  var P = park();
  var rec = Park.build(P, "dunes", 4, 4).exhibit;
  var cash = P.cash;
  var r = Park.demolish(P, rec.id);
  assert.ok(r.ok);
  assert.strictEqual(P.cash, cash + Z.BIOMES.dunes.cost * Z.ECONOMY.demolishRefund);
  assert.ok(P.grid.every(function (c) { return c === null; }));
  assert.ok(Park.canBuild(P, "dunes", 4, 4).ok);
});
test("a well-run starter zoo turns a profit over a month", function () {
  var P = park(5);
  P.cash = 100000;
  var a = Park.build(P, "riverbank", 0, 0).exhibit;
  assert.ok(Park.buyAnimal(P, a.id, "tortoise").ok); Park.setKeeper(P, a.id, "intern");
  var b = Park.build(P, "wetlands", 2, 0).exhibit;
  assert.ok(Park.buyAnimal(P, b.id, "axolotl").ok); Park.setKeeper(P, b.id, "keeper");
  var cash0 = P.cash;
  for (var i = 0; i < 30 * Z.ECONOMY.ticksPerDay; i++) Park.tick(P);
  assert.ok(P.cash > cash0, "cash went from " + cash0 + " to " + P.cash);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

// Tests for the Zoo Tycoon exhibit simulation and park model.
// Run with:  node quantum-games/tests/zoo-tycoon.test.js
"use strict";
var assert = require("assert");
var S = require("../stabilizer.js");
var Z = require("../qec-zoo-tycoon/zoo-data.js");
var X = require("../qec-zoo-tycoon/exhibit-sim.js");
var Park = require("../qec-zoo-tycoon/park.js");
var Placard = require("../qec-zoo-tycoon/placard.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}
var QUIET = { coherence: 0, gates: 0, readout: 0, cycle: 1 };
var BASE = X.labValues(null);
// keeperLevel: 0 = no keeper; speed defaults to "fast enough for anything".
function exhibit(speciesId, keeperLevel, lab, seed, channel, speed) {
  return X.createExhibit({
    speciesId: speciesId, channel: channel || "depolarizing", lab: lab || BASE,
    keeper: keeperLevel ? { level: keeperLevel, speed: speed || 99 } : null, rng: S.seededRng(seed)
  });
}
function runTicks(ex, n) { for (var i = 0; i < n; i++) X.runTick(ex); return ex; }
// Noise weights from `lab`, but no random errors (rng never fires): for
// scripted single-fault tests, decoders still know which faults are likely.
function scriptedExhibit(speciesId, keeperLevel) {
  return X.createExhibit({ speciesId: speciesId, channel: "depolarizing", lab: BASE,
    keeper: keeperLevel ? { level: keeperLevel, speed: 99 } : null, rng: function () { return 0.99999; } });
}
function labWith(o) { var l = {}; Object.keys(BASE).forEach(function (k) { l[k] = k in o ? o[k] : BASE[k]; }); return l; }

console.log("Exhibit simulation");
test("phases cycle noise -> measure -> correct", function () {
  var ex = exhibit("axolotl", 2, BASE, 1);
  assert.deepStrictEqual([1, 2, 3, 4].map(function () { return X.advancePhase(ex).phase; }),
    ["noise", "measure", "correct", "noise"]);
});
test("a tick is one syndrome cycle's worth of rounds, keeper or not", function () {
  var ex = runTicks(exhibit("peacock", 2, labWith({ cycle: 3 }), 2), 10);
  assert.strictEqual(ex.ticks, 10);
  assert.strictEqual(ex.rounds, 30);
  assert.strictEqual(ex.decoded, 30);
  var ex2 = runTicks(exhibit("peacock", 0, labWith({ cycle: 2 }), 2), 10);
  assert.strictEqual(ex2.rounds, 20);
  assert.strictEqual(ex2.decoded, 0);
});
test("runTick finishes a tick started mid-round", function () {
  var ex = exhibit("owl", 2, BASE, 3);
  X.advancePhase(ex); X.advancePhase(ex); // noise, measure
  X.runTick(ex);
  assert.strictEqual(ex.ticks, 1);
  assert.strictEqual(ex.phase, "correct");
});
test("zero noise: never sick, always clean", function () {
  var ex = runTicks(exhibit("pangolin", 0, QUIET, 4), 200);
  assert.strictEqual(ex.sick, 0);
  assert.ok(S.isIdentity(X.residual(ex)));
  assert.strictEqual(ex.incident, null);
});
test("the lab's noise model: idle + gate error per wire, readout + gate error per check", function () {
  var code = Z.SPECIES.axolotl.code, lab = { coherence: 0.009, gates: 0.001, readout: 0.012, cycle: 3 };
  var m = X.noiseModel(code, code.stabilizers, "depolarizing", lab);
  // The centre qubit (4) sits in four checks; corner qubit 0 in two.
  assert.ok(Math.abs(m.rates[4].pX * 3 - (0.003 + 4 * 0.001)) < 1e-12);
  assert.ok(Math.abs(m.rates[0].pX * 3 - (0.003 + 2 * 0.001)) < 1e-12);
  assert.ok(Math.abs(m.q[0] - (0.012 + 4 * 0.001)) < 1e-12);
  assert.ok(Math.abs(m.q[2] - (0.012 + 2 * 0.001)) < 1e-12);
  var bf = X.noiseModel(Z.SPECIES.tortoise.code, Z.SPECIES.tortoise.code.stabilizers, "bitFlip", lab);
  assert.strictEqual(bf.rates[0].pZ, 0);
});
test("every keeper level fixes a single error", function () {
  [1, 2, 3, 4].forEach(function (lvl) {
    var ex = scriptedExhibit("axolotl", lvl);
    X.advancePhase(ex);                         // noise (none)
    ex.mem.E = S.single(9, 4, "Y");             // inject Y4
    for (var k = 0; k < 3 * 4; k++) X.advancePhase(ex);
    assert.strictEqual(ex.sick, 0, "level " + lvl);
    assert.ok(S.isIdentity(X.residual(ex)), "level " + lvl);
  });
});
test("an undetectable logical is caught by the vet", function () {
  var ex = exhibit("axolotl", 2, QUIET, 6);
  X.advancePhase(ex);
  ex.mem.E = ex.code.logicalX[0];
  X.advancePhase(ex);
  var ev = X.advancePhase(ex);
  assert.ok(ev.sick, "expected sickness");
  assert.strictEqual(ev.sick.kind, "X̄");
  assert.strictEqual(ev.sick.cause, "undetectable");
  assert.strictEqual(ex.sick, 1);
  assert.strictEqual(ex.health, 100 - X.SICK_HEALTH_HIT + X.RECOVERY_PER_TICK);
  assert.ok(S.isIdentity(X.residual(ex)), "vet re-prepares the animal");
});
test("leftover stabilizers are folded away", function () {
  var ex = exhibit("owl", 2, QUIET, 7);
  X.advancePhase(ex);
  ex.mem.E = S.fromString("ZZIIIIIII");          // Z0Z1 is a Shor stabilizer
  X.advancePhase(ex);
  var ev = X.advancePhase(ex);
  assert.strictEqual(ev.sick, null);
  assert.ok(ev.leftover);
  assert.ok(S.isIdentity(X.residual(ex)));
});
test("a misread check fools a trainee but not a senior keeper", function () {
  [[1, false], [3, true]].forEach(function (c) {
    var ex = scriptedExhibit("axolotl", c[0]);
    X.runTick(ex);
    var q0 = ex.mem.noise.q[0];
    ex.mem.noise.q[0] = 1;                       // the next measurement of check 0 is misread
    X.advancePhase(ex); X.advancePhase(ex);
    ex.mem.noise.q[0] = q0;
    X.advancePhase(ex);
    var touched = !S.isIdentity(ex.mem.frame);
    runTicks(ex, 4);
    assert.strictEqual(touched, !c[1], "level " + c[0] + (c[1] ? " should ignore it" : " should chase it"));
    assert.ok(S.isIdentity(X.residual(ex)), "and either way the code ends clean");
  });
});
test("a slow keeper runs the best decoder they can keep up with", function () {
  var ex = exhibit("axolotl", 4, BASE, 9, null, 4);
  // Axolotl: 8 checks, so space-time work is ×2: window 3 costs 6, window 2 costs 4.
  assert.strictEqual(X.effectiveLevel(ex, ex.keeper), 3);
  X.setLab(ex, labWith({ cycle: 2 }));
  assert.strictEqual(X.effectiveLevel(ex, ex.keeper), 2); // 2 rounds/hour: 1.5 × 2 = 3 <= 4
  X.setKeeper(ex, { level: 4, speed: 12 });
  assert.strictEqual(ex.level, 4);
});
test("no keeper is much worse than a keeper", function () {
  var none = runTicks(exhibit("axolotl", 0, BASE, 11), 3000);
  var kept = runTicks(exhibit("axolotl", 2, BASE, 11), 3000);
  assert.ok(none.sick > 2 * Math.max(kept.sick, 1), "none " + none.sick + " vs keeper " + kept.sick);
});
test("head keepers beat trainees when readout is noisy (space-time decoding pays)", function () {
  var lab = labWith({ readout: 0.03 });
  ["peacock", "pangolin", "axolotl"].forEach(function (sp) {
    var trainee = 0, head = 0;
    for (var seed = 1; seed <= 3; seed++) {
      trainee += runTicks(exhibit(sp, 1, lab, 20 + seed), 1500).sick;
      head += runTicks(exhibit(sp, 4, lab, 20 + seed), 1500).sick;
    }
    assert.ok(head < trainee * 0.75, sp + ": head " + head + " vs trainee " + trainee);
  });
});
test("lab upgrades cut sickness", function () {
  var base = 0, better = 0;
  for (var seed = 1; seed <= 3; seed++) {
    base += runTicks(exhibit("owl", 2, BASE, 30 + seed), 2000).sick;
    better += runTicks(exhibit("owl", 2, X.labValues({ coherence: 2, gates: 2, readout: 2 }), 30 + seed), 2000).sick;
  }
  assert.ok(better < base / 2, "upgraded " + better + " vs base " + base);
});
test("Tortoise thrives in bit-flip climate, suffers under phase flips", function () {
  var dry = runTicks(exhibit("tortoise", 2, BASE, 13, "bitFlip"), 3000);
  var wet = runTicks(exhibit("tortoise", 2, BASE, 13, "phaseFlip"), 3000);
  assert.ok(wet.sick > 5 * Math.max(dry.sick, 1), "bitFlip " + dry.sick + " vs phaseFlip " + wet.sick);
});
test("health recovers per tick and is capped at 100", function () {
  var ex = exhibit("axolotl", 2, QUIET, 14);
  ex.health = 50;
  runTicks(ex, 10);
  assert.strictEqual(ex.health, 50 + 10 * X.RECOVERY_PER_TICK);
  runTicks(ex, 1000);
  assert.strictEqual(ex.health, 100);
});
test("snapshot/restore keeps the state (and is plain JSON)", function () {
  var ex = runTicks(exhibit("peacock", 3, BASE, 15), 50);
  var snap = JSON.parse(JSON.stringify(X.snapshot(ex)));
  var back = X.restore(snap, { lab: BASE, keeper: { level: 3, speed: 99 }, rng: S.seededRng(1) });
  assert.ok(S.equals(back.mem.E, ex.mem.E) && S.equals(back.mem.frame, ex.mem.frame));
  assert.strictEqual(back.sick, ex.sick);
  assert.strictEqual(back.level, 3);
  runTicks(back, 10);
});

console.log("Park");
function park(seed) { return Park.createPark({ rng: S.seededRng(seed || 1) }); }
function quiet(P) { // silence all noise in a park's animals
  P.order.forEach(function (id) { var a = P.exhibits[id].animal; if (a) X.setLab(a, QUIET); });
}
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
test("keepers are hired as named trainees; one per exhibit, reassignable", function () {
  var P = park();
  var a = Park.build(P, "riverbank", 0, 0).exhibit, b = Park.build(P, "riverbank", 2, 0).exhibit;
  var k1 = Park.hireKeeper(P, a.id).keeper;
  assert.strictEqual(k1.level, 1);
  assert.ok(k1.name.length > 0);
  assert.strictEqual(a.keeperId, k1.id);
  Park.buyAnimal(P, a.id, "tortoise");
  assert.strictEqual(a.animal.level, 1, "a keeper hired before the animal is on duty when it arrives");
  var k2 = Park.hireKeeper(P, a.id).keeper;       // replaces k1 at a
  assert.strictEqual(a.keeperId, k2.id);
  assert.strictEqual(k1.exhibitId, null, "k1 went to the staff room");
  Park.assignKeeper(P, k1.id, b.id);
  assert.strictEqual(b.keeperId, k1.id);
  Park.assignKeeper(P, k2.id, null);
  assert.strictEqual(a.keeperId, null);
  assert.strictEqual(a.animal.level, 0);
  Park.fireKeeper(P, k2.id);
  assert.ok(!P.keepers[k2.id]);
  assert.strictEqual(P.keeperOrder.length, 1);
});
test("every keeper on the payroll is paid, assigned or not", function () {
  var P = park();
  Park.hireKeeper(P); Park.hireKeeper(P);
  assert.strictEqual(Park.rates(P).costs, 2 * Z.KEEPER_LEVELS[1].salary);
});
test("keepers gain experience (and speed) by decoding", function () {
  var P = park(2);
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "tortoise");
  var k = Park.hireKeeper(P, rec.id).keeper;
  runDays(P, 2);
  assert.strictEqual(k.xp, 2 * Z.ECONOMY.ticksPerDay * BASE.cycle);
  assert.ok(Park.keeperSpeed(k) > Z.KEEPER_SPEED.base);
});
test("training: needs experience and the fee; the keeper studies on the job, then levels up", function () {
  var P = park(3);
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "tortoise");
  var k = Park.hireKeeper(P, rec.id).keeper;
  assert.ok(!Park.canTrain(P, k.id).ok, "no experience yet");
  k.xp = Z.TRAINING[2].xp;
  var cash = P.cash;
  assert.ok(Park.trainKeeper(P, k.id).ok);
  assert.strictEqual(P.cash, cash - Z.TRAINING[2].fee);
  assert.strictEqual(rec.animal.level, 1, "still on duty with the old decoder during the course");
  assert.ok(!Park.canTrain(P, k.id).ok, "one course at a time");
  var ev = runDays(P, Z.TRAINING[2].days).filter(function (e) { return e.type === "trained"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(k.level, 2);
  assert.strictEqual(rec.animal.level, 2, "back on duty with the new decoder");
});
test("research: one project at a time; on completion every exhibit gets the new hardware", function () {
  var P = park(4);
  P.cash = 100000;
  var rec = Park.build(P, "wetlands", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "axolotl");
  assert.ok(Park.startResearch(P, "readout").ok);
  assert.ok(!Park.canResearch(P, "coherence").ok, "lab busy");
  var q0 = rec.animal.mem.noise.q[0];
  var ev = runDays(P, Z.RESEARCH[1].days).filter(function (e) { return e.type === "research"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(P.lab.levels.readout, 1);
  assert.ok(rec.animal.mem.noise.q[0] < q0);
  assert.ok(Park.canResearch(P, "coherence").ok);
  P.lab.levels.cycle = Z.LAB.cycle.values.length - 1;
  assert.ok(!Park.canResearch(P, "cycle").ok, "fully upgraded");
});
test("a day of ticks: revenue and costs match daily rates, day event fires", function () {
  var P = park(3);
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "tortoise");
  Park.hireKeeper(P, rec.id);
  quiet(P); // no sickness: rates stay constant
  var r = Park.rates(P), cash0 = P.cash, dayEvents = [];
  for (var i = 0; i < Z.ECONOMY.ticksPerDay; i++) dayEvents = dayEvents.concat(Park.tick(P).filter(function (e) { return e.type === "day"; }));
  assert.strictEqual(dayEvents.length, 1);
  assert.strictEqual(Park.day(P), 2);
  assert.ok(Math.abs(P.cash - cash0 - r.net) < 1e-6, "cash delta " + (P.cash - cash0) + " vs net " + r.net);
  assert.ok(Math.abs(dayEvents[0].revenue - r.revenue) < 1e-6);
  assert.ok(Math.abs(dayEvents[0].expenses - (Z.BIOMES.riverbank.upkeep + Z.KEEPER_LEVELS[1].salary)) < 1e-6);
});
test("sickness charges the vet bill and dents reputation", function () {
  var P = park(4);
  var rec = Park.build(P, "wetlands", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "axolotl");
  quiet(P);
  // Plant an undetectable logical error mid-round, just before measurement.
  X.advancePhase(rec.animal);
  rec.animal.mem.E = rec.animal.code.logicalZ[0];
  var rep = P.reputation, cash = P.cash;
  var ev = Park.tick(P).filter(function (e) { return e.type === "sick"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].kind, "Z̄");
  assert.strictEqual(P.reputation, rep - Z.ECONOMY.sickReputationHit);
  assert.ok(Math.abs((cash - P.cash) - Z.ECONOMY.vetBill - Park.rates(P).costs / 24 + Park.rates(P).revenue / 24) < 50);
});
test("demolish frees the cells, refunds part of the cost, and sends the keeper to the staff room", function () {
  var P = park();
  var rec = Park.build(P, "dunes", 4, 4).exhibit;
  var k = Park.hireKeeper(P, rec.id).keeper;
  var cash = P.cash;
  var r = Park.demolish(P, rec.id);
  assert.ok(r.ok);
  assert.strictEqual(P.cash, cash + Z.BIOMES.dunes.cost * Z.ECONOMY.demolishRefund);
  assert.ok(P.grid.every(function (c) { return c === null; }));
  assert.ok(Park.canBuild(P, "dunes", 4, 4).ok);
  assert.strictEqual(k.exhibitId, null);
});
test("a well-run starter zoo turns a profit over a month", function () {
  var P = park(5);
  P.cash = 100000;
  var a = Park.build(P, "riverbank", 0, 0).exhibit;
  assert.ok(Park.buyAnimal(P, a.id, "tortoise").ok); Park.hireKeeper(P, a.id);
  var b = Park.build(P, "wetlands", 2, 0).exhibit;
  assert.ok(Park.buyAnimal(P, b.id, "axolotl").ok); Park.hireKeeper(P, b.id);
  var cash0 = P.cash;
  for (var i = 0; i < 30 * Z.ECONOMY.ticksPerDay; i++) Park.tick(P);
  assert.ok(P.cash > cash0, "cash went from " + cash0 + " to " + P.cash);
});

console.log("Rules: win, lose, investors, save/load");
function runDays(P, n) { var ev = []; for (var i = 0; i < n * Z.ECONOMY.ticksPerDay; i++) ev = ev.concat(Park.tick(P)); return ev; }
test("seven days in debt loses the game, and the park stops", function () {
  var P = park(21);
  P.cash = -1;
  var ev = runDays(P, Z.ECONOMY.bankruptDays);
  assert.strictEqual(ev.filter(function (e) { return e.type === "debt"; }).length, Z.ECONOMY.bankruptDays - 1);
  var lost = ev.filter(function (e) { return e.type === "lost"; });
  assert.strictEqual(lost.length, 1);
  assert.strictEqual(lost[0].day, Z.ECONOMY.bankruptDays);
  assert.strictEqual(P.status, "lost");
  var t = P.tick;
  assert.deepStrictEqual(Park.tick(P), []);
  assert.strictEqual(P.tick, t);
});
test("climbing back above zero resets the debt counter", function () {
  var P = park(22);
  P.cash = -1;
  runDays(P, 3);
  assert.strictEqual(P.daysInDebt, 3);
  P.cash = 1000;
  runDays(P, 1);
  assert.strictEqual(P.daysInDebt, 0);
  assert.strictEqual(P.status, "playing");
});
test("meeting the goal at day end wins; continueAfterWin keeps the park running", function () {
  var P = park(23);
  P.cash = Z.ECONOMY.goal.cash + 1; P.reputation = Z.ECONOMY.goal.reputation;
  var ev = runDays(P, 1);
  assert.ok(ev.some(function (e) { return e.type === "won" && e.day === 1; }));
  assert.strictEqual(P.status, "won");
  assert.deepStrictEqual(Park.tick(P), []);
  Park.continueAfterWin(P);
  runDays(P, 2);
  assert.strictEqual(Park.day(P), 4);
  assert.strictEqual(P.status, "won", "no second win event");
});
test("cash alone isn't enough: reputation must meet the goal too", function () {
  var P = park(24);
  P.cash = Z.ECONOMY.goal.cash * 2; P.reputation = Z.ECONOMY.goal.reputation - 10;
  runDays(P, 1);
  assert.strictEqual(P.status, "playing");
});
test("an investor update arrives every 30 days with the month's books", function () {
  var P = park(25);
  P.cash = 100000;
  var rec = Park.build(P, "riverbank", 0, 0).exhibit;
  Park.buyAnimal(P, rec.id, "tortoise");
  var ev = runDays(P, 61).filter(function (e) { return e.type === "investor"; });
  assert.deepStrictEqual(ev.map(function (e) { return e.month; }), [1, 2]);
  var m = ev[0];
  assert.ok(m.revenue > 0 && m.expenses > 0);
  assert.ok(Math.abs(m.net - (m.revenue - m.expenses - m.vet)) < 1e-6);
  assert.strictEqual(m.vet, m.sick * Z.ECONOMY.vetBill);
  if (m.sick) assert.strictEqual(m.sickest.exhibitId, rec.id);
});
test("save/load round-trips the park and play continues identically", function () {
  var P = park(26);
  P.cash = 100000;
  var a = Park.build(P, "wetlands", 0, 0).exhibit;
  Park.buyAnimal(P, a.id, "axolotl"); var k = Park.hireKeeper(P, a.id).keeper;
  runDays(P, 5);
  Park.startResearch(P, "gates");
  k.xp = Z.TRAINING[2].xp; Park.trainKeeper(P, k.id);
  runDays(P, 1);
  var json = Park.save(P);
  var Q = Park.load(json, { rng: S.seededRng(99) });
  P.rng = S.seededRng(99); P.exhibits[a.id].animal.rng = P.rng; P.exhibits[a.id].animal.mem.rng = P.rng;
  assert.deepStrictEqual(Q.lab, P.lab);
  assert.strictEqual(Q.keepers[k.id].name, k.name);
  assert.deepStrictEqual(Q.keepers[k.id].training, k.training);
  assert.strictEqual(Q.cash, P.cash);
  assert.strictEqual(Q.tick, P.tick);
  assert.strictEqual(Q.exhibits[a.id].animal.code, Z.SPECIES.axolotl.code);
  assert.deepStrictEqual(Q.grid, P.grid);
  runDays(P, 5); runDays(Q, 5);
  assert.strictEqual(Q.cash, P.cash, "same RNG stream -> same future");
  assert.strictEqual(Q.exhibits[a.id].animal.sick, P.exhibits[a.id].animal.sick);
});
test("load rejects foreign or corrupted saves", function () {
  assert.throws(function () { Park.load('{"version":999}'); });
  var bad = JSON.parse(Park.save(park()));
  bad.exhibits = { 1: { biomeId: "volcano" } };
  assert.throws(function () { Park.load(bad); });
});

console.log("Placards (claims checked against the codes)");
Object.keys(Z.SPECIES).forEach(function (id) {
  var sp = Z.SPECIES[id];
  test(sp.name + ": placard is complete and its params match the computed code", function () {
    var pl = sp.placard;
    assert.ok(pl.summary && pl.origin && pl.facts.length && pl.lab.length && /^[a-z0-9_]+$/.test(pl.zoo));
    var f = Placard.computedFacts(sp.code);
    assert.strictEqual(sp.params.split(" ")[0], Placard.paramsString(f));
    var html = Placard.html(sp);
    assert.ok(html.indexOf(Placard.ZOO_URL + pl.zoo) >= 0);
    assert.ok(html.indexOf(Placard.paramsString(f)) >= 0);
  });
});
test("Tortoise: every single bit flip is caught, every single phase flip is logical", function () {
  var c = Z.SPECIES.tortoise.code;
  for (var q = 0; q < 3; q++) {
    assert.notStrictEqual(S.syndrome(c, S.single(3, q, "X")), 0);
    var e = S.single(3, q, "Z");
    assert.ok(S.syndrome(c, e) === 0 && S.isLogicalError(c, e));
  }
});
test("Owl: Z0 and Z1 differ by a stabilizer (degenerate)", function () {
  var c = Z.SPECIES.owl.code;
  assert.ok(S.inGroup(c.stabilizers, S.multiply(S.single(9, 0, "Z"), S.single(9, 1, "Z"))));
});
test("Peacock: the Z checks read as binary give the flipped qubit's position from 1", function () {
  var c = Z.SPECIES.peacock.code, zChecks = c.stabilizers.filter(function (g) { return g.x === 0; });
  for (var q = 0; q < 7; q++) {
    var E = S.single(7, q, "X"), v = 0;
    zChecks.forEach(function (g) { v = 2 * v + (S.commutes(E, g) ? 0 : 1); });
    assert.strictEqual(v, q + 1);
  }
});
test("Pangolin: the 16 syndromes are exactly no error + the 15 single-qubit errors", function () {
  var c = Z.SPECIES.pangolin.code, seen = { 0: true }, count = 1;
  S.forEachPauliOfWeight(5, 1, function (E) {
    var s = S.syndrome(c, E);
    assert.ok(!seen[s], "two single-qubit errors share a syndrome");
    seen[s] = true; count++;
  });
  assert.strictEqual(count, 16);
  assert.strictEqual(Math.pow(2, c.stabilizers.length), 16);
});
test("Axolotl: X̄ is a column and Z̄ a row of the 3×3 grid", function () {
  var c = Z.SPECIES.axolotl.code;
  assert.strictEqual(S.toString(c.logicalX[0]), "XIIXIIXII");
  assert.strictEqual(S.toString(c.logicalZ[0]), "ZZZIIIIII");
});
test("Placard.html works for a computed code with two animals", function () {
  var a = S.analyzeChecks(4, [S.fromString("XXXX"), S.fromString("ZZZZ")]);
  var html = Placard.html({ name: "custom", code: a.code });
  assert.ok(html.indexOf("[[4,2,2]]") >= 0 && html.indexOf("2 animals") >= 0 && html.indexOf("X̄2") >= 0);
});

console.log("Balance (seeded bot players, one year max)");
// Simple scripted players: each morning, buy the priciest animal they can
// afford (plus its habitat, keeping a $3k buffer), staffed per strategy.
function freeSpot(P, b) {
  var fp = Z.BIOMES[b].footprint;
  for (var y = 0; y + fp[1] <= P.height; y++) for (var x = 0; x + fp[0] <= P.width; x++) {
    var free = true;
    for (var dy = 0; dy < fp[1] && free; dy++) for (var dx = 0; dx < fp[0] && free; dx++) if (P.grid[(y + dy) * P.width + x + dx] !== null) free = false;
    if (free) return [x, y];
  }
  return null;
}
var HOME = {};
Object.keys(Z.BIOMES).forEach(function (b) { HOME[Z.BIOMES[b].native] = b; });
// strategy: { keepers, train, research: bool; reserve: cash kept back before investing }
function botWinDay(strategy, seed) {
  var P = park(seed), prefs = ["axolotl", "pangolin", "peacock", "owl", "tortoise"];
  var dials = ["readout", "coherence", "gates"];
  for (var d = 0; d < 365; d++) {
    for (var i = 0; i < prefs.length; i++) {
      var sp = prefs[i], b = HOME[sp], cost = Z.BIOMES[b].cost + Z.SPECIES[sp].cost;
      if (P.cash < cost + 3000) continue;
      // Like a player, keep some variety: at most 3 of each species.
      if (P.order.filter(function (id) { var a = P.exhibits[id].animal; return a && a.speciesId === sp; }).length >= 3) continue;
      var spot = freeSpot(P, b);
      if (!spot) continue;
      var rec = Park.build(P, b, spot[0], spot[1]).exhibit;
      Park.buyAnimal(P, rec.id, sp);
      if (strategy.keepers) Park.hireKeeper(P, rec.id);
      break;
    }
    if (strategy.train) {
      P.keeperOrder.forEach(function (kid) {
        // Train where it matters: keepers whose animal keeps getting sick.
        var k = P.keepers[kid], an = k.exhibitId && P.exhibits[k.exhibitId].animal;
        if (!an || an.sick * Z.ECONOMY.ticksPerDay * 30 < 2 * Math.max(1, an.ticks)) return;
        var c = Park.canTrain(P, kid);
        if (c.ok && P.cash > c.course.fee + (strategy.reserve || 0)) Park.trainKeeper(P, kid);
      });
    }
    if (strategy.research && !P.lab.project) {
      var dial = dials.slice().sort(function (a, b) { return P.lab.levels[a] - P.lab.levels[b]; })[0];
      var r = Park.canResearch(P, dial);
      if (r.ok && P.cash > r.step.fee + (strategy.reserve || 0)) Park.startResearch(P, dial);
    }
    runDays(P, 1);
    if (P.status === "won") return P.endDay;
    if (P.status === "lost") return -P.endDay;
  }
  return Infinity;
}
function median3(f) { var r = [1, 2, 3].map(f).sort(function (a, b) { return a - b; }); return r[1]; }
var LEARN = { keepers: true, train: true, research: true, reserve: 20000 };
var STATIC = { keepers: true, train: false, research: false };
test("a bot that trains keepers and funds the lab wins within ~4 months", function () {
  var d = median3(function (s) { return botWinDay(LEARN, s); });
  assert.ok(d > 30 && d < 125, "won on day " + d);
});
test("training and research beat a zoo that never invests in either", function () {
  var learn = median3(function (s) { return botWinDay(LEARN, s); });
  var stat = median3(function (s) { return botWinDay(STATIC, s); });
  assert.ok(learn < stat, "learning " + learn + " vs static " + stat);
});
test("a zoo with no keepers goes bankrupt", function () {
  var d = median3(function (s) { return botWinDay({ keepers: false }, s); });
  assert.ok(d < 0 && -d < 60, "result " + d);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

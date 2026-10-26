// Tests for the Zoo Tycoon exhibit simulation and park model.
// Run with:  node quantum-games/tests/zoo-tycoon.test.js
"use strict";
var assert = require("assert");
var S = require("../stabilizer.js");
var Z = require("../qec-zoo-tycoon/zoo-data.js");
var X = require("../qec-zoo-tycoon/exhibit-sim.js");
var Park = require("../qec-zoo-tycoon/park.js");
var Placard = require("../qec-zoo-tycoon/placard.js");
var Habitat = require("../qec-zoo-tycoon/habitat.js");
var Investors = require("../qec-zoo-tycoon/investors.js");

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
  var ex = exhibit("giant", 4, BASE, 9, null, 7);
  // Giant Axolotl: 24 checks, so space-time work is ×3: window 3 costs 9, window 2 costs 6.
  assert.strictEqual(X.effectiveLevel(ex, ex.keeper), 3);
  X.setLab(ex, labWith({ cycle: 2 }));
  assert.strictEqual(X.effectiveLevel(ex, ex.keeper), 2); // 2 rounds/hour: 6 × 2 > 7, 1.5 × 2 <= 7
  X.setKeeper(ex, { level: 4, speed: 12 });
  assert.strictEqual(ex.level, 3); // 9 × 2 > 12 = 6 × 2
  X.setLab(ex, BASE);
  assert.strictEqual(ex.level, 4);
  // Up to 8 checks there is no extra work: the Axolotl's window 3 costs 3.
  assert.strictEqual(X.workPerRound(exhibit("axolotl", 4, BASE, 9), 4), 3);
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
  ex.healths = [50];
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
test("a keeper spread too thin attends only some rounds, and the animal pays for it", function () {
  var full = exhibit("axolotl", 1, BASE, 16, null, 1);   // 1 work/hour covers every round at 1 round/hour
  assert.strictEqual(full.attendance, 1);
  var third = exhibit("axolotl", 1, BASE, 16, null, 1 / 3);
  assert.ok(Math.abs(third.attendance - 1 / 3) < 1e-12);
  runTicks(third, 30);
  assert.strictEqual(third.decoded, 10, "decodes every third round");
  var sick = [0, 0];
  for (var seed = 1; seed <= 3; seed++) {
    sick[0] += runTicks(exhibit("axolotl", 1, BASE, 40 + seed, null, 1), 2000).sick;
    sick[1] += runTicks(exhibit("axolotl", 1, BASE, 40 + seed, null, 0.2), 2000).sick;
  }
  assert.ok(sick[1] > 1.3 * sick[0], "full attention " + sick[0] + " vs a fifth " + sick[1]);
});

console.log("Park");
// Parks for testing the mechanics know every species from the start.
function park(seed) { return Park.createPark({ rng: S.seededRng(seed || 1), known: Object.keys(Z.SPECIES) }); }
function quiet(P) { // silence all noise in a park's animals
  P.order.forEach(function (id) { var a = P.exhibits[id].animal; if (a) X.setLab(a, QUIET); });
}
function runDays(P, n) { var ev = []; for (var i = 0; i < n * Z.ECONOMY.ticksPerDay; i++) ev = ev.concat(Park.tick(P)); return ev; }
// Finish every construction now (through the real completion path).
function openAll(P) {
  P.order.forEach(function (id) { var r = P.exhibits[id]; if (r.building) r.buildUntil = P.tick + 1; });
  return Park.tick(P);
}
// Build a catalogue habitat and open it straight away.
function built(P, biome, x, y) { var r = Park.build(P, biome, x, y); assert.ok(r.ok, r.reason); openAll(P); return r.exhibit; }
test("starts with the seed money, a 12×8 lot and the seed round on the books", function () {
  var P = park();
  assert.strictEqual(P.cash, 10000000);
  assert.strictEqual(P.width * P.height, 96);
  assert.ok(P.grid.every(function (c) { return c === null; }));
  assert.strictEqual(Park.day(P), 1);
  assert.strictEqual(P.funding.round, 1);
  assert.strictEqual(P.funding.history[0].name, "Seed");
  assert.strictEqual(P.funding.stake, 0.75);
});
test("prices are AMO-lab scale: a surface code is about $2M all in, a tortoise far less", function () {
  var axo = Z.BIOMES.wetlands.cost + Z.SPECIES.axolotl.cost, tort = Z.BIOMES.riverbank.cost + Z.SPECIES.tortoise.cost;
  assert.ok(axo > 1.5e6 && axo < 2.5e6, "axolotl " + axo);
  assert.ok(tort < axo / 3, "tortoise " + tort);
  assert.strictEqual(Habitat.analyze(Habitat.designFor("axolotl"), { budget: 1 }).days, 365, "a new surface code takes a year");
});
test("construction: paid up front, no upkeep or animals until it opens", function () {
  var P = park();
  var r = Park.build(P, "wetlands", 1, 1);
  assert.ok(r.ok && r.exhibit.building);
  assert.strictEqual(P.cash, 10000000 - Z.BIOMES.wetlands.cost);
  assert.strictEqual(Park.exhibitAt(P, 3, 3).id, r.exhibit.id);
  assert.strictEqual(Park.rates(P).costs, 0, "no upkeep while building");
  var no = Park.buyAnimal(P, r.exhibit.id, "axolotl");
  assert.ok(!no.ok && /construction/.test(no.reason));
  var ev = runDays(P, Z.BIOMES.wetlands.buildDays);
  assert.ok(ev.some(function (e) { return e.type === "built" && e.exhibitId === r.exhibit.id; }));
  assert.ok(!r.exhibit.building && Park.day(P) === Z.BIOMES.wetlands.buildDays + 1);
  assert.strictEqual(Park.rates(P).costs, Z.BIOMES.wetlands.upkeep);
  assert.ok(Park.buyAnimal(P, r.exhibit.id, "axolotl").ok);
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
  assert.strictEqual(Park.exhibitLabel(P, b.exhibit), "Parity Riverbank #2");
});
test("only the native species can be bought into an enclosure", function () {
  var P = park();
  var rec = built(P, "forest", 0, 0);
  var opts = Park.speciesOptions(P, rec.id);
  assert.deepStrictEqual(opts.filter(function (o) { return o.ok; }).map(function (o) { return o.speciesId; }), ["owl"]);
  assert.ok(!Park.buyAnimal(P, rec.id, "axolotl").ok);
  var cash = P.cash;
  assert.ok(Park.buyAnimal(P, rec.id, "owl").ok);
  assert.strictEqual(P.cash, cash - Z.SPECIES.owl.cost);
  assert.ok(!Park.buyAnimal(P, rec.id, "owl").ok, "already occupied");
});
test("keepers and exhibits are many-to-many; a keeper's time is split by each exhibit's weight", function () {
  var P = park();
  var a = built(P, "riverbank", 0, 0), b = built(P, "wetlands", 2, 0);
  var k1 = Park.hireKeeper(P, a.id).keeper;
  assert.strictEqual(k1.level, 1);
  assert.ok(k1.name.length > 0);
  assert.deepStrictEqual(a.keeperIds, [k1.id]);
  Park.buyAnimal(P, a.id, "tortoise");
  assert.strictEqual(a.animal.level, 1, "a keeper hired before the animal is on duty when it arrives");
  assert.strictEqual(a.animal.keeper.speed, Park.keeperSpeed(k1), "one exhibit gets all their time");
  Park.buyAnimal(P, b.id, "axolotl");
  Park.assignKeeper(P, k1.id, b.id);
  assert.deepStrictEqual(k1.exhibitIds, [a.id, b.id]);
  var wa = Park.exhibitWeight(P, a), wb = Park.exhibitWeight(P, b), sp = Park.keeperSpeed(k1);
  assert.ok(wb > wa, "the surface code needs more looking after than the tortoise");
  assert.ok(Math.abs(a.animal.keeper.speed - sp * wa / (wa + wb)) < 1e-9);
  assert.ok(Math.abs(b.animal.keeper.speed - sp * wb / (wa + wb)) < 1e-9);
  var k2 = Park.hireKeeper(P, b.id).keeper; // two keepers pool their time at b
  assert.deepStrictEqual(b.keeperIds, [k1.id, k2.id]);
  var st = Park.staffing(P);
  assert.ok(Math.abs(st.loads[k2.id] - wb / 2) < 1e-9 && Math.abs(st.loads[k1.id] - (wa + wb / 2)) < 1e-9);
  assert.ok(b.animal.keeper.speed > a.animal.keeper.speed);
  Park.unassignKeeper(P, k1.id, a.id);
  assert.strictEqual(a.animal.level, 0, "nobody left at a");
  Park.assignKeeper(P, k2.id, null);
  assert.deepStrictEqual(k2.exhibitIds, []);
  Park.fireKeeper(P, k2.id);
  assert.ok(!P.keepers[k2.id] && P.keeperOrder.length === 1);
});
test("a keeper stretched across many exhibits lets more animals get sick", function () {
  function sickWith(spread) {
    var n = 0;
    for (var seed = 1; seed <= 2; seed++) {
      var P = park(60 + seed), recs = [];
      P.cash = 1e9; P.width = 20; setLotFree(P);
      for (var i = 0; i < 4; i++) recs.push(built(P, "wetlands", 3 * i, 0));
      recs.forEach(function (r) { Park.buyAnimal(P, r.id, "axolotl"); });
      if (spread) { var k = Park.hireKeeper(P, recs[0].id).keeper; recs.forEach(function (r) { Park.assignKeeper(P, k.id, r.id); }); }
      else recs.forEach(function (r) { Park.hireKeeper(P, r.id); });
      runDays(P, 20);
      recs.forEach(function (r) { n += r.animal.sick; });
    }
    return n;
  }
  var one = sickWith(false), spread = sickWith(true);
  assert.ok(spread > 1.3 * one, "one keeper each " + one + " vs one keeper for all four " + spread);
});
function setLotFree(P) { P.grid = new Array(P.width * P.height).fill(null); }
test("every keeper on the payroll is paid, assigned or not", function () {
  var P = park();
  Park.hireKeeper(P); Park.hireKeeper(P);
  assert.strictEqual(Park.rates(P).costs, 2 * Z.KEEPER_LEVELS[1].salary);
});
test("keepers gain experience (and speed) by decoding", function () {
  var P = park(2);
  var rec = built(P, "riverbank", 0, 0);
  Park.buyAnimal(P, rec.id, "tortoise");
  var k = Park.hireKeeper(P, rec.id).keeper;
  runDays(P, 2);
  assert.ok(Math.abs(k.xp - 2 * Z.ECONOMY.ticksPerDay * BASE.cycle) < 1e-9);
  assert.ok(Park.keeperSpeed(k) > Z.KEEPER_SPEED.base);
});
test("training: needs experience and the fee; the keeper studies on the job, then levels up", function () {
  var P = park(3);
  var rec = built(P, "riverbank", 0, 0);
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
  P.cash = 1e8;
  var rec = built(P, "wetlands", 0, 0);
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
  var rec = built(P, "riverbank", 0, 0);
  Park.buyAnimal(P, rec.id, "tortoise");
  Park.hireKeeper(P, rec.id);
  quiet(P); // no sickness: rates stay constant through a day
  while (Park.hour(P) !== 0) Park.tick(P);
  var r = Park.rates(P), cash0 = P.cash, dayEvents = [];
  for (var i = 0; i < Z.ECONOMY.ticksPerDay; i++) dayEvents = dayEvents.concat(Park.tick(P).filter(function (e) { return e.type === "day"; }));
  assert.strictEqual(dayEvents.length, 1);
  assert.ok(Math.abs(P.cash - cash0 - r.net) < 1e-6, "cash delta " + (P.cash - cash0) + " vs net " + r.net);
  assert.ok(Math.abs(dayEvents[0].revenue - r.revenue) < 1e-6);
  assert.ok(Math.abs(dayEvents[0].expenses - (Z.BIOMES.riverbank.upkeep + Z.KEEPER_LEVELS[1].salary)) < 1e-6);
  assert.strictEqual(P.history[P.history.length - 1].animals, 1);
});
test("sickness charges the vet bill and dents reputation", function () {
  var P = park(4);
  var rec = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, rec.id, "axolotl");
  quiet(P);
  // Plant an undetectable logical error mid-round, just before measurement.
  X.advancePhase(rec.animal);
  rec.animal.mem.E = rec.animal.code.logicalZ[0];
  var rep = P.reputation, cash = P.cash, r = Park.rates(P);
  var ev = Park.tick(P).filter(function (e) { return e.type === "sick"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].kind, "Z̄");
  assert.strictEqual(P.reputation, rep - Z.ECONOMY.sickReputationHit);
  assert.ok(Math.abs((cash - P.cash) - Z.ECONOMY.vetBill - (r.costs - r.revenue) / 24) < 1e-6);
});
test("demolish frees the cells, refunds part of the cost (even mid-construction), and keepers stay on staff", function () {
  var P = park();
  var rec = built(P, "dunes", 4, 4);
  var k = Park.hireKeeper(P, rec.id).keeper;
  var cash = P.cash;
  var r = Park.demolish(P, rec.id);
  assert.ok(r.ok);
  assert.strictEqual(P.cash, cash + Z.BIOMES.dunes.cost * Z.ECONOMY.demolishRefund);
  assert.ok(P.grid.every(function (c) { return c === null; }));
  assert.ok(Park.canBuild(P, "dunes", 4, 4).ok);
  assert.deepStrictEqual(k.exhibitIds, []);
  var b = Park.build(P, "dunes", 4, 4).exhibit;
  assert.ok(b.building && Park.demolish(P, b.id).ok);
});
test("a well-run starter zoo turns a profit over a month", function () {
  var P = park(5);
  var a = built(P, "riverbank", 0, 0);
  assert.ok(Park.buyAnimal(P, a.id, "tortoise").ok); Park.hireKeeper(P, a.id);
  var b = built(P, "wetlands", 2, 0);
  assert.ok(Park.buyAnimal(P, b.id, "axolotl").ok); Park.hireKeeper(P, b.id);
  var cash0 = P.cash;
  runDays(P, 30);
  assert.ok(P.cash > cash0, "cash went from " + cash0 + " to " + P.cash);
});

console.log("Staff wellbeing");
function keeperAt(P, recs) {
  var k = Park.hireKeeper(P, recs[0].id).keeper;
  recs.forEach(function (r) { Park.assignKeeper(P, k.id, r.id); });
  return k;
}
test("work tires keepers in proportion to load^1.5; the staff room rests them", function () {
  var P = park(70); P.cash = 1e9; P.width = 20; setLotFree(P);
  var one = built(P, "wetlands", 0, 0), many = [built(P, "wetlands", 3, 0), built(P, "wetlands", 6, 0), built(P, "wetlands", 9, 0)];
  [one].concat(many).forEach(function (r) { Park.buyAnimal(P, r.id, "axolotl"); });
  var k1 = keeperAt(P, [one]), k3 = keeperAt(P, many), idle = Park.hireKeeper(P).keeper;
  idle.fatigue = 20;
  quiet(P);
  runDays(P, 10);
  var c = Z.STAFF.keeper, w = Park.exhibitWeight(P, one);
  assert.ok(Math.abs(k1.fatigue - 10 * c.fatiguePerDay * Math.pow(w, c.loadExponent)) < 1e-9, "k1 " + k1.fatigue);
  assert.ok(Math.abs(k3.fatigue - 10 * c.fatiguePerDay * Math.pow(3 * w, c.loadExponent)) < 1e-9, "k3 " + k3.fatigue);
  assert.strictEqual(idle.fatigue, 0);
  assert.ok(k3.morale < k1.morale);
});
test("tired keepers book a holiday a few days ahead; while away, nobody decodes their exhibit", function () {
  var P = park(71);
  var rec = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, rec.id, "axolotl");
  var k = Park.hireKeeper(P, rec.id).keeper, v = Z.STAFF.keeper.vacation;
  quiet(P);
  k.fatigue = v.autoAt;
  var ev = runDays(P, 1).filter(function (e) { return e.type === "staff"; });
  assert.strictEqual(ev[0].kind, "planned");
  assert.strictEqual(ev[0].days, v.chunk);
  assert.strictEqual(rec.animal.level, 1, "still at work until the holiday starts");
  ev = runDays(P, v.notice).filter(function (e) { return e.type === "staff"; });
  assert.strictEqual(ev[ev.length - 1].kind, "vacation");
  assert.ok(!Park.keeperPresent(k) && rec.animal.level === 0, "away: the exhibit is unattended");
  assert.strictEqual(k.vacationLeft, v.allowance - v.chunk);
  ev = runDays(P, v.chunk).filter(function (e) { return e.type === "staff"; });
  assert.ok(ev.some(function (e) { return e.kind === "back"; }));
  assert.ok(Park.keeperPresent(k) && rec.animal.level === 1 && k.fatigue < v.autoAt);
});
test("holiday allowance: 21 days a year, sent off by hand in chunks, renewed each year", function () {
  var P = park(72);
  var k = Park.hireKeeper(P).keeper;
  assert.strictEqual(k.vacationLeft, 21);
  assert.ok(Park.sendOnVacation(P, k.id).ok && k.vacationLeft === 14);
  assert.ok(!Park.sendOnVacation(P, k.id).ok, "already away");
  runDays(P, 8);
  assert.ok(Park.sendOnVacation(P, k.id, 30).ok && k.vacationLeft === 0, "the rest of the allowance, no more");
  runDays(P, 15);
  assert.ok(!Park.sendOnVacation(P, k.id).ok, "none left");
  runDays(P, 365);
  assert.strictEqual(k.vacationLeft, 21);
});
test("an overloaded keeper falls sick, burns out and eventually quits; investors notice", function () {
  var P = park(73); P.cash = 1e9; P.width = 20; setLotFree(P);
  var recs = [0, 1, 2, 3, 4].map(function (i) { return built(P, "wetlands", 3 * i, 0); });
  recs.forEach(function (r) { Park.buyAnimal(P, r.id, "axolotl"); });
  var k = keeperAt(P, recs), kinds = {};
  quiet(P);
  var conf = P.confidence;
  runDays(P, 400).forEach(function (e) { if (e.type === "staff") kinds[e.kind] = true; });
  assert.ok(kinds.sick && kinds.burnout && kinds.quit, JSON.stringify(kinds));
  assert.ok(!P.keepers[k.id], "resigned");
  assert.ok(recs.every(function (r) { return r.keeperIds.length === 0; }));
});
test("a bonus lifts morale, costs 20 days' salary, and can't be repeated straight away", function () {
  var P = park(74);
  var k = Park.hireKeeper(P).keeper;
  k.morale = 40;
  var cash = P.cash, r = Park.giveBonus(P, k.id);
  assert.ok(r.ok && k.morale === 60 && P.cash === cash - 20 * Z.KEEPER_LEVELS[1].salary);
  assert.ok(!Park.canBonus(P, k.id).ok);
});

console.log("Investors, rounds and the IPO");
// A stocked starter park with fixed metrics for valuation tests.
function M(o) {
  var m = { revenue: 0, growth: 0, logicalQubits: 0, health: 100, techUnits: 0, bestDistance: 0, species: 1, labLevels: 0,
    headKeepers: 0, errorRate: 0, morale: 75, roadmapShare: 0 };
  Object.keys(o || {}).forEach(function (k) { m[k] = o[k]; });
  return m;
}
test("valuation grows with revenue, growth, animals × d², species, the roadmap and confidence", function () {
  var base = M({ revenue: 10000, techUnits: 9, species: 2 }), v0 = Investors.valuation(1, base, 50).value;
  [["revenue", 20000], ["growth", 0.5], ["techUnits", 18], ["species", 3], ["labLevels", 2]].forEach(function (c) {
    var m = M(base); m[c[0]] = c[1];
    assert.ok(Investors.valuation(1, m, 50).value > v0, c[0]);
  });
  assert.ok(Math.abs(Investors.valuation(1, base, 50 + Z.VALUATION.hypeDoubling).value / v0 - 2) < 1e-9, "hype doubles");
  var all = M({ revenue: 25000, techUnits: 9, species: 3, logicalQubits: 4, bestDistance: 3 });
  assert.strictEqual(Investors.roadmap(1, all).share, 1);
  assert.ok(Investors.valuation(1, all, 50).roadmapFactor === 1 && Investors.valuation(1, base, 50).roadmapFactor < 1);
  assert.ok(Investors.valuation(2, base, 50).value > v0, "later stages pay a premium");
});
test("tours happen, the investor's focus counts triple, and a logical error on the route hurts", function () {
  var good = M({ health: 100, errorRate: 0, morale: 90, roadmapShare: 1, growth: 0.5, species: 5, bestDistance: 3 });
  var a = Investors.impression({ focus: "errors", incidents: 0 }, good, { health: 100 });
  var b = Investors.impression({ focus: "errors", incidents: 1 }, good, { health: 100 });
  assert.ok(Math.abs(a.score - b.score - Z.TOURS.incidentPenalty) < 1e-9);
  var bad = M({ errorRate: 0.2 });
  assert.ok(Investors.impression({ focus: "errors" }, bad, null).score < Investors.impression({ focus: "team" }, bad, null).score);
  assert.ok(Investors.impression({ focus: "team", perk: "steak" }, bad, null).score > Investors.impression({ focus: "team" }, bad, null).score);
  var P = park(80);
  var rec = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, rec.id, "axolotl"); Park.hireKeeper(P, rec.id);
  var ev = runDays(P, 30);
  var start = ev.filter(function (e) { return e.type === "tour-start"; }), end = ev.filter(function (e) { return e.type === "tour"; });
  assert.ok(start.length >= 1 && end.length >= 1, "a tour within a month");
  assert.ok(end[0].quote && Z.FOCUS[end[0].focus] && end[0].route.indexOf(rec.id) >= 0);
});
test("wining and dining: one treat per tour, paid up front", function () {
  var P = park(81);
  var rec = built(P, "riverbank", 0, 0);
  Park.buyAnimal(P, rec.id, "tortoise");
  assert.ok(!Park.canPerk(P, "steak").ok, "nobody visiting");
  while (!P.tour) Park.tick(P);
  var cash = P.cash;
  assert.ok(Park.buyPerk(P, "steak").ok && P.cash === cash - Z.PERKS[0].cost);
  assert.ok(!Park.canPerk(P, "omakase").ok);
});
test("a raise: a roadshow, then the round closes at or above target; cash in, stake sold, bigger lot", function () {
  var P = park(82);
  var rec = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, rec.id, "axolotl"); Park.hireKeeper(P, rec.id);
  quiet(P);
  P.confidence = 100;
  P.history = []; for (var d = 0; d < 60; d++) P.history.push({ day: d, revenue: 200000, expenses: 0, vet: 0, sick: 0, animals: 1 });
  assert.ok(Park.startRaise(P).ok && !Park.canRaise(P).ok);
  var cash = P.cash, area = P.width * P.height;
  var ev = runDays(P, Z.FUNDING.roadshowDays + 1).filter(function (e) { return e.type === "round"; });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].outcome, "closed", "ratio " + ev[0].ratio);
  assert.ok(ev[0].quotes.length >= 1 && ev[0].raised > 0);
  assert.ok(P.cash > cash + ev[0].raised * 0.99);
  assert.strictEqual(P.funding.round, 2);
  assert.ok(Math.abs(P.funding.stake - 0.75 * (1 - Z.ROUNDS[1].raise)) < 1e-12);
  assert.ok(P.width * P.height > area, "the lot grew");
  assert.strictEqual(Park.exhibitAt(P, 1, 1).id, rec.id, "exhibits keep their place");
  assert.ok(!Park.canRaise(P).ok, "investors want to see the money at work first");
});
// Pin what investors will offer (Park calls Investors.valuation through the module).
function withValuation(fraction, fn) {
  var real = Investors.valuation;
  Investors.valuation = function (ri, m, c) { var v = real(ri, m, c); v.value = fraction * Z.ROUNDS[ri].target; return v; };
  try { fn(); } finally { Investors.valuation = real; }
}
test("short of the target: a bridge offer (accept for a little cash) or a pass and a cooldown", function () {
  var P = park(83);
  var rec = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, rec.id, "axolotl");
  var ev;
  withValuation(0.8, function () {
    Park.startRaise(P);
    ev = runDays(P, Z.FUNDING.roadshowDays + 1).filter(function (e) { return e.type === "round"; })[0];
  });
  assert.strictEqual(ev.outcome, "bridge", "ratio " + ev.ratio);
  assert.ok(!Park.canRaise(P).ok, "answer the offer first");
  var cash = P.cash, stake = P.funding.stake;
  assert.ok(Park.acceptOffer(P).ok);
  assert.ok(Math.abs(P.cash - cash - 0.8 * Z.ROUNDS[1].target * Z.FUNDING.bridgeRaise) < 1);
  assert.ok(Math.abs(P.funding.stake - stake * (1 - Z.FUNDING.bridgeRaise)) < 1e-12);
  assert.strictEqual(P.funding.round, 1, "a bridge doesn't advance the letter");
  assert.ok(!Park.canRaise(P).ok, "cooldown");
  P.funding.cooldownUntil = 0;
  withValuation(0.3, function () {
    Park.startRaise(P);
    ev = runDays(P, Z.FUNDING.roadshowDays + 1).filter(function (e) { return e.type === "round"; })[0];
  });
  assert.strictEqual(ev.outcome, "pass");
  assert.ok(Z.QUOTES.round.pass.indexOf(ev.quotes[0]) >= 0);
  assert.ok(!Park.canRaise(P).ok, "cooldown after a pass");
});
test("praise scales with the result: more (and louder) quotes the better the round", function () {
  var rng = S.seededRng(1);
  assert.strictEqual(Investors.roundTier(2.5), "legendary");
  assert.strictEqual(Investors.roundQuotes("legendary", false, rng).length, 3);
  assert.strictEqual(Investors.roundQuotes("good", false, rng).length, 1);
  assert.ok(Z.QUOTES.round.legendary.indexOf("This is a generational company. Possibly a generational zoo.") >= 0);
});
test("the IPO at $20B ends the game in triumph", function () {
  var P = park(84);
  P.funding.round = Z.ROUNDS.length - 1;
  assert.strictEqual(Park.currentRound(P).name, "IPO");
  assert.strictEqual(Park.currentRound(P).target, 20e9);
  var ev;
  withValuation(1.3, function () {
    Park.startRaise(P);
    ev = runDays(P, Z.FUNDING.roadshowDays + 1).filter(function (e) { return e.type === "round"; })[0];
  });
  assert.ok(ev.ipo && ev.outcome === "closed" && ev.tier === "good");
  assert.ok(ev.quotes.length >= 1);
  assert.strictEqual(P.status, "won");
  assert.deepStrictEqual(Park.tick(P), []);
  Park.continueAfterWin(P);
  var t = P.tick;
  Park.tick(P);
  assert.ok(P.tick === t + 1 && P.status === "won");
});
test("roadmap milestones are celebrated once, and raise confidence", function () {
  var P = park(85);
  var ev = runDays(P, 1).filter(function (e) { return e.type === "milestone"; });
  assert.ok(ev.some(function (e) { return /species/.test(e.label); }), "this test park knows every species");
  assert.strictEqual(runDays(P, 1).filter(function (e) { return e.type === "milestone"; }).length, 0);
});

console.log("Rules: losing, the books, save/load");
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
test("a monthly report arrives every 30 days with the month's books and a line from the board", function () {
  var P = park(25);
  var rec = built(P, "riverbank", 0, 0);
  Park.buyAnimal(P, rec.id, "tortoise");
  var ev = runDays(P, 61).filter(function (e) { return e.type === "month"; });
  assert.deepStrictEqual(ev.map(function (e) { return e.month; }), [1, 2]);
  var m = ev[1];
  assert.ok(m.revenue > 0 && m.expenses > 0 && typeof m.quote === "string");
  assert.ok(Math.abs(m.net - (m.revenue - m.expenses - m.vet)) < 1e-6);
  assert.strictEqual(m.vet, m.sick * Z.ECONOMY.vetBill);
  if (m.sick) assert.strictEqual(m.sickest.exhibitId, rec.id);
});
test("save/load round-trips the park and play continues identically", function () {
  var P = park(26);
  P.cash = 1e8;
  var a = built(P, "wetlands", 0, 0);
  Park.buyAnimal(P, a.id, "axolotl"); var k = Park.hireKeeper(P, a.id).keeper;
  Park.build(P, "riverbank", 5, 5);
  runDays(P, 5);
  Park.startResearch(P, "gates");
  k.xp = Z.TRAINING[2].xp; Park.trainKeeper(P, k.id);
  Park.sendOnVacation(P, Park.hireKeeper(P, a.id).keeper.id);
  Park.startRaise(P);
  runDays(P, 1);
  var json = Park.save(P);
  var Q = Park.load(json, { rng: S.seededRng(99) });
  P.rng = S.seededRng(99); P.exhibits[a.id].animal.rng = P.rng; P.exhibits[a.id].animal.mem.rng = P.rng;
  assert.deepStrictEqual(Q.lab, P.lab);
  assert.strictEqual(Q.keepers[k.id].name, k.name);
  assert.deepStrictEqual(Q.keepers[k.id].training, k.training);
  assert.strictEqual(Q.keepers[k.id].lastBonusDay, -Infinity);
  assert.strictEqual(Q.cash, P.cash);
  assert.strictEqual(Q.tick, P.tick);
  assert.strictEqual(Q.exhibits[a.id].animal.code, Z.SPECIES.axolotl.code);
  assert.deepStrictEqual(Q.grid, P.grid);
  assert.deepStrictEqual(Q.funding, P.funding);
  runDays(P, 30); runDays(Q, 30);
  assert.strictEqual(Q.cash, P.cash, "same RNG stream -> same future");
  assert.strictEqual(Q.confidence, P.confidence);
  assert.strictEqual(Q.exhibits[a.id].animal.sick, P.exhibits[a.id].animal.sick);
});
test("load rejects foreign, corrupted and pre-funding saves", function () {
  assert.throws(function () { Park.load('{"version":999}'); });
  var bad = JSON.parse(Park.save(park()));
  bad.exhibits = { 1: { biomeId: "volcano", keeperIds: [] } };
  assert.throws(function () { Park.load(bad); });
  assert.throws(function () { Park.load('{"version":3}'); }, /before the funding update/);
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

console.log("Habitat workshop (designs, identification, discovery)");
function P(str) { return S.fromString(str); }
// A design from Pauli strings, qubits along a row and checks below.
function designOf(checks) {
  var n = checks[0].length;
  return {
    qubits: checks[0].split("").map(function (_, q) { return [q, 0]; }),
    checks: checks.map(function (c, i) {
      var wires = [];
      c.split("").forEach(function (t, q) { if (t !== "I") wires.push([q, t]); });
      return { at: [i % n, 1 + Math.floor(i / n)], wires: wires };
    })
  };
}
// Relabel qubits, shuffle the checks and swap X/Y/Z on individual qubits.
var CYCLE = { X: "Z", Z: "Y", Y: "X" };
function scramble(design, rng) {
  var n = design.qubits.length, perm = [], i;
  for (i = 0; i < n; i++) perm.push(i);
  for (i = n - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  var turns = perm.map(function () { return Math.floor(rng() * 3); });
  function turn(t, k) { while (k--) t = CYCLE[t]; return t; }
  var qubits = []; for (i = 0; i < n; i++) qubits[perm[i]] = design.qubits[i];
  var checks = design.checks.map(function (c) {
    return { at: c.at, wires: c.wires.map(function (w) { return [perm[w[0]], turn(w[1], turns[w[0]])]; }) };
  });
  checks.sort(function () { return rng() - 0.5; });
  return { qubits: qubits, checks: checks };
}
function enumerator(gens) { // weight distribution of the whole stabilizer group
  var A = {};
  for (var m = 0; m < (1 << gens.length); m++) {
    var p = { n: gens[0].n, x: 0, z: 0 };
    for (var i = 0; i < gens.length; i++) if ((m >> i) & 1) p = S.multiply(p, gens[i]);
    var w = S.weight(p); A[w] = (A[w] || 0) + 1;
  }
  return JSON.stringify(A);
}
var EXPECTED_PARAMS = { tortoise: [3, 1, 1], owl: [9, 1, 3], peacock: [7, 1, 3], pangolin: [5, 1, 3], axolotl: [9, 1, 3],
  penguins: [4, 2, 2], giant: [25, 1, 5] };
Object.keys(Z.SPECIES).forEach(function (id) {
  test(Z.SPECIES[id].name + ": the reference design analyses to " + JSON.stringify(EXPECTED_PARAMS[id]) + " and is identified, however it's labelled", function () {
    var d = Habitat.designFor(id), a = Habitat.analyze(d);
    assert.ok(a.valid, a.problems.join("; "));
    assert.strictEqual(Habitat.malformed(d), null);
    assert.deepStrictEqual([a.n, a.k, a.d], EXPECTED_PARAMS[id]);
    assert.strictEqual(Habitat.identify(a.code, Habitat.textbook()).id, id);
    var rng = S.seededRng(id.length * 31);
    for (var t = 0; t < 4; t++) {
      var a2 = Habitat.analyze(scramble(d, rng), { budget: 1 });
      var hit = Habitat.identify(a2.code, Habitat.textbook());
      assert.ok(hit && hit.id === id, "scrambled #" + t + " identified as " + (hit && hit.id));
      // The equivalence really maps the built group onto the species' group.
      a2.code.stabilizers.forEach(function (g) {
        assert.ok(S.inGroup(Z.SPECIES[id].code.stabilizers, Habitat.mapPauli(g, hit.eq)));
      });
    }
  });
});
test("same [[n,k,d]] is not the same species: Shor's code and the d = 3 surface code differ", function () {
  var owl = Z.SPECIES.owl.code, ax = Z.SPECIES.axolotl.code;
  assert.notStrictEqual(enumerator(owl.stabilizers), enumerator(ax.stabilizers)); // so no relabelling can match them
  assert.strictEqual(Habitat.equivalence(owl, ax), null);
  // Swapping X and Z everywhere (a transversal Hadamard) is the same species.
  var dual = Habitat.analyze(designOf(Z.SPECIES.owl.code.stabilizers.map(function (g) { return S.toString({ n: 9, x: g.z, z: g.x }); })));
  assert.strictEqual(Habitat.identify(dual.code, Habitat.textbook()).id, "owl");
});
test("analysis explains what's wrong with a design", function () {
  var clash = Habitat.analyze(designOf(["ZZI", "IZZ", "XXI"]));
  assert.ok(!clash.valid && clash.clash && clash.clash.a === 1 && clash.clash.b === 2);
  assert.deepStrictEqual(clash.clash.qubits, [1]);
  assert.ok(/Checks B and C anticommute/.test(clash.problems[0]), clash.problems[0]);
  var full = Habitat.analyze(designOf(["ZI", "IZ"]));
  assert.ok(!full.valid && full.k === 0 && /k = 0/.test(full.problems[0]));
  var empty = Habitat.analyze({ qubits: [[0, 0]], checks: [{ at: [1, 1], wires: [] }] });
  assert.ok(/Check A has no wires/.test(empty.problems[0]));
  var idle = Habitat.analyze(designOf(["ZZII", "IZZI"]));
  assert.ok(idle.valid && idle.d === 1 && idle.idle.join() === "3" && /Qubit 3 isn't in any check/.test(idle.notes[0]));
  var red = Habitat.analyze(designOf(["ZZI", "IZZ", "ZIZ"]));
  assert.ok(red.valid && red.redundant === 1 && red.k === 1 && red.notes.some(function (t) { return /1 redundant check/.test(t); }));
  assert.ok(Habitat.malformed({ qubits: [[0, 0], [0, 0]], checks: [] }), "two qubits on one cell");
  assert.ok(Habitat.malformed({ qubits: [[0, 0]], checks: [{ at: [1, 0], wires: [[3, "X"]] }] }), "wire to a missing qubit");
});
test("price and footprint: every qubit costs the same and takes half a tile", function () {
  var a = Habitat.analyze(Habitat.designFor("axolotl"));
  assert.strictEqual(a.cost, 17 * Z.BUILD.perQubit + 24 * Z.BUILD.perWire);
  assert.deepStrictEqual(a.footprint, [3, 3]); // 17 qubits -> 9 tiles
  assert.deepStrictEqual(Habitat.footprint(49), [5, 5]);
  assert.deepStrictEqual(Habitat.footprint(5), [2, 2]);
  assert.strictEqual(Habitat.checkLabel(0) + Habitat.checkLabel(25) + Habitat.checkLabel(26), "AZAA");
});
test("Penguin placard: no [[3,1,2]] stabilizer code exists, and [[4,2,2]] meets the Singleton bound", function () {
  // Every pair of commuting, independent 3-qubit Paulis: none has distance 2.
  var all = []; for (var x = 0; x < 8; x++) for (var z = 0; z < 8; z++) if (x || z) all.push({ n: 3, x: x, z: z });
  var best = 0;
  for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
    if (!S.commutes(all[i], all[j]) || S.rank([all[i], all[j]]) < 2) continue;
    var a = S.analyzeChecks(3, [all[i], all[j]]);
    best = Math.max(best, a.d);
  }
  assert.strictEqual(best, 1);
  var c = Z.SPECIES.penguins.code, f = Placard.computedFacts(c);
  assert.strictEqual(f.n - f.k, 2 * (f.d - 1));
});

console.log("Many animals, discovery and the blueprint book");
test("k animals: each logical qubit gets sick on its own", function () {
  var ex = exhibit("penguins", 0, QUIET, 1);
  assert.strictEqual(ex.k, 2);
  ex.mem.E = P("XXII"); // X̄1 only
  var sick = X.runTick(ex);
  assert.deepStrictEqual(sick.map(function (s) { return s.animal + s.kind; }), ["0X̄1"]);
  assert.ok(ex.healths[0] < 100 && ex.healths[1] === 100 && ex.health === (ex.healths[0] + 100) / 2);
  ex.mem.E = P("IXXI"); // X̄1 X̄2: both animals
  assert.deepStrictEqual(X.runTick(ex).map(function (s) { return s.animal; }), [0, 1]);
  assert.strictEqual(ex.sick, 3);
});
test("a new park knows only the Tortoise; other catalogue habitats need a discovery first", function () {
  var P0 = Park.createPark({ rng: S.seededRng(1) });
  assert.ok(Park.isKnown(P0, "tortoise") && !Park.isKnown(P0, "owl"));
  assert.ok(Park.canBuild(P0, "riverbank", 0, 0).ok);
  var r = Park.canBuild(P0, "forest", 0, 0);
  assert.ok(!r.ok && /workshop/.test(r.reason));
});
test("building the Owl's design (any labelling) discovers it when it opens, and unlocks the Nine-Fold Forest", function () {
  var P0 = Park.createPark({ rng: S.seededRng(2) }), d = scramble(Habitat.designFor("owl"), S.seededRng(5));
  var cash = P0.cash, a = Habitat.analyze(d);
  var r = Park.buildDesign(P0, d, 0, 0);
  assert.ok(r.ok && r.speciesId === "owl" && r.discovers && !r.newSpecies);
  assert.strictEqual(P0.cash, cash - a.cost);
  assert.ok(!Park.isKnown(P0, "owl"), "not until the habitat works");
  var ev = runDays(P0, a.days).filter(function (e) { return e.type === "discovered"; });
  assert.deepStrictEqual(ev.map(function (e) { return e.speciesId; }), ["owl"]);
  assert.ok(Park.isKnown(P0, "owl") && Park.canBuild(P0, "forest", 5, 0).ok);
  assert.strictEqual(P0.book.designs.length, 1);
  assert.strictEqual(Park.exhibitLabel(P0, r.exhibit), "Shor Owl habitat #1");
  // The habitat holds the Owl, measuring the player's own checks.
  var opts = Park.speciesOptions(P0, r.exhibit.id).filter(function (o) { return o.ok; });
  assert.deepStrictEqual(opts.map(function (o) { return o.speciesId; }), ["owl"]);
  assert.ok(Park.buyAnimal(P0, r.exhibit.id, "owl").ok);
  assert.strictEqual(r.exhibit.animal.mem.checks.length, d.checks.length);
  // Building it again: same book entry, nothing new discovered.
  var r2 = Park.buildDesign(P0, d, 4, 4);
  assert.ok(r2.ok && !r2.discovers && P0.book.designs.length === 1 && r2.exhibit.number === 2);
});
test("an uncatalogued code becomes a new species (once), with a computed placard; k animals are stocked together", function () {
  var P0 = park(3);
  P0.cash = 1e8;
  var ice6 = designOf(["XXXXXX", "ZZZZZZ"]);
  var r = Park.buildDesign(P0, ice6, 0, 0, { name: "Six-pack Puffins" });
  assert.ok(r.ok && r.newSpecies && r.discovers);
  assert.ok(!Park.isKnown(P0, r.speciesId));
  var ev = openAll(P0).filter(function (e) { return e.type === "discovered"; });
  assert.ok(ev.length === 1 && ev[0].newSpecies && Park.isKnown(P0, r.speciesId));
  var sp = Park.speciesInfo(P0, r.speciesId);
  assert.strictEqual(sp.name, "Six-pack Puffins");
  assert.strictEqual(sp.params, "[[6,4,2]] (4 animals)");
  assert.strictEqual(sp.appeal, Habitat.customAppeal(2));
  assert.ok(Placard.html(sp).indexOf("4 animals") >= 0);
  var cash = P0.cash;
  assert.ok(Park.buyAnimal(P0, r.exhibit.id, r.speciesId).ok);
  assert.strictEqual(cash - P0.cash, sp.cost * 4);
  assert.strictEqual(r.exhibit.animal.k, 4);
  var v = Park.exhibitVisitors(P0, r.exhibit);
  assert.ok(Math.abs(v - Z.ECONOMY.visitorsPerAppeal * sp.appeal * 4 * (P0.reputation / 100 + 0.5)) < 1e-9);
  // The same code built another way round is the same species.
  var r2 = Park.buildDesign(P0, scramble(ice6, S.seededRng(9)), 4, 0);
  assert.ok(r2.ok && r2.speciesId === r.speciesId && !r2.newSpecies && !r2.discovers);
  assert.strictEqual(P0.book.designs.length, 2);
});
test("blueprints can be deleted; one still in use leaves the menu now and the book after the last demolition", function () {
  var P0 = park(4);
  var a = Park.buildDesign(P0, designOf(["XXXX", "ZZZZ"]), 0, 0).entry;
  var b = Park.buildDesign(P0, designOf(["ZZI", "IZZ"]), 3, 0);
  Park.demolish(P0, b.exhibit.id);
  assert.ok(Park.deleteDesign(P0, b.entry.id).ok);
  assert.ok(!Park.designEntry(P0, b.entry.id), "unused: gone");
  var r = Park.deleteDesign(P0, a.id);
  assert.ok(r.ok && r.retired && Park.designEntry(P0, a.id).retired, "in use: retired");
  Park.demolish(P0, P0.order[0]);
  assert.ok(!Park.designEntry(P0, a.id), "pruned with its last enclosure");
});
test("an uncatalogued species can be dropped from the field guide once nothing holds it", function () {
  var P0 = park(5);
  var r = Park.buildDesign(P0, designOf(["XXXXXX", "ZZZZZZ"]), 0, 0);
  openAll(P0);
  assert.ok(!Park.canForgetSpecies(P0, r.speciesId).ok, "its habitat still stands");
  assert.ok(!Park.canForgetSpecies(P0, "owl").ok, "catalogue species stay");
  Park.demolish(P0, r.exhibit.id);
  assert.ok(Park.forgetSpecies(P0, r.speciesId).ok);
  assert.ok(!P0.book.custom[r.speciesId] && !Park.isKnown(P0, r.speciesId) && P0.book.designs.length === 0);
});
test("broken designs can't be built", function () {
  var P0 = park(4);
  var r = Park.buildDesign(P0, designOf(["ZZI", "XII"]), 0, 0);
  assert.ok(!r.ok && /anticommute/.test(r.reason));
  assert.ok(!Park.buildDesign(P0, designOf(["ZI", "IZ"]), 0, 0).ok);
  assert.ok(!Park.buildDesign(P0, Habitat.designFor("giant"), 9, 0).ok, "5×5 doesn't fit at x = 9");
});
test("save/load keeps designed habitats and new species, and play continues identically", function () {
  var A = park(5);
  A.cash = 1e8;
  var r = Park.buildDesign(A, designOf(["XXXXXX", "ZZZZZZ"]), 0, 0);
  var o = Park.buildDesign(A, Habitat.designFor("pangolin"), 4, 0);
  openAll(A);
  Park.buyAnimal(A, r.exhibit.id, r.speciesId); Park.hireKeeper(A, r.exhibit.id);
  Park.buyAnimal(A, o.exhibit.id, "pangolin"); Park.hireKeeper(A, o.exhibit.id);
  runDays(A, 2);
  var B = Park.load(Park.save(A), { rng: S.seededRng(77) });
  A.rng = S.seededRng(77);
  [A, B].forEach(function (Q) { Q.order.forEach(function (id) { var an = Q.exhibits[id].animal; an.rng = an.mem.rng = Q.rng; }); });
  assert.strictEqual(Park.speciesInfo(B, r.speciesId).name, Park.speciesInfo(A, r.speciesId).name);
  runDays(A, 3); runDays(B, 3);
  assert.strictEqual(B.cash, A.cash);
  assert.deepStrictEqual(B.exhibits[r.exhibit.id].animal.healths, A.exhibits[r.exhibit.id].animal.healths);
});
test("below threshold a space-time keeper makes the Giant Axolotl (d = 5) beat the Axolotl (d = 3); a single-shot one doesn't", function () {
  function sick(sp, level) {
    var n = 0;
    for (var seed = 1; seed <= 3; seed++) n += runTicks(exhibit(sp, level, BASE, seed), 24 * 30).sick;
    return n;
  }
  var st = [sick("axolotl", 4), sick("giant", 4)], ss = [sick("axolotl", 1), sick("giant", 1)];
  assert.ok(st[1] * 2 < st[0], "space-time: d=3 " + st[0] + " vs d=5 " + st[1]);
  assert.ok(ss[1] > ss[0], "single-shot: d=3 " + ss[0] + " vs d=5 " + ss[1]);
});

console.log("Balance (seeded bot players, up to ten years)");
// A scripted player. Each day it builds what it can afford while keeping
// six months of costs in reserve (at most three projects at once), first
// discovering each species from its reference design (ZooData.DESIGNS),
// then using the catalogue habitat; later it discovers rectangular surface
// codes nobody has catalogued. It stocks what opens, staffs it (two keepers
// for bigger codes, so holidays are covered), replaces whoever quits, gives
// bonuses to unhappy keepers, trains them, funds the lab (at most one cycle
// upgrade), buys investors a steak, and raises once the valuation clears the
// next target by 10%.
function freeSpot(P, fp) {
  for (var y = 0; y + fp[1] <= P.height; y++) for (var x = 0; x + fp[0] <= P.width; x++) {
    var free = true;
    for (var dy = 0; dy < fp[1] && free; dy++) for (var dx = 0; dx < fp[0] && free; dx++) if (P.grid[(y + dy) * P.width + x + dx] !== null) free = false;
    if (free) return [x, y];
  }
  return null;
}
var HOME = {};
Object.keys(Z.BIOMES).forEach(function (b) { HOME[Z.BIOMES[b].native] = b; });
function rectSurface(R, C) { // rotated surface code on an R×C grid, as check strings
  var n = R * C, out = [];
  for (var i = 0; i <= R; i++) for (var j = 0; j <= C; j++) {
    var qs = [];
    [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]].forEach(function (rc) { if (rc[0] >= 0 && rc[0] < R && rc[1] >= 0 && rc[1] < C) qs.push(rc[0] * C + rc[1]); });
    var t = (i + j) % 2 === 0 ? "X" : "Z", top = i === 0 || i === R, side = j === 0 || j === C;
    if (qs.length === 4 || (qs.length === 2 && ((top && t === "X") || (side && t === "Z")))) {
      var str = ""; for (var q = 0; q < n; q++) str += qs.indexOf(q) >= 0 ? t : "I";
      out.push(str);
    }
  }
  return out;
}
var EXTRAS = [rectSurface(3, 4), rectSurface(3, 5), rectSurface(4, 4)].map(designOf);
function speciesOf(P, e) { return e.animal ? e.animal.speciesId : e.biomeId ? Z.BIOMES[e.biomeId].native : Park.designEntry(P, e.designId).speciesId; }
// opt: { keepers, care, train, research: false to skip }. Returns { result
// (IPO day, −day if bankrupt, Infinity), rounds: { name: day } }.
function bot(seed, opt) {
  opt = opt || {};
  var P = Park.createPark({ rng: S.seededRng(seed) }), prefs = ["giant", "axolotl", "pangolin", "peacock", "owl", "penguins", "tortoise"];
  var rounds = {};
  for (var d = 0; d < 3650; d++) {
    var reserve = Math.max(2e6, 180 * Park.rates(P).costs);
    var building = P.order.filter(function (id) { return P.exhibits[id].building; }).length;
    prefs.forEach(function (sp) {
      var mine = P.order.filter(function (id) { return speciesOf(P, P.exhibits[id]) === sp; }).length;
      if (mine >= 3 + P.lotLevel || building >= 3) return;
      var known = Park.isKnown(P, sp);
      if (!known && mine) return; // discovery under way
      var design = known ? null : Habitat.designFor(sp), a = design && Habitat.analyze(design, { budget: 1 });
      var cost = (known ? Z.BIOMES[HOME[sp]].cost : a.cost) + Park.stockCost(P, sp);
      var spot = P.cash >= cost + reserve && freeSpot(P, known ? Z.BIOMES[HOME[sp]].footprint : a.footprint);
      if (!spot) return;
      var res = known ? Park.build(P, HOME[sp], spot[0], spot[1]) : Park.buildDesign(P, design, spot[0], spot[1]);
      assert.ok(res.ok, res.reason);
      building++;
      if (opt.keepers !== false) {
        Park.hireKeeper(P, res.exhibit.id);
        if (opt.care !== false && Park.exhibitWeight(P, res.exhibit) >= 1) Park.hireKeeper(P, res.exhibit.id);
      }
    });
    if (opt.care !== false && P.funding.round >= 2) EXTRAS.forEach(function (ds) {
      var st = Park.studyDesign(P, ds), spot = !st.entry && P.cash >= st.analysis.cost * 3 + reserve && freeSpot(P, st.analysis.footprint);
      if (spot) { var res = Park.buildDesign(P, ds, spot[0], spot[1]); if (res.ok) Park.hireKeeper(P, res.exhibit.id); }
    });
    P.order.forEach(function (id) {
      var e = P.exhibits[id];
      if (!e.building && !e.animal) Park.buyAnimal(P, id, speciesOf(P, e));
      if (opt.keepers !== false && opt.care !== false && !e.building && !e.keeperIds.length) Park.hireKeeper(P, id);
    });
    P.keeperOrder.forEach(function (kid) {
      if (opt.care !== false && P.keepers[kid].morale < 45 && Park.canBonus(P, kid).ok && P.cash > reserve) Park.giveBonus(P, kid);
      var c = Park.canTrain(P, kid);
      if (opt.train !== false && c.ok && P.cash > c.course.fee + reserve) Park.trainKeeper(P, kid);
    });
    if (opt.research !== false && !P.lab.project) {
      var dials = ["readout", "coherence", "gates", "cycle"].filter(function (x) { return x !== "cycle" || P.lab.levels.cycle < 1; });
      var dial = dials.sort(function (a, b) { return P.lab.levels[a] - P.lab.levels[b]; })[0];
      var rr = Park.canResearch(P, dial);
      if (rr.ok && P.cash > rr.step.fee + reserve) Park.startResearch(P, dial);
    }
    if (Park.canRaise(P).ok && Park.valuation(P).value >= Park.currentRound(P).target * 1.1) Park.startRaise(P);
    for (var t = 0; t < Z.ECONOMY.ticksPerDay; t++) {
      if (opt.care !== false && P.tour && !P.tour.perk && P.cash > 3e6) Park.buyPerk(P, "steak");
      Park.tick(P).forEach(function (e) {
        if (e.type === "round" && e.outcome === "closed") rounds[e.name] = Park.day(P);
        if (e.type === "round" && e.outcome === "bridge") { if (P.cash < 2 * reserve) Park.acceptOffer(P); else Park.declineOffer(P); }
      });
    }
    if (P.status === "won") return { result: P.endDay, rounds: rounds };
    if (P.status === "lost") return { result: -P.endDay, rounds: rounds };
  }
  return { result: Infinity, rounds: rounds };
}
var GOOD = [1, 2, 3].map(function (s) { return bot(s); });
test("a well-run zoo raises its Series A within about a year and a half", function () {
  GOOD.forEach(function (g) { assert.ok(g.rounds["Series A"] > 120 && g.rounds["Series A"] < 550, JSON.stringify(g.rounds)); });
});
test("…and lists (IPO, $20B) after roughly five to eight years", function () {
  var days = GOOD.map(function (g) { return g.result; }).sort(function (a, b) { return a - b; });
  assert.ok(days[1] > 4 * 365 && days[1] < 8 * 365, "median IPO day " + days[1] + " of " + days.join(", "));
  GOOD.forEach(function (g) {
    var order = ["Series A", "Series B", "Series C", "Series D"].map(function (n) { return g.rounds[n]; });
    assert.ok(order.every(function (v, i) { return v && (!i || v > order[i - 1]); }), JSON.stringify(g.rounds));
  });
});
test("a zoo with no keepers goes bankrupt in its first year or so", function () {
  var r = bot(1, { keepers: false }).result;
  assert.ok(r < 0 && -r < 500, "result " + r);
});
test("a zoo that never trains, researches or looks after its staff doesn't list", function () {
  var r = bot(1, { train: false, research: false, care: false }).result;
  assert.ok(r < 0 || r === Infinity, "result " + r);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

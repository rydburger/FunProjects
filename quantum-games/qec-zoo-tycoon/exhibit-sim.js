// =========================================================
// Error Correction Zoo Tycoon — single-exhibit simulation.
//
// One code in one enclosure, measured round after round
// (../detectors.js), optionally tended by one keeper (a decoder). No UI,
// no money: the park (park.js) and the sandbox page both drive exhibits
// through this. Each logical qubit is one animal: a code with k logical
// qubits holds k animals, each with its own health.
//
// A round has three phases, advanced one at a time so the sandbox can
// narrate them:
//   noise   -> data qubits pick up Pauli errors (rates from the lab)
//   measure -> the checks are measured; each outcome may be misread
//   correct -> the keeper decodes and updates the Pauli frame; then the
//              vet checks whether the animal could still be saved
// Without a keeper nobody measures: errors just pile up.
//
// Keepers. A keeper has a level (an algorithm: KEEPER_LEVELS in
// zoo-data.js) and a speed (the share of their time this exhibit gets;
// the park splits a keeper's time between exhibits). Decoding costs work
// every round, so a keeper who can't keep up with an algorithm at this
// exhibit's cycle rate uses the best one they can run in real time
// (effectiveLevel). Below even the single-shot lookup's cost they attend
// only a fraction of the rounds (attendance): unattended rounds aren't
// measured or corrected, so errors pile up for longer. Space-time
// decoders look `window` rounds ahead, so they commit corrections for a
// round only once later rounds are in.
//
// The vet. When the keeper commits a round, the vet takes the true error
// as it was in that round times the Pauli frame, and asks whether a
// perfect-information minimum-weight decoder (weight ≤ 2) would still
// recover it. If not, every animal (logical qubit) the leftover flips is
// sick: a vet bill each, −30 health each, and the code is re-prepared
// from scratch. A leftover that is itself a stabilizer is harmless and is
// folded into the frame.
//
// Browser: load after ../stabilizer.js, ../detectors.js and zoo-data.js;
// exposes `window.ExhibitSim`. Node: require("./exhibit-sim.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var S = isNode ? require("../stabilizer.js") : root.Stabilizer;
  var D = isNode ? require("../detectors.js") : root.Detectors;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;

  var VET_WEIGHT = 2;
  // Health: a logical error costs SICK_HEALTH_HIT; every tick an animal
  // gets back RECOVERY_RATE of what it's missing plus RECOVERY_PER_TICK.
  // So health settles where recovery balances the error rate: ~97 at 0.2
  // logical errors a day, ~80 at 0.6, ~55 at 1.2.
  var SICK_HEALTH_HIT = 20;
  var RECOVERY_RATE = 0.02;
  var RECOVERY_PER_TICK = 0.1;
  function recover(h) { return Math.min(100, h + (100 - h) * RECOVERY_RATE + RECOVERY_PER_TICK); }

  var vetCache = new WeakMap();
  function vetFor(code) {
    if (!vetCache.has(code)) vetCache.set(code, S.buildLookupDecoder(code, VET_WEIGHT));
    return vetCache.get(code);
  }

  // ---------- noise ----------
  // lab: { coherence, gates, readout, cycle } current values. Returns the
  // phenomenological model for one round (see LAB in zoo-data.js).
  function labValues(levels) {
    var v = {};
    Object.keys(Z.LAB).forEach(function (k) { v[k] = Z.LAB[k].values[(levels && levels[k]) || 0]; });
    return v;
  }
  function noiseModel(code, checks, channel, lab) {
    var ch = S.channels[channel] ? channel : "depolarizing";
    var rates = [], q = [];
    for (var j = 0; j < code.n; j++) {
      var wired = 0;
      checks.forEach(function (c) { if (((c.x | c.z) >>> j) & 1) wired++; });
      rates.push(S.channels[ch](lab.coherence / lab.cycle + wired * lab.gates));
    }
    checks.forEach(function (c) { q.push(lab.readout + S.weight(c) * lab.gates); });
    return D.phenomenological(rates, q);
  }

  // ---------- keepers ----------
  // keeper: { level, speed } (the park's keeper record works).
  function workPerRound(ex, level) {
    var L = Z.KEEPER_LEVELS[level];
    return L.algorithm === "spacetime" ? L.work * Math.max(1, ex.mem.checks.length / 8) : L.work;
  }
  function roundsPerTick(ex) { return ex.lab.cycle; }
  // The best level this keeper can run here in real time (at least 1).
  function effectiveLevel(ex, keeper) {
    if (!keeper) return 0;
    for (var L = keeper.level; L > 1; L--) {
      if (canRun(ex, L) && workPerRound(ex, L) * roundsPerTick(ex) <= keeper.speed) return L;
    }
    return 1;
  }
  // Space-time decoding needs matching (CSS, every fault lighting ≤ 2
  // detectors) or a lookup table over checks × window ≤ 32 detectors.
  function spacetimeOK(ex, window) {
    var mem = ex.mem;
    if (mem.checks.length * window <= 32) return true;
    var css = mem.checks.every(function (c) { return c.x === 0 || c.z === 0; });
    return css && D.matchable(mem);
  }
  // Can this algorithm be run on this code at all (at any speed)?
  function canRun(ex, level) {
    var L = Z.KEEPER_LEVELS[level];
    if (L.algorithm !== "spacetime") return true;
    if (!ex.stOK) ex.stOK = {};
    if (!(L.window in ex.stOK)) ex.stOK[L.window] = spacetimeOK(ex, L.window);
    return ex.stOK[L.window];
  }
  function makeDecoder(ex, level) {
    var L = Z.KEEPER_LEVELS[level];
    return L.algorithm === "lookup"
      ? D.lookupDecoder(ex.mem, L.maxWeight)
      : D.spacetimeDecoder(ex.mem, { window: L.window });
  }
  // Fraction of rounds a keeper can attend (1 unless spread too thin for
  // even the cheapest decoder).
  function attendance(ex, keeper) {
    if (!keeper) return 0;
    return Math.min(1, keeper.speed / (workPerRound(ex, 1) * roundsPerTick(ex)));
  }
  // (Re)build the decoder if the effective level changed (or `force`).
  function refreshDecoder(ex, force) {
    ex.attendance = attendance(ex, ex.keeper);
    var lvl = effectiveLevel(ex, ex.keeper);
    if (!force && lvl === ex.level) return;
    ex.level = lvl;
    ex.dec = lvl ? makeDecoder(ex, lvl) : null;
    ex.Ehist = []; // rounds the old decoder had not committed are forgotten
  }

  // opts: { speciesId, code, checks, channel, lab: { coherence, gates,
  //   readout, cycle }, keeper: null | { level, speed }, rng }
  // code defaults to the species' code and checks (what is measured) to
  // the code's generators; a player-built habitat passes its own.
  function createExhibit(opts) {
    var code = opts.code || Z.SPECIES[opts.speciesId].code, rng = opts.rng || Math.random;
    var checks = opts.checks || code.stabilizers;
    var lab = opts.lab || labValues(null), k = code.logicalX.length, healths = [];
    for (var i = 0; i < k; i++) healths.push(100);
    var ex = {
      speciesId: opts.speciesId, code: code, k: k, channel: opts.channel || "depolarizing", lab: lab, rng: rng,
      mem: D.createMemory({ code: code, checks: checks, model: noiseModel(code, checks, opts.channel, lab), rng: rng }),
      keeper: null, level: 0, dec: null, Ehist: [], attendance: 0, credit: 0, attended: false,
      phase: "idle", roundInTick: 0, pending: null,
      ticks: 0, rounds: 0, decoded: 0, sick: 0, health: 100, healths: healths,
      lastNoise: null, lastRound: null, lastCorrection: null,
      // Most recent round in which anything happened, for inspectors that
      // can't follow every round: { tick, before, syndrome, flips, correction, sick }.
      incident: null
    };
    setKeeper(ex, opts.keeper || null);
    return ex;
  }
  function setKeeper(ex, keeper) {
    var old = ex.keeper;
    if (old && keeper && old.level === keeper.level && old.speed === keeper.speed) return;
    if (!old && !keeper && ex.dec === null && ex.level === 0) return;
    ex.keeper = keeper ? { level: keeper.level, speed: keeper.speed } : null;
    refreshDecoder(ex, false);
  }
  function setLab(ex, lab) {
    ex.lab = lab;
    ex.stOK = null;
    D.setModel(ex.mem, noiseModel(ex.code, ex.mem.checks, ex.channel, lab));
    ex.roundInTick = 0;
    refreshDecoder(ex, true); // weights come from the noise model
  }
  // Re-prepare the animal: fresh code state, fresh reference outcomes.
  function reprepare(ex) {
    D.resetMemory(ex.mem);
    ex.Ehist = [];
    if (ex.dec) ex.dec.reset();
  }

  // Residual error on the encoded state right now (E × frame).
  function residual(ex) { return D.residual(ex.mem); }

  // Advance one phase. Returns an event describing it:
  //   { phase: "noise", noise }
  //   { phase: "measure", syndrome, flips, detectors } (all null without a keeper)
  //   { phase: "correct", keeper, level, syndrome, flips, correction, shrug,
  //     before, committed, sick: null | { kind, cause, animals: [{ index, kind }] },
  //     leftover, clean, tickDone }
  // kind is "X̄", "Z̄" or "Ȳ" (with the animal's number when k > 1); the
  // event's kind is the first sick animal's.
  function advancePhase(ex) {
    var code = ex.code, mem = ex.mem;
    if (ex.phase === "idle" || ex.phase === "correct") {
      // Does the keeper make it to this round? (Deterministic: attendance
      // accumulates as credit.)
      ex.attended = false;
      if (ex.level > 0) {
        ex.credit += ex.attendance;
        if (ex.credit >= 1 - 1e-9) { ex.credit -= 1; ex.attended = true; }
      }
      ex.pending = D.sampleDataNoise(mem);
      ex.lastNoise = ex.pending;
      ex.lastRound = null; ex.lastCorrection = null;
      ex.phase = "noise";
      // Apply now so "what's really there" shows it; measuring adds nothing more.
      mem.E = S.multiply(mem.E, ex.pending);
      return { phase: "noise", noise: ex.pending };
    }
    var keeper = ex.attended;
    if (ex.phase === "noise") {
      ex.phase = "measure";
      if (!keeper) return { phase: "measure", syndrome: null, flips: null, detectors: null };
      ex.lastRound = D.measureRound(mem, { noNoise: true });
      return { phase: "measure", syndrome: ex.lastRound.outcomes, flips: ex.lastRound.flips, detectors: ex.lastRound.detectors };
    }

    ex.phase = "correct";
    var r = ex.lastRound;
    var ev = {
      phase: "correct", keeper: keeper, level: keeper ? ex.level : 0, syndrome: r ? r.outcomes : null, flips: r ? r.flips : null,
      correction: null, shrug: false, before: residual(ex), committed: false,
      sick: null, leftover: null, clean: false, tickDone: false
    };
    var judge = null; // the true error of the round being committed
    if (keeper) {
      var shrugs = ex.dec.shrugs || 0;
      var C = ex.dec.push(r);
      ev.shrug = (ex.dec.shrugs || 0) > shrugs;
      D.applyCorrection(mem, C);
      ex.lastCorrection = C;
      ev.correction = C;
      ex.decoded++;
      ex.Ehist.push(mem.E);
      var W = Z.KEEPER_LEVELS[ex.level].window;
      if (ex.Ehist.length >= W) { judge = ex.Ehist.shift(); ev.committed = true; }
    } else {
      judge = mem.E;
    }
    ex.rounds++;

    if (judge) {
      var R = S.multiply(judge, mem.frame), s = S.syndrome(code, R);
      var vetRes = S.multiply(R, vetFor(code).decode(s));
      if (S.isLogicalError(code, vetRes)) {
        var act = S.logicalAction(code, vetRes), animals = [];
        for (var j = 0; j < ex.k; j++) {
          if (!act.x[j] && !act.z[j]) continue;
          var sub = ex.k > 1 ? String(j + 1) : "";
          animals.push({ index: j, kind: (act.x[j] && act.z[j] ? "Ȳ" : act.x[j] ? "X̄" : "Z̄") + sub });
          ex.healths[j] = Math.max(0, ex.healths[j] - SICK_HEALTH_HIT);
        }
        ev.sick = {
          kind: animals[0].kind, animals: animals,
          cause: !keeper || s !== 0 ? "overwhelmed"
            : ex.lastCorrection && !S.isIdentity(ex.lastCorrection) ? "miscorrected" : "undetectable"
        };
        ex.sick += animals.length;
        ex.health = meanHealth(ex);
        reprepare(ex);
      } else if (!S.isIdentity(R) && S.inGroup(code.stabilizers, R)) {
        // A stabilizer acts trivially on the encoded state: fold it away.
        ev.leftover = R;
        D.applyCorrection(mem, R);
      } else {
        ev.clean = S.isIdentity(R);
      }
    }

    if (!S.isIdentity(ev.before) || ev.sick || (ev.flips && ev.flips !== 0)) {
      ex.incident = { tick: ex.ticks, before: ev.before, syndrome: ev.syndrome, flips: ev.flips, correction: ev.correction, sick: ev.sick };
    }

    ex.roundInTick++;
    if (ex.roundInTick >= roundsPerTick(ex)) {
      ex.roundInTick = 0;
      ex.ticks++;
      for (var a = 0; a < ex.k; a++) ex.healths[a] = recover(ex.healths[a]);
      ex.health = meanHealth(ex);
      ev.tickDone = true;
    }
    return ev;
  }

  function meanHealth(ex) { return ex.healths.reduce(function (a, b) { return a + b; }, 0) / ex.k; }

  // Run phases until the current tick completes (from wherever the
  // exhibit is mid-round). Returns one { kind, cause, animal } per animal
  // that got sick.
  function runTick(ex) {
    var sick = [], ev;
    do {
      ev = advancePhase(ex);
      if (ev.sick) ev.sick.animals.forEach(function (a) { sick.push({ kind: a.kind, cause: ev.sick.cause, animal: a.index }); });
    } while (!(ev.phase === "correct" && ev.tickDone));
    return sick;
  }

  // ---------- save / load ----------
  // Plain JSON-safe state. Decoders, the noise model and RNGs are rebuilt
  // on restore; rounds a space-time keeper had not yet committed are lost.
  function snapshot(ex) {
    return {
      speciesId: ex.speciesId, channel: ex.channel, E: ex.mem.E, frame: ex.mem.frame, last: ex.mem.last,
      round: ex.mem.round, ticks: ex.ticks, rounds: ex.rounds, decoded: ex.decoded, sick: ex.sick,
      health: ex.health, healths: ex.healths.slice(), roundInTick: ex.roundInTick, incident: ex.incident, credit: ex.credit
    };
  }
  // opts: { lab, keeper, rng, code, checks } (code and checks as for
  // createExhibit; a snapshot doesn't store them).
  function restore(snap, opts) {
    var ex = createExhibit({ speciesId: snap.speciesId, code: opts.code, checks: opts.checks, channel: snap.channel,
      lab: opts.lab, keeper: null, rng: opts.rng });
    ex.mem.E = snap.E; ex.mem.frame = snap.frame; ex.mem.last = snap.last; ex.mem.round = snap.round;
    ["ticks", "rounds", "decoded", "sick", "health", "roundInTick", "incident"].forEach(function (k) { ex[k] = snap[k]; });
    ex.credit = snap.credit || 0;
    ex.healths = Array.isArray(snap.healths) && snap.healths.length === ex.k ? snap.healths.slice()
      : ex.healths.map(function () { return snap.health; });
    setKeeper(ex, opts.keeper || null);
    return ex;
  }

  var ExhibitSim = {
    VET_WEIGHT: VET_WEIGHT, SICK_HEALTH_HIT: SICK_HEALTH_HIT, RECOVERY_PER_TICK: RECOVERY_PER_TICK, RECOVERY_RATE: RECOVERY_RATE, recover: recover,
    labValues: labValues, noiseModel: noiseModel, workPerRound: workPerRound, roundsPerTick: roundsPerTick,
    effectiveLevel: effectiveLevel, canRun: canRun, createExhibit: createExhibit, setKeeper: setKeeper, setLab: setLab,
    residual: residual, advancePhase: advancePhase, runTick: runTick, snapshot: snapshot, restore: restore
  };
  if (isNode) module.exports = ExhibitSim;
  else root.ExhibitSim = ExhibitSim;
})(typeof window !== "undefined" ? window : this);

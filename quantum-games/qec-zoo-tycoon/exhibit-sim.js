// =========================================================
// Error Correction Zoo Tycoon — single-exhibit simulation.
//
// One animal (code) in one enclosure, measured round after round
// (../detectors.js), optionally tended by one keeper (a decoder). No UI,
// no money: the park (park.js) and the sandbox page both drive exhibits
// through this.
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
// zoo-data.js) and a speed. Decoding costs work every round, so a keeper
// who can't keep up with an algorithm at this exhibit's cycle rate uses
// the best one they can run in real time (effectiveLevel). Space-time
// decoders look `window` rounds ahead, so they commit corrections for a
// round only once later rounds are in.
//
// The vet. When the keeper commits a round, the vet takes the true error
// as it was in that round times the Pauli frame, and asks whether a
// perfect-information minimum-weight decoder (weight ≤ 2) would still
// recover it. If not, the animal is sick: vet bill, −30 health, and it
// is re-prepared from scratch. A leftover that is itself a stabilizer is
// harmless and is folded into the frame.
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
  var SICK_HEALTH_HIT = 30;
  var RECOVERY_PER_TICK = 0.5;

  var vetCache = {};
  function vetFor(speciesId) {
    if (!vetCache[speciesId]) vetCache[speciesId] = S.buildLookupDecoder(Z.SPECIES[speciesId].code, VET_WEIGHT);
    return vetCache[speciesId];
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
    return L.algorithm === "spacetime" ? L.work * Math.max(1, ex.mem.checks.length / 4) : L.work;
  }
  function roundsPerTick(ex) { return ex.lab.cycle; }
  // The best level this keeper can run here in real time (at least 1).
  function effectiveLevel(ex, keeper) {
    if (!keeper) return 0;
    for (var L = keeper.level; L > 1; L--) {
      if (workPerRound(ex, L) * roundsPerTick(ex) <= keeper.speed) return L;
    }
    return 1;
  }
  function makeDecoder(ex, level) {
    var L = Z.KEEPER_LEVELS[level];
    return L.algorithm === "lookup"
      ? D.lookupDecoder(ex.mem, L.maxWeight)
      : D.spacetimeDecoder(ex.mem, { window: L.window });
  }
  // (Re)build the decoder if the effective level changed (or `force`).
  function refreshDecoder(ex, force) {
    var lvl = effectiveLevel(ex, ex.keeper);
    if (!force && lvl === ex.level) return;
    ex.level = lvl;
    ex.dec = lvl ? makeDecoder(ex, lvl) : null;
    ex.Ehist = []; // rounds the old decoder had not committed are forgotten
  }

  // opts: { speciesId, channel, lab: { coherence, gates, readout, cycle },
  //   keeper: null | { level, speed }, rng }
  function createExhibit(opts) {
    var code = Z.SPECIES[opts.speciesId].code, rng = opts.rng || Math.random;
    var lab = opts.lab || labValues(null);
    var ex = {
      speciesId: opts.speciesId, code: code, channel: opts.channel || "depolarizing", lab: lab, rng: rng,
      mem: D.createMemory({ code: code, model: noiseModel(code, code.stabilizers, opts.channel, lab), rng: rng }),
      keeper: null, level: 0, dec: null, Ehist: [],
      phase: "idle", roundInTick: 0, pending: null,
      ticks: 0, rounds: 0, decoded: 0, sick: 0, health: 100,
      lastNoise: null, lastRound: null, lastCorrection: null,
      // Most recent round in which anything happened, for inspectors that
      // can't follow every round: { tick, before, syndrome, flips, correction, sick }.
      incident: null
    };
    setKeeper(ex, opts.keeper || null);
    return ex;
  }
  function setKeeper(ex, keeper) {
    ex.keeper = keeper ? { level: keeper.level, speed: keeper.speed } : null;
    refreshDecoder(ex, false);
  }
  function setLab(ex, lab) {
    ex.lab = lab;
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
  //     before, committed, sick: null | { kind, cause }, leftover, clean, tickDone }
  function advancePhase(ex) {
    var code = ex.code, mem = ex.mem, keeper = ex.level > 0;
    if (ex.phase === "idle" || ex.phase === "correct") {
      ex.pending = D.sampleDataNoise(mem);
      ex.lastNoise = ex.pending;
      ex.lastRound = null; ex.lastCorrection = null;
      ex.phase = "noise";
      // Apply now so "what's really there" shows it; measuring adds nothing more.
      mem.E = S.multiply(mem.E, ex.pending);
      return { phase: "noise", noise: ex.pending };
    }
    if (ex.phase === "noise") {
      ex.phase = "measure";
      if (!keeper) return { phase: "measure", syndrome: null, flips: null, detectors: null };
      ex.lastRound = D.measureRound(mem, { noNoise: true });
      return { phase: "measure", syndrome: ex.lastRound.outcomes, flips: ex.lastRound.flips, detectors: ex.lastRound.detectors };
    }

    ex.phase = "correct";
    var r = ex.lastRound;
    var ev = {
      phase: "correct", keeper: keeper, level: ex.level, syndrome: r ? r.outcomes : null, flips: r ? r.flips : null,
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
      var vetRes = S.multiply(R, vetFor(ex.speciesId).decode(s));
      if (S.isLogicalError(code, vetRes)) {
        var act = S.logicalAction(code, vetRes);
        ev.sick = {
          kind: act.x[0] && act.z[0] ? "Ȳ" : act.x[0] ? "X̄" : "Z̄",
          cause: !keeper || s !== 0 ? "overwhelmed"
            : ex.lastCorrection && !S.isIdentity(ex.lastCorrection) ? "miscorrected" : "undetectable"
        };
        ex.sick++;
        ex.health = Math.max(0, ex.health - SICK_HEALTH_HIT);
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
      ex.health = Math.min(100, ex.health + RECOVERY_PER_TICK);
      ev.tickDone = true;
    }
    return ev;
  }

  // Run phases until the current tick completes (from wherever the
  // exhibit is mid-round). Returns the sick events that occurred.
  function runTick(ex) {
    var sick = [], ev;
    do {
      ev = advancePhase(ex);
      if (ev.sick) sick.push(ev.sick);
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
      health: ex.health, roundInTick: ex.roundInTick, incident: ex.incident
    };
  }
  // opts: { lab, keeper, rng }
  function restore(snap, opts) {
    var ex = createExhibit({ speciesId: snap.speciesId, channel: snap.channel, lab: opts.lab, keeper: null, rng: opts.rng });
    ex.mem.E = snap.E; ex.mem.frame = snap.frame; ex.mem.last = snap.last; ex.mem.round = snap.round;
    ["ticks", "rounds", "decoded", "sick", "health", "roundInTick", "incident"].forEach(function (k) { ex[k] = snap[k]; });
    setKeeper(ex, opts.keeper || null);
    return ex;
  }

  var ExhibitSim = {
    VET_WEIGHT: VET_WEIGHT, SICK_HEALTH_HIT: SICK_HEALTH_HIT, RECOVERY_PER_TICK: RECOVERY_PER_TICK,
    labValues: labValues, noiseModel: noiseModel, workPerRound: workPerRound, roundsPerTick: roundsPerTick,
    effectiveLevel: effectiveLevel, createExhibit: createExhibit, setKeeper: setKeeper, setLab: setLab,
    residual: residual, advancePhase: advancePhase, runTick: runTick, snapshot: snapshot, restore: restore
  };
  if (isNode) module.exports = ExhibitSim;
  else root.ExhibitSim = ExhibitSim;
})(typeof window !== "undefined" ? window : this);

// =========================================================
// Error Correction Zoo Tycoon — single-exhibit simulation.
//
// One animal (code) under one climate (Pauli noise), optionally
// tended by one keeper (lookup decoder). No UI, no money: the park
// (park.js) and the sandbox page both drive exhibits through this.
//
// A feeding round has three phases, advanced one at a time so the
// sandbox can narrate them:
//   noise   -> the climate multiplies a random Pauli into the error frame
//   measure -> the keeper (if any) reads the syndrome
//   correct -> the keeper applies a correction; then the vet checks
//              whether the animal could still be saved
// Each tick's noise is split evenly across the keeper's rounds per
// tick, so feeding more often genuinely means fewer errors between
// checks (see PLAN.md §3).
//
// Browser: load after ../stabilizer.js and zoo-data.js; exposes
// `window.ExhibitSim`. Node: require("./exhibit-sim.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var S = isNode ? require("../stabilizer.js") : root.Stabilizer;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;

  // The vet judges health with the best keeper's table (min-weight, up
  // to weight 2), whether or not a keeper is on duty.
  var VET_WEIGHT = 2;
  var SICK_HEALTH_HIT = 30;
  var RECOVERY_PER_TICK = 0.5;

  var decoderCache = {};
  function decoderFor(speciesId, maxWeight) {
    var key = speciesId + ":" + maxWeight;
    if (!decoderCache[key]) decoderCache[key] = S.buildLookupDecoder(Z.SPECIES[speciesId].code, maxWeight);
    return decoderCache[key];
  }

  // opts: { speciesId, keeperId (or null), climate: { channel, p }, rng }
  function createExhibit(opts) {
    var code = Z.SPECIES[opts.speciesId].code;
    return {
      speciesId: opts.speciesId,
      code: code,
      keeperId: opts.keeperId || null,
      climate: { channel: opts.climate.channel, p: opts.climate.p },
      rng: opts.rng || Math.random,
      E: S.identity(code.n),
      phase: "idle",
      roundInTick: 0,
      ticks: 0, rounds: 0, sick: 0, health: 100,
      lastNoise: null, lastSyndrome: null, lastCorrection: null,
      // Most recent round in which anything happened, for inspectors
      // that can't follow every round: { tick, before, syndrome, correction, sick }.
      incident: null
    };
  }

  function keeperOf(ex) { return ex.keeperId ? Z.KEEPERS[ex.keeperId] : null; }
  function roundsPerTick(ex) { var k = keeperOf(ex); return k ? k.roundsPerTick : 1; }
  function noiseRates(ex) {
    var pRound = ex.climate.p / roundsPerTick(ex), ch = ex.climate.channel;
    return ch === "biasedZ" ? S.channels.biasedZ(pRound, 10) : S.channels[ch](pRound);
  }
  function setKeeper(ex, keeperId) {
    ex.keeperId = keeperId || null;
    ex.roundInTick = 0;
  }

  // Advance one phase. Returns an event describing it:
  //   { phase: "noise", noise }
  //   { phase: "measure", syndrome (null if no keeper) }
  //   { phase: "correct", keeper, syndrome, correction, shrug, before,
  //     sick: null | { kind, cause, left }, leftover, clean, tickDone }
  function advancePhase(ex) {
    var code = ex.code, keeper = keeperOf(ex);
    if (ex.phase === "idle" || ex.phase === "correct") {
      var N = S.sampleNoise(code.n, noiseRates(ex), ex.rng);
      ex.E = S.multiply(ex.E, N);
      ex.lastNoise = N;
      ex.lastSyndrome = null; ex.lastCorrection = null;
      ex.phase = "noise";
      return { phase: "noise", noise: N };
    }
    if (ex.phase === "noise") {
      ex.phase = "measure";
      if (keeper) ex.lastSyndrome = S.syndrome(code, ex.E);
      return { phase: "measure", syndrome: keeper ? ex.lastSyndrome : null };
    }

    ex.phase = "correct";
    var ev = {
      phase: "correct", keeper: keeper, syndrome: ex.lastSyndrome, correction: null,
      shrug: false, before: ex.E, sick: null, leftover: null, clean: false, tickDone: false
    };
    if (keeper) {
      var dec = decoderFor(ex.speciesId, keeper.maxWeight), s = ex.lastSyndrome;
      if (s !== 0 && !dec.knows(s)) {
        ev.shrug = true;
        ex.lastCorrection = S.identity(code.n);
      } else {
        ex.lastCorrection = dec.decode(s);
        ex.E = S.multiply(ex.E, ex.lastCorrection);
      }
      ev.correction = ex.lastCorrection;
    }
    ex.rounds++;

    // The vet: could the best keeper still decode what's left without a
    // logical flip? If not, the encoded information is gone.
    var vet = decoderFor(ex.speciesId, VET_WEIGHT);
    var residual = S.multiply(ex.E, vet.decode(S.syndrome(code, ex.E)));
    if (S.isLogicalError(code, residual)) {
      var act = S.logicalAction(code, residual);
      ev.sick = {
        kind: act.x[0] && act.z[0] ? "Ȳ" : act.x[0] ? "X̄" : "Z̄",
        cause: keeper && ex.lastSyndrome === 0 ? "undetectable"
          : keeper && !S.isIdentity(ex.lastCorrection) ? "miscorrected" : "overwhelmed",
        left: ex.E
      };
      ex.sick++;
      ex.health = Math.max(0, ex.health - SICK_HEALTH_HIT);
      ex.E = S.identity(code.n);
    } else if (!S.isIdentity(ex.E) && S.inGroup(code.stabilizers, ex.E)) {
      // A stabilizer acts trivially on the encoded state: sweep it away.
      ev.leftover = ex.E;
      ex.E = S.identity(code.n);
    } else {
      ev.clean = S.isIdentity(ex.E);
    }

    if (!S.isIdentity(ev.before) || ev.sick) {
      ex.incident = { tick: ex.ticks, before: ev.before, syndrome: ev.syndrome, correction: ev.correction, sick: ev.sick };
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

  var ExhibitSim = {
    VET_WEIGHT: VET_WEIGHT, SICK_HEALTH_HIT: SICK_HEALTH_HIT, RECOVERY_PER_TICK: RECOVERY_PER_TICK,
    decoderFor: decoderFor, createExhibit: createExhibit, setKeeper: setKeeper,
    keeperOf: keeperOf, roundsPerTick: roundsPerTick, noiseRates: noiseRates,
    advancePhase: advancePhase, runTick: runTick
  };
  if (isNode) module.exports = ExhibitSim;
  else root.ExhibitSim = ExhibitSim;
})(typeof window !== "undefined" ? window : this);

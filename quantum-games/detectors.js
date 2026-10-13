// =========================================================
// Detectors: repeated, noisy syndrome measurement and the decoders
// that read it. Shared, game-agnostic; builds on stabilizer.js.
//
// The detector paradigm
//   The code starts projected into its code space (the first round of
//   measurements defines the reference, so every recorded outcome is
//   relative to it). Each round:
//     1. data noise multiplies a random Pauli into the true error E,
//     2. every check is measured; a faulty measurement reports the
//        wrong parity, without disturbing the data.
//   A *detector* is a check's outcome XOR the same check's previous
//   outcome. A data error that lands before round t lights the detectors
//   of the checks it anticommutes with in round t only (the outcome
//   stays flipped afterwards). A measurement error on check i in round t
//   lights detector i in rounds t and t+1. A decoder sees only the
//   detectors and outputs Pauli corrections, which go into a software
//   Pauli frame (as on real hardware): measurements see E, and the
//   encoded state is intact iff E·frame acts trivially on it.
//
// Noise models
//   - "phenomenological" (implemented): per-round single-qubit Pauli
//     noise on data qubits plus a flip probability q per measurement
//     (both may vary per qubit / per check).
//     The measurement circuit itself is not modelled.
//   - "circuit" (scaffold, not implemented): gate-by-gate noise on the
//     CNOTs between ancillas and data, where a fault on an ancilla part
//     way through spreads to the data qubits it has yet to touch ("hook"
//     errors) so the CNOT order matters. Hooks are in place:
//       * createMemory takes a `schedule` (CNOT order per check),
//       * a model supplies sampleRound(mem, opts) and dem(mem, L, opts),
//       * decoders only read the detector error model (DEM), so they
//         work unchanged once MODELS.circuit fills in those two functions.
//
// Detector error model (DEM) over a window of L rounds
//   Detector (round r, check i) has index r·m + i (m = number of checks).
//   A fault is { p, dets: [index], frame: Pauli it applies to the data,
//   round, kind: "data" | "meas" }.
//
// Decoders share one interface:
//   push(round) -> correction for the frame, after each noisy round;
//   flush(round) -> final correction, after a perfect (final) round;
//   reset().
//   - lookupDecoder: single-shot. Looks up the latest raw syndrome in a
//     minimum-weight table. Cheap; fooled by measurement errors.
//   - matchingDecoder: minimum-weight perfect matching on the detector
//     graph over a sliding window of W rounds, committing the oldest
//     round each time. Exact matching by dynamic programming over subsets
//     of lit detectors (they are few); greedy past maxDefects. Needs a
//     "matchable" code: every fault lights at most two detectors
//     (surface and repetition codes; not Steane or the five-qubit code).
//   - spacetimeLookupDecoder: for small codes that aren't matchable. A
//     table from every detector pattern of up to maxFaults faults in the
//     window to its most likely explanation. spacetimeDecoder picks
//     matching when it can and this table otherwise.
//
// Browser: load after stabilizer.js; exposes `window.Detectors`.
// Node: require("./detectors.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var S = isNode ? require("./stabilizer.js") : root.Stabilizer;

  // ---------- Noise models ----------
  // rates: per-round { pX, pY, pZ }, either one for every qubit or an
  // array with one per qubit. q: measurement flip probability, either one
  // number or an array with one per check.
  function cleanRates(r) { return { pX: r.pX || 0, pY: r.pY || 0, pZ: r.pZ || 0 }; }
  function phenomenological(rates, q) {
    return {
      kind: "phenomenological",
      rates: Array.isArray(rates) ? rates.map(cleanRates) : cleanRates(rates || {}),
      q: Array.isArray(q) ? q.slice() : (q || 0)
    };
  }
  // Per-qubit rates and per-check flip probabilities as arrays.
  function expandModel(model, n, m) {
    var rates = [], qs = [], i;
    for (i = 0; i < n; i++) rates.push(Array.isArray(model.rates) ? model.rates[i] : model.rates);
    for (i = 0; i < m; i++) qs.push(Array.isArray(model.q) ? model.q[i] : model.q);
    return { rates: rates, q: qs };
  }
  // Option B placeholder: the knobs a circuit-level model will take.
  function circuitLevel(opts) {
    opts = opts || {};
    return { kind: "circuit", pIdle: opts.pIdle || 0, p2: opts.p2 || 0, pMeas: opts.pMeas || 0, pReset: opts.pReset || 0 };
  }
  // CNOT order per check (option B). Default: ascending qubit index.
  function defaultSchedule(checks) {
    return checks.map(function (c) {
      var qs = [];
      for (var q = 0; q < c.n; q++) if (((c.x | c.z) >>> q) & 1) qs.push(q);
      return qs;
    });
  }

  // ---------- Syndromes over measured checks ----------
  function checkSyndrome(checks, E) {
    var s = 0;
    for (var i = 0; i < checks.length; i++) if (!S.commutes(E, checks[i])) s |= (1 << i);
    return s >>> 0;
  }

  // ---------- Phenomenological model ----------
  // One round of independent single-qubit data noise.
  function sampleDataNoise(mem) {
    var x = 0, z = 0, rates = mem.noise.rates;
    for (var j = 0; j < rates.length; j++) {
      var r = mem.rng(), pr = rates[j];
      if (r < pr.pX) x |= (1 << j);
      else if (r < pr.pX + pr.pY) { x |= (1 << j); z |= (1 << j); }
      else if (r < pr.pX + pr.pY + pr.pZ) z |= (1 << j);
    }
    return { n: mem.code.n, x: x >>> 0, z: z >>> 0 };
  }
  // opts: { perfect: no measurement errors this round, noNoise: skip data
  //   noise, inject: { E: extra data Pauli, flips: extra measurement-flip mask } }
  function phenoRound(mem, opts) {
    opts = opts || {};
    var n = mem.code.n, m = mem.checks.length, qs = mem.noise.q;
    var N = opts.noNoise ? S.identity(n) : sampleDataNoise(mem);
    if (opts.inject && opts.inject.E) N = S.multiply(N, opts.inject.E);
    mem.E = S.multiply(mem.E, N);
    var ideal = checkSyndrome(mem.checks, mem.E), flips = 0;
    if (!opts.perfect) {
      for (var i = 0; i < m; i++) if (qs[i] > 0 && mem.rng() < qs[i]) flips |= (1 << i);
    }
    if (opts.inject && opts.inject.flips) flips ^= opts.inject.flips;
    flips >>>= 0;
    var out = (ideal ^ flips) >>> 0, det = (out ^ mem.last) >>> 0;
    mem.last = out;
    var r = { round: mem.round, noise: N, ideal: ideal, flips: flips, outcomes: out, detectors: det };
    mem.round++;
    return r;
  }
  // DEM for a window of L rounds. opts: { openTop: the last round's
  // measurements may be faulty (more rounds follow), decompose: split
  // each Y into independent X and Z parts (for matching CSS codes) }.
  function phenoDEM(mem, L, opts) {
    var checks = mem.checks, m = checks.length, n = mem.code.n, qs = mem.noise.q;
    var faults = [], r, i;
    for (r = 0; r < L; r++) {
      for (var j = 0; j < n; j++) {
        var rt = mem.noise.rates[j];
        var parts = opts.decompose
          ? [["X", rt.pX + rt.pY], ["Z", rt.pZ + rt.pY]]
          : [["X", rt.pX], ["Y", rt.pY], ["Z", rt.pZ]];
        parts.forEach(function (pt) {
          if (!(pt[1] > 0)) return;
          var P = S.single(n, j, pt[0]), dets = [];
          for (var c = 0; c < m; c++) if (!S.commutes(P, checks[c])) dets.push(r * m + c);
          if (dets.length) faults.push({ p: pt[1], dets: dets, frame: P, round: r, kind: "data", qubit: j });
        });
      }
      if (opts.openTop || r < L - 1) {
        for (i = 0; i < m; i++) {
          if (!(qs[i] > 0)) continue;
          var d = [r * m + i];
          if (r + 1 < L) d.push((r + 1) * m + i);
          faults.push({ p: qs[i], dets: d, frame: S.identity(n), round: r, kind: "meas", check: i });
        }
      }
    }
    return { m: m, L: L, nDet: m * L, faults: faults };
  }

  var MODELS = {
    phenomenological: { sampleRound: phenoRound, dem: phenoDEM },
    circuit: { sampleRound: null, dem: null } // option B: see PLAN.md
  };
  function modelImpl(model) {
    var impl = MODELS[model.kind];
    if (!impl) throw new Error("Unknown noise model: " + model.kind);
    if (!impl.sampleRound) throw new Error("The " + model.kind + "-level noise model is not implemented yet (see PLAN.md).");
    return impl;
  }

  // ---------- Memory: one encoded block under repeated measurement ----------
  // opts: { code, checks (default code.stabilizers), model, rng, schedule }
  function createMemory(opts) {
    var checks = opts.checks || opts.code.stabilizers;
    if (checks.length > 32) throw new Error("At most 32 measured checks");
    var impl = modelImpl(opts.model);
    return {
      code: opts.code, checks: checks, model: opts.model, impl: impl,
      noise: expandModel(opts.model, opts.code.n, checks.length),
      schedule: opts.schedule || defaultSchedule(checks),
      rng: opts.rng || Math.random,
      E: S.identity(opts.code.n), frame: S.identity(opts.code.n), last: 0, round: 0
    };
  }
  function measureRound(mem, opts) { return mem.impl.sampleRound(mem, opts); }
  // Change the noise (e.g. after a lab upgrade). Decoders built for the
  // old model should be rebuilt: their weights came from it.
  function setModel(mem, model) {
    mem.impl = modelImpl(model);
    mem.model = model;
    mem.noise = expandModel(model, mem.code.n, mem.checks.length);
  }
  function applyCorrection(mem, C) { mem.frame = S.multiply(mem.frame, C); }
  function residual(mem) { return S.multiply(mem.E, mem.frame); }
  // Re-prepare the block from scratch (fresh reference outcomes).
  function resetMemory(mem) {
    mem.E = S.identity(mem.code.n); mem.frame = S.identity(mem.code.n); mem.last = 0;
  }

  // ---------- Decoders ----------
  function lookupDecoder(mem, maxWeight) {
    var checks = mem.checks, n = mem.code.n, table = new Map();
    table.set(0, S.identity(n));
    for (var w = 1; w <= maxWeight; w++) {
      S.forEachPauliOfWeight(n, w, function (E) {
        var s = checkSyndrome(checks, E);
        if (!table.has(s)) table.set(s, E);
      });
    }
    // Syndrome of the corrections already in the frame: outcomes are
    // compared against it, so a fixed error isn't fixed twice.
    var expected = checkSyndrome(checks, mem.frame);
    var dec = {
      name: "lookup", maxWeight: maxWeight, shrugs: 0,
      knows: function (s) { return table.has(s); },
      push: function (round) {
        var s = (round.outcomes ^ expected) >>> 0, C = table.get(s);
        if (!C) { dec.shrugs++; return S.identity(n); }
        expected = (expected ^ checkSyndrome(checks, C)) >>> 0;
        return C;
      },
      reset: function () { expected = checkSyndrome(checks, mem.frame); }
    };
    dec.flush = dec.push;
    return dec;
  }

  // Detector graph from a DEM whose faults each light at most two
  // detectors; node nDet is the boundary. Parallel faults keep the most
  // likely one. Precomputes all-pairs shortest paths (Floyd–Warshall)
  // with next hops for path recovery, and connected components of the
  // graph without the boundary (each is matched independently).
  function weightOf(p) { p = Math.min(p, 0.49); return Math.log((1 - p) / p); }
  function isMatchable(dem) {
    return dem.faults.every(function (f) { return f.dets.length <= 2; });
  }
  function buildGraph(dem) {
    var V = dem.nDet + 1, B = dem.nDet, dist = new Float64Array(V * V), next = new Int32Array(V * V);
    var edgeFault = new Int32Array(V * V).fill(-1), u, v, k;
    dist.fill(Infinity);
    for (u = 0; u < V; u++) { dist[u * V + u] = 0; next[u * V + u] = u; }
    var parent = []; for (u = 0; u < V; u++) parent.push(u);
    function find(a) { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; }
    dem.faults.forEach(function (f, idx) {
      if (f.dets.length > 2) throw new Error("Not matchable: a fault lights " + f.dets.length + " detectors");
      var a = f.dets[0], b = f.dets.length === 2 ? f.dets[1] : B, w = weightOf(f.p);
      if (w < dist[a * V + b]) {
        dist[a * V + b] = dist[b * V + a] = w;
        next[a * V + b] = b; next[b * V + a] = a;
        edgeFault[a * V + b] = edgeFault[b * V + a] = idx;
      }
      if (b !== B) parent[find(a)] = find(b);
    });
    for (k = 0; k < V; k++) for (u = 0; u < V; u++) {
      var duk = dist[u * V + k];
      if (duk === Infinity) continue;
      for (v = 0; v < V; v++) {
        var c = duk + dist[k * V + v];
        if (c < dist[u * V + v]) { dist[u * V + v] = c; next[u * V + v] = next[u * V + k]; }
      }
    }
    var comp = []; for (u = 0; u < B; u++) comp.push(find(u));
    return { V: V, B: B, dist: dist, next: next, edgeFault: edgeFault, comp: comp };
  }
  // Minimum-weight matching of defect nodes `ids` (each to another
  // defect or to the boundary). Exact DP over subsets up to maxDefects,
  // greedy (closest pair first) beyond. Returns [[a, b]] node pairs.
  function matchDefects(g, ids, maxDefects) {
    var V = g.V, B = g.B, m = ids.length, pairs = [];
    if (!m) return pairs;
    if (m > maxDefects) {
      var left = ids.slice();
      while (left.length) {
        var best = Infinity, bi = 0, bj = -1;
        for (var i = 0; i < left.length; i++) {
          var cb = g.dist[left[i] * V + B];
          if (cb < best) { best = cb; bi = i; bj = -1; }
          for (var j = i + 1; j < left.length; j++) {
            var c = g.dist[left[i] * V + left[j]];
            if (c < best) { best = c; bi = i; bj = j; }
          }
        }
        if (bj < 0) { pairs.push([left[bi], B]); left.splice(bi, 1); }
        else { pairs.push([left[bi], left[bj]]); left.splice(bj, 1); left.splice(bi, 1); }
      }
      return pairs;
    }
    var full = (1 << m) - 1, f = new Float64Array(full + 1), choice = new Int32Array(full + 1);
    for (var mask = 1; mask <= full; mask++) {
      var lo = 31 - Math.clz32(mask & -mask), rest = mask & ~(1 << lo);
      var bestC = g.dist[ids[lo] * V + B] + f[rest], ch = -1;
      for (var r = rest; r; r &= r - 1) {
        var jj = 31 - Math.clz32(r & -r);
        var cc = g.dist[ids[lo] * V + ids[jj]] + f[rest & ~(1 << jj)];
        if (cc < bestC) { bestC = cc; ch = jj; }
      }
      f[mask] = bestC; choice[mask] = ch;
    }
    for (mask = full; mask;) {
      var a = 31 - Math.clz32(mask & -mask), b = choice[mask];
      pairs.push([ids[a], b < 0 ? B : ids[b]]);
      mask &= ~(1 << a);
      if (b >= 0) mask &= ~(1 << b);
    }
    return pairs;
  }
  // Faults along the shortest paths of the matched pairs (a fault used
  // twice cancels). Returns fault indices.
  function pathFaults(g, pairs) {
    var V = g.V, used = {};
    pairs.forEach(function (pr) {
      var u = pr[0], v = pr[1];
      if (g.dist[u * V + v] === Infinity) return;
      while (u !== v) {
        var w = g.next[u * V + v], fi = g.edgeFault[u * V + w];
        used[fi] = !used[fi];
        u = w;
      }
    });
    return Object.keys(used).filter(function (k) { return used[k]; }).map(Number);
  }

  var graphCache = new WeakMap();
  // opts: { window (rounds, default 3), maxDefects (default 14) }
  function matchingDecoder(mem, opts) {
    opts = opts || {};
    var W = Math.max(1, opts.window || 3), maxDefects = opts.maxDefects || 14;
    var m = mem.checks.length, n = mem.code.n, hist = [];
    // Graphs depend only on the checks, the model and the window shape:
    // share them between decoders (e.g. keepers swapping exhibits).
    if (!graphCache.has(mem.checks)) graphCache.set(mem.checks, {});
    var cache = graphCache.get(mem.checks), modelKey = JSON.stringify(mem.model);
    function graphFor(L, openTop) {
      var key = modelKey + L + (openTop ? "o" : "c");
      if (!cache[key]) {
        var dem = mem.impl.dem(mem, L, { openTop: openTop, decompose: true });
        cache[key] = { dem: dem, g: buildGraph(dem) };
      }
      return cache[key];
    }
    // Probe once so an unmatchable code fails at hire time, not mid-run.
    if (!isMatchable(mem.impl.dem(mem, 2, { openTop: true, decompose: true }))) {
      throw new Error("Not matchable: some fault lights more than two detectors");
    }
    function solve(L, openTop) {
      var G = graphFor(L, openTop), byComp = {};
      for (var r = 0; r < L; r++) {
        for (var i = 0; i < m; i++) {
          if ((hist[r] >>> i) & 1) {
            var node = r * m + i, c = G.g.comp[node];
            (byComp[c] = byComp[c] || []).push(node);
          }
        }
      }
      var pairs = [];
      Object.keys(byComp).forEach(function (c) { pairs = pairs.concat(matchDefects(G.g, byComp[c], maxDefects)); });
      dec.lastDefects = pairs.length;
      return pathFaults(G.g, pairs).map(function (fi) { return G.dem.faults[fi]; });
    }
    var dec = {
      name: "matching", window: W, lastDefects: 0,
      push: function (round) {
        hist.push(round.detectors);
        if (hist.length < W) return S.identity(n);
        var C = S.identity(n);
        solve(W, true).forEach(function (f) {
          if (f.round !== 0) return;
          C = S.multiply(C, f.frame);
          // Its later detectors are explained now: clear them from history.
          f.dets.forEach(function (d) { if (d >= m) hist[(d / m) | 0] ^= (1 << (d % m)); });
        });
        hist.shift();
        return C;
      },
      flush: function (round) {
        hist.push(round.detectors);
        var C = S.identity(n);
        solve(hist.length, false).forEach(function (f) { C = S.multiply(C, f.frame); });
        hist = [];
        return C;
      },
      reset: function () { hist = []; }
    };
    return dec;
  }

  // Space-time lookup: for small codes that aren't matchable. Enumerates
  // every set of up to maxFaults faults in a window of W rounds (Y kept as
  // one fault, not split) and keeps, for each detector pattern, the most
  // likely set. Commits the oldest round like matchingDecoder. A pattern
  // outside the table is beyond the keeper: nothing is committed for it.
  var tableCache = new WeakMap();
  function spacetimeLookupDecoder(mem, opts) {
    opts = opts || {};
    var W = Math.max(1, opts.window || 2), maxFaults = opts.maxFaults || 3;
    var m = mem.checks.length, n = mem.code.n, hist = [];
    if (m * W > 32) throw new Error("Space-time lookup needs checks × window <= 32");
    if (!tableCache.has(mem.checks)) tableCache.set(mem.checks, {});
    var cache = tableCache.get(mem.checks), key = JSON.stringify(mem.model) + W + ":" + maxFaults;
    if (!cache[key]) {
      var dem = mem.impl.dem(mem, W, { openTop: true, decompose: false });
      var F = dem.faults.map(function (f) {
        var mask = 0;
        f.dets.forEach(function (d) { mask ^= (1 << d); });
        return { mask: mask >>> 0, w: weightOf(f.p), f: f };
      });
      var table = new Map();
      table.set(0, { w: 0, faults: [] });
      (function recurse(start, left, mask, w, chosen) {
        for (var i = start; i < F.length; i++) {
          var mk = (mask ^ F[i].mask) >>> 0, ww = w + F[i].w, ch = chosen.concat([i]);
          var cur = table.get(mk);
          if (!cur || ww < cur.w) table.set(mk, { w: ww, faults: ch });
          if (left > 1) recurse(i + 1, left - 1, mk, ww, ch);
        }
      })(0, maxFaults, 0, 0, []);
      cache[key] = { F: F, table: table };
    }
    var T = cache[key];
    var dec = {
      name: "spacetime-lookup", window: W, shrugs: 0,
      push: function (round) {
        hist.push(round.detectors);
        if (hist.length < W) return S.identity(n);
        var mask = 0;
        for (var r = 0; r < W; r++) mask = (mask | (hist[r] << (r * m))) >>> 0;
        var hit = T.table.get(mask >>> 0), C = S.identity(n);
        if (!hit) dec.shrugs++;
        else {
          hit.faults.forEach(function (i) {
            var f = T.F[i].f;
            if (f.round !== 0) return;
            C = S.multiply(C, f.frame);
            f.dets.forEach(function (d) { if (d >= m) hist[(d / m) | 0] ^= (1 << (d % m)); });
          });
        }
        hist.shift();
        return C;
      },
      reset: function () { hist = []; }
    };
    return dec;
  }
  // Best available space-time decoder: matching for CSS checks where every
  // fault lights at most two detectors, otherwise the space-time lookup
  // table. (Matching splits each Y into an X part and a Z part decoded
  // separately, which is only sound when X and Z checks are separate.)
  function spacetimeDecoder(mem, opts) {
    var css = mem.checks.every(function (c) { return c.x === 0 || c.z === 0; });
    var probe = mem.impl.dem(mem, 2, { openTop: true, decompose: true });
    return css && isMatchable(probe) ? matchingDecoder(mem, opts) : spacetimeLookupDecoder(mem, opts);
  }

  // ---------- Memory experiment ----------
  // Run `rounds` noisy rounds, then one perfect round, decoding as it goes.
  // opts: { code, checks, model, rng, rounds, decoder: function (mem) -> decoder }
  // Returns { failed, action, residual, syndrome } judged on E·frame.
  function runMemory(opts) {
    var mem = createMemory(opts), dec = opts.decoder(mem);
    for (var t = 0; t < opts.rounds; t++) applyCorrection(mem, dec.push(measureRound(mem)));
    applyCorrection(mem, dec.flush(measureRound(mem, { perfect: true })));
    var R = residual(mem), syn = checkSyndrome(mem.checks, R);
    var act = S.logicalAction(mem.code, R);
    return { failed: syn !== 0 || act.any, action: act, residual: R, syndrome: syn };
  }

  var Detectors = {
    phenomenological: phenomenological, circuitLevel: circuitLevel, defaultSchedule: defaultSchedule,
    MODELS: MODELS, checkSyndrome: checkSyndrome,
    createMemory: createMemory, measureRound: measureRound, applyCorrection: applyCorrection, setModel: setModel,
    sampleDataNoise: sampleDataNoise, spacetimeLookupDecoder: spacetimeLookupDecoder, spacetimeDecoder: spacetimeDecoder,
    residual: residual, resetMemory: resetMemory,
    phenoDEM: phenoDEM, isMatchable: isMatchable, buildGraph: buildGraph, matchDefects: matchDefects,
    lookupDecoder: lookupDecoder, matchingDecoder: matchingDecoder, runMemory: runMemory
  };
  if (isNode) module.exports = Detectors;
  else root.Detectors = Detectors;
})(typeof window !== "undefined" ? window : this);

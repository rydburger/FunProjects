// =========================================================
// nonlocal.js: the games of Kumar et al., "Quantum-classical separation
// in bounded-resource tasks arising from measurement contextuality"
// (Google Quantum AI, arXiv:2512.02284), as DOM-free logic.
//
//   NonLocal.SV        tiny in-place statevector (<= ~12 qubits) for ideal
//                      checks, the KSB sequential-measurement device and
//                      small GHZ games
//   NonLocal.Clifford  Clifford circuits in moments + a Pauli noise model
//                      (depolarizing gates, idles, readout flips), exact
//                      fault analysis by back-propagating the parity
//                      observables a game is scored on, and a sampler
//   NonLocal.Magic     Mermin-Peres magic square (Table I), Variations I/II
//   NonLocal.KSB       Kochen-Specker-Bell inequality on sequential contexts
//   NonLocal.GHZ       N-player GHZ parity game on a square-lattice chip
//   NonLocal.HLF       2D hidden linear function (Bravyi-Gosset-Koenig)
//
// Why exact fault analysis is enough: every circuit here is Clifford, every
// noise channel is Pauli, and every game is scored on parities of final
// Z-measurements. A Pauli fault flips a parity iff it anticommutes with
// that parity observable propagated back to the fault's location, so one
// backward sweep gives each fault's flip pattern, and independent faults
// combine by XOR-convolution. That is exact (no sampling) and costs
// O(circuit size), which is why 71- and 105-qubit sweeps run in a browser.
//
// Plain ES5, exposed on window.NonLocal and module.exports.
// =========================================================
(function (root) {
  "use strict";

  // ---------- seeded RNG ----------
  function rng(seed) {
    var a = (seed === undefined ? (Math.random() * 4294967296) : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function popcount(v) { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
  function shuffle(arr, r) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  // Binomial(n, p) draw: exact for small n, normal approximation for big n.
  function binomial(n, p, r) {
    if (n <= 2000) { var k = 0; for (var i = 0; i < n; i++) if (r() < p) k++; return k; }
    var mu = n * p, sd = Math.sqrt(n * p * (1 - p));
    var u1 = Math.max(r(), 1e-300), u2 = r();
    var g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(n, Math.round(mu + sd * g)));
  }

  // =========================================================
  // SV: small statevector. Qubit q is bit (1 << q) of the basis index.
  // =========================================================
  var SV = (function () {
    var R2 = Math.SQRT1_2;
    function make(n) { var d = 1 << n; var s = { n: n, re: new Float64Array(d), im: new Float64Array(d) }; s.re[0] = 1; return s; }
    function clone(s) { return { n: s.n, re: s.re.slice(), im: s.im.slice() }; }
    function h(s, q) {
      var m = 1 << q, d = s.re.length, re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if (!(i & m)) {
        var j = i | m, ar = re[i], ai = im[i], br = re[j], bi = im[j];
        re[i] = (ar + br) * R2; im[i] = (ai + bi) * R2; re[j] = (ar - br) * R2; im[j] = (ai - bi) * R2;
      }
    }
    function x(s, q) {
      var m = 1 << q, d = s.re.length, re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if (!(i & m)) { var j = i | m, t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    function z(s, q) { var m = 1 << q, d = s.re.length; for (var i = 0; i < d; i++) if (i & m) { s.re[i] = -s.re[i]; s.im[i] = -s.im[i]; } }
    // multiply |1> amplitudes on q by i (sign=+1, S) or -i (sign=-1, S-dagger)
    function phaseI(s, q, sign) {
      var m = 1 << q, d = s.re.length, re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if (i & m) { var r0 = re[i]; re[i] = -sign * im[i]; im[i] = sign * r0; }
    }
    // Y|0> = i|1>, Y|1> = -i|0>
    function y(s, q) {
      var m = 1 << q, d = s.re.length, re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if (!(i & m)) {
        var j = i | m, r0 = re[i], i0 = im[i], r1 = re[j], i1 = im[j];
        re[i] = i1; im[i] = -r1; re[j] = -i0; im[j] = r0;
      }
    }
    function cz(s, a, b) { var m = (1 << a) | (1 << b), d = s.re.length; for (var i = 0; i < d; i++) if ((i & m) === m) { s.re[i] = -s.re[i]; s.im[i] = -s.im[i]; } }
    function cx(s, c, t) {
      var mc = 1 << c, mt = 1 << t, d = s.re.length, re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if ((i & mc) && !(i & mt)) { var j = i | mt, tr = re[i]; re[i] = re[j]; re[j] = tr; tr = im[i]; im[i] = im[j]; im[j] = tr; }
    }
    // diag(1, e^{i theta}) on q: a Z rotation up to global phase (Cirq's Z**t has theta = pi t)
    function rz(s, q, theta) {
      var m = 1 << q, d = s.re.length, c = Math.cos(theta), sn = Math.sin(theta), re = s.re, im = s.im;
      for (var i = 0; i < d; i++) if (i & m) { var r0 = re[i]; re[i] = c * r0 - sn * im[i]; im[i] = sn * r0 + c * im[i]; }
    }
    function apply(s, g, q, theta) {
      switch (g) {
        case "RZ": return rz(s, q[0], theta);
        case "H": return h(s, q[0]);
        case "X": return x(s, q[0]);
        case "Y": return y(s, q[0]);
        case "Z": return z(s, q[0]);
        case "S": return phaseI(s, q[0], 1);
        case "SDG": return phaseI(s, q[0], -1);
        case "CZ": return cz(s, q[0], q[1]);
        case "CX": return cx(s, q[0], q[1]);
        case "I": return;
        default: throw new Error("SV: unknown gate " + g);
      }
    }
    function prob1(s, q) { var m = 1 << q, p = 0, d = s.re.length; for (var i = 0; i < d; i++) if (i & m) p += s.re[i] * s.re[i] + s.im[i] * s.im[i]; return p; }
    function collapse(s, q, bit) {
      var m = 1 << q, d = s.re.length, p = 0, i;
      for (i = 0; i < d; i++) if (((i & m) ? 1 : 0) === bit) p += s.re[i] * s.re[i] + s.im[i] * s.im[i];
      var k = 1 / Math.sqrt(p);
      for (i = 0; i < d; i++) { if (((i & m) ? 1 : 0) === bit) { s.re[i] *= k; s.im[i] *= k; } else { s.re[i] = 0; s.im[i] = 0; } }
    }
    function measure(s, q, r) { var bit = r() < prob1(s, q) ? 1 : 0; collapse(s, q, bit); return bit; }
    function reset(s, q, r) { if (measure(s, q, r)) x(s, q); }
    function probs(s) { var d = s.re.length, p = new Float64Array(d); for (var i = 0; i < d; i++) p[i] = s.re[i] * s.re[i] + s.im[i] * s.im[i]; return p; }
    // Run a Clifford.Circuit's gates (ignores noise) and return the state.
    function runCircuit(c) {
      var s = make(c.n);
      c.moments.forEach(function (mo) { mo.forEach(function (op) { apply(s, op.g, op.q); }); });
      return s;
    }
    // Probability that the Z-parity of `qubits` equals `parity` (0/1).
    function parityProb(s, qubits, parity) {
      var mask = 0; qubits.forEach(function (q) { mask |= 1 << q; });
      var p = probs(s), tot = 0;
      for (var i = 0; i < p.length; i++) if ((popcount(i & mask) & 1) === parity) tot += p[i];
      return tot;
    }
    return { make: make, clone: clone, apply: apply, measure: measure, reset: reset, prob1: prob1, probs: probs, runCircuit: runCircuit, parityProb: parityProb };
  })();

  // =========================================================
  // Clifford: circuits as moments, a noise model, exact fault analysis.
  // =========================================================
  var Clifford = (function () {
    // Error rates from the paper's supplement (Fig. S6 caption): single-qubit
    // Pauli error 5e-4, CZ 3e-3, symmetric readout 7e-3, T1 = 73 us.
    // Idling follows the paper's T1-with-dynamical-decoupling model (Sec. 5B,
    // Eqs. S19-S22): populations relax toward 1/2 and coherence decays at
    // half that rate, which is exactly a Pauli channel with X and Y errors of
    // equal probability and no Z. Over time t the flip probability is
    // (1 - e^{-t/T1})/2 ~ t/(2 T1). The moment length (40 ns) is our
    // assumption; the paper does not quote gate durations.
    var T1 = 73e-6, MOMENT = 40e-9;
    var PAPER_NOISE = { p1: 5e-4, p2: 3e-3, readout: 7e-3, idle: (1 - Math.exp(-MOMENT / T1)) / 2 };
    var NO_NOISE = { p1: 0, p2: 0, readout: 0, idle: 0 };

    function circuit(n) { return { n: n, moments: [], measured: null }; }
    function add(c, ops) { if (ops.length) c.moments.push(ops); return c; }
    function op(g) { return { g: g, q: Array.prototype.slice.call(arguments, 1) }; }
    // CNOT in the CZ-native gate set: H(t) CZ H(t), as on the hardware.
    function cxMoments(pairs) {
      var hs = pairs.map(function (p) { return op("H", p[1]); });
      return [hs, pairs.map(function (p) { return op("CZ", p[0], p[1]); }), hs.slice()];
    }
    // Merge two moment lists that act on disjoint qubits, side by side.
    function parallel(a, b) {
      var out = [], L = Math.max(a.length, b.length);
      for (var i = 0; i < L; i++) out.push((a[i] || []).concat(b[i] || []));
      return out;
    }
    function remap(moments, map) {
      return moments.map(function (mo) { return mo.map(function (o) { return { g: o.g, q: o.q.map(function (q) { return map[q]; }) }; }); });
    }

    // Flatten to an op list with noise ops inserted:
    //   DEP1 {q:[a], p}       uniform X/Y/Z with total prob p
    //   DEP2 {q:[a,b], p}     uniform over the 15 non-identity 2-qubit Paulis
    //   FLIP {q:[a], p}       readout bit flip (an X right before measuring)
    //   IDLE {q:[a], p}       X or Y, equally likely (T1 under dynamical decoupling)
    function withNoise(c, noise) {
      noise = noise || NO_NOISE;
      var ops = [], active = new Uint8Array(c.n);
      c.moments.forEach(function (mo) {
        var touched = new Uint8Array(c.n);
        mo.forEach(function (o) {
          ops.push(o);
          o.q.forEach(function (q) { touched[q] = 1; active[q] = 1; });
          var pauli = o.g === "X" || o.g === "Y" || o.g === "Z" || o.g === "I";
          if (o.q.length === 2 && noise.p2 > 0) ops.push({ g: "DEP2", q: o.q, p: noise.p2 });
          else if (o.q.length === 1 && !pauli && noise.p1 > 0) ops.push({ g: "DEP1", q: o.q, p: noise.p1 });
        });
        if (noise.idle > 0) for (var q = 0; q < c.n; q++) if (active[q] && !touched[q]) ops.push({ g: "IDLE", q: [q], p: noise.idle });
      });
      var meas = c.measured || range(c.n);
      if (noise.readout > 0) meas.forEach(function (q) { ops.push({ g: "FLIP", q: [q], p: noise.readout }); });
      return ops;
    }
    function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

    // Back-propagate k Z-parity observables (arrays of measured qubits)
    // through the noisy op list. Returns the fault table: one entry per
    // noise op that can flip anything, {p, outs: [{w, pat}]} with pat a
    // Uint32Array(W) bitmask over the k observables and w the conditional
    // weight of that Pauli (sums to <= 1; the rest is harmless).
    function faultTable(ops, n, observables) {
      var k = observables.length, W = Math.max(1, Math.ceil(k / 32));
      var mx = new Uint32Array(n * W), mz = new Uint32Array(n * W);
      observables.forEach(function (qs, i) { qs.forEach(function (q) { mz[q * W + (i >> 5)] ^= (1 << (i & 31)) >>> 0; }); });
      var table = [], w, t;
      function xorInto(dst, d0, src, s0) { for (var u = 0; u < W; u++) dst[d0 + u] ^= src[s0 + u]; }
      function patFor(q, ex, ez, out) { for (var u = 0; u < W; u++) out[u] ^= (ex ? mz[q * W + u] : 0) ^ (ez ? mx[q * W + u] : 0); }
      function nonzero(p) { for (var u = 0; u < W; u++) if (p[u]) return true; return false; }
      var PAULI1 = [[1, 0], [1, 1], [0, 1]];
      for (var i = ops.length - 1; i >= 0; i--) {
        var o = ops[i], a = o.q[0], b = o.q[1];
        switch (o.g) {
          case "H":
            for (w = 0; w < W; w++) { t = mx[a * W + w]; mx[a * W + w] = mz[a * W + w]; mz[a * W + w] = t; }
            break;
          case "S": case "SDG":
            xorInto(mz, a * W, mx, a * W); break;
          case "CZ":
            xorInto(mz, b * W, mx, a * W); xorInto(mz, a * W, mx, b * W); break;
          case "CX":
            xorInto(mx, b * W, mx, a * W); xorInto(mz, a * W, mz, b * W); break;
          case "X": case "Y": case "Z": case "I": break;
          case "FLIP": {
            var pf = new Uint32Array(W); patFor(a, 1, 0, pf);
            if (nonzero(pf)) table.push({ p: o.p, outs: [{ w: 1, pat: pf }] });
            break;
          }
          case "IDLE": {
            var oi = [];
            [[1, 0], [1, 1]].forEach(function (e) { var p = new Uint32Array(W); patFor(a, e[0], e[1], p); if (nonzero(p)) oi.push({ w: 1 / 2, pat: p }); });
            if (oi.length) table.push({ p: o.p, outs: oi });
            break;
          }
          case "DEP1": {
            var outs = [];
            PAULI1.forEach(function (e) { var p = new Uint32Array(W); patFor(a, e[0], e[1], p); if (nonzero(p)) outs.push({ w: 1 / 3, pat: p }); });
            if (outs.length) table.push({ p: o.p, outs: outs });
            break;
          }
          case "DEP2": {
            var outs2 = [];
            for (var ea = 0; ea < 4; ea++) for (var eb = 0; eb < 4; eb++) {
              if (!ea && !eb) continue;
              var p2 = new Uint32Array(W);
              if (ea) patFor(a, PAULI1[ea - 1][0], PAULI1[ea - 1][1], p2);
              if (eb) patFor(b, PAULI1[eb - 1][0], PAULI1[eb - 1][1], p2);
              if (nonzero(p2)) outs2.push({ w: 1 / 15, pat: p2 });
            }
            if (outs2.length) table.push({ p: o.p, outs: outs2 });
            break;
          }
          default: throw new Error("faultTable: op " + o.g + " is not a terminal-measurement Clifford op");
        }
      }
      return { k: k, W: W, faults: table };
    }

    // Exact distribution over the 2^k flip patterns (k <= ~16).
    function exactDistribution(ft) {
      var size = 1 << ft.k, d = new Float64Array(size); d[0] = 1;
      ft.faults.forEach(function (f) {
        var nd = new Float64Array(size), stay = 1;
        f.outs.forEach(function (o) { stay -= f.p * o.w; });
        for (var s = 0; s < size; s++) nd[s] += stay * d[s];
        f.outs.forEach(function (o) {
          var pat = o.pat[0], pw = f.p * o.w;
          for (var s2 = 0; s2 < size; s2++) nd[s2 ^ pat] += pw * d[s2];
        });
        d = nd;
      });
      return d;
    }
    // Exact probability that a single observable (k=1) is NOT flipped:
    // independent faults, so P(even # of flips) = (1 + prod(1 - 2 q_f)) / 2.
    function noFlipProb1(ft) {
      var prod = 1;
      ft.faults.forEach(function (f) { var q = 0; f.outs.forEach(function (o) { q += f.p * o.w; }); prod *= 1 - 2 * q; });
      return (1 + prod) / 2;
    }

    // Monte Carlo: fraction of shots whose flip pattern is all-zero.
    // Faults are grouped by rate and visited by geometric skipping, so a
    // shot costs O(#faults that fire), not O(#locations).
    function sampler(ft) {
      var groups = {};
      ft.faults.forEach(function (f) { (groups[f.p] = groups[f.p] || []).push(f); });
      var gl = Object.keys(groups).map(function (p) { return { p: +p, lf: Math.log(1 - +p), list: groups[p] }; });
      var W = ft.W, acc = new Uint32Array(W);
      function shot(r) {
        for (var u = 0; u < W; u++) acc[u] = 0;
        for (var g = 0; g < gl.length; g++) {
          var G = gl[g], L = G.list.length, idx = -1;
          if (G.p <= 0) continue;
          for (;;) {
            idx += 1 + Math.floor(Math.log(1 - r()) / G.lf);
            if (idx >= L) break;
            var f = G.list[idx], x = r(), c = 0;
            for (var j = 0; j < f.outs.length; j++) { c += f.outs[j].w; if (x < c) { var pt = f.outs[j].pat; for (var v = 0; v < W; v++) acc[v] ^= pt[v]; break; } }
          }
        }
        return acc;
      }
      return {
        shot: shot,
        okFraction: function (shots, r) {
          var ok = 0;
          for (var s = 0; s < shots; s++) { var a = shot(r), z = true; for (var u = 0; u < W; u++) if (a[u]) { z = false; break; } if (z) ok++; }
          return ok / shots;
        }
      };
    }

    // Forward Pauli-frame sampler: an independent implementation used by
    // the tests to cross-check faultTable. Returns flip-pattern counts.
    function frameSample(ops, n, observables, shots, r) {
      var counts = {}, fx = new Uint8Array(n), fz = new Uint8Array(n);
      var P1 = [[1, 0], [1, 1], [0, 1]];
      for (var s = 0; s < shots; s++) {
        fx.fill(0); fz.fill(0);
        for (var i = 0; i < ops.length; i++) {
          var o = ops[i], a = o.q[0], b = o.q[1], t;
          switch (o.g) {
            case "H": t = fx[a]; fx[a] = fz[a]; fz[a] = t; break;
            case "S": case "SDG": fz[a] ^= fx[a]; break;
            case "CZ": fz[a] ^= fx[b]; fz[b] ^= fx[a]; break;
            case "CX": fx[b] ^= fx[a]; fz[a] ^= fz[b]; break;
            case "FLIP": if (r() < o.p) fx[a] ^= 1; break;
            case "DEP1": if (r() < o.p) { var e = P1[Math.floor(r() * 3)]; fx[a] ^= e[0]; fz[a] ^= e[1]; } break;
            case "IDLE": if (r() < o.p) { fx[a] ^= 1; if (r() < 0.5) fz[a] ^= 1; } break;
            case "DEP2": if (r() < o.p) { var m = 1 + Math.floor(r() * 15), ea = m >> 2, eb = m & 3; if (ea) { fx[a] ^= P1[ea - 1][0]; fz[a] ^= P1[ea - 1][1]; } if (eb) { fx[b] ^= P1[eb - 1][0]; fz[b] ^= P1[eb - 1][1]; } } break;
          }
        }
        var pat = 0;
        observables.forEach(function (qs, j) { var par = 0; qs.forEach(function (q) { par ^= fx[q]; }); if (par) pat |= 1 << j; });
        counts[pat] = (counts[pat] || 0) + 1;
      }
      return counts;
    }

    function depth2q(c) { return c.moments.filter(function (mo) { return mo.some(function (o) { return o.q.length === 2; }); }).length; }

    return {
      PAPER_NOISE: PAPER_NOISE, NO_NOISE: NO_NOISE,
      circuit: circuit, add: add, op: op, cxMoments: cxMoments, parallel: parallel, remap: remap,
      withNoise: withNoise, faultTable: faultTable, exactDistribution: exactDistribution,
      noFlipProb1: noFlipProb1, sampler: sampler, frameSample: frameSample, depth2q: depth2q, T1: T1, MOMENT: MOMENT
    };
  })();
  var op = Clifford.op;

  // =========================================================
  // Pauli strings (for the magic square / KSB observables)
  // =========================================================
  function anticommutes(p, q) {
    var c = 0;
    for (var i = 0; i < p.length; i++) if (p[i] !== "I" && q[i] !== "I" && p[i] !== q[i]) c++;
    return (c & 1) === 1;
  }

  // =========================================================
  // Magic square (Table I of the paper). Entry = [Pauli on (q1,q2), sign].
  // Rows multiply to +I, columns to -I.
  // =========================================================
  var Magic = (function () {
    var TABLE = [
      [["IZ", 1], ["ZI", 1], ["ZZ", 1]],
      [["XI", 1], ["IX", 1], ["XX", 1]],
      [["XZ", -1], ["ZX", -1], ["YY", 1]]
    ];
    function label(e) { return (e[1] < 0 ? "−" : "") + e[0]; }
    // Variation I: each player's circuit on local wires 0,1, then measure
    // both in Z. Bits m0, m1 give two entries; the product rule gives the
    // third. sub[line][entry] = {bits: local wires whose parity is read,
    // sign}: entry value = sign * (-1)^(parity of those bits).
    var ROW_CIRCUIT = [[], [[op("H", 0), op("H", 1)]], [[op("CZ", 0, 1)], [op("H", 0), op("H", 1)]]];
    var COL_CIRCUIT = [[[op("H", 0)]], [[op("H", 1)]], Clifford.cxMoments([[0, 1]]).concat([[op("H", 0)]])];
    var ROW_SUB = [
      [{ bits: [1], sign: 1 }, { bits: [0], sign: 1 }, { bits: [0, 1], sign: 1 }],
      [{ bits: [0], sign: 1 }, { bits: [1], sign: 1 }, { bits: [0, 1], sign: 1 }],
      [{ bits: [0], sign: -1 }, { bits: [1], sign: -1 }, { bits: [0, 1], sign: 1 }]
    ];
    var COL_SUB = [
      [{ bits: [1], sign: 1 }, { bits: [0], sign: 1 }, { bits: [0, 1], sign: -1 }],
      [{ bits: [0], sign: 1 }, { bits: [1], sign: 1 }, { bits: [0, 1], sign: -1 }],
      [{ bits: [1], sign: 1 }, { bits: [0], sign: 1 }, { bits: [0, 1], sign: -1 }]
    ];
    function bellMoments() {
      // two Bell pairs (A0,B0) = (0,2) and (A1,B1) = (1,3)
      return [[op("H", 0), op("H", 1)]].concat(Clifford.cxMoments([[0, 2], [1, 3]]));
    }
    function symdiff(a, b) { var o = {}; a.concat(b).forEach(function (q) { o[q] = (o[q] || 0) ^ 1; }); return Object.keys(o).filter(function (q) { return o[q]; }).map(Number).sort(function (x, y) { return x - y; }); }
    function mapBits(bits, map) { return bits.map(function (b) { return map[b]; }); }

    // Variation I circuit for (row r, column c). Observables: [cell match].
    // ideal[i] is the parity each observable must have for a win.
    function variationI(r, c) {
      var C = Clifford.circuit(4);
      bellMoments().forEach(function (m) { Clifford.add(C, m); });
      Clifford.parallel(Clifford.remap(ROW_CIRCUIT[r], [0, 1]), Clifford.remap(COL_CIRCUIT[c], [2, 3])).forEach(function (m) { Clifford.add(C, m); });
      C.measured = [0, 1, 2, 3];
      var a = ROW_SUB[r][c], b = COL_SUB[c][r];
      return {
        circuit: C,
        observables: [symdiff(mapBits(a.bits, [0, 1]), mapBits(b.bits, [2, 3]))],
        ideal: [a.sign * b.sign > 0 ? 0 : 1]
      };
    }

    // QND-measure sign*P1P2 of `data` onto ancilla `anc` (ancilla control,
    // controlled-Paulis compiled to CZ + single-qubit gates).
    function qndMoments(pauli, data, anc) {
      var ms = [[op("H", anc)]];
      for (var i = 0; i < 2; i++) {
        var P = pauli[i], t = data[i];
        if (P === "Z") ms.push([op("CZ", anc, t)]);
        else if (P === "X") ms.push([op("H", t)], [op("CZ", anc, t)], [op("H", t)]);
        else if (P === "Y") ms.push([op("SDG", t)], [op("H", t)], [op("CZ", anc, t)], [op("H", t)], [op("S", t)]);
      }
      ms.push([op("H", anc)]);
      return ms;
    }
    // Variation II (supplement Fig. S2): every entry is measured directly.
    // Each player copies entries 0 and 1 onto two fresh ancillas by QND, then
    // folds entry 2 onto their second data qubit (the Variation I rotation,
    // then a CNOT from the first data qubit so Z0Z1 -> Z1) and reads only
    // that qubit: three readouts per player, as in the paper. Players must
    // now also satisfy their own product rule, so the referee checks three
    // parities: [Alice's row rule, Bob's column rule, cell match].
    // Qubits: A0 0, A1 1, B0 2, B1 3, Alice ancillas 4,5, Bob ancillas 6,7.
    function variationII(r, c) {
      var C = Clifford.circuit(8);
      bellMoments().forEach(function (m) { Clifford.add(C, m); });
      function playerMoments(entries, data, ancs, readout) {
        var ms = [];
        for (var e = 0; e < 2; e++) ms = ms.concat(qndMoments(entries[e][0], data, ancs[e]));
        return ms.concat(Clifford.remap(readout.concat(Clifford.cxMoments([[0, 1]])), data));
      }
      var rowE = TABLE[r], colE = [TABLE[0][c], TABLE[1][c], TABLE[2][c]];
      var am = playerMoments(rowE, [0, 1], [4, 5], ROW_CIRCUIT[r]);
      var bm = playerMoments(colE, [2, 3], [6, 7], COL_CIRCUIT[c]);
      Clifford.parallel(am, bm).forEach(function (m) { Clifford.add(C, m); });
      C.measured = [1, 3, 4, 5, 6, 7];
      // entry value sources: {bits, sign}; entry 2 now sits on data qubit 1
      function src(entries, sub, e, data, ancs) {
        if (e < 2) return { bits: [ancs[e]], sign: entries[e][1] };
        return { bits: [data[1]], sign: sub[2].sign };
      }
      var A = [0, 1, 2].map(function (e) { return src(rowE, ROW_SUB[r], e, [0, 1], [4, 5]); });
      var B = [0, 1, 2].map(function (e) { return src(colE, COL_SUB[c], e, [2, 3], [6, 7]); });
      function rule(S, want) {
        var bits = [], sign = 1;
        S.forEach(function (s) { bits = symdiff(bits, s.bits); sign *= s.sign; });
        return { bits: bits, parity: sign * want > 0 ? 0 : 1 };
      }
      var ra = rule(A, 1), cb = rule(B, -1);
      var cell = { bits: symdiff(A[c].bits, B[r].bits), parity: A[c].sign * B[r].sign > 0 ? 0 : 1 };
      return { circuit: C, observables: [ra.bits, cb.bits, cell.bits], ideal: [ra.parity, cb.parity, cell.parity], A: A, B: B };
    }

    // The circuits of the interactive game (index.html), uncompiled: CNOT is
    // one two-qubit gate there, as the player places it. Physical qubits:
    // Bell pairs (Q0,Q1) and (Q2,Q3); Alice holds (Q0,Q2), Bob (Q1,Q3).
    var GAME_COL_CIRCUIT = [[[op("H", 0)]], [[op("H", 1)]], [[op("CX", 0, 1)], [op("H", 0)]]];
    function gameCircuit(r, c) {
      var C = Clifford.circuit(4);
      Clifford.add(C, [op("H", 0), op("H", 2)]);
      Clifford.add(C, [op("CX", 0, 1), op("CX", 2, 3)]);
      Clifford.parallel(Clifford.remap(ROW_CIRCUIT[r], [0, 2]), Clifford.remap(GAME_COL_CIRCUIT[c], [1, 3])).forEach(function (m) { Clifford.add(C, m); });
      C.measured = [0, 1, 2, 3];
      var a = ROW_SUB[r][c], b = COL_SUB[c][r];
      return { circuit: C, observables: [symdiff(mapBits(a.bits, [0, 2]), mapBits(b.bits, [1, 3]))], ideal: [a.sign * b.sign > 0 ? 0 : 1] };
    }
    // Noise in the game: the paper's gate and readout rates, applied to each
    // gate as placed. No idling: the game has no clock.
    var GAME_NOISE = { p1: 5e-4, p2: 3e-3, readout: 7e-3, idle: 0 };
    function gameWinProb(r, c, noise) {
      var g = gameCircuit(r, c);
      return Clifford.noFlipProb1(Clifford.faultTable(Clifford.withNoise(g.circuit, noise || GAME_NOISE), 4, g.observables));
    }

    // Exact win probability of game (r, c) under a noise model.
    function winProb(variation, r, c, noise) {
      var g = variation === 2 ? variationII(r, c) : variationI(r, c);
      var ft = Clifford.faultTable(Clifford.withNoise(g.circuit, noise), g.circuit.n, g.observables);
      return Clifford.exactDistribution(ft)[0];
    }

    // Classical: a fixed table of nine +-1 values. Rows of Alice's must
    // multiply to +1 and Bob's columns to -1, so each player fills in the
    // one entry the rule forces. Returns the exact win rate over the 9
    // uniformly random (row, column) pairs.
    function classicalWinRate(tab) {
      var wins = 0;
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        var a = tab[r].slice(); a[2] = a[0] * a[1];
        var b = [tab[0][c], tab[1][c], tab[2][c]]; b[2] = -b[0] * b[1];
        if (a[c] === b[r]) wins++;
      }
      return wins / 9;
    }
    return { gameCircuit: gameCircuit, gameWinProb: gameWinProb, GAME_NOISE: GAME_NOISE, GAME_COL_CIRCUIT: GAME_COL_CIRCUIT, TABLE: TABLE, label: label, ROW_CIRCUIT: ROW_CIRCUIT, COL_CIRCUIT: COL_CIRCUIT, ROW_SUB: ROW_SUB, COL_SUB: COL_SUB, variationI: variationI, variationII: variationII, winProb: winProb, classicalWinRate: classicalWinRate };
  })();

  // =========================================================
  // KSB: chi = <R1>+<R2>+<R3> - <C1>-<C2>-<C3>. Noncontextual hidden
  // variables give chi <= 4; quantum mechanics gives 6 for ANY state.
  // =========================================================
  var KSB = (function () {
    // contexts 0..2 = rows, 3..5 = columns; each a list of [row, col] cells
    function contextCells(ctx) {
      var out = [];
      for (var i = 0; i < 3; i++) out.push(ctx < 3 ? [ctx, i] : [i, ctx - 3]);
      return out;
    }
    function contextName(ctx) { return ctx < 3 ? "R" + (ctx + 1) : "C" + (ctx - 2); }
    // Noncontextual assignment: one +-1 per cell, whatever the context.
    function chiOfAssignment(v) {
      var chi = 0;
      for (var r = 0; r < 3; r++) chi += v[r][0] * v[r][1] * v[r][2];
      for (var c = 0; c < 3; c++) chi -= v[0][c] * v[1][c] * v[2][c];
      return chi;
    }
    // Contextual assignment: separate values for the row reading and the
    // column reading of each cell (what quantum mechanics effectively does).
    function chiContextual(rowVals, colVals) {
      var chi = 0;
      for (var r = 0; r < 3; r++) chi += rowVals[r][0] * rowVals[r][1] * rowVals[r][2];
      for (var c = 0; c < 3; c++) chi -= colVals[0][c] * colVals[1][c] * colVals[2][c];
      return chi;
    }

    // The experiment's device: data qubits 0,1 and an ancilla 2 on a tiny
    // statevector. Each Pauli is mapped onto the ancilla as in Fig. S5A
    // (reset, H, CZs to the data qubits, with basis changes for X and Y, then
    // H and measure).
    // Noise: depolarizing after each gate, readout and reset flips, and
    // T1-type (X/Y) errors on the two data qubits while the ancilla is read
    // and reset. Plus the coherent effect of Sec. 4B: the measure/reset
    // cycle's flux excursions leave the ancilla with an extra phase
    // `phaseErr`, which a virtual Z (`virtualZ`) before the final H can
    // cancel. Both are in units of pi, like Cirq's Z**t on the x-axis of Fig. S5C.
    var PAPER_DEVICE = { p1: 5e-4, p2: 3e-3, readout: 7e-3, reset: 2e-3, idleMeas: 2e-3, phaseErr: 0, virtualZ: 0 };
    var IDEAL = { p1: 0, p2: 0, readout: 0, reset: 0, idleMeas: 0, phaseErr: 0, virtualZ: 0 };
    var PAULIS = ["X", "Y", "Z"];
    function dep1(s, q, p, r) { if (p > 0 && r() < p) SV.apply(s, PAULIS[Math.floor(r() * 3)], [q]); }
    function idleXY(s, q, p, r) { if (p > 0 && r() < p) SV.apply(s, r() < 0.5 ? "X" : "Y", [q]); }
    function dep2(s, a, b, p, r) {
      if (p > 0 && r() < p) { var m = 1 + Math.floor(r() * 15), ea = m >> 2, eb = m & 3; if (ea) SV.apply(s, PAULIS[ea - 1], [a]); if (eb) SV.apply(s, PAULIS[eb - 1], [b]); }
    }
    function g1(s, g, q, nz, r) { SV.apply(s, g, [q]); dep1(s, q, nz.p1, r); }
    function measurePauli(s, entry, nz, r) {
      var P = entry[0], anc = 2;
      g1(s, "H", anc, nz, r);
      for (var i = 0; i < 2; i++) {
        var t = i;
        if (P[i] === "Z") { SV.apply(s, "CZ", [anc, t]); dep2(s, anc, t, nz.p2, r); }
        else if (P[i] === "X") { g1(s, "H", t, nz, r); SV.apply(s, "CZ", [anc, t]); dep2(s, anc, t, nz.p2, r); g1(s, "H", t, nz, r); }
        else if (P[i] === "Y") { g1(s, "SDG", t, nz, r); g1(s, "H", t, nz, r); SV.apply(s, "CZ", [anc, t]); dep2(s, anc, t, nz.p2, r); g1(s, "H", t, nz, r); g1(s, "S", t, nz, r); }
      }
      var phase = (nz.phaseErr || 0) + (nz.virtualZ || 0);
      if (phase) SV.apply(s, "RZ", [anc], Math.PI * phase);
      g1(s, "H", anc, nz, r);
      var bit = SV.measure(s, anc, r);
      if (bit) SV.apply(s, "X", [anc]);            // reset
      if (nz.reset > 0 && r() < nz.reset) SV.apply(s, "X", [anc]);
      idleXY(s, 0, nz.idleMeas, r); idleXY(s, 1, nz.idleMeas, r);
      var reported = bit ^ (nz.readout > 0 && r() < nz.readout ? 1 : 0);
      return entry[1] * (reported ? -1 : 1);
    }
    function device(noise, r) {
      var s = SV.make(3);
      return {
        noise: noise,
        // Measure one context. Like the paper, the three measurements run
        // in a random order; values come back in the context's cell order.
        measureContext: function (ctx) {
          var cells = contextCells(ctx), vals = [0, 0, 0], order = shuffle([0, 1, 2], r);
          order.forEach(function (i) { vals[i] = measurePauli(s, Magic.TABLE[cells[i][0]][cells[i][1]], noise, r); });
          return vals;
        },
        reset: function () { s = SV.make(3); }
      };
    }
    function runner(opts) {
      var r = opts.rng || rng(), noise = opts.noise || PAPER_DEVICE;
      var length = opts.length || 180, done = 0;
      var sum = [0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0];
      var agree = { compatible: [0, 0], incompatible: [0, 0] };
      var perCell = { compatible: [], incompatible: [] };
      for (var c0 = 0; c0 < 9; c0++) { perCell.compatible.push([0, 0]); perCell.incompatible.push([0, 0]); }
      var dev = device(noise, r);
      function step(nReps) {
        for (var rep = 0; rep < nReps; rep++) {
          dev.reset();
          var tr = tracker();
          for (var t = 0; t < length; t++) {
            var ctx = Math.floor(r() * 6), vals = dev.measureContext(ctx);
            sum[ctx] += vals[0] * vals[1] * vals[2]; cnt[ctx]++;
            tr.record(ctx, vals).forEach(function (ev) {
              if (ev.kind === "other") return;
              var bk = agree[ev.kind], pc = perCell[ev.kind][ev.cell];
              bk[1]++; pc[1]++; if (ev.agree) { bk[0]++; pc[0]++; }
            });
          }
          done++;
        }
      }
      function result() {
        var mean = sum.map(function (s, i) { return cnt[i] ? s / cnt[i] : 0; });
        function frac(a) { return a[1] ? a[0] / a[1] : NaN; }
        return {
          reps: done, mean: mean, count: cnt.slice(),
          chi: mean[0] + mean[1] + mean[2] - mean[3] - mean[4] - mean[5],
          pAgreeCompatible: frac(agree.compatible), pAgreeIncompatible: frac(agree.incompatible),
          agree: { compatible: agree.compatible.slice(), incompatible: agree.incompatible.slice() },
          perCell: { compatible: perCell.compatible.map(frac), incompatible: perCell.incompatible.map(frac),
                     nCompatible: perCell.compatible.map(function (a) { return a[1]; }), nIncompatible: perCell.incompatible.map(function (a) { return a[1]; }) }
        };
      }
      return { step: step, result: result };
    }
    // Remembers each observable's last reading, which context it came from,
    // and whether something incompatible (anticommuting) has been measured
    // since. record() returns one event per repeated reading: {cell, kind,
    // agree}. Following Sec. 4A, kind is "compatible" only when the Pauli
    // appears in two consecutive contexts (so everything in between commutes
    // with it), "incompatible" when an anticommuting Pauli was measured in
    // between, and "other" for longer all-commuting gaps (not counted).
    var LABELS = [];
    for (var la = 0; la < 3; la++) for (var lb = 0; lb < 3; lb++) LABELS.push(Magic.TABLE[la][lb][0]);
    function tracker() {
      var last = new Int8Array(9), dirty = new Uint8Array(9), lastT = new Int32Array(9).fill(-9), t = -1;
      return {
        last: last, dirty: dirty,
        record: function (ctx, vals) {
          t++;
          var evs = [];
          contextCells(ctx).forEach(function (rc, i) {
            var id = rc[0] * 3 + rc[1];
            if (last[id] !== 0) evs.push({ cell: id, kind: dirty[id] ? "incompatible" : lastT[id] === t - 1 ? "compatible" : "other", agree: last[id] === vals[i] });
            last[id] = vals[i]; dirty[id] = 0; lastT[id] = t;
            for (var o = 0; o < 9; o++) if (o !== id && anticommutes(LABELS[o], LABELS[id])) dirty[o] = 1;
          });
          return evs;
        }
      };
    }
    // Run the paper's protocol: `reps` runs, each a random sequence of
    // `length` contexts, tracking <context products> and the agreement of
    // repeated readings of one observable.
    function experiment(opts) { var R = runner(opts); R.step(opts.reps || 1000); return R.result(); }
    return { contextCells: contextCells, contextName: contextName, chiOfAssignment: chiOfAssignment, chiContextual: chiContextual, device: device, experiment: experiment, runner: runner, tracker: tracker, PAPER_DEVICE: PAPER_DEVICE, IDEAL: IDEAL, CLASSICAL_BOUND: 4, QUANTUM_VALUE: 6 };
  })();

  // =========================================================
  // Square-lattice chip patch: the n sites closest to the origin.
  // =========================================================
  var latticeCache = {};
  function lattice(n) {
    if (latticeCache[n]) return latticeCache[n];
    var R = Math.ceil(Math.sqrt(n)) + 2, pts = [];
    for (var x = -R; x <= R; x++) for (var y = -R; y <= R; y++) pts.push([x, y]);
    // offset by a hair so ties break the same way in every engine
    pts.sort(function (a, b) {
      var da = (a[0] - 0.31) * (a[0] - 0.31) + (a[1] - 0.17) * (a[1] - 0.17), db = (b[0] - 0.31) * (b[0] - 0.31) + (b[1] - 0.17) * (b[1] - 0.17);
      return da - db;
    });
    pts = pts.slice(0, n);
    var index = {}, nbrs = [], edges = [];
    pts.forEach(function (p, i) { index[p[0] + "," + p[1]] = i; nbrs.push([]); });
    pts.forEach(function (p, i) {
      [[1, 0], [0, 1]].forEach(function (d) {
        var j = index[(p[0] + d[0]) + "," + (p[1] + d[1])];
        if (j !== undefined) {
          nbrs[i].push(j); nbrs[j].push(i);
          // 4-colouring of square-lattice edges into matchings: CZ layers
          var layer = d[0] ? ((p[0] & 1) ? 1 : 0) : ((p[1] & 1) ? 3 : 2);
          edges.push({ a: i, b: j, layer: layer });
        }
      });
    });
    var L = { n: n, pts: pts, nbrs: nbrs, edges: edges };
    latticeCache[n] = L;
    return L;
  }

  // =========================================================
  // GHZ game: N players, bits x_j with even sum; win iff
  // sum(y_j) = sum(x_j)/2 (mod 2).
  // =========================================================
  var GHZ = (function () {
    function classicalBound(N) { return 0.5 + Math.pow(2, -Math.ceil(N / 2)); }
    function evenInputs(N) {
      var out = [];
      for (var x = 0; x < (1 << N); x++) if ((popcount(x) & 1) === 0) out.push(x);
      return out;
    }
    function target(x) { return (popcount(x) >> 1) & 1; }
    function randomInput(N, r) {
      var x = 0; for (var j = 0; j < N - 1; j++) if (r() < 0.5) x |= 1 << j;
      if (popcount(x) & 1) x |= 1 << (N - 1);
      return x;
    }
    // Classical deterministic strategy: strat[j] = [y_j(x=0), y_j(x=1)].
    function classicalWin(strat) {
      var N = strat.length, ins = evenInputs(N), w = 0;
      ins.forEach(function (x) { var par = 0; for (var j = 0; j < N; j++) par ^= strat[j][(x >> j) & 1]; if (par === target(x)) w++; });
      return w / ins.length;
    }
    // Brute force over every deterministic strategy (small N, for tests).
    function classicalOptimumBrute(N) {
      var ins = evenInputs(N), best = 0;
      for (var S = 0; S < (1 << N); S++) for (var c = 0; c < 2; c++) {
        var w = 0;
        ins.forEach(function (x) { if (((popcount(x & S) + c) & 1) === target(x)) w++; });
        best = Math.max(best, w / ins.length);
      }
      return best;
    }
    // Quantum strategy on an ideal GHZ state: bases[j] = [basis if x=0,
    // basis if x=1], each "X", "Y" or "Z". Exact via statevector.
    function quantumWin(bases) {
      var N = bases.length, ins = evenInputs(N), tot = 0, all = [];
      for (var j = 0; j < N; j++) all.push(j);
      ins.forEach(function (x) {
        var s = SV.make(N);
        SV.apply(s, "H", [0]);
        for (var q = 1; q < N; q++) SV.apply(s, "CX", [0, q]);
        for (var k = 0; k < N; k++) rotateToZ(s, bases[k][(x >> k) & 1], k);
        tot += SV.parityProb(s, all, target(x));
      });
      return tot / ins.length;
    }
    function rotateToZ(s, basis, q) {
      if (basis === "X") SV.apply(s, "H", [q]);
      else if (basis === "Y") { SV.apply(s, "S", [q]); SV.apply(s, "H", [q]); }
    }
    // One round on the statevector: returns {y: bits, parity, win}.
    function playRound(bases, x, r) {
      var N = bases.length, s = SV.make(N), y = [];
      SV.apply(s, "H", [0]);
      for (var q = 1; q < N; q++) SV.apply(s, "CX", [0, q]);
      for (var k = 0; k < N; k++) rotateToZ(s, bases[k][(x >> k) & 1], k);
      var par = 0;
      for (var m = 0; m < N; m++) { var b = SV.measure(s, m, r); y.push(b); par ^= b; }
      return { y: y, parity: par, win: par === target(x) };
    }

    // Randomized breadth-first growth on the chip: each moment, every qubit
    // already in the GHZ state may entangle one fresh neighbour.
    function growth(N, r) {
      var L = lattice(Math.max(N, 1)), inG = new Uint8Array(N), members = [], layers = [];
      var root = Math.floor(r() * Math.min(N, 4)); // start near the centre
      inG[root] = 1; members.push(root);
      while (members.length < N) {
        var layer = [], busy = new Uint8Array(N), order = shuffle(members.slice(), r);
        for (var i = 0; i < order.length && members.length + layer.length < N; i++) {
          var c = order[i], cand = shuffle(L.nbrs[c].filter(function (j) { return j < N && !inG[j] && !busy[j]; }), r);
          if (cand.length) { busy[c] = 1; busy[cand[0]] = 1; layer.push([c, cand[0]]); }
        }
        if (!layer.length) throw new Error("growth stalled");
        layer.forEach(function (p) { inG[p[1]] = 1; members.push(p[1]); });
        layers.push(layer);
      }
      return { N: N, root: root, layers: layers, lattice: L };
    }
    // The game circuit: grow GHZ (CNOT = H CZ H), S where x_j = 1, H, measure.
    function circuit(pattern, x) {
      var N = pattern.N, C = Clifford.circuit(N);
      Clifford.add(C, [op("H", pattern.root)]);
      pattern.layers.forEach(function (layer) { Clifford.cxMoments(layer).forEach(function (m) { Clifford.add(C, m); }); });
      var ss = []; for (var j = 0; j < N; j++) if ((x >> j) & 1) ss.push(op("S", j));
      Clifford.add(C, ss);
      var hs = []; for (var k = 0; k < N; k++) hs.push(op("H", k));
      Clifford.add(C, hs);
      C.measured = null;
      var all = []; for (var q = 0; q < N; q++) all.push(q);
      return { circuit: C, observables: [all], ideal: [0] };
    }
    // x as a bit array (N can exceed 31 on the chip)
    function circuitBits(pattern, xb) {
      var N = pattern.N, C = Clifford.circuit(N);
      Clifford.add(C, [op("H", pattern.root)]);
      pattern.layers.forEach(function (layer) { Clifford.cxMoments(layer).forEach(function (m) { Clifford.add(C, m); }); });
      var ss = []; for (var j = 0; j < N; j++) if (xb[j]) ss.push(op("S", j));
      Clifford.add(C, ss);
      var hs = []; for (var k = 0; k < N; k++) hs.push(op("H", k));
      Clifford.add(C, hs);
      var all = []; for (var q = 0; q < N; q++) all.push(q);
      return { circuit: C, observables: [all] };
    }
    function randomInputBits(N, r) {
      var xb = new Uint8Array(N), s = 0;
      for (var j = 0; j < N - 1; j++) { xb[j] = r() < 0.5 ? 1 : 0; s += xb[j]; }
      xb[N - 1] = s & 1;
      return xb;
    }
    // Exact noisy win probability for one (input, growth pattern).
    function winProbBits(pattern, xb, noise) {
      var g = circuitBits(pattern, xb);
      return Clifford.noFlipProb1(Clifford.faultTable(Clifford.withNoise(g.circuit, noise), pattern.N, g.observables));
    }
    // GHZ fidelity, Sec. 5A of the supplement: F = (F^X + F^Z)/2, the mean
    // of the 2^N stabilizer expectations split into X-type (products of X
    // and Y with an even number of Y: exactly the game observables, so
    // P_w = (1 + F^X)/2) and Z-type (Z on an even subset of qubits).
    // Each expectation is exact from the fault table: <S> = 1 - 2 P(flip).
    function prepCircuit(pattern) {
      var N = pattern.N, C = Clifford.circuit(N);
      Clifford.add(C, [op("H", pattern.root)]);
      pattern.layers.forEach(function (layer) { Clifford.cxMoments(layer).forEach(function (m) { Clifford.add(C, m); }); });
      return C;
    }
    function zStabilizer(pattern, subset, noise) {
      var C = prepCircuit(pattern);
      return 2 * Clifford.noFlipProb1(Clifford.faultTable(Clifford.withNoise(C, noise), pattern.N, [subset])) - 1;
    }
    function xStabilizer(pattern, xb, noise) { return 2 * winProbBits(pattern, xb, noise) - 1; }
    function randomEvenSubset(N, r) {
      var xb = randomInputBits(N, r), out = [];
      for (var j = 0; j < N; j++) if (xb[j]) out.push(j);
      return out;
    }
    // Monte Carlo over stabilizers (as in the paper's refs. 67-68), or
    // every stabilizer when `exhaustive` and N is small.
    function fidelity(pattern, noise, opts) {
      opts = opts || {};
      var N = pattern.N, r = opts.rng || rng(), fx = 0, fz = 0, nx = 0, nz = 0;
      if (opts.exhaustive) {
        for (var m = 0; m < (1 << N); m++) {
          if (popcount(m) & 1) continue;
          var xb = new Uint8Array(N), sub = [];
          for (var j = 0; j < N; j++) if ((m >> j) & 1) { xb[j] = 1; sub.push(j); }
          fx += xStabilizer(pattern, xb, noise); nx++;
          fz += zStabilizer(pattern, sub, noise); nz++;
        }
      } else {
        for (var i = 0; i < (opts.samples || 20); i++) {
          fx += xStabilizer(pattern, randomInputBits(N, r), noise); nx++;
          fz += zStabilizer(pattern, randomEvenSubset(N, r), noise); nz++;
        }
      }
      fx /= nx; fz /= nz;
      return { FX: fx, FZ: fz, F: (fx + fz) / 2 };
    }
    return {
      prepCircuit: prepCircuit, zStabilizer: zStabilizer, xStabilizer: xStabilizer, randomEvenSubset: randomEvenSubset, fidelity: fidelity,
      classicalBound: classicalBound, classicalWin: classicalWin, classicalOptimumBrute: classicalOptimumBrute,
      quantumWin: quantumWin, playRound: playRound, evenInputs: evenInputs, target: target, randomInput: randomInput,
      growth: growth, circuit: circuit, circuitBits: circuitBits, randomInputBits: randomInputBits, winProbBits: winProbBits
    };
  })();

  // =========================================================
  // 2D hidden linear function. A is symmetric binary, nonzero only on
  // lattice edges (A_ij) and the diagonal (A_ii). q(x) = x^T A x mod 4.
  // On the kernel L = {x : Ax = 0 mod 2} q is linear, q(x) = 2 z.x mod 4,
  // and the task is to output such a z. Solutions form z0 + range(A).
  // =========================================================
  var HLF = (function () {
    function words(n) { return (n + 31) >> 5; }
    function bget(v, i) { return (v[i >> 5] >>> (i & 31)) & 1; }
    function bflip(v, i) { v[i >> 5] ^= (1 << (i & 31)) >>> 0; }
    function bdot(a, b) { var p = 0; for (var u = 0; u < a.length; u++) p ^= popcount(a[u] & b[u]); return p & 1; }
    function bxor(a, b) { for (var u = 0; u < a.length; u++) a[u] ^= b[u]; }
    function bzero(v) { for (var u = 0; u < v.length; u++) if (v[u]) return false; return true; }

    function instance(n, pGate, r) {
      var L = lattice(n), W = words(n), diag = new Uint8Array(n), on = [];
      for (var i = 0; i < n; i++) diag[i] = r() < pGate ? 1 : 0;
      L.edges.forEach(function (e) { if (r() < pGate) on.push(e); });
      return build(L, diag, on);
    }
    function build(L, diag, on) {
      var n = L.n, W = words(n), rows = [];
      for (var i = 0; i < n; i++) { rows.push(new Uint32Array(W)); if (diag[i]) bflip(rows[i], i); }
      on.forEach(function (e) { bflip(rows[e.a], e.b); bflip(rows[e.b], e.a); });
      var inst = { n: n, W: W, lattice: L, diag: diag, edges: on, rows: rows };
      inst.kernel = kernel(rows, n);
      return inst;
    }
    // GF(2) nullspace basis of the (symmetric) matrix.
    function kernel(rows, n) {
      var W = words(n), M = rows.map(function (r) { return r.slice(); }), pivotCol = [], rank = 0;
      var where = new Int32Array(n).fill(-1);
      for (var col = 0; col < n && rank < n; col++) {
        var sel = -1;
        for (var i = rank; i < n; i++) if (bget(M[i], col)) { sel = i; break; }
        if (sel < 0) continue;
        var t = M[sel]; M[sel] = M[rank]; M[rank] = t;
        for (var j = 0; j < n; j++) if (j !== rank && bget(M[j], col)) bxor(M[j], M[rank]);
        where[col] = rank; pivotCol.push(col); rank++;
      }
      var basis = [];
      for (var f = 0; f < n; f++) {
        if (where[f] >= 0) continue;
        var v = new Uint32Array(W); bflip(v, f);
        for (var c2 = 0; c2 < n; c2++) if (where[c2] >= 0 && bget(M[where[c2]], f)) bflip(v, c2);
        basis.push(v);
      }
      return basis;
    }
    function q(inst, x) {
      var s = 0;
      for (var i = 0; i < inst.n; i++) if (inst.diag[i] && bget(x, i)) s += 1;
      inst.edges.forEach(function (e) { if (bget(x, e.a) && bget(x, e.b)) s += 2; });
      return s & 3;
    }
    function matVec(inst, x) {
      var out = new Uint32Array(inst.W);
      for (var i = 0; i < inst.n; i++) if (bdot(inst.rows[i], x)) bflip(out, i);
      return out;
    }
    // z.v must equal q(v)/2 for each kernel basis vector v.
    function isSolution(inst, z) {
      for (var i = 0; i < inst.kernel.length; i++) if (bdot(z, inst.kernel[i]) !== (q(inst, inst.kernel[i]) >> 1)) return false;
      return true;
    }
    function solve(inst) {
      var K = inst.kernel, n = inst.n, W = inst.W, z = new Uint32Array(W);
      // rows: [v_i | b_i]; reduce, then back-substitute with free vars = 0
      var sys = K.map(function (v) { return { v: v.slice(), b: q(inst, v) >> 1 }; });
      var piv = [], rk = 0;
      for (var col = 0; col < n && rk < sys.length; col++) {
        var s = -1;
        for (var i = rk; i < sys.length; i++) if (bget(sys[i].v, col)) { s = i; break; }
        if (s < 0) continue;
        var t = sys[s]; sys[s] = sys[rk]; sys[rk] = t;
        for (var j = 0; j < sys.length; j++) if (j !== rk && bget(sys[j].v, col)) { bxor(sys[j].v, sys[rk].v); sys[j].b ^= sys[rk].b; }
        piv.push(col); rk++;
      }
      for (var k = 0; k < rk; k++) if (sys[k].b) bflip(z, piv[k]);
      return z;
    }
    // A sample of the ideal circuit's output: uniform over z0 + range(A)
    // (tests check this against the statevector for small grids).
    function idealSample(inst, r) {
      var z = solve(inst);
      for (var i = 0; i < inst.n; i++) if (r() < 0.5) bxor(z, inst.rows[i]);
      return z;
    }
    // H on all, S on the diagonal, four CZ layers (one per edge colour), H.
    function circuit(inst) {
      var n = inst.n, C = Clifford.circuit(n), all = [], i;
      for (i = 0; i < n; i++) all.push(op("H", i));
      Clifford.add(C, all);
      var ss = []; for (i = 0; i < n; i++) if (inst.diag[i]) ss.push(op("S", i));
      Clifford.add(C, ss);
      for (var layer = 0; layer < 4; layer++) {
        var czs = inst.edges.filter(function (e) { return e.layer === layer; }).map(function (e) { return op("CZ", e.a, e.b); });
        Clifford.add(C, czs);
      }
      Clifford.add(C, all.map(function (o) { return op("H", o.q[0]); }));
      return C;
    }
    function bitsToList(v, n) { var out = []; for (var i = 0; i < n; i++) if (bget(v, i)) out.push(i); return out; }
    // Noisy experiment on one instance: the output is correct iff no fault
    // flips z.v for any kernel basis vector v. Returns P(correct) by
    // sampling `shots` shots (the paper uses 100 per instance).
    function noisySuccess(inst, noise, shots, r) {
      if (!inst.kernel.length) return 1; // A invertible: range(A) is everything, any output is correct
      var C = circuit(inst);
      var obs = inst.kernel.map(function (v) { return bitsToList(v, inst.n); });
      var ft = Clifford.faultTable(Clifford.withNoise(C, noise), inst.n, obs);
      return Clifford.sampler(ft).okFraction(shots, r);
    }
    function inputCount(n) { return n + lattice(n).edges.length; }
    return {
      instance: instance, build: build, kernel: kernel, q: q, matVec: matVec, isSolution: isSolution, solve: solve,
      idealSample: idealSample, circuit: circuit, noisySuccess: noisySuccess, inputCount: inputCount,
      bget: bget, bflip: bflip, bdot: bdot, bzero: bzero, words: words, bitsToList: bitsToList
    };
  })();

  // =========================================================
  // Noise: Monte Carlo trajectory helpers for statevector games. After a
  // gate on `k` qubits, gateFaults() returns the Pauli errors to apply as
  // [[index into the gate's qubits, "X"|"Y"|"Z"], ...]: depolarizing with
  // p1 for one qubit, two-qubit depolarizing with p2 otherwise (a gate on
  // k > 2 qubits, e.g. a Toffoli, is charged k - 1 two-qubit gates on
  // neighbouring pairs, a stand-in for its decomposition).
  // readoutFlip() says whether a measured bit is misreported.
  // =========================================================
  var Noise = (function () {
    var P = ["X", "Y", "Z"];
    function gateFaults(k, noise, r) {
      var out = [];
      if (k <= 1) { if (noise.p1 > 0 && r() < noise.p1) out.push([0, P[Math.floor(r() * 3)]]); return out; }
      for (var i = 0; i + 1 < k; i++) {
        if (noise.p2 > 0 && r() < noise.p2) {
          var m = 1 + Math.floor(r() * 15), ea = m >> 2, eb = m & 3;
          if (ea) out.push([i, P[ea - 1]]);
          if (eb) out.push([i + 1, P[eb - 1]]);
        }
      }
      return out;
    }
    function readoutFlip(noise, r) { return noise.readout > 0 && r() < noise.readout; }
    // engine.js adapters (QEngine is passed in, so this file stays free of
    // it). gateQubits lists a placed gate's wires in the editor's format.
    function gateQubits(g) {
      if (g.role === "single") return [g.wire];
      if (g.role === "controlled") return g.controls.concat([g.target]);
      if (g.role === "swap") return [g.wireA, g.wireB];
      if (g.role === "cswap") return g.controls.concat([g.wireA, g.wireB]);
      return [];
    }
    // Apply one editor gate to a QEngine state, then any noise it draws.
    // Returns the faults as [{qubit: physical index, pauli}] for display.
    function applyQEngineGate(QE, s, g, qubitMap, noise, r) {
      QE.applyGate(s, g, qubitMap);
      if (!noise) return [];
      var wires = gateQubits(g), hits = [];
      gateFaults(wires.length, noise, r).forEach(function (f) {
        var phys = qubitMap[wires[f[0]]];
        QE.applyGate(s, { role: "single", gate: f[1], wire: 0 }, [phys]);
        hits.push({ qubit: phys, pauli: f[1] });
      });
      return hits;
    }
    // Measure physical qubits; bits are what the readout reports.
    function measureQEngine(QE, s, qubits, noise, r) {
      var truth = QE.partialMeasureAndCollapse(s, qubits), bits = [], flips = [];
      truth.forEach(function (b, i) { var f = !!noise && readoutFlip(noise, r); bits.push(f ? 1 - b : b); if (f) flips.push(qubits[i]); });
      return { bits: bits, truth: truth, flips: flips };
    }
    return { gateFaults: gateFaults, readoutFlip: readoutFlip, gateQubits: gateQubits, applyQEngineGate: applyQEngineGate, measureQEngine: measureQEngine };
  })();

  // =========================================================
  // PAPER: the measured data of arXiv:2512.02284, for side-by-side plots.
  // Read out of the PDF's vector paths (marker centres against the axis
  // tick marks) except where noted as digitized from a raster figure. The
  // tests check each set against the averages the paper prints.
  // =========================================================
  var PAPER = {
    magic: {
      // Fig. 1D, Plan I, 100k shots per game, games in row-major order
      // (R1C1, R1C2, ...). Row 1 is a raster panel, read at 600 dpi.
      fig1D: [0.983, 0.984, 0.970, 0.989, 0.991, 0.981, 0.982, 0.980, 0.984],
      fig1DAvg: 0.9830,
      // Fig. S3A, 10k shots per game (vector).
      s3I: [0.988, 0.988, 0.976, 0.981, 0.985, 0.977, 0.979, 0.969, 0.953],
      s3II: [0.955, 0.947, 0.931, 0.956, 0.951, 0.929, 0.923, 0.915, 0.913],
      s3Avg: { 1: 0.9773, 2: 0.9355 },
      // Fig. S3B: simulated contributions to the loss probability (%), one
      // mechanism at a time, and the measured loss.
      budget: { 1: { readout: 1.77, p2: 0.37, p1: 0.29, measured: 2.27 }, 2: { readout: 3.90, p2: 1.75, p1: 0.54, measured: 6.45 } }
    },
    ksb: {
      // Fig. 2B: 6<R1>, 6<R2>, 6<R3>, -6<C1>, -6<C2>, -6<C3> (vector).
      fig2B: [5.620, 5.662, 5.593, 5.603, 5.648, 5.586],
      chi: 5.618, chiErr: 0.005, agreeCompatible: 0.9636, agreeIncompatible: 0.500,
      // Fig. S5C: chi is maximal near this virtual Z (units of pi), read off the plot.
      calibratedVirtualZ: -0.27
    },
    ghz: {
      // Fig. 3B, N = 3..71: digitized from the raster figure at 600 dpi (+-0.002).
      fig3BStart: 3,
      fig3B: [0.961, 0.951, 0.940, 0.934, 0.927, 0.920, 0.915, 0.909, 0.902, 0.895, 0.888, 0.884, 0.878, 0.870, 0.861, 0.855, 0.849, 0.841, 0.835, 0.829, 0.819, 0.814, 0.809, 0.804, 0.799, 0.794, 0.788, 0.782, 0.775, 0.769, 0.766, 0.760, 0.755, 0.748, 0.746, 0.739, 0.737, 0.729, 0.722, 0.716, 0.710, 0.705, 0.700, 0.696, 0.690, 0.684, 0.682, 0.674, 0.672, 0.666, 0.660, 0.658, 0.652, 0.649, 0.644, 0.641, 0.635, 0.634, 0.631, 0.630, 0.629, 0.624, 0.622, 0.621, 0.619, 0.616, 0.613, 0.610, 0.607],
      // Fig. S6: measured total fidelity first drops below 1/2 here.
      fidelityBelowHalfAt: 45
    },
    hlf: {
      // Fig. 4B, P_gate = 0.5, n = 9..105, effective CZ layers (vector).
      fig4BStart: 9,
      fig4B: [4.120, 4.118, 4.157, 4.168, 4.177, 4.184, 4.198, 4.234, 4.252, 4.251, 4.260, 4.313, 4.287, 4.332, 4.319, 4.327, 4.356, 4.365, 4.373, 4.392, 4.395, 4.391, 4.448, 4.436, 4.467, 4.460, 4.467, 4.507, 4.505, 4.556, 4.583, 4.593, 4.632, 4.622, 4.656, 4.651, 4.739, 4.731, 4.708, 4.780, 4.745, 4.787, 4.821, 4.878, 4.904, 4.959, 4.890, 4.955, 4.985, 4.971, 4.974, 4.973, 5.009, 5.022, 5.033, 5.082, 5.064, 5.093, 5.168, 5.229, 5.244, 5.249, 5.283, 5.409, 5.434, 5.450, 5.578, 5.587, 5.646, 5.593, 5.608, 5.672, 5.712, 5.660, 5.704, 5.722, 5.790, 6.014, 6.074, 6.038, 6.195, 6.205, 6.216, 6.246, 6.250, 6.308, 6.336, 6.328, 6.408, 6.382, 6.538, 6.432, 6.471, 6.632, 6.611, 6.586, 6.548],
      // Fig. 4B gray segments: the classical lower bound in layers, as
      // [first n, last n, layers]. Eq. S45: ceil(log2(edges + nodes)) on
      // the paper's grids.
      classicalSteps: [[9, 14, 5], [15, 24, 6], [25, 48, 7], [49, 92, 8], [93, 105, 9]]
    }
  };
  function paperClassicalLayers(n) {
    var st = PAPER.hlf.classicalSteps;
    for (var i = 0; i < st.length; i++) if (n >= st[i][0] && n <= st[i][1]) return st[i][2];
    return Math.ceil(Math.log2(HLF.inputCount(n)));
  }

  var NonLocal = { rng: rng, binomial: binomial, popcount: popcount, shuffle: shuffle, anticommutes: anticommutes, lattice: lattice, SV: SV, Clifford: Clifford, Magic: Magic, KSB: KSB, GHZ: GHZ, HLF: HLF, Noise: Noise, PAPER: PAPER, paperClassicalLayers: paperClassicalLayers };
  if (typeof module !== "undefined" && module.exports) module.exports = NonLocal;
  if (typeof root !== "undefined" && root) root.NonLocal = NonLocal;
})(typeof window !== "undefined" ? window : this);

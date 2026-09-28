// =========================================================
// Shared stabilizer-code / Pauli-frame toolkit for quantum-games.
//
// A standalone, reusable namespace with no knowledge of any
// particular game. Where engine.js simulates full statevectors,
// this file tracks Pauli errors symplectically — exact for
// "did a logical error happen?" under Pauli noise on stabilizer
// codes, and a few bit operations per qubit.
//
// Browser: <script src="../stabilizer.js"></script> exposes
// `window.Stabilizer`. Node: `require("../stabilizer.js")`.
//
// Conventions:
//   - A Pauli is { n, x, z }: two bitmasks, bit q <-> qubit q
//     (qubit 0 is the leftmost character of a Pauli string).
//     Supports n <= 32. Phases are dropped — irrelevant for
//     error tracking.
//   - A code is { name, n, stabilizers: [Pauli], logicalX: [Pauli],
//     logicalZ: [Pauli] } (one X̄/Z̄ pair per logical qubit).
//   - A syndrome is an integer bitmask: bit i set <-> the error
//     anticommutes with stabilizer generator i.
// =========================================================
(function (root) {
  var Stabilizer = (function () {
    var MAX_QUBITS = 32;

    function popcount(v) {
      v = v - ((v >>> 1) & 0x55555555);
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
      return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }

    // ---------- Pauli construction & printing ----------
    function identity(n) {
      if (n > MAX_QUBITS) throw new Error("Stabilizer supports at most " + MAX_QUBITS + " qubits, got " + n);
      return { n: n, x: 0, z: 0 };
    }
    // "XZZXI" -> Pauli. 'I' or '_' for identity; case-insensitive.
    function fromString(s) {
      var p = identity(s.length);
      for (var q = 0; q < s.length; q++) {
        var c = s[q].toUpperCase();
        if (c === "X" || c === "Y") p.x |= (1 << q);
        if (c === "Z" || c === "Y") p.z |= (1 << q);
        if ("IXYZ_".indexOf(c) < 0) throw new Error("Bad Pauli character '" + s[q] + "' in " + s);
      }
      p.x >>>= 0; p.z >>>= 0;
      return p;
    }
    // Single Pauli type `t` ('X' | 'Y' | 'Z') on each qubit in `qubits`.
    function fromSupport(n, t, qubits) {
      var p = identity(n), mask = 0;
      for (var i = 0; i < qubits.length; i++) mask |= (1 << qubits[i]);
      if (t === "X" || t === "Y") p.x = mask >>> 0;
      if (t === "Z" || t === "Y") p.z = mask >>> 0;
      return p;
    }
    function single(n, q, t) { return fromSupport(n, t, [q]); }
    function toString(p) {
      var s = "";
      for (var q = 0; q < p.n; q++) {
        var bx = (p.x >>> q) & 1, bz = (p.z >>> q) & 1;
        s += bx ? (bz ? "Y" : "X") : (bz ? "Z" : "I");
      }
      return s;
    }
    // Pauli letter on qubit q: 'I' | 'X' | 'Y' | 'Z'.
    function at(p, q) {
      var bx = (p.x >>> q) & 1, bz = (p.z >>> q) & 1;
      return bx ? (bz ? "Y" : "X") : (bz ? "Z" : "I");
    }

    // ---------- Pauli algebra ----------
    function multiply(a, b) { return { n: a.n, x: (a.x ^ b.x) >>> 0, z: (a.z ^ b.z) >>> 0 }; }
    function isIdentity(p) { return p.x === 0 && p.z === 0; }
    function equals(a, b) { return a.n === b.n && a.x === b.x && a.z === b.z; }
    function weight(p) { return popcount((p.x | p.z) >>> 0); }
    // Symplectic inner product: true iff a and b commute.
    function commutes(a, b) { return (popcount(((a.x & b.z) ^ (a.z & b.x)) >>> 0) & 1) === 0; }

    // ---------- GF(2) linear algebra over Paulis ----------
    // Leading bit of the 64-bit vector (x as the high word, z as the low
    // word), as an index 0..63, or -1 for the identity.
    function lead(p) {
      if (p.x) return 32 + 31 - Math.clz32(p.x);
      if (p.z) return 31 - Math.clz32(p.z);
      return -1;
    }
    // XOR basis with distinct leading bits. reduce() strictly lowers the
    // leading bit each step, so it terminates in <= 64 steps.
    function makeBasis() {
      var byLead = {};
      var size = 0;
      function reduce(p) {
        var v = { n: p.n, x: p.x, z: p.z };
        for (var L = lead(v); L >= 0 && byLead[L]; L = lead(v)) v = multiply(v, byLead[L]);
        return v;
      }
      return {
        // Returns true iff p was independent of the current basis.
        insert: function (p) {
          var v = reduce(p);
          if (isIdentity(v)) return false;
          byLead[lead(v)] = v; size++;
          return true;
        },
        contains: function (p) { return isIdentity(reduce(p)); },
        size: function () { return size; }
      };
    }
    function rank(paulis) {
      var B = makeBasis();
      for (var i = 0; i < paulis.length; i++) B.insert(paulis[i]);
      return B.size();
    }
    function inGroup(generators, p) {
      var B = makeBasis();
      for (var i = 0; i < generators.length; i++) B.insert(generators[i]);
      return B.contains(p);
    }
    // True iff two generator lists generate the same stabilizer group (up
    // to phases): equal GF(2) row spaces. This is what decides whether an
    // animal (code) can live in a biome (the checks an enclosure measures).
    function sameStabilizerGroup(genA, genB) {
      if (genA.length && genB.length && genA[0].n !== genB[0].n) return false;
      var rA = rank(genA), rB = rank(genB);
      return rA === rB && rank(genA.concat(genB)) === rA;
    }
    // Explain a biome/code mismatch in physics terms: returns the first
    // check in `checks` that is not in the code's stabilizer group, plus
    // a logical operator it anticommutes with (if any) — measuring such a
    // check would scramble the encoded information. Returns null when
    // every check is in the group (the mismatch, if any, is then a
    // missing check: see missingChecks).
    function firstForeignCheck(code, checks) {
      for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        if (inGroup(code.stabilizers, c)) continue;
        var clash = null;
        for (var j = 0; j < code.logicalX.length && !clash; j++) {
          if (!commutes(c, code.logicalX[j])) clash = { name: "X̄" + (code.logicalX.length > 1 ? j : ""), op: code.logicalX[j] };
          else if (!commutes(c, code.logicalZ[j])) clash = { name: "Z̄" + (code.logicalZ.length > 1 ? j : ""), op: code.logicalZ[j] };
        }
        var stabClash = null;
        for (var s = 0; s < code.stabilizers.length && !stabClash; s++) {
          if (!commutes(c, code.stabilizers[s])) stabClash = code.stabilizers[s];
        }
        return { index: i, check: c, logical: clash, stabilizer: stabClash };
      }
      return null;
    }
    // Code generators that the checks don't generate (the biome under-measures).
    function missingChecks(code, checks) {
      return code.stabilizers.filter(function (g) { return !inGroup(checks, g); });
    }

    // ---------- Codes ----------
    function parseList(n, list) {
      return list.map(function (s) {
        var p = typeof s === "string" ? fromString(s) : s;
        if (p.n !== n) throw new Error("Operator " + toString(p) + " has " + p.n + " qubits, code has " + n);
        return p;
      });
    }
    // spec: { name, n, stabilizers, logicalX, logicalZ } — operators as
    // Pauli strings or Pauli objects; logicals may be a single operator.
    function makeCode(spec) {
      function asList(v) { return Array.isArray(v) ? v : [v]; }
      return {
        name: spec.name, n: spec.n,
        stabilizers: parseList(spec.n, spec.stabilizers),
        logicalX: parseList(spec.n, asList(spec.logicalX)),
        logicalZ: parseList(spec.n, asList(spec.logicalZ))
      };
    }
    // Full consistency check of a code definition. Returns
    // { ok, k, errors: [string] }.
    function validateCode(code) {
      var errors = [], S = code.stabilizers, LX = code.logicalX, LZ = code.logicalZ;
      var i, j;
      for (i = 0; i < S.length; i++) for (j = i + 1; j < S.length; j++) {
        if (!commutes(S[i], S[j])) errors.push("Stabilizers " + toString(S[i]) + " and " + toString(S[j]) + " anticommute");
      }
      var r = rank(S);
      if (r !== S.length) errors.push("Stabilizer generators are dependent (rank " + r + " of " + S.length + ")");
      var k = code.n - r;
      if (LX.length !== k || LZ.length !== k) errors.push("Expected " + k + " logical X/Z pairs, got " + LX.length + "/" + LZ.length);
      var L = LX.concat(LZ);
      for (i = 0; i < L.length; i++) {
        for (j = 0; j < S.length; j++) {
          if (!commutes(L[i], S[j])) errors.push("Logical " + toString(L[i]) + " anticommutes with stabilizer " + toString(S[j]));
        }
        if (inGroup(S, L[i])) errors.push("Logical " + toString(L[i]) + " is in the stabilizer group");
      }
      for (i = 0; i < LX.length; i++) for (j = 0; j < LZ.length; j++) {
        var shouldAnti = i === j;
        if (commutes(LX[i], LZ[j]) === shouldAnti) {
          errors.push("X̄" + i + " and Z̄" + j + (shouldAnti ? " should anticommute" : " should commute"));
        }
      }
      for (i = 0; i < LX.length; i++) for (j = i + 1; j < LX.length; j++) {
        if (!commutes(LX[i], LX[j])) errors.push("X̄" + i + " and X̄" + j + " should commute");
        if (!commutes(LZ[i], LZ[j])) errors.push("Z̄" + i + " and Z̄" + j + " should commute");
      }
      return { ok: errors.length === 0, k: k, errors: errors };
    }

    // Integer syndrome of error E: bit i set iff E anticommutes with generator i.
    function syndrome(code, E) {
      var s = 0, S = code.stabilizers;
      for (var i = 0; i < S.length; i++) if (!commutes(E, S[i])) s |= (1 << i);
      return s >>> 0;
    }
    function syndromeBits(code, s) {
      var bits = [];
      for (var i = 0; i < code.stabilizers.length; i++) bits.push((s >>> i) & 1);
      return bits;
    }
    // For a zero-syndrome E: which logicals did it flip? Returns
    // { x: [bool], z: [bool], any: bool } where x[j] means E acts as a
    // nontrivial X̄j-type flip (anticommutes with Z̄j), z[j] likewise.
    function logicalAction(code, E) {
      var xs = [], zs = [], any = false;
      for (var j = 0; j < code.logicalX.length; j++) {
        var flipsZ = !commutes(E, code.logicalZ[j]); // E contains an X̄j
        var flipsX = !commutes(E, code.logicalX[j]); // E contains a Z̄j
        xs.push(flipsZ); zs.push(flipsX);
        if (flipsZ || flipsX) any = true;
      }
      return { x: xs, z: zs, any: any };
    }
    // True iff E (assumed to have zero syndrome) is a nontrivial logical
    // operator, i.e. not in the stabilizer group. For zero-syndrome E this
    // is equivalent to anticommuting with some logical.
    function isLogicalError(code, E) { return logicalAction(code, E).any; }

    // ---------- Decoders ----------
    // Enumerate every Pauli of exactly weight w on n qubits, calling fn(p).
    function forEachPauliOfWeight(n, w, fn) {
      var types = [[1, 0], [0, 1], [1, 1]]; // X, Z, Y as (x, z) bits
      function recurse(start, left, x, z) {
        if (left === 0) { fn({ n: n, x: x >>> 0, z: z >>> 0 }); return; }
        for (var q = start; q <= n - left; q++) {
          for (var t = 0; t < 3; t++) {
            recurse(q + 1, left - 1, types[t][0] ? (x | (1 << q)) : x, types[t][1] ? (z | (1 << q)) : z);
          }
        }
      }
      recurse(0, w, 0, 0);
    }
    // Minimum-weight lookup-table decoder: enumerates errors in order of
    // increasing weight up to maxWeight and keeps the first (lowest-weight)
    // correction seen for each syndrome. Unknown syndromes decode to the
    // identity (the keeper shrugs). Ties within a weight are broken by
    // enumeration order (lowest qubit indices first; X before Z before Y).
    function buildLookupDecoder(code, maxWeight) {
      var table = new Map();
      table.set(0, identity(code.n));
      for (var w = 1; w <= maxWeight; w++) {
        forEachPauliOfWeight(code.n, w, function (p) {
          var s = syndrome(code, p);
          if (!table.has(s)) table.set(s, p);
        });
      }
      return {
        maxWeight: maxWeight,
        table: table,
        knows: function (s) { return table.has(s); },
        decode: function (s) { return table.get(s) || identity(code.n); }
      };
    }
    // One round of error correction on error frame E: measure, decode,
    // apply. Returns { syndrome, correction, residual }.
    function correct(code, decoder, E) {
      var s = syndrome(code, E);
      var C = decoder.decode(s);
      return { syndrome: s, correction: C, residual: multiply(E, C) };
    }

    // ---------- Noise ----------
    // Small, fast, seedable PRNG (mulberry32) so tests and replays are
    // deterministic. Returns a function () -> [0, 1).
    function seededRng(seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    // Independent single-qubit Pauli channel: each qubit independently
    // gets X w.p. pX, Y w.p. pY, Z w.p. pZ.
    function sampleNoise(n, rates, rng) {
      rng = rng || Math.random;
      var pX = rates.pX || 0, pY = rates.pY || 0, pZ = rates.pZ || 0;
      var x = 0, z = 0;
      for (var q = 0; q < n; q++) {
        var r = rng();
        if (r < pX) x |= (1 << q);
        else if (r < pX + pY) { x |= (1 << q); z |= (1 << q); }
        else if (r < pX + pY + pZ) z |= (1 << q);
      }
      return { n: n, x: x >>> 0, z: z >>> 0 };
    }
    // Common channels, parameterized by total error probability p.
    var channels = {
      depolarizing: function (p) { return { pX: p / 3, pY: p / 3, pZ: p / 3 }; },
      bitFlip: function (p) { return { pX: p, pY: 0, pZ: 0 }; },
      phaseFlip: function (p) { return { pX: 0, pY: 0, pZ: p }; },
      // Z-biased: pZ / (pX + pY) = eta.
      biasedZ: function (p, eta) { var lo = p / (eta + 1) / 2; return { pX: lo, pY: lo, pZ: p - 2 * lo }; }
    };

    return {
      MAX_QUBITS: MAX_QUBITS,
      identity: identity, fromString: fromString, fromSupport: fromSupport, single: single,
      toString: toString, at: at,
      multiply: multiply, isIdentity: isIdentity, equals: equals, weight: weight, commutes: commutes,
      makeBasis: makeBasis, rank: rank, inGroup: inGroup, sameStabilizerGroup: sameStabilizerGroup,
      firstForeignCheck: firstForeignCheck, missingChecks: missingChecks,
      makeCode: makeCode, validateCode: validateCode,
      syndrome: syndrome, syndromeBits: syndromeBits, logicalAction: logicalAction, isLogicalError: isLogicalError,
      forEachPauliOfWeight: forEachPauliOfWeight, buildLookupDecoder: buildLookupDecoder, correct: correct,
      seededRng: seededRng, sampleNoise: sampleNoise, channels: channels
    };
  })();

  if (typeof module !== "undefined" && module.exports) module.exports = Stabilizer;
  else root.Stabilizer = Stabilizer;
})(typeof window !== "undefined" ? window : this);

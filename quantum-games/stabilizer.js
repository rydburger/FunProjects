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
        size: function () { return size; },
        // Basis vectors with their leading bit (>= 32: an x bit, else a z bit).
        entries: function () {
          return Object.keys(byLead).map(function (L) { return { lead: +L, p: byLead[L] }; });
        }
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

    // ---------- Code analysis ----------
    // Everything here works from a bare list of checks, so codes the
    // player wires up themselves get the same treatment as textbook ones.

    // Basis of the normalizer N(S): every Pauli commuting with all of
    // `stabs`. Solves the symplectic constraints by Gaussian elimination
    // over 2n bit columns (column q = x bit q, column n+q = z bit q).
    function normalizerBasis(n, stabs) {
      var cols = 2 * n, rows = stabs.map(function (s) {
        var r = [];
        // <s, v> = s.z·v.x + s.x·v.z, so the row is s with x and z swapped.
        for (var q = 0; q < n; q++) r.push((s.z >>> q) & 1);
        for (q = 0; q < n; q++) r.push((s.x >>> q) & 1);
        return r;
      });
      var pivots = [], row = 0;
      for (var c = 0; c < cols && row < rows.length; c++) {
        var piv = -1;
        for (var i = row; i < rows.length; i++) if (rows[i][c]) { piv = i; break; }
        if (piv < 0) continue;
        var tmp = rows[piv]; rows[piv] = rows[row]; rows[row] = tmp;
        for (i = 0; i < rows.length; i++) {
          if (i !== row && rows[i][c]) for (var j = c; j < cols; j++) rows[i][j] ^= rows[row][j];
        }
        pivots.push(c); row++;
      }
      var basis = [];
      for (var f = 0; f < cols; f++) {
        if (pivots.indexOf(f) >= 0) continue;
        var v = [];
        for (j = 0; j < cols; j++) v.push(0);
        v[f] = 1;
        for (i = 0; i < pivots.length; i++) if (rows[i][f]) v[pivots[i]] = 1;
        var p = identity(n);
        for (q = 0; q < n; q++) { if (v[q]) p.x |= (1 << q); if (v[n + q]) p.z |= (1 << q); }
        p.x >>>= 0; p.z >>>= 0;
        basis.push(p);
      }
      return basis;
    }
    // Greedily lower an operator's weight by multiplying in stabilizers
    // (cosmetic: the logical class is unchanged).
    function trimWeight(p, stabs) {
      for (var improved = true; improved;) {
        improved = false;
        for (var i = 0; i < stabs.length; i++) {
          var q = multiply(p, stabs[i]);
          if (weight(q) < weight(p)) { p = q; improved = true; }
        }
      }
      return p;
    }
    // Logical operators for commuting checks `stabs`: k pairs (X̄i, Z̄i)
    // with X̄i, Z̄j anticommuting iff i = j and all other pairs commuting
    // (symplectic Gram–Schmidt on N(S) modulo S).
    function findLogicals(n, stabs) {
      var B = makeBasis();
      stabs.forEach(function (s) { B.insert(s); });
      var L = normalizerBasis(n, stabs).filter(function (p) { return B.insert(p); });
      var LX = [], LZ = [];
      while (L.length) {
        var a = L.shift(), bi = -1;
        for (var i = 0; i < L.length && bi < 0; i++) if (!commutes(a, L[i])) bi = i;
        if (bi < 0) throw new Error("findLogicals: checks do not commute");
        var b = L.splice(bi, 1)[0];
        L = L.map(function (c) {
          var c2 = c;
          if (!commutes(c, b)) c2 = multiply(c2, a);
          if (!commutes(c, a)) c2 = multiply(c2, b);
          return c2;
        });
        LX.push(trimWeight(a, stabs)); LZ.push(trimWeight(b, stabs));
      }
      return { logicalX: LX, logicalZ: LZ };
    }
    // True iff the group generated by `gens` has a generating set of pure
    // X-type and pure Z-type operators (a CSS code). An echelon basis whose
    // leading bits prefer x bits puts the pure-Z subgroup on the vectors
    // led by a z bit; swapping x and z does the same for the pure-X part.
    function isCSS(gens) {
      function pureCount(list) {
        var B = makeBasis();
        list.forEach(function (g) { B.insert(g); });
        return { rank: B.size(), pure: B.entries().filter(function (e) { return e.lead < 32; }).length };
      }
      var zPart = pureCount(gens);
      var xPart = pureCount(gens.map(function (g) { return { n: g.n, x: g.z, z: g.x }; }));
      return zPart.pure + xPart.pure === zPart.rank;
    }
    // Minimum weight of a nontrivial logical operator (commutes with every
    // stabilizer, not in the stabilizer group), by exhaustive search in
    // order of weight. Each qubit's Pauli is precomputed as two bitmasks —
    // which generators it anticommutes with, and which logicals — so the
    // search is XORs. CSS codes only need pure-X and pure-Z candidates.
    // Returns { d, witness } or, past maxWeight or the work budget,
    // { d: null, atLeast }.
    function codeDistance(code, maxWeight, budget) {
      var n = code.n, S = code.stabilizers, Ls = code.logicalX.concat(code.logicalZ);
      if (S.length > 32 || Ls.length > 32) throw new Error("codeDistance: at most 32 generators and 16 logical qubits");
      maxWeight = maxWeight || n;
      budget = budget || 5e7;
      var typeSets = isCSS(S) ? [[[1, 0]], [[0, 1]]] : [[[1, 0], [0, 1], [1, 1]]];
      function masks(t, q) {
        var P = { n: n, x: t[0] ? (1 << q) >>> 0 : 0, z: t[1] ? (1 << q) >>> 0 : 0 }, s = 0, l = 0;
        for (var i = 0; i < S.length; i++) if (!commutes(P, S[i])) s |= (1 << i);
        for (i = 0; i < Ls.length; i++) if (!commutes(P, Ls[i])) l |= (1 << i);
        return { s: s, l: l, x: P.x, z: P.z };
      }
      function choose(a, b) { var r = 1; for (var i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; }
      for (var w = 1; w <= Math.min(maxWeight, n); w++) {
        var work = 0;
        typeSets.forEach(function (ts) { work += choose(n, w) * Math.pow(ts.length, w); });
        if (work > budget) return { d: null, atLeast: w };
        for (var t = 0; t < typeSets.length; t++) {
          var ts = typeSets[t], table = [];
          for (var q = 0; q < n; q++) table.push(ts.map(function (tt) { return masks(tt, q); }));
          var found = null;
          (function recurse(start, left, s, l, x, z) {
            if (found) return;
            if (left === 0) {
              if (s === 0 && l !== 0) found = { n: n, x: x >>> 0, z: z >>> 0 };
              return;
            }
            for (var q2 = start; q2 <= n - left && !found; q2++) {
              for (var k = 0; k < table[q2].length; k++) {
                var m = table[q2][k];
                recurse(q2 + 1, left - 1, s ^ m.s, l ^ m.l, x | m.x, z | m.z);
              }
            }
          })(0, w, 0, 0, 0, 0);
          if (found) return { d: w, witness: found };
        }
      }
      return { d: null, atLeast: Math.min(maxWeight, n) + 1 };
    }
    // Everything a player-built habitat needs to know about its checks:
    // do they commute, how many are independent, how many logical qubits
    // (animals) fit, is it CSS, and (if it encodes anything) the distance.
    // Returns { n, commuting, clash: [i, j] | null, rank, redundant, k,
    //   css, code: (code with computed logicals) | null, d, dAtLeast }.
    function analyzeChecks(n, checks, opts) {
      opts = opts || {};
      var out = { n: n, commuting: true, clash: null, rank: rank(checks), redundant: 0, k: 0,
        css: false, code: null, d: null, dAtLeast: null };
      out.redundant = checks.length - out.rank;
      for (var i = 0; i < checks.length && !out.clash; i++) {
        for (var j = i + 1; j < checks.length; j++) {
          if (!commutes(checks[i], checks[j])) { out.clash = [i, j]; break; }
        }
      }
      out.commuting = !out.clash;
      out.css = isCSS(checks);
      if (!out.commuting) return out;
      // Keep an independent subset as the generators.
      var B = makeBasis(), gens = checks.filter(function (c) { return B.insert(c); });
      out.k = n - gens.length;
      if (out.k === 0) return out;
      var L = findLogicals(n, gens);
      out.code = { name: opts.name || "custom", n: n, stabilizers: gens, logicalX: L.logicalX, logicalZ: L.logicalZ };
      var dist = codeDistance(out.code, opts.maxWeight, opts.budget);
      out.d = dist.d; out.dAtLeast = dist.atLeast || null;
      return out;
    }

    // ---------- Code families ----------
    // Distance-d rotated surface code [[d², 1, d]] on a d×d grid, qubit
    // r·d + c. Weight-4 plaquettes sit between grid points in a
    // checkerboard (X where row+col of the plaquette's lower-right qubit
    // is even); weight-2 X checks line the top and bottom edges and Z
    // checks the left and right edges. X̄ runs down the left column, Z̄
    // along the top row.
    function rotatedSurface(d) {
      var n = d * d, stabs = [], i, j;
      for (i = 0; i <= d; i++) for (j = 0; j <= d; j++) {
        var qs = [];
        [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]].forEach(function (rc) {
          if (rc[0] >= 0 && rc[0] < d && rc[1] >= 0 && rc[1] < d) qs.push(rc[0] * d + rc[1]);
        });
        var t = (i + j) % 2 === 0 ? "X" : "Z";
        var top = i === 0 || i === d, side = j === 0 || j === d;
        if (qs.length === 4 || (qs.length === 2 && ((top && t === "X") || (side && t === "Z")))) {
          stabs.push(fromSupport(n, t, qs));
        }
      }
      var col = [], row = [];
      for (i = 0; i < d; i++) { col.push(i * d); row.push(i); }
      return makeCode({
        name: "Rotated surface code (d=" + d + ")", n: n, stabilizers: stabs,
        logicalX: fromSupport(n, "X", col), logicalZ: fromSupport(n, "Z", row)
      });
    }
    // n-qubit repetition code against bit flips (t = "Z" checks) or phase
    // flips (t = "X" checks): neighbouring-pair checks.
    function repetition(n, t) {
      t = t || "Z";
      var o = t === "Z" ? "X" : "Z", stabs = [], all = [];
      for (var q = 0; q < n; q++) { all.push(q); if (q + 1 < n) stabs.push(fromSupport(n, t, [q, q + 1])); }
      return makeCode({
        name: n + "-qubit repetition code", n: n, stabilizers: stabs,
        // X̄ is the all-o string; Z̄ is a single t (any one qubit's parity).
        logicalX: fromSupport(n, o, all), logicalZ: fromSupport(n, t, [0])
      });
    }

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
      normalizerBasis: normalizerBasis, findLogicals: findLogicals, isCSS: isCSS, codeDistance: codeDistance,
      analyzeChecks: analyzeChecks, rotatedSurface: rotatedSurface, repetition: repetition,
      forEachPauliOfWeight: forEachPauliOfWeight, buildLookupDecoder: buildLookupDecoder, correct: correct,
      seededRng: seededRng, sampleNoise: sampleNoise, channels: channels
    };
  })();

  if (typeof module !== "undefined" && module.exports) module.exports = Stabilizer;
  else root.Stabilizer = Stabilizer;
})(typeof window !== "undefined" ? window : this);

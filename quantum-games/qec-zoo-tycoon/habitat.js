// =========================================================
// Error Correction Zoo Tycoon — habitat designs (the workshop).
//
// A design is what the player builds in the habitat workshop:
//   { qubits: [[x, y]],                      data qubits, in index order
//     checks: [{ at: [x, y],                 a check ancilla
//                wires: [[q, "X"|"Y"|"Z"]] }] }  wired data qubits, in
//                                             CNOT order (kept for the
//                                             circuit-level model, M8)
// Each check measures the product of its wires' Paulis. analyze() says
// what the checks make: do they commute, how many are independent, how
// many logical qubits (animals) fit, the distance, and what it costs.
// identify() recognises a known species however its qubits are numbered
// and whichever Pauli each qubit's wires use: two codes are the same
// species if relabelling the qubits and swapping X, Y, Z on individual
// qubits (local Cliffords) turns one stabilizer group into the other.
// Such codes behave identically under depolarizing noise.
//
// DOM-free. Browser: load after ../stabilizer.js and zoo-data.js;
// exposes `window.Habitat`. Node: require("./habitat.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var S = isNode ? require("../stabilizer.js") : root.Stabilizer;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;
  var B = Z.BUILD;

  function popcount(v) { v = v >>> 0; var c = 0; while (v) { v &= v - 1; c++; } return c; }
  function bits(v) { var out = []; for (var q = 0; v; q++, v >>>= 1) if (v & 1) out.push(q); return out; }

  // Check labels A, B, …, Z, AA, AB, …
  function checkLabel(i) {
    var s = "";
    i++;
    while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // ---------- designs <-> Paulis ----------
  function emptyDesign() { return { qubits: [], checks: [] }; }
  function clone(design) { return JSON.parse(JSON.stringify(design)); }
  function checkOp(design, c) {
    var n = design.qubits.length, x = 0, z = 0;
    c.wires.forEach(function (w) {
      var bit = (1 << w[0]) >>> 0;
      if (w[1] === "X" || w[1] === "Y") x ^= bit;
      if (w[1] === "Z" || w[1] === "Y") z ^= bit;
    });
    return { n: n, x: x >>> 0, z: z >>> 0 };
  }
  function checkOps(design) { return design.checks.map(function (c) { return checkOp(design, c); }); }
  function wireCount(design) { return design.checks.reduce(function (a, c) { return a + c.wires.length; }, 0); }
  // A design from a code and positions: check i measures stabilizer i.
  // spec: { qubits: [[x, y]], checkAt: [[x, y]] } (ZooData.DESIGNS).
  function fromCode(code, spec) {
    return {
      qubits: spec.qubits.map(function (p) { return [p[0], p[1]]; }),
      checks: code.stabilizers.map(function (P, i) {
        var wires = [];
        for (var q = 0; q < code.n; q++) { var a = S.at(P, q); if (a !== "I") wires.push([q, a]); }
        return { at: [spec.checkAt[i][0], spec.checkAt[i][1]], wires: wires };
      })
    };
  }
  function designFor(speciesId) { return fromCode(Z.SPECIES[speciesId].code, Z.DESIGNS[speciesId]); }

  // Shape check for designs coming from saves or the page. Returns an
  // error message or null.
  function malformed(design) {
    if (!design || !Array.isArray(design.qubits) || !Array.isArray(design.checks)) return "Not a design.";
    var n = design.qubits.length, seen = {};
    function cell(p) {
      return Array.isArray(p) && p.length === 2 && p.every(function (v) { return typeof v === "number" && v >= 0 && v < B.grid && v === Math.floor(v); });
    }
    function occupy(p) { var k = p[0] + "," + p[1]; if (seen[k]) return false; seen[k] = true; return true; }
    for (var i = 0; i < n; i++) if (!cell(design.qubits[i]) || !occupy(design.qubits[i])) return "Bad qubit position.";
    for (i = 0; i < design.checks.length; i++) {
      var c = design.checks[i], used = {};
      if (!c || !cell(c.at) || !occupy(c.at) || !Array.isArray(c.wires)) return "Bad check.";
      for (var j = 0; j < c.wires.length; j++) {
        var w = c.wires[j];
        if (!Array.isArray(w) || !(w[0] >= 0 && w[0] < n) || used[w[0]] || "XYZ".indexOf(w[1]) < 0 || w[1].length !== 1) return "Bad wire.";
        used[w[0]] = true;
      }
    }
    return null;
  }

  // ---------- size, shape and price ----------
  // Half a tile per qubit (data or ancilla).
  function tiles(totalQubits) { return Math.max(1, Math.ceil(totalQubits / B.qubitsPerTile)); }

  // A shape is a list of [x, y] tiles, shifted so the smallest x and y
  // are 0 and sorted row by row. Catalogue habitats have fixed shapes
  // (BIOMES[].cells); a workshop design gets a random one, seeded by the
  // design itself so a blueprint always has the same shape.
  function normalize(cells) {
    var mx = Infinity, my = Infinity;
    cells.forEach(function (c) { mx = Math.min(mx, c[0]); my = Math.min(my, c[1]); });
    return cells.map(function (c) { return [c[0] - mx, c[1] - my]; })
      .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  // Bounding box [w, h].
  function bounds(cells) {
    var w = 0, hh = 0;
    cells.forEach(function (c) { w = Math.max(w, c[0] + 1); hh = Math.max(hh, c[1] + 1); });
    return [w, hh];
  }
  // Turn a shape `turns` quarter turns clockwise.
  function rotate(cells, turns) {
    var out = cells;
    for (var t = 0; t < (((turns || 0) % 4) + 4) % 4; t++) {
      var hh = bounds(out)[1];
      out = out.map(function (c) { return [hh - 1 - c[1], c[0]]; });
    }
    return normalize(out);
  }
  function hashString(str) {
    var hsh = 2166136261;
    for (var i = 0; i < str.length; i++) { hsh ^= str.charCodeAt(i); hsh = Math.imul(hsh, 16777619) >>> 0; }
    return hsh >>> 0;
  }
  function seededRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // A random connected shape of `n` tiles that fits in a box about
  // √n + 1 on a side. Tiles touching more of the shape are likelier, so
  // it comes out lumpy rather than stringy, like an inventory piece.
  function randomShape(n, seed) {
    var rnd = seededRng(seed), side = n <= 2 ? n : Math.ceil(Math.sqrt(n)) + 1;
    var have = { "0,0": true }, cells = [[0, 0]];
    function has(x, y) { return have[x + "," + y] === true; }
    while (cells.length < n) {
      var b0 = [Infinity, Infinity, -Infinity, -Infinity];
      cells.forEach(function (c) { b0 = [Math.min(b0[0], c[0]), Math.min(b0[1], c[1]), Math.max(b0[2], c[0]), Math.max(b0[3], c[1])]; });
      var cand = [], seen = {};
      cells.forEach(function (c) {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var x = c[0] + d[0], y = c[1] + d[1], key = x + "," + y;
          if (has(x, y) || seen[key]) return;
          seen[key] = true;
          if (Math.max(b0[2], x) - Math.min(b0[0], x) >= side || Math.max(b0[3], y) - Math.min(b0[1], y) >= side) return;
          var nb = (has(x + 1, y) ? 1 : 0) + (has(x - 1, y) ? 1 : 0) + (has(x, y + 1) ? 1 : 0) + (has(x, y - 1) ? 1 : 0);
          cand.push({ x: x, y: y, w: Math.pow(nb, 1.5) });
        });
      });
      cand.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
      var total = cand.reduce(function (acc, c) { return acc + c.w; }, 0), r = rnd() * total, pick = cand[cand.length - 1];
      for (var i = 0; i < cand.length; i++) { r -= cand[i].w; if (r < 0) { pick = cand[i]; break; } }
      have[pick.x + "," + pick.y] = true;
      cells.push([pick.x, pick.y]);
    }
    return normalize(cells);
  }
  // The largest rectangle of tiles inside a shape, { x, y, w, h } (ties go
  // to the wider one): where a plot's label fits.
  function innerRect(cells) {
    var fp = bounds(cells), has = {}, best = { x: cells[0][0], y: cells[0][1], w: 1, h: 1 };
    cells.forEach(function (c) { has[c[0] + "," + c[1]] = true; });
    for (var y0 = 0; y0 < fp[1]; y0++) for (var x0 = 0; x0 < fp[0]; x0++) {
      if (!has[x0 + "," + y0]) continue;
      for (var y1 = y0; y1 < fp[1] && has[x0 + "," + y1]; y1++) {
        for (var x1 = x0; x1 < fp[0]; x1++) {
          var ok = true;
          for (var y = y0; y <= y1 && ok; y++) if (!has[x1 + "," + y]) ok = false;
          if (!ok) break;
          var w = x1 - x0 + 1, hh = y1 - y0 + 1;
          if (w * hh > best.w * best.h || (w * hh === best.w * best.h && w > best.w)) best = { x: x0, y: y0, w: w, h: hh };
        }
      }
    }
    return best;
  }
  // A small SVG picture of a shape (a string, for build menus).
  function shapeSvg(cells, px) {
    px = px || 6;
    var fp = bounds(cells);
    return '<svg class="shape" width="' + fp[0] * px + '" height="' + fp[1] * px + '" viewBox="0 0 ' + fp[0] * px + " " + fp[1] * px +
      '" aria-hidden="true">' + cells.map(function (c) {
        return '<rect x="' + (c[0] * px + 0.5) + '" y="' + (c[1] * px + 0.5) + '" width="' + (px - 1) + '" height="' + (px - 1) + '" rx="1"/>';
      }).join("") + "</svg>";
  }
  // The plot a workshop design takes.
  function shapeFor(design) {
    return randomShape(tiles(design.qubits.length + design.checks.length), hashString(JSON.stringify(design)));
  }
  // Construction time in days for a habitat of this many qubits (data + ancilla).
  function buildDays(totalQubits) {
    var t = B.days;
    var d = t.refDays * Math.pow(Math.max(1, totalQubits) / t.refQubits, t.exponent);
    return Math.max(t.min, Math.min(t.max, Math.round(d)));
  }
  function price(design) {
    var q = design.qubits.length + design.checks.length, w = wireCount(design);
    return { cost: q * B.perQubit + w * B.perWire, upkeep: q * B.upkeepPerQubit + w * B.upkeepPerWire, days: buildDays(q) };
  }

  // ---------- analysis ----------
  // opts: { budget: distance-search work budget (default 2e6) }.
  // Returns { n, m, wires, ops, problems: [string] (each blocks building),
  //   notes: [string], clash: { a, b, qubits } | null, rank, redundant, k,
  //   d, dAtLeast, css, code: (code with computed logicals) | null,
  //   idle: [qubits in no check], valid, cells (its plot), tiles, footprint
  //   (bounding box [w, h]), cost, upkeep, days (to build) }.
  function analyze(design, opts) {
    opts = opts || {};
    var n = design.qubits.length, m = design.checks.length, ops = checkOps(design);
    var pr = price(design);
    var out = {
      n: n, m: m, wires: wireCount(design), ops: ops, problems: [], notes: [], clash: null,
      rank: 0, redundant: 0, k: 0, d: null, dAtLeast: null, css: false, code: null, idle: [],
      valid: false, cost: pr.cost, upkeep: pr.upkeep, days: pr.days
    };
    out.cells = shapeFor(design);
    out.tiles = out.cells.length;
    out.footprint = bounds(out.cells);
    if (!n) out.problems.push("Place some data qubits.");
    if (!m) out.problems.push("Add at least one check.");
    if (n > B.maxData) out.problems.push("At most " + B.maxData + " data qubits (this design has " + n + ").");
    if (m > B.maxChecks) out.problems.push("At most " + B.maxChecks + " checks (this design has " + m + ").");
    var empty = [];
    design.checks.forEach(function (c, i) { if (!c.wires.length) empty.push(checkLabel(i)); });
    if (empty.length) out.problems.push("Check" + (empty.length > 1 ? "s " : " ") + empty.join(", ") + (empty.length > 1 ? " have" : " has") + " no wires.");
    if (out.problems.length) return out;

    var touched = 0;
    ops.forEach(function (P) { touched |= P.x | P.z; });
    for (var q = 0; q < n; q++) if (!((touched >>> q) & 1)) out.idle.push(q);

    var a = S.analyzeChecks(n, ops, { budget: opts.budget || 2e6 });
    out.rank = a.rank; out.redundant = a.redundant; out.css = a.css;
    if (!a.commuting) {
      var P = ops[a.clash[0]], Q = ops[a.clash[1]];
      // Shared qubits where the two checks use different Paulis.
      var both = bits(((P.x | P.z) & (Q.x | Q.z)) >>> 0).filter(function (j) { return S.at(P, j) !== S.at(Q, j); });
      out.clash = { a: a.clash[0], b: a.clash[1], qubits: both };
      out.problems.push("Checks " + checkLabel(a.clash[0]) + " and " + checkLabel(a.clash[1]) + " anticommute: of the qubits they share, they use " +
        "different Paulis on " + (both.length === 1 ? "just qubit " : "an odd number (") + both.join(", ") + (both.length === 1 ? "" : ")") +
        ", so measuring one scrambles the other's outcome. Two checks may only differ on an even number of shared qubits.");
      return out;
    }
    out.k = a.k;
    if (!a.k) {
      out.problems.push("No room for an animal: the " + a.rank + " independent checks pin down all " + n +
        " qubits (k = 0). Remove a check, or add data qubits.");
      return out;
    }
    out.code = a.code; out.d = a.d; out.dAtLeast = a.dAtLeast;
    if (out.idle.length) {
      out.notes.push((out.idle.length === 1 ? "Qubit " : "Qubits ") + out.idle.join(", ") + (out.idle.length === 1 ? " isn't" : " aren't") +
        " in any check: errors there go unnoticed.");
    }
    if (a.redundant) {
      out.notes.push(a.redundant + " redundant check" + (a.redundant === 1 ? "" : "s") +
        " (a product of others): no new information about errors, but a second opinion against misreads.");
    }
    if (out.d === 1) out.notes.push("Distance 1: some single-qubit error is a logical error, so the animal gets sick about as often as a bare qubit.");
    else if (out.d === 2) out.notes.push("Distance 2: every single error is noticed, but some can't be told apart, so the keeper has to guess.");
    out.valid = true;
    return out;
  }

  // ---------- identification ----------
  // Single-qubit Pauli as a letter code: X = 1, Z = 2, Y = 3.
  function letter(P, q) { return ((P.x >>> q) & 1) | (((P.z >>> q) & 1) << 1); }
  // The six permutations of {X, Z, Y}: PERMS[p][c - 1] is the image of c.
  var PERMS = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
  var ALL = 63;
  // PW[a][b]: bitmask of the permutations sending letter a to letter b.
  var PW = [[], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  PERMS.forEach(function (p, i) { for (var c = 1; c <= 3; c++) PW[c][p[c - 1]] |= 1 << i; });

  // Elements of a code's stabilizer group by weight, up to maxW (cached).
  var groupCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function span(gens) {
    var out = [{ x: 0, z: 0 }];
    gens.forEach(function (g) {
      var len = out.length;
      for (var i = 0; i < len; i++) out.push({ x: (out[i].x ^ g.x) >>> 0, z: (out[i].z ^ g.z) >>> 0 });
    });
    return out;
  }
  function elementsByWeight(code, maxW) {
    var cached = groupCache && groupCache.get(code);
    if (cached && cached.maxW >= maxW) return cached.byW;
    var gens = code.stabilizers, byW = {}, i, j;
    function add(x, z) {
      var w = popcount((x | z) >>> 0);
      if (w <= maxW) (byW[w] = byW[w] || []).push({ n: code.n, x: x >>> 0, z: z >>> 0 });
    }
    var xs = gens.filter(function (g) { return g.z === 0; }), zs = gens.filter(function (g) { return g.x === 0; });
    if (xs.length + zs.length === gens.length) {
      // CSS generators: every element is (X part) × (Z part), and its
      // weight is at least each part's, so only light parts matter.
      if (xs.length > 16 || zs.length > 16) return null;
      var X = span(xs).filter(function (e) { return popcount(e.x) <= maxW; });
      var Zs = span(zs).filter(function (e) { return popcount(e.z) <= maxW; });
      if (X.length * Zs.length > 4e6) return null;
      for (i = 0; i < X.length; i++) for (j = 0; j < Zs.length; j++) add(X[i].x, Zs[j].z);
    } else {
      if (gens.length > 16) return null;
      span(gens).forEach(function (e) { add(e.x, e.z); });
    }
    if (groupCache) groupCache.set(code, { maxW: maxW, byW: byW });
    return byW;
  }

  // Is there a qubit relabelling π and per-qubit Pauli permutations σ
  // with σπ(G) = H (as stabilizer groups)? G and H are codes (their
  // stabilizers are independent generators). Backtracking: map each
  // generator of G in turn to an element of H of the same weight that
  // agrees with the qubits mapped so far; since the groups have the same
  // size, mapping every generator into H is enough. Returns
  // { perm: [player qubit -> species qubit], sigma: [permutation index] },
  // or null (also when the search budget runs out).
  function equivalence(G, H, budget) {
    var n = G.n;
    if (H.n !== n || H.stabilizers.length !== G.stabilizers.length) return null;
    if (G.logicalX.length !== H.logicalX.length) return null;
    var gens = G.stabilizers.slice();
    var maxW = Math.max.apply(null, gens.map(S.weight));
    var byW = elementsByWeight(H, maxW);
    if (!byW) return null;
    // Order: start with the generator with the fewest candidates; then
    // repeatedly take the one most overlapping what's already covered.
    var left = gens.map(function (g, i) { return i; }), order = [], covered = 0;
    while (left.length) {
      var best = -1, bestScore = -Infinity;
      left.forEach(function (i, li) {
        var g = gens[i], sup = (g.x | g.z) >>> 0;
        var score = covered ? popcount(sup & covered) * 1000 - popcount(sup & ~covered) : -((byW[S.weight(g)] || []).length);
        if (score > bestScore) { bestScore = score; best = li; }
      });
      var gi = left.splice(best, 1)[0];
      order.push(gi);
      covered |= gens[gi].x | gens[gi].z;
    }
    var pi = [], inv = [], sig = [], used = 0, nodes = 0;
    budget = budget || 2e5;
    for (var q = 0; q < n; q++) { pi.push(-1); inv.push(-1); sig.push(ALL); }

    function search(t) {
      if (++nodes > budget) throw "budget";
      if (t === order.length) return true;
      var g = gens[order[t]], gs = (g.x | g.z) >>> 0, cands = byW[popcount(gs)] || [];
      var gq = bits(gs), mapped = [], unmapped = [], imageMask = 0;
      gq.forEach(function (j) { if (pi[j] >= 0) { mapped.push(j); imageMask |= 1 << pi[j]; } else unmapped.push(j); });
      imageMask >>>= 0;
      for (var c = 0; c < cands.length; c++) {
        var h = cands[c], hs = (h.x | h.z) >>> 0;
        if (((hs & used) >>> 0) !== imageMask) continue;
        var ok = true, saved = [];
        for (var a = 0; a < mapped.length && ok; a++) {
          var j = mapped[a], allow = sig[j] & PW[letter(g, j)][letter(h, pi[j])];
          if (!allow) ok = false;
          else { saved.push([j, sig[j]]); sig[j] = allow; }
        }
        if (ok) {
          var free = bits((hs & ~used) >>> 0);
          if (free.length === unmapped.length && assign(0, unmapped, free, g, h, t)) return true;
        }
        for (var b2 = saved.length - 1; b2 >= 0; b2--) sig[saved[b2][0]] = saved[b2][1];
      }
      return false;
    }
    // Map player qubits unmapped[u..] onto the free species qubits.
    function assign(u, unmapped, free, g, h, t) {
      if (u === unmapped.length) return search(t + 1);
      var j = unmapped[u];
      for (var f = 0; f < free.length; f++) {
        var s = free[f];
        if (inv[s] >= 0) continue;
        var allow = ALL & PW[letter(g, j)][letter(h, s)];
        if (!allow) continue;
        pi[j] = s; inv[s] = j; sig[j] = allow; used = (used | (1 << s)) >>> 0;
        if (assign(u + 1, unmapped, free, g, h, t)) return true;
        pi[j] = -1; inv[s] = -1; sig[j] = ALL; used = (used & ~(1 << s)) >>> 0;
      }
      return false;
    }
    var found;
    try { found = search(0); } catch (e) { if (e === "budget") return null; throw e; }
    if (!found) return null;
    // Qubits in no generator (idle in both codes) pair up arbitrarily.
    var spare = [];
    for (q = 0; q < n; q++) if (inv[q] < 0) spare.push(q);
    for (q = 0; q < n; q++) if (pi[q] < 0) { pi[q] = spare.shift(); inv[pi[q]] = q; }
    return { perm: pi, sigma: sig.map(function (m) { for (var i = 0; i < 6; i++) if ((m >>> i) & 1) return i; return 0; }) };
  }
  // Apply an equivalence to a Pauli of the first code.
  function mapPauli(P, eq) {
    var x = 0, z = 0;
    for (var q = 0; q < P.n; q++) {
      var c = letter(P, q);
      if (!c) continue;
      var img = PERMS[eq.sigma[q]][c - 1], s = eq.perm[q];
      if (img & 1) x |= 1 << s;
      if (img & 2) z |= 1 << s;
    }
    return { n: P.n, x: x >>> 0, z: z >>> 0 };
  }
  // candidates: [{ id, code }]. Returns { id, eq } for the first one the
  // code is equivalent to, or null.
  function identify(code, candidates, opts) {
    opts = opts || {};
    if (!code) return null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var eq = equivalence(code, c.code, opts.budget);
      if (eq) return { id: c.id, eq: eq };
    }
    return null;
  }
  // The textbook species as identify() candidates.
  function textbook() {
    return Object.keys(Z.SPECIES).map(function (id) { return { id: id, code: Z.SPECIES[id].code }; });
  }

  // ---------- species that aren't in the catalogue ----------
  function customAppeal(d) {
    var t = Z.CUSTOM.appealByDistance;
    if (!d || d < 1) return t[1];
    return d < t.length ? t[d] : t[t.length - 1] + 40 * (d - t.length + 1);
  }
  function customCost(d) { return Math.round(customAppeal(d) * Z.CUSTOM.costPerAppeal / 5000) * 5000; }

  var Habitat = {
    checkLabel: checkLabel, emptyDesign: emptyDesign, clone: clone, checkOp: checkOp, checkOps: checkOps,
    wireCount: wireCount, fromCode: fromCode, designFor: designFor, malformed: malformed,
    tiles: tiles, normalize: normalize, bounds: bounds, rotate: rotate, randomShape: randomShape, shapeFor: shapeFor, innerRect: innerRect, shapeSvg: shapeSvg,
    hashString: hashString, price: price, buildDays: buildDays, analyze: analyze,
    equivalence: equivalence, mapPauli: mapPauli, identify: identify, textbook: textbook,
    customAppeal: customAppeal, customCost: customCost
  };
  if (isNode) module.exports = Habitat;
  else root.Habitat = Habitat;
})(typeof window !== "undefined" ? window : this);

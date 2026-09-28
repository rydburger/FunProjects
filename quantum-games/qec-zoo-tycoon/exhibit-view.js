// =========================================================
// Error Correction Zoo Tycoon — exhibit drawing.
//
// Draws a code's qubits and checks into an <svg>, in one of two modes:
//   "god"    — what's really there: the Pauli error on every qubit
//   "keeper" — what the keeper sees: which checks fired
// Both modes can ring the keeper's correction. Styling lives in
// zoo.css (svg .qubit, .chk, .ring, ...).
//
// Browser only: load after ../stabilizer.js and zoo-data.js; exposes
// `window.ExhibitView`.
// =========================================================
(function (root) {
  var S = root.Stabilizer, Z = root.ZooData;
  var UNIT = 80, PAD = 34;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ERR_COLOR = { X: "var(--err-x)", Y: "var(--err-y)", Z: "var(--err-z)" };
  var CHECK_COLOR = { x: "var(--check-x)", z: "var(--check-z)", mix: "var(--check-mix)" };

  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function checkType(P) { return P.z === 0 ? "x" : P.x === 0 ? "z" : "mix"; }

  // "X3 Z5" style description of a Pauli ("nothing" for the identity).
  function describe(P) {
    var parts = [];
    for (var q = 0; q < P.n; q++) { var a = S.at(P, q); if (a !== "I") parts.push(a + q); }
    return parts.length ? parts.join(" ") : "nothing";
  }

  // Pixel layout for a species: qubits from its layout, checks at the
  // centroid of their support (nudged so they stay legible). Cached.
  var layoutCache = {};
  function layout(speciesId) {
    if (layoutCache[speciesId]) return layoutCache[speciesId];
    var sp = Z.SPECIES[speciesId], code = sp.code;
    var qs = sp.layout.map(function (xy) { return { x: xy[0], y: xy[1] }; });
    var cx = 0, cy = 0;
    qs.forEach(function (q) { cx += q.x; cy += q.y; });
    cx /= qs.length; cy /= qs.length;
    // Draw the code's own generators: syndrome bits index into these.
    var checks = code.stabilizers.map(function (P) {
      var support = [];
      for (var q = 0; q < code.n; q++) if (S.at(P, q) !== "I") support.push(q);
      var x = 0, y = 0;
      support.forEach(function (q) { x += qs[q].x; y += qs[q].y; });
      x /= support.length; y /= support.length;
      if (sp.checkSpread) { x = cx + (x - cx) * sp.checkSpread; y = cy + (y - cy) * sp.checkSpread; }
      if (support.length === 2) {
        // Nudge weight-2 checks off the line joining their qubits, away
        // from the middle of the layout (upwards if ambiguous).
        var a = qs[support[0]], b = qs[support[1]];
        var nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        var side = (x - cx) * nx + (y - cy) * ny;
        if (Math.abs(side) < 1e-9) side = -ny || -1;
        var sgn = side >= 0 ? 1 : -1;
        x += 0.32 * sgn * nx; y += 0.32 * sgn * ny;
      }
      return { x: x, y: y, type: checkType(P), support: support };
    });
    // Separate checks that land on the same spot (e.g. Steane's X/Z pairs).
    for (var i = 0; i < checks.length; i++) {
      for (var j = i + 1; j < checks.length; j++) {
        if (Math.hypot(checks[i].x - checks[j].x, checks[i].y - checks[j].y) < 0.12) {
          checks[i].x -= 0.13; checks[j].x += 0.13;
        }
      }
    }
    var xs = qs.map(function (q) { return q.x; }).concat(checks.map(function (c) { return c.x; }));
    var ys = qs.map(function (q) { return q.y; }).concat(checks.map(function (c) { return c.y; }));
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    function px(v, min) { return PAD + (v - min) * UNIT; }
    layoutCache[speciesId] = {
      qubits: qs.map(function (q) { return { x: px(q.x, minX), y: px(q.y, minY) }; }),
      checks: checks.map(function (c) { return { x: px(c.x, minX), y: px(c.y, minY), type: c.type, support: c.support }; }),
      width: 2 * PAD + (Math.max.apply(null, xs) - minX) * UNIT,
      height: 2 * PAD + (Math.max.apply(null, ys) - minY) * UNIT
    };
    return layoutCache[speciesId];
  }

  // view: { errors: Pauli, pulse: Pauli|null (just landed), syndrome: int|null,
  //         correction: Pauli|null, keeper: bool }
  function draw(svg, speciesId, view, mode) {
    var d = layout(speciesId);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + d.width + " " + d.height);
    var syn = view.syndrome;
    var showSyn = mode === "keeper" && view.keeper && syn !== null && syn !== undefined;
    d.checks.forEach(function (c, i) {
      var lit = showSyn && ((syn >>> i) & 1);
      c.support.forEach(function (q) {
        var Q = d.qubits[q];
        el("line", { x1: c.x, y1: c.y, x2: Q.x, y2: Q.y, "class": "edge" + (lit ? " lit" : "") }, svg);
      });
    });
    d.checks.forEach(function (c, i) {
      var lit = showSyn && ((syn >>> i) & 1);
      var cls = "chk" + (lit ? " lit" : "") + (mode === "god" || !view.keeper ? " dim" : "");
      el("rect", { x: c.x - 8, y: c.y - 8, width: 16, height: 16, rx: 3, "class": cls,
        fill: "var(--bg-panel)", stroke: CHECK_COLOR[c.type] }, svg);
    });
    var corr = view.correction && !S.isIdentity(view.correction) ? view.correction : null;
    d.qubits.forEach(function (Q, q) {
      var letter = mode === "god" && view.errors ? S.at(view.errors, q) : "I";
      var circ = el("circle", { cx: Q.x, cy: Q.y, r: 14, "class": "qubit" }, svg);
      if (letter !== "I") {
        // Inline style, not attributes: the .qubit class would override those.
        circ.style.fill = ERR_COLOR[letter]; circ.style.stroke = ERR_COLOR[letter];
        var t = el("text", { x: Q.x, y: Q.y + 5, "text-anchor": "middle", "class": "qletter" }, svg);
        t.textContent = letter;
      }
      var lab = el("text", { x: Q.x + 16, y: Q.y - 13, "class": "qlabel" }, svg);
      lab.textContent = q;
      if (mode === "god" && view.pulse && S.at(view.pulse, q) !== "I") {
        el("circle", { cx: Q.x, cy: Q.y, r: 14, "class": "pulse", stroke: ERR_COLOR[S.at(view.pulse, q)] }, svg);
      }
      if (corr && S.at(corr, q) !== "I") {
        el("circle", { cx: Q.x, cy: Q.y, r: 19, "class": "ring" }, svg);
        if (mode === "keeper") {
          var ct = el("text", { x: Q.x, y: Q.y + 5, "text-anchor": "middle", "class": "qletter fix" }, svg);
          ct.textContent = S.at(corr, q);
        }
      }
    });
  }

  root.ExhibitView = { layout: layout, draw: draw, describe: describe };
})(window);

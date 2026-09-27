// =========================================================
// Shared quantum circuit engine for quantum-games.
//
// Three standalone, reusable JS namespaces exposed on `window`,
// with no knowledge of any particular game:
//   - QEngine        n-qubit noiseless statevector simulator
//   - CircuitCanvas  pixel-positioned circuit diagram rendering
//   - CircuitEditor  drag/tap gate-placement UI + validation
//
// Load this file with a <script src="../engine.js"></script> (or the
// appropriate relative path) before a game's own <script> tag, which
// can then use QEngine / CircuitCanvas / CircuitEditor directly.
// =========================================================
(function () {
  // =========================================================
  // QEngine — noiseless statevector simulator, standalone & reusable.
  // Float64Array-based, generalized to n qubits (Quirk-style
  // amplitude-pair gate application, no dense matrices). Call
  // QEngine.* from any game that loads this file.
  // =========================================================
  var QEngine = (function () {
    function bitOf(i, q, n) { return (i >> (n - 1 - q)) & 1; }
    function withBit(i, q, val, n) {
      var mask = 1 << (n - 1 - q);
      return val ? (i | mask) : (i & ~mask);
    }
    function makeState(n) {
      var dim = 1 << n;
      var re = new Float64Array(dim), im = new Float64Array(dim);
      re[0] = 1;
      return { n: n, dim: dim, re: re, im: im };
    }
    function cloneState(s) {
      return { n: s.n, dim: s.dim, re: s.re.slice(), im: s.im.slice() };
    }
    function applySingleQubitGate(s, M, q) {
      var n = s.n, dim = s.dim;
      var newRe = new Float64Array(dim), newIm = new Float64Array(dim);
      var seen = new Uint8Array(dim);
      for (var i = 0; i < dim; i++) {
        if (seen[i]) continue;
        var i0 = withBit(i, q, 0, n), i1 = withBit(i, q, 1, n);
        seen[i0] = 1; seen[i1] = 1;
        var re0 = s.re[i0], im0 = s.im[i0], re1 = s.re[i1], im1 = s.im[i1];
        newRe[i0] = M.a[0] * re0 - M.a[1] * im0 + M.b[0] * re1 - M.b[1] * im1;
        newIm[i0] = M.a[0] * im0 + M.a[1] * re0 + M.b[0] * im1 + M.b[1] * re1;
        newRe[i1] = M.c[0] * re0 - M.c[1] * im0 + M.d[0] * re1 - M.d[1] * im1;
        newIm[i1] = M.c[0] * im0 + M.c[1] * re0 + M.d[0] * im1 + M.d[1] * re1;
      }
      s.re = newRe; s.im = newIm;
    }
    function applyCNOT(s, c, t) {
      var n = s.n, dim = s.dim;
      var newRe = new Float64Array(dim), newIm = new Float64Array(dim);
      for (var i = 0; i < dim; i++) {
        var j = i;
        if (bitOf(i, c, n) === 1) j = withBit(i, t, 1 - bitOf(i, t, n), n);
        newRe[j] = s.re[i]; newIm[j] = s.im[i];
      }
      s.re = newRe; s.im = newIm;
    }
    function applyCZ(s, q1, q2) {
      var n = s.n, dim = s.dim;
      for (var i = 0; i < dim; i++) {
        if (bitOf(i, q1, n) === 1 && bitOf(i, q2, n) === 1) { s.re[i] = -s.re[i]; s.im[i] = -s.im[i]; }
      }
    }
    // Apply an arbitrary single-qubit unitary M to `target`, conditioned on
    // ALL wires in `controls` being |1>. Generalizes CNOT (M=X, 1 control),
    // CZ (M=Z), and multi-control gates like Toffoli (2 controls) to any
    // gate — this is what lets any palette gate act as a control's target,
    // and lets +Control modifiers stack.
    function applyControlledGate(s, M, controls, target) {
      var n = s.n, dim = s.dim;
      var newRe = s.re.slice(), newIm = s.im.slice();
      var seen = new Uint8Array(dim);
      for (var i = 0; i < dim; i++) {
        if (seen[i]) continue;
        var i0 = withBit(i, target, 0, n), i1 = withBit(i, target, 1, n);
        seen[i0] = 1; seen[i1] = 1;
        var allOn = true;
        for (var ci = 0; ci < controls.length; ci++) if (bitOf(i0, controls[ci], n) !== 1) { allOn = false; break; }
        if (!allOn) continue;
        var re0 = s.re[i0], im0 = s.im[i0], re1 = s.re[i1], im1 = s.im[i1];
        newRe[i0] = M.a[0] * re0 - M.a[1] * im0 + M.b[0] * re1 - M.b[1] * im1;
        newIm[i0] = M.a[0] * im0 + M.a[1] * re0 + M.b[0] * im1 + M.b[1] * re1;
        newRe[i1] = M.c[0] * re0 - M.c[1] * im0 + M.d[0] * re1 - M.d[1] * im1;
        newIm[i1] = M.c[0] * im0 + M.c[1] * re0 + M.d[0] * im1 + M.d[1] * re1;
      }
      s.re = newRe; s.im = newIm;
    }
    // Swap two qubits' amplitudes outright (SWAP gate).
    function applySwap(s, q1, q2) {
      var n = s.n, dim = s.dim;
      var newRe = new Float64Array(dim), newIm = new Float64Array(dim);
      for (var i = 0; i < dim; i++) {
        var b1 = bitOf(i, q1, n), b2 = bitOf(i, q2, n);
        var j = i;
        if (b1 !== b2) j = withBit(withBit(i, q1, b2, n), q2, b1, n);
        newRe[j] = s.re[i]; newIm[j] = s.im[i];
      }
      s.re = newRe; s.im = newIm;
    }
    // SWAP conditioned on all `controls` being |1> (Fredkin gate when 1 control).
    function applyControlledSwap(s, controls, q1, q2) {
      var n = s.n, dim = s.dim;
      var newRe = new Float64Array(dim), newIm = new Float64Array(dim);
      for (var i = 0; i < dim; i++) {
        var allOn = true;
        for (var ci = 0; ci < controls.length; ci++) if (bitOf(i, controls[ci], n) !== 1) { allOn = false; break; }
        var j = i;
        if (allOn) {
          var b1 = bitOf(i, q1, n), b2 = bitOf(i, q2, n);
          if (b1 !== b2) j = withBit(withBit(i, q1, b2, n), q2, b1, n);
        }
        newRe[j] = s.re[i]; newIm[j] = s.im[i];
      }
      s.re = newRe; s.im = newIm;
    }
    // Conjugate-transpose of a 2x2 unitary — powers the Adjoint(†) modifier
    // without needing a hardcoded inverse matrix for every gate.
    function adjointMatrix(M) {
      function conj(z) { return [z[0], -z[1]]; }
      return { a: conj(M.a), b: conj(M.c), c: conj(M.b), d: conj(M.d) };
    }
    // Bloch-sphere rotations (standard convention, theta/2 in the exponent).
    function rx(theta) {
      var c = Math.cos(theta / 2), s2 = Math.sin(theta / 2);
      return { a: [c, 0], b: [0, -s2], c: [0, -s2], d: [c, 0] };
    }
    function ry(theta) {
      var c = Math.cos(theta / 2), s2 = Math.sin(theta / 2);
      return { a: [c, 0], b: [-s2, 0], c: [s2, 0], d: [c, 0] };
    }
    function rz(theta) {
      return { a: [Math.cos(-theta / 2), Math.sin(-theta / 2)], b: [0, 0], c: [0, 0], d: [Math.cos(theta / 2), Math.sin(theta / 2)] };
    }
    // QFT-style phase gate: diag(1, e^{i*theta}) — no /2, so Phase(pi/2)=S exactly.
    function phaseGate(theta) {
      return { a: [1, 0], b: [0, 0], c: [0, 0], d: [Math.cos(theta), Math.sin(theta)] };
    }
    function resolveMatrix(gate, adjoint, theta, axis) {
      var M;
      if (gate === "R") M = axis === "X" ? rx(theta) : axis === "Y" ? ry(theta) : rz(theta);
      else if (gate === "CP") M = phaseGate(theta);
      else M = GATE_MATRICES[gate];
      return adjoint ? adjointMatrix(M) : M;
    }
    // |<s1|s2>|^2 — fidelity between two equal-dimension pure states. Used
    // to accept any circuit whose output state matches the canonical
    // circuit's, not just gate-for-gate identical ones (global phase is
    // physically unobservable, so it's correctly ignored here).
    function overlap(s1, s2) {
      var reSum = 0, imSum = 0;
      for (var i = 0; i < s1.dim; i++) {
        reSum += s1.re[i] * s2.re[i] + s1.im[i] * s2.im[i];
        imSum += s1.re[i] * s2.im[i] - s1.im[i] * s2.re[i];
      }
      return reSum * reSum + imSum * imSum;
    }
    function marginalProbs(s, qubits) {
      var n = s.n, dim = s.dim, k = qubits.length, outDim = 1 << k;
      var probs = new Float64Array(outDim);
      for (var i = 0; i < dim; i++) {
        var idx = 0;
        for (var b = 0; b < k; b++) idx = (idx << 1) | bitOf(i, qubits[b], n);
        probs[idx] += s.re[i] * s.re[i] + s.im[i] * s.im[i];
      }
      return probs;
    }
    function sampleIndex(probs) {
      var r = Math.random(), acc = 0;
      for (var i = 0; i < probs.length; i++) { acc += probs[i]; if (r < acc) return i; }
      return probs.length - 1;
    }
    function collapseTo(s, qubits, bits) {
      var n = s.n, dim = s.dim, p = 0;
      for (var i = 0; i < dim; i++) {
        var match = true;
        for (var b = 0; b < qubits.length; b++) if (bitOf(i, qubits[b], n) !== bits[b]) { match = false; break; }
        if (match) p += s.re[i] * s.re[i] + s.im[i] * s.im[i];
      }
      var norm = 1 / Math.sqrt(p);
      for (var j = 0; j < dim; j++) {
        var match2 = true;
        for (var b2 = 0; b2 < qubits.length; b2++) if (bitOf(j, qubits[b2], n) !== bits[b2]) { match2 = false; break; }
        if (match2) { s.re[j] *= norm; s.im[j] *= norm; } else { s.re[j] = 0; s.im[j] = 0; }
      }
    }
    function partialMeasureAndCollapse(s, qubits) {
      var probs = marginalProbs(s, qubits);
      var idx = sampleIndex(probs);
      var bits = [];
      for (var b = 0; b < qubits.length; b++) bits.push((idx >> (qubits.length - 1 - b)) & 1);
      collapseTo(s, qubits, bits);
      return bits;
    }

    var SQRT1_2 = 1 / Math.sqrt(2);
    var GATE_MATRICES = {
      H: { a: [SQRT1_2, 0], b: [SQRT1_2, 0], c: [SQRT1_2, 0], d: [-SQRT1_2, 0] },
      X: { a: [0, 0], b: [1, 0], c: [1, 0], d: [0, 0] },
      Y: { a: [0, 0], b: [0, -1], c: [0, 1], d: [0, 0] },
      Z: { a: [1, 0], b: [0, 0], c: [0, 0], d: [-1, 0] },
      S: { a: [1, 0], b: [0, 0], c: [0, 0], d: [0, 1] },
      Sdg: { a: [1, 0], b: [0, 0], c: [0, 0], d: [0, -1] },
      T: { a: [1, 0], b: [0, 0], c: [0, 0], d: [SQRT1_2, SQRT1_2] },
      Tdg: { a: [1, 0], b: [0, 0], c: [0, 0], d: [SQRT1_2, -SQRT1_2] },
      // "Quarter turns" — square roots of X and Y and their inverses.
      SX: { a: [0.5, 0.5], b: [0.5, -0.5], c: [0.5, -0.5], d: [0.5, 0.5] },
      SXdg: { a: [0.5, -0.5], b: [0.5, 0.5], c: [0.5, 0.5], d: [0.5, -0.5] },
      SY: { a: [0.5, 0.5], b: [-0.5, -0.5], c: [0.5, 0.5], d: [0.5, 0.5] },
      SYdg: { a: [0.5, -0.5], b: [0.5, -0.5], c: [-0.5, 0.5], d: [0.5, -0.5] }
    };

    // Apply a resolved gate through a qubitMap (local wire -> global qubit).
    // g.role: 'single' (plain 1-qubit gate), 'controlled' (1+ controls acting
    // on a single-qubit gate at target — CNOT/CZ/CP/Toffoli all reduce to
    // this), 'swap', 'cswap' (Fredkin-style controlled swap), or 'measure'
    // (no unitary effect here — mid-circuit measurement/feed-forward is a
    // documented future extension, not wired up yet).
    function applyGate(s, g, qubitMap) {
      if (g.role === "controlled") {
        var M = resolveMatrix(g.gate, g.adjoint, g.theta, g.axis);
        var controls = g.controls.map(function (w) { return qubitMap[w]; });
        applyControlledGate(s, M, controls, qubitMap[g.target]);
      } else if (g.role === "single") {
        var M2 = resolveMatrix(g.gate, g.adjoint, g.theta, g.axis);
        applySingleQubitGate(s, M2, qubitMap[g.wire]);
      } else if (g.role === "swap") {
        applySwap(s, qubitMap[g.wireA], qubitMap[g.wireB]);
      } else if (g.role === "cswap") {
        var controls2 = g.controls.map(function (w) { return qubitMap[w]; });
        applyControlledSwap(s, controls2, qubitMap[g.wireA], qubitMap[g.wireB]);
      }
    }

    return {
      makeState: makeState, cloneState: cloneState,
      applySingleQubitGate: applySingleQubitGate, applyCNOT: applyCNOT, applyCZ: applyCZ,
      applyControlledGate: applyControlledGate, applySwap: applySwap, applyControlledSwap: applyControlledSwap,
      adjointMatrix: adjointMatrix, rx: rx, ry: ry, rz: rz, phase: phaseGate, resolveMatrix: resolveMatrix,
      marginalProbs: marginalProbs, overlap: overlap, sampleIndex: sampleIndex, collapseTo: collapseTo,
      partialMeasureAndCollapse: partialMeasureAndCollapse, applyGate: applyGate,
      GATE_MATRICES: GATE_MATRICES
    };
  })();

  // =========================================================
  // CircuitCanvas — pixel-positioned circuit diagram rendering,
  // standalone & reusable. Explicit pixel math (not CSS-grid
  // absolute positioning, which misplaced connector lines across
  // browsers). Works for any wireLabels/gateSteps.
  // =========================================================
  var CircuitCanvas = (function () {
    function initCanvas(container, nWires, nCols, rowH, colW, labelW, wireLabels) {
      var width = labelW + nCols * colW;
      var height = nWires * rowH;
      container.style.position = "relative";
      container.style.width = width + "px";
      container.style.height = height + "px";
      container.innerHTML = "";
      for (var w = 0; w < nWires; w++) {
        var lbl = document.createElement("div");
        lbl.className = "qc-wire-label";
        lbl.style.left = "0px";
        lbl.style.top = (w * rowH) + "px";
        lbl.style.width = labelW + "px";
        lbl.style.height = rowH + "px";
        lbl.textContent = wireLabels[w];
        container.appendChild(lbl);

        var line = document.createElement("div");
        line.className = "qc-wire-line";
        line.style.left = labelW + "px";
        line.style.top = (w * rowH + rowH / 2) + "px";
        line.style.width = (nCols * colW) + "px";
        container.appendChild(line);
      }
      return {
        width: width, height: height, rowH: rowH, colW: colW, labelW: labelW,
        posFor: function (col, wire) { return { x: labelW + col * colW + colW / 2, y: wire * rowH + rowH / 2 }; }
      };
    }

    // Internal type keys (used for matching/logic) aren't always the
    // nicest thing to print in a small box — map the standard set to
    // their short display glyphs; anything unrecognized just prints
    // its own key, so custom gate types from other games still work.
    var GLYPH_TEXT = { Sdg: "S†", Tdg: "T†", SX: "√X", SXdg: "√X†", SY: "√Y", SYdg: "√Y†" };
    // kind: 'ctrl' (control dot), 'target' (⊕ ring), 'swap' (× mark, no box),
    // or anything else (boxed text — defaults to GLYPH_TEXT[kind]||kind,
    // override with an explicit `text`).
    function makeGateGlyph(kind, extraClass, text) {
      var el = document.createElement("div");
      if (kind === "ctrl") el.className = "qc-dot" + (extraClass ? " " + extraClass : "");
      else if (kind === "target") el.className = "qc-target" + (extraClass ? " " + extraClass : "");
      else if (kind === "swap") {
        el.className = "qc-swapx" + (extraClass ? " " + extraClass : "");
        el.textContent = "×";
      } else {
        el.className = "qc-box" + (extraClass ? " " + extraClass : "");
        el.textContent = text != null ? text : (GLYPH_TEXT[kind] || kind);
      }
      return el;
    }
    function placeAtPixel(el, x, y) { el.style.left = x + "px"; el.style.top = y + "px"; }
    function makeConnector(x, yTop, yBot, extraClass) {
      var el = document.createElement("div");
      el.className = "qc-connector" + (extraClass ? " " + extraClass : "");
      el.style.left = x + "px";
      el.style.top = yTop + "px";
      el.style.height = (yBot - yTop) + "px";
      el.style.transform = "translateX(-1px)";
      return el;
    }

    function gateLabel(g) {
      var base = g.gate === "R" ? "R" + (g.axis || "Z").toLowerCase() : g.gate === "CP" ? "P" : g.gate;
      return base + (g.adjoint ? "†" : "");
    }
    // gateSteps use the same shape as CircuitEditor's resolved gates:
    // {role:'single', gate, wire, col}, {role:'controlled', controls:[...],
    // target, gate, adjoint, col} (any number of controls — 2+ renders as a
    // Toffoli-style multi-dot gate; gate:'X' with no adjoint renders as the
    // classic ⊕ target ring), {role:'swap'|'cswap', controls, wireA, wireB, col}.
    function renderStatic(containerId, wireLabels, gateSteps) {
      var container = document.getElementById(containerId);
      var cols = gateSteps.map(function (g) { return g.col; });
      var nCols = Math.max.apply(null, cols.concat([-1])) + 2;
      var canvas = initCanvas(container, wireLabels.length, Math.max(nCols, 1), 44, 52, 40, wireLabels);
      gateSteps.forEach(function (g) {
        var colIdx = g.col;
        if (g.role === "controlled") {
          var wires = g.controls.concat([g.target]);
          var top = Math.min.apply(null, wires), bot = Math.max.apply(null, wires);
          var pTop = canvas.posFor(colIdx, top), pBot = canvas.posFor(colIdx, bot);
          container.appendChild(makeConnector(pTop.x, pTop.y, pBot.y));
          g.controls.forEach(function (cw) {
            var pCtrl = canvas.posFor(colIdx, cw);
            var dot = makeGateGlyph("ctrl"); placeAtPixel(dot, pCtrl.x, pCtrl.y); container.appendChild(dot);
          });
          var pTgt = canvas.posFor(colIdx, g.target);
          var isX = g.gate === "X" && !g.adjoint;
          var tgtGlyph = makeGateGlyph(isX ? "target" : "box", null, isX ? null : gateLabel(g));
          placeAtPixel(tgtGlyph, pTgt.x, pTgt.y); container.appendChild(tgtGlyph);
        } else if (g.role === "swap" || g.role === "cswap") {
          var swWires = (g.controls || []).concat([g.wireA, g.wireB]);
          var swTop = Math.min.apply(null, swWires), swBot = Math.max.apply(null, swWires);
          var pSwTop = canvas.posFor(colIdx, swTop), pSwBot = canvas.posFor(colIdx, swBot);
          container.appendChild(makeConnector(pSwTop.x, pSwTop.y, pSwBot.y));
          (g.controls || []).forEach(function (cw) {
            var pCtrl2 = canvas.posFor(colIdx, cw);
            var dot2 = makeGateGlyph("ctrl"); placeAtPixel(dot2, pCtrl2.x, pCtrl2.y); container.appendChild(dot2);
          });
          [g.wireA, g.wireB].forEach(function (ww) {
            var pW = canvas.posFor(colIdx, ww);
            var x = makeGateGlyph("swap"); placeAtPixel(x, pW.x, pW.y); container.appendChild(x);
          });
        } else {
          var p = canvas.posFor(colIdx, g.wire);
          var box = makeGateGlyph("box", null, gateLabel(g)); placeAtPixel(box, p.x, p.y); container.appendChild(box);
        }
      });
      return canvas;
    }

    return { init: initCanvas, makeGateGlyph: makeGateGlyph, placeAtPixel: placeAtPixel, makeConnector: makeConnector, renderStatic: renderStatic };
  })();

  // =========================================================
  // CircuitEditor — drag-and-drop / tap-to-place gate builder,
  // standalone & reusable. Game code supplies wireLabels,
  // canonical target, gate palette, colorClass, and an onChange
  // callback; CircuitEditor knows nothing about "Alice"/"Bob"/
  // magic squares specifically.
  // =========================================================
  var CircuitEditor = (function () {
    function key(col, wire) { return col + "," + wire; }
    // Cells now hold rich objects, not plain strings:
    //   {role:'ctrl'}
    //   {role:'gate', gate, adjoint, theta?, axis?}   (single-qubit gate tile)
    //   {role:'swap'}
    //   {role:'measure'}
    // A column's stacked 'ctrl' cells plus its lone 'gate' cell fuse into
    // one controlled-<gate> operation (CNOT is ctrl+X, CZ is ctrl+Z, two
    // ctrls on X is a Toffoli, ...); two 'swap' cells (plus any ctrls)
    // fuse into a swap/Fredkin. There's no separate "target" tile — any
    // gate tile can be a control's target.
    function gateSignature(g) {
      if (g.role === "controlled") return "C[" + g.controls.slice().sort(function (a, b) { return a - b; }).join(",") + "]>" + g.target + ":" + g.gate + (g.adjoint ? "†" : "");
      if (g.role === "single") return g.gate + (g.adjoint ? "†" : "") + ":" + g.wire;
      if (g.role === "swap") return "SWAP:" + Math.min(g.wireA, g.wireB) + "-" + Math.max(g.wireA, g.wireB);
      if (g.role === "cswap") return "CSWAP[" + g.controls.slice().sort(function (a, b) { return a - b; }).join(",") + "]:" + Math.min(g.wireA, g.wireB) + "-" + Math.max(g.wireA, g.wireB);
      return "M:" + g.wire;
    }
    function gateWires(g) {
      if (g.role === "controlled") return g.controls.concat([g.target]);
      if (g.role === "single") return [g.wire];
      if (g.role === "swap") return [g.wireA, g.wireB];
      if (g.role === "cswap") return g.controls.concat([g.wireA, g.wireB]);
      return [g.wire];
    }
    // Per-column counts used to keep the fused-cell rules unambiguous.
    function columnCounts(ed, col) {
      var ctrl = 0, gate = 0, swap = 0, measure = 0;
      for (var w = 0; w < ed.nWires; w++) {
        var c = ed.cells[key(col, w)];
        if (!c) continue;
        if (c.role === "ctrl") ctrl++;
        else if (c.role === "gate") gate++;
        else if (c.role === "swap") swap++;
        else if (c.role === "measure") measure++;
      }
      return { ctrl: ctrl, gate: gate, swap: swap, measure: measure };
    }
    function resolve(ed) {
      var byCol = {};
      Object.keys(ed.cells).forEach(function (k) {
        var parts = k.split(","), col = +parts[0], wire = +parts[1];
        (byCol[col] = byCol[col] || []).push({ wire: wire, cell: ed.cells[k] });
      });
      var gates = [], incomplete = [];
      Object.keys(byCol).forEach(function (colStr) {
        var col = +colStr;
        var items = byCol[col];
        var ctrlItems = items.filter(function (it) { return it.cell.role === "ctrl"; });
        var gateItems = items.filter(function (it) { return it.cell.role === "gate"; });
        var swapItems = items.filter(function (it) { return it.cell.role === "swap"; });
        var measureItems = items.filter(function (it) { return it.cell.role === "measure"; });
        var controls = ctrlItems.map(function (it) { return it.wire; });
        if (measureItems.length > 0) {
          if (measureItems.length === items.length) {
            measureItems.forEach(function (it) { gates.push({ role: "measure", wire: it.wire, col: col }); });
          } else {
            items.forEach(function (it) { incomplete.push({ wire: it.wire, col: col }); });
          }
        } else if (swapItems.length === 2 && gateItems.length === 0) {
          gates.push({
            role: controls.length ? "cswap" : "swap",
            controls: controls, wireA: swapItems[0].wire, wireB: swapItems[1].wire, col: col
          });
        } else if (swapItems.length === 0 && controls.length === 0) {
          // No control present: every gate tile in the column is its own
          // independent single-qubit operation — any number may coexist.
          gateItems.forEach(function (it) {
            var gc = it.cell;
            gates.push({ role: "single", target: it.wire, wire: it.wire, gate: gc.gate, adjoint: !!gc.adjoint, theta: gc.theta, axis: gc.axis, col: col });
          });
        } else if (swapItems.length === 0 && controls.length > 0 && gateItems.length === 1) {
          var gc2 = gateItems[0].cell;
          gates.push({
            role: "controlled", controls: controls, target: gateItems[0].wire, wire: gateItems[0].wire,
            gate: gc2.gate, adjoint: !!gc2.adjoint, theta: gc2.theta, axis: gc2.axis, col: col
          });
        } else {
          items.forEach(function (it) { incomplete.push({ wire: it.wire, col: col }); });
        }
      });
      return { gates: gates, incomplete: incomplete };
    }
    function structuralMatch(ed, r) {
      var canon = ed.canonical;
      if (r.gates.length !== canon.length) return false;
      var canonSigs = canon.map(gateSignature).slice().sort();
      var playerSigs = r.gates.map(gateSignature).slice().sort();
      for (var i = 0; i < canonSigs.length; i++) if (canonSigs[i] !== playerSigs[i]) return false;
      var playerColBySig = {};
      r.gates.forEach(function (g) { playerColBySig[gateSignature(g)] = g.col; });
      for (var i2 = 0; i2 < canon.length; i2++) {
        for (var j2 = 0; j2 < canon.length; j2++) {
          if (i2 === j2) continue;
          var gi = canon[i2], gj = canon[j2];
          if (gi.rank < gj.rank) {
            var wiresI = gateWires(gi), wiresJ = gateWires(gj);
            var shares = wiresI.some(function (w) { return wiresJ.indexOf(w) !== -1; });
            if (shares) {
              var colI = playerColBySig[gateSignature(gi)], colJ = playerColBySig[gateSignature(gj)];
              if (!(colI < colJ)) return false;
            }
          }
        }
      }
      return true;
    }
    // Physics fallback for circuits that aren't a gate-for-gate copy of the
    // canonical one but are still correct: apply both the player's resolved
    // circuit and the canonical circuit to the same input state (the live
    // shared state at the start of this player's turn) and accept if the
    // two output states have fidelity ~1 — i.e. they agree up to an
    // unobservable global phase, which is exactly "physically equivalent."
    function stateEquivalent(ed, r) {
      if (!ed.equivState) return false;
      var base = ed.equivState.getState();
      var qubits = ed.equivState.qubits();
      if (!base || !qubits) return false;
      var playerState = QEngine.cloneState(base);
      r.gates.slice().sort(function (a, b) { return a.col - b.col; })
        .forEach(function (g) { QEngine.applyGate(playerState, g, qubits); });
      var canonState = QEngine.cloneState(base);
      ed.canonical.slice().sort(function (a, b) { return a.rank - b.rank; })
        .forEach(function (g) { QEngine.applyGate(canonState, g, qubits); });
      return QEngine.overlap(canonState, playerState) >= 1 - 1e-6;
    }
    function matchesCanonical(ed) {
      var r = resolve(ed);
      if (r.incomplete.length > 0) return false;
      if (structuralMatch(ed, r)) return true;
      return stateEquivalent(ed, r);
    }
    // Greedily assigns each canonical gate the earliest column that
    // (a) respects rank order on any wire it shares with an earlier
    // gate, and (b) doesn't collide with any wire already occupied in
    // that column — two independent gates at the same rank (e.g. two
    // simultaneous CNOTs) must land in different columns if any of
    // their wires would otherwise clash, but plain single-qubit gates
    // on distinct wires with no ctrl present may share a column.
    function autoFillCanonical(ed) {
      ed.cells = {};
      var wireNextCol = {};
      ed.canonical.slice().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (g) {
        var wires = gateWires(g);
        var col = 0;
        wires.forEach(function (w) { col = Math.max(col, wireNextCol[w] || 0); });
        if (g.role === "controlled") {
          while (true) {
            var occupied = wires.some(function (w) { return !!ed.cells[key(col, w)]; });
            var counts = columnCounts(ed, col);
            if (!occupied && counts.gate === 0) break;
            col++;
          }
          g.controls.forEach(function (cw) { ed.cells[key(col, cw)] = { role: "ctrl" }; });
          ed.cells[key(col, g.target)] = { role: "gate", gate: g.gate, adjoint: !!g.adjoint, theta: g.theta, axis: g.axis };
        } else {
          while (ed.cells[key(col, wires[0])]) col++;
          ed.cells[key(col, wires[0])] = { role: "gate", gate: g.gate, adjoint: !!g.adjoint, theta: g.theta, axis: g.axis };
        }
        wires.forEach(function (w) { wireNextCol[w] = col + 1; });
      });
    }
    function setArmed(ed, kind, tileEl) {
      if (ed.armedTileEl) ed.armedTileEl.classList.remove("armed");
      ed.armedKind = kind;
      ed.armedTileEl = kind ? tileEl : null;
      if (tileEl && kind) tileEl.classList.add("armed");
    }
    function hitTestSlot(ed, clientX, clientY) {
      var rect = ed.container.getBoundingClientRect();
      var x = clientX - rect.left, y = clientY - rect.top;
      if (x < ed.canvas.labelW || x > ed.canvas.width || y < 0 || y > ed.canvas.height) return null;
      var col = Math.floor((x - ed.canvas.labelW) / ed.canvas.colW);
      var wire = Math.floor(y / ed.canvas.rowH);
      if (col < 0 || col >= ed.nCols || wire < 0 || wire >= ed.nWires) return null;
      return { col: col, wire: wire };
    }
    // kind is a palette kind: a gate letter (H/X/Y/Z/S/T/R/CP), "ctrl",
    // "SWAP", "measure", or "ADJOINT" (a toggle applied to an existing gate
    // cell, not a new cell).
    function canPlace(ed, col, wire, kind) {
      var existing = ed.cells[key(col, wire)];
      if (kind === "ADJOINT") return !!existing && existing.role === "gate";
      if (existing) return false;
      var counts = columnCounts(ed, col);
      if (kind === "ctrl") return counts.gate <= 1 && counts.swap <= 2 && counts.measure === 0;
      if (kind === "measure") return counts.ctrl === 0 && counts.gate === 0 && counts.swap === 0 && counts.measure === 0;
      if (kind === "SWAP") return counts.gate === 0 && counts.swap < 2 && counts.measure === 0;
      // plain single-qubit gate tile: unlimited independent gates share a
      // column when no ctrl is present in it; once a ctrl is present, only
      // the one gate it controls may join.
      return counts.measure === 0 && counts.swap === 0 && (counts.ctrl === 0 || counts.gate === 0);
    }
    function placeKind(ed, col, wire, kind) {
      var k = key(col, wire);
      if (kind === "ADJOINT") {
        var existing = ed.cells[k];
        if (existing && existing.role === "gate") existing.adjoint = !existing.adjoint;
        return;
      }
      if (kind === "ctrl") { ed.cells[k] = { role: "ctrl" }; return; }
      if (kind === "measure") { ed.cells[k] = { role: "measure" }; return; }
      if (kind === "SWAP") { ed.cells[k] = { role: "swap" }; return; }
      var cell = { role: "gate", gate: kind, adjoint: false };
      if (kind === "R") { cell.theta = Math.PI / 2; cell.axis = "Z"; }
      if (kind === "CP") { cell.theta = Math.PI / 2; }
      ed.cells[k] = cell;
    }
    // After placing the first leg of the two-step SWAP tile, returns the
    // palette kind that should auto-arm next (its other leg), or null.
    function comboNext(ed, kind, col) {
      if (kind === "SWAP") return columnCounts(ed, col).swap < 2 ? "SWAP" : null;
      return null;
    }
    // What a placed cell "is" for canPlace/move purposes.
    function representativeKind(cellObj) {
      if (cellObj.role === "ctrl") return "ctrl";
      if (cellObj.role === "measure") return "measure";
      if (cellObj.role === "swap") return "SWAP";
      return cellObj.gate;
    }
    // kind + optional text for rendering a cell/tile glyph.
    function glyphKindAndText(cellSpec, isXTarget) {
      if (cellSpec.role === "ctrl") return { kind: "ctrl", text: null };
      if (cellSpec.role === "measure") return { kind: "box", text: "M" };
      if (cellSpec.role === "swap") return { kind: "swap", text: null };
      if (isXTarget) return { kind: "target", text: null };
      var label = cellSpec.gate === "R" ? "R" + (cellSpec.axis || "Z").toLowerCase() : cellSpec.gate === "CP" ? "P" : cellSpec.gate;
      return { kind: "box", text: label + (cellSpec.adjoint ? "†" : "") };
    }
    function createGhost(kind, colorClass) {
      var gt;
      if (kind === "ADJOINT") gt = { kind: "box", text: "†" };
      else if (kind === "SWAP") gt = { kind: "swap", text: null };
      else if (kind === "measure") gt = { kind: "box", text: "M" };
      else if (kind === "R") gt = { kind: "box", text: "Rz" };
      else if (kind === "CP") gt = { kind: "box", text: "P" };
      else if (kind === "ctrl") gt = { kind: "ctrl", text: null };
      else gt = { kind: "box", text: kind };
      var g = CircuitCanvas.makeGateGlyph(gt.kind, colorClass, gt.text);
      g.className += " drag-ghost";
      g.style.position = "fixed"; g.style.zIndex = "999"; g.style.pointerEvents = "none";
      g.style.transform = "translate(-50%, -50%)";
      document.body.appendChild(g);
      return g;
    }
    function createGhostForCell(cellObj, colorClass) {
      var gt = glyphKindAndText(cellObj, false);
      var g = CircuitCanvas.makeGateGlyph(gt.kind, colorClass, gt.text);
      g.className += " drag-ghost";
      g.style.position = "fixed"; g.style.zIndex = "999"; g.style.pointerEvents = "none";
      g.style.transform = "translate(-50%, -50%)";
      document.body.appendChild(g);
      return g;
    }
    function positionGhost(g, x, y) { g.style.left = x + "px"; g.style.top = y + "px"; }

    function attachPaletteDrag(tileEl, kind, ed) {
      tileEl.style.touchAction = "none";
      tileEl.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        var startX = e.clientX, startY = e.clientY, moved = false, ghost = null;
        function onMove(ev) {
          var dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (!moved && Math.hypot(dx, dy) > 6) { moved = true; setArmed(ed, null); ghost = createGhost(kind, ed.colorClass); }
          if (moved) positionGhost(ghost, ev.clientX, ev.clientY);
        }
        function onUp(ev) {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          if (moved) {
            var slot = hitTestSlot(ed, ev.clientX, ev.clientY);
            if (slot && canPlace(ed, slot.col, slot.wire, kind)) {
              placeKind(ed, slot.col, slot.wire, kind);
              var next = comboNext(ed, kind, slot.col);
              render(ed);
              if (next) setArmed(ed, next, ed.tileElByKind[next]);
            }
            if (ghost) ghost.remove();
          } else {
            setArmed(ed, ed.armedKind === kind ? null : kind, tileEl);
          }
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
      tileEl.tabIndex = 0;
      tileEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setArmed(ed, ed.armedKind === kind ? null : kind, tileEl); }
      });
    }
    function attachPlacedDrag(glyphEl, col, wire, ed) {
      glyphEl.style.touchAction = "none";
      glyphEl.tabIndex = 0;
      function doDelete() { delete ed.cells[key(col, wire)]; render(ed); }
      // A tap on an occupied cell normally deletes it — but if a modifier
      // (currently just Adjoint†) is armed and applies to this exact cell,
      // the tap applies it instead. This is the tap/keyboard-accessible
      // path for toggling adjoint in place, since the underlying qc-slot
      // is visually covered by this glyph and can't be tapped directly.
      function tapAction() {
        if (ed.armedKind && canPlace(ed, col, wire, ed.armedKind)) {
          placeKind(ed, col, wire, ed.armedKind);
          setArmed(ed, null);
          render(ed);
        } else {
          doDelete();
        }
      }
      glyphEl.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapAction(); } });
      glyphEl.addEventListener("pointerdown", function (e) {
        e.preventDefault(); e.stopPropagation();
        var startX = e.clientX, startY = e.clientY, moved = false, ghost = null;
        var cellObj = ed.cells[key(col, wire)];
        var kind = representativeKind(cellObj);
        function onMove(ev) {
          var dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (!moved && Math.hypot(dx, dy) > 6) { moved = true; delete ed.cells[key(col, wire)]; render(ed); ghost = createGhostForCell(cellObj, ed.colorClass); }
          if (moved) positionGhost(ghost, ev.clientX, ev.clientY);
        }
        function onUp(ev) {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          if (moved) {
            var slot = hitTestSlot(ed, ev.clientX, ev.clientY);
            if (slot && canPlace(ed, slot.col, slot.wire, kind)) ed.cells[key(slot.col, slot.wire)] = cellObj;
            if (ghost) ghost.remove();
            render(ed);
          } else { tapAction(); }
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    }
    var PALETTE_GLYPH = {
      SWAP: { kind: "swap", text: null }, ADJOINT: { kind: "box", text: "†" },
      measure: { kind: "box", text: "M" }, ctrl: { kind: "ctrl", text: null },
      R: { kind: "box", text: "Rz" }, CP: { kind: "box", text: "P" }
    };
    function renderPalette(ed) {
      var el = document.getElementById(ed.paletteId);
      el.innerHTML = "";
      ed.tileElByKind = {};
      ed.gateKinds.forEach(function (k) {
        var tile = document.createElement("div");
        tile.className = "palette-tile";
        var glyphWrap = document.createElement("div");
        glyphWrap.className = "palette-glyph";
        var gt = PALETTE_GLYPH[k.kind] || { kind: "box", text: k.kind };
        glyphWrap.appendChild(CircuitCanvas.makeGateGlyph(gt.kind, ed.colorClass, gt.text));
        var lbl = document.createElement("div");
        lbl.className = "palette-label";
        lbl.textContent = k.label;
        tile.appendChild(glyphWrap); tile.appendChild(lbl);
        attachPaletteDrag(tile, k.kind, ed);
        el.appendChild(tile);
        ed.tileElByKind[k.kind] = tile;
      });
    }
    // Renders one labeled row per placed R(θ)/CP(θ) cell into ed.paramsId
    // (if configured), with an axis toggle (R only) and a theta/pi slider.
    // The 'input' event only updates the cell + a live readout (no full
    // render — keeps the slider from losing focus mid-drag); 'change'
    // (on release) triggers a full render so the circuit diagram label
    // and win-check both pick up the new value.
    function renderParamPanel(ed) {
      if (!ed.paramsId) return;
      var el = document.getElementById(ed.paramsId);
      if (!el) return;
      el.innerHTML = "";
      var entries = [];
      Object.keys(ed.cells).forEach(function (k) {
        var cell = ed.cells[k];
        if (cell.role === "gate" && (cell.gate === "R" || cell.gate === "CP")) {
          var parts = k.split(",");
          entries.push({ col: +parts[0], wire: +parts[1], cell: cell });
        }
      });
      entries.sort(function (a, b) { return a.col - b.col || a.wire - b.wire; });
      entries.forEach(function (entry) {
        var cell = entry.cell;
        var row = document.createElement("div");
        row.className = "param-row";
        var label = document.createElement("div");
        label.className = "param-label";
        label.textContent = (cell.gate === "R" ? "R" : "CP") + " — " + ed.wireLabels[entry.wire];
        row.appendChild(label);
        if (cell.gate === "R") {
          var axisWrap = document.createElement("div");
          axisWrap.className = "param-axis";
          ["X", "Y", "Z"].forEach(function (ax) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "param-axis-btn" + (cell.axis === ax ? " active" : "");
            btn.textContent = ax;
            btn.addEventListener("click", function () { cell.axis = ax; render(ed); });
            axisWrap.appendChild(btn);
          });
          row.appendChild(axisWrap);
        }
        var slider = document.createElement("input");
        slider.type = "range"; slider.className = "param-slider";
        slider.min = "-2"; slider.max = "2"; slider.step = "0.05";
        slider.value = (cell.theta / Math.PI).toFixed(2);
        var readout = document.createElement("span");
        readout.className = "param-readout";
        readout.textContent = (cell.theta / Math.PI).toFixed(2) + "π";
        slider.addEventListener("input", function () {
          cell.theta = parseFloat(slider.value) * Math.PI;
          readout.textContent = parseFloat(slider.value).toFixed(2) + "π";
        });
        slider.addEventListener("change", function () { render(ed); });
        row.appendChild(slider); row.appendChild(readout);
        el.appendChild(row);
      });
    }
    function render(ed) {
      var canvas = CircuitCanvas.init(ed.container, ed.nWires, ed.nCols, ed.rowH || 72, ed.colW || 64, ed.labelW || 48, ed.wireLabels);
      ed.canvas = canvas;
      ed.container.style.touchAction = "none";

      if (ed.showHintFlag) {
        ed.canonical.forEach(function (g) {
          var col = g.rank;
          if (g.role === "controlled") {
            var wires = g.controls.concat([g.target]);
            var top = Math.min.apply(null, wires), bot = Math.max.apply(null, wires);
            var pTop = canvas.posFor(col, top), pBot = canvas.posFor(col, bot);
            ed.container.appendChild(CircuitCanvas.makeConnector(pTop.x, pTop.y, pBot.y, "qc-ghost"));
            g.controls.forEach(function (cw) {
              var pCtrl = canvas.posFor(col, cw);
              var dot = CircuitCanvas.makeGateGlyph("ctrl", "qc-ghost"); CircuitCanvas.placeAtPixel(dot, pCtrl.x, pCtrl.y); ed.container.appendChild(dot);
            });
            var pTgt = canvas.posFor(col, g.target);
            var gt = glyphKindAndText(g, g.gate === "X" && !g.adjoint);
            var tgtGlyph = CircuitCanvas.makeGateGlyph(gt.kind, "qc-ghost", gt.text);
            CircuitCanvas.placeAtPixel(tgtGlyph, pTgt.x, pTgt.y); ed.container.appendChild(tgtGlyph);
          } else {
            var p = canvas.posFor(col, g.wire);
            var gt2 = glyphKindAndText(g, false);
            var box = CircuitCanvas.makeGateGlyph(gt2.kind, "qc-ghost", gt2.text); CircuitCanvas.placeAtPixel(box, p.x, p.y); ed.container.appendChild(box);
          }
        });
      }

      var resolved = resolve(ed);
      var incompleteSet = {};
      resolved.incomplete.forEach(function (it) { incompleteSet[key(it.col, it.wire)] = true; });
      // Cells that are the target of a controlled-X (and not adjoint) get
      // the classic ⊕ ring instead of a boxed "X" — purely a rendering
      // convention.
      var xTargetSet = {};
      resolved.gates.forEach(function (g) { if (g.role === "controlled" && g.gate === "X" && !g.adjoint) xTargetSet[key(g.col, g.target)] = true; });

      for (var c = 0; c < ed.nCols; c++) {
        var specialWires = [];
        for (var w = 0; w < ed.nWires; w++) {
          var kd = ed.cells[key(c, w)];
          if (kd && kd.role !== "measure") specialWires.push(w);
        }
        // Only control (ctrl->target) and swap (leg->leg) relationships get
        // a connecting line -- independent single-qubit gates that merely
        // happen to share a column (no ctrl, no swap) render standalone.
        var colCounts = columnCounts(ed, c);
        if (specialWires.length >= 2 && (colCounts.ctrl > 0 || colCounts.swap > 0)) {
          var top2 = Math.min.apply(null, specialWires), bot2 = Math.max.apply(null, specialWires);
          var pTop3 = canvas.posFor(c, top2), pBot3 = canvas.posFor(c, bot2);
          ed.container.appendChild(CircuitCanvas.makeConnector(pTop3.x, pTop3.y, pBot3.y, ed.colorClass));
        }
      }

      for (var c2 = 0; c2 < ed.nCols; c2++) {
        for (var w2 = 0; w2 < ed.nWires; w2++) {
          var k2 = key(c2, w2);
          var p2 = canvas.posFor(c2, w2);
          var slot = document.createElement("div");
          slot.className = "qc-slot";
          slot.style.left = (p2.x - 28) + "px"; slot.style.top = (p2.y - 28) + "px";
          slot.style.width = "56px"; slot.style.height = "56px";
          slot.tabIndex = 0; slot.setAttribute("role", "button");
          slot.setAttribute("aria-label", ed.wireLabels[w2] + " slot " + c2);
          (function (cc, ww, kk) {
            function placeIfArmed() {
              if (!ed.armedKind) return;
              if (!canPlace(ed, cc, ww, ed.armedKind)) return;
              placeKind(ed, cc, ww, ed.armedKind);
              var next = comboNext(ed, ed.armedKind, cc);
              setArmed(ed, null);
              render(ed);
              if (next) setArmed(ed, next, ed.tileElByKind[next]);
            }
            slot.addEventListener("pointerdown", function (e) { e.preventDefault(); placeIfArmed(); });
            slot.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeIfArmed(); } });
          })(c2, w2, k2);
          ed.container.appendChild(slot);

          var occ = ed.cells[k2];
          if (occ) {
            var extra = incompleteSet[k2] ? "qc-incomplete" : ed.colorClass;
            var gt3 = glyphKindAndText(occ, occ.role === "gate" && xTargetSet[k2]);
            var glyph = CircuitCanvas.makeGateGlyph(gt3.kind, extra, gt3.text);
            glyph.setAttribute("data-col", c2); glyph.setAttribute("data-wire", w2);
            CircuitCanvas.placeAtPixel(glyph, p2.x, p2.y);
            attachPlacedDrag(glyph, c2, w2, ed);
            ed.container.appendChild(glyph);
          }
        }
      }

      renderParamPanel(ed);
      if (ed.onChange) ed.onChange(ed, matchesCanonical(ed), resolved);
    }
    function create(config) {
      return {
        container: document.getElementById(config.containerId),
        paletteId: config.paletteId, paramsId: config.paramsId,
        wireLabels: config.wireLabels, nWires: config.wireLabels.length,
        nCols: config.nCols || 4,
        rowH: config.rowH, colW: config.colW, labelW: config.labelW,
        canonical: config.canonical, gateKinds: config.gateKinds, colorClass: config.colorClass,
        onChange: config.onChange, equivState: config.equivState,
        cells: {}, showHintFlag: false, armedKind: null, armedTileEl: null, canvas: null, tileElByKind: {}
      };
    }
    return {
      create: create, render: render, renderPalette: renderPalette,
      resolve: resolve, matches: matchesCanonical, autoFill: autoFillCanonical,
      gateSignature: gateSignature, gateWires: gateWires
    };
  })();

  // Expose the three engines for reuse by any game that loads this file.
  window.QEngine = QEngine;
  window.CircuitCanvas = CircuitCanvas;
  window.CircuitEditor = CircuitEditor;
})();

// =========================================================
// Error Correction Zoo Tycoon — the habitat workshop (editor UI).
//
// A grid where the player places data qubits and check ancillas and
// wires them up, with a live readout of what the checks make (habitat.js
// does the analysis; park.js says which species it is). Tapping:
//   empty cell -> add a data qubit, or a check of the chosen type (wired
//                 at once to the data qubits around it)
//   a check    -> select it (tap again to deselect)
//   a qubit    -> wire it to / unwire it from the selected check
//   Erase tool -> remove what you tap
// The selected check's Pauli on every qubit can also be set letter by
// letter, so checks may mix X, Y and Z.
//
// Browser only: load after ../stabilizer.js, zoo-data.js, habitat.js and
// park.js. Exposes `window.Workshop` with mount(card, opts).
// =========================================================
(function (root) {
  var S = root.Stabilizer, Z = root.ZooData, Hab = root.Habitat, Park = root.Park;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var CELL = 36, G = Z.BUILD.grid;
  var WIRE_COLOR = { X: "var(--check-x)", Z: "var(--check-z)", Y: "var(--check-mix)" };
  var NEXT_LETTER = { I: "X", X: "Z", Z: "Y", Y: "I" };

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function money(v) { return (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString(); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // opts: { park, design (starting point), onPlace(design, name), onClose(design) }
  function mount(card, opts) {
    var park = opts.park;
    var design = opts.design ? Hab.clone(opts.design) : Hab.emptyDesign();
    var tool = "qubit", selected = -1, history = [], speciesName = "";

    card.innerHTML = "";
    card.appendChild(h("span", "eyebrow", "Habitat workshop"));
    card.appendChild(h("h2", "title", "Design a habitat"));
    card.lastChild.id = "modalTitle";
    card.appendChild(h("p", "hint",
      "Place data qubits and checks. A new check is wired to the data qubits around it; tap a check, then tap data qubits to add or remove wires. " +
      "Each check measures the product of its wires' Paulis, once per round."));
    var wrap = h("div", "ws");
    var left = h("div", "ws-left"), right = h("div", "ws-right");
    wrap.appendChild(left); wrap.appendChild(right);
    card.appendChild(wrap);

    var tools = h("div", "seg ws-tools");
    [["qubit", "● Qubit"], ["X", "■ X check"], ["Z", "■ Z check"], ["erase", "✕ Erase"]].forEach(function (t) {
      var b = h("button", "", t[1]);
      b.type = "button"; b.dataset.tool = t[0];
      b.addEventListener("click", function () { tool = t[0]; renderTools(); });
      tools.appendChild(b);
    });
    left.appendChild(tools);
    var svg = svgEl("svg", { viewBox: "0 0 " + G * CELL + " " + G * CELL, "class": "ws-grid", role: "img",
      "aria-label": "Habitat design grid" });
    left.appendChild(svg);
    var row = h("div", "btn-row");
    var undoB = h("button", "btn quiet", "Undo"); undoB.type = "button";
    undoB.addEventListener("click", function () { if (history.length) { design = history.pop(); selected = -1; refresh(); } });
    var clearB = h("button", "btn quiet", "Clear"); clearB.type = "button";
    clearB.addEventListener("click", function () { if (design.qubits.length || design.checks.length) { change(); design = Hab.emptyDesign(); selected = -1; refresh(); } });
    row.appendChild(undoB); row.appendChild(clearB);
    if (park.book.designs.length) {
      var sel = h("select", "ws-load");
      sel.setAttribute("aria-label", "Start from a design in your book");
      sel.appendChild(new Option("Start from your book…", ""));
      park.book.designs.forEach(function (e) { sel.appendChild(new Option(e.name, String(e.id))); });
      sel.addEventListener("change", function () {
        var e = Park.designEntry(park, Number(sel.value));
        sel.value = "";
        if (!e) return;
        change(); design = Hab.clone(e.layout); selected = -1; refresh();
      });
      row.appendChild(sel);
    }
    left.appendChild(row);

    var readout = h("div", "ws-read"), checkBox = h("div", "ws-checkbox");
    right.appendChild(readout); right.appendChild(checkBox);

    var actions = h("div", "actions");
    var cancel = h("button", "btn quiet", "Close"); cancel.type = "button";
    cancel.addEventListener("click", function () { opts.onClose(design); });
    var place = h("button", "btn", "Place in park"); place.type = "button";
    place.addEventListener("click", function () { opts.onPlace(Hab.clone(design), speciesName); });
    actions.appendChild(cancel); actions.appendChild(place);
    card.appendChild(actions);

    function change() { history.push(Hab.clone(design)); if (history.length > 60) history.shift(); }
    function renderTools() {
      Array.prototype.forEach.call(tools.querySelectorAll("button"), function (b) { b.classList.toggle("on", b.dataset.tool === tool); });
    }

    // ---------- editing ----------
    function at(x, y) {
      for (var q = 0; q < design.qubits.length; q++) if (design.qubits[q][0] === x && design.qubits[q][1] === y) return { qubit: q };
      for (var c = 0; c < design.checks.length; c++) if (design.checks[c].at[0] === x && design.checks[c].at[1] === y) return { check: c };
      return null;
    }
    // The Pauli a new wire on check c gets: what its wires already use
    // (if they agree), else the check tool's letter, else Z.
    function letterFor(c) {
      var ls = {};
      design.checks[c].wires.forEach(function (w) { ls[w[1]] = 1; });
      var keys = Object.keys(ls);
      if (keys.length === 1) return keys[0];
      return tool === "X" || tool === "Z" ? tool : "Z";
    }
    function wireIndex(c, q) {
      var ws = design.checks[c].wires;
      for (var i = 0; i < ws.length; i++) if (ws[i][0] === q) return i;
      return -1;
    }
    function removeQubit(q) {
      design.qubits.splice(q, 1);
      design.checks.forEach(function (c) {
        c.wires = c.wires.filter(function (w) { return w[0] !== q; }).map(function (w) { return [w[0] > q ? w[0] - 1 : w[0], w[1]]; });
      });
    }
    function tap(x, y) {
      var hit = at(x, y);
      if (tool === "erase") {
        if (!hit) return;
        change();
        if ("qubit" in hit) removeQubit(hit.qubit);
        else { design.checks.splice(hit.check, 1); if (selected === hit.check) selected = -1; else if (selected > hit.check) selected--; }
      } else if (hit && "check" in hit) {
        selected = selected === hit.check ? -1 : hit.check;
      } else if (hit) {
        if (selected < 0) { flash("Select a check first (tap it), then tap data qubits to wire them."); return; }
        change();
        var i = wireIndex(selected, hit.qubit);
        if (i >= 0) design.checks[selected].wires.splice(i, 1);
        else design.checks[selected].wires.push([hit.qubit, letterFor(selected)]);
      } else if (tool === "qubit") {
        if (design.qubits.length >= Z.BUILD.maxData) { flash("At most " + Z.BUILD.maxData + " data qubits."); return; }
        change();
        design.qubits.push([x, y]);
      } else {
        if (design.checks.length >= Z.BUILD.maxChecks) { flash("At most " + Z.BUILD.maxChecks + " checks."); return; }
        change();
        var wires = [];
        design.qubits.forEach(function (p, q) { if (Math.abs(p[0] - x) <= 1 && Math.abs(p[1] - y) <= 1) wires.push([q, tool]); });
        design.checks.push({ at: [x, y], wires: wires });
        selected = design.checks.length - 1;
      }
      refresh();
    }
    svg.addEventListener("click", function (ev) {
      var r = svg.getBoundingClientRect();
      var x = Math.floor((ev.clientX - r.left) / r.width * G), y = Math.floor((ev.clientY - r.top) / r.height * G);
      if (x >= 0 && y >= 0 && x < G && y < G) tap(x, y);
    });
    var flashMsg = "";
    function flash(t) { flashMsg = t; refresh(); flashMsg = ""; }

    // ---------- drawing ----------
    function center(p) { return [p[0] * CELL + CELL / 2, p[1] * CELL + CELL / 2]; }
    function drawGrid(a) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      for (var y = 0; y < G; y++) for (var x = 0; x < G; x++) {
        svgEl("circle", { cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: 1.6, "class": "ws-dot" }, svg);
      }
      var clash = a.clash ? [a.clash.a, a.clash.b] : [];
      design.checks.forEach(function (c, i) {
        var pc = center(c.at);
        c.wires.forEach(function (w) {
          var pq = center(design.qubits[w[0]]);
          svgEl("line", { x1: pc[0], y1: pc[1], x2: pq[0], y2: pq[1], stroke: WIRE_COLOR[w[1]],
            "class": "ws-wire" + (selected === i ? " sel" : "") + (selected >= 0 && selected !== i ? " dim" : "") }, svg);
        });
      });
      var idle = {};
      a.idle.forEach(function (q) { idle[q] = 1; });
      design.qubits.forEach(function (p, q) {
        var pq = center(p);
        var wired = selected >= 0 && wireIndex(selected, q) >= 0;
        svgEl("circle", { cx: pq[0], cy: pq[1], r: 12, "class": "ws-qubit" + (idle[q] ? " idle" : "") + (wired ? " wired" : "") }, svg);
        var t = svgEl("text", { x: pq[0], y: pq[1] + 4, "text-anchor": "middle", "class": "ws-qlabel" }, svg);
        t.textContent = q;
        if (wired) {
          var l = design.checks[selected].wires[wireIndex(selected, q)][1];
          var lt = svgEl("text", { x: pq[0] + 11, y: pq[1] - 9, "class": "ws-letter", fill: WIRE_COLOR[l] }, svg);
          lt.textContent = l;
        }
      });
      design.checks.forEach(function (c, i) {
        var pc = center(c.at), type = checkType(c);
        svgEl("rect", { x: pc[0] - 11, y: pc[1] - 11, width: 22, height: 22, rx: 4,
          "class": "ws-check" + (selected === i ? " sel" : "") + (clash.indexOf(i) >= 0 ? " clash" : ""),
          stroke: type === "mix" ? "var(--check-mix)" : type === "x" ? "var(--check-x)" : type === "z" ? "var(--check-z)" : "var(--ink-dim)" }, svg);
        var t = svgEl("text", { x: pc[0], y: pc[1] + 4, "text-anchor": "middle", "class": "ws-clabel" }, svg);
        t.textContent = Hab.checkLabel(i);
      });
    }
    function checkType(c) {
      var hasX = false, hasZ = false;
      c.wires.forEach(function (w) { if (w[1] !== "Z") hasX = true; if (w[1] !== "X") hasZ = true; });
      return !c.wires.length ? "none" : hasX && hasZ ? "mix" : hasX ? "x" : "z";
    }

    // ---------- readout ----------
    function renderReadout(st) {
      var a = st.analysis, html = "";
      var sp = st.speciesId ? Park.speciesInfo(park, st.speciesId) : null;
      if (a.valid && sp && st.known) {
        html += '<div class="ws-id">' + sp.glyph + " <b>" + esc(sp.name) + "</b> · in your field guide</div>";
      } else if (a.valid && sp) {
        html += '<div class="ws-id new">✨ ' + sp.glyph + " <b>" + esc(sp.name) + "</b>! Build this habitat to discover it.</div>";
      } else if (a.valid) {
        html += '<div class="ws-id new">✨ A code that isn\'t in the field guide. Build it to discover a new species.</div>';
      } else {
        html += '<div class="ws-id">Not a habitat yet.</div>';
      }
      function yes(v) { return v ? "✓" : "✗"; }
      var dTxt = a.d !== null ? String(a.d) : a.dAtLeast ? "≥ " + a.dAtLeast : "—";
      var rows = [
        ["Data qubits", a.n + " / " + Z.BUILD.maxData],
        ["Checks", a.m + (a.k || a.clash ? " (" + a.rank + " independent" + (a.redundant ? ", " + a.redundant + " redundant" : "") + ")" : "")],
        ["Checks commute", a.n && a.m ? yes(!a.clash) : "—"],
        ["Animals (k)", a.valid ? String(a.k) : a.clash ? "—" : String(a.k)],
        ["Distance (d)", a.valid ? dTxt : "—"],
        ["Type", a.n && a.m && !a.problems.length || a.clash ? (a.css ? "CSS (X and Z checks separate)" : "non-CSS (checks mix X and Z)") : "—"],
        ["Wires (CNOTs/round)", String(a.wires)],
        ["Cost", money(a.cost) + " + " + money(a.upkeep) + "/day"],
        ["Size", a.footprint[0] + "×" + a.footprint[1] + " tiles (" + (a.n + a.m) + " qubits)"]
      ];
      html += '<dl class="facts">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>";
      a.problems.forEach(function (p) { html += '<div class="hint bad">✗ ' + p + "</div>"; });
      a.notes.forEach(function (p) { html += '<div class="hint">' + p + "</div>"; });
      if (flashMsg) html += '<div class="hint bad">' + flashMsg + "</div>";
      readout.innerHTML = html;
      if (a.valid && !sp) {
        var lab = h("label", "ws-name", "Name your species ");
        var inp = h("input");
        inp.type = "text"; inp.maxLength = 40; inp.placeholder = "Wild code no. " + park.book.nextCustom;
        inp.value = speciesName;
        inp.addEventListener("input", function () { speciesName = inp.value; });
        lab.appendChild(inp);
        readout.appendChild(lab);
      }
    }
    function renderCheck() {
      checkBox.innerHTML = "";
      if (selected < 0 || !design.checks[selected]) { checkBox.appendChild(h("div", "hint", "No check selected.")); return; }
      var c = design.checks[selected], P = Hab.checkOp(design, c);
      checkBox.appendChild(h("div", "ws-chead", "Check <b>" + Hab.checkLabel(selected) + "</b> measures " +
        (S.isIdentity(P) ? "nothing yet" : "<span class=\"mono\">" + describe(P) + "</span>")));
      var letters = h("div", "ws-letters");
      design.qubits.forEach(function (_, q) {
        var i = wireIndex(selected, q), l = i >= 0 ? c.wires[i][1] : "I";
        var b = h("button", "ws-l l-" + l, "<span>" + q + "</span>" + l);
        b.type = "button";
        b.title = "Qubit " + q + ": tap to cycle I → X → Z → Y";
        b.addEventListener("click", function () {
          change();
          var nl = NEXT_LETTER[l];
          if (i >= 0 && nl === "I") c.wires.splice(i, 1);
          else if (i >= 0) c.wires[i][1] = nl;
          else c.wires.push([q, nl]);
          refresh();
        });
        letters.appendChild(b);
      });
      checkBox.appendChild(letters);
      var row2 = h("div", "btn-row");
      [["X", "All X"], ["Z", "All Z"]].forEach(function (t) {
        var b = h("button", "btn quiet", t[1]); b.type = "button";
        b.addEventListener("click", function () { change(); c.wires.forEach(function (w) { w[1] = t[0]; }); refresh(); });
        row2.appendChild(b);
      });
      var del = h("button", "btn danger", "Delete check"); del.type = "button";
      del.addEventListener("click", function () { change(); design.checks.splice(selected, 1); selected = -1; refresh(); });
      row2.appendChild(del);
      checkBox.appendChild(row2);
    }
    function describe(P) {
      var parts = [];
      for (var q = 0; q < P.n; q++) { var a = S.at(P, q); if (a !== "I") parts.push(a + "<sub>" + q + "</sub>"); }
      return parts.join(" ");
    }

    function refresh() {
      var st = Park.studyDesign(park, design), a = st.analysis;
      drawGrid(a);
      renderReadout(st);
      renderCheck();
      undoB.disabled = !history.length;
      var spot = a.valid && park.cash >= a.cost;
      place.disabled = !spot;
      place.textContent = a.valid ? "Place in park · " + money(a.cost) + " · " + a.footprint.join("×") : "Place in park";
      place.title = !a.valid ? (a.problems[0] || "") : park.cash < a.cost ? "Not enough funding." : "";
    }
    renderTools();
    refresh();
  }

  root.Workshop = { mount: mount };
})(window);

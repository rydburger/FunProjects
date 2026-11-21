// =========================================================
// paper-ui.js: shared DOM helpers for the chapters built on
// arXiv:2512.02284. Chapter nav + theme toggle, SVG charts with hover
// tooltips and a data table, a small circuit drawer, noise controls, and
// a time-sliced job runner so long sweeps never block the page.
// Exposes window.PaperUI. No dependencies.
// =========================================================
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var PAPER_URL = "https://arxiv.org/abs/2512.02284";
  var CHAPTERS = [
    { id: "game", href: "index.html", n: "1", label: "Magic square" },
    { id: "lab", href: "lab.html", n: "2", label: "On a noisy chip" },
    { id: "ksb", href: "ksb.html", n: "3", label: "Contextuality" },
    { id: "ghz", href: "ghz.html", n: "4", label: "GHZ game" },
    { id: "hlf", href: "hlf.html", n: "5", label: "Hidden linear function" }
  ];

  function h(tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "class") el.className = attrs[k]; else el.setAttribute(k, attrs[k]); });
    if (html != null) el.innerHTML = html;
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- theme ----------
  var THEMES = ["auto", "light", "dark"];
  function getTheme() { try { return localStorage.getItem("qg-theme") || "auto"; } catch (e) { return "auto"; } }
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("qg-theme", t); } catch (e) { /* storage blocked */ }
    window.dispatchEvent(new Event("qg-theme"));
  }
  applyTheme(getTheme());

  // ---------- chapter nav ----------
  function nav(current, mount) {
    var bar = h("nav", { class: "chapters", "aria-label": "Chapters" });
    bar.appendChild(h("span", { class: "paper-tag" }, 'Games from <a href="' + PAPER_URL + '" target="_blank" rel="noopener">arXiv:2512.02284</a>'));
    CHAPTERS.forEach(function (c) {
      var a = h("a", { class: "ch", href: c.href }, "<b>" + c.n + "</b>" + c.label);
      if (c.id === current) a.setAttribute("aria-current", "page");
      bar.appendChild(a);
    });
    bar.appendChild(h("span", { class: "spacer" }));
    var btn = h("button", { class: "theme-btn", type: "button", title: "Colour theme" });
    function label() { btn.textContent = "Theme: " + getTheme(); }
    btn.addEventListener("click", function () { applyTheme(THEMES[(THEMES.indexOf(getTheme()) + 1) % 3]); label(); });
    label();
    bar.appendChild(btn);
    var host = mount || document.querySelector(".wrap") || document.body;
    host.insertBefore(bar, host.firstChild);
    return bar;
  }

  // ---------- formatting ----------
  function pct(v, d) { return isFinite(v) ? (v * 100).toFixed(d == null ? 1 : d) + "%" : "—"; }
  function fix(v, d) { return isFinite(v) ? v.toFixed(d == null ? 3 : d) : "—"; }
  function niceTicks(min, max, count) {
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count))), err = count / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var out = [], t = Math.ceil(min / step - 1e-9) * step;
    for (; t <= max + step * 1e-9; t += step) out.push(+t.toFixed(10));
    return out;
  }

  // ---------- tooltip ----------
  function tooltip(container) {
    var tip = h("div", { class: "tooltip", role: "status" });
    container.appendChild(tip);
    return {
      show: function (html, x, y) {
        tip.innerHTML = html; tip.classList.add("on");
        var cw = container.clientWidth, tw = tip.offsetWidth;
        var left = x + 14; if (left + tw > cw) left = Math.max(0, x - tw - 14);
        tip.style.left = left + "px"; tip.style.top = Math.max(0, y - 10) + "px";
      },
      hide: function () { tip.classList.remove("on"); }
    };
  }
  function legendHTML(items) {
    return items.map(function (it) {
      return '<span style="color:' + it.color + '"><i class="' + (it.mark || "") + '"></i><span style="color:var(--ink-dim)">' + esc(it.name) + "</span></span>";
    }).join("");
  }
  function dataTable(container, head, rows) {
    var d = h("details", { class: "data-table" });
    d.appendChild(h("summary", null, "Data table"));
    var wrap = h("div", { class: "table-scroll" });
    var html = "<table class='data'><thead><tr>" + head.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) { html += "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; });
    wrap.innerHTML = html + "</tbody></table>";
    d.appendChild(wrap);
    container.appendChild(d);
  }

  // ---------- line / scatter chart ----------
  // opts: {height, x:{min,max,label,fmt}, y:{min,max,label,fmt},
  //   series:[{name,color,kind:'line'|'dots'|'both',dash,marker,points:[{x,y,lo,hi}]}],
  //   refs:[{y,label,color,dash}], legendExtra:[...], tableHead, tableRows}
  function lineChart(el, opts) {
    el.innerHTML = "";
    el.classList.add("chart");
    var legend = h("div", { class: "legend" });
    el.appendChild(legend);
    var plot = h("div", { style: "position:relative" });
    el.appendChild(plot);
    var tip = tooltip(plot);
    var W = Math.max(300, el.clientWidth || 600), H = opts.height || 280;
    var m = { l: 60, r: 14, t: 10, b: 38 };
    var X = opts.x, Y = opts.y;
    function sx(v) { return m.l + (v - X.min) / (X.max - X.min) * (W - m.l - m.r); }
    function sy(v) { return H - m.b - (v - Y.min) / (Y.max - Y.min) * (H - m.t - m.b); }
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria || "chart" });
    niceTicks(Y.min, Y.max, 5).forEach(function (t) {
      svg.appendChild(s("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
      var tx = s("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end", class: "tick" }); tx.textContent = (Y.fmt || String)(t); tx.setAttribute("style", "font:11px var(--font-mono);fill:var(--ink-dim)"); svg.appendChild(tx);
    });
    (X.ticks || niceTicks(X.min, X.max, Math.max(3, Math.floor(W / 80)))).forEach(function (t) {
      var tx = s("text", { x: sx(t), y: H - m.b + 16, "text-anchor": "middle" }); tx.textContent = (X.fmt || String)(t); tx.setAttribute("style", "font:11px var(--font-mono);fill:var(--ink-dim)"); svg.appendChild(tx);
    });
    svg.appendChild(s("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
    var xt = s("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", class: "axis-title" }); xt.textContent = X.label || ""; svg.appendChild(xt);
    var yt = s("text", { x: 11, y: m.t + (H - m.t - m.b) / 2, "text-anchor": "middle", class: "axis-title", transform: "rotate(-90 11 " + (m.t + (H - m.t - m.b) / 2) + ")" }); yt.textContent = Y.label || ""; svg.appendChild(yt);
    (opts.refs || []).forEach(function (rf) {
      if (rf.points) {
        var d = rf.points.map(function (p, i) { return (i ? "L" : "M") + sx(p.x).toFixed(1) + "," + sy(p.y).toFixed(1); }).join("");
        svg.appendChild(s("path", { d: d, fill: "none", stroke: rf.color, "stroke-width": 2, "stroke-dasharray": rf.dash ? "6 4" : "none" }));
      } else {
        svg.appendChild(s("line", { x1: m.l, x2: W - m.r, y1: sy(rf.y), y2: sy(rf.y), stroke: rf.color, "stroke-width": 1.5, "stroke-dasharray": rf.dash ? "6 4" : "none" }));
      }
    });
    (opts.series || []).forEach(function (se) {
      var pts = se.points.filter(function (p) { return isFinite(p.y); });
      pts.forEach(function (p) {
        if (p.lo != null && p.hi != null) svg.appendChild(s("line", { x1: sx(p.x), x2: sx(p.x), y1: sy(p.lo), y2: sy(p.hi), stroke: se.color, "stroke-width": 1.2, opacity: 0.7 }));
      });
      if (se.kind !== "dots" && pts.length > 1) {
        var d2 = pts.map(function (p, i) { return (i ? "L" : "M") + sx(p.x).toFixed(1) + "," + sy(p.y).toFixed(1); }).join("");
        svg.appendChild(s("path", { d: d2, fill: "none", stroke: se.color, "stroke-width": 2, "stroke-dasharray": se.dash ? "6 4" : "none", "stroke-linejoin": "round" }));
      }
      if (se.kind !== "line") pts.forEach(function (p) {
        if (se.marker === "diamond") svg.appendChild(s("rect", { x: sx(p.x) - 5, y: sy(p.y) - 5, width: 10, height: 10, fill: se.color, transform: "rotate(45 " + sx(p.x) + " " + sy(p.y) + ")", stroke: "var(--bg-panel)", "stroke-width": 2 }));
        else svg.appendChild(s("circle", { cx: sx(p.x), cy: sy(p.y), r: se.r || 4, fill: se.color, stroke: "var(--bg-panel)", "stroke-width": 2 }));
      });
    });
    (opts.refs || []).forEach(function (rf) {
      if (!rf.label) return;
      var ly = rf.points ? sy(rf.points[rf.points.length - 1].y) : sy(rf.y);
      var t = s("text", { x: W - m.r, y: ly - 5, "text-anchor": "end", class: "ref-label" }); t.textContent = rf.label; svg.appendChild(t);
    });
    var hover = s("line", { class: "hover-line", y1: m.t, y2: H - m.b, x1: m.l, x2: m.l, visibility: "hidden" });
    svg.appendChild(hover);
    var hit = s("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
    svg.appendChild(hit);
    plot.appendChild(svg);
    function onMove(ev) {
      var rect = svg.getBoundingClientRect(), scale = W / rect.width, px = (ev.clientX - rect.left) * scale;
      var xv = X.min + (px - m.l) / (W - m.l - m.r) * (X.max - X.min), best = null;
      (opts.series || []).forEach(function (se) { se.points.forEach(function (p) { if (isFinite(p.y) && (best === null || Math.abs(p.x - xv) < Math.abs(best - xv))) best = p.x; }); });
      if (best === null) return;
      hover.setAttribute("x1", sx(best)); hover.setAttribute("x2", sx(best)); hover.setAttribute("visibility", "visible");
      var html = '<div class="t">' + esc(X.label || "x") + " = " + esc((X.fmt || String)(best)) + "</div>";
      (opts.series || []).forEach(function (se) {
        var p = se.points.filter(function (q) { return q.x === best; })[0];
        if (p) html += '<div class="row"><i style="background:' + se.color + '"></i>' + esc(se.name) + ": " + esc((Y.fmt || String)(p.y)) + (p.lo != null ? " ± " + esc((Y.fmtErr || Y.fmt || String)((p.hi - p.lo) / 2)) : "") + "</div>";
      });
      (opts.refs || []).forEach(function (rf) {
        if (!rf.name) return;
        var v = rf.valueAt ? rf.valueAt(best) : rf.points ? (rf.points.filter(function (q) { return q.x === best; })[0] || {}).y : rf.y;
        if (v != null) html += '<div class="row"><i style="background:' + rf.color + '"></i>' + esc(rf.name) + ": " + esc((Y.fmt || String)(v)) + "</div>";
      });
      tip.show(html, sx(best) / scale, (ev.clientY - rect.top));
    }
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerdown", onMove);
    hit.addEventListener("pointerleave", function () { tip.hide(); hover.setAttribute("visibility", "hidden"); });
    var items = (opts.series || []).map(function (se) { return { name: se.name, color: se.color, mark: se.marker === "diamond" ? "diamond" : (se.kind === "dots" ? "dot" : (se.dash ? "dash" : "")) }; })
      .concat((opts.refs || []).filter(function (r) { return r.name; }).map(function (r) { return { name: r.name, color: r.color, mark: r.dash ? "dash" : "" }; }));
    legend.innerHTML = legendHTML(items);
    if (opts.tableHead) dataTable(el, opts.tableHead, opts.tableRows || []);
  }

  // ---------- grouped bar chart ----------
  // opts: {height, categories:[..], y:{min,max,label,fmt}, groups:[{name,color,values:[{v,lo,hi}]}],
  //   ticks:[{name,color,values:[v]}] (short horizontal marks per bar), refs:[{y,label,name,color,dash}]}
  function barChart(el, opts) {
    el.innerHTML = "";
    el.classList.add("chart");
    var legend = h("div", { class: "legend" });
    el.appendChild(legend);
    var plot = h("div", { style: "position:relative" });
    el.appendChild(plot);
    var tip = tooltip(plot);
    var W = Math.max(300, el.clientWidth || 600), H = opts.height || 260, m = { l: 60, r: 12, t: 10, b: 34 };
    var Y = opts.y, cats = opts.categories, G = opts.groups.length;
    var band = (W - m.l - m.r) / cats.length, bw = Math.min(34, (band - 10) / G - 2);
    function sy(v) { return H - m.b - (Math.max(Y.min, Math.min(Y.max, v)) - Y.min) / (Y.max - Y.min) * (H - m.t - m.b); }
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria || "bar chart" });
    niceTicks(Y.min, Y.max, 5).forEach(function (t) {
      svg.appendChild(s("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
      var tx = s("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end" }); tx.textContent = (Y.fmt || String)(t); tx.setAttribute("style", "font:11px var(--font-mono);fill:var(--ink-dim)"); svg.appendChild(tx);
    });
    var yt = s("text", { x: 11, y: m.t + (H - m.t - m.b) / 2, "text-anchor": "middle", class: "axis-title", transform: "rotate(-90 11 " + (m.t + (H - m.t - m.b) / 2) + ")" }); yt.textContent = Y.label || ""; svg.appendChild(yt);
    var zero = sy(Math.max(Y.min, Math.min(Y.max, 0)));
    cats.forEach(function (c, ci) {
      var x0 = m.l + ci * band + (band - G * (bw + 2)) / 2;
      opts.groups.forEach(function (g, gi) {
        var val = g.values[ci]; if (!val || !isFinite(val.v)) return;
        var x = x0 + gi * (bw + 2), y1 = sy(val.v), top = Math.min(y1, zero), hgt = Math.max(1, Math.abs(zero - y1));
        svg.appendChild(s("rect", { x: x, y: top, width: bw, height: hgt, rx: 3, fill: g.color, opacity: 0.85 }));
        if (val.lo != null) svg.appendChild(s("line", { x1: x + bw / 2, x2: x + bw / 2, y1: sy(val.lo), y2: sy(val.hi), stroke: "var(--ink)", "stroke-width": 1.2 }));
        (opts.ticks || []).forEach(function (tk) {
          var tv = tk.values[ci] && tk.values[ci][gi]; if (tv == null) return;
          svg.appendChild(s("line", { x1: x - 3, x2: x + bw + 3, y1: sy(tv), y2: sy(tv), stroke: tk.color, "stroke-width": 2.5 }));
        });
      });
      var tx = s("text", { x: m.l + ci * band + band / 2, y: H - m.b + 16, "text-anchor": "middle" }); tx.textContent = c; tx.setAttribute("style", "font:11px var(--font-mono);fill:var(--ink-dim)"); svg.appendChild(tx);
      var hit = s("rect", { x: m.l + ci * band, y: m.t, width: band, height: H - m.t - m.b, fill: "transparent" });
      function show(ev) {
        var rect = svg.getBoundingClientRect(), scale = W / rect.width;
        var html = '<div class="t">' + esc(c) + "</div>";
        opts.groups.forEach(function (g) { var v = g.values[ci]; if (v && isFinite(v.v)) html += '<div class="row"><i style="background:' + g.color + '"></i>' + esc(g.name) + ": " + esc((Y.fmt || String)(v.v)) + (v.lo != null ? " ± " + esc((Y.fmtErr || Y.fmt || String)((v.hi - v.lo) / 2)) : "") + "</div>"; });
        (opts.ticks || []).forEach(function (tk) { var tv = tk.values[ci]; if (tv) tv.forEach(function (x) { if (x != null) html += '<div class="row"><i style="background:' + tk.color + '"></i>' + esc(tk.name) + ": " + esc((Y.fmt || String)(x)) + "</div>"; }); });
        if (opts.extraTip) html += opts.extraTip(ci);
        tip.show(html, (m.l + ci * band + band / 2) / scale, ev.clientY - rect.top);
      }
      hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", function () { tip.hide(); });
      if (opts.onClick) hit.addEventListener("click", function () { opts.onClick(ci); });
      hit.style.cursor = opts.onClick ? "pointer" : "default";
      svg.appendChild(hit);
    });
    svg.appendChild(s("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: zero, y2: zero }));
    (opts.refs || []).forEach(function (rf) {
      var ln = s("line", { x1: m.l, x2: W - m.r, y1: sy(rf.y), y2: sy(rf.y), stroke: rf.color, "stroke-width": 1.5, "stroke-dasharray": rf.dash ? "6 4" : "none" });
      ln.style.pointerEvents = "none";
      svg.appendChild(ln);
      if (rf.label) { var t = s("text", { x: W - m.r, y: sy(rf.y) - 5, "text-anchor": "end", class: "ref-label" }); t.textContent = rf.label; t.style.pointerEvents = "none"; svg.appendChild(t); }
    });
    plot.appendChild(svg);
    var items = opts.groups.map(function (g) { return { name: g.name, color: g.color, mark: "bar" }; })
      .concat((opts.ticks || []).map(function (t) { return { name: t.name, color: t.color }; }))
      .concat((opts.refs || []).filter(function (r) { return r.name; }).map(function (r) { return { name: r.name, color: r.color, mark: r.dash ? "dash" : "" }; }));
    legend.innerHTML = legendHTML(items);
    if (opts.tableHead) dataTable(el, opts.tableHead, opts.tableRows || []);
  }

  // ---------- circuit drawer (for NonLocal.Clifford circuits) ----------
  var GLYPH = { H: "H", S: "S", SDG: "S†", X: "X", Y: "Y", Z: "Z" };
  function drawCircuit(el, circuit, labels, opts) {
    opts = opts || {};
    el.innerHTML = ""; el.classList.add("circuit");
    var n = circuit.n, rowH = opts.rowH || 30, colW = 32, lw = opts.labelW || 34;
    // Two-qubit gates in one moment whose spans overlap get their own lane,
    // so (A1,B1) and (A2,B2) never read as a single three-qubit gate.
    var layout = circuit.moments.map(function (mo) {
      var lanes = [];
      var placed = mo.map(function (o) {
        if (o.q.length < 2) return 0;
        var lo = Math.min(o.q[0], o.q[1]), hi = Math.max(o.q[0], o.q[1]);
        for (var L = 0; ; L++) {
          lanes[L] = lanes[L] || [];
          if (!lanes[L].some(function (sp) { return !(hi < sp[0] || lo > sp[1]); })) { lanes[L].push([lo, hi]); return L; }
        }
      });
      return { lanes: Math.max(1, lanes.length), placed: placed };
    });
    var xs = [], x = lw;
    layout.forEach(function (L) { xs.push(x); x += colW * (L.lanes > 1 ? 0.62 * L.lanes + 0.38 : 1); });
    var measX = x, W = x + (opts.measure === false ? 0 : colW) + 10, H = n * rowH + 6;
    var svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria || "circuit diagram" });
    function y(q) { return 3 + q * rowH + rowH / 2; }
    for (var q = 0; q < n; q++) {
      svg.appendChild(s("line", { class: "wire", x1: lw - 4, x2: W - 6, y1: y(q), y2: y(q) }));
      var t = s("text", { class: "wlabel", x: lw - 8, y: y(q) + 4, "text-anchor": "end" }); t.textContent = labels ? labels[q] : "q" + q; svg.appendChild(t);
    }
    circuit.moments.forEach(function (mo, ci) {
      var L = layout[ci], wM = colW * (L.lanes > 1 ? 0.62 * L.lanes + 0.38 : 1), mid = xs[ci] + wM / 2;
      mo.forEach(function (o, oi) {
        if (o.q.length === 2) {
          var cx = L.lanes > 1 ? xs[ci] + colW * 0.5 + L.placed[oi] * colW * 0.62 : mid;
          svg.appendChild(s("line", { class: "cz", x1: cx, x2: cx, y1: y(o.q[0]), y2: y(o.q[1]) }));
          o.q.forEach(function (qq) { svg.appendChild(s("circle", { class: "czdot", cx: cx, cy: y(qq), r: 4.5 })); });
        } else {
          var g = o.g, cls = g === "H" ? "gbox h" : (g === "S" || g === "SDG") ? "gbox s" : "gbox";
          svg.appendChild(s("rect", { class: cls, x: mid - 11, y: y(o.q[0]) - 11, width: 22, height: 22, rx: 4 }));
          var tt = s("text", { class: "gtext", x: mid, y: y(o.q[0]) + 4, "text-anchor": "middle" }); tt.textContent = GLYPH[g] || g; svg.appendChild(tt);
        }
      });
    });
    if (opts.measure !== false) {
      var mx = measX + colW / 2;
      (circuit.measured || Array.apply(null, Array(n)).map(function (_, i) { return i; })).forEach(function (qq) {
        svg.appendChild(s("rect", { class: "meter", x: mx - 11, y: y(qq) - 11, width: 22, height: 22, rx: 4 }));
        svg.appendChild(s("path", { d: "M" + (mx - 7) + "," + (y(qq) + 5) + " A8,8 0 0 1 " + (mx + 7) + "," + (y(qq) + 5), fill: "none", stroke: "var(--ink-dim)", "stroke-width": 1.3 }));
        svg.appendChild(s("line", { x1: mx, y1: y(qq) + 5, x2: mx + 5, y2: y(qq) - 6, stroke: "var(--ink-dim)", "stroke-width": 1.3 }));
      });
    }
    el.appendChild(svg);
  }

  // ---------- segmented control ----------
  function seg(el, options, value, onChange) {
    el.innerHTML = ""; el.classList.add("seg"); el.setAttribute("role", "group");
    var cur = value;
    options.forEach(function (o) {
      var b = h("button", { type: "button", "aria-pressed": String(o.value === cur) }, esc(o.label));
      b.addEventListener("click", function () {
        cur = o.value;
        Array.prototype.forEach.call(el.children, function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        onChange(cur);
      });
      el.appendChild(b);
    });
    return { get: function () { return cur; } };
  }

  // ---------- noise controls ----------
  // spec: [{key, label, max}] ; values in probability units; log sliders.
  var PRESETS = [{ label: "Ideal", f: 0 }, { label: "Paper", f: 1 }, { label: "3× worse", f: 3 }, { label: "10× better", f: 0.1 }];
  function noisePanel(el, spec, base, onChange) {
    el.innerHTML = "";
    var vals = {};
    spec.forEach(function (p) { vals[p.key] = base[p.key]; });
    var top = h("div", { class: "controls" });
    var presetCtl = h("div", { class: "control" }); presetCtl.appendChild(h("span", { class: "lab" }, "Noise preset"));
    var segEl = h("div"); presetCtl.appendChild(segEl); top.appendChild(presetCtl);
    el.appendChild(top);
    var sliders = h("div", { class: "controls" });
    el.appendChild(sliders);
    var LO = -5;
    function toSlider(v, max) { return v <= 0 ? 0 : Math.max(1, Math.round((Math.log10(v) - LO) / (Math.log10(max) - LO) * 100)); }
    function fromSlider(x, max) { return x <= 0 ? 0 : Math.pow(10, LO + x / 100 * (Math.log10(max) - LO)); }
    var inputs = {};
    spec.forEach(function (p) {
      var c = h("div", { class: "control" });
      var id = "nz-" + p.key + "-" + Math.random().toString(36).slice(2, 7);
      c.appendChild(h("label", { for: id }, esc(p.label)));
      var row = h("div", { class: "range-row" });
      var inp = h("input", { type: "range", min: "0", max: "100", step: "1", id: id });
      var out = h("output", { for: id });
      inp.value = toSlider(vals[p.key], p.max);
      out.textContent = pct(vals[p.key], vals[p.key] < 0.001 ? 3 : 2);
      inp.addEventListener("input", function () { vals[p.key] = fromSlider(+inp.value, p.max); out.textContent = pct(vals[p.key], vals[p.key] < 0.001 ? 3 : 2); fire(); });
      row.appendChild(inp); row.appendChild(out); c.appendChild(row); sliders.appendChild(c);
      inputs[p.key] = { inp: inp, out: out, max: p.max };
    });
    var t = null;
    function fire() { clearTimeout(t); t = setTimeout(function () { onChange(get()); }, 60); }
    function set(v) {
      spec.forEach(function (p) {
        vals[p.key] = v[p.key]; var I = inputs[p.key];
        I.inp.value = toSlider(vals[p.key], I.max); I.out.textContent = pct(vals[p.key], vals[p.key] < 0.001 ? 3 : 2);
      });
      fire();
    }
    function get() { var o = {}; Object.keys(vals).forEach(function (k) { o[k] = vals[k]; }); return o; }
    seg(segEl, PRESETS.map(function (p, i) { return { value: i, label: p.label }; }), 1, function (i) {
      var f = PRESETS[i].f, v = {};
      spec.forEach(function (p) { v[p.key] = base[p.key] * f; });
      set(v);
    });
    return { get: get, set: set };
  }

  // ---------- time-sliced jobs ----------
  // step() does a little work and returns a fraction done in [0, 1]
  // (>= 1 means finished). Runs ~budget ms per slice, then yields.
  function job(step, opts) {
    opts = opts || {};
    var budget = opts.budget || 12, cancelled = false;
    function slice() {
      if (cancelled) return;
      var t0 = performance.now(), f = 0;
      do { f = step(); } while (f < 1 && performance.now() - t0 < budget);
      if (opts.onProgress) opts.onProgress(Math.min(1, f));
      if (f >= 1) { if (opts.onDone) opts.onDone(); return; }
      setTimeout(slice, 0);
    }
    setTimeout(slice, 0);
    return { cancel: function () { cancelled = true; } };
  }

  // Re-render callback on width change or theme change (charts use CSS vars
  // so theme is automatic; width needs a redraw for crisp text).
  function onResize(el, fn) {
    var last = el.clientWidth, t = null;
    function check() { if (Math.abs(el.clientWidth - last) > 8) { last = el.clientWidth; fn(); } }
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(function () { clearTimeout(t); t = setTimeout(check, 80); }).observe(el);
    else window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(check, 80); });
  }

  window.PaperUI = { h: h, esc: esc, nav: nav, pct: pct, fix: fix, lineChart: lineChart, barChart: barChart, drawCircuit: drawCircuit, seg: seg, noisePanel: noisePanel, job: job, onResize: onResize, PAPER_URL: PAPER_URL };
})();

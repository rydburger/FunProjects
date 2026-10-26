// =========================================================
// Error Correction Zoo Tycoon — park model.
//
// The whole zoo: a lot of enclosures, the animals and keepers in them,
// cash, reputation, investors and the clock. Pure game logic with no DOM,
// so it can be unit-tested in Node; index.html renders it.
//
// Money flows continuously: ticket revenue and running costs (salaries +
// upkeep of open enclosures) accrue every tick as 1/24 of their daily
// rate; building, animals, courses, research and vet bills are paid at
// once. A "day" event summarises each day's books and a "month" event
// every 30 days.
//
// Construction. An enclosure is paid for when it's ordered and opens
// `days` later (BIOMES[].buildDays, or Habitat.buildDays for a workshop
// design). Until then it has no upkeep and holds no animals.
//
// The company. It starts with a seed round (ROUNDS[0]) and raises round
// after round until it lists (the IPO wins the game). The player starts
// a raise; for FUNDING.roadshowDays investors tour the zoo, and at the
// end they value it (Investors.valuation, which rises with revenue,
// growth, animals × distance², species, lab upgrades, the round's
// roadmap and investor confidence). At or above the round's target the
// round closes: cash in, part of the company sold, a bigger lot. Short of
// it there may be a bridge offer, or a pass and a cooldown. Investors also
// drop by for routine tours. During a tour the player can wine and dine
// them (PERKS). Lose: in debt at the end of ECONOMY.bankruptDays
// consecutive days ("ran out of runway").
//
// Staff. Keepers and exhibits are many-to-many. A keeper splits their
// time between the stocked exhibits they look after, in proportion to
// each one's weight (bigger codes need more) shared among the keepers
// present there. An exhibit runs the most senior present keeper's
// algorithm at the pooled speed of everyone's share (ExhibitSim falls
// back to cheaper decoders, then skips rounds, if that's too slow). The
// same load wears keepers out (staff.js): they book holidays, fall sick,
// burn out and, if morale sinks, resign. Away keepers don't decode.
// They gain experience (xp = rounds decoded), which makes them faster,
// and can take a course to learn the next decoder.
//
// The lab. One research project at a time raises one dial of LAB
// (zoo-data.js) by a level. Every exhibit picks up the new hardware when
// it completes.
//
// Discovery and the blueprint book. Only the species in START_KNOWN are
// known at first. A habitat built in the workshop (designs are described
// in habitat.js) discovers its species when it opens: a textbook one,
// recognised whatever the qubit numbering, unlocks its catalogue habitat;
// a code nobody has catalogued becomes a new species with a computed
// placard. Every design built goes into the book (park.book.designs) and
// can be built again, or deleted. A habitat holds one animal per logical
// qubit (k of them).
//
// Browser: load after ../stabilizer.js, ../detectors.js, zoo-data.js,
// habitat.js, exhibit-sim.js, staff.js, investors.js; exposes
// `window.Park`. Node: require("./park.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;
  var X = isNode ? require("./exhibit-sim.js") : root.ExhibitSim;
  var S = isNode ? require("../stabilizer.js") : root.Stabilizer;
  var Hab = isNode ? require("./habitat.js") : root.Habitat;
  var Staff = isNode ? require("./staff.js") : root.Staff;
  var Inv = isNode ? require("./investors.js") : root.Investors;
  var ECO = Z.ECONOMY, TPD = ECO.ticksPerDay;
  var DAYS_PER_MONTH = 30;

  function createPark(opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random, seed = Z.ROUNDS[0];
    var park = {
      width: 0, height: 0, lotLevel: 0,
      grid: [],                          // cell -> exhibit id
      exhibits: {},                      // id -> exhibit record
      order: [],                         // ids in build order
      nextId: 1,
      cash: ECO.startingCash,
      reputation: ECO.startingReputation,
      confidence: Z.CONFIDENCE.start,    // investor confidence, 0–100
      tick: 0,                           // absolute hours since opening
      today: freshDay(),
      yesterday: null,
      month: freshMonth(),
      history: [],                       // daily books, newest last (ECO.historyDays)
      status: "playing",                 // "playing" | "won" (listed) | "lost"
      freePlay: false,                   // keep running after the IPO
      endDay: null,                      // day the game was won or lost
      daysInDebt: 0,
      totalSick: 0,
      keepers: {},                       // id -> keeper record
      keeperOrder: [],
      nextKeeperId: 1,
      lab: { levels: { coherence: 0, gates: 0, readout: 0, cycle: 0 }, project: null },
      book: freshBook(opts.known || Z.START_KNOWN),
      funding: {
        round: 1,                        // index into ROUNDS of the next round
        stake: 1 - seed.raised / seed.valuation, // founders' share
        valuation: seed.valuation,       // post-money of the last round
        history: [{ round: 0, name: seed.name, day: 0, valuation: seed.valuation, raised: seed.raised }],
        raise: null,                     // { round, startTick, untilTick, tours: [score] }
        offer: null,                     // a bridge on the table: { round, valuation, share, cash }
        cooldownUntil: 0,
        milestones: {}                   // round id -> { metric: true } already celebrated
      },
      tour: null,                        // the investor on site, if any
      nextTourTick: 0,
      rng: rng
    };
    setLot(park, 0);
    park.nextTourTick = tourTickAfter(park, randomDays(park, Z.TOURS.everyDays));
    return park;
  }
  // known: species id -> tick discovered; designs: [{ id, name,
  // speciesId, layout, retired }]; custom: species id -> uncatalogued species.
  function freshBook(known) {
    var b = { known: {}, designs: [], custom: {}, nextDesign: 1, nextCustom: 1 };
    known.forEach(function (id) { b.known[id] = 0; });
    return b;
  }
  function freshDay() { return { revenue: 0, expenses: 0, vet: 0, visitors: 0, sick: 0, sickBy: {} }; }
  function freshMonth() { return { revenue: 0, expenses: 0, vet: 0, visitors: 0, sick: 0, sickBy: {} }; }

  function day(park) { return Math.floor(park.tick / TPD) + 1; }
  function hour(park) { return park.tick % TPD; }
  function dayIndex(park) { return Math.floor(park.tick / TPD); } // 0-based, for staff
  function randomDays(park, range) { return range[0] + Math.floor(park.rng() * (range[1] - range[0] + 1)); }

  // ---------- the lot ----------
  function setLot(park, level) {
    var lots = ECO.lots, dims = lots[Math.min(level, lots.length - 1)];
    park.lotLevel = level;
    park.width = Math.max(park.width, dims[0]);
    park.height = Math.max(park.height, dims[1]);
    park.grid = new Array(park.width * park.height).fill(null);
    park.order.forEach(function (id) { stamp(park, park.exhibits[id], id); });
  }
  function stamp(park, rec, value) {
    rec.cells.forEach(function (c) { park.grid[(rec.y + c[1]) * park.width + (rec.x + c[0])] = value; });
  }
  // A rectangle's cells (saves from before shaped plots).
  function rectCells(w, h) {
    var cells = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) cells.push([x, y]);
    return cells;
  }

  // ---------- species and habitats ----------
  function isKnown(park, speciesId) { return Object.prototype.hasOwnProperty.call(park.book.known, speciesId); }
  // Attach a value that save() leaves out (it's rebuilt on load).
  function hidden(obj, key, value) {
    Object.defineProperty(obj, key, { value: value, enumerable: false, configurable: true, writable: true });
    return value;
  }
  // A catalogue species, or one discovered in this park.
  function speciesInfo(park, id) {
    if (Z.SPECIES[id]) return Z.SPECIES[id];
    var sp = park.book.custom[id];
    if (!sp) return null;
    if (!sp.code) {
      var ops = sp.checks.map(S.fromString);
      hidden(sp, "code", S.analyzeChecks(sp.n, ops).code);
      sp.code.name = sp.name;
    }
    return sp;
  }
  // Code distance of a species (a lower bound if the search gave up).
  var distanceCache = new WeakMap();
  function speciesDistance(park, id) {
    var sp = speciesInfo(park, id);
    if (sp.custom) return sp.d !== null ? sp.d : sp.dAtLeast;
    if (!distanceCache.has(sp.code)) {
      var r = S.codeDistance(sp.code);
      distanceCache.set(sp.code, r.d !== null ? r.d : r.atLeast);
    }
    return distanceCache.get(sp.code);
  }
  // A book design's analysis (cached on the entry).
  function designSim(entry) {
    if (!entry.sim) {
      var a = Hab.analyze(entry.layout, { budget: 1 }); // the distance isn't needed to simulate
      if (!a.code) throw new Error("Design " + entry.id + " doesn't hold an animal");
      hidden(entry, "sim", { code: a.code, checks: a.ops });
    }
    return entry.sim;
  }
  function designEntry(park, id) {
    for (var i = 0; i < park.book.designs.length; i++) if (park.book.designs[i].id === id) return park.book.designs[i];
    return null;
  }
  // What every enclosure has, catalogue or designed: { name, cost,
  // upkeep, footprint, channel, blurb, designed, entry, checks }.
  function habitatOf(park, rec) {
    if (rec.biomeId) {
      var b = Z.BIOMES[rec.biomeId];
      return { name: b.name, cost: b.cost, upkeep: b.upkeep, footprint: [rec.w, rec.h], tiles: rec.cells.length, channel: b.climate.channel, blurb: b.blurb,
        designed: false, checks: b.checks.length, days: b.buildDays };
    }
    var e = designEntry(park, rec.designId);
    return { name: e.name, cost: rec.cost, upkeep: rec.upkeep, footprint: [rec.w, rec.h], tiles: rec.cells.length, channel: "depolarizing", designed: true, entry: e,
      checks: e.layout.checks.length, days: rec.days,
      blurb: "Your own design: " + e.layout.qubits.length + " data qubits, " + e.layout.checks.length + " checks, " +
        Hab.wireCount(e.layout) + " wires." };
  }
  // Every species the park knows about, as identify() candidates.
  function knownCandidates(park) {
    var c = Hab.textbook();
    Object.keys(park.book.custom).forEach(function (id) { c.push({ id: id, code: speciesInfo(park, id).code }); });
    return c;
  }
  function isOpen(rec) { return !rec.building; }
  function daysLeft(park, rec) { return rec.building ? Math.max(0, Math.ceil((rec.buildUntil - park.tick) / TPD)) : 0; }

  // ---------- building ----------
  // Every plot has a shape (cells, see Habitat.normalize) that can be
  // turned a quarter turn at a time (`rot`) before it's placed with its
  // bounding box's corner at (x, y). Shapes interlock: only the tiles
  // themselves have to be free.
  function biomeCells(biomeId, rot) { return Hab.rotate(Z.BIOMES[biomeId].cells, rot); }
  function designCells(park, design, rot) { return Hab.rotate(studyDesign(park, design).analysis.cells, rot); }
  function fits(park, x, y, cells) {
    for (var i = 0; i < cells.length; i++) {
      var cx = x + cells[i][0], cy = y + cells[i][1];
      if (cx < 0 || cy < 0 || cx >= park.width || cy >= park.height) return { ok: false, reason: "Doesn't fit inside the lot." };
      if (park.grid[cy * park.width + cx] !== null) return { ok: false, reason: "Overlaps another enclosure." };
    }
    return { ok: true, reason: null };
  }
  function canBuild(park, biomeId, x, y, rot) {
    var biome = Z.BIOMES[biomeId];
    if (!biome) return { ok: false, reason: "No such habitat." };
    if (!isKnown(park, biome.native)) {
      return { ok: false, reason: "Nobody here knows how to keep the " + Z.SPECIES[biome.native].name +
        " yet. Discover it by building a working habitat for it in the workshop." };
    }
    var f = fits(park, x, y, biomeCells(biomeId, rot));
    if (!f.ok) return f;
    if (park.cash < biome.cost) return { ok: false, reason: "Not enough funding (" + dollars(biome.cost) + " needed)." };
    return { ok: true, reason: null };
  }
  function dollars(v) { return "$" + Math.round(v).toLocaleString("en-US"); }
  function occupy(park, rec, cost, days) {
    var fp = Hab.bounds(rec.cells);
    rec.w = fp[0]; rec.h = fp[1];
    rec.building = true;
    rec.buildStart = park.tick;
    rec.buildUntil = park.tick + days * TPD;
    rec.keeperIds = [];
    rec.animal = null;
    stamp(park, rec, rec.id);
    park.exhibits[rec.id] = rec;
    park.order.push(rec.id);
    park.cash -= cost;
  }
  function build(park, biomeId, x, y, rot) {
    var check = canBuild(park, biomeId, x, y, rot);
    if (!check.ok) return check;
    var b = Z.BIOMES[biomeId], id = park.nextId++;
    var rec = {
      id: id, biomeId: biomeId, x: x, y: y, cells: biomeCells(biomeId, rot),
      number: park.order.filter(function (o) { return park.exhibits[o].biomeId === biomeId; }).length + 1,
      builtTick: park.tick
    };
    occupy(park, rec, b.cost, b.buildDays);
    return { ok: true, exhibit: rec };
  }

  // What a design would hold: { analysis, speciesId (null: a species
  // nobody has catalogued), known (already discovered here), entry (the
  // same design already in the book, or null) }.
  var studyCache = {}, studyCount = 0;
  function studyDesign(park, design) {
    var key = JSON.stringify(design);
    var hit = studyCache[key];
    if (!hit) {
      if (++studyCount > 200) { studyCache = {}; studyCount = 1; }
      var a = Hab.analyze(design);
      hit = { analysis: a, textbook: a.valid ? Hab.identify(a.code, Hab.textbook()) : null };
      studyCache[key] = hit;
    }
    var match = hit.textbook;
    if (!match && hit.analysis.valid) {
      var custom = Object.keys(park.book.custom).map(function (id) { return { id: id, code: speciesInfo(park, id).code }; });
      match = Hab.identify(hit.analysis.code, custom);
    }
    var entry = null;
    park.book.designs.forEach(function (e) { if (!entry && layoutKey(e) === key) entry = e; });
    return { analysis: hit.analysis, speciesId: match ? match.id : null, known: !!match && isKnown(park, match.id), entry: entry };
  }
  function layoutKey(entry) {
    if (!entry.key) hidden(entry, "key", JSON.stringify(entry.layout));
    return entry.key;
  }
  function canBuildDesign(park, design, x, y, rot) {
    var bad = Hab.malformed(design);
    if (bad) return { ok: false, reason: bad };
    var st = studyDesign(park, design), a = st.analysis;
    if (!a.valid) return { ok: false, reason: a.problems[0], study: st };
    var f = fits(park, x, y, Hab.rotate(a.cells, rot));
    if (!f.ok) return { ok: false, reason: f.reason, study: st };
    if (park.cash < a.cost) return { ok: false, reason: "Not enough funding (" + dollars(a.cost) + " needed).", study: st };
    return { ok: true, reason: null, study: st };
  }
  // Build a design at (x, y). opts: { name } for a species nobody has
  // catalogued, { rot } quarter turns. Its species is discovered when the
  // habitat opens.
  // Returns { ok, exhibit, speciesId, discovers (it will discover a
  // species when it opens), newSpecies (uncatalogued), entry (its book entry) }.
  function buildDesign(park, design, x, y, opts) {
    opts = opts || {};
    var c = canBuildDesign(park, design, x, y, opts.rot);
    if (!c.ok) return c;
    var st = c.study, a = st.analysis, speciesId = st.speciesId, newSpecies = false;
    if (!speciesId) {
      newSpecies = true;
      speciesId = "c" + park.book.nextCustom++;
      var gl = Z.CUSTOM.glyphs, num = park.book.nextCustom - 1;
      var d = a.d !== null ? a.d : a.dAtLeast;
      var sp = {
        id: speciesId, custom: true,
        name: (opts.name && String(opts.name).trim().slice(0, 40)) || "Wild code no. " + num,
        glyph: gl[(num - 1) % gl.length], appeal: Hab.customAppeal(d), cost: Hab.customCost(d),
        n: a.n, k: a.k, d: a.d, dAtLeast: a.dAtLeast,
        params: "[[" + a.n + "," + a.k + "," + (a.d !== null ? a.d : "≥" + a.dAtLeast) + "]]" + (a.k > 1 ? " (" + a.k + " animals)" : ""),
        checks: a.code.stabilizers.map(S.toString), discoveredTick: null
      };
      park.book.custom[speciesId] = sp;
      hidden(sp, "code", a.code);
    }
    var entry = st.entry;
    if (!entry) {
      var spName = speciesInfo(park, speciesId).name, same = park.book.designs.filter(function (e) { return e.speciesId === speciesId; }).length;
      entry = { id: park.book.nextDesign++, name: spName + " habitat" + (same ? " " + (same + 1) : ""), speciesId: speciesId, layout: Hab.clone(design) };
      park.book.designs.push(entry);
    }
    entry.retired = false;
    var id = park.nextId++;
    var rec = {
      id: id, biomeId: null, designId: entry.id, x: x, y: y, cells: Hab.rotate(a.cells, opts.rot),
      number: park.order.filter(function (o) { return park.exhibits[o].designId === entry.id; }).length + 1,
      cost: a.cost, upkeep: a.upkeep, days: a.days, builtTick: park.tick,
      discovers: isKnown(park, speciesId) ? null : speciesId
    };
    occupy(park, rec, a.cost, a.days);
    return { ok: true, exhibit: rec, speciesId: speciesId, discovers: !!rec.discovers, newSpecies: newSpecies, entry: entry };
  }
  // Rename a species discovered here (catalogued ones keep their names).
  function renameSpecies(park, id, name) {
    var sp = park.book.custom[id];
    name = String(name || "").trim().slice(0, 40);
    if (!sp || !name) return { ok: false, reason: "Can't rename that." };
    sp.name = name;
    if (sp.code) sp.code.name = name;
    return { ok: true };
  }
  // ---------- the blueprint book ----------
  function designInUse(park, designId) {
    return park.order.some(function (id) { return park.exhibits[id].designId === designId; });
  }
  // Delete a blueprint. One that enclosures still use leaves the build
  // menu now and the book once the last of them is demolished.
  function deleteDesign(park, designId) {
    var e = designEntry(park, designId);
    if (!e) return { ok: false, reason: "No such blueprint." };
    if (designInUse(park, designId)) { e.retired = true; return { ok: true, retired: true }; }
    park.book.designs = park.book.designs.filter(function (d) { return d.id !== designId; });
    return { ok: true, retired: false };
  }
  function pruneDesign(park, designId) {
    var e = designEntry(park, designId);
    if (e && e.retired && !designInUse(park, designId)) deleteDesign(park, designId);
  }
  // Can an uncatalogued species be dropped from the field guide (and its
  // blueprints from the book)? Only while nothing in the zoo holds it.
  function canForgetSpecies(park, id) {
    if (!park.book.custom[id]) return { ok: false, reason: "Only species discovered here can be dropped." };
    var used = park.order.some(function (eid) {
      var rec = park.exhibits[eid], e = rec.designId && designEntry(park, rec.designId);
      return (rec.animal && rec.animal.speciesId === id) || (e && e.speciesId === id);
    });
    return used ? { ok: false, reason: "Demolish its habitats first." } : { ok: true, reason: null };
  }
  function forgetSpecies(park, id) {
    var c = canForgetSpecies(park, id);
    if (!c.ok) return c;
    delete park.book.custom[id];
    delete park.book.known[id];
    park.book.designs = park.book.designs.filter(function (e) { return e.speciesId !== id; });
    return { ok: true };
  }

  function exhibitAt(park, x, y) {
    if (x < 0 || y < 0 || x >= park.width || y >= park.height) return null;
    var id = park.grid[y * park.width + x];
    return id === null ? null : park.exhibits[id];
  }
  // Demolishing refunds part of the build cost (also mid-construction);
  // the animals are rehomed (lost, no refund) and the keepers stay on
  // the payroll, minus this exhibit.
  function demolish(park, id) {
    var rec = park.exhibits[id];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    rec.keeperIds.slice().forEach(function (kid) { unassignKeeper(park, kid, id); });
    stamp(park, rec, null);
    delete park.exhibits[id];
    park.order = park.order.filter(function (o) { return o !== id; });
    if (park.tour) park.tour.route = park.tour.route.filter(function (o) { return o !== id; });
    var refund = Math.round(habitatOf(park, rec).cost * ECO.demolishRefund);
    park.cash += refund;
    if (rec.designId) pruneDesign(park, rec.designId);
    return { ok: true, refund: refund };
  }

  // ---------- animals ----------
  // Animals per enclosure: one per logical qubit.
  function animalCount(park, speciesId) { return speciesInfo(park, speciesId).code.logicalX.length; }
  // Price of stocking an enclosure with this species (every animal).
  function stockCost(park, speciesId) { return speciesInfo(park, speciesId).cost * animalCount(park, speciesId); }
  // Can this species live here? A designed habitat holds exactly the
  // species it was identified as; a catalogue one, its native species.
  function placement(park, rec, speciesId) {
    if (!isKnown(park, speciesId)) return { ok: false, reason: "Not discovered yet." };
    if (rec.designId) {
      var e = designEntry(park, rec.designId);
      return e.speciesId === speciesId ? { ok: true, reason: null }
        : { ok: false, reason: "This habitat measures the stabilizers of the " + speciesInfo(park, e.speciesId).name + ", a different code." };
    }
    if (!Z.SPECIES[speciesId]) return { ok: false, reason: "It only lives in habitats built from its own design." };
    return Z.checkPlacement(speciesId, rec.biomeId);
  }
  // Every known species, with whether it can live in this enclosure and why not.
  function speciesOptions(park, id) {
    var rec = park.exhibits[id];
    var ids = Object.keys(Z.SPECIES).concat(Object.keys(park.book.custom)).filter(function (sid) { return isKnown(park, sid); });
    return ids.map(function (sid) {
      var pl = placement(park, rec, sid), cost = stockCost(park, sid);
      return { speciesId: sid, ok: pl.ok, reason: pl.reason, cost: cost, animals: animalCount(park, sid), affordable: park.cash >= cost };
    });
  }
  // How an exhibit's animal is simulated: the catalogue species' own
  // generators, or a designed habitat's checks.
  function simFor(park, rec) {
    return rec.designId ? designSim(designEntry(park, rec.designId)) : { code: null, checks: null };
  }
  function buyAnimal(park, id, speciesId) {
    var rec = park.exhibits[id];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    if (rec.building) return { ok: false, reason: "Still under construction (" + daysLeft(park, rec) + " days to go)." };
    if (rec.animal) return { ok: false, reason: "This enclosure already has a resident." };
    if (!speciesInfo(park, speciesId)) return { ok: false, reason: "No such species." };
    var pl = placement(park, rec, speciesId);
    if (!pl.ok) return pl;
    var cost = stockCost(park, speciesId);
    if (park.cash < cost) return { ok: false, reason: "Not enough funding (" + dollars(cost) + " needed)." };
    park.cash -= cost;
    rec.animalTick = park.tick;
    var sim = simFor(park, rec);
    rec.animal = X.createExhibit({
      speciesId: speciesId, code: sim.code, checks: sim.checks, channel: habitatOf(park, rec).channel,
      lab: labValues(park), keeper: null, rng: park.rng
    });
    syncDuty(park);
    return { ok: true };
  }

  // ---------- staff ----------
  function keeperSpeed(k) {
    var sp = Z.KEEPER_SPEED;
    return Math.min(sp.max, sp.base + k.xp * sp.perXp);
  }
  function keeperSalary(k) { return Z.KEEPER_LEVELS[k.level].salary; }
  function keeperPresent(k) { return Staff.present(k); }
  // How much looking after an exhibit takes (bigger codes need more).
  function exhibitWeight(park, rec) {
    var w = Z.STAFF.keeper.exhibitWeight;
    return w.base + w.perCheck * (rec.animal ? rec.animal.mem.checks.length : habitatOf(park, rec).checks);
  }
  // Who is decoding where right now. Returns
  //   { loads: keeper id -> load, exhibits: exhibit id -> { level, speed,
  //     shares: keeper id -> speed share } | null }.
  // Only stocked, open exhibits need anyone. `assumeAllPresent` gives the
  // planned split (for costs), ignoring who's away.
  function staffing(park, assumeAllPresent) {
    var here = {}, loads = {}, out = {};
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (!rec.animal) return;
      here[id] = rec.keeperIds.filter(function (kid) { return assumeAllPresent || keeperPresent(park.keepers[kid]); });
    });
    park.keeperOrder.forEach(function (kid) {
      var k = park.keepers[kid], L = 0;
      if (!assumeAllPresent && !keeperPresent(k)) { loads[kid] = 0; return; }
      k.exhibitIds.forEach(function (eid) { if (here[eid]) L += exhibitWeight(park, park.exhibits[eid]) / here[eid].length; });
      loads[kid] = L;
    });
    Object.keys(here).forEach(function (id) {
      var ids = here[id];
      if (!ids.length) { out[id] = null; return; }
      var rec = park.exhibits[id], w = exhibitWeight(park, rec) / ids.length, speed = 0, level = 0, shares = {};
      ids.forEach(function (kid) {
        var k = park.keepers[kid], s = keeperSpeed(k) * w / loads[kid];
        shares[kid] = s; speed += s; level = Math.max(level, k.level);
      });
      out[id] = { level: level, speed: speed, shares: shares };
    });
    return { loads: loads, exhibits: out };
  }
  // Push the current staffing into every animal's simulation.
  function syncDuty(park) {
    var st = staffing(park, false);
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (rec.animal) X.setKeeper(rec.animal, st.exhibits[id] || null);
    });
    return st;
  }
  // The decoding effort an exhibit gets right now (null if nobody's there).
  function keeperOnDuty(park, rec) { return staffing(park, false).exhibits[rec.id] || null; }
  // Hire a trainee; with exhibitId, put them straight to work there.
  function hireKeeper(park, exhibitId) {
    var id = park.nextKeeperId++;
    var names = Z.KEEPER_NAMES;
    var k = Staff.create("keeper", dayIndex(park));
    k.id = id;
    k.name = names[(id - 1) % names.length] + (id > names.length ? " " + (Math.floor((id - 1) / names.length) + 1) : "");
    k.level = 1; k.xp = 0; k.exhibitIds = []; k.training = null; k.hiredTick = park.tick;
    park.keepers[id] = k;
    park.keeperOrder.push(id);
    if (exhibitId) assignKeeper(park, id, exhibitId);
    return { ok: true, keeper: k };
  }
  // Add an exhibit to a keeper's rounds (exhibitId null: back to the
  // staff room, off every exhibit).
  function assignKeeper(park, keeperId, exhibitId) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    if (exhibitId === null || exhibitId === undefined) {
      k.exhibitIds.slice().forEach(function (eid) { unassignKeeper(park, keeperId, eid); });
      return { ok: true };
    }
    var rec = park.exhibits[exhibitId];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    if (k.exhibitIds.indexOf(rec.id) < 0) k.exhibitIds.push(rec.id);
    if (rec.keeperIds.indexOf(keeperId) < 0) rec.keeperIds.push(keeperId);
    syncDuty(park);
    return { ok: true };
  }
  function unassignKeeper(park, keeperId, exhibitId) {
    var k = park.keepers[keeperId], rec = park.exhibits[exhibitId];
    if (k) k.exhibitIds = k.exhibitIds.filter(function (e) { return e !== exhibitId; });
    if (rec) rec.keeperIds = rec.keeperIds.filter(function (i) { return i !== keeperId; });
    syncDuty(park);
    return { ok: true };
  }
  function removeKeeper(park, keeperId) {
    assignKeeper(park, keeperId, null);
    delete park.keepers[keeperId];
    park.keeperOrder = park.keeperOrder.filter(function (i) { return i !== keeperId; });
  }
  function fireKeeper(park, keeperId) {
    if (!park.keepers[keeperId]) return { ok: false, reason: "No such keeper." };
    removeKeeper(park, keeperId);
    return { ok: true };
  }
  function canTrain(park, keeperId) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    if (k.training) return { ok: false, reason: k.name + " is already on a course." };
    if (k.level >= Z.MAX_KEEPER_LEVEL) return { ok: false, reason: k.name + " already knows every decoder we can teach." };
    var t = Z.TRAINING[k.level + 1];
    if (k.xp < t.xp) return { ok: false, reason: k.name + " needs " + Math.ceil(t.xp - k.xp) + " more rounds of experience.", course: t };
    if (park.cash < t.fee) return { ok: false, reason: "Not enough funding (" + dollars(t.fee) + " needed).", course: t };
    return { ok: true, reason: null, course: t };
  }
  // Enrol a keeper on the course for the next level. They keep working
  // with what they know and use the new decoder once the course ends.
  function trainKeeper(park, keeperId) {
    var c = canTrain(park, keeperId);
    if (!c.ok) return c;
    var k = park.keepers[keeperId];
    park.cash -= c.course.fee;
    k.training = { toLevel: k.level + 1, untilTick: park.tick + c.course.days * TPD };
    return { ok: true, until: k.training.untilTick };
  }
  function sendOnVacation(park, keeperId, days) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    var r = Staff.sendOnVacation(k, dayIndex(park), days);
    if (r.ok) syncDuty(park);
    return r;
  }
  function bonusCost(k) { return Z.STAFF.keeper.bonus.salaryDays * keeperSalary(k); }
  function canBonus(park, keeperId) {
    var k = park.keepers[keeperId], b = Z.STAFF.keeper.bonus;
    if (!k) return { ok: false, reason: "No such keeper." };
    var wait = k.lastBonusDay + b.cooldownDays - dayIndex(park);
    if (wait > 0) return { ok: false, reason: "Another bonus so soon would look desperate (" + wait + " days)." };
    if (park.cash < bonusCost(k)) return { ok: false, reason: "Not enough funding (" + dollars(bonusCost(k)) + " needed)." };
    return { ok: true, reason: null, cost: bonusCost(k) };
  }
  function giveBonus(park, keeperId) {
    var c = canBonus(park, keeperId);
    if (!c.ok) return c;
    var k = park.keepers[keeperId];
    park.cash -= c.cost;
    k.lastBonusDay = dayIndex(park);
    Staff.addMorale(k, Z.STAFF.keeper.bonus.morale);
    return { ok: true, cost: c.cost };
  }

  // ---------- the lab ----------
  function labValues(park) { return X.labValues(park.lab.levels); }
  function labLevels(park) { var n = 0; for (var d in park.lab.levels) n += park.lab.levels[d]; return n; }
  function canResearch(park, dial) {
    var d = Z.LAB[dial];
    if (!d) return { ok: false, reason: "No such research." };
    var lvl = park.lab.levels[dial];
    if (park.lab.project) return { ok: false, reason: "The lab is busy with " + Z.LAB[park.lab.project.dial].name.toLowerCase() + "." };
    if (lvl + 1 >= d.values.length) return { ok: false, reason: d.name + " is fully upgraded." };
    var step = Z.RESEARCH[lvl + 1];
    if (park.cash < step.fee) return { ok: false, reason: "Not enough funding (" + dollars(step.fee) + " needed).", step: step };
    return { ok: true, reason: null, step: step };
  }
  function startResearch(park, dial) {
    var c = canResearch(park, dial);
    if (!c.ok) return c;
    park.cash -= c.step.fee;
    park.lab.project = { dial: dial, untilTick: park.tick + c.step.days * TPD, startTick: park.tick };
    return { ok: true, until: park.lab.project.untilTick };
  }

  // ---------- money ----------
  function reputationFactor(park) { return 0.5 + park.reputation / 100; }
  // Visitors per day drawn by one exhibit (all its animals) right now.
  function exhibitVisitors(park, rec) {
    if (!rec.animal) return 0;
    return ECO.visitorsPerAppeal * speciesInfo(park, rec.animal.speciesId).appeal * rec.animal.k * (rec.animal.health / 100) *
      reputationFactor(park);
  }
  // Upkeep plus this exhibit's share of its keepers' salaries.
  function exhibitCosts(park, rec) {
    var cost = isOpen(rec) ? habitatOf(park, rec).upkeep : 0;
    if (!rec.animal || !rec.keeperIds.length) return cost;
    var st = staffing(park, true), w = exhibitWeight(park, rec) / rec.keeperIds.length;
    rec.keeperIds.forEach(function (kid) {
      var L = st.loads[kid];
      if (L > 0) cost += keeperSalary(park.keepers[kid]) * w / L;
    });
    return cost;
  }
  // Current daily rates (what the top bar shows).
  function rates(park) {
    var visitors = 0, costs = 0;
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      visitors += exhibitVisitors(park, rec);
      if (isOpen(rec)) costs += habitatOf(park, rec).upkeep;
    });
    park.keeperOrder.forEach(function (id) { costs += keeperSalary(park.keepers[id]); });
    var revenue = visitors * ECO.ticketPrice;
    return { visitors: visitors, revenue: revenue, costs: costs, net: revenue - costs };
  }

  // ---------- investors ----------
  function avgOf(list, f) { return list.length ? list.reduce(function (a, x) { return a + f(x); }, 0) / list.length : 0; }
  // Everything investors look at (see investors.js).
  function metrics(park) {
    var h = park.history, last7 = h.slice(-7), last30 = h.slice(-30), prev30 = h.slice(-60, -30);
    var revenue = last7.length ? avgOf(last7, function (d) { return d.revenue; }) : rates(park).revenue;
    var r30 = avgOf(last30, function (d) { return d.revenue; }), p30 = avgOf(prev30, function (d) { return d.revenue; });
    // Growth on a small base doesn't impress: below growthFloor a day the
    // floor stands in for last month's revenue.
    var growth = Math.max(-1, Math.min(1, (r30 - p30) / Math.max(p30, Z.VALUATION.growthFloor)));
    var animals = 0, healthSum = 0, techUnits = 0, best = 0;
    park.order.forEach(function (id) {
      var an = park.exhibits[id].animal;
      if (!an) return;
      var d = speciesDistance(park, an.speciesId);
      animals += an.k; healthSum += an.health * an.k;
      techUnits += an.k * d * d * an.health / 100;
      best = Math.max(best, d);
    });
    var animalDays = 0, sick = 0;
    last30.forEach(function (d) { animalDays += d.animals; sick += d.sick; });
    var keepers = park.keeperOrder.map(function (id) { return park.keepers[id]; });
    var m = {
      revenue: revenue, growth: growth, logicalQubits: animals, health: animals ? healthSum / animals : 0,
      techUnits: techUnits, bestDistance: best, species: Object.keys(park.book.known).length,
      labLevels: labLevels(park), headKeepers: keepers.filter(function (k) { return k.level >= Z.MAX_KEEPER_LEVEL; }).length,
      errorRate: animalDays ? sick / animalDays : 0,
      morale: keepers.length ? avgOf(keepers, function (k) { return k.morale; }) : 50
    };
    m.roadmapShare = Inv.roadmap(Math.min(park.funding.round, Z.ROUNDS.length - 1), m).share;
    return m;
  }
  function currentRound(park) { return Z.ROUNDS[Math.min(park.funding.round, Z.ROUNDS.length - 1)]; }
  function valuation(park) { return Inv.valuation(Math.min(park.funding.round, Z.ROUNDS.length - 1), metrics(park), park.confidence); }
  function nudgeConfidence(park, delta) { park.confidence = Math.max(0, Math.min(100, park.confidence + delta)); }

  function canRaise(park) {
    var f = park.funding;
    if (park.status !== "playing") return { ok: false, reason: park.status === "won" ? "You're already listed." : "The game is over." };
    if (f.round >= Z.ROUNDS.length) return { ok: false, reason: "No more rounds to raise." };
    if (f.raise) return { ok: false, reason: "The roadshow is under way." };
    if (f.offer) return { ok: false, reason: "Answer the bridge offer first." };
    if (park.tick < f.cooldownUntil) return { ok: false, reason: "Investors want to see progress first (" + Math.ceil((f.cooldownUntil - park.tick) / TPD) + " days)." };
    return { ok: true, reason: null };
  }
  // Start the roadshow for the next round. It ends after
  // FUNDING.roadshowDays with a verdict ("round" event).
  function startRaise(park) {
    var c = canRaise(park);
    if (!c.ok) return c;
    park.funding.raise = { round: park.funding.round, startTick: park.tick, untilTick: park.tick + Z.FUNDING.roadshowDays * TPD, tours: [] };
    if (!park.tour) park.nextTourTick = Math.min(park.nextTourTick, tourTickAfter(park, 0));
    return { ok: true, until: park.funding.raise.untilTick };
  }
  function closeRound(park, roundIndex, value, share, bridge) {
    var f = park.funding, r = Z.ROUNDS[roundIndex], cash = value * share;
    park.cash += cash;
    f.stake *= 1 - share;
    f.valuation = value;
    f.history.push({ round: roundIndex, name: r.name + (bridge ? " bridge" : ""), day: day(park), valuation: value, raised: cash, bridge: !!bridge });
    if (!bridge) {
      f.round = roundIndex + 1;
      setLot(park, park.lotLevel + 1);
      f.cooldownUntil = park.tick + Z.FUNDING.afterCloseDays * TPD;
      if (r.ipo) { park.status = "won"; park.endDay = day(park); }
    }
    return cash;
  }
  function finishRaise(park) {
    var f = park.funding, raise = f.raise, ri = raise.round, r = Z.ROUNDS[ri];
    f.raise = null;
    var val = Inv.valuation(ri, metrics(park), park.confidence), ratio = val.value / r.target;
    var tier = Inv.roundTier(ratio), ev = {
      type: "round", round: ri, name: r.name, target: r.target, valuation: val.value, ratio: ratio, tier: tier,
      breakdown: val, tours: raise.tours.slice(), quotes: Inv.roundQuotes(tier, !!r.ipo, park.rng), raised: 0, ipo: !!r.ipo
    };
    if (ratio >= 1) {
      ev.outcome = "closed";
      ev.raised = closeRound(park, ri, val.value, r.raise, false);
      ev.stake = f.stake;
      nudgeConfidence(park, 5);
    } else if (tier === "bridge") {
      ev.outcome = "bridge";
      f.offer = { round: ri, valuation: val.value, share: Z.FUNDING.bridgeRaise, cash: val.value * Z.FUNDING.bridgeRaise };
      ev.offer = f.offer;
    } else {
      ev.outcome = "pass";
      f.cooldownUntil = park.tick + Z.FUNDING.cooldownDays * TPD;
      nudgeConfidence(park, -5);
    }
    return ev;
  }
  function acceptOffer(park) {
    var f = park.funding, o = f.offer;
    if (!o) return { ok: false, reason: "No offer on the table." };
    f.offer = null;
    f.cooldownUntil = park.tick + Z.FUNDING.cooldownDays * TPD;
    return { ok: true, raised: closeRound(park, o.round, o.valuation, o.share, true) };
  }
  function declineOffer(park) {
    if (!park.funding.offer) return { ok: false, reason: "No offer on the table." };
    park.funding.offer = null;
    park.funding.cooldownUntil = park.tick + Z.FUNDING.cooldownDays * TPD;
    return { ok: true };
  }

  // ---------- tours ----------
  // The tick of the tour start hour, `days` days from now (today if it
  // hasn't started yet and days is 0).
  function tourTickAfter(park, days) {
    var t = (Math.floor(park.tick / TPD) + days) * TPD + Z.TOURS.start;
    return t > park.tick ? t : t + TPD;
  }
  // Up to TOURS.stops stocked exhibits, the investors drawn to the
  // biggest draws. A tour guide (not hireable yet) would choose instead.
  function chooseRoute(park, guide) {
    var pool = park.order.filter(function (id) { return park.exhibits[id].animal; });
    var route = [];
    while (route.length < Z.TOURS.stops && pool.length) {
      var weights = pool.map(function (id) { var an = park.exhibits[id].animal; return speciesInfo(park, an.speciesId).appeal * an.k; });
      var total = weights.reduce(function (a, b) { return a + b; }, 0), r = park.rng() * total, i = 0;
      while (i < pool.length - 1 && r >= weights[i]) { r -= weights[i]; i++; }
      route.push(pool[i]);
      pool.splice(i, 1);
    }
    return route;
  }
  function startTour(park) {
    var route = chooseRoute(park, null);
    if (!route.length) return null;
    var inv = Inv.randomInvestor(park.rng);
    park.tour = {
      investor: inv, focus: inv.focus, route: route, incidents: 0, perk: null, guide: null,
      startTick: park.tick, endTick: park.tick + (Z.TOURS.end - Z.TOURS.start), roadshow: !!park.funding.raise
    };
    return park.tour;
  }
  function canPerk(park, perkId) {
    var p = Inv.perkInfo(perkId);
    if (!p) return { ok: false, reason: "No such treat." };
    if (!park.tour) return { ok: false, reason: "No investor is visiting." };
    if (park.tour.perk) return { ok: false, reason: "They've already been wined and dined today." };
    if (park.cash < p.cost) return { ok: false, reason: "Not enough funding (" + dollars(p.cost) + " needed)." };
    return { ok: true, reason: null, perk: p };
  }
  function buyPerk(park, perkId) {
    var c = canPerk(park, perkId);
    if (!c.ok) return c;
    park.cash -= c.perk.cost;
    park.tour.perk = perkId;
    return { ok: true, perk: c.perk };
  }
  function endTour(park) {
    var t = park.tour;
    park.tour = null;
    var m = metrics(park), animals = 0, health = 0;
    t.route.forEach(function (id) {
      var an = park.exhibits[id] && park.exhibits[id].animal;
      if (an) { animals += an.k; health += an.health * an.k; }
    });
    var imp = Inv.impression(t, m, { health: animals ? health / animals : null });
    var before = park.confidence;
    nudgeConfidence(park, Z.CONFIDENCE.tourWeight * (imp.score - 50));
    var tier = Inv.tourTier(imp.score, t.incidents);
    if (park.funding.raise) park.funding.raise.tours.push(imp.score);
    park.nextTourTick = park.funding.raise ? tourTickAfter(park, Z.FUNDING.roadshowTourEvery)
      : tourTickAfter(park, randomDays(park, Z.TOURS.everyDays));
    return {
      type: "tour", investor: t.investor, focus: t.focus, route: t.route, incidents: t.incidents, perk: t.perk,
      score: imp.score, scores: imp.scores, weakest: imp.weakest, strongest: imp.strongest, tier: tier,
      quote: Inv.pick(Z.QUOTES.tour[tier], park.rng), confidence: park.confidence, delta: park.confidence - before
    };
  }

  // ---------- time ----------
  // Advance the whole park by one tick (one hour). Returns events:
  //   { type: "sick", exhibitId, speciesId, animal, kind, cause, bill, onTour }
  //   { type: "built", exhibitId } / { type: "discovered", exhibitId, speciesId, newSpecies }
  //   { type: "day", day, revenue, expenses, vet, visitors, sick, reputation }
  //   { type: "debt", daysInDebt, daysLeft }       (end of a day spent in debt)
  //   { type: "month", month, revenue, expenses, vet, visitors, sick, net,
  //     dailyNet, runwayDays, currentNet, growth, quote, sickest }
  //   { type: "trained", keeperId, name, level }
  //   { type: "research", dial, level, value }
  //   { type: "staff", keeperId, name, kind, days, fromDay } (staff.js event kinds)
  //   { type: "tour-start", tour } / { type: "tour", … } (see endTour)
  //   { type: "milestone", round, label }
  //   { type: "round", outcome: "closed" | "bridge" | "pass", … } (see finishRaise)
  //   { type: "lost", day }
  // A lost game, or a won one the player hasn't chosen to continue,
  // no longer advances.
  function tick(park) {
    var events = [];
    if (park.status === "lost" || (park.status === "won" && !park.freePlay)) return events;
    var perTick = 1 / TPD;
    var r = rates(park);
    park.cash += (r.revenue - r.costs) * perTick;
    ["revenue", "expenses", "visitors"].forEach(function (key, i) {
      var v = [r.revenue, r.costs, r.visitors][i] * perTick;
      park.today[key] += v;
      park.month[key] += v;
    });

    var st = syncDuty(park), tour = park.tour;
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (!rec.animal) return;
      var before = rec.animal.decoded;
      X.runTick(rec.animal).forEach(function (s) {
        park.cash -= ECO.vetBill;
        park.today.vet += ECO.vetBill; park.today.sick++;
        park.today.sickBy[id] = (park.today.sickBy[id] || 0) + 1;
        park.month.vet += ECO.vetBill; park.month.sick++;
        park.month.sickBy[id] = (park.month.sickBy[id] || 0) + 1;
        park.totalSick++;
        park.reputation = Math.max(0, park.reputation - ECO.sickReputationHit);
        var onTour = !!tour && tour.route.indexOf(id) >= 0;
        if (onTour) tour.incidents++;
        events.push({ type: "sick", exhibitId: id, speciesId: rec.animal.speciesId, animal: s.animal, kind: s.kind, cause: s.cause,
          bill: ECO.vetBill, onTour: onTour });
      });
      var done = rec.animal.decoded - before, duty = st.exhibits[id];
      if (done && duty) Object.keys(duty.shares).forEach(function (kid) { park.keepers[kid].xp += done * duty.shares[kid] / duty.speed; });
    });

    park.tick++;
    // Construction, courses and research that finished this hour.
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (!rec.building || park.tick < rec.buildUntil) return;
      rec.building = false;
      events.push({ type: "built", exhibitId: id });
      if (rec.discovers && !isKnown(park, rec.discovers)) {
        park.book.known[rec.discovers] = park.tick;
        var csp = park.book.custom[rec.discovers];
        if (csp) csp.discoveredTick = park.tick;
        nudgeConfidence(park, Z.CONFIDENCE.discovery);
        events.push({ type: "discovered", exhibitId: id, speciesId: rec.discovers, newSpecies: !!csp });
      }
      rec.discovers = null;
    });
    var retrained = false;
    park.keeperOrder.forEach(function (kid) {
      var k = park.keepers[kid];
      if (k.training && park.tick >= k.training.untilTick) {
        k.level = k.training.toLevel;
        k.training = null;
        Staff.addMorale(k, Z.STAFF.keeper.morale.trained);
        events.push({ type: "trained", keeperId: kid, name: k.name, level: k.level });
        retrained = true;
      }
    });
    if (retrained) syncDuty(park);
    var proj = park.lab.project;
    if (proj && park.tick >= proj.untilTick) {
      park.lab.levels[proj.dial]++;
      park.lab.project = null;
      var lab = labValues(park);
      park.order.forEach(function (id) { if (park.exhibits[id].animal) X.setLab(park.exhibits[id].animal, lab); });
      events.push({ type: "research", dial: proj.dial, level: park.lab.levels[proj.dial], value: lab[proj.dial] });
    }
    // Investors on site.
    if (park.tour && park.tick >= park.tour.endTick) events.push(endTour(park));
    if (!park.tour && park.tick >= park.nextTourTick) {
      var t = startTour(park);
      if (t) events.push({ type: "tour-start", tour: t });
      else park.nextTourTick = tourTickAfter(park, 1); // nothing on show yet
    }

    if (park.tick % TPD === 0) events = events.concat(endOfDay(park));
    return events;
  }

  function endOfDay(park) {
    var events = [], d = day(park) - 1;
    // Reputation drifts toward the average health of the animals on show.
    var stocked = park.order.map(function (id) { return park.exhibits[id]; }).filter(function (rec) { return rec.animal; });
    if (stocked.length) {
      var avg = stocked.reduce(function (a, rec) { return a + rec.animal.health; }, 0) / stocked.length;
      park.reputation += (avg - park.reputation) * ECO.reputationDrift;
    }
    park.reputation = Math.max(0, Math.min(100, park.reputation));
    var t = park.today;
    park.history.push({ day: d, revenue: t.revenue, expenses: t.expenses, vet: t.vet, sick: t.sick,
      animals: stocked.reduce(function (a, rec) { return a + rec.animal.k; }, 0) });
    if (park.history.length > ECO.historyDays) park.history.shift();
    park.yesterday = t;
    events.push({ type: "day", day: d, revenue: t.revenue, expenses: t.expenses, vet: t.vet, visitors: t.visitors, sick: t.sick, reputation: park.reputation });

    // Staff: fatigue, holidays, sick days, resignations.
    var st = staffing(park, false);
    park.keeperOrder.slice().forEach(function (kid) {
      var k = park.keepers[kid];
      if (!k) return;
      var sickAnimals = k.exhibitIds.reduce(function (a, eid) { return a + (t.sickBy[eid] || 0); }, 0);
      Staff.daily(k, { day: dayIndex(park), load: st.loads[kid] || 0, sickAnimals: sickAnimals }, park.rng).forEach(function (e) {
        events.push({ type: "staff", keeperId: kid, name: k.name, kind: e.kind, days: e.days, fromDay: e.fromDay, from: e.from });
        if (e.kind === "quit") {
          removeKeeper(park, kid);
          nudgeConfidence(park, -Z.CONFIDENCE.resignation);
          park.keeperOrder.forEach(function (o) { Staff.addMorale(park.keepers[o], -Z.STAFF.keeper.morale.colleagueQuit); });
        }
      });
    });
    syncDuty(park);
    park.today = freshDay();

    // Investors: memories fade; roadmap milestones; the month; the raise.
    park.confidence += (Z.CONFIDENCE.start - park.confidence) * Z.CONFIDENCE.reversion;
    var f = park.funding;
    if (f.round < Z.ROUNDS.length) {
      var rd = Z.ROUNDS[f.round], seen = f.milestones[rd.id] = f.milestones[rd.id] || {};
      Inv.roadmap(f.round, metrics(park)).items.forEach(function (it) {
        if (it.met && !seen[it.metric]) {
          seen[it.metric] = true;
          nudgeConfidence(park, Z.CONFIDENCE.milestone);
          events.push({ type: "milestone", round: f.round, label: it.label });
        }
      });
    }
    if (d % DAYS_PER_MONTH === 0) events.push(monthUpdate(park, d / DAYS_PER_MONTH));
    if (f.raise && park.tick >= f.raise.untilTick) events.push(finishRaise(park));

    park.daysInDebt = park.cash < 0 ? park.daysInDebt + 1 : 0;
    if (park.daysInDebt > 0) nudgeConfidence(park, -Z.CONFIDENCE.debtPerDay);
    if (park.status === "playing" && park.daysInDebt >= ECO.bankruptDays) {
      park.status = "lost"; park.endDay = d;
      events.push({ type: "lost", day: d });
    } else if (park.daysInDebt > 0) {
      events.push({ type: "debt", daysInDebt: park.daysInDebt, daysLeft: ECO.bankruptDays - park.daysInDebt });
    }
    return events;
  }

  function monthUpdate(park, monthNumber) {
    var m = park.month, sickest = null;
    Object.keys(m.sickBy).forEach(function (id) {
      if (park.exhibits[id] && (!sickest || m.sickBy[id] > sickest.count)) sickest = { exhibitId: Number(id), count: m.sickBy[id] };
    });
    var r = rates(park), met = metrics(park);
    var net = m.revenue - m.expenses - m.vet, dailyNet = net / DAYS_PER_MONTH;
    nudgeConfidence(park, Z.CONFIDENCE.monthGrowth * Math.max(-1, Math.min(1, 2 * met.growth)));
    var Q = Z.QUOTES.month;
    var pool = m.revenue < 1 ? Q.early : net > 0 && m.sick <= 2 ? Q.great : net > 0 ? Q.good
      : dailyNet < 0 && park.cash / -dailyNet < 60 ? Q.burn : m.vet > m.revenue / 4 ? Q.vet : Q.flat;
    var ev = {
      type: "month", month: monthNumber, revenue: m.revenue, expenses: m.expenses, vet: m.vet,
      visitors: m.visitors, sick: m.sick, net: net, dailyNet: dailyNet,
      // Runway at this month's average burn (null = not burning cash).
      runwayDays: dailyNet < 0 ? Math.max(0, park.cash) / -dailyNet : null,
      currentNet: r.net, growth: met.growth, quote: Inv.pick(pool, park.rng), sickest: sickest
    };
    park.month = freshMonth();
    return ev;
  }

  // Keep playing after the IPO (nothing more to win).
  function continueAfterWin(park) { if (park.status === "won") park.freePlay = true; }

  // ---------- save / load ----------
  var SAVE_VERSION = 4;
  // Plain JSON. Animals are stored as ExhibitSim snapshots (decoders, noise
  // models and RNGs are rebuilt on load).
  function save(park) {
    var exhibits = {};
    Object.keys(park.exhibits).forEach(function (id) {
      var rec = park.exhibits[id], copy = {};
      Object.keys(rec).forEach(function (k) { copy[k] = rec[k]; });
      if (rec.animal) copy.animal = X.snapshot(rec.animal);
      exhibits[id] = copy;
    });
    return JSON.stringify(park, function (key, value) {
      if (key === "rng") return undefined;
      if (key === "exhibits" && value === park.exhibits) return exhibits;
      if (value === Infinity || value === -Infinity) return value > 0 ? "Infinity" : "-Infinity";
      return value;
    }).replace(/^\{/, '{"version":' + SAVE_VERSION + ",");
  }
  function load(json, opts) {
    opts = opts || {};
    var data = typeof json === "string" ? JSON.parse(json) : json;
    if (!data || typeof data.version !== "number") throw new Error("Unsupported save version");
    if (data.version < SAVE_VERSION) throw new Error("This zoo was saved before the funding update (save version " + data.version + ") and can't be loaded.");
    if (data.version !== SAVE_VERSION) throw new Error("Unsupported save version");
    delete data.version;
    var park = data;
    park.rng = opts.rng || Math.random;
    if (!park.book || !park.book.known || !Array.isArray(park.book.designs) || !park.book.custom) throw new Error("Corrupted save: no book");
    if (!park.funding || !Array.isArray(park.history)) throw new Error("Corrupted save: no books");
    park.keeperOrder.forEach(function (kid) {
      var k = park.keepers[kid];
      if (!k || !Array.isArray(k.exhibitIds)) throw new Error("Corrupted keeper in save: " + kid);
      ["lastVacationDay", "lastBonusDay"].forEach(function (f) { if (typeof k[f] === "string") k[f] = Number(k[f]); });
    });
    park.book.designs.forEach(function (e) {
      if (Hab.malformed(e.layout)) throw new Error("Corrupted design in save: " + e.id);
      if (!Z.SPECIES[e.speciesId] && !park.book.custom[e.speciesId]) throw new Error("Unknown species in save: " + e.speciesId);
    });
    Object.keys(park.exhibits).forEach(function (id) {
      var rec = park.exhibits[id];
      if (rec.designId ? !designEntry(park, rec.designId) : !Z.BIOMES[rec.biomeId]) throw new Error("Unknown habitat in save: " + (rec.biomeId || rec.designId));
      if (!Array.isArray(rec.keeperIds) || rec.keeperIds.some(function (kid) { return !park.keepers[kid]; })) throw new Error("Unknown keeper in save at " + id);
      if (!Array.isArray(rec.cells)) rec.cells = rectCells(rec.w, rec.h); // saved before shaped plots
    });
    setLot(park, park.lotLevel);
    Object.keys(park.exhibits).forEach(function (id) {
      var rec = park.exhibits[id];
      if (rec.animal) {
        if (!speciesInfo(park, rec.animal.speciesId)) throw new Error("Unknown species in save: " + rec.animal.speciesId);
        var sim = simFor(park, rec);
        rec.animal = X.restore(rec.animal, { lab: labValues(park), keeper: null, rng: park.rng, code: sim.code, checks: sim.checks });
      }
    });
    syncDuty(park);
    return park;
  }

  function nativeBiome(speciesId) {
    for (var b in Z.BIOMES) if (Z.BIOMES[b].native === speciesId) return b;
    return null;
  }
  function exhibitLabel(park, rec) { return habitatOf(park, rec).name + " #" + rec.number; }

  var Park = {
    createPark: createPark, day: day, hour: hour, dayIndex: dayIndex,
    isKnown: isKnown, speciesInfo: speciesInfo, speciesDistance: speciesDistance, habitatOf: habitatOf, nativeBiome: nativeBiome,
    knownCandidates: knownCandidates, isOpen: isOpen, daysLeft: daysLeft,
    canBuild: canBuild, build: build, exhibitAt: exhibitAt, demolish: demolish, biomeCells: biomeCells, designCells: designCells, fits: fits,
    studyDesign: studyDesign, canBuildDesign: canBuildDesign, buildDesign: buildDesign, renameSpecies: renameSpecies,
    designEntry: designEntry, designInUse: designInUse, deleteDesign: deleteDesign, canForgetSpecies: canForgetSpecies, forgetSpecies: forgetSpecies,
    animalCount: animalCount, stockCost: stockCost, speciesOptions: speciesOptions, buyAnimal: buyAnimal,
    keeperSpeed: keeperSpeed, keeperSalary: keeperSalary, keeperPresent: keeperPresent, keeperOnDuty: keeperOnDuty,
    exhibitWeight: exhibitWeight, staffing: staffing,
    hireKeeper: hireKeeper, assignKeeper: assignKeeper, unassignKeeper: unassignKeeper, fireKeeper: fireKeeper,
    canTrain: canTrain, trainKeeper: trainKeeper, sendOnVacation: sendOnVacation,
    bonusCost: bonusCost, canBonus: canBonus, giveBonus: giveBonus,
    labValues: labValues, labLevels: labLevels, canResearch: canResearch, startResearch: startResearch,
    exhibitVisitors: exhibitVisitors, exhibitCosts: exhibitCosts, rates: rates,
    metrics: metrics, currentRound: currentRound, valuation: valuation, canRaise: canRaise, startRaise: startRaise,
    acceptOffer: acceptOffer, declineOffer: declineOffer, canPerk: canPerk, buyPerk: buyPerk,
    tick: tick, exhibitLabel: exhibitLabel, continueAfterWin: continueAfterWin,
    save: save, load: load, SAVE_VERSION: SAVE_VERSION, DAYS_PER_MONTH: DAYS_PER_MONTH
  };
  if (isNode) module.exports = Park;
  else root.Park = Park;
})(typeof window !== "undefined" ? window : this);

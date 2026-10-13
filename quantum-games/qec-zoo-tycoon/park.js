// =========================================================
// Error Correction Zoo Tycoon — park model.
//
// The whole zoo: a grid of enclosures, the animals and keepers in
// them, cash, reputation and the clock. Pure game logic with no DOM,
// so it can be unit-tested in Node; index.html renders it.
//
// Money flows continuously: ticket revenue and running costs
// (salaries + upkeep) accrue every tick as 1/24 of their daily rate;
// vet bills are charged immediately. A "day" event summarises
// yesterday's books at each rollover; every 30 days an "investor"
// event summarises the month.
//
// Win: cash >= ECONOMY.goal.cash and reputation >= goal.reputation at
// the end of a day ("Series A closed"). Lose: in debt at the end of
// ECONOMY.bankruptDays consecutive days ("ran out of runway").
// save()/load() round-trip the whole park through JSON.
//
// Staff. Keepers are hired as trainees, one per exhibit, and can be
// reassigned. They gain experience (xp = rounds decoded), which makes
// them faster, and once they have enough they can take a training
// course (a fee, and some days of study on the job) to learn the next
// decoder. Every keeper on the payroll is paid, assigned or not.
//
// The lab. One research project at a time raises one dial of LAB
// (zoo-data.js) by a level: lower error rates, or a faster syndrome
// cycle. Every exhibit picks up the new hardware when it completes.
//
// Browser: load after ../stabilizer.js, ../detectors.js, zoo-data.js, exhibit-sim.js;
// exposes `window.Park`. Node: require("./park.js").
// =========================================================
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var Z = isNode ? require("./zoo-data.js") : root.ZooData;
  var X = isNode ? require("./exhibit-sim.js") : root.ExhibitSim;
  var ECO = Z.ECONOMY;

  function createPark(opts) {
    opts = opts || {};
    var w = ECO.parkSize[0], h = ECO.parkSize[1];
    return {
      width: w, height: h,
      grid: new Array(w * h).fill(null), // cell -> exhibit id
      exhibits: {},                      // id -> exhibit record
      order: [],                         // ids in build order
      nextId: 1,
      cash: ECO.startingCash,
      reputation: ECO.startingReputation,
      tick: 0,                           // absolute hours since opening
      today: { revenue: 0, expenses: 0, vet: 0, visitors: 0, sick: 0 },
      yesterday: null,
      month: freshMonth(),
      status: "playing",                 // "playing" | "won" | "lost"
      freePlay: false,                   // keep running after a win
      endDay: null,                      // day the game was won or lost
      daysInDebt: 0,
      totalSick: 0,
      keepers: {},                       // id -> keeper record
      keeperOrder: [],
      nextKeeperId: 1,
      lab: { levels: { coherence: 0, gates: 0, readout: 0, cycle: 0 }, project: null },
      rng: opts.rng || Math.random
    };
  }

  function freshMonth() { return { revenue: 0, expenses: 0, vet: 0, visitors: 0, sick: 0, sickBy: {} }; }
  var DAYS_PER_MONTH = 30;

  function day(park) { return Math.floor(park.tick / ECO.ticksPerDay) + 1; }
  function hour(park) { return park.tick % ECO.ticksPerDay; }

  function footprint(biomeId) { return Z.BIOMES[biomeId].footprint; }

  // ---------- building ----------
  function canBuild(park, biomeId, x, y) {
    var fp = footprint(biomeId), biome = Z.BIOMES[biomeId];
    if (x < 0 || y < 0 || x + fp[0] > park.width || y + fp[1] > park.height) return { ok: false, reason: "Doesn't fit inside the park." };
    for (var dy = 0; dy < fp[1]; dy++) for (var dx = 0; dx < fp[0]; dx++) {
      if (park.grid[(y + dy) * park.width + (x + dx)] !== null) return { ok: false, reason: "Overlaps another enclosure." };
    }
    if (park.cash < biome.cost) return { ok: false, reason: "Not enough funding ($" + biome.cost.toLocaleString() + " needed)." };
    return { ok: true, reason: null };
  }
  function build(park, biomeId, x, y) {
    var check = canBuild(park, biomeId, x, y);
    if (!check.ok) return check;
    var fp = footprint(biomeId), id = park.nextId++;
    var biome = Z.BIOMES[biomeId];
    var rec = {
      id: id, biomeId: biomeId, x: x, y: y, w: fp[0], h: fp[1],
      number: park.order.filter(function (o) { return park.exhibits[o].biomeId === biomeId; }).length + 1,
      keeperId: null, animal: null, builtTick: park.tick
    };
    for (var dy = 0; dy < fp[1]; dy++) for (var dx = 0; dx < fp[0]; dx++) park.grid[(y + dy) * park.width + (x + dx)] = id;
    park.exhibits[id] = rec;
    park.order.push(id);
    park.cash -= biome.cost;
    return { ok: true, exhibit: rec };
  }
  function exhibitAt(park, x, y) {
    if (x < 0 || y < 0 || x >= park.width || y >= park.height) return null;
    var id = park.grid[y * park.width + x];
    return id === null ? null : park.exhibits[id];
  }
  // Demolishing refunds part of the build cost; the animal is rehomed
  // (lost, no refund) and the keeper let go.
  function demolish(park, id) {
    var rec = park.exhibits[id];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    if (rec.keeperId) park.keepers[rec.keeperId].exhibitId = null; // back to the staff room
    for (var i = 0; i < park.grid.length; i++) if (park.grid[i] === id) park.grid[i] = null;
    delete park.exhibits[id];
    park.order = park.order.filter(function (o) { return o !== id; });
    var refund = Math.round(Z.BIOMES[rec.biomeId].cost * ECO.demolishRefund);
    park.cash += refund;
    return { ok: true, refund: refund };
  }

  // ---------- animals & keepers ----------
  // Every species, with whether it can live in this enclosure and why not.
  function speciesOptions(park, id) {
    var rec = park.exhibits[id];
    return Object.keys(Z.SPECIES).map(function (sid) {
      var pl = Z.checkPlacement(sid, rec.biomeId), cost = Z.SPECIES[sid].cost;
      return { speciesId: sid, ok: pl.ok, reason: pl.reason, cost: cost, affordable: park.cash >= cost };
    });
  }
  function buyAnimal(park, id, speciesId) {
    var rec = park.exhibits[id];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    if (rec.animal) return { ok: false, reason: "This enclosure already has a resident." };
    var pl = Z.checkPlacement(speciesId, rec.biomeId);
    if (!pl.ok) return pl;
    var cost = Z.SPECIES[speciesId].cost;
    if (park.cash < cost) return { ok: false, reason: "Not enough funding ($" + cost.toLocaleString() + " needed)." };
    park.cash -= cost;
    rec.animalTick = park.tick;
    rec.animal = X.createExhibit({
      speciesId: speciesId, channel: Z.BIOMES[rec.biomeId].climate.channel,
      lab: labValues(park), keeper: keeperOnDuty(park, rec), rng: park.rng
    });
    return { ok: true };
  }

  // ---------- staff ----------
  function keeperSpeed(k) {
    var sp = Z.KEEPER_SPEED;
    return Math.min(sp.max, sp.base + k.xp * sp.perXp);
  }
  function keeperSalary(k) { return Z.KEEPER_LEVELS[k.level].salary; }
  // The keeper working an exhibit right now (null if none).
  function keeperOnDuty(park, rec) {
    var k = rec.keeperId ? park.keepers[rec.keeperId] : null;
    return k ? { level: k.level, speed: keeperSpeed(k) } : null;
  }
  function syncKeeper(park, rec) {
    if (rec.animal) X.setKeeper(rec.animal, keeperOnDuty(park, rec));
  }
  // Hire a trainee; with exhibitId, put them straight to work there.
  function hireKeeper(park, exhibitId) {
    var id = park.nextKeeperId++;
    var names = Z.KEEPER_NAMES;
    var k = { id: id, name: names[(id - 1) % names.length] + (id > names.length ? " " + (Math.floor((id - 1) / names.length) + 1) : ""),
      level: 1, xp: 0, exhibitId: null, training: null, hiredTick: park.tick };
    park.keepers[id] = k;
    park.keeperOrder.push(id);
    if (exhibitId) assignKeeper(park, id, exhibitId);
    return { ok: true, keeper: k };
  }
  // Move a keeper to an exhibit (or to the staff room with exhibitId null).
  // Whoever worked there before goes to the staff room.
  function assignKeeper(park, keeperId, exhibitId) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    var rec = exhibitId ? park.exhibits[exhibitId] : null;
    if (exhibitId && !rec) return { ok: false, reason: "No such enclosure." };
    if (k.exhibitId && park.exhibits[k.exhibitId]) {
      var old = park.exhibits[k.exhibitId];
      old.keeperId = null;
      syncKeeper(park, old);
    }
    k.exhibitId = null;
    if (rec) {
      if (rec.keeperId && rec.keeperId !== keeperId) park.keepers[rec.keeperId].exhibitId = null;
      rec.keeperId = keeperId;
      k.exhibitId = rec.id;
      syncKeeper(park, rec);
    }
    return { ok: true };
  }
  function fireKeeper(park, keeperId) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    assignKeeper(park, keeperId, null);
    delete park.keepers[keeperId];
    park.keeperOrder = park.keeperOrder.filter(function (i) { return i !== keeperId; });
    return { ok: true };
  }
  function canTrain(park, keeperId) {
    var k = park.keepers[keeperId];
    if (!k) return { ok: false, reason: "No such keeper." };
    if (k.training) return { ok: false, reason: k.name + " is already on a course." };
    if (k.level >= Z.MAX_KEEPER_LEVEL) return { ok: false, reason: k.name + " already knows every decoder we can teach." };
    var t = Z.TRAINING[k.level + 1];
    if (k.xp < t.xp) return { ok: false, reason: k.name + " needs " + Math.ceil(t.xp - k.xp) + " more rounds of experience.", course: t };
    if (park.cash < t.fee) return { ok: false, reason: "Not enough funding ($" + t.fee.toLocaleString() + " needed).", course: t };
    return { ok: true, reason: null, course: t };
  }
  // Enrol a keeper on the course for the next level. They keep working
  // with what they know and use the new decoder once the course ends.
  function trainKeeper(park, keeperId) {
    var c = canTrain(park, keeperId);
    if (!c.ok) return c;
    var k = park.keepers[keeperId];
    park.cash -= c.course.fee;
    k.training = { toLevel: k.level + 1, untilTick: park.tick + c.course.days * ECO.ticksPerDay };
    return { ok: true, until: k.training.untilTick };
  }

  // ---------- the lab ----------
  function labValues(park) { return X.labValues(park.lab.levels); }
  function canResearch(park, dial) {
    var d = Z.LAB[dial];
    if (!d) return { ok: false, reason: "No such research." };
    var lvl = park.lab.levels[dial];
    if (park.lab.project) return { ok: false, reason: "The lab is busy with " + Z.LAB[park.lab.project.dial].name.toLowerCase() + "." };
    if (lvl + 1 >= d.values.length) return { ok: false, reason: d.name + " is fully upgraded." };
    var step = Z.RESEARCH[lvl + 1];
    if (park.cash < step.fee) return { ok: false, reason: "Not enough funding ($" + step.fee.toLocaleString() + " needed).", step: step };
    return { ok: true, reason: null, step: step };
  }
  function startResearch(park, dial) {
    var c = canResearch(park, dial);
    if (!c.ok) return c;
    park.cash -= c.step.fee;
    park.lab.project = { dial: dial, untilTick: park.tick + c.step.days * ECO.ticksPerDay, startTick: park.tick };
    return { ok: true, until: park.lab.project.untilTick };
  }

  // ---------- money ----------
  function reputationFactor(park) { return 0.5 + park.reputation / 100; }
  // Visitors per day drawn by one exhibit right now.
  function exhibitVisitors(park, rec) {
    if (!rec.animal) return 0;
    return ECO.visitorsPerAppeal * Z.SPECIES[rec.animal.speciesId].appeal * (rec.animal.health / 100) * reputationFactor(park);
  }
  // Upkeep plus the salary of the keeper assigned here.
  function exhibitCosts(park, rec) {
    return Z.BIOMES[rec.biomeId].upkeep + (rec.keeperId ? keeperSalary(park.keepers[rec.keeperId]) : 0);
  }
  // Current daily rates (what the top bar shows).
  function rates(park) {
    var visitors = 0, costs = 0;
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      visitors += exhibitVisitors(park, rec);
      costs += Z.BIOMES[rec.biomeId].upkeep;
    });
    park.keeperOrder.forEach(function (id) { costs += keeperSalary(park.keepers[id]); });
    var revenue = visitors * ECO.ticketPrice;
    return { visitors: visitors, revenue: revenue, costs: costs, net: revenue - costs };
  }

  // ---------- time ----------
  // Advance the whole park by one tick (one hour). Returns events:
  //   { type: "sick", exhibitId, speciesId, kind, cause, bill }
  //   { type: "day", day, revenue, expenses, vet, visitors, sick, reputation }
  //   { type: "debt", daysInDebt, daysLeft }       (end of a day spent in debt)
  //   { type: "investor", month, revenue, expenses, vet, visitors, sick,
  //     net, dailyNet, runwayDays, sickest: { exhibitId, count } | null }
  //   { type: "won", day } / { type: "lost", day }
  //   { type: "trained", keeperId, name, level }
  //   { type: "research", dial, level, value }
  // A lost game, or a won one the player hasn't chosen to continue,
  // no longer advances.
  function tick(park) {
    var events = [];
    if (park.status === "lost" || (park.status === "won" && !park.freePlay)) return events;
    var perTick = 1 / ECO.ticksPerDay;
    var r = rates(park);
    park.cash += (r.revenue - r.costs) * perTick;
    park.today.revenue += r.revenue * perTick;
    park.today.expenses += r.costs * perTick;
    park.today.visitors += r.visitors * perTick;
    park.month.revenue += r.revenue * perTick;
    park.month.expenses += r.costs * perTick;
    park.month.visitors += r.visitors * perTick;

    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (!rec.animal) return;
      syncKeeper(park, rec); // speed grows with experience
      var before = rec.animal.decoded;
      X.runTick(rec.animal).forEach(function (s) {
        park.cash -= ECO.vetBill;
        park.today.vet += ECO.vetBill;
        park.today.sick++;
        park.month.vet += ECO.vetBill;
        park.month.sick++;
        park.totalSick++;
        park.month.sickBy[id] = (park.month.sickBy[id] || 0) + 1;
        park.reputation = Math.max(0, park.reputation - ECO.sickReputationHit);
        events.push({ type: "sick", exhibitId: id, speciesId: rec.animal.speciesId, kind: s.kind, cause: s.cause, bill: ECO.vetBill });
      });
      if (rec.keeperId) park.keepers[rec.keeperId].xp += rec.animal.decoded - before;
    });

    park.tick++;
    // Courses and research that finished this hour.
    park.keeperOrder.forEach(function (kid) {
      var k = park.keepers[kid];
      if (k.training && park.tick >= k.training.untilTick) {
        k.level = k.training.toLevel;
        k.training = null;
        if (k.exhibitId) syncKeeper(park, park.exhibits[k.exhibitId]);
        events.push({ type: "trained", keeperId: kid, name: k.name, level: k.level });
      }
    });
    var proj = park.lab.project;
    if (proj && park.tick >= proj.untilTick) {
      park.lab.levels[proj.dial]++;
      park.lab.project = null;
      var lab = labValues(park);
      park.order.forEach(function (id) { if (park.exhibits[id].animal) X.setLab(park.exhibits[id].animal, lab); });
      events.push({ type: "research", dial: proj.dial, level: park.lab.levels[proj.dial], value: lab[proj.dial] });
    }

    if (park.tick % ECO.ticksPerDay === 0) {
      // Reputation drifts toward the average health of the animals on show.
      var stocked = park.order.map(function (id) { return park.exhibits[id]; }).filter(function (rec) { return rec.animal; });
      if (stocked.length) {
        var avg = stocked.reduce(function (a, rec) { return a + rec.animal.health; }, 0) / stocked.length;
        park.reputation += (avg - park.reputation) * ECO.reputationDrift;
      }
      park.reputation = Math.max(0, Math.min(100, park.reputation));
      park.yesterday = park.today;
      events.push({
        type: "day", day: day(park) - 1, revenue: park.today.revenue, expenses: park.today.expenses,
        vet: park.today.vet, visitors: park.today.visitors, sick: park.today.sick, reputation: park.reputation
      });
      park.today = { revenue: 0, expenses: 0, vet: 0, visitors: 0, sick: 0 };

      var d = day(park) - 1;
      if (d % DAYS_PER_MONTH === 0) events.push(investorUpdate(park, d / DAYS_PER_MONTH));

      park.daysInDebt = park.cash < 0 ? park.daysInDebt + 1 : 0;
      if (park.daysInDebt >= ECO.bankruptDays) {
        park.status = "lost"; park.endDay = d;
        events.push({ type: "lost", day: d });
      } else if (park.daysInDebt > 0) {
        events.push({ type: "debt", daysInDebt: park.daysInDebt, daysLeft: ECO.bankruptDays - park.daysInDebt });
      } else if (park.status === "playing" && park.cash >= ECO.goal.cash && park.reputation >= ECO.goal.reputation) {
        park.status = "won"; park.endDay = d;
        events.push({ type: "won", day: d });
      }
    }
    return events;
  }

  function investorUpdate(park, monthNumber) {
    var m = park.month, sickest = null;
    Object.keys(m.sickBy).forEach(function (id) {
      if (park.exhibits[id] && (!sickest || m.sickBy[id] > sickest.count)) sickest = { exhibitId: Number(id), count: m.sickBy[id] };
    });
    var r = rates(park);
    var net = m.revenue - m.expenses - m.vet;
    var dailyNet = net / DAYS_PER_MONTH;
    var ev = {
      type: "investor", month: monthNumber, revenue: m.revenue, expenses: m.expenses, vet: m.vet,
      visitors: m.visitors, sick: m.sick, net: net, dailyNet: dailyNet,
      // Runway at this month's average burn (null = not burning cash).
      runwayDays: dailyNet < 0 ? Math.max(0, park.cash) / -dailyNet : null,
      currentNet: r.net, sickest: sickest
    };
    park.month = freshMonth();
    return ev;
  }

  // Keep playing after a win (the goal is met; there is no further one yet).
  function continueAfterWin(park) { if (park.status === "won") park.freePlay = true; }

  // ---------- save / load ----------
  var SAVE_VERSION = 2;
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
      return value;
    }).replace(/^\{/, '{"version":' + SAVE_VERSION + ",");
  }
  function load(json, opts) {
    opts = opts || {};
    var data = typeof json === "string" ? JSON.parse(json) : json;
    if (!data || data.version !== SAVE_VERSION) throw new Error("Unsupported save version");
    delete data.version;
    var park = data;
    park.rng = opts.rng || Math.random;
    Object.keys(park.exhibits).forEach(function (id) {
      var rec = park.exhibits[id];
      if (!Z.BIOMES[rec.biomeId]) throw new Error("Unknown biome in save: " + rec.biomeId);
      if (rec.keeperId && !park.keepers[rec.keeperId]) throw new Error("Unknown keeper in save: " + rec.keeperId);
    });
    Object.keys(park.exhibits).forEach(function (id) {
      var rec = park.exhibits[id];
      if (rec.animal) {
        if (!Z.SPECIES[rec.animal.speciesId]) throw new Error("Unknown species in save: " + rec.animal.speciesId);
        rec.animal = X.restore(rec.animal, { lab: labValues(park), keeper: keeperOnDuty(park, rec), rng: park.rng });
      }
    });
    return park;
  }

  function exhibitLabel(rec) {
    return Z.BIOMES[rec.biomeId].name + " #" + rec.number;
  }

  var Park = {
    createPark: createPark, day: day, hour: hour, footprint: footprint,
    canBuild: canBuild, build: build, exhibitAt: exhibitAt, demolish: demolish,
    speciesOptions: speciesOptions, buyAnimal: buyAnimal,
    keeperSpeed: keeperSpeed, keeperSalary: keeperSalary, keeperOnDuty: keeperOnDuty,
    hireKeeper: hireKeeper, assignKeeper: assignKeeper, fireKeeper: fireKeeper,
    canTrain: canTrain, trainKeeper: trainKeeper,
    labValues: labValues, canResearch: canResearch, startResearch: startResearch,
    exhibitVisitors: exhibitVisitors, exhibitCosts: exhibitCosts, rates: rates,
    tick: tick, exhibitLabel: exhibitLabel, continueAfterWin: continueAfterWin,
    save: save, load: load, DAYS_PER_MONTH: DAYS_PER_MONTH
  };
  if (isNode) module.exports = Park;
  else root.Park = Park;
})(typeof window !== "undefined" ? window : this);

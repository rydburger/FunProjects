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
// yesterday's books at each rollover.
//
// Browser: load after ../stabilizer.js, zoo-data.js, exhibit-sim.js;
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
      rng: opts.rng || Math.random
    };
  }

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
    rec.animal = X.createExhibit({
      speciesId: speciesId, keeperId: rec.keeperId,
      climate: Z.BIOMES[rec.biomeId].climate, rng: park.rng
    });
    return { ok: true };
  }
  function setKeeper(park, id, keeperId) {
    var rec = park.exhibits[id];
    if (!rec) return { ok: false, reason: "No such enclosure." };
    rec.keeperId = keeperId || null;
    if (rec.animal) X.setKeeper(rec.animal, rec.keeperId);
    return { ok: true };
  }

  // ---------- money ----------
  function reputationFactor(park) { return 0.5 + park.reputation / 100; }
  // Visitors per day drawn by one exhibit right now.
  function exhibitVisitors(park, rec) {
    if (!rec.animal) return 0;
    return ECO.visitorsPerAppeal * Z.SPECIES[rec.animal.speciesId].appeal * (rec.animal.health / 100) * reputationFactor(park);
  }
  function exhibitCosts(rec) {
    return Z.BIOMES[rec.biomeId].upkeep + (rec.keeperId ? Z.KEEPERS[rec.keeperId].salary : 0);
  }
  // Current daily rates (what the top bar shows).
  function rates(park) {
    var visitors = 0, costs = 0;
    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      visitors += exhibitVisitors(park, rec);
      costs += exhibitCosts(rec);
    });
    var revenue = visitors * ECO.ticketPrice;
    return { visitors: visitors, revenue: revenue, costs: costs, net: revenue - costs };
  }

  // ---------- time ----------
  // Advance the whole park by one tick (one hour). Returns events:
  //   { type: "sick", exhibitId, speciesId, kind, cause, bill }
  //   { type: "day", day, revenue, expenses, vet, visitors, sick, reputation }
  function tick(park) {
    var events = [];
    var perTick = 1 / ECO.ticksPerDay;
    var r = rates(park);
    park.cash += (r.revenue - r.costs) * perTick;
    park.today.revenue += r.revenue * perTick;
    park.today.expenses += r.costs * perTick;
    park.today.visitors += r.visitors * perTick;

    park.order.forEach(function (id) {
      var rec = park.exhibits[id];
      if (!rec.animal) return;
      X.runTick(rec.animal).forEach(function (s) {
        park.cash -= ECO.vetBill;
        park.today.vet += ECO.vetBill;
        park.today.sick++;
        park.reputation = Math.max(0, park.reputation - ECO.sickReputationHit);
        events.push({ type: "sick", exhibitId: id, speciesId: rec.animal.speciesId, kind: s.kind, cause: s.cause, bill: ECO.vetBill });
      });
    });

    park.tick++;
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
    }
    return events;
  }

  function exhibitLabel(rec) {
    return Z.BIOMES[rec.biomeId].name + " #" + rec.number;
  }

  var Park = {
    createPark: createPark, day: day, hour: hour, footprint: footprint,
    canBuild: canBuild, build: build, exhibitAt: exhibitAt, demolish: demolish,
    speciesOptions: speciesOptions, buyAnimal: buyAnimal, setKeeper: setKeeper,
    exhibitVisitors: exhibitVisitors, exhibitCosts: exhibitCosts, rates: rates,
    tick: tick, exhibitLabel: exhibitLabel
  };
  if (isNode) module.exports = Park;
  else root.Park = Park;
})(typeof window !== "undefined" ? window : this);

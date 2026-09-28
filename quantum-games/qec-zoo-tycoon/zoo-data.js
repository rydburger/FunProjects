// =========================================================
// Error Correction Zoo Tycoon — static game data.
//
// Species (codes), biomes (enclosure check sets + climate), and
// keepers (decoders). Pure data plus Stabilizer.makeCode calls;
// no game state or UI. Loaded by index.html after ../stabilizer.js
// (exposes `window.ZooData`), and by the Node tests via require().
//
// Stabilizer and logical operators are Pauli strings, qubit 0 first.
// Costs and rates are v0 starting numbers, to be tuned in M3.
// =========================================================
(function (root) {
  var Stabilizer = typeof module !== "undefined" && module.exports
    ? require("../stabilizer.js")
    : root.Stabilizer;

  // Pauli string with letter t on the listed qubits, identity elsewhere.
  function sup(n, t, qubits) {
    var s = "";
    for (var q = 0; q < n; q++) s += qubits.indexOf(q) >= 0 ? t : "I";
    return s;
  }
  function range(a, b) { var r = []; for (var i = a; i < b; i++) r.push(i); return r; }
  // Hamming [7,4] parity-check rows as qubit supports.
  var HAMMING = [[3, 4, 5, 6], [1, 2, 5, 6], [0, 2, 4, 6]];

  // ---------- Species (animals = codes) ----------
  // layout: qubit positions in unit-ish coordinates for the inspector
  // drawing (x right, y down). Check nodes are drawn at the centroid of
  // each check's support, so they aren't stored here.
  var SPECIES = {
    tortoise: {
      name: "Repetition Tortoise", glyph: "🐢", tier: 1, cost: 3000, appeal: 40,
      code: Stabilizer.makeCode({
        name: "3-qubit bit-flip code", n: 3,
        stabilizers: ["ZZI", "IZZ"],
        logicalX: "XXX", logicalZ: "ZII"
      }),
      params: "[[3,1,1]] (d=3 against bit flips only)",
      layout: [[0, 0], [1, 0], [2, 0]],
      placard: "The humblest resident of the zoo. It copies one bit three times and checks that " +
        "neighbours agree, so any single bit flip is outvoted. But it has no defence at all " +
        "against phase flips: a single Z on any qubit is a logical error. Keep it somewhere dry."
    },
    owl: {
      name: "Shor Owl", glyph: "🦉", tier: 2, cost: 12000, appeal: 110,
      code: Stabilizer.makeCode({
        name: "Shor code", n: 9,
        stabilizers: [
          sup(9, "Z", [0, 1]), sup(9, "Z", [1, 2]), sup(9, "Z", [3, 4]),
          sup(9, "Z", [4, 5]), sup(9, "Z", [6, 7]), sup(9, "Z", [7, 8]),
          sup(9, "X", range(0, 6)), sup(9, "X", range(3, 9))
        ],
        logicalX: "ZZZZZZZZZ", logicalZ: "XXXXXXXXX"
      }),
      params: "[[9,1,3]]",
      layout: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
      placard: "The first quantum code (Shor, 1995). Three bit-flip repetition codes nested inside " +
        "a phase-flip repetition code: each row guards against X errors, and the rows vote " +
        "against Z errors. Corrects any single-qubit error."
    },
    peacock: {
      name: "Steane Peacock", glyph: "🦚", tier: 2, cost: 15000, appeal: 130,
      code: Stabilizer.makeCode({
        name: "Steane code", n: 7,
        stabilizers: HAMMING.map(function (h) { return sup(7, "X", h); })
          .concat(HAMMING.map(function (h) { return sup(7, "Z", h); })),
        logicalX: "XXXXXXX", logicalZ: "ZZZZZZZ"
      }),
      params: "[[7,1,3]]",
      // Triangle: the smallest 2D color code.
      layout: [[1, 0], [0.5, 1], [1, 1.35], [1.5, 1], [0, 2], [1, 2], [2, 2]],
      placard: "Built from two copies of the classical Hamming code, one for X and one for Z. " +
        "Fewer qubits than the Owl for the same protection, and every Clifford gate can be " +
        "applied transversally — a very well-behaved bird."
    },
    pangolin: {
      name: "Perfect Pangolin", glyph: "🦔", tier: 3, cost: 18000, appeal: 150,
      code: Stabilizer.makeCode({
        name: "Five-qubit code", n: 5,
        stabilizers: ["XZZXI", "IXZZX", "XIXZZ", "ZXIXZ"],
        logicalX: "XXXXX", logicalZ: "ZZZZZ"
      }),
      params: "[[5,1,3]]",
      // Pentagon.
      layout: [[1, 0], [1.95, 0.69], [1.59, 1.81], [0.41, 1.81], [0.05, 0.69]],
      placard: "The smallest code that corrects an arbitrary single-qubit error, and 'perfect': " +
        "every one of its 16 syndromes points to exactly one single-qubit error (or none). " +
        "Its checks mix X and Z, so it needs a habitat unlike any other."
    },
    axolotl: {
      name: "Surface Axolotl", glyph: "🦎", tier: 3, cost: 25000, appeal: 180,
      code: Stabilizer.makeCode({
        name: "Rotated surface code (d=3)", n: 9,
        // 3×3 data grid, row-major. X-type boundaries top/bottom, Z-type left/right.
        stabilizers: [
          sup(9, "X", [0, 1, 3, 4]), sup(9, "X", [4, 5, 7, 8]), sup(9, "X", [1, 2]), sup(9, "X", [6, 7]),
          sup(9, "Z", [1, 2, 4, 5]), sup(9, "Z", [3, 4, 6, 7]), sup(9, "Z", [0, 3]), sup(9, "Z", [5, 8])
        ],
        logicalX: sup(9, "X", [0, 3, 6]), logicalZ: sup(9, "Z", [0, 1, 2])
      }),
      params: "[[9,1,3]]",
      layout: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
      placard: "The flagship of every quantum startup. Only needs checks between nearest " +
        "neighbours on a square grid, and grows gracefully: add rows and columns and it " +
        "keeps getting healthier, as long as the physical error rate stays below threshold."
    }
  };

  // ---------- Biomes (enclosures) ----------
  // checks: the stabilizers the enclosure physically measures. These are
  // deliberately NOT always the species' own generators — they are
  // different generating sets of the same group — so placement is a real
  // group comparison (Stabilizer.sameStabilizerGroup), not an ID match.
  // climate: noise channel name (Stabilizer.channels) and total per-qubit
  // error probability per tick.
  var BIOMES = {
    riverbank: {
      name: "Parity Riverbank", native: "tortoise", cost: 5000, upkeep: 40, footprint: [2, 2],
      climate: { channel: "bitFlip", p: 0.01 },
      checks: ["ZIZ", "IZZ"],
      blurb: "A calm, bit-flip-only stretch of river. Measures pairwise Z parities."
    },
    forest: {
      name: "Nine-Fold Forest", native: "owl", cost: 12000, upkeep: 120, footprint: [3, 3],
      climate: { channel: "depolarizing", p: 0.01 },
      checks: [
        sup(9, "Z", [0, 2]), sup(9, "Z", [1, 2]), sup(9, "Z", [3, 5]),
        sup(9, "Z", [4, 5]), sup(9, "Z", [6, 8]), sup(9, "Z", [7, 8]),
        sup(9, "X", [0, 1, 2, 6, 7, 8]), sup(9, "X", range(3, 9))
      ],
      blurb: "Three groves of three trees. Z parities within each grove, X parities between groves."
    },
    glade: {
      name: "Hamming Glade", native: "peacock", cost: 14000, upkeep: 100, footprint: [3, 3],
      climate: { channel: "depolarizing", p: 0.01 },
      // Row-reduced differently: rows (1+2), 2, 3 of the Hamming checks.
      checks: [
        sup(7, "X", [1, 2, 3, 4]), sup(7, "X", [1, 2, 5, 6]), sup(7, "X", [0, 2, 4, 6]),
        sup(7, "Z", [3, 4, 5, 6]), sup(7, "Z", [0, 1, 4, 5]), sup(7, "Z", [0, 2, 4, 6])
      ],
      blurb: "A triangular clearing. Every check touches four qubits, in matching X and Z pairs."
    },
    dunes: {
      name: "Cyclic Dunes", native: "pangolin", cost: 16000, upkeep: 110, footprint: [3, 2],
      climate: { channel: "depolarizing", p: 0.01 },
      // Four of the five cyclic shifts of XZZXI (the fifth is their product).
      checks: ["IXZZX", "XIXZZ", "ZXIXZ", "ZZXIX"],
      blurb: "Wind-sculpted ridges that repeat every five steps. Checks mix X and Z."
    },
    wetlands: {
      name: "Checkerboard Wetlands", native: "axolotl", cost: 20000, upkeep: 90, footprint: [3, 3],
      climate: { channel: "depolarizing", p: 0.01 },
      checks: [
        sup(9, "X", [0, 2, 3, 4]), sup(9, "X", [4, 5, 7, 8]), sup(9, "X", [1, 2]), sup(9, "X", [6, 7]),
        sup(9, "Z", [1, 2, 4, 5]), sup(9, "Z", [3, 4, 6, 7]), sup(9, "Z", [0, 3]), sup(9, "Z", [5, 8])
      ],
      blurb: "Square ponds in a checkerboard, each checked only by its nearest neighbours."
    }
  };
  Object.keys(BIOMES).forEach(function (id) {
    var b = BIOMES[id];
    b.checkOps = b.checks.map(Stabilizer.fromString);
  });

  // ---------- Keepers (decoders) ----------
  // maxWeight: the lookup table covers errors up to this weight.
  var KEEPERS = {
    intern: { name: "Intern", glyph: "🧑‍🎓", salary: 100, roundsPerTick: 1, maxWeight: 1,
      blurb: "Knows the single-error syndromes by heart. Shrugs at anything else." },
    keeper: { name: "Keeper", glyph: "🧑‍🌾", salary: 300, roundsPerTick: 1, maxWeight: 2,
      blurb: "Always picks the lowest-weight explanation for what they see." },
    head: { name: "Head Keeper", glyph: "🧑‍🔬", salary: 600, roundsPerTick: 3, maxWeight: 2,
      blurb: "Same instincts as a Keeper, but checks on the animals three times as often." }
  };

  // ---------- Economy constants ----------
  var ECONOMY = {
    startingCash: 50000, startingReputation: 50,
    ticksPerDay: 24, parkSize: [12, 8],
    vetBill: 1500, bankruptDays: 7,
    goal: { cash: 250000, reputation: 80 }
  };

  // Can species `speciesId` live in biome `biomeId`? Returns
  // { ok, reason } with a physics-honest explanation on mismatch.
  function checkPlacement(speciesId, biomeId) {
    var code = SPECIES[speciesId].code, biome = BIOMES[biomeId];
    var checks = biome.checkOps;
    if (checks[0].n !== code.n) {
      return { ok: false, reason: "This habitat is built for " + checks[0].n + " qubits; the " +
        SPECIES[speciesId].name + " has " + code.n + "." };
    }
    if (Stabilizer.sameStabilizerGroup(checks, code.stabilizers)) return { ok: true, reason: null };
    var foreign = Stabilizer.firstForeignCheck(code, checks);
    if (foreign && foreign.logical) {
      return { ok: false, reason: "This habitat measures " + Stabilizer.toString(foreign.check) +
        ", which anticommutes with the animal's " + foreign.logical.name + " (" +
        Stabilizer.toString(foreign.logical.op) + ") — measuring it would scramble the animal." };
    }
    if (foreign) {
      return { ok: false, reason: "This habitat measures " + Stabilizer.toString(foreign.check) +
        ", which isn't one of the animal's stabilizers" +
        (foreign.stabilizer ? " and anticommutes with " + Stabilizer.toString(foreign.stabilizer) : "") +
        " — it would keep disturbing the animal." };
    }
    var missing = Stabilizer.missingChecks(code, checks);
    return { ok: false, reason: "This habitat never measures " + Stabilizer.toString(missing[0]) +
      " — errors there would go unnoticed." };
  }

  var ZooData = {
    SPECIES: SPECIES, BIOMES: BIOMES, KEEPERS: KEEPERS, ECONOMY: ECONOMY,
    checkPlacement: checkPlacement
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ZooData;
  else root.ZooData = ZooData;
})(typeof window !== "undefined" ? window : this);

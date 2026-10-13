// =========================================================
// Error Correction Zoo Tycoon — static game data.
//
// Species (codes), biomes (enclosure check sets + climate), keeper
// levels (decoders) and the lab (error rates). Pure data plus Stabilizer.makeCode calls;
// no game state or UI. Loaded by index.html after ../stabilizer.js
// (exposes `window.ZooData`), and by the Node tests via require().
//
// Stabilizer and logical operators are Pauli strings, qubit 0 first.
// Costs and rates are tuned by the seeded bots in tests/zoo-tycoon.test.js.
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
      placard: {
        zoo: "quantum_repetition",
        summary: "Repeats one bit on three qubits and measures the parities of neighbouring pairs " +
          "(Z₀Z₁ and Z₁Z₂). A single bit flip (X) changes one or both parities, which point to the " +
          "odd qubit out. A single phase flip (Z) changes no parity at all and flips the encoded " +
          "state, so against general noise the distance is 1.",
        facts: [
          "Corrects any single bit flip; detects no phase flips.",
          "Encoding a|0⟩ + b|1⟩ as a|000⟩ + b|111⟩ does not copy the state, so it is consistent with the no-cloning theorem.",
          "The phase-flip version, with checks X₀X₁ and X₁X₂, is the same code with X and Z exchanged.",
          "Shor's nine-qubit code (the Shor Owl) nests three bit-flip copies inside a phase-flip copy."
        ],
        origin: "Discussed for quantum computers by A. Peres, Phys. Rev. A 32, 3266 (1985).",
        lab: [
          "Early three-qubit demonstrations: NMR (Cory et al., 1998) and trapped ions (Chiaverini et al., 2004).",
          "Superconducting qubits: Google ran repetition codes up to distance 29 (2024) to measure how logical errors fall with code size."
        ]
      }
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
      placard: {
        zoo: "shor_nine",
        summary: "Three bit-flip repetition codes nested inside a phase-flip repetition code. Z-parity " +
          "checks within each row of three catch bit flips; two six-qubit X checks compare the rows' " +
          "phases to catch phase flips.",
        facts: [
          "The first quantum error-correcting code.",
          "Corrects an arbitrary error on any single qubit and detects any two-qubit error.",
          "Its key insight: any single-qubit error is a combination of I, X, Y = iXZ and Z, so correcting bit flips and phase flips is enough to correct every single-qubit error.",
          "Degenerate: Z₀ and Z₁ differ by the stabilizer Z₀Z₁, so they act identically on the encoded state and the keeper need not tell them apart."
        ],
        origin: "P. W. Shor, “Scheme for reducing decoherence in quantum computer memory,” Phys. Rev. A 52, R2493 (1995).",
        lab: [
          "Its subsystem generalization, the Bacon–Shor code, was run fault-tolerantly on trapped ions (Egan et al., Nature 2021)."
        ]
      }
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
      // Triangle: the smallest 2D color code. Each Hamming check is one of
      // three faces; qubit 6 sits in all three, 2/4/5 on the edges between
      // faces, 0/1/3 at the corners.
      layout: [[2, 1.73], [0, 1.73], [1, 1.73], [1, 0], [1.5, 0.87], [0.5, 0.87], [1, 1.15]],
      placard: {
        zoo: "steane",
        summary: "Built from the classical [7,4,3] Hamming code: its three parity checks are measured " +
          "once as X checks and once as Z checks. Read as a binary number, the three Z checks give " +
          "the position of a bit-flipped qubit, counting from 1; the X checks do the same for phase flips.",
        facts: [
          "The smallest CSS code that corrects an arbitrary single-qubit error.",
          "The logical H, S and CNOT gates are transversal (applied qubit by qubit), so one faulty gate cannot spread errors within a block. Together they generate the Clifford group.",
          "No transversal T gate: universal computation needs extra ingredients such as magic states.",
          "The smallest 2D color code: each pair of X and Z checks covers one face of a triangle."
        ],
        origin: "A. M. Steane, “Error correcting codes in quantum theory,” Phys. Rev. Lett. 77, 793 (1996).",
        lab: [
          "Trapped ions: first realized by R. Blatt's group (Nigg et al., Science 2014); Quantinuum has run repeated rounds with real-time decoding (Ryan-Anderson et al., 2021).",
          "Neutral atoms: used for ten logical qubits with transversal CNOTs (Bluvstein et al., Nature 2023)."
        ]
      }
    },
    pangolin: {
      name: "Perfect Pangolin", glyph: "🦔", tier: 3, cost: 18000, appeal: 150,
      code: Stabilizer.makeCode({
        name: "Five-qubit code", n: 5,
        stabilizers: ["XZZXI", "IXZZX", "XIXZZ", "ZXIXZ"],
        logicalX: "XXXXX", logicalZ: "ZZZZZ"
      }),
      params: "[[5,1,3]]",
      // Pentagon. Each check skips one qubit, so its centroid sits close to
      // the middle; checkSpread pushes the check nodes outward to stay legible.
      layout: [[1, 0], [1.95, 0.69], [1.59, 1.81], [0.41, 1.81], [0.05, 0.69]],
      checkSpread: 2.3,
      placard: {
        zoo: "stab_5_1_3",
        summary: "Four checks, each a cyclic shift of XZZXI. They have 2⁴ = 16 possible outcomes: " +
          "exactly one for 'no error' and one for each of the 15 single-qubit errors (X, Y or Z on " +
          "five qubits). Every syndrome points to exactly one single-qubit error, which makes it a " +
          "perfect code.",
        facts: [
          "The smallest stabilizer code that corrects an arbitrary single-qubit error.",
          "Saturates the quantum Hamming bound: 1 + 3 × 5 = 2⁴.",
          "Not CSS: its checks mix X and Z on the same qubits, so bit flips and phase flips cannot be decoded separately.",
          "Unique: every [[5,1,3]] stabilizer code is equivalent to it."
        ],
        origin: "R. Laflamme, C. Miquel, J. P. Paz and W. H. Zurek, Phys. Rev. Lett. 77, 198 (1996); " +
          "C. H. Bennett, D. P. DiVincenzo, J. A. Smolin and W. K. Wootters, Phys. Rev. A 54, 3824 (1996).",
        lab: [
          "NMR: Knill, Laflamme, Martinez and Negrevergne (2001), on five nuclear spins of labelled crotonic acid.",
          "Diamond: fault-tolerant operation of a logical qubit in nitrogen-vacancy centres (Abobeih et al., Nature 2022)."
        ]
      }
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
      placard: {
        zoo: "rotated_surface",
        summary: "Qubits on a square grid, and every check touches only nearest neighbours: weight-4 X " +
          "and Z checks in a checkerboard, plus weight-2 checks along the edges. Logical X̄ runs down " +
          "a column and Z̄ along a row, so the distance equals the side length. This is the d = 3 " +
          "member of the [[d², 1, d]] family.",
        facts: [
          "Threshold: below a critical physical error rate, each step up in distance suppresses logical errors further; above it, bigger is worse. " +
            "The threshold is about 2.9% with noisy measurements in the phenomenological model (Wang, Harrington and Preskill, 2003) " +
            "and about 0.57% with full circuit noise and matching decoders (Fowler et al., 2012).",
          "Usually decoded by minimum-weight perfect matching on the graph of detection events (Dennis, Kitaev, Landahl and Preskill, 2002).",
          "With 8 measurement ancillas, this d = 3 version is often called Surface-17."
        ],
        origin: "A. Yu. Kitaev (1997): the toric code. S. B. Bravyi and A. Yu. Kitaev; M. H. Freedman and D. A. Meyer (1998): " +
          "planar versions with boundaries. H. Bombín and M. A. Martín-Delgado (2007): the rotated layout, about half the qubits for the same distance.",
        lab: [
          "Superconducting qubits, d = 3: ETH Zürich (Krinner et al., Nature 2022) and USTC (Zhao et al., PRL 2022).",
          "Google Quantum AI: d = 5 beat d = 3 (Nature 2023); then d = 3, 5, 7 below threshold on the Willow chip, the logical error rate falling about 2× per step in distance (Nature 2025)."
        ]
      }
    }
  };

  // ---------- Biomes (enclosures) ----------
  // checks: the stabilizers the enclosure physically measures. These are
  // deliberately NOT always the species' own generators — they are
  // different generating sets of the same group — so placement is a real
  // group comparison (Stabilizer.sameStabilizerGroup), not an ID match.
  // climate: the noise channel (Stabilizer.channels) of the enclosure's
  // hardware; the error rates come from the lab (LAB above).
  var BIOMES = {
    riverbank: {
      name: "Parity Riverbank", native: "tortoise", cost: 5000, upkeep: 40, footprint: [2, 2],
      climate: { channel: "bitFlip" },
      checks: ["ZIZ", "IZZ"],
      blurb: "A calm, bit-flip-only stretch of river. Measures pairwise Z parities."
    },
    forest: {
      name: "Nine-Fold Forest", native: "owl", cost: 12000, upkeep: 120, footprint: [3, 3],
      climate: { channel: "depolarizing" },
      checks: [
        sup(9, "Z", [0, 2]), sup(9, "Z", [1, 2]), sup(9, "Z", [3, 5]),
        sup(9, "Z", [4, 5]), sup(9, "Z", [6, 8]), sup(9, "Z", [7, 8]),
        sup(9, "X", [0, 1, 2, 6, 7, 8]), sup(9, "X", range(3, 9))
      ],
      blurb: "Three groves of three trees. Z parities within each grove, X parities between groves."
    },
    glade: {
      name: "Hamming Glade", native: "peacock", cost: 14000, upkeep: 100, footprint: [3, 3],
      climate: { channel: "depolarizing" },
      // Row-reduced differently: rows (1+2), 2, 3 of the Hamming checks.
      checks: [
        sup(7, "X", [1, 2, 3, 4]), sup(7, "X", [1, 2, 5, 6]), sup(7, "X", [0, 2, 4, 6]),
        sup(7, "Z", [3, 4, 5, 6]), sup(7, "Z", [0, 1, 4, 5]), sup(7, "Z", [0, 2, 4, 6])
      ],
      blurb: "A triangular clearing. Every check touches four qubits, in matching X and Z pairs."
    },
    dunes: {
      name: "Cyclic Dunes", native: "pangolin", cost: 16000, upkeep: 110, footprint: [3, 2],
      climate: { channel: "depolarizing" },
      // Four of the five cyclic shifts of XZZXI (the fifth is their product).
      checks: ["IXZZX", "XIXZZ", "ZXIXZ", "ZZXIX"],
      blurb: "Wind-sculpted ridges that repeat every five steps. Checks mix X and Z."
    },
    wetlands: {
      name: "Checkerboard Wetlands", native: "axolotl", cost: 20000, upkeep: 90, footprint: [3, 3],
      climate: { channel: "depolarizing" },
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
  // Every keeper is hired as a trainee and learns on the job. A level is a
  // decoding algorithm. `work` is its effort per syndrome round, in table
  // lookups; space-time decoders also scale with the number of checks
  // (see ExhibitSim.workPerRound). A keeper decodes at most `speed` units
  // per hour, and speed grows with experience. A keeper who can't keep up
  // with an algorithm at an exhibit's measurement cycle falls back to the
  // best one they can run in real time.
  var KEEPER_LEVELS = [
    null,
    { level: 1, title: "Trainee", algorithm: "lookup", maxWeight: 1, window: 1, work: 1, salary: 120,
      blurb: "Single-shot lookup: knows the syndrome of every single-qubit error and takes each round's outcomes at face value." },
    { level: 2, title: "Keeper", algorithm: "lookup", maxWeight: 2, window: 1, work: 1.5, salary: 150,
      blurb: "Single-shot minimum-weight lookup: also knows the likeliest weight-2 explanations, but still trusts every outcome." },
    { level: 3, title: "Senior keeper", algorithm: "spacetime", window: 2, work: 2, salary: 190,
      blurb: "Space-time decoding over 2 rounds: a check that flips and then flips back was a misread measurement, not an error." },
    { level: 4, title: "Head keeper", algorithm: "spacetime", window: 3, work: 3, salary: 240,
      blurb: "Space-time decoding over 3 rounds: more evidence before committing to a correction." }
  ];
  var MAX_KEEPER_LEVEL = KEEPER_LEVELS.length - 1;
  // Training to `level`: experience needed (rounds decoded), days of study, fee.
  var TRAINING = {
    2: { xp: 150, days: 1, fee: 1000 },
    3: { xp: 500, days: 2, fee: 2500 },
    4: { xp: 1200, days: 3, fee: 5000 }
  };
  // Decoding speed in work units per hour: base + xp × perXp, capped.
  var KEEPER_SPEED = { base: 4, perXp: 1 / 300, max: 12 };
  var KEEPER_NAMES = ["Alex", "Sam", "Robin", "Jordan", "Kai", "Noor", "Priya", "Tomás", "Mei", "Yusuf",
    "Inès", "Lars", "Zara", "Felix", "Amara", "Hiro", "Leila", "Owen", "Sana", "Teo", "Wren", "Ola", "Dev", "Rosa"];

  // ---------- The lab (physical error rates) ----------
  // Each dial has a value per research level (index 0 = starting
  // hardware). Per syndrome round, data qubit j gets
  //   coherence / cycle  +  (checks wired to j) × gates
  // of the enclosure's channel, and check i is misread with probability
  //   readout + (weight of i) × gates.
  // This is the phenomenological model with a rough charge for the CNOTs
  // in each round; circuit-level noise (CNOT order, hook errors) is a
  // later milestone.
  var LAB = {
    coherence: { name: "Coherence", values: [0.008, 0.0055, 0.0035, 0.002], unit: "idle error per qubit per hour",
      blurb: "Longer-lived qubits: less error on every data qubit while it waits." },
    gates: { name: "Two-qubit gates", values: [0.0008, 0.0006, 0.0004, 0.0002], unit: "error per CNOT",
      blurb: "Cleaner CNOTs between ancillas and data. Every round, each data qubit pays once per check it is wired to." },
    readout: { name: "Readout", values: [0.01, 0.007, 0.0045, 0.0025], unit: "chance a check is misread",
      blurb: "Fewer misreported check outcomes." },
    cycle: { name: "Syndrome cycle", values: [1, 2, 3], unit: "rounds per hour",
      blurb: "Measure more often: less idle error per round, but every round brings its own gate and readout errors, and keepers have more rounds to decode." }
  };
  // Cost of each research step, by the level being reached.
  var RESEARCH = [null, { fee: 5000, days: 2 }, { fee: 12000, days: 4 }, { fee: 25000, days: 6 }];

  // ---------- Economy constants ----------
  var ECONOMY = {
    startingCash: 50000, startingReputation: 50,
    ticksPerDay: 24, parkSize: [12, 8],
    vetBill: 2500, bankruptDays: 7,
    ticketPrice: 12,          // $ per visitor
    visitorsPerAppeal: 0.8,   // visitors/day per point of appeal, at full health and reputation 50
    sickReputationHit: 1.5,    // reputation lost per logical error
    reputationDrift: 0.15,    // daily pull of reputation toward average animal health
    demolishRefund: 0.5,      // fraction of build cost returned
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
    SPECIES: SPECIES, BIOMES: BIOMES, ECONOMY: ECONOMY,
    KEEPER_LEVELS: KEEPER_LEVELS, MAX_KEEPER_LEVEL: MAX_KEEPER_LEVEL, TRAINING: TRAINING,
    KEEPER_SPEED: KEEPER_SPEED, KEEPER_NAMES: KEEPER_NAMES, LAB: LAB, RESEARCH: RESEARCH,
    checkPlacement: checkPlacement
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ZooData;
  else root.ZooData = ZooData;
})(typeof window !== "undefined" ? window : this);

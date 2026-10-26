// =========================================================
// Error Correction Zoo Tycoon — static game data.
//
// Species (codes), biomes (enclosure check sets + climate), keeper
// levels (decoders), the lab (error rates) and the habitat workshop. Pure data plus Stabilizer.makeCode calls;
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
      name: "Repetition Tortoise", glyph: "🐢", tier: 1, cost: 100000, appeal: 40,
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
      name: "Shor Owl", glyph: "🦉", tier: 2, cost: 450000, appeal: 110,
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
      name: "Steane Peacock", glyph: "🦚", tier: 2, cost: 500000, appeal: 130,
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
      name: "Perfect Pangolin", glyph: "🦔", tier: 3, cost: 550000, appeal: 150,
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
      name: "Surface Axolotl", glyph: "🦎", tier: 3, cost: 800000, appeal: 180,
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
    },
    // Discoverable in the habitat workshop (no one starts out knowing them).
    penguins: {
      name: "Iceberg Penguins", glyph: "🐧", tier: 1, cost: 120000, appeal: 50,
      code: Stabilizer.makeCode({
        name: "[[4,2,2]] code", n: 4,
        stabilizers: ["XXXX", "ZZZZ"],
        logicalX: ["XXII", "XIXI"], logicalZ: ["ZIZI", "ZZII"]
      }),
      params: "[[4,2,2]] (two animals)",
      layout: [[0, 0], [1, 0], [0, 1], [1, 1]],
      placard: {
        zoo: "stab_4_2_2",
        summary: "Four qubits and two checks, X on all four and Z on all four, holding two logical qubits. " +
          "Any single-qubit error flips at least one check, so it is always noticed. But an X on any of the " +
          "four qubits flips the same check, so the keeper can't tell which qubit to fix: distance 2 detects " +
          "one error and corrects none.",
        facts: [
          "No smaller code detects an arbitrary single-qubit error: there is no [[3,1,2]] stabilizer code.",
          "Meets the quantum Singleton bound n − k ≥ 2(d − 1) with equality: 4 − 2 = 2.",
          "The smallest iceberg code: [[m, m − 2, 2]] for even m, with one X check and one Z check on every qubit.",
          "Detection is still useful: runs in which a check fires can be thrown away (postselection), which suppresses errors at the cost of retries."
        ],
        origin: "L. Vaidman, L. Goldenberg and S. Wiesner, Phys. Rev. A 54, R1745 (1996); " +
          "M. Grassl, Th. Beth and T. Pellizzari, Phys. Rev. A 56, 33 (1997).",
        lab: [
          "Trapped ions: fault-tolerant error detection (Linke et al., Science Advances 2017).",
          "Superconducting qubits: fault-tolerant state preparation at IBM (Takita et al., PRL 2017).",
          "Quantinuum used larger iceberg codes to protect whole algorithms on trapped ions (Self, Benedetti and Amaro, Nature Physics 2024)."
        ]
      }
    },
    giant: {
      name: "Giant Axolotl", glyph: "🐉", tier: 4, cost: 1500000, appeal: 320,
      code: (function () { var c = Stabilizer.rotatedSurface(5); c.name = "Rotated surface code (d=5)"; return c; })(),
      params: "[[25,1,5]]",
      layout: range(0, 25).map(function (q) { return [q % 5, Math.floor(q / 5)]; }),
      placard: {
        zoo: "rotated_surface",
        summary: "The distance-5 member of the Surface Axolotl's family: 25 data qubits on a 5×5 grid with " +
          "12 X checks and 12 Z checks, weight 4 inside and weight 2 on the edges. Logical X̄ runs down a " +
          "column and Z̄ along a row, five qubits each, so any two errors can be corrected.",
        facts: [
          "Corrects any two single-qubit errors; it takes three in the wrong places to cause a logical error.",
          "Below threshold the logical error rate falls roughly as (p / p_th)^((d + 1)/2), so going from d = 3 to d = 5 helps; above threshold the bigger code does worse.",
          "With one measurement ancilla per check it uses 25 + 24 = 49 qubits.",
          "Matching decoders pair up detection events along the likeliest error chains in space and time."
        ],
        origin: "A. Yu. Kitaev (1997); S. B. Bravyi and A. Yu. Kitaev (1998); H. Bombín and M. A. Martín-Delgado (2007): " +
          "the rotated layout.",
        lab: [
          "Google Quantum AI: the first time a bigger surface code beat a smaller one, d = 5 against d = 3 on 72 superconducting qubits (Nature 2023).",
          "Willow chip: d = 3, 5 and 7, with logical errors falling about 2× per step in distance (Nature 2025)."
        ]
      }
    }
  };

  // ---------- Biomes (enclosures) ----------
  // cost and upkeep ($/day) are the experiment's; buildDays is how long
  // construction takes once paid for. A catalogue habitat is quicker to
  // build than a new design of the same size: the know-how exists.
  // checks: the stabilizers the enclosure physically measures. These are
  // deliberately NOT always the species' own generators — they are
  // different generating sets of the same group — so placement is a real
  // group comparison (Stabilizer.sameStabilizerGroup), not an ID match.
  // climate: the noise channel (Stabilizer.channels) of the enclosure's
  // hardware; the error rates come from the lab (LAB above).
  var BIOMES = {
    riverbank: {
      name: "Parity Riverbank", native: "tortoise", cost: 300000, upkeep: 800, buildDays: 45, footprint: [2, 2],
      climate: { channel: "bitFlip" },
      checks: ["ZIZ", "IZZ"],
      blurb: "A calm, bit-flip-only stretch of river. Measures pairwise Z parities."
    },
    forest: {
      name: "Nine-Fold Forest", native: "owl", cost: 1100000, upkeep: 2800, buildDays: 240, footprint: [3, 3],
      climate: { channel: "depolarizing" },
      checks: [
        sup(9, "Z", [0, 2]), sup(9, "Z", [1, 2]), sup(9, "Z", [3, 5]),
        sup(9, "Z", [4, 5]), sup(9, "Z", [6, 8]), sup(9, "Z", [7, 8]),
        sup(9, "X", [0, 1, 2, 6, 7, 8]), sup(9, "X", range(3, 9))
      ],
      blurb: "Three groves of three trees. Z parities within each grove, X parities between groves."
    },
    glade: {
      name: "Hamming Glade", native: "peacock", cost: 880000, upkeep: 2200, buildDays: 180, footprint: [3, 3],
      climate: { channel: "depolarizing" },
      // Row-reduced differently: rows (1+2), 2, 3 of the Hamming checks.
      checks: [
        sup(7, "X", [1, 2, 3, 4]), sup(7, "X", [1, 2, 5, 6]), sup(7, "X", [0, 2, 4, 6]),
        sup(7, "Z", [3, 4, 5, 6]), sup(7, "Z", [0, 1, 4, 5]), sup(7, "Z", [0, 2, 4, 6])
      ],
      blurb: "A triangular clearing. Every check touches four qubits, in matching X and Z pairs."
    },
    dunes: {
      name: "Cyclic Dunes", native: "pangolin", cost: 620000, upkeep: 1500, buildDays: 120, footprint: [3, 2],
      climate: { channel: "depolarizing" },
      // Four of the five cyclic shifts of XZZXI (the fifth is their product).
      checks: ["IXZZX", "XIXZZ", "ZXIXZ", "ZZXIX"],
      blurb: "Wind-sculpted ridges that repeat every five steps. Checks mix X and Z."
    },
    wetlands: {
      name: "Checkerboard Wetlands", native: "axolotl", cost: 1150000, upkeep: 2800, buildDays: 270, footprint: [3, 3],
      climate: { channel: "depolarizing" },
      checks: [
        sup(9, "X", [0, 2, 3, 4]), sup(9, "X", [4, 5, 7, 8]), sup(9, "X", [1, 2]), sup(9, "X", [6, 7]),
        sup(9, "Z", [1, 2, 4, 5]), sup(9, "Z", [3, 4, 6, 7]), sup(9, "Z", [0, 3]), sup(9, "Z", [5, 8])
      ],
      blurb: "Square ponds in a checkerboard, each checked only by its nearest neighbours."
    },
    floe: {
      name: "Iceberg Floe", native: "penguins", cost: 400000, upkeep: 1000, buildDays: 70, footprint: [2, 2],
      climate: { channel: "depolarizing" },
      // YYYY is XXXX × ZZZZ (up to a phase): same group, different generators.
      checks: ["XXXX", "YYYY"],
      blurb: "One slab of ice, four qubits, two checks on every one of them."
    },
    marsh: {
      name: "Grand Marsh", native: "giant", cost: 3200000, upkeep: 8000, buildDays: 400, footprint: [5, 5],
      climate: { channel: "depolarizing" },
      // The species' checks, except that the first two X plaquettes are
      // measured as one and their product.
      checks: (function () {
        var st = Stabilizer.rotatedSurface(5).stabilizers.slice();
        var xs = st.map(function (P, i) { return P.z === 0 ? i : -1; }).filter(function (i) { return i >= 0; });
        st[xs[0]] = Stabilizer.multiply(st[xs[0]], st[xs[1]]);
        return st.map(Stabilizer.toString);
      })(),
      blurb: "A wide checkerboard of ponds, five by five, still checked only between neighbours."
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
    { level: 1, title: "Trainee", algorithm: "lookup", maxWeight: 1, window: 1, work: 1, salary: 450,
      blurb: "Single-shot lookup: knows the syndrome of every single-qubit error and takes each round's outcomes at face value." },
    { level: 2, title: "Keeper", algorithm: "lookup", maxWeight: 2, window: 1, work: 1.5, salary: 550,
      blurb: "Single-shot minimum-weight lookup: also knows the likeliest weight-2 explanations, but still trusts every outcome." },
    { level: 3, title: "Senior keeper", algorithm: "spacetime", window: 2, work: 2, salary: 700,
      blurb: "Space-time decoding over 2 rounds: a check that flips and then flips back was a misread measurement, not an error." },
    { level: 4, title: "Head keeper", algorithm: "spacetime", window: 3, work: 3, salary: 850,
      blurb: "Space-time decoding over 3 rounds: more evidence before committing to a correction." }
  ];
  var MAX_KEEPER_LEVEL = KEEPER_LEVELS.length - 1;
  // Training to `level`: experience needed (rounds decoded), days of study, fee.
  var TRAINING = {
    2: { xp: 500, days: 3, fee: 20000 },
    3: { xp: 2000, days: 5, fee: 50000 },
    4: { xp: 5000, days: 7, fee: 100000 }
  };
  // Decoding speed in work units per hour: base + xp × perXp, capped.
  var KEEPER_SPEED = { base: 4, perXp: 1 / 1000, max: 12 };
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
  var RESEARCH = [null, { fee: 1500000, days: 30 }, { fee: 4000000, days: 60 }, { fee: 10000000, days: 90 }];

  // ---------- The habitat workshop (freeform building) ----------
  // A design places data qubits and check ancillas on a grid and wires each
  // check to data qubits (habitat.js). Every qubit, data or ancilla, costs
  // the same and takes half a tile of park; every wire (one CNOT per round)
  // costs extra. The textbook species start out unknown, except those in
  // START_KNOWN: building a working design of one in the workshop discovers
  // it, which also unlocks its catalogue habitat above.
  var BUILD = {
    grid: 11,               // the workshop grid is grid × grid cells
    maxData: 32, maxChecks: 32,
    perQubit: 60000, perWire: 5000,
    upkeepPerQubit: 150, upkeepPerWire: 10,
    qubitsPerTile: 2,
    // Construction time grows with the qubit count (data + ancilla):
    // days = refDays × (qubits / refQubits)^exponent, clamped. The d = 3
    // surface code (17 qubits) takes a year to get running.
    days: { refQubits: 17, refDays: 365, exponent: 1.2, min: 30, max: 540 }
  };
  var START_KNOWN = ["tortoise"];
  // Reference designs of the textbook species: data qubit and check
  // positions on the workshop grid; check i measures the species' i-th
  // stabilizer. Used by the tests (and the seeded bots) to discover
  // species; players find their own.
  function surfacePositions(d, code) {
    var qubits = [], checkAt = [];
    for (var q = 0; q < d * d; q++) qubits.push([2 * (q % d) + 1, 2 * Math.floor(q / d) + 1]);
    code.stabilizers.forEach(function (P) {
      var sx = 0, sy = 0, w = 0, rows = [], cols = [];
      for (var j = 0; j < d * d; j++) {
        if (((P.x | P.z) >>> j) & 1) { sx += qubits[j][0]; sy += qubits[j][1]; w++; rows.push(Math.floor(j / d)); cols.push(j % d); }
      }
      var x = sx / w, y = sy / w;
      if (w === 2) {
        // Edge checks sit just outside the grid of data qubits.
        if (rows[0] === rows[1]) y += rows[0] === 0 ? -1 : 1;
        else x += cols[0] === 0 ? -1 : 1;
      }
      checkAt.push([x, y]);
    });
    return { qubits: qubits, checkAt: checkAt };
  }
  var DESIGNS = {
    tortoise: { qubits: [[3, 5], [5, 5], [7, 5]], checkAt: [[4, 4], [6, 4]] },
    owl: {
      qubits: [[2, 2], [4, 2], [6, 2], [2, 5], [4, 5], [6, 5], [2, 8], [4, 8], [6, 8]],
      checkAt: [[3, 2], [5, 2], [3, 5], [5, 5], [3, 8], [5, 8], [8, 3], [8, 7]]
    },
    peacock: {
      qubits: [[9, 8], [1, 8], [5, 8], [5, 1], [7, 4], [3, 4], [5, 6]],
      checkAt: [[5, 3], [3, 6], [7, 6], [5, 4], [3, 7], [7, 7]]
    },
    pangolin: { qubits: [[5, 1], [9, 4], [7, 8], [3, 8], [1, 4]], checkAt: [[7, 5], [5, 7], [3, 5], [4, 3]] },
    axolotl: surfacePositions(3, SPECIES.axolotl.code),
    penguins: { qubits: [[3, 3], [5, 3], [3, 5], [5, 5]], checkAt: [[4, 1], [4, 7]] },
    giant: surfacePositions(5, SPECIES.giant.code)
  };
  // Species nobody has catalogued: appeal per animal by distance (beyond
  // the table, +40 per step), price per animal = appeal × costPerAppeal.
  var CUSTOM = {
    appealByDistance: [0, 25, 60, 120, 160, 210],
    costPerAppeal: 4000,
    glyphs: ["🦊", "🦦", "🦥", "🦡", "🦫", "🦩", "🦜", "🐸", "🦭", "🦓", "🦒", "🐙", "🦋", "🐞", "🦑", "🐌",
      "🦘", "🦬", "🐿️", "🦨", "🐳", "🦈", "🐠", "🦀"]
  };

  // ---------- Economy constants ----------
  var ECONOMY = {
    startingCash: 10000000, startingReputation: 50,
    ticksPerDay: 24,
    // The lot grows with each round closed (index = rounds closed after the seed).
    lots: [[12, 8], [14, 10], [16, 12], [18, 13], [20, 14], [22, 15]],
    vetBill: 10000, bankruptDays: 7,
    ticketPrice: 20,          // $ per visitor
    visitorsPerAppeal: 2,     // visitors/day per point of appeal, at full health and reputation 50
    sickReputationHit: 1.5,    // reputation lost per logical error
    reputationDrift: 0.15,    // daily pull of reputation toward average animal health
    demolishRefund: 0.5,      // fraction of build cost returned
    historyDays: 120          // daily books kept for growth and error-rate metrics
  };


  // ---------- Funding: rounds, valuation, investors ----------
  // The company raises round after round until it lists. A round succeeds
  // when the valuation investors put on the zoo (Investors.valuation)
  // reaches its target; the zoo then sells `raise` of itself for cash at
  // that valuation. Between 60% and 100% of the target, investors offer a
  // bridge instead: a little cash, no new letter.
  var ROUNDS = [
    { id: "seed", name: "Seed", valuation: 40000000, raised: 10000000 }, // closed before day 1
    { id: "a", name: "Series A", target: 300000000, raise: 0.15, premium: 1,
      roadmap: [
        { metric: "species", min: 3, label: "Discover 3 species" },
        { metric: "logicalQubits", min: 4, label: "4 animals (logical qubits) on show" },
        { metric: "bestDistance", min: 3, label: "A distance-3 code on show" },
        { metric: "revenue", min: 20000, label: "$20k a day in ticket sales" }
      ] },
    { id: "b", name: "Series B", target: 2000000000, raise: 0.12, premium: 1.25,
      roadmap: [
        { metric: "species", min: 5, label: "Discover 5 species" },
        { metric: "logicalQubits", min: 10, label: "10 animals on show" },
        { metric: "bestDistance", min: 5, label: "A distance-5 code on show" },
        { metric: "headKeepers", min: 1, label: "A head keeper on staff" },
        { metric: "revenue", min: 50000, label: "$50k a day in ticket sales" }
      ] },
    { id: "c", name: "Series C", target: 5000000000, raise: 0.1, premium: 1.6,
      roadmap: [
        { metric: "species", min: 7, label: "Discover 7 species" },
        { metric: "logicalQubits", min: 18, label: "18 animals on show" },
        { metric: "labLevels", min: 6, label: "6 lab upgrades" },
        { metric: "revenue", min: 90000, label: "$90k a day in ticket sales" }
      ] },
    { id: "d", name: "Series D", target: 10000000000, raise: 0.08, premium: 2,
      roadmap: [
        { metric: "logicalQubits", min: 26, label: "26 animals on show" },
        { metric: "errorRate", max: 0.02, label: "Under 0.02 logical errors per animal per day" },
        { metric: "morale", min: 60, label: "Team morale 60+" },
        { metric: "revenue", min: 130000, label: "$130k a day in ticket sales" }
      ] },
    { id: "ipo", name: "IPO", target: 20000000000, raise: 0.1, premium: 3, ipo: true,
      roadmap: [
        { metric: "logicalQubits", min: 34, label: "34 animals on show" },
        { metric: "species", min: 9, label: "Discover 9 species" },
        { metric: "labLevels", min: 10, label: "10 lab upgrades" },
        { metric: "revenue", min: 170000, label: "$170k a day in ticket sales" }
      ] }
  ];
  var FUNDING = {
    roadshowDays: 21,     // a raise takes this long; investors tour throughout
    roadshowTourEvery: 3, // days between roadshow tours
    cooldownDays: 45,     // after a pass or a bridge, before the next attempt
    afterCloseDays: 300,  // after a round closes: investors want to see the money at work
    bridgeAt: 0.6,        // fraction of the target that earns a bridge offer
    bridgeRaise: 0.06     // fraction of the zoo sold in a bridge
  };
  // What investors think the zoo is worth:
  //   (revenue/yr × revenue multiple + tech) × hype × stage premium × roadmap factor
  // revenue multiple = base + perGrowth × (30-day revenue growth, capped at
  // 100%); tech = perQubitD2 × Σ animals × d² × health + perSpecies ×
  // species known + perLabLevel × lab upgrades; hype doubles every
  // `hypeDoubling` points of confidence above 50 (and halves below);
  // roadmap factor = 1 − roadmapWeight × (share of milestones missed).
  var VALUATION = {
    revMultipleBase: 20, revMultiplePerGrowth: 40,
    perQubitD2: 6000000, perSpecies: 30000000, perLabLevel: 20000000,
    hypeDoubling: 30, roadmapWeight: 0.35
  };
  // Investor confidence (0–100) moves with tours and news, and drifts back
  // toward 50 as memories fade.
  var CONFIDENCE = {
    start: 50, reversion: 0.01, // per day
    tourWeight: 0.2,            // confidence += tourWeight × (impression − 50)
    discovery: 2, milestone: 3, resignation: 3, debtPerDay: 2, monthGrowth: 4
  };
  // What investors weigh on a tour. Each fund cares about one thing most.
  var FOCUS = {
    health: "healthy animals",
    errors: "low logical error rates",
    team: "a happy team",
    roadmap: "hitting the roadmap",
    growth: "growth",
    wow: "big codes and rare species"
  };
  var INVESTORS = [
    { fund: "Hockey Stick Ventures", focus: "growth" },
    { fund: "Exit Velocity Partners", focus: "growth" },
    { fund: "Asymptote Capital", focus: "errors" },
    { fund: "Five Nines Fund", focus: "errors" },
    { fund: "Unicorn Ranch", focus: "wow" },
    { fund: "Moonshot & Sons", focus: "wow" },
    { fund: "First Principles Capital", focus: "roadmap" },
    { fund: "Gantt Chart Partners", focus: "roadmap" },
    { fund: "Culture Eats Strategy LP", focus: "team" },
    { fund: "Founder Friendly Fund", focus: "team" },
    { fund: "Bedside Manner Ventures", focus: "health" },
    { fund: "Synergy Growth Fund IV", focus: "health" }
  ];
  var INVESTOR_NAMES = ["Chad", "Brooke", "Thaddeus", "Skylar", "Preston", "Margaux", "Biff", "Paloma", "Kip", "Sloane",
    "Rajiv", "Ingrid", "Hunter", "Courtney", "Dmitri", "Blair"];
  // Tours: an investor walks past up to `stops` exhibits between the
  // opening and closing hours. A logical error on the route while they
  // watch costs `incidentPenalty` impression points.
  var TOURS = { everyDays: [15, 25], start: 10, end: 18, stops: 3, incidentPenalty: 25 };
  // Wining and dining: one per tour, a flat boost to the impression.
  var PERKS = [
    { id: "steak", name: "Steak dinner", cost: 15000, boost: 6,
      blurb: "Dry-aged ribeye, a bottle you can't pronounce, and a TAM slide on a napkin." },
    { id: "omakase", name: "Omakase", cost: 45000, boost: 10,
      blurb: "Twenty courses at an unmarked door. The chef has a waitlist and an NDA." },
    { id: "cabin", name: "Ski weekend", cost: 140000, boost: 15,
      blurb: "The founder's 'cabin' has a helipad. Nobody mentions the burn rate." }
  ];

  // Lines investors say. Round outcomes by tier (valuation ÷ target), tour
  // impressions by score, the monthly update by how the month went.
  var QUOTES = {
    round: {
      legendary: [
        "This is a generational company. Possibly a generational zoo.",
        "We're not investing in a zoo. We're investing in the concept of zoos.",
        "I told my LPs this is the next internet. Then I told them it's bigger.",
        "Frankly the term sheet is a formality. Here are four of them.",
        "We'd like to lead, co-lead and also follow.",
        "I haven't felt like this since I passed on that search engine.",
        "Category-defining. Category-creating. Honestly, category-eating.",
        "We ran the numbers. Then we stopped, because numbers are for later-stage companies.",
        "You're the Steve Jobs of stabilizers. The Oprah of observables.",
        "Our partners cleared their calendars. Then we cleared out a few partners to make room."
      ],
      great: [
        "Rare to see this much founder-market fit. Is the market zoos or quantum? Yes.",
        "There's a clear path to a trillion-dollar TAM if you squint at the logical qubits.",
        "The axolotls tested off the charts with our focus group.",
        "Your burn rate is aggressive in exactly the way we like.",
        "We see a platform here. Every zoo will need a quantum zoo.",
        "Moats don't get deeper than a distance-5 surface code.",
        "We usually don't do zoos. We usually don't do quantum. Two negatives make a term sheet."
      ],
      good: [
        "Strong team, strong tortoise. We're in.",
        "We like the logical error rates. We like the vibes more.",
        "Solid execution. Let's not tell the other partners we understood the decoder slide.",
        "The deck had a hockey stick and an actual animal on it. Rare combination.",
        "Diligence confirmed the animals are, in fact, logical qubits. Wiring the money.",
        "Disciplined, capital-efficient and adorable."
      ],
      bridge: [
        "We love it, but we'd love it more at a lower price.",
        "Have you considered adding AI? Not to the zoo. To the deck.",
        "It's a great science project. Science projects need bridges.",
        "We'd like to stay close. Close enough to watch, far enough not to wire much.",
        "Can you send the deck again, but make the line go up?",
        "Let's call it a Series A-minus. Very fashionable right now."
      ],
      pass: [
        "We're going to pass for now, but please keep us updated. (We won't read the updates.)",
        "The pangolin bit our associate. That's a no from us.",
        "Who's the competition? Oh, entropy. Tough market.",
        "Come back when the logical error rate has fewer digits.",
        "This feels early. Like, Big Bang early.",
        "We only invest in companies that are already successful."
      ],
      ipo: [
        "The bell rang. Mostly it was the vets' pagers, but it rang.",
        "Analysts rate the stock 'Strong Buy', citing 'the vibes' and 'that one axolotl'.",
        "First-day pop: 80%. The tortoise remains unbothered.",
        "A bank analyst asked what a stabilizer is. The roadshow worked."
      ]
    },
    tour: {
      dazzled: [
        "I came for the axolotls and stayed for the syndrome extraction.",
        "My kids are going to want a Pauli frame for Christmas.",
        "Every animal was healthy. Are they AI-generated?",
        "That's the most coherent thing I've seen all quarter.",
        "I didn't see a single logical error. I saw my next fund."
      ],
      pleased: [
        "Lovely zoo. The gift shop needs a Steane Peacock plushie.",
        "Good energy. Good error rates. Good parking.",
        "The keepers seemed happy. Suspiciously happy.",
        "I'm going to say 'fault-tolerant' at dinner tonight and see what happens."
      ],
      neutral: [
        "Fine. Very fine. Medium-fine.",
        "I didn't understand the decoder, but I nodded at the right times.",
        "Has anyone tried this with fewer qubits and more blockchain?",
        "Nice zoo. Is it a zoo, though? Strategically?"
      ],
      worried: [
        "The animal in the third enclosure looked… decohered.",
        "Is it normal for the keepers to cry?",
        "I asked about the roadmap and someone handed me a map of the zoo.",
        "My associate counted the logical errors. My associate is now on leave."
      ],
      appalled: [
        "An animal got sick right in front of my LP.",
        "The Owl looked at me like I was a measurement error.",
        "I've seen better error rates on a coin toss.",
        "We'll be in touch. (We will not be in touch.)"
      ],
      incident: [
        "I watched a logical error happen live. Riveting. Terrifying. Mostly terrifying.",
        "A vet ran past me shouting 'Z-bar! Z-bar!' Is that good?"
      ]
    },
    month: {
      great: ["Textbook fault tolerance. We're very excited about this team.", "Up and to the right, as the qubits intended."],
      good: ["Revenue looks great, but walk us through those logical errors.", "Solid month. Please stop calling the board 'the stabilizers'."],
      burn: ["We need to talk about your burn rate.", "Default alive or default dead? Asking for the board."],
      vet: ["Those vet bills are eating your margins. Who's minding the animals?"],
      early: ["Pre-revenue is fine at this stage. Keep building.", "Construction is a phase. So is runway. Keep an eye on both."],
      flat: ["Growth is expensive. Show us the path to profitability.", "Flat is the new up, said nobody on our board."]
    }
  };

  // ---------- Staff wellbeing ----------
  // Every staff role shares one model (staff.js): work builds fatigue,
  // rest and holidays take it away; tired staff fall sick or burn out;
  // morale follows fatigue, and staff with very low morale quit. Only
  // keepers exist so far; other roles (tour guides, …) plug in here.
  var STAFF = {
    keeper: {
      // Load = Σ over the stocked exhibits a keeper looks after of
      // weight / (keepers present there); weight = base + perCheck × checks.
      exhibitWeight: { base: 0.5, perCheck: 1 / 16 },
      fatiguePerDay: 0.45, loadExponent: 1.5, // fatigue/day = fatiguePerDay × load^loadExponent
      restPerDay: 2,                           // in the staff room
      perSickAnimal: 1,                        // a logical error on their watch is stressful
      vacation: { allowance: 21, chunk: 7, autoAt: 40, notice: 3, minGap: 30, recovery: 10 },
      sick: { at: 60, per: 150, days: [2, 5], recovery: 6 },        // daily chance (fatigue − at) / per
      burnout: { at: 85, per: 50, days: 14, recovery: 5, morale: 30 },
      morale: { start: 75, base: 85, perFatigue: 0.6, drift: 0.1, trained: 10, colleagueQuit: 5,
        quitBelow: 25, quitPer: 80 },
      bonus: { salaryDays: 20, morale: 20, cooldownDays: 60 }
    },
    // Scaffold: tour guides will steer investor tours (choose the route,
    // add charm). Not hireable yet.
    guide: { scaffold: true }
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
    BUILD: BUILD, START_KNOWN: START_KNOWN, DESIGNS: DESIGNS, CUSTOM: CUSTOM,
    ROUNDS: ROUNDS, FUNDING: FUNDING, VALUATION: VALUATION, CONFIDENCE: CONFIDENCE, FOCUS: FOCUS,
    INVESTORS: INVESTORS, INVESTOR_NAMES: INVESTOR_NAMES, TOURS: TOURS, PERKS: PERKS, QUOTES: QUOTES, STAFF: STAFF,
    checkPlacement: checkPlacement
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ZooData;
  else root.ZooData = ZooData;
})(typeof window !== "undefined" ? window : this);

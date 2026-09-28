# Error Correction Zoo Tycoon — barebones plan

A Zoo Tycoon–style management game where the zoo is a quantum startup. You spend **funding** to
build **exhibits** (enclosures) in **biomes**, stock them with **animals** (quantum error-correcting
codes), and hire **zookeepers** (decoders) who keep each enclosure clean (errors corrected) and fed
(syndromes measured every round). Guests pay to see healthy, rare animals; sick animals (logical
errors) cost you money and reputation.

The name is a nod to the [Error Correction Zoo](https://errorcorrectionzoo.org).

This document scopes the **barebones v0** only. Park design, tour guides, gift shops, food stands,
and guest/investor needs are in the [roadmap](#later-roadmap-not-in-v0) at the end.

---

## 1. Core metaphor → physics mapping

Every game noun maps to a real, simulated QEC concept. The rule of thumb: **what the player sees
is physically correct, just dressed up.**

| Zoo concept | QEC meaning | How it's simulated in v0 |
|---|---|---|
| **Animal** | A stabilizer code `[[n,k,d]]` | List of stabilizer generators + logical X̄/Z̄ |
| **Biome** | The set of stabilizer checks an enclosure physically measures | A generator list; the animal is happy iff the biome's checks generate **the same stabilizer group** as the animal's code (GF(2) row-space equality) |
| **Climate** | The enclosure's noise channel | Per-qubit Pauli noise with rates (pX, pY, pZ) — depolarizing, or biased (e.g. bit-flip only) |
| **Dirt / mess** | Physical Pauli errors piling up on qubits | Pauli-frame error vector E (symplectic bits) |
| **Feeding round** | One syndrome-extraction round | syndrome = commutation of E with each stabilizer |
| **Zookeeper** | A decoder (+ the labor to run it) | Maps syndrome → correction C, applies E ← E·C |
| **Sick animal** | Logical error | Residual E commutes with all stabilizers but anticommutes with X̄ or Z̄ |
| **Animal health** | Logical fidelity over time | Rolling logical-error rate per exhibit |
| **Guest appeal** | Rarity/prestige of the code | Function of n, k, d, and "rarity" tier |
| **Funding** | Cash | Revenue from guests − salaries − upkeep − vet bills |

Why a Pauli-frame simulator and not the statevector `QEngine`: all v0 codes are stabilizer codes
under Pauli noise, so tracking the error as a Pauli operator is **exact** for this question
(did a logical error happen?) and costs a few bit operations per qubit — a statevector for a
9-qubit code × many exhibits × many ticks per second would be wasteful, and wouldn't scale to the
d=5/d=7 surface codes we'll want later. `QEngine` stays useful for an optional dev-only
cross-check (encode |0̄⟩, verify each generator has eigenvalue +1).

---

## 2. v0 content

### Animals (codes)

Five species, ordered roughly by price/prestige. All qubits indexed 0..n−1.

| Species (working name) | Code | Stabilizer generators | Logicals | Notes |
|---|---|---|---|---|
| **Repetition Tortoise** | 3-qubit bit-flip `[[3,1,1]]` (d=3 vs X only) | Z0Z1, Z1Z2 | X̄=X0X1X2, Z̄=Z0 | Starter animal. Thrives only in a bit-flip climate; any Z error makes it sick. |
| **Shor Owl** | Shor `[[9,1,3]]` | Z0Z1, Z1Z2, Z3Z4, Z4Z5, Z6Z7, Z7Z8, X0…X5, X3…X8 | X̄=Z⊗9, Z̄=X⊗9 | First "real" animal. Corrects any single-qubit error. |
| **Steane Peacock** | Steane `[[7,1,3]]` | X and Z on Hamming rows 0001111, 0110011, 1010101 | X̄=X⊗7, Z̄=Z⊗7 | Cheaper upkeep than Shor (fewer qubits), CSS, transversal Clifford (flavor text). |
| **Perfect Pangolin** | Five-qubit `[[5,1,3]]` | XZZXI and its 3 cyclic shifts | X̄=X⊗5, Z̄=Z⊗5 | Smallest code correcting any single error. Non-CSS — needs its own biome. |
| **Surface Axolotl** | Rotated surface `[[9,1,3]]` | X: {0,1,3,4},{4,5,7,8},{1,2},{6,7}; Z: {1,2,4,5},{3,4,6,7},{0,3},{5,8} (3×3 grid, row-major) | X̄=X0X3X6, Z̄=Z0Z1Z2 | Flagship. Only local weight-2/4 checks → cheap to feed; in later versions it scales to larger d. |

Each species record also carries: display emoji/glyph, qubit layout coordinates (for the
inspector drawing), purchase cost, base appeal, rarity tier, and a one-paragraph placard (the
"zoo sign") explaining the code.

### Biomes (enclosure types)

One biome per species in v0, named after the check structure, e.g. *Parity Riverbank*
(repetition), *Hamming Glade* (Steane), *Cyclic Dunes* (five-qubit), *Checkerboard Wetlands*
(surface), *Nine-Fold Forest* (Shor). Each biome has:

- a stabilizer generator list (**deliberately not always the same generating set** as the
  animal's definition — e.g. Hamming Glade may list products of the Steane generators — so the
  match check is a genuine group comparison, not an ID compare),
- a default **climate** (depolarizing at rate p, except Parity Riverbank which is bit-flip only),
- build cost, footprint on the park grid, and upkeep/day.

**Placement rule:** dropping an animal into a biome runs `sameStabilizerGroup(biome, animal)`.
Mismatch is blocked with a physics-honest explanation, e.g. *"This habitat measures X0X1, which
anticommutes with the Tortoise's Z̄ — measuring it would scramble the animal."* This check is the
seed of the later **habitat editor** (players compose their own biomes from Pauli checks).

### Zookeepers (decoders)

| Keeper | Decoder | Rounds/tick | Salary | Notes |
|---|---|---|---|---|
| **Intern** | Lookup table, weight-1 errors only (unknown syndromes → do nothing) | 1 | low | Fine for gentle climates |
| **Keeper** | Minimum-weight lookup table (enumerate errors up to weight 2, keep the lowest-weight per syndrome) | 1 | mid | The workhorse |
| **Head Keeper** | Same table as Keeper | 3 | high | Feeds more often → errors have less time to pile up |

One keeper per exhibit in v0. An exhibit with no keeper accumulates errors unchecked. Lookup
tables are built once per species at load (n ≤ 9 → ≤ 4⁹ ≈ 262k Paulis worst case; enumerating
weight ≤ 2 is ~600 entries, instant).

---

## 3. Simulation loop

Discrete ticks ("hours"; 24 ticks = 1 day). Speed controls: pause / 1× / 3× / 10×.

Per tick, for each stocked exhibit:

1. **Noise.** For each qubit, sample a Pauli from the climate (pX, pY, pZ); multiply into the
   exhibit's error frame E. The noise rate gets a small **neglect multiplier** if the exhibit has
   no keeper (keeps unkept enclosures visibly deteriorating).
2. **Feeding.** If a keeper is assigned, repeat `roundsPerTick` times: measure syndrome s(E),
   look up correction C = decoder(s), E ← E·C.
3. **Health check.** If s(E) = 0 and E ∉ stabilizer group (it anticommutes with X̄ or Z̄) →
   **logical error**: animal gets sick, vet bill charged, reputation dips, E reset to identity,
   event logged. (Checking E ∉ ⟨S⟩ via logical anticommutation is sufficient because E
   commutes with all stabilizers at that point.)
4. **Stats.** Update the exhibit's rolling logical-error rate → health bar (0–100%).

Syndrome measurement is **perfect** in v0 (no measurement errors). Faulty measurements and
repeated rounds are the first thing on the roadmap — they're what make surface codes shine.

Per day:

- **Revenue** = Σ over exhibits `appeal × health × visitorFactor`, where
  `visitorFactor` grows slowly with park reputation.
- **Expenses** = Σ keeper salaries + biome upkeep.
- **Reputation** drifts up with average health, drops on each logical error.

## 4. Economy & win/lose (starting numbers, to be tuned)

- Start: **$50,000 "pre-seed"**, empty 12×8 park grid, reputation 50.
- Enclosure: $5k–$20k by biome; animal: $3k (Tortoise) → $25k (Axolotl); keeper salary
  $100–$600/day; vet bill $1–3k per logical error.
- **Lose**: cash < 0 for 7 consecutive days → "ran out of runway".
- **Win (v0 goal)**: reach $250k cash and reputation ≥ 80 → "Series A closed". Show days taken as
  a score.
- A monthly **investor update** toast summarizes revenue, burn rate, runway, and your sickest
  exhibit — the first hook for the later investor-guest mechanics.

## 5. UI layout (single page)

```
┌────────────────────────────────────────────────────────────────────┐
│ 💰 $52,340   📅 Day 12   ⭐ Rep 61   👥 140/day   ⏸ ▶ ▶▶ ▶▶▶        │  top bar
├──────────────┬─────────────────────────────────┬───────────────────┤
│ BUILD        │                                 │ EXHIBIT INSPECTOR │
│  Biomes …    │         park grid (12×8)        │  code lattice     │
│ ANIMALS      │    enclosures as tiles with     │  (qubits + checks,│
│  Species …   │    species glyph + health ring  │   errors in red,  │
│ STAFF        │                                 │   syndrome lights)│
│  Keepers …   │                                 │  health, keeper,  │
│              │                                 │  placard, log     │
├──────────────┴─────────────────────────────────┴───────────────────┤
│ event ticker: "Day 11 — Steane Peacock (Glade #2) caught a logical │
│ Z̄! Vet bill −$1,500"                                               │
└────────────────────────────────────────────────────────────────────┘
```

- **Park grid**: CSS grid of tiles. Click a biome in the palette, click a free spot to build.
  Select an exhibit → buy/place animal, hire/assign keeper.
- **Inspector**: SVG drawing of the code's qubit layout. The player gets the **"god view"**
  (actual errors shown as red/blue/purple qubits for X/Z/Y) *and* the keeper's view (lit
  syndrome checks) side by side, so you can watch the decoder guess — and occasionally guess
  wrong. This is the main teaching surface.
- Visual language and light/dark theme tokens match `magic-square/index.html`.

## 6. Code structure

Follows the repo convention: plain HTML/JS, no build step, open `index.html` in a browser.

```
quantum-games/
  engine.js                 (existing statevector engine — untouched)
  stabilizer.js             NEW shared module, reusable by future QEC games
  tests/
    stabilizer.test.js      NEW — `node quantum-games/tests/stabilizer.test.js`
  qec-zoo-tycoon/
    PLAN.md                 this file
    README.md               written when v0 ships
    index.html              the game (UI + game state + species/biome/keeper data)
```

### `stabilizer.js` (exposes `window.Stabilizer`; also `module.exports` for Node tests)

- **Pauli representation**: `{ x, z }` bitmasks (two 32-bit ints; enough for n ≤ 32, which covers
  surface codes up to d=5). Multiply = XOR; commute test = parity of `popcount(a.x & b.z ^ a.z & b.x)`.
  Parse/print from strings like `"XZZXI"`. Phases ignored (irrelevant for error tracking).
- **`makeCode({ name, n, stabilizers, logicalX, logicalZ })`**, with `validateCode` checking: all
  generators commute, generators independent (GF(2) rank = count), k = n − rank, logicals commute
  with every stabilizer, X̄ᵢ/Z̄ᵢ anticommute pairwise, and logicals are not in the stabilizer group.
- **`syndrome(code, E)`** → bit array.
- **`sameStabilizerGroup(genA, genB)`** → GF(2) row-reduce both and compare row spaces.
- **`isLogicalError(code, E)`** (assumes zero syndrome).
- **`buildLookupDecoder(code, maxWeight)`** → `Map<syndromeKey, Pauli>` keeping the minimum-weight
  correction per syndrome.
- **`sampleNoise(n, { pX, pY, pZ }, rng)`** with an injectable seeded RNG, so tests and replays are
  deterministic.

### Tests (Node, no dependencies — `assert` only)

- Every v0 code passes `validateCode` and has the stated k.
- Each d=3 code's lookup decoder corrects **every** weight-1 Pauli (3n cases) with no logical error.
- The Repetition code corrects every single X, and every single Z *is* a logical error.
- `sameStabilizerGroup` accepts each biome for its species and rejects every other pairing.
- Monte Carlo sanity: at small p, logical error rate per round scales ~p² for d=3 codes (loose bound).

## 7. Build milestones

1. **M0 — Physics core.** `stabilizer.js` + tests passing. All five species + biomes defined and
   validated.
2. **M1 — Single-exhibit sandbox.** One enclosure with the inspector: pick a species, climate
   slider, keeper toggle, play/pause. Watch errors land and get corrected. (Already a fun toy on
   its own and the place to tune the visuals.)
3. **M2 — The park.** Grid, build/buy/hire flow, tick loop over all exhibits, cash/reputation,
   event ticker, placement validation messages.
4. **M3 — Game loop.** Revenue/expenses, investor updates, win/lose, balance pass, save/load to
   `localStorage`, README with rules + "under the hood", link from `quantum-games/README.md`.

## Later roadmap (not in v0)

From the original brief:

- **Park design & management** — paths, guest flow, placement adjacency bonuses.
- **Tour guides** — boost appeal by "explaining" placards; tie to the Zoo's code relations.
- **Gift shops / food stands** — secondary revenue, guest satisfaction.
- **Guests with needs** — funding agencies (want prestige/novelty: high d, exotic codes),
  investors (want revenue growth, low burn), academics (want rare species), press.

Physics-driven extensions that fit the metaphor:

- **Faulty feeding**: measurement errors + repeated syndrome rounds; keepers that decode in
  spacetime.
- **Bigger habitats**: surface codes d=5/7 with union-find / matching keepers; keeper skill =
  decoder quality; expensive "ML decoder" specialists.
- **Habitat editor**: compose your own biome from Pauli checks; discover which animals can live
  there (group matching generalized to subgroup / gauge codes).
- **Climates**: biased noise (XZZX / tailored codes thrive), erasure climates (neutral atoms!),
  leakage "escape attempts".
- **Breeding = concatenation**, **transport between exhibits = teleportation / lattice surgery**,
  **research lab** that unlocks species by tech tree (qLDPC, color codes, bosonic codes, GKP…).

## Open questions (defaults assumed for v0)

- **Real-time vs. turn-based?** Default: real-time ticks with pause/speed, Zoo Tycoon–style.
- **How much physics on screen?** Default: god view + syndrome view in the inspector; park view
  stays cute (glyphs + health rings).
- **Species names/art**: emoji glyphs in v0, custom SVG critters later.

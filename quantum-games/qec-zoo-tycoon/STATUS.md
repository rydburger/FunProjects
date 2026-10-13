# Zoo Tycoon — status & handoff

Last updated: 2026-10-13. Written so a new session can resume without the original chat.
Companion docs: [`PLAN.md`](PLAN.md) (design + roadmap, including the **v1 plan**) and
[`README.md`](README.md) (player-facing rules and how it works).

## Where things stand

**v0 is complete (M0–M3). v1 is under way: M4 (factual placards) and M5 (engine) are done.**
The v1 design was agreed with the owner on 2026-10-13; read PLAN.md § "v1 plan" before continuing.

- **PR history:**
  - [#2](https://github.com/rydburger/FunProjects/pull/2) merged the plan.
  - [#3](https://github.com/rydburger/FunProjects/pull/3) merged M0–M3.
  - [#4](https://github.com/rydburger/FunProjects/pull/4) added CLAUDE.md and this file.
  - M4 + M5 are on branch `claude/epic-ride-l7e51i`.
- **Tests:** 68 in `tests/stabilizer.test.js`, 16 in `tests/detectors.test.js` and 43 in
  `tests/zoo-tycoon.test.js`, all passing.
- **Browser checks:** placards verified in headless Chromium in light and dark themes and at
  390px width, with no console errors.

| Milestone | Delivered |
|---|---|
| M0 physics core | `../stabilizer.js`, `zoo-data.js`, `tests/stabilizer.test.js` |
| M1 sandbox | `sandbox.html`: one exhibit, step through noise → syndrome → correction |
| M2 park | `index.html` + `park.js` + `exhibit-sim.js` + `exhibit-view.js` + `zoo.css` |
| M3 game loop | win/lose, monthly investor dialog, localStorage autosave, balance pass, README |
| M4 placards | `placard.js`; structured, factual placards in `zoo-data.js` with computed parameters |
| M5 engine | code analysis in `../stabilizer.js`; `../detectors.js` (option A, option B scaffold); `tests/detectors.test.js` |

**Important:** the game itself still runs the v0 simulation (`exhibit-sim.js`, perfect
measurements, three keeper tiers). `detectors.js` is tested but not wired in yet; that is M6.

## Architecture in one breath

`stabilizer.js` has no game knowledge. It provides:
- Paulis as `{n, x, z}` bitmasks (n ≤ 32, qubit q is bit q, phases dropped).
- `makeCode`/`validateCode`, `syndrome` (an integer bitmask over the generators), `isLogicalError`
  and `logicalAction`.
- `sameStabilizerGroup` (GF(2) row spaces) and `buildLookupDecoder(code, maxWeight)` (minimum
  weight, found by enumerating errors in order of weight).
- `seededRng` and `sampleNoise`.
- Code analysis from a bare list of checks: `analyzeChecks` (commuting? rank, redundant checks,
  k, CSS, computed logicals, distance), `findLogicals` (symplectic Gram–Schmidt), `isCSS`,
  `codeDistance` (exhaustive by weight, with a work budget), plus `rotatedSurface(d)` and
  `repetition(n)`.

`detectors.js` (shared, game-agnostic) adds repeated noisy measurement:
- `createMemory` / `measureRound`: the true error E, a software Pauli frame, and detectors
  (outcome XOR previous outcome). Noise models: `phenomenological(rates, q)`; `circuitLevel` is a
  scaffold that throws "not implemented".
- `phenoDEM`: the detector error model over a window of rounds.
- Decoders with `push(round)` / `flush(round)` / `reset()`: `lookupDecoder` (single-shot, raw
  syndromes) and `matchingDecoder` (sliding window; exact matching by DP over subsets of lit
  detectors, greedy past `maxDefects`; needs every fault to light ≤ 2 detectors, so surface,
  repetition and Shor yes, Steane and five-qubit no).
- `runMemory`: a full memory experiment ending in a perfect round.
- Measured behaviour (tests pin it): matching fixes every single fault (d = 3, windows 1–4) and
  every pair of X/measurement faults (d = 5, window 5). With p = 0.5% and q = 2% on d = 3, matching
  fails about 6× less often than lookup. d = 5 beats d = 3 at p = 1%, q = 0.5%, and loses at
  p = 12%, q = 6% (threshold behaviour).

The game files build on it:
- `zoo-data.js` holds the data: `SPECIES` (5 codes plus layout and placard), `BIOMES` (check
  lists as *different generating sets* of each group, plus climate), `KEEPERS`, `ECONOMY`, and
  `checkPlacement` (returns a physics-worded reason on mismatch).
- `exhibit-sim.js` runs one exhibit. `advancePhase` steps noise → measure → correct and returns
  an event; `runTick` runs a whole tick.
- `park.js` runs the whole zoo: `createPark`, `build`/`buyAnimal`/`setKeeper`/`demolish`,
  `tick` (which returns events: `sick`, `day`, `debt`, `investor`, `won`, `lost`), and
  `save`/`load`.
- Everything above is DOM-free and loads in Node.
- `exhibit-view.js` does the SVG drawing, and the two HTML pages are UI only.

## Key design decisions (and why)

- **Pauli frame, not statevector.** It's exact for "did a logical error happen?" under Pauli
  noise on stabilizer codes, and cheap. `engine.js`'s `QEngine` isn't used here.
- **Habitat = stabilizer group.** An animal lives only where the checks generate its exact group.
  Placement compares GF(2) row spaces, and a mismatch message names a foreign check and the
  logical it clashes with, or the check that's missing.
- **The vet.** After every round, if the best keeper (weight-2 table) couldn't decode what's left
  without a logical flip, the animal is sick: vet bill, −30 health, error frame reset. A leftover
  that is itself a stabilizer is cleared as harmless.
- **Rounds split the noise.** A keeper with R rounds per tick sees p/R per round. Otherwise extra
  rounds are useless with perfect measurements. This is what makes the Head Keeper meaningful.
- **Syndrome measurement is perfect in the game (v0 sim).** `detectors.js` has noisy measurement;
  wiring it into the game is M6.

## Current numbers (zoo-data.js)

- **Start:** $50k and reputation 50.
- **Goal:** $250k with reputation ≥ 80 at the end of a day.
- **Lose:** 7 consecutive days in debt.
- **Time:** 24 ticks per day; 1× speed = 2 ticks per second.
- **Climate:** 2% per qubit per tick everywhere (depolarizing; bit flips only at the Riverbank).
- **Keepers:**

  | Keeper | Salary | Lookup table | Rounds per tick |
  |---|---|---|---|
  | Intern | $100/day | weight 1 | 1 |
  | Keeper | $220/day | weight 2 | 1 |
  | Head Keeper | $400/day | weight 2 | 3 |

- **Vet:** $2k and −1.5 reputation per logical error.
- **Reputation:** drifts 15% per day toward average animal health.
- **Revenue:** 0.8 visitors per appeal point per day × health × (0.5 + reputation/100), at $12 a
  ticket.
- **Balance result** (seeded bots, pinned by tests): keepers matched to the animal (Intern for
  the Pangolin and Tortoise, Keeper otherwise) wins around day 65. Keepers everywhere takes
  about 85 days, Head Keepers everywhere about 118, and no keepers goes bankrupt within about
  10 days.
- **Emergent physics:** the five-qubit code is perfect, so Intern = Keeper for it. The Steane
  code gains little from the weight-2 table. Shor and surface roughly halve their sick days
  with a Keeper.

## Known quirks / small open items

- The game ends at midnight, so the top bar reads "Day N+1" while the dialog says it ended on
  day N.
- $50k can't afford the Wetlands + Axolotl + keeper at the start. This is intentional (you
  earn your way to the flagship) but worth revisiting.
- The Steane Peacock's X/Z check pairs sit close together in the drawing (readable, but busy).
- The Pangolin uses 🦔 because there is no pangolin emoji.
- Revenue/appeal ROI is similar across species (~33-day payback). Could differentiate further.

## Next steps

Follow the v1 milestones in PLAN.md:
1. **M6: keepers and the lab.** Wire `Detectors` into `exhibit-sim.js` (each exhibit is a memory;
   the vet judges E·frame). Replace the three keeper tiers with a named roster that learns
   (algorithm + speed + window; backlog, not random mistakes). Add a space-time lookup decoder
   for small non-matchable codes (Steane, five-qubit). Lab dials with research timers. Rebalance
   with the seeded bots in `tests/zoo-tycoon.test.js`.
2. **M7: freeform habitat builder** with discovery, blueprint book, k animals per enclosure.
3. **M8: circuit-level noise** (option B).

Still open from v0: guests with needs (funding agencies, investors, academics, press), park design
(paths, guest flow, tour guides, shops), climates (biased noise, erasure, leakage).

## Starter prompt for a new session

> Continue work on Error Correction Zoo Tycoon in `quantum-games/qec-zoo-tycoon/`. Read
> `STATUS.md` first (then `PLAN.md` only if needed). Next task: <describe>.

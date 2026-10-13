# Zoo Tycoon — status & handoff

Last updated: 2026-10-13 (M7). Written so a new session can resume without the original chat.
Companion docs: [`PLAN.md`](PLAN.md) (design + roadmap, including the **v1 plan**) and
[`README.md`](README.md) (player-facing rules and how it works).

## Where things stand

**v0 is complete (M0–M3). v1 is under way: M4 (placards), M5 (engine), M6 (learning keepers
and the lab) and M7 (the habitat workshop and discovery) are done.**
The v1 design was agreed with the owner on 2026-10-13; read PLAN.md § "v1 plan" before continuing.

- **PR history:**
  - [#2](https://github.com/rydburger/FunProjects/pull/2) merged the plan.
  - [#3](https://github.com/rydburger/FunProjects/pull/3) merged M0–M3.
  - [#4](https://github.com/rydburger/FunProjects/pull/4) added CLAUDE.md and this file.
  - [#5](https://github.com/rydburger/FunProjects/pull/5) merged M4 + M5.
  - [#6](https://github.com/rydburger/FunProjects/pull/6) merged M6.
  - M7 is on branch `claude/epic-ride-l7e51i` (restarted from `main` after #6).
- **Tests:** 72 in `tests/stabilizer.test.js`, 23 in `tests/detectors.test.js` and 72 in
  `tests/zoo-tycoon.test.js`, all passing.
- **Browser checks:** park (workshop, discovery, field guide, two-animal exhibit, staff, lab) and
  sandbox verified in headless Chromium in light and dark themes and at 390px width, with no
  console errors.

| Milestone | Delivered |
|---|---|
| M0 physics core | `../stabilizer.js`, `zoo-data.js`, `tests/stabilizer.test.js` |
| M1 sandbox | `sandbox.html`: one exhibit, step through noise → syndrome → correction |
| M2 park | `index.html` + `park.js` + `exhibit-sim.js` + `exhibit-view.js` + `zoo.css` |
| M3 game loop | win/lose, monthly investor dialog, localStorage autosave, balance pass, README |
| M4 placards | `placard.js`; structured, factual placards in `zoo-data.js` with computed parameters |
| M5 engine | code analysis in `../stabilizer.js`; `../detectors.js` (option A, option B scaffold); `tests/detectors.test.js` |
| M6 keepers + lab | `exhibit-sim.js` on `Detectors`; staff roster, training and the lab in `park.js`; `KEEPER_LEVELS`, `TRAINING`, `LAB`, `RESEARCH` in `zoo-data.js`; UI panels; rebalanced |
| M7 workshop | `habitat.js` (designs, analysis, identification), `workshop.js` (editor); discovery, blueprint book, uncatalogued species in `park.js`; k animals in `exhibit-sim.js`; Iceberg Penguins and Giant Axolotl; field guide |

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
- Noise can vary per qubit (`rates` array) and per check (`q` array); `setModel` swaps it.
- Decoders with `push(round)` / `flush(round)` / `reset()`: `lookupDecoder` (single-shot, raw
  syndromes), `matchingDecoder` (sliding window; exact matching by DP over subsets of lit
  detectors, greedy past `maxDefects`; needs every fault to light ≤ 2 detectors), and
  `spacetimeLookupDecoder` (table of the likeliest ≤ 3-fault explanation of each window
  pattern; for small codes). `spacetimeDecoder` picks matching only for CSS + matchable checks
  (surface, repetition, Shor) and the table otherwise (Steane, five-qubit: splitting Y into X
  and Z parts is wrong for non-CSS codes, and matching the five-qubit code that way did worse
  than a single-shot lookup).
- `runMemory`: a full memory experiment ending in a perfect round.
- Measured behaviour (tests pin it): matching fixes every single fault (d = 3, windows 1–4) and
  every pair of X/measurement faults (d = 5, window 5). With p = 0.5% and q = 2% on d = 3, matching
  fails about 6× less often than lookup. d = 5 beats d = 3 at p = 1%, q = 0.5%, and loses at
  p = 12%, q = 6% (threshold behaviour).

The game files build on it:
- `zoo-data.js` holds the data: `SPECIES` (7 codes plus layout and placard), `BIOMES` (check
  lists as *different generating sets* of each group, plus a noise channel), `KEEPER_LEVELS`,
  `TRAINING`, `KEEPER_SPEED`, `LAB`, `RESEARCH`, `BUILD` (workshop prices), `START_KNOWN`,
  `DESIGNS` (reference designs of every species), `CUSTOM` (appeal/price of uncatalogued
  species), `ECONOMY`, and `checkPlacement`.
- `habitat.js` handles workshop designs (`{ qubits: [[x, y]], checks: [{ at, wires: [[q, P]] }] }`,
  wire order kept for M8): `analyze` (problems, notes, k, d, price, footprint), `identify` /
  `equivalence` (backtracking search for a qubit relabelling plus per-qubit Pauli permutation that
  maps each built generator into the species' group; candidates come from the species' low-weight
  group elements), `designFor(speciesId)`, `malformed`.
- `exhibit-sim.js` runs one exhibit on a `Detectors` memory (a catalogue enclosure measures the
  species' own generators; a designed one measures the player's checks, redundant ones included).
  An exhibit holds k animals (`healths`; `health` is their mean); each logical qubit the vet
  finds flipped is one sick animal. `noiseModel` turns lab values into per-qubit/per-check rates; `effectiveLevel`
  is the best decoder the keeper can run in real time; `advancePhase` steps noise → measure →
  correct; `snapshot`/`restore` for saves.
- `park.js` runs the whole zoo: building (catalogue habitats need their species known;
  `studyDesign` / `buildDesign` for designs), the book (`park.book`: known species, designs,
  uncatalogued species), animals, staff (`hireKeeper`, `assignKeeper`,
  `fireKeeper`, `canTrain`/`trainKeeper`), the lab (`canResearch`/`startResearch`), `tick`
  (events: `sick`, `day`, `debt`, `investor`, `won`, `lost`, `trained`, `research`), and
  `save`/`load` (version 3; version 2 saves are migrated with the five original species known; v1
  saves are rejected).
- Everything above is DOM-free and loads in Node.
- `exhibit-view.js` does the SVG drawing (species layouts, or a design's own positions),
  `workshop.js` is the editor, and the two HTML pages are UI only.

## Key design decisions (and why)

- **Pauli frame, not statevector.** It's exact for "did a logical error happen?" under Pauli
  noise on stabilizer codes, and cheap. `engine.js`'s `QEngine` isn't used here.
- **Habitat = stabilizer group.** An animal lives only where the checks generate its exact group.
  Placement compares GF(2) row spaces, and a mismatch message names a foreign check and the
  logical it clashes with, or the check that's missing.
- **The vet.** When the keeper commits a round, the vet takes the true error *at that round*
  times the Pauli frame and asks whether a perfect-information weight-2 table could still
  decode it. If not: vet bill, −30 health, the animal is re-prepared. Judging the committed
  round (not "now") keeps space-time keepers from being blamed for errors they haven't had the
  chance to see yet. A leftover stabilizer is folded into the frame.
- **Speed, not backlog.** In a pure memory a slow decoder only delays corrections (Pauli frames
  commute), so letting backlog cause logical errors would be wrong physics. Instead a keeper who
  can't keep up uses the best decoder they can run in real time.
- **Training is on the job.** An earlier version sent keepers away; the unattended exhibits made
  every course a net loss for the bots.
- **Without a keeper nobody measures,** so there are no measurement errors either.
- **Workshop in a dialog, not on the park grid.** An 11×11 editor works on a phone; the built
  habitat takes half a tile per qubit (data or ancilla), as square as possible. For the
  catalogue codes this reproduces the catalogue footprints.
- **Discovery gates the catalogue.** Only the Tortoise is known at first (`START_KNOWN`); building
  a working design of a species unlocks its catalogue habitat. The field guide shows each
  undiscovered species' placard summary as a hint.
- **Same species = same code up to relabelling** (qubit permutation and per-qubit X/Y/Z
  permutations, i.e. local Cliffords). Identical under depolarizing noise; strictly more general
  than "same [[n,k,d]]". A miss (search budget) only means "not in the field guide".
- **Anticommuting checks block building.** The plan's fair-coin simulation is deferred to
  subsystem codes, where measuring anticommuting checks is the point.
- **Which animal is which** for k > 1 follows the computed logical basis (`findLogicals`); the
  count of sick animals per event depends on that basis choice.

## Current numbers (zoo-data.js)

- **Start:** $50k and reputation 50. **Goal:** $250k with reputation ≥ 80 at the end of a day.
  **Lose:** 7 consecutive days in debt. **Time:** 24 ticks per day; 1× speed = 2 ticks per second.
- **Lab** (per level 0 → 3): coherence 0.8% → 0.55% → 0.35% → 0.2% per qubit per hour; gates
  0.08% → 0.06% → 0.04% → 0.02% per CNOT; readout 1% → 0.7% → 0.45% → 0.25%; cycle 1 → 2 → 3
  rounds/hour. Research costs $5k/2 days, $12k/4 days, $25k/6 days for levels 1/2/3. Channels:
  depolarizing, except bit flips only at the Riverbank.
- **Keepers:** salaries $120 / $150 / $190 / $240 per day for levels 1–4. Training to level
  2/3/4 needs 150/500/1200 rounds of experience and costs $1k/1 day, $2.5k/2 days, $5k/3 days.
  Speed = 4 + xp/300 work per hour, capped at 12. Work per round: 1, 1.5, then 2 and 3 × max(1,
  checks/8) for the space-time levels (the Giant Axolotl's 24 checks: 6 and 9).
- **Workshop:** $1,000 per qubit + $100 per wire; upkeep $5 per qubit + $1 per wire a day; half a
  tile per qubit. Reference designs cost $5.4k (Tortoise), $19.4k (Owl, Axolotl), $15.4k
  (Peacock), $10.6k (Pangolin), $6.8k (Penguins), $57k (Giant Axolotl). Uncatalogued species:
  appeal 25/60/120/160/210 for d = 1…5 (+40 per step after), price 100 × appeal per animal.
- **New species:** Iceberg Penguins $4k per animal (2 per habitat), appeal 50 each; Giant Axolotl
  $45k, appeal 320. Iceberg Floe $5k, Grand Marsh $40k (5×5).
- **Vet:** $2.5k and −1.5 reputation per logical error. **Reputation** drifts 15% per day toward
  average animal health. **Revenue:** 0.8 visitors per appeal point per day × health ×
  (0.5 + reputation/100), at $12 a ticket.
- **Sick days per 30 days at starting hardware** (unlimited speed; approximate): trainee →
  head keeper: Owl ~8 → ~3.5, Peacock ~8 → ~2, Pangolin ~6 → ~1.5, Axolotl ~8 → ~5, Tortoise
  ~1.5 → ~0. No keeper: ~20 for the d = 3 codes. Giant Axolotl: ~25 (trainee), ~4 (senior), ~1
  (head keeper) against the Axolotl's ~8 / ~5 / ~5: d = 5 wins only with space-time decoding (a
  test pins this). Penguins: ~35 at any level (d = 2 can't correct).
- **Balance result** (seeded bots that keep variety, at most 3 of a species, and discover each
  species by building its reference design first; pinned by tests): training keepers where
  animals keep getting sick plus funding the lab closes the Series A around day 90; never investing takes ~170–240 days or goes bankrupt; no keepers goes bankrupt
  within ~25 days. One seed of three goes bankrupt on day ~31 whatever the strategy: the bot
  buys the $45k Axolotl first and an early run of vet bills sinks it.

## Known quirks / small open items

- The game ends at midnight, so the top bar reads "Day N+1" while the dialog says it ended on
  day N.
- $50k can't afford the Wetlands + Axolotl + keeper at the start. This is intentional (you
  earn your way to the flagship) but worth revisiting.
- The Steane Peacock's X/Z check pairs sit close together in the drawing (readable, but busy).
- The Pangolin uses 🦔 because there is no pangolin emoji.
- **Tortoise spam.** A bot allowed unlimited copies fills the park with ~20 Tortoises: cheap,
  rarely sick, quick payback. The balance bots cap each species at 3. Worth a real mechanic
  (e.g. visitors get bored of duplicates) once playtesting confirms it.
- Level 2 (weight-2 lookup) barely beats level 1 with noisy readout: trusting outcomes harder
  doesn't help. The real jump is to space-time decoding at level 3.
- The Axolotl gains least from space-time keepers at d = 3 in the phenomenological model.
- Levels 5–6 of the ladder (correlated matching, maximum likelihood) aren't implemented.
- **Iceberg Penguins lose money** (d = 2: ~35 vet bills a month). Honest, and the workshop says
  "the keeper has to guess", but a postselection mechanic (detected = shrug, not sick) would make
  detection codes worth keeping.
- The Giant Axolotl needs a keeper with speed ≥ 6 (senior) or 9 (head) at 1 round/hour, and a
  faster cycle makes it harder: real-time decoding of big codes is the bottleneck, as on
  hardware.
- The sandbox shows catalogue species only; it can't load a player's design yet.
- Uncatalogued species can be renamed in the field guide; their glyphs cycle through a fixed list.

## Next steps

Follow the v1 milestones in PLAN.md:
1. **Playtest M6 + M7** and adjust numbers (all in `zoo-data.js`; rerun the balance tests).
2. **M8: circuit-level noise** (option B). Designs already record wire (CNOT) order.
3. Keeper levels 5–6 (correlated matching, maximum likelihood).
4. Subsystem codes (Bacon–Shor): anticommuting checks measured on purpose; postselection for
   detection codes; more discoverable species (color codes, [[8,3,2]], [[15,1,3]]).

Still open from v0: guests with needs (funding agencies, investors, academics, press), park design
(paths, guest flow, tour guides, shops), climates (biased noise, erasure, leakage).

## Starter prompt for a new session

> Continue work on Error Correction Zoo Tycoon in `quantum-games/qec-zoo-tycoon/`. Read
> `STATUS.md` first (then `PLAN.md` only if needed). Next task: <describe>.

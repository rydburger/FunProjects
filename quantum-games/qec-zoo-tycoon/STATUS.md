# Zoo Tycoon — status & handoff

Last updated: 2026-11-07 (handoff refresh after the third playtest update, PR #10). Written so a new session can resume without the original chat.
Companion docs: [`PLAN.md`](PLAN.md) (design + roadmap, including the **v1 plan**) and
[`README.md`](README.md) (player-facing rules and how it works).

## Where things stand

**v0 is complete (M0–M3). v1 is under way: M4 (placards), M5 (engine), M6 (learning keepers
and the lab) and M7 (the habitat workshop and discovery) are done. Since then the owner has
playtested three times, and each round is merged: the "funding update" (AMO-scale economy,
rounds to a $20B IPO, investors, staff wellbeing), the second update (shaped plots, NISQ lab,
a real funding ladder) and the third (2% CNOTs, a tycoon-style desktop layout). Everything is
on `main`; there is no work in flight.** The next milestone is M8 (circuit-level noise); see
"Next steps". The v1 design was agreed with the owner on 2026-10-13; read PLAN.md § "v1 plan"
before starting a milestone.

The owner plays the published artifact (see "Publishing the artifact" below) and the local
copy, and reports back in playtest rounds; each round so far became one PR.

- **PR history:**
  - [#2](https://github.com/rydburger/FunProjects/pull/2) merged the plan.
  - [#3](https://github.com/rydburger/FunProjects/pull/3) merged M0–M3.
  - [#4](https://github.com/rydburger/FunProjects/pull/4) added CLAUDE.md and this file.
  - [#5](https://github.com/rydburger/FunProjects/pull/5) merged M4 + M5.
  - [#6](https://github.com/rydburger/FunProjects/pull/6) merged M6.
  - [#7](https://github.com/rydburger/FunProjects/pull/7) merged M7.
  - [#8](https://github.com/rydburger/FunProjects/pull/8) merged the funding update.
  - [#9](https://github.com/rydburger/FunProjects/pull/9) merged the second playtest update.
  - [#10](https://github.com/rydburger/FunProjects/pull/10) merged the third playtest update.
  - Sessions develop on branch `claude/gifted-darwin-pd1muz`, restarted from `main` after
    each merge (see CLAUDE.md § Git workflow).
- **Tests:** 72 in `tests/stabilizer.test.js`, 23 in `tests/detectors.test.js` and 92 in
  `tests/zoo-tycoon.test.js`, all passing (the zoo suite takes a few minutes: its bots play up
  to ten game years at NISQ-grade error rates).
- **Browser checks (third update):** the desktop layout at 1440×860 and 1280×720 (no page
  scroll, every rail tab, foldable inspector sections), the stacked layout at 390px, light and
  dark, a two-year save at 60× speed (60 fps), no console errors.
- **Earlier browser checks:** park (construction, staffing, tours and perks, a raise and its verdict,
  demolish, blueprint delete, a two-year bot save at 60× speed: steady 60 fps) and sandbox (0.1×)
  verified in headless Chromium in light and dark themes and at 390px width, with no console errors.

### Third playtest update (2026-11-04)

The owner asked for two-qubit gates to start at 2% per CNOT, and for a desktop UI that doesn't
need scrolling to reach the exhibit info (like the original tycoon games: compact, side panels,
collapsible parts). Done:
- **Gates:** 2% → 1% → 0.5% → 0.2% → 0.05% per CNOT (the gates dial has a fourth research step).
  The CNOT charge is now physical: a failed CNOT is one of 15 two-qubit Paulis, so it hits the
  data qubit with 12/15 of the gate error and flips the ancilla's readout with 8/15
  (`CNOT_ON_DATA`, `CNOT_ON_CHECK` in `exhibit-sim.js`). At the start a surface code sees ~8%
  error per data qubit and ~7% per outcome each round: above threshold, so the Giant Axolotl is
  worse than the Axolotl and even a head keeper's Axolotl fails more often than a bare qubit
  (tests pin this). It's saturated, so a trainee's Axolotl gets sick ~3 times a day (bounded
  vet bills), not dozens. The Tortoise (two wires per qubit, bit flips only) is below its own
  threshold: a trainee about breaks even with a bare qubit, a head keeper beats it.
- **Research is cheaper and quicker** so the gates can be fixed early: $600k/14 days, $2M/30,
  $6M/60, $15M/90 (gates only).
- **Break-even readout:** the inspector shows each exhibit's logical errors per animal per day
  over its last 14 days (`rec.sickDays`, `Park.recentErrors`) against a bare qubit on the same
  hardware (`Park.bareQubitErrors` = 24 × coherence), and says whether the code is beating it,
  breaking even, or doing worse (with the likely fix).
- **Desktop layout ("app mode", ≥ 1000 × 600):** the page fills the window and doesn't scroll.
  A tab rail (Build, Investors, Staff, Lab, News; keys B I S L N; click the open tab to hide
  the panel) opens one side panel at a time; the map scales to fit the middle (container query
  units); the inspector is its own scrolling column with foldable sections (construction,
  last incident, zookeepers, buy an animal, habitat, placard), whose open state is remembered
  per viewer (`qecZooUi` in localStorage, wrapped in try/catch). Rail dots flag a raise you can
  start or a bridge offer, an idle lab with affordable research, a tired, unhappy or idle
  keeper, and unread news. Below 1000px everything stacks under the map as before, with the
  rail as a tab bar.
- The sandbox link now passes the exhibit's average per-round data and readout error (gates
  included), so the sandbox reproduces what the park simulates.
- **Bots** research the gates first and build only Tortoises until gates reach 0.5%, then
  discover new species before building more copies; they skip fully researched dials.

### Second playtest update (2026-10-26)

The owner asked for: different exhibit shapes per habitat (random for player designs, sized by
the code) so placement becomes a tiling puzzle; construction in about a month rather than a year;
research that matters (start with NISQ-grade error rates, research pushes below threshold,
without vet bills killing new players); a funding ladder that matches real ~$20B companies; and
training courses that last weeks. Done:
- **Shaped plots.** `BIOMES[].shape` (row strings → `cells`): riverbank a 4×1 strip, forest a
  diagonal band, glade a triangle, dunes a ridge, wetlands 3×3, floe 2×2, marsh a rounded 5×5.
  Workshop designs get `Habitat.shapeFor(design)`: a random connected polyomino of
  ⌈qubits/2⌉ tiles in a box ~√tiles + 1 on a side, seeded by a hash of the design JSON (so a
  blueprint always builds the same shape). Area follows the qubit count, which grows with
  distance; a pure distance rule would give a long repetition code a huge plot. `rec.cells` (after
  rotation) is what's stamped; `rec.w`/`rec.h` are the bounding box. `build(…, rot)`,
  `buildDesign(…, { rot })`, `Park.fits/biomeCells/designCells`. Saves without `cells` load as
  rectangles (save version unchanged). UI: per-tile outlines, the label on the largest inner
  rectangle (`Habitat.innerRect`), a per-tile preview, R / ⟳ to rotate, shape icons
  (`Habitat.shapeSvg`) in the build menu and workshop.
- **Construction:** workshop days = 30 × qubits/17 (7–90); catalogue 7 (riverbank) to 75 days
  (marsh). **Training:** 7 / 14 / 21 days.
- **Lab** (gates superseded by the third update): level 0 is NISQ-grade (coherence 2%/h, gates 0.28%/CNOT, readout 2.8%: ~3% data and
  ~4% outcome error per round on a surface code). With a head keeper the d = 5 Giant Axolotl is no
  better than the d = 3 Axolotl there; fully researched it's several times better (tests pin
  both). Health now relaxes toward 100 (2% of the gap + 0.1 per tick; −20 per logical error), so
  it settles at a level that tracks the error rate instead of pinning at 0, and the vet bill is
  $1.5k.
- **Bug fixed:** the Grand Marsh measured a product of two plaquettes that let one error light
  three detectors, so no keeper could run matching there and the d = 5 code never beat d = 3.
  It now measures a bent plaquette (plaquette × the boundary pair beside it) that keeps
  matching valid; a test checks every catalogue habitat supports space-time decoding.
- **Funding ladder** (PsiQuantum, Snowflake, Quantinuum; see README): A $100M (sells 20%), B
  $400M (15%), C $1.5B (12%), D $4B (10%), E $10B (8%), IPO $20B (10%). Valuation coefficients
  were cut to match (revenue multiple 12 + 18 × growth, $2M per k·d², $10M per species, $8M per
  lab level; stage premiums 1 → 6), growth is measured against at least $20k/day of revenue (no
  more "100% growth" from a standing start), and the post-close wait is 150 days.

### The funding update (2026-10-26)

The owner's playtest asked for: an easier, AMO-realistic economy ($10M seed, ~$2M per surface-code
experiment, construction timers: a year for the surface code); rounds up to an IPO at $20B with
investor praise that scales with the result; routine investor tours (scaffolded for tour guides)
with steak dinners; deleting blueprints; a working demolish button (a `var label = label(rec)`
shadowing bug); keepers on several exhibits with diluted decoding; fatigue, holidays (21 days a
year in chunks), sickness, burnout and resignation for keepers (scaffolded for other staff); a
0.1× sandbox speed; and a performance pass. All done:
- `staff.js` (new): role-generic wellbeing. `investors.js` (new): valuation, roadmap, tour
  impressions, round tiers and quotes as pure functions over `Park.metrics`.
- `park.js`: construction (`rec.building`, `buildUntil`; designs discover their species when they
  open), many-to-many keepers (`rec.keeperIds`, `keeper.exhibitIds`, `staffing()` splits each
  keeper's speed by exhibit weight), tours, raises (`startRaise` → roadshow → `round` event:
  closed / bridge / pass), the growing lot (`setLot`), `deleteDesign`, `forgetSpecies`, daily
  `history` for metrics, save version 4 (older saves are rejected with a clear message).
- `exhibit-sim.js`: `attendance` — a keeper below the cheapest decoder's cost attends only that
  fraction of rounds (deterministic credit); unattended rounds aren't measured or corrected.
- `detectors.js`: per-model memo (`mem.memo`: model key, matchability) and per-decoder graph
  handles, so matching no longer rebuilds a long JSON key every round.
- UI: valuation and next-round KPIs, an investors panel (roadmap, valuation breakdown, raise,
  bridge offers, round history), a tour banner with perks, round/IPO dialogs, construction tiles,
  a multi-keeper inspector, a staff panel with fatigue/morale, holiday, bonus and two-click
  let-go, blueprint delete, speeds up to 60× (a year in ~73 s), cached tile DOM, incremental news,
  throttled saves.
- The sandbox narrates corrections as Pauli frame updates.

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
  finds flipped is one sick animal. `noiseModel` turns lab values into per-qubit/per-check rates
  (each wire charges 12/15 of the CNOT error to its data qubit and 8/15 to its check); `effectiveLevel`
  is the best decoder the keeper can run in real time; `advancePhase` steps noise → measure →
  correct; `snapshot`/`restore` for saves.
- `park.js` runs the whole zoo: the lot (grows with each round), building with construction
  times (catalogue habitats need their species known; `studyDesign` / `buildDesign` for designs),
  the book (`park.book`: known species, designs, uncatalogued species; `deleteDesign`,
  `forgetSpecies`), animals, staff (`hireKeeper`, `assignKeeper`/`unassignKeeper` (many-to-many),
  `fireKeeper`, `canTrain`/`trainKeeper`, `sendOnVacation`, `giveBonus`, `staffing`), the lab
  (`canResearch`/`startResearch`), investors (`metrics`, `valuation`, `startRaise`,
  `acceptOffer`/`declineOffer`, `buyPerk`), `tick` (events: `sick`, `built`, `discovered`, `day`,
  `month`, `debt`, `lost`, `trained`, `research`, `staff`, `tour-start`, `tour`, `milestone`,
  `round`), `recentErrors`/`bareQubitErrors` (the inspector's break-even line), and
  `save`/`load` (version 4; older saves are rejected; records are saved field by field, so a
  new per-exhibit field such as `sickDays` needs no version bump if the UI tolerates its absence).
- `staff.js` is the wellbeing model for any staff role; `investors.js` judges the zoo.
- Everything above is DOM-free and loads in Node.
- `exhibit-view.js` does the SVG drawing (species layouts, or a design's own positions),
  `workshop.js` is the editor, and the two HTML pages are UI only.
- `index.html` layout: `#rail` (tab buttons with `data-tab`) + `#drawer` (one `.panel.tab` per
  tab; `setTab`/`toggleTab`, dots in `updateBadges`) + `.park-wrap` (tour banner, `.park-box`
  holding `#park`, ticker) + `.inspector-col`. App mode is a CSS media query (≥ 1000 × 600);
  below it the same DOM stacks. Inspector sections come from `section(key, title, open, more)`
  (a `<details>`); `ui.tab` and `ui.sections` persist under `qecZooUi`, the save under
  `qecZooSave`, the theme under `qecZooTheme`. The render/update split matters for speed:
  `render*` rebuild DOM (on events), `update*` only patch text (every frame).

## Key design decisions (and why)

- **Pauli frame, not statevector.** It's exact for "did a logical error happen?" under Pauli
  noise on stabilizer codes, and cheap. `engine.js`'s `QEngine` isn't used here.
- **Habitat = stabilizer group.** An animal lives only where the checks generate its exact group.
  Placement compares GF(2) row spaces, and a mismatch message names a foreign check and the
  logical it clashes with, or the check that's missing.
- **The vet.** When the keeper commits a round, the vet takes the true error *at that round*
  times the Pauli frame and asks whether a perfect-information weight-2 table could still
  decode it. If not: vet bill, −20 health, the animal is re-prepared. Judging the committed
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

- **Start:** a $10M seed round at $40M (founders keep 75%), reputation 50, investor confidence 50,
  a 12×8 lot. **Goal:** the IPO ($20B). **Lose:** 7 consecutive days in debt. **Time:** 24 ticks
  per day; 1× speed = 2 ticks per second; speeds 1/5/20/60×.
- **Rounds:** A $100M (sells 20%), B $400M (15%), C $1.5B (12%), D $4B (10%), E $10B (8%), IPO
  $20B (10%), stage premiums ×1, 1.2, 1.6, 2.2, 3.5, 6. Roadshow 21 days (tours every 3); after a
  close, 150 days before the next raise; bridge at 60–100% of target (sells 6%); pass → 45-day
  cooldown. Lots 12×8 → 14×10 → 16×12 → 18×13 → 20×14 → 22×15.
- **Valuation:** (revenue/yr × (12 + 18 × growth) + $2M × Σ k·d²·health + $10M × species + $8M
  × lab levels) × 2^((confidence − 50)/30) × premium × (1 − 0.35 × share of milestones missed).
  Growth is the 30-day revenue change against max(last month, $20k/day), capped at ±100%.
- **Confidence:** tours move it by 0.2 × (impression − 50); +2 per discovery, +3 per milestone,
  −3 per resignation, −2 per day in debt, ±4 a month with revenue growth, +5/−5 on a close/pass;
  1% a day back toward 50. Impression = weighted mean of health, error rate, morale, roadmap,
  growth and wow (the fund's focus ×3), −25 per logical error on the route, + perk (6/10/15 for
  $15k/$45k/$140k).
- **Prices:** catalogue habitats $300k (riverbank, 7 days, 4 tiles) to $3.2M (marsh, 75 days, 21
  tiles); animals $100k (tortoise) to $1.5M (giant); workshop $60k/qubit + $5k/wire, 30 ×
  qubits/17 days (7–90), ⌈qubits/2⌉ tiles. Upkeep ~$800–8,000/day. Vet bill $1.5k. Tickets $20,
  2 visitors per appeal point.
- **Health:** −20 per logical error; each tick +2% of the gap to 100, +0.1. Settles near 97 at
  0.2 logical errors a day, 80 at 0.6, 55 at 1.2.
- **Staff:** salaries $450/$550/$700/$850 a day; training needs 500/2000/5000 rounds and costs
  $20k/7 days, $50k/14 days, $100k/21 days (they keep working); speed 4 + xp/1000 (max 12). Load weight 0.5 +
  checks/16. Fatigue 0.45 × load^1.5 a day (+1 per logical error on their watch), −2 a day
  resting, −10 a day on holiday. Holiday 21 days a year, booked a week at a time 3 days ahead
  once fatigue ≥ 40 (30 days apart). Sick past fatigue 60, burnout past 85 (14 days, −30 morale);
  morale drifts to 85 − 0.6 × fatigue; quits possible below 25. Bonus = 20 days' salary, +20
  morale, every 60 days at most.
- **Lab:** research $600k/14 days, $2M/30 days, $6M/60 days, $15M/90 days (level 4, gates
  only). Per level: coherence 2% → 1.2% → 0.6% → 0.25% per qubit per hour; gates 2% → 1% → 0.5%
  → 0.2% → 0.05% per CNOT (×12/15 on each wired data qubit, ×8/15 on each check outcome);
  readout 2.8% → 1.6% → 0.8% → 0.4%; cycle 1 → 2 → 3 rounds/hour. Logical errors per animal per
  day at level 0 (trainee / head keeper): Tortoise ~0.5 / ~0.3 (a bare qubit: 0.48), d = 3
  surface-type codes ~3.3 / ~2, Giant Axolotl ~6 / ~3.
- **Balance result (2026-11-04, third update):** with 2% gates the test bot fixes the gates
  first (two steps, ~44 days) on Tortoise tickets, closes the Series A around day 83, then B–D
  every ~170 days (the post-close wait), and lists in 2.6–7.8 years in 5 of 6 seeds (946, 1371,
  1638, 2768, 2835 days; the sixth stalls at Series E). The Series E ($10B) is the slow step.
- **Earlier balance result (2026-10-26, second update):** the test bot raises the Series A around day 55,
  then B–D every ~170 days (the post-close wait), and lists in 2.5–3.2 years in 4 of 6 seeds
  (one more after ~9 years; one stalls short of $20B at Series E). No keepers → bankrupt in
  ~4 months; no training/research/care → bankrupt in year 2.
- **Species** (price per animal, appeal; catalogue habitat cost, build days, tiles, upkeep/day):
  Tortoise $100k, 40 (riverbank $300k, 7 d, 4, $800; bit flips only); Shor Owl $450k, 110
  (forest $1.1M, 25 d, 7, $2.8k); Steane Peacock $500k, 130 (glade $880k, 21 d, 6, $2.2k);
  Perfect Pangolin $550k, 150 (dunes $620k, 14 d, 6, $1.5k); Surface Axolotl $800k, 180
  (wetlands $1.15M, 28 d, 9, $2.8k); Iceberg Penguins $240k for the pair, 50 each (floe $400k,
  10 d, 4, $1k); Giant Axolotl $1.5M, 320 (marsh $3.2M, 75 d, 21, $8k). Uncatalogued species:
  appeal 25/60/120/160/210 for d = 1…5 (+40 per step after), $4k per appeal point per animal.
- **Keeper work per round:** 1 (trainee), 1.5 (keeper), then 2 and 3 × max(1, checks/8) for the
  space-time levels (the Giant Axolotl's 24 checks: 6 and 9). Speed 4 + xp/1000, max 12.
- **Logical errors per animal per day** (catalogue habitats, 1 round/hour unless noted, three
  seeds × 60 days; no keeper / trainee / head keeper; measured 2026-11-07):

  | Lab | Bare qubit | Tortoise | Pangolin | Peacock | Owl | Axolotl | Penguins | Giant |
  |---|---|---|---|---|---|---|---|---|
  | Start | 0.48 | 0.88/0.51/0.31 | 3.5/3.3/1.9 | 4.4/4.1/2.6 | 3.6/3.1/2.2 | 3.7/3.3/2.1 | 2.8/2.8/2.2 | 6.6/6.6/3.4 |
  | Gates 0.5% | 0.48 | 0.63/0.22/0.10 | 1.6/1.0/0.44 | 2.0/1.3/0.71 | 1.8/1.2/0.71 | 1.9/1.3/0.71 | 1.5/1.5/1.3 | 3.3/3.2/0.84 |
  | All level 2 | 0.14 | 0.27/0.056/0.028 | 0.98/0.36/0.16 | 1.2/0.48/0.19 | 1.1/0.38/0.21 | 1.0/0.49/0.27 | 0.81/0.80/0.75 | 1.9/1.5/0.12 |
  | Full (cycle 3) | 0.06 | 0.094/0.017/0 | 0.31/0.033/0.011 | 0.43/0.050/0 | 0.32/0.044/0.006 | 0.32/0.033/0.006 | 0.26/0.25/0.25 | 0.66/0.24/0 |

  So the d = 3 codes only beat a bare qubit (break-even) near full research, while the Giant
  Axolotl with a head keeper gets there at level 2; the Penguins (d = 2) never do. The
  loop that produced it is the `sickIn` helper in `tests/zoo-tycoon.test.js`, run per species with
`ExhibitSim.labValues(levels)` and keeper levels 0, 1 and 4.
- Channels: depolarizing, except bit flips only at the Riverbank.

## Known quirks / small open items

- The game ends at midnight, so the top bar reads "Day N+1" while the dialog says it ended on
  day N.
- **Early rounds come on the clock.** A strong player's valuation clears Series A–D targets
  before the 150-day post-close wait ends, so those rounds close as soon as investors allow; the
  wait, not the valuation, paces the early game for good play. Weaker play is valuation-gated.
- **The NISQ start is a trap for fast expansion:** before the gates are researched, a surface
  code is above threshold (sick a few times a day, health near zero, ~$4.5k a day in vet bills
  per animal), so a zoo that stocks surface codes before funding the lab bleeds money. The
  inspector says so. A bot that stocked everything at once went bankrupt in 2–6 months while
  this was tuned. Watch it in playtests.
- The break-even comparison uses the idle error only; a bare qubit that also had to be read out
  or gated would do worse.
- **Late game cash piles up** (billions after Series C). Lot space, construction time, staff and
  error rates are the constraints then. More late sinks (guides, shops, bigger lab tiers) would help.
- **d = 2 codes are money pits** (many animals, constantly sick). Honest; postselection would fix it.
- Tour routes are picked by appeal; tour guides (scaffolded in `STAFF.guide`, `tour.guide`,
  `chooseRoute`) should choose them.
- The Steane Peacock's X/Z check pairs sit close together in the drawing (readable, but busy).
- The Pangolin uses 🦔 because there is no pangolin emoji.
- **Tortoise spam.** A bot allowed unlimited copies fills the park with ~20 Tortoises: cheap,
  rarely sick, quick payback. The balance bots cap each species at 3. Worth a real mechanic
  (e.g. visitors get bored of duplicates) once playtesting confirms it.
- Level 2 (weight-2 lookup) barely beats level 1 with noisy readout: trusting outcomes harder
  doesn't help. The real jump is to space-time decoding at level 3.
- The Axolotl gains least from space-time keepers at d = 3 in the phenomenological model.
- Levels 5–6 of the ladder (correlated matching, maximum likelihood) aren't implemented.
- **Iceberg Penguins lose money** (d = 2: ~2–3 logical errors per animal per day at the start,
  still ~0.25 fully researched, about four times a bare qubit). Honest, and the workshop says
  "the keeper has to guess", but a postselection mechanic (detected = shrug, not sick) would make
  detection codes worth keeping.
- The Giant Axolotl needs a keeper with speed ≥ 6 (senior) or 9 (head) at 1 round/hour, and a
  faster cycle makes it harder: real-time decoding of big codes is the bottleneck, as on
  hardware.
- The sandbox shows catalogue species only; it can't load a player's design yet.
- Uncatalogued species can be renamed in the field guide; their glyphs cycle through a fixed list.

## Next steps

1. **Playtest the third update** and tune (all numbers in `zoo-data.js`; rerun the balance
   tests). Things to watch: whether the 2% start feels punishing (new players stocking surface
   codes early), whether d = 3 codes reaching break-even only near full research feels right,
   the slow Series E step, and the desktop layout on the owner's screen.
2. **M8: circuit-level noise** (option B in PLAN.md). Designs already record wire (CNOT) order;
   `Detectors.circuitLevel` is a scaffold that throws. This would replace the 12/15 and 8/15
   CNOT charge with real propagation (hook errors, CNOT order).
3. Keeper levels 5–6 (correlated matching, maximum likelihood).
4. Subsystem codes (Bacon–Shor): anticommuting checks measured on purpose; postselection for
   detection codes; more discoverable species (color codes, [[8,3,2]], [[15,1,3]]).

Also: a mechanic against Tortoise spam (visitors bored of duplicates), late-game cash sinks,
tour guides (route choice, charm; the scaffolding is in place), other staff roles on the shared
wellbeing model, holiday requests the player approves, the sandbox loading a player's design.
Still open from v0: other guests (funding agencies, academics, press), park design (paths, guest
flow, shops), climates (biased noise, erasure, leakage).

## Publishing the artifact

The owner plays a private claude.ai artifact: https://claude.ai/artifact/DaU4N8SCKGYhUaEXEY5oF6
(version 4 is the third update). To update it after a change:

```
node quantum-games/qec-zoo-tycoon/bundle-artifact.js <scratch-dir>
```

then publish `<scratch-dir>/zoo-tycoon.html` to that URL with `sandbox.html` as a supporting
file (`files: { "sandbox.html": "<scratch-dir>/sandbox.html" }`). A session that didn't publish
it must read the artifact first. Each artifact keeps its own autosave, separate from the local
copy's.

## Starter prompt for a new session

> Continue work on Error Correction Zoo Tycoon in `quantum-games/qec-zoo-tycoon/`. Read
> `STATUS.md` first (then `PLAN.md` only if needed). Next task: <describe>.

Checklist that has worked for each playtest round: restart the branch from `main`; make the
change with tests; run the three test files (the zoo suite takes a few minutes); for tuning,
run the balance bot on six seeds; drive the page in Playwright (light, dark, 390px, and a
desktop size for app mode); update README, STATUS and CLAUDE.md; commit, push, open the PR;
rebuild and republish the artifact.

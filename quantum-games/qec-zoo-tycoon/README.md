# Error Correction Zoo Tycoon

Open `index.html` in any browser. There's nothing to build or install, but keep this folder next
to [`../stabilizer.js`](../stabilizer.js) and [`../detectors.js`](../detectors.js), which the game loads.

A Zoo Tycoon–style management game where the zoo is a quantum startup. The animals are
quantum error-correcting codes, the habitats are the stabilizer checks an enclosure measures,
and the zookeepers are decoders. You start with a $10M seed round. Keep your logical qubits
alive, keep your keepers from burning out, keep investors impressed, and raise round after round
(Series A at $100M, up to an IPO at $20B, a ladder modelled on real deep-tech companies) before
the money runs out.

## How to play

1. **Build an enclosure.** Pick a habitat from the palette and click the park to place it. Every
   plot has a **shape** (the riverbank is a long strip, the glade a triangle, the marsh a
   rounded square; your own designs get a random shape sized by their qubit count). Turn it with
   <kbd>R</kbd> or the Rotate button, and fit shapes together like an inventory puzzle: only
   the tiles themselves have to be free. At first you only know how to keep the Repetition
   Tortoise. Prices are at AMO-lab scale (a tortoise is about $400k all in, a d = 3 surface code
   about $2M), and **construction takes time**: a week for the riverbank, about a month for a
   new surface code. You pay up front; upkeep starts when it opens.
2. **Buy an animal.** Click the enclosure. An animal can only live in a habitat that measures
   exactly its stabilizer group. Every other species is listed with the physics reason it
   can't move in. A code with k logical qubits holds k animals, each with its own health.
3. **Discover species in the habitat workshop** (see below). A habitat you design discovers its
   species when it opens (if the code works), and unlocks its catalogue habitat.
4. **Hire keepers.** Without one, nobody measures the checks, errors pile up, and an unkept
   code does *worse* than a bare qubit. Keepers are hired as trainees and learn; one keeper can
   look after several exhibits, and several keepers can share one (see below).
5. **Fund the lab.** The starting hardware is NISQ-grade: close to threshold, so a bigger code
   is no better than a smaller one and animals get sick about once a day. Research lowers the
   error rates for every enclosure at once and pushes the hardware below threshold, where every
   step in distance pays.
6. **Watch the books.** Healthy, rare animals draw visitors. Each logical error costs a vet bill
   and some reputation. Salaries and upkeep are paid continuously.
7. **Raise money.** Investors tour the zoo; when their valuation beats the next round's target,
   start a roadshow (see below).

- **Win:** list on the stock market: the **IPO** at a **$20B** valuation. You can keep playing
  afterwards.
- **Lose:** end **7 days in a row** in debt: "ran out of runway".
- Every 30 days a **monthly report** in the news summarises revenue, costs, vet bills and runway,
  with a line from the board.
- The game **autosaves** in your browser every few seconds and when you leave. **New game**
  starts over. Saves from before the funding update can't be loaded.
- Keys: <kbd>space</kbd> pause/resume, <kbd>1</kbd>–<kbd>4</kbd> speed (up to about a year a
  minute), <kbd>R</kbd> rotate the plot you're placing, <kbd>Esc</kbd> cancel building / close
  the inspector.

### Investors, rounds and the IPO

| Round | Target valuation | Sells | Roadmap (examples) |
|---|---|---|---|
| Seed | $40M (done) | 25% for $10M | |
| Series A | $100M | 20% | 2 species, 3 animals on show, a d = 3 code, $10k/day tickets |
| Series B | $400M | 15% | 4 species, 7 animals, 2 lab upgrades |
| Series C | $1.5B | 12% | 5 species, 12 animals, a d = 5 code, a head keeper |
| Series D | $4B | 10% | 7 species, 18 animals, 6 lab upgrades |
| Series E | $10B | 8% | 26 animals, < 0.02 logical errors per animal per day, morale 60+ |
| IPO | $20B | 10% | 34 animals, 9 species, 10 lab upgrades |

The ladder follows real companies that reached about $20B: PsiQuantum raised a ~$14M Series A
at ~$40M (2016), $450M at $3.2B (2021) and $1B at $7B (2025); Snowflake went from a $5M Series A
through $263M at ~$1.5B and $479M at $12.4B to its 2020 IPO; Quantinuum raised $600M at $10B
(2025). Typical rounds sell 20–25% early and 8–10% late.

- **The valuation** is (ticket sales × a multiple that grows with revenue growth + animals × d² ×
  health + species + lab upgrades) × hype × a stage premium × a roadmap factor. Hype doubles every
  30 points of **investor confidence** above 50. Missing roadmap milestones costs up to 35%. The
  investors panel shows each part.
- **Raising** starts a 21-day roadshow; investors tour every 3 days, and at the end they name their
  price. At or above the target the round closes: cash in, part of the company sold, and a
  **bigger lot**. Investors then want to see the money at work for 180 days. At 60–100% of the
  target they offer a **bridge** (a little cash, no new letter); below that they pass, and you
  can try again in 45 days. The better the round, the more effusive the quotes.
- **Tours.** Every few weeks an investor walks past up to three exhibits (the biggest draws).
  Each fund cares most about one thing: healthy animals, low logical error rates, a happy team,
  the roadmap, growth, or big codes and rare species. A logical error on the route while they
  watch costs a lot. You can take them out (steak, omakase, a ski weekend) for a better impression.
  Tour guides will choose the route in a later version.

### Staff: load, holidays, burnout

A keeper's time is split between the stocked exhibits they look after, in proportion to each
one's weight (0.5 + checks/16: a tortoise 0.6, a d = 3 surface code 1, the d = 5 one 2), shared
with any other keeper there. Spread a keeper thin and each exhibit gets less decoding: first they
fall back to cheaper decoders, then they only get to some of the rounds, and unattended rounds
let errors pile up. Two keepers on one exhibit pool their time.

The same load tires them: fatigue grows as load^1.5 a day (a logical error on their watch adds
to it), and rest in the staff room or on holiday takes it away. Everyone has 21 days of holiday a
year; tired keepers book a week three days ahead (cover their exhibits!), or you can send them
off now. Tired keepers fall sick, very tired ones burn out for two weeks, and keepers whose
morale sinks quit, which hurts everyone's morale and investor confidence. A bonus (20 days'
salary) lifts morale.

The **exhibit sandbox** (`sandbox.html`, linked from every enclosure) follows one animal round by
round: noise lands, the checks are measured (some outcomes misread), the keeper corrects. You can
change the noise, the misread rate and the keeper's level while it runs.

## The animals

| Species | Code | Habitat | Notes |
|---|---|---|---|
| 🐢 Repetition Tortoise | 3-qubit bit-flip `[[3,1,1]]` | Parity Riverbank | Cheap starter. Survives bit flips; any phase flip is fatal, so it lives in a bit-flip-only climate. |
| 🦉 Shor Owl | Shor `[[9,1,3]]` | Nine-Fold Forest | The first quantum code. Degenerate: many different errors have the same effect. |
| 🦚 Steane Peacock | Steane `[[7,1,3]]` | Hamming Glade | Two Hamming codes, one for X and one for Z. |
| 🦔 Perfect Pangolin | Five-qubit `[[5,1,3]]` | Cyclic Dunes | A *perfect* code: every syndrome points to exactly one single-qubit error. |
| 🦎 Surface Axolotl | Rotated surface code, d=3 | Checkerboard Wetlands | The flagship. Local checks on a grid. |
| 🐧 Iceberg Penguins | `[[4,2,2]]` | Iceberg Floe | Two animals per habitat. Distance 2: every single error is noticed, none can be corrected, so they get sick a lot. |
| 🐉 Giant Axolotl | Rotated surface code, d=5 | Grand Marsh | Beats the Axolotl below threshold, but only with a space-time keeper fast enough for 24 checks. |

Only the Tortoise is known when you start. The **field guide** lists the others with a hint (the
first line of each placard).

### The habitat workshop

Place data qubits and check ancillas on an 11×11 grid. A new check is wired to the data qubits
around it; select a check and tap data qubits to add or remove wires, or set its Pauli on each
qubit letter by letter (so checks can mix X, Y and Z). The readout updates as you go: do the
checks commute, how many are independent, how many animals fit (k), the distance d, CSS or not,
the price and the plot (its tile count and shape). It also names the species, if it's one the zoo knows about.

- **Identification** is up to relabelling: your qubits can be numbered any way, and a qubit's
  checks may swap X, Y and Z consistently (a local Clifford). Such codes behave identically
  under depolarizing noise. Shor's code with X and Z swapped is still the Shor Owl.
- **A code nobody has catalogued** becomes a new species you name, with a placard computed from
  its checks. Its appeal grows with distance.
- **Every design you build goes into your blueprint book** (it appears in the build menu) and
  can be built again without the workshop.
- **What a habitat costs:** $60,000 per qubit (data or ancilla) plus $5,000 per wire, with upkeep
  of $150 per qubit and $10 per wire a day. Two qubits take a tile of park, in a random connected
  shape about √tiles + 1 on a side; the shape is seeded by the design, so a blueprint always
  builds the same shape. Construction takes 30 × qubits / 17 days, between 7 and 90: a month
  for the 17-qubit surface code.
- **Blueprints can be deleted** from the build menu (×). One still in use leaves the menu now and
  the book once its last enclosure is gone. A species you discovered can be dropped from the
  field guide once nothing in the zoo holds it.
- **What can't be built:** checks that anticommute (measuring one would scramble the other), a
  check with no wires, or checks that leave no room for an animal (k = 0). Redundant checks
  are allowed (a second opinion against misreads), and so are poor codes: at d = 1 the animal
  gets sick about as often as a bare qubit.

### Keepers are decoders, and they learn

Every keeper is hired as a trainee. Each round they decode earns experience, which makes them
faster; with enough experience they can take a training course (a fee and one, two or three
weeks of study while they keep working) to learn the next decoder.

| Level | Title | Decoder | Salary |
|---|---|---|---|
| 1 | Trainee | Single-shot lookup of single-qubit errors; trusts every outcome | $450/day |
| 2 | Keeper | Single-shot minimum-weight lookup (up to weight 2) | $550/day |
| 3 | Senior keeper | Space-time decoding over 2 rounds | $700/day |
| 4 | Head keeper | Space-time decoding over 3 rounds | $850/day |

Measurements are noisy: a check outcome can be misread. A single-shot keeper takes a misread
at face value and "fixes" a qubit that was fine (and has to fix it back next round). A
space-time keeper compares rounds: a check that flips and flips back was a misread, while a
real error leaves its checks flipped. Space-time keepers use minimum-weight matching where the
code allows it (Shor, surface) and a space-time lookup table otherwise (Steane, five-qubit).

**Speed.** Decoding takes work every round, and more for space-time decoders on codes with more
than 8 checks. A keeper who can't keep up with their best decoder at an exhibit's measurement cycle
uses the best one they can run in real time; the inspector says so. (In a pure memory a slow
decoder would only delay corrections, which is harmless; what real hardware can't afford is
falling behind, so slow keepers fall back to faster decoders.)

### The lab

One research project at a time: $1.5M for 30 days, $4M for 60 days, then $10M for 90 days.
The starting hardware is about 3% error per data qubit and 4% per check outcome every round on
a surface code; fully researched, about ten times less.

| Dial | What it does |
|---|---|
| Coherence | Less idle error on every data qubit |
| Two-qubit gates | Cleaner CNOTs. Each round, every data qubit pays once per check it's wired to, and each check's outcome pays once per qubit it touches |
| Readout | Fewer misread outcomes |
| Syndrome cycle | More rounds per hour: less idle error per round, but every round brings its own gate and readout errors, and keepers have more rounds to decode |

Seeded bot players pin the incentives (see the balance tests): a zoo that builds steadily, staffs
bigger codes with two keepers, trains them, funds the lab and discovers new codes raises its
Series A in its second month and lists in about 2.5–4 years; a zoo with no keepers goes bankrupt in
its first year; one that never trains, researches or looks after its staff doesn't list.

## Under the hood

Everything the player sees is physically correct:

- **Noise** is an independent Pauli channel on every qubit, tracked as a Pauli frame (the error
  operator E as symplectic bitmasks), not as a state vector. For stabilizer codes under Pauli
  noise that is exact for the question the game asks: did a logical error happen?
- **Measurements** follow the detector paradigm. The first round sets the reference; a
  *detector* is a check's outcome compared with the previous round's. Each outcome can be
  misread (phenomenological noise: the measurement circuit itself isn't simulated yet).
  **Corrections** go into a software Pauli frame, as on real hardware: nothing is applied to the
  qubits, and later outcomes (and the final readout) are reinterpreted through the frame. A
  detector firing is not a logical error; the vet below decides that.
- **Identifying a built code** searches for a qubit relabelling and per-qubit Pauli swaps that map
  every built check into the species' stabilizer group (the groups have the same size, so that
  makes them equal). The tests check it on scrambled copies of every species and that equal
  [[n,k,d]] isn't enough (Shor's code and the d = 3 surface code differ).
- **Habitat matching** compares GF(2) row spaces. Each habitat lists a *different* generating set
  than its animal's textbook definition, so placement is a real stabilizer-group comparison, not
  a name lookup.
- **The vet** decides whether an animal is sick. When the keeper commits a round's
  corrections, the vet takes the true error at that round times the frame and asks whether a
  perfect-information minimum-weight decoder could still recover it without flipping X̄ or Z̄.
  If not, it's a logical error and the animal is re-prepared. Leftover errors that are
  themselves stabilizers act trivially on the animal and are folded into the frame.
- **Error rates** come from the lab: per round, data qubit j gets coherence/cycle +
  (checks wired to j) × gate error, and check i is misread with probability readout +
  (weight of i) × gate error. This charge for the CNOTs is an approximation.

### Files

| File | What it is |
|---|---|
| [`../stabilizer.js`](../stabilizer.js) | Shared Pauli / stabilizer-code toolkit (no game knowledge) |
| [`../detectors.js`](../detectors.js) | Repeated noisy measurement, detectors, decoders (no game knowledge) |
| `zoo-data.js` | Species, habitats, keeper levels, lab dials, workshop prices, reference designs, economy constants, placement check |
| `habitat.js` | Workshop designs: analysis, price, footprint, identifying a code up to relabelling |
| `placard.js` | Zoo placards (written facts plus parameters computed from the checks) |
| `exhibit-sim.js` | One exhibit: noise → measure → correct rounds, keeper speed, the vet, health |
| `staff.js` | Staff wellbeing for any role: fatigue, holidays, sick days, burnout, morale, resignations |
| `investors.js` | Valuation, roadmaps, tour impressions, round outcomes and quotes (pure functions) |
| `park.js` | The zoo: lot, construction, staffing, lab, money, investors, rounds, clock, save/load |
| `exhibit-view.js` | SVG drawing of an exhibit ("really there" / "keeper sees") |
| `workshop.js` | The habitat workshop editor |
| `zoo.css` | Shared theme and styles |
| `index.html` | The park UI |
| `sandbox.html` | Single-exhibit sandbox |
| [`PLAN.md`](PLAN.md) | Design plan and roadmap |

Everything except the two HTML pages, `exhibit-view.js`, `workshop.js` and `zoo.css` is DOM-free and runs in
Node:

```
node quantum-games/tests/stabilizer.test.js   # codes, analysis, decoders, group matching, p² scaling
node quantum-games/tests/detectors.test.js    # detectors, noise models, space-time decoders, threshold
node quantum-games/tests/zoo-tycoon.test.js   # exhibit sim, keepers, lab, park rules, save/load, balance bots
```

## Status

v0 (M0–M3) and v1's M4–M7 (factual placards, the detector engine, learning keepers and the lab,
the habitat workshop with discovery) are done, plus the funding update (AMO-scale economy,
construction, rounds to an IPO, investor tours, shared keepers and staff wellbeing); see
[`STATUS.md`](STATUS.md). Next: circuit-level noise (M8).

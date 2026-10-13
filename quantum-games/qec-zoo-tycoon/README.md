# Error Correction Zoo Tycoon

Open `index.html` in any browser. There's nothing to build or install, but keep this folder next
to [`../stabilizer.js`](../stabilizer.js) and [`../detectors.js`](../detectors.js), which the game loads.

A Zoo Tycoon–style management game where the zoo is a quantum startup. The animals are
quantum error-correcting codes, the habitats are the stabilizer checks an enclosure measures,
and the zookeepers are decoders. Keep your logical qubits alive, keep the visitors coming, and
close your Series A before the money runs out.

## How to play

1. **Build an enclosure.** Pick a habitat from the palette and click the park to place it. At
   first you only know how to keep the Repetition Tortoise.
2. **Buy an animal.** Click the enclosure. An animal can only live in a habitat that measures
   exactly its stabilizer group. Every other species is listed with the physics reason it
   can't move in. A code with k logical qubits holds k animals, each with its own health.
3. **Discover species in the habitat workshop** (see below). Building a working habitat for a
   code discovers its species and unlocks its catalogue habitat.
4. **Hire a keeper.** Without one, nobody measures the checks, errors pile up, and an unkept
   code does *worse* than a bare qubit. Keepers are hired as trainees and learn (see below).
5. **Fund the lab.** Research lowers the hardware's error rates for every enclosure at once.
6. **Watch the books.** Healthy, rare animals draw visitors. Each logical error costs a vet bill
   and some reputation. Salaries and upkeep are paid continuously.

- **Win:** end a day with **$250,000** in the bank and **reputation ≥ 80**: "Series A closed". You
  can keep playing afterwards.
- **Lose:** end **7 days in a row** in debt: "ran out of runway".
- Every 30 days an **investor update** summarises the month: revenue, costs, vet bills, runway,
  and your sickest exhibit.
- The game **autosaves** in your browser at the end of every day and after every action.
  **New game** starts over.
- Keys: <kbd>space</kbd> pause/resume, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> speed,
  <kbd>Esc</kbd> cancel building / close the inspector.

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
the price and the footprint. It also names the species, if it's one the zoo knows about.

- **Identification** is up to relabelling: your qubits can be numbered any way, and a qubit's
  checks may swap X, Y and Z consistently (a local Clifford). Such codes behave identically
  under depolarizing noise. Shor's code with X and Z swapped is still the Shor Owl.
- **A code nobody has catalogued** becomes a new species you name, with a placard computed from
  its checks. Its appeal grows with distance.
- **Every design you build goes into your blueprint book** (it appears in the build menu) and
  can be built again without the workshop.
- **What a habitat costs:** $1,000 per qubit (data or ancilla) plus $100 per wire, with upkeep
  of $5 per qubit and $1 per wire a day. Two qubits take a tile of park.
- **What can't be built:** checks that anticommute (measuring one would scramble the other), a
  check with no wires, or checks that leave no room for an animal (k = 0). Redundant checks
  are allowed (a second opinion against misreads), and so are poor codes: at d = 1 the animal
  gets sick about as often as a bare qubit.

### Keepers are decoders, and they learn

Every keeper is hired as a trainee. Each round they decode earns experience, which makes them
faster; with enough experience they can take a training course (a fee and a few days of study
while they keep working) to learn the next decoder.

| Level | Title | Decoder | Salary |
|---|---|---|---|
| 1 | Trainee | Single-shot lookup of single-qubit errors; trusts every outcome | $120/day |
| 2 | Keeper | Single-shot minimum-weight lookup (up to weight 2) | $150/day |
| 3 | Senior keeper | Space-time decoding over 2 rounds | $190/day |
| 4 | Head keeper | Space-time decoding over 3 rounds | $240/day |

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

One research project at a time, each with a fee and a few days' wait:

| Dial | What it does |
|---|---|
| Coherence | Less idle error on every data qubit |
| Two-qubit gates | Cleaner CNOTs. Each round, every data qubit pays once per check it's wired to, and each check's outcome pays once per qubit it touches |
| Readout | Fewer misread outcomes |
| Syndrome cycle | More rounds per hour: less idle error per round, but every round brings its own gate and readout errors, and keepers have more rounds to decode |

Seeded bot players pin the incentives (see the balance tests): a zoo that trains its keepers
where animals keep getting sick and funds the lab closes the Series A around day 90; one that
never invests in either takes over 200 days or goes bankrupt; a zoo with no keepers goes
bankrupt within about 25 days.

## Under the hood

Everything the player sees is physically correct:

- **Noise** is an independent Pauli channel on every qubit, tracked as a Pauli frame (the error
  operator E as symplectic bitmasks), not as a state vector. For stabilizer codes under Pauli
  noise that is exact for the question the game asks: did a logical error happen?
- **Measurements** follow the detector paradigm. The first round sets the reference; a
  *detector* is a check's outcome compared with the previous round's. Each outcome can be
  misread (phenomenological noise: the measurement circuit itself isn't simulated yet).
  **Corrections** go into a software Pauli frame, as on real hardware.
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
| `park.js` | The zoo: grid, building, staff, lab, money, reputation, clock, win/lose, investor updates, save/load |
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
the habitat workshop with discovery) are done; see [`PLAN.md`](PLAN.md). Next: circuit-level
noise (M8).

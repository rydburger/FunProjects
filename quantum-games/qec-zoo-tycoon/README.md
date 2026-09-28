# Error Correction Zoo Tycoon

Open `index.html` in any browser. There's nothing to build or install, but keep this folder next
to [`../stabilizer.js`](../stabilizer.js), which the game loads.

A Zoo Tycoon–style management game where the zoo is a quantum startup. The animals are
quantum error-correcting codes, the habitats are the stabilizer checks an enclosure measures,
and the zookeepers are decoders. Keep your logical qubits alive, keep the visitors coming, and
close your Series A before the money runs out.

## How to play

1. **Build an enclosure.** Pick a habitat from the palette and click the park to place it.
2. **Buy an animal.** Click the enclosure. An animal can only live in a habitat that measures
   exactly its stabilizer group. Every other species is listed with the physics reason it
   can't move in.
3. **Hire a keeper.** Without one, nobody measures the checks, errors pile up, and an unkept
   code does *worse* than a bare qubit.
4. **Watch the books.** Healthy, rare animals draw visitors. Each logical error costs a vet bill
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
round: noise lands, the checks fire, the keeper corrects. You can change the noise and the keeper
while it runs.

## The animals

| Species | Code | Habitat | Notes |
|---|---|---|---|
| 🐢 Repetition Tortoise | 3-qubit bit-flip `[[3,1,1]]` | Parity Riverbank | Cheap starter. Survives bit flips; any phase flip is fatal, so it lives in a bit-flip-only climate. |
| 🦉 Shor Owl | Shor `[[9,1,3]]` | Nine-Fold Forest | The first quantum code. Degenerate: many different errors have the same effect. |
| 🦚 Steane Peacock | Steane `[[7,1,3]]` | Hamming Glade | Two Hamming codes, one for X and one for Z. |
| 🦔 Perfect Pangolin | Five-qubit `[[5,1,3]]` | Cyclic Dunes | A *perfect* code: every syndrome points to exactly one single-qubit error. |
| 🦎 Surface Axolotl | Rotated surface code, d=3 | Checkerboard Wetlands | The flagship. Local checks on a grid. |

### Keepers are decoders

| Keeper | Decoder | Rounds per hour | Salary |
|---|---|---|---|
| 🧑‍🎓 Intern | Lookup table for single-qubit errors only; shrugs at anything else | 1 | $100/day |
| 🧑‍🌾 Keeper | Minimum-weight lookup table up to weight 2 | 1 | $220/day |
| 🧑‍🔬 Head Keeper | Same table, but checks 3× as often | 3 | $400/day |

Which keeper pays off depends on the animal, and that comes straight out of the codes:

- The **Pangolin** is a perfect code, so the Intern's single-error table already covers every
  syndrome it can produce. A Keeper adds nothing.
- The **Owl** and **Axolotl** get many weight-2 errors a weight-2 table can still fix (an X on
  one qubit and a Z on another, say), so a Keeper roughly halves their sick days.
- A **Head Keeper** checks three times per hour, so each round sees a third of the noise. The
  logical error rate falls roughly as p²/3, which is expensive but nearly bulletproof.

Seeded bot players confirm the incentive (see the balance tests). Matching keepers to animals
closes the Series A around day 65, staffing everything with Keepers takes about 85 days, and a zoo
with no keepers goes bankrupt within about 10 days.

## Under the hood

Everything the player sees is physically correct:

- **Noise** is an independent Pauli channel on every qubit, tracked as a Pauli frame (the error
  operator E as symplectic bitmasks), not as a state vector. For stabilizer codes under Pauli
  noise that is exact for the question the game asks: did a logical error happen?
- **Syndromes** are commutation parities of E with the code's stabilizer generators.
  **Corrections** come from lookup tables built by enumerating errors in order of weight.
- **Habitat matching** compares GF(2) row spaces. Each habitat lists a *different* generating set
  than its animal's textbook definition, so placement is a real stabilizer-group comparison, not
  a name lookup.
- **The vet** decides whether an animal is sick. After every round it asks whether the best
  keeper could still decode what's left without flipping X̄ or Z̄. If not, it's a logical error
  and the animal is reset. Leftover errors that are themselves stabilizers act trivially on the
  animal and are swept away.
- Each hour's noise is split across the keeper's rounds. With perfect measurements, extra
  rounds would otherwise find nothing new.

### Files

| File | What it is |
|---|---|
| [`../stabilizer.js`](../stabilizer.js) | Shared Pauli / stabilizer-code toolkit (no game knowledge) |
| `zoo-data.js` | Species, habitats, keepers, economy constants, placement check |
| `exhibit-sim.js` | One exhibit: noise → measure → correct rounds, the vet, health |
| `park.js` | The zoo: grid, building, money, reputation, clock, win/lose, investor updates, save/load |
| `exhibit-view.js` | SVG drawing of an exhibit ("really there" / "keeper sees") |
| `zoo.css` | Shared theme and styles |
| `index.html` | The park UI |
| `sandbox.html` | Single-exhibit sandbox |
| [`PLAN.md`](PLAN.md) | Design plan and roadmap |

Everything except the two HTML pages, `exhibit-view.js` and `zoo.css` is DOM-free and runs in
Node:

```
node quantum-games/tests/stabilizer.test.js   # codes, decoders, group matching, p² scaling
node quantum-games/tests/zoo-tycoon.test.js   # exhibit sim, park rules, save/load, balance bots
```

## Status

v0 (milestones M0–M3 in [`PLAN.md`](PLAN.md)) is complete. Next on the roadmap: park design and
guest flow, tour guides, gift shops and food stands, guests with needs (funding agencies,
investors), noisy syndrome measurements, and bigger surface codes with matching decoders.

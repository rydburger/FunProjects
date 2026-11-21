# The Magic Square — Peres–Mermin pseudo-telepathy game

Open `index.html` in any browser (Chrome preferred), nothing to build or install. It loads the
shared [`../engine.js`](../engine.js) module for its quantum circuit machinery — keep both files
together.

## What it is

A playable version of the **Peres–Mermin magic square**, the classic quantum "pseudo-telepathy"
thought experiment: two players, Alice and Bob, fill in a row and a column of a 3×3 grid under
fixed parity rules and win only if they agree on the value of the cell where their row and column
cross — with no communication allowed.

- **Classical mode**: play it straight, picking +1/−1 by hand. No strategy can beat 8/9 (≈88.9%)
  in the long run — the magic square has no fully consistent classical filling.
- **Quantum mode**: step through all three roles —
  - **Charlie** (the referee) builds the entangling circuit that prepares two Bell pairs, then
    routes the four physical qubits to Alice and Bob (a subtle constraint applies: each entangled
    pair must land in the *same* wire slot for both players, not just be split between them).
  - **Alice** and **Bob** each drag-and-drop gates onto their own two qubits to build the specific
    circuit their assigned row/column needs, validated against the canonical circuit — either
    gate-for-gate, or by simulated output-state fidelity for any equivalent circuit that isn't a
    literal copy — before they're allowed to run it. Hint and Skip are available at every step.
  - Every gate runs on a real statevector simulation (complex amplitudes, unitary matrices,
    Born-rule measurement). With **Perfect qubits**, once the circuits are right the win is
    guaranteed, not scripted.
  - **Noisy chip** applies the paper's Willow error rates to every gate as placed: 0.05% per
    single-qubit gate and 0.3% per two-qubit gate, as random Pauli errors on the live state. Each
    readout may also be misreported (0.7%). Correct circuits then win ≈ 97.7%; Google's chip
    measured 98.30%. The results screen lists any error that struck and whether it flipped the
    shared cell. The in-game noise (`NonLocal.Noise.applyQEngineGate` / `measureQEngine`) is
    tested against the exact model `NonLocal.Magic.gameWinProb` by playing full rounds on
    `engine.js`'s own statevector.

## The paper chapters (arXiv:2512.02284)

Chapters 2–5 implement every task in Kumar et al., *Quantum–classical separation in
bounded-resource tasks arising from measurement contextuality* (Google Quantum AI,
[arXiv:2512.02284](https://arxiv.org/abs/2512.02284)). A chapter bar at the top of every page links
them together.

| Page | Paper | What you do |
|---|---|---|
| `index.html` | Fig. 1A–C | The original game (classical and build-the-circuit quantum modes). |
| `lab.html` | Fig. 1D, S2, S3 | All nine games on a simulated noisy chip. Plan I (measure two, infer one) or Plan II (two ancillas plus the third Pauli folded onto one data qubit, three readouts per player as in Fig. S2). Shots, noise sliders, the paper's per-game points, and an error budget next to the paper's Fig. S3B. |
| `ksb.html` | Fig. 2, S4, S5 | Kochen–Specker–Bell inequality χ ≤ 4: hidden-variable tables (max 4) vs. context-dependent ones (6), and measuring contexts one at a time. The 180-context × 1000-run protocol (random order within each context) plotted as 6⟨R⟩, −6⟨C⟩ against Fig. 2B, with per-Pauli agreement for consecutive-compatible and incompatible repeats (Fig. S4). The ancilla compensation-phase calibration: sweep a virtual Z against a hidden phase (Fig. S5C). |
| `ghz.html` | Fig. 3, S6 | N-player GHZ parity game: classical (best ½ + 2^−⌈N/2⌉) or quantum (X/Y/Z per bit) strategies for 3–8 players, GHZ growth on a 72-qubit lattice, and a sweep of N = 2…71 against the measured Fig. 3B curve (σ = SD over patterns / √patterns). GHZ fidelity Fˣ, Fᶻ and F against the ½ genuine-entanglement line (Fig. S6). |
| `hlf.html` | Fig. 4, S7, S8 | 2D hidden linear function as a puzzle (or one shot of the 4-layer circuit). Effective depth for n = 9…105 against the measured Fig. 4B curve, the paper's stepped classical bound ⌈log₂(edges + nodes)⌉, and optionally the Bravyi c·log₂(n)/16 extrapolations and the 7/8 line (Fig. S8). P = 0.25 / 0.5 / 0.75 (Fig. S7). |

Shared files: `paper.css` (tokens and components), `paper-ui.js` (chapter nav, theme toggle, SVG
charts with hover and data tables, circuit drawer, noise sliders, time-sliced job runner). All game
logic lives in DOM-free [`../nonlocal.js`](../nonlocal.js), tested by `tests/nonlocal.test.js`.

### The paper's data (`NonLocal.PAPER`)

The measured points are taken from the PDF itself. Most figures are vector graphics, so their
values come straight from the marker paths, measured against the axis tick marks: Fig. 1D rows 2–3,
S3A, 2B and 4B, plus the classical steps of Fig. 4B. Two panels are raster images, digitized at
600 dpi (±0.002): Fig. 3B and Fig. 1D row 1. The tests check each set against the numbers the paper
prints: averages 0.9830 / 0.9773 / 0.9355 for the magic square, and χ = 5.618 for KSB. They also
check that the Fig. 4B steps equal ⌈log₂(edges + nodes)⌉ on square grids.

### Model vs. paper

| | our model | paper |
|---|---|---|
| Magic square, Plan I / II | 97.5% / 91.7% | 98.30% (Fig. 1D), 97.73% / 93.55% (Fig. S3) |
| Plan II loss budget: 1q / CZ / readout | 0.79 / 1.83 / 4.12% | 0.54 / 1.75 / 3.90% |
| KSB χ; P_agree compatible / incompatible | 5.52; 96.5% / 50.0% | 5.618; 96.36% / 50.0% |
| GHZ win rate at N = 10 / 30 / 50 / 71 | 0.91 / 0.76 / 0.66 / 0.60 | 0.909 / 0.782 / 0.674 / 0.607 |
| GHZ fidelity below ½ at | N ≈ 43 | N = 45 |
| GHZ Fˣ / Fᶻ / F at N = 70 | 0.22 / 0.41 / 0.32 | ≈ 0.21 / 0.44 / 0.32 |
| HLF effective depth at n = 50 / 105 | 4.6 / 5.4 | 4.8 / 6.5 |

Known differences:
- **Compilation.** Our circuits keep every single-qubit gate as its own layer; the paper merges
  them. This costs us some extra idling, most visibly in Plan II.
- **HLF at large n.** Our model is too optimistic there: it lacks whatever extra errors the
  105-qubit device has.
- **Readout.** Readout is symmetric at 0.7%, as in the paper's own GHZ analysis (Eq. S41). Fig. S1
  shows e₀ ≈ 0.3% and e₁ ≈ 1%.

**The classical GHZ bound** is ½ + 2^−⌈N/2⌉. The main text prints ⌊N/2⌋, but its own Fig. 3B
classical line (0.75, 0.625, 0.5625, …) uses the ceiling. So does a brute-force check over every
strategy in our tests: with a floor, 3 classical players would win 100% instead of 75%.

**Noise model.** These rates come from the paper's Fig. S6 caption:
- 1q Pauli error 0.05%, CZ 0.3%, symmetric readout 0.7%.
- Idling follows the paper's T1-with-dynamical-decoupling model (Eqs. S19–S22), which is exactly a
  Pauli channel with X and Y errors only. Its rate is (1 − e^(−t/T1))/2 per moment, with T1 = 73 µs
  and an assumed 40 ns moment.

KSB adds a few device terms:
- ancilla reset errors (0.2%),
- the same X/Y errors on the data qubits during each readout (0.2%),
- the coherent ancilla phase of Sec. 4B (calibrated away, except in 3.4).

**Performance.** The pages stay smooth at paper scale because nothing big is ever a statevector.
Every circuit is Clifford, all noise is Pauli, and every score is a parity of final measurements.
So `Clifford.faultTable` back-propagates the scoring parities once through the circuit, which gives
each fault's flip pattern. Independent faults then combine exactly, by XOR-convolution or the
closed form ½(1 + ∏(1 − 2q)). That costs O(circuit size): a 71-qubit GHZ game or stabilizer takes
well under a millisecond. HLF samples shots from the same fault table with geometric skipping.
Statevectors are used only where they are tiny:
- KSB: 3 qubits, which is where the non-Clifford compensation phase lives.
- The 3–8-player GHZ table.
- The 9- and 16-node HLF puzzles.

Sweeps run in ~12 ms slices (`PaperUI.job`). The paper-scale runs finish in under 3 s in headless
Chromium, with no main-thread task over 50 ms:
- GHZ: 70 sizes × 50 patterns × 20 games, plus fidelity.
- HLF: 11 sizes × 1000 puzzles × 100 shots.
- KSB: 1000 × 180 contexts, plus a 41-point calibration sweep.

## Under the hood

The quantum machinery is written as three standalone, reusable JS namespaces (exposed on
`window`) with no knowledge of "Alice," "Bob," or magic squares — meant to be reused directly by
future games and algorithms (QFT, Grover's, Shor's, VQE, Bell test, GHZ, PBR, ...) in this repo:

- **`QEngine`** — an n-qubit noiseless statevector simulator (Float64Array-based, Quirk-style
  amplitude-pair gate application rather than dense matrices). A single generalized
  `applyControlledGate` takes *any number* of controls acting on *any* single-qubit gate, so
  CNOT, CZ, CP(θ), Toffoli, and arbitrary multi-controlled gates all reduce to one code path.
  Adjoint (†) is computed on the fly as the conjugate transpose — no hardcoded inverse matrices.
  Also includes `applySwap`/`applyControlledSwap` (SWAP/Fredkin) and Bloch-rotation gates
  `rx`/`ry`/`rz`/`phase` for the parameterized R(θ) and CP(θ) tiles.
- **`CircuitCanvas`** — pixel-positioned circuit diagram rendering (explicit pixel math, not CSS
  Grid — avoids a cross-browser bug where connector lines misaligned).
- **`CircuitEditor`** — the drag/tap gate-placement UI, validation against a supplied canonical
  circuit, and hint/skip machinery. Fully generic: wire count, gate palette, and validation target
  are all config the calling game supplies. Validation isn't limited to a gate-for-gate copy of the
  canonical circuit: it first checks for a structural match, and if that fails, falls back to
  running both the player's circuit and the canonical one against the actual live input state and
  comparing output-state fidelity (`QEngine.overlap`, |⟨canonical|player⟩|²). A fidelity of 1 (up to
  floating-point tolerance) is accepted, since a global phase difference is physically unobservable
  — so a different-but-equivalent circuit (extra self-cancelling gates, a daggered self-adjoint
  gate, a different but physically identical decomposition) passes exactly like the textbook one.

### Palette: base tiles + dynamic modifiers

Rather than listing every multi-controlled gate as its own tile, the palette holds a small set of
base tiles plus two drag-on modifiers:

- **1-qubit unitaries**: H, X, Y, Z, S, T, and a parameterized **R(θ)** with an X/Y/Z axis toggle.
- **2-qubit base gates**: SWAP and **CP(θ)** — SWAP is a two-step "preset" tile (drop it, and its
  second leg auto-arms). CNOT and CZ aren't separate tiles: `+Control` on X or Z already builds
  them, and a player using this palette is assumed to know CNOT is C-X.
- **`+Control`** — drag onto any existing gate's wire in that column to add a control node.
  Stacks without limit: two `+Control` drops onto an X tile renders (and simulates) a Toffoli.
- **`Adjoint (†)`** — drag onto (or tap) an existing single gate to invert it in place.
- **M** (measurement) is on the palette as a placeholder for future feed-forward games; it has no
  effect on Magic Square's win condition today. Classical Wires (mid-circuit feed-forward) are
  not implemented yet — flagged as future work alongside mid-circuit measurement.

## Status

First game built on this engine. The reusable namespaces are meant to support more circuit-based
games and textbook algorithms later, on the same base-tile + modifier palette.

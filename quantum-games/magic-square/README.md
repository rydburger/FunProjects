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
  - Every gate runs on a real noiseless statevector simulation (complex amplitudes, unitary
    matrices, Born-rule measurement) — once the circuits are right, the win is guaranteed, not
    scripted.

## The paper chapters (arXiv:2512.02284)

Chapters 2–5 implement every task in Kumar et al., *Quantum–classical separation in
bounded-resource tasks arising from measurement contextuality* (Google Quantum AI,
[arXiv:2512.02284](https://arxiv.org/abs/2512.02284)). A chapter bar at the top of every page links
them together.

| Page | Paper | What you do |
|---|---|---|
| `index.html` | Fig. 1A–C | The original game (classical and build-the-circuit quantum modes). |
| `lab.html` | Fig. 1D, S2, S3 | All nine games on a simulated noisy chip: Plan I (measure two, infer one) vs. Plan II (ancilla QND for all three), shots, noise sliders, an error budget. Model ≈ 97.5% / 91.3% vs. paper 97.7–98.3% / 93.6%. |
| `ksb.html` | Fig. 2, S4 | Kochen–Specker–Bell inequality χ ≤ 4. Fill a hidden-variable table (max 4) or a context-dependent one (6). Measure contexts one at a time on a 2-qubit + ancilla device. Run the 180-context × 1000-run protocol. Model χ ≈ 5.5 vs. paper 5.618; P_agree 96.5% / 50.0% vs. 96.4% / 50.0%. |
| `ghz.html` | Fig. 3, S6 | N-player GHZ parity game: build classical (best ½ + 2^−⌈N/2⌉) or quantum (X/Y/Z per bit) strategies for 3–8 players on a statevector. Grow GHZ states on a 72-qubit lattice, then sweep N = 2…71. |
| `hlf.html` | Fig. 4, S7 | 2D hidden linear function as a puzzle (tap nodes to satisfy the kernel checks, or let the 4-layer circuit solve it in one shot). Effective depth vs. n = 9…105 against the log₂(inputs) yardstick. Model ≈ 5.4 vs. paper ≈ 6 at n = 105. |

Shared files: `paper.css` (tokens and components), `paper-ui.js` (chapter nav, theme toggle, SVG
charts with hover and data tables, circuit drawer, noise sliders, time-sliced job runner). All game
logic lives in DOM-free [`../nonlocal.js`](../nonlocal.js), tested by `tests/nonlocal.test.js`.

**One correction to the paper's text:** the classical GHZ bound is ½ + 2^−⌈N/2⌉ (ceiling). Our
brute-force test confirms this for N = 2…10. With a floor, N = 3 would give 100%, but Mermin's
3-player game is famously capped at 75%.

**Noise model.** Depolarizing noise after every gate (1q 0.05%, CZ 0.3%), readout flips 0.7%: these
are the representative rates in the paper's Fig. S6. On top of that, our own idle term stands in
for T1 under dynamical decoupling (0.03% per moment for each already-used qubit). KSB also has
ancilla reset errors and data errors during each readout. Every page has sliders and presets.

**Performance.** The pages stay smooth at paper scale because nothing big is ever a statevector.
Every circuit is Clifford, all noise is Pauli, and every score is a parity of final measurements.
So `Clifford.faultTable` back-propagates the scoring parities once through the circuit, which gives
each fault's flip pattern. Independent faults then combine exactly, by XOR-convolution or the
closed form ½(1 + ∏(1 − 2q)). That costs O(circuit size): a 71-qubit GHZ game takes well under a
millisecond. HLF samples shots from the same fault table with geometric skipping. Statevectors are
used only where they are tiny: KSB (3 qubits), the 3–8-player GHZ table, and the 9- and 16-node
HLF puzzles. Sweeps run in ~12 ms slices (`PaperUI.job`). The paper-scale runs (GHZ 70 × 20 × 50,
HLF 11 × 1000 × 100, KSB 1000 × 180) finish in under 3 s in headless Chromium, with no main-thread
task over 50 ms.

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

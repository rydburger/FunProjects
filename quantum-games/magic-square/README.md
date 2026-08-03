# The Magic Square — Peres–Mermin pseudo-telepathy game

A single self-contained HTML page — open `index.html` in any browser (Chrome preferred), nothing to build or install.

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

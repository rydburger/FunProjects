# Magic Square & the arXiv:2512.02284 chapters: status & handoff

Last updated: 2026-11-21 (after PR #14). Written so a new session can resume without the
original chat. Companion doc: [`README.md`](README.md), with the player-facing description, the
model-vs-paper table and performance notes.

## Where things stand

**Everything planned is done.** The folder holds the original Peres–Mermin game (`index.html`,
chapter 1) plus four chapters that implement every task in Google Quantum AI's *Quantum–classical
separation in bounded-resource tasks arising from measurement contextuality*
([arXiv:2512.02284](https://arxiv.org/abs/2512.02284)):

| Chapter | Page | Paper | What it covers |
|---|---|---|---|
| 1 | `index.html` | Fig. 1A–C | The interactive game: classical or quantum mode, where the player builds Charlie's, Alice's and Bob's circuits. Quantum mode has a **Perfect qubits / Noisy chip** switch (#14). |
| 2 | `lab.html` | Fig. 1D, S2, S3 | All 9 games on a noisy chip; Plan I and Plan II; error budget vs. Fig. S3B. |
| 3 | `ksb.html` | Fig. 2, S4, S5 | KSB inequality (χ ≤ 4): hidden-variable tables, an interactive sequential device, the 180 × 1000 protocol, per-Pauli agreement, and the compensation-phase calibration sweep. |
| 4 | `ghz.html` | Fig. 3, S6 | N-player GHZ game: strategy builder for 3–8 players, GHZ growth on a 72-qubit lattice, the N = 2…71 sweep, and fidelity Fˣ / Fᶻ / F. |
| 5 | `hlf.html` | Fig. 4, S7, S8 | 2D hidden linear function puzzle plus the effective-depth sweep for n = 9…105, the paper's step bound, and the Bravyi extrapolations. |

The owner reads the pages locally. Nothing here is published as an artifact.

**PR history:**
- [#12](https://github.com/rydburger/FunProjects/pull/12) (merged) added chapters 2–5, `nonlocal.js`, `paper.css` and `paper-ui.js`.
- [#13](https://github.com/rydburger/FunProjects/pull/13) (merged) checked everything against the PDF. It added the paper's measured data, GHZ fidelity, KSB calibration and per-Pauli agreement, Plan II as in Fig. S2, the T1/DD idle model, and the HLF step bound plus the Fig. S8 overlay.
- [#14](https://github.com/rydburger/FunProjects/pull/14) (open when this was written) updated the original game: noisy-chip mode, a doctype and viewport (the page was in quirks mode and zoomed out on phones), the 2025 result in the text, and this file.

The owner merges quickly. Per CLAUDE.md, check whether the branch's PR is merged before stacking
commits. If it is, restart the branch from `main` and open a new PR.

## Architecture in one breath

- **`../nonlocal.js`** (`window.NonLocal`, `require()` in Node; DOM-free) holds all game logic:
  - `SV`: a tiny in-place statevector (qubit q is bit `1 << q`). Gates: H, S, SDG, X, Y, Z, CZ, CX and `RZ(θ)` = diag(1, e^{iθ}).
  - `Clifford`: circuits as moments, and `withNoise()`, which inserts noise ops: DEP1, DEP2, IDLE (X/Y only) and FLIP (readout). `faultTable()` back-propagates the scoring parities to give every fault's flip pattern. `exactDistribution()` / `noFlipProb1()` combine faults exactly; `sampler()` does Monte Carlo with geometric skipping; `frameSample()` is an independent forward Pauli-frame sampler used only by tests.
  - `Magic`: Table I, Plan I / Plan II circuits (`variationI/II`), `winProb`, and `gameCircuit` / `gameWinProb` / `GAME_NOISE` for chapter 1's uncompiled circuits.
  - `KSB`: `device()` is a 3-qubit statevector with an ancilla Hadamard test. `runner()` runs the protocol incrementally; `tracker()` records agreement events.
  - `GHZ`: `growth()` (randomized BFS on `lattice(n)`), the game circuits, `winProbBits()`, and `fidelity()` (X- and Z-type stabilizers).
  - `HLF`: instances on `lattice(n)`, the GF(2) `kernel`, `solve`, `isSolution`, `idealSample`, the 4-layer `circuit`, and `noisySuccess`.
  - `Noise`: trajectory helpers for chapter 1. `applyQEngineGate` / `measureQEngine` take `QEngine` as an argument, so the file stays independent of `engine.js`.
  - `PAPER`: the paper's measured data. `paperClassicalLayers(n)` gives the Fig. 4B step bound.
- **`paper-ui.js`** (`window.PaperUI`) holds the DOM helpers:
  - `nav(id)`: the chapter bar and a theme toggle (stored as `localStorage` key `qg-theme`).
  - `lineChart` / `barChart`: SVG charts with hover tooltips, a legend and a "Data table" details element. Reference lines can supply `valueAt(x)` for their tooltip.
  - Also `drawCircuit`, `seg`, `noisePanel` (log sliders and presets) and `job(step)`, the time-sliced runner that keeps sweeps off the main thread's critical path.
- **`paper.css`** holds the shared tokens and components. `index.html` keeps its own inline CSS (it predates the chapters) and loads `paper-ui.js` only for the nav.
- **`../engine.js`** (`QEngine`, `CircuitCanvas`, `CircuitEditor`) still powers chapter 1's editor and statevector. It has no `module.exports`; the tests load it with a `global.window = {}` shim.

## Key design decisions (and why)

- **Exact fault analysis instead of big statevectors.** Every circuit is Clifford, every noise
  channel is Pauli, and every score is a parity of final Z readouts. So one backward pass gives
  each fault's flip pattern, and independent faults XOR-combine exactly. This is why 71- and
  105-qubit sweeps run smoothly in a browser. Statevectors appear only where they are tiny: KSB
  (3 qubits, which also has the non-Clifford compensation phase), the GHZ table (≤ 8 qubits), the
  9- and 16-node HLF puzzles, and chapter 1 (4 qubits).
- **Noise model.**
  - Gate and readout rates come from the paper's Fig. S6 caption: 1q 5e-4, CZ 3e-3, symmetric readout 7e-3, T1 = 73 µs.
  - Idling is the paper's T1-with-dynamical-decoupling channel (Eqs. S19–S22), which is exactly X or Y with equal probability. The rate per moment is (1 − e^(−t/T1))/2 with an assumed 40 ns moment (`Clifford.MOMENT`); the paper gives no gate durations.
  - KSB adds ancilla reset 0.2%, an X/Y error on each data qubit per readout of 0.2%, and the Sec. 4B phase (`phaseErr`, `virtualZ`, in units of π).
  - Chapter 1's noisy chip uses `GAME_NOISE`: the same rates, no idling (the game has no clock), and each gate charged as the player placed it. A CNOT counts as one two-qubit gate; a gate on k ≥ 3 qubits is charged k − 1 two-qubit gates.
- **Plan II follows Fig. S2.** Two ancillas take entries 0 and 1. The third Pauli is rotated and
  folded by a CNOT onto the player's second data qubit, so each player has three readouts. A win
  needs both product rules plus the shared cell, which gives three parities and k = 3 in the fault
  table.
- **KSB agreement follows Sec. 4A.**
  - "Compatible" counts only a Pauli that appears in two *consecutive* contexts.
  - "Incompatible" means an anticommuting Pauli was measured in between.
  - Longer all-commuting gaps are ignored.
  - The three measurements within a context run in random order.
- **GHZ classical bound is ½ + 2^−⌈N/2⌉.** The main text prints ⌊N/2⌋, but Fig. 3B's own line
  and our brute-force test both use the ceiling. With a floor, N = 3 would give 100% rather than
  the known 75%.
- **GHZ error bars follow Sec. 5C:** σ = SD over growth patterns / √(number of patterns), with 20
  games per pattern and 1000 shots per game. Fˣ comes from the exact game probabilities
  (P_w = (1 + Fˣ)/2); Fᶻ samples 2 Z-type stabilizers per pattern.
- **HLF puzzle generation** rejects instances with fewer than 2 or more than 6 kernel checks, and
  instances where choosing nothing already solves it.

## The paper's data (`NonLocal.PAPER`) and how to re-extract it

The extraction scripts were scratch code and are not in the repo. The method is below, if a
future paper version needs it.

- **Vector figures** (Fig. 1D rows 2–3, S3A, 2B, 4B and the 4B gray steps): use `pdfplumber` (it
  was available in the cloud container) on the right page.
  - Take `page.curves` with the marker's fill colour and use each centre.
  - Calibrate with the axis **tick-mark** segments, which are short lines just inside the axis. Don't use the tick-label text centres; they sit about 1 pt off.
  - Colours: magic-square markers are olive (0.6, 0.6, 0.03); S3A uses green (0.2, 0.549, 0.2) and red (0.698, 0.2, 0.2); 2B uses (0.502, 0.502, 0.03); 4B uses blue (0.102, 0.102, 0.902). The Fig. 4B classical steps are the gray (0.502…) `page.lines`.
- **Raster figures** (Fig. 3B, Fig. 1D row 1): render with `pdftoppm -r 600`. Calibrate the axes
  from dark tick pixels, then sample each data column at its calibrated x. Fig. 3B's dots touch,
  so blob detection merges them; sample the column at each integer N instead. Accuracy is ±0.002.
- **Validation:** the tests require the sets to reproduce the averages the paper prints. These
  are 0.9830 (Fig. 1D, ±0.001), 0.9773 and 0.9355 (S3A, ±0.0003) and χ = 5.618 (2B). They also
  require the 4B steps to equal ⌈log₂(edges + nodes)⌉ on square grids.

## Current numbers (model vs. paper)

| | model | paper |
|---|---|---|
| Chapter 1, noisy chip (game circuits) | 97.7% (150 UI rounds: 98.0%) | 98.30% |
| Plan I / Plan II (chip-compiled) | 97.5% / 91.7% | 98.30% (1D), 97.73% / 93.55% (S3) |
| Plan II budget 1q / CZ / readout / idle | 0.79 / 1.83 / 4.12 / 1.82% | 0.54 / 1.75 / 3.90 / – |
| KSB χ; P_agree compatible / incompatible | 5.52; 96.5% / 50.0% | 5.618; 96.36% / 50.0% |
| KSB best virtual Z (hidden phase 0.27π) | −0.27π (by construction) | ≈ −0.27π (Fig. S5C) |
| GHZ win at N = 10 / 30 / 50 / 71 | 0.91 / 0.76 / 0.66 / 0.60 | 0.909 / 0.782 / 0.674 / 0.607 |
| GHZ F < ½ at | N ≈ 43 | N = 45 |
| HLF effective layers at n = 50 / 105 | 4.6 / 5.4 | 4.8 / 6.5 |

## Known quirks / small open items

- **HLF at large n.** The model is optimistic (5.4 vs. 6.5 layers at n = 105). The 105-qubit
  device evidently has extra error sources that the S6 rates don't capture.
- **Compilation.** Our chip-compiled circuits keep every single-qubit gate as its own moment,
  while the paper merges runs of them. That overstates idling, most visibly in Plan II (1.82%
  idle). Merging single-qubit runs in `Clifford.withNoise` (or a compile pass) would close most
  of the Plan II gap.
- **Readout is symmetric (0.7%).** Fig. S1 shows e₀ ≈ 0.3% and e₁ ≈ 1%. Outcome-dependent flips
  aren't a Pauli channel, so supporting them needs the ideal outcome distribution (easy for GHZ,
  where outcomes are uniform).
- **Data not extracted:**
  - Fig. S4's per-Pauli P_agree values (we show only the paper's averages).
  - Fig. S7's P = 0.25 / 0.75 curves.
  - Fig. S6's measured fidelity curves (we quote only the crossing at 45 and the endpoint values).
- **`index.html` structure.** It predates the chapters. It now has a doctype, charset and viewport
  but no explicit `<head>` / `<body>` (valid HTML5). Its CSS dark-mode block isn't guarded by
  `:root:not([data-theme="light"])`. It still works, because `[data-theme="light"]` has higher
  specificity.
- **The magic-square lattice for GHZ/HLF is a disk-shaped patch** (`lattice(n)`: the n sites
  nearest the origin), not Willow's exact diamond layout. It is the same graph family; only the
  boundary differs.

## Testing recipe

```
node quantum-games/tests/nonlocal.test.js
```

That runs 45 tests covering every physics claim on the pages. Run the other three suites from
CLAUDE.md too before pushing. For UI changes, use headless Chromium:

- Screenshot light, dark and 390 px views, and check `document.documentElement.scrollWidth` ≤ the viewport.
- **For a true phone check, use `devices['iPhone 13']`.** A resized desktop viewport doesn't
  apply the viewport meta, which is how the missing meta in `index.html` went unnoticed until #14.
- **Auto-playing chapter 1:** click through by DOM (`el.click()` in `page.evaluate`), not
  `page.click`, because scene transitions race Playwright's visibility wait.
  - Quantum: Skip buttons, then Apply / Send / Run / Submit, then Play again.
  - Classical: Bob's column needs an odd number of −1s before he can submit, so flip one cell.
- **Responsiveness:** a `PerformanceObserver({type: 'longtask'})` during the paper-scale sweeps
  should record nothing. Those are GHZ at 50 patterns, HLF at 1000 puzzles, and KSB protocol plus
  calibration. Each currently finishes in 1.3–2.6 s.

## Possible next steps (none requested yet)

- A compile pass that merges single-qubit runs (see quirks), then recheck Plan II and the budget.
- Asymmetric readout, at least for GHZ.
- Extract the S4, S6 and S7 data and overlay them.
- A noisy-chip toggle for chapter 4.1's small-N GHZ table, to match chapter 1.

## Starter prompt for a new session

> Read `quantum-games/magic-square/STATUS.md` and `README.md`, then run
> `node quantum-games/tests/nonlocal.test.js`. Then [describe the change]. Keep logic in
> `quantum-games/nonlocal.js` with tests; pages are UI only. Before pushing, screenshot light,
> dark, 390 px and an iPhone 13 emulation, and check for console errors.

# Quantum Games

A collection of playable, browser-based quantum computing games and demos. Each game is a
self-contained folder — open its `index.html` in any browser, nothing to build or install.

## Games

- [`magic-square/`](magic-square/) — the Peres–Mermin magic square, a quantum "pseudo-telepathy"
  game. Classical and quantum modes; the quantum mode has you build the actual entangling circuits
  by hand.
- [`qec-zoo-tycoon/`](qec-zoo-tycoon/) — Error Correction Zoo Tycoon: run a quantum-startup
  zoo where the animals are error-correcting codes and the zookeepers are decoders. `index.html` is
  the park (build enclosures, buy animals, hire keepers, keep the funding flowing);
  `sandbox.html` follows a single exhibit round by round. See the
  [game README](qec-zoo-tycoon/README.md) and [`PLAN.md`](qec-zoo-tycoon/PLAN.md).

## Shared engine

[`engine.js`](engine.js) is a from-scratch quantum circuit simulator and drag-and-drop circuit
editor (`QEngine`, `CircuitCanvas`, `CircuitEditor` — see
[`magic-square/README.md`](magic-square/README.md#under-the-hood) for details), with no dependency
on any particular game. Any game in this collection can load it directly with
`<script src="../engine.js"></script>` (as `magic-square/index.html` does) to get `QEngine`,
`CircuitCanvas`, and `CircuitEditor` on `window`, rather than rebuilding circuit simulation from
scratch.

[`stabilizer.js`](stabilizer.js) is the stabilizer-code counterpart: Pauli operators as symplectic
bitmasks, stabilizer-group comparison, syndromes, minimum-weight lookup decoders, and seeded Pauli
noise (`window.Stabilizer` in the browser, `require()` in Node). It tracks errors, not
statevectors, so it's exact and fast for error-correction games on stabilizer codes. Tests:
`node quantum-games/tests/stabilizer.test.js` (and `zoo-tycoon.test.js` for the game logic built on it).

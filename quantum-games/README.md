# Quantum Games

A collection of playable, browser-based quantum computing games and demos. Each game is a
self-contained folder — open its `index.html` in any browser, nothing to build or install.

## Games

- [`magic-square/`](magic-square/) — the Peres–Mermin magic square, a quantum "pseudo-telepathy"
  game. Classical and quantum modes; the quantum mode has you build the actual entangling circuits
  by hand.

## Shared engine

`magic-square` includes a from-scratch quantum circuit simulator and drag-and-drop circuit editor
(`QEngine`, `CircuitCanvas`, `CircuitEditor` — see [`magic-square/README.md`](magic-square/README.md#under-the-hood)
for details), written with no dependency on the magic square game itself. Future games in this
collection are meant to reuse that same engine rather than rebuild circuit simulation from
scratch — for now it lives inside `magic-square/index.html`; once a second game needs it, it'll be
pulled out into a shared file both games load.

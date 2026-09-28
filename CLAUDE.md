# FunProjects

Personal fun projects. Currently everything lives in `quantum-games/`: browser games with no build
step. Open an `index.html` directly.

## Layout

- `quantum-games/engine.js`: statevector simulator + drag-and-drop circuit editor (`QEngine`,
  `CircuitCanvas`, `CircuitEditor`). Used by `magic-square/`.
- `quantum-games/stabilizer.js`: Pauli-frame / stabilizer-code toolkit (`Stabilizer`). Used by
  `qec-zoo-tycoon/`.
- `quantum-games/magic-square/`: Peres–Mermin magic square game (done).
- `quantum-games/qec-zoo-tycoon/`: Error Correction Zoo Tycoon. v0 is complete.
  **Read `quantum-games/qec-zoo-tycoon/STATUS.md` before working on it.** It has the progress
  log, design decisions, numbers, and next steps.
- `quantum-games/tests/`: plain Node tests, no dependencies.

## Conventions

- Plain ES5-style JS in IIFEs, exposed on `window` (and `module.exports` when the file is
  DOM-free, so Node tests can `require` it). No frameworks, no bundler, no npm packages.
- Keep game logic DOM-free and tested in Node; HTML pages are UI only.
- Pages use theme tokens on `:root` with light/dark (`prefers-color-scheme` plus
  `[data-theme]`), and must work at phone width with no horizontal scroll.
- Physics shown to the player must be correct. Verify code definitions (commutation, k,
  distance) with tests rather than by eye.

## Checks before pushing

```
node quantum-games/tests/stabilizer.test.js
node quantum-games/tests/zoo-tycoon.test.js
```

For UI changes, drive the page in headless Chromium (Playwright is preinstalled in cloud
sessions: `require('/opt/node22/lib/node_modules/playwright')`). Screenshot light, dark and
390px-wide views, and check for console errors.

## Git workflow

The owner merges PRs quickly. Before stacking more commits on a branch, check whether its PR is
already merged. If it is, restart the branch from `main` and open a new PR.

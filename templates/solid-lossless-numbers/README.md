# Solid Lossless Numbers

A Solid + Vite starter for exploring exact rational arithmetic with
`atom.io/solid` and the `rationality` package.

## What It Shows

- atoms and atom families for editable rational inputs
- mutable atom state backed by an ordered list transceiver
- selector families for simplified fractions, decimal views, and float precision
- transactions for applying arithmetic operations across related state

## Run It

```sh
npm run dev
```

Build and preview the production app:

```sh
npm run build
npm run preview
```

## Quality Checks

Run `npm run lint` before committing. It enforces ESLint, type-aware Oxlint, and TypeScript with zero warnings. Run `npm run fmt:check` in CI and `npm run fmt` to apply the pinned dprint configuration locally.

## Where To Look

- `src/App.tsx`: the atom.io state model, Solid components, and rational arithmetic UI.
- `src/App.tsx.module.css`: component-scoped styling for the playground.
- `src/globals.css`: global page styling.

## Next Ideas

- Add named saved calculations.
- Persist the rational list between reloads.
- Add tests around selectors that detect floating-point precision.

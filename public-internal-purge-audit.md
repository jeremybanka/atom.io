# Public Internal Purge Audit

Goal: remove every `atom.io/internal` import from `packages/atom.io/__tests__/public/`.

- [x] Convert easy setup-only imports to `takeSnapshot().restore()` and `setTestLogLevel(null)`.
      Done for [families.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/families.test.ts) and [transaction.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/transaction.test.ts), which now pass the new ESLint guard.

- [x] Add public testing helpers for logger capture/assertion setup.
      `setTestLogLevel(null)` now returns the implicit store's public `Logger`, so tests can spy on `error`, `warn`, and `info` without importing `atom.io/internal` or turning internal console output on:
      [join.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/join.test.ts),
      [disposal.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/disposal.test.ts),
      [timeline.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/timeline.test.ts),
      [silo-install.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/silo-install.test.ts),
      [atom-effects.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/atom-effects.test.ts),
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts),
      [o-list-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/o-list-atom.test.ts),
      [u-list-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/u-list-atom.test.ts).

- [ ] Add public testing helpers for temporary implicit store config.
      Remaining tests directly set `isProduction` or `lifespan` on the implicit store:
      [logger.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/logger.test.ts),
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts),
      [disposal.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/disposal.test.ts).

- [ ] Decide how public tests should express internal async/event primitives.
      Remaining tests use `Future`, `Subject`, or `StatefulSubject` from `atom.io/internal`:
      [atom-effects.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/atom-effects.test.ts),
      [mutable-atom.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/mutability/mutable-atom.test.ts).

- [ ] Replace `NotFoundError` identity assertions with a public contract.
      [silo-install.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/silo-install.test.ts) imports `NotFoundError`.

- [ ] Replace direct cache/value-map inspection.
      [async-state.test.ts](/home/jem/atom.io/packages/atom.io/__tests__/public/async-state.test.ts) reads `IMPLICIT.STORE.valueMap`.

- [ ] Solve the React implicit store reset problem.
      [react-hooks.test.tsx](/home/jem/atom.io/packages/atom.io/__tests__/public/react-hooks.test.tsx) still needs `clearStore(IMPLICIT.STORE)` because `takeSnapshot().restore()` replaces the implicit store object while React's default `StoreContext` has already captured the old object. It now uses `setTestLogLevel(null)` for the debug log switch, but still imports the internal `Fn` type.

- [ ] Re-run `pnpm exec eslint packages/atom.io/__tests__/public` until the public internal import checklist is empty.

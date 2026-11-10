# @atom.io/template-spa-astro-ssr

## 0.0.9

### Patch Changes

- Updated dependencies [ca99ce3]
  - @atom.io/spa@0.0.8

## 0.0.8

### Patch Changes

- Updated dependencies [15e1af8]
- Updated dependencies [82996ba]
- Updated dependencies [9a1493a]
- Updated dependencies [5bde2f5]
- Updated dependencies [5bde2f5]
- Updated dependencies [5bde2f5]
- Updated dependencies [c8e41b3]
  - @atom.io/spa@0.0.7
  - atom.io@0.54.8
  - resumability@0.0.2

## 0.0.7

### Patch Changes

- Updated dependencies [dfffe53]
- Updated dependencies [934e565]
- Updated dependencies [3281c91]
- Updated dependencies [48e8271]
  - @atom.io/spa@0.0.6
  - atom.io@0.54.7
  - resumability@0.0.2

## 0.0.6

### Patch Changes

- a267c23: Update TypeScript to 7.1.0-dev.20261107.1 in the SPA Astro SSR template.

## 0.0.5

### Patch Changes

- ffbb22d: Simplify the SPA setup examples to a single counter, present Astro before Vite, and show only the setup each framework requires. Remove unrelated lifecycle helpers, slots, initial props, and custom stores from the Astro counter, and keep the point example focused on reactive state. Use ordinary .tsx component filenames throughout the SPA exhibits, debugger setup, and Astro starter. The Astro integration now compiles .tsx and .jsx files by default; applications using multiple JSX renderers must use include to select their SPA component directories.
- 90f634c: Rework SPA documentation around the Astro starter, dedicated Astro and Vite guides, and focused rendering and hook examples. Move Astro request collection, streaming sidecar delivery, and ordinary browser harvesting into resumability so plain Astro constants and atom defaults use the same host without a special store bridge. Keep async JSX rendering and private-store lifetime binding in SPA, and attach seeds to each island’s HTML so shared cached reads hydrate in either order. Explain siloized islands with a focused example and document private-scope disposal on unmount, persisted islands, and shared page lifetimes. Remove the Resumption wrapper, deferred children, preparation callbacks, and preload lists from the starter and SPA guides while preserving explicit collection scopes and original producer errors. Use state.ts and a stock-counting workflow with persistent saves and conflict detection. Place “you don’t need useEffect” last in Patterns and refresh affected bundle measurements.
- 8b43951: Rename the public VNode type to SpaElement and Child to Children. Update type imports and annotations to the new names; JSX.Element aliases SpaElement, and Component returns Children. Children retains the same recursive union of renderable values, readonly arrays, and accessors, and SpaElement retains the same type and props fields. Update the documentation, examples, Astro starter, and SPA devtools; the devtools now require @atom.io/spa 0.0.5 or newer within the 0.0.x release line for these type exports.
- Updated dependencies [4b4c19a]
- Updated dependencies [90f634c]
- Updated dependencies [5f84875]
- Updated dependencies [b166670]
- Updated dependencies [ffbb22d]
- Updated dependencies [06c8a0c]
- Updated dependencies [90f634c]
- Updated dependencies [4349006]
- Updated dependencies [8d36ec1]
- Updated dependencies [90f634c]
- Updated dependencies [8b43951]
- Updated dependencies [ccefaca]
  - atom.io@0.54.6
  - @atom.io/spa@0.0.5
  - resumability@0.0.2

## 0.0.4

### Patch Changes

- Updated dependencies [00d0f4d]
- Updated dependencies [72d951d]
  - @atom.io/spa@0.0.4
  - atom.io@0.54.5
  - resumability@0.0.1

## 0.0.3

### Patch Changes

- Updated dependencies [b1aa735]
- Updated dependencies [b7becbd]
  - @atom.io/spa@0.0.3
  - atom.io@0.54.4
  - resumability@0.0.1

## 0.0.2

### Patch Changes

- Updated dependencies [9565f6d]
- Updated dependencies [1f43188]
- Updated dependencies [9565f6d]
  - @atom.io/spa@0.0.2

## 0.0.1

### Patch Changes

- 138c640: Introduce a Node-hosted Astro starter using @atom.io/spa and resumability/astro with module-scoped atom families. SSR and typed tRPC resets call the same Reylo-backed node:sqlite query. Initial islands resume server values without an RPC request, delayed islands render live shared state after edits, and ClientRouter navigation preserves browser values.

  Cache the public drafts page's HTML and resumption sidecar together in memory for 60 seconds, without stale-while-revalidate. The cache is process-local and disabled during development. Keep tRPC responses uncached with Cache-Control: no-store so explicit resets fetch current database values even when the page resumed an older snapshot. Production and development browser checks cover hydration, shared state, fresh resets, and production cache expiry.

  Requires Node 24.12 or newer and TypeScript 7.1's content mappers, currently beta. Seed commands initialize the example database without overwriting existing edits; deployed SQLite files require persistent storage.
- Updated dependencies [138c640]
- Updated dependencies [138c640]
- Updated dependencies [138c640]
- Updated dependencies [138c640]
- Updated dependencies [138c640]
- Updated dependencies [138c640]
- Updated dependencies [138c640]
  - atom.io@0.54.3
  - resumability@0.0.1
  - @atom.io/spa@0.0.1

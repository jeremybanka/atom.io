# Preact SVG Editor

A Preact + Vite starter that uses `atom.io` to model an editable SVG path. Its
state model is also the local conformance foundation for collaborative vector
editing with Mosaic Domains.

## What It Shows

- ordinary atoms and atom families for path order, paths, subpath order,
  subpaths, nodes, and edges
- deterministic sequence and register reducers with strict operation schemas
- selector families that derive SVG path data from the ordinary state graph
- atomic transactions for import, insert, delete, split, reorder, and geometry
  gestures
- public Mosaic Domain registration and heterogeneous batch planners for every
  structural gesture
- deterministic same-node contention, offline replay, duplicate delivery,
  whole-batch rejection, and actor-selective compensation
- actor/session-scoped logical-coordinate drag presence with one durable commit
  at pointer-up
- explicit local-only workspace, viewport, DOM reference, pointer capture, and
  active-drag state
- `useAtomicRef` for keeping the local SVG element available to atom.io logic

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

Run `npm run lint` before committing. It enforces ESLint, type-aware Oxlint, React hook call-order correctness, and TypeScript with zero warnings. Run `npm run fmt:check` in CI and `npm run fmt` to apply the pinned dprint configuration locally.

Run the model conformance tests:

```sh
npm test
```

## Quality Checks

Run `npm run lint` before committing. It enforces ESLint, type-aware Oxlint, and TypeScript with zero warnings. Run `npm run fmt:check` in CI and `npm run fmt` to apply the pinned dprint configuration locally.

## Where To Look

- `src/index.tsx`: Preact entry point and resource links.
- `src/svg-convergence.ts`: pure convergent sequence/register schemas and
  reducers.
- `src/svg-editor-state.ts`: the durable graph, local/ephemeral boundaries,
  selectors, transactions, and gesture identities.
- `src/svg-domain.ts`: public Domain registration, structural batch planning,
  presence projection, and actor-selective compensating batches.
- `src/BezierPlayground.tsx`: the Preact renderer and pointer adapter.
- `COLLABORATION.md`: correctness decisions, innovations, and remaining
  persistence gates.
- `src/style.css`: layout and editor styling.

## Realtime Boundary

The reusable model fixture now synchronizes through public Mosaic Domain batch
and presence APIs. The visible playground intentionally remains a small local
renderer; MOS-23 consumes this fixture in the canonical realtime vector-editor
template. Partial residency, checkpoints, and process restart remain gated on
MOS-12 and MOS-13 rather than being simulated by application state.

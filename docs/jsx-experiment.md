# Atom native JSX experiment

This is the runnable baseline for **water**. The [water design and API proposal](water-design.md) records the intended setup model, small feature set, Vite and Astro goals, and a separate compiler-oriented API sketch. Its proposed accessor tracking and hydration are not implemented here.

This experiment tests whether atom.io can own application reactivity while a small renderer owns DOM bindings and their lifetimes. The agreed direction is familiar JSX and DOM props with an atom-native lifecycle. The private implementation lives in [experiments/atom-jsx](../experiments/atom-jsx); it is outside the workspace package globs and adds no published export or dependency.

## Rendering model

Components run once per mount and return descriptions created by the standard automatic JSX transform. Rendering creates DOM nodes directly. Readable tokens placed in JSX children or ordinary DOM props automatically connect their atom or selector to that DOM binding. Components receive tokens unchanged; subscriptions begin only when rendering reaches the DOM. Event handlers and refs retain their callback contracts. The renderer subscribes through atom.io, reads the current store value when invalidated, and releases the subscription when its owner is disposed.

Atom.io retains responsibility for state, derived values, transactions, and dependency tracking. A view-local project helper receives one token's value and should be pure. Multi-token computations belong in selectors. Ordinary reads during component setup are snapshots; neither the renderer nor a compiler silently tracks them. Tokens and projections can be passed through component props and children without executing the component again.

The executable [counter exhibit](../experiments/atom-jsx/counter.exhibit.tsx) demonstrates JSX, atom and selector bindings, a reactive disabled property, and a store-scoped click handler. The [runtime contracts](../experiments/atom-jsx/runtime.test.tsx) cover lifecycle and error behavior. The [point exhibit](../experiments/atom-jsx/point.exhibit.tsx) keeps a two-dimensional point in one atom and projects its coordinates into SVG attributes and a text label. Updating both coordinates remains one atom write. Direct object children are unsupported; project them into renderable values. Shared or multi-token derivations still belong in named selectors. Code examples stay in these checked exhibits and tests.

## Borrowed ideas

| Inspiration                                                                                  | Choice for this experiment                                                                                        |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Preact JSX and DOM conventions](https://preactjs.com/guide/v10/differences-to-react/)       | Function components, fragments, children, refs, and native events; className, htmlFor, and onDoubleClick aliases. |
| [Solid component lifetime](https://docs.solidjs.com/concepts/components/basics)              | Execute a component once per mount and dispose its owned resources when it leaves the tree.                       |
| [Solid targeted updates](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity) | Update a bound text node or property directly. Atom.io provides the state graph.                                  |

The surface borrows selected familiar conventions from preact/compat. Running React libraries would require substantially different lifecycle and compatibility contracts, and is outside this experiment.

## Small initial surface

The runtime provides JSX factories, Fragment, render, project, useStore, and onCleanup. A render root accepts an optional store and returns flush and dispose. Components capture useStore during setup for later event handlers. Store state outlives the view; disposing a component only releases renderer resources.

State writes remain immediate. DOM invalidations are deduplicated per binding and drained in a microtask; flush drains them explicitly. Unchanged primitive projection results skip DOM writes, while object snapshots are reapplied to preserve mutable-value notifications. Atom.io transactions determine state consistency. This scheduler offers neither concurrent snapshot isolation nor a browser paint guarantee. A binding initially reads after its subscription is installed, including when state is lazily initialized.

Text updates retain the existing text node. A binding returning elements or arrays disposes and remounts that region. Its outer DOM remains stable, but focus and local component state inside a replaced region are not preserved. Keys are rejected until keyed reconciliation exists. Unmount cancels queued work, removes listeners, clears callback refs, and runs cleanup even if another cleanup throws. A render failure disposes the root and propagates the error; a failure during an automatic flush is reported as an uncaught microtask error.

Rendering appends owned content to the host and leaves preexisting content intact on disposal. The prototype supports HTML, SVG, foreignObject, native bubbling and capture, form properties, and data and aria attributes. Styles are CSS strings. Refs receive the attached element after its children mount, then null on disposal. Native input events use onInput; onChange retains browser change semantics.

## Boundaries and next experiments

This is a source-level prototype with permissive DOM prop types. Readable tokens are recognized by their serializable key and readable type discriminator, including references deserialized from JSON. Family tokens require a concrete member before rendering. The test configuration aliases its JSX runtime and atom.io source; the experimental package name is not installed or published. Async children, suspense, hydration, SSR, portals, context providers, error boundaries, React hooks, style objects, and keyed lists are not implemented. Unsupported raw HTML and keys fail explicitly.

The current design work evaluates component setup, ownership, and tracked DOM computations before expanding this baseline. Keyed list ownership remains an important evaluation case: move existing DOM ranges when keys reorder, preserve focused controls and per-item cleanup, and dispose only removed rows. Atom families could supply state identity independently of list position.

Performance comparisons should measure initial mount, one-token updates in a large tree, list reorders, and disposal against the existing React and Solid bindings. The current contracts establish behavior; they do not establish a speed or bundle-size advantage.

## Running the experiment

After installing the repository dependencies, run `pnpm exec vitest run --config experiments/atom-jsx/vitest.config.ts` from the repository root. Check the runtime, exhibit, and test types with `pnpm exec tsc -p experiments/atom-jsx/tsconfig.json`. Both commands target this experiment independently of published package suites. No package README is changed or regenerated.

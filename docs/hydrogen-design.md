# Hydrogen architecture

Hydrogen is the JSX framework in [packages/hydrogen](../packages/hydrogen/README.md). It implements the atom.io-native, Solid-inspired model explored here: components establish an instance once, atom.io owns application state, and hydrogen owns DOM computations and their lifetimes. Its npm package name is hydrogen.

## Setup and rendering

The component body establishes accessors, commands, IDs, refs, and cleanup. Ordinary local variables and callbacks retain identity for that instance. There is no component rerender protocol, positional hook array, independent signals graph, useState, useEffect, useCallback, or useSyncExternalStore compatibility layer.

The Vite compiler preserves JSX child expressions as functions and attribute expressions as getters. Reading a hydrogen accessor while evaluating one of those expressions registers a dependency. Reads in ordinary setup code are snapshots; reads in event handlers are current and untracked. Helper functions called by a render expression participate in its tracking. Direct atom.io getState calls do not acquire tracking merely by appearing in JSX.

Component props remain live through getters. Setup destructuring captures a snapshot. Hook token arguments are fixed for an instance; a changing token needs a new keyed instance. Arrays in reactive child expressions use application keys to retain instances and DOM ranges across reordering. Unkeyed arrays use positions. Keys are collection identity, not a second reactive primitive.

The [PointEditor exhibit](../packages/hydrogen/exhibits/point.tsx) demonstrates the original object-valued point question. Both coordinates remain in one atom. Each JSX binding projects the coordinate it needs; the atom is the invalidation unit, and unchanged primitive results suppress DOM writes. Hydrogen does not promise separate subscriptions to object fields. Shared derivation belongs in atom.io selectors.

## Public surface

| API            | Responsibility                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| useValue       | Capture a readable token and store; return a tracked accessor.                                       |
| useLoadable    | Observe loadable state through a tracked accessor, with optional fallback and last-observed values.  |
| useSetter      | Capture a writable token and store; return a writer.                                                 |
| useTimeline    | Read timeline metadata and undo/redo/clear controls, including available transaction-group controls. |
| useRef         | Publish an attached element into a nullable atom and release only the attachment this instance owns. |
| useId          | Allocate a stable ID with a root prefix shared by SSR and hydration.                                 |
| onCleanup      | Register synchronous owner teardown.                                                                 |
| useTransaction | Bind an atom.io transaction while preserving its arguments and result.                               |
| onMount        | Run once after attachment and ref publication, including branches added by later updates.            |
| untrack        | Temporarily disable dependency collection while retaining the current owner.                         |

The core helpers capture the component store and ownership. Transaction commands preserve store scoping, onMount gives work involving several refs a reliable attachment point, and untrack makes intentional snapshots within reactive expressions explicit. useLoadable adapts atom.io promise state without adding a separate subscription or promise lifecycle; the [async state exhibit](../packages/hydrogen/exhibits/loadable.tsx) demonstrates its tracked accessor.

The state hooks useValue, useSetter, useRef, and useLoadable support streamlined family/key arguments resolved in the component's store. useTimeline supports timeline families in the same way. Both token and key stay fixed for the instance. The [family exhibit](../packages/hydrogen/exhibits/families.tsx) demonstrates reads, writes, refs, and timeline controls.

## Atom.io controls the view

Each computation evaluates synchronously, records the state or timeline subscriptions it actually uses, and reconciles those subscriptions when conditional dependencies change. Native element properties share a computation that compares their results before writing. Text and structural child expressions have their own computations. Mutable values still notify consumers; hydrogen recomputes projections and reapplies object-valued DOM properties.

Invalidations coalesce in a microtask after synchronous atom.io work settles. Root flush permits deterministic draining. A disposed owner cancels pending work, detaches subscriptions and events, releases refs, and runs cleanup even when another cleanup throws. A failed update disposes its root. Async update failures reach the root's onError callback; explicit flush and initial-render failures throw. Pure render computations must not write state.

Owner cleanup never disposes shared atoms. Ref ownership is guarded by an attachment identity, so an older view cannot clear a newer attachment to the same ref atom. Reordering retains component scopes and DOM ranges; browser checks cover focus and text selection. A ref is published after insertion, and all newly attached refs are available to their mount callbacks.

The renderer currently uses lightweight JSX descriptors plus lazy expressions. It does not rerender the component tree on atom changes, and it does not yet compile static templates directly into DOM creation instructions. The [JSX compiler](../packages/hydrogen/src/compiler.ts) and [DOM renderer](../packages/hydrogen/src/dom.ts) define the implemented protocol. Earlier target-protocol sketches are preserved in the [prototype archive](jsx-experiment.md).

## Server rendering and Astro

The client exports render and hydrate; the separate server entrypoint exports renderToString. Root options select the store and ID prefix. Server rendering reads a request-specific store, retains no subscriptions, and releases server-owned resources. Hydration requires matching initial state and valid HTML, reuses existing nodes and IDs, and throws on structural mismatches. Promise children and async components are not supported.

The Astro integration detects compiler-branded components, renders default and named slots, hydrates independent islands, replaces client-only fallbacks, and disposes on astro:unmount. Each island has an independent store by default. A deterministic createStore(props) factory supplies matching initial state on the server and browser; hydrogen does not serialize an entire store implicitly. Random server root prefixes travel in hydration markers to keep IDs distinct across islands. The [Counter exhibit](../packages/hydrogen/exhibits/Counter.hydrogen.tsx) implements that boundary.

Vite transforms JSX before its ordinary TypeScript transform and uses full page reloads during development. The plugin deduplicates Hydrogen and atom.io and excludes their entries from dependency prebundling in each Vite environment, including entries inserted by Astro adapters, so renderers, hooks, and stores share one runtime. Astro defaults to .hydrogen.tsx and .hydrogen.jsx files to coexist with other JSX renderers. The package keeps compiler, server, and integration entrypoints separate from the browser runtime.

## Budget and validation

The hard build check targets ordinary level-9 gzip under 3,300 bytes, including every public client export and the JSX runtime, with atom.io external as a peer. The [audit](../packages/hydrogen/scripts/size.ts) reports raw, minified, gzip, and Brotli sizes using Node's compression implementations, and also reports atom.io-inclusive and Astro client bundles and the installed Preact core under identical settings. Application code and the atom.io peer remain additional costs. This is a size budget, not a feature-equivalence or performance claim about Preact or Solid.

Tests cover setup counts, tracked helpers, conditional dependencies, keyed ownership and focus, refs, stores, transactions, timelines, errors, cleanup, compiler branding, SSR, hydration, raw text, and slots. A production test executes the audited minified JavaScript. A real Chromium test exercises the built Astro site, including multiple initialized islands, client-only mounting, SVG foreignObject hydration, keyed input selection, and unmount cleanup.

The first version deliberately omits React compatibility, style objects, portals, suspense, error boundaries, asynchronous rendering, automatic token-as-child bindings, and state-preserving HMR. Runtime and compiler improvements must preserve the existing ownership contract and keep the size report explicit about dependencies and compression.

The [original experiment](jsx-experiment.md), which explored direct token bindings and explicit projections, is archived on a separate remote branch. The executable hydrogen package is the implementation reference.

## The site and debugger

atom.io.fyi uses hydrogen for its navigation, spotlight geometry, code blocks, Three.js islands, and debugger. The navigation's createStore factory creates isolated SSR stores and explicitly shares the browser's implicit store, making those atoms available to the debugger. Heading discovery and browser listeners use onMount/onCleanup. Geometry and Three.js resources use local callback refs without introducing a second state engine.

Persisted Astro islands update through an adapter-owned atom family member. Their component setup, store, and DOM identity survive prop changes; changed slot HTML replaces only the affected slot. Unmount releases the adapter state. The adapter removes Astro's trailing streaming sentinel before strict hydration during ClientRouter navigation.

The separate @atom.io/hydrogen-devtools package contains the inspector UI. It renders into the inspected store, uses disposable atom family members for its own state, and delegates logs and indexes to atom.io/introspection. It preserves JSON editing, readonly selectors, state and timeline families, transaction logs, undo/redo, expansion controls, dragging, and saved panel settings. It does not contribute to the renderer's size audit. React applications can continue using react-devtools.

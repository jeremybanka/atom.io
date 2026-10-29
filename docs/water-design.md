# Water design and API proposal

Water is the codename for a small JSX renderer tailored to atom.io, with a Solid-inspired reactivity model and first-class Vite and Astro integration. Components set up once per mounted instance. Atom.io owns application state and drives subsequent changes; water owns DOM nodes, render computations, and their lifetimes.

The intended size target is a client runtime smaller than Preact or Solid. That is a target to measure, not an established result. Report water's incremental bytes and the complete atom.io plus water bundle separately, with equivalent features and build settings. Compiler, development tooling, server rendering, and Astro integration should have separate entrypoints so their implementation does not automatically become client runtime code.

## Agreed direction

The component body establishes a durable instance: live state access, callbacks, resource ownership, and cleanup. A state change reruns only the affected render computations. A new instance runs setup again. Helpers called during setup participate in the caller's owner. Ordinary local variables and callbacks already have stable identity over that instance's lifetime.

Water should have no useState, useEffect, signals API, useCallback, React-style useRef container, or useSyncExternalStore compatibility layer. Atom.io already supplies state, selectors, transactions, and subscriptions. Water still needs internal subscriptions and scheduling to connect state to the DOM, but should not introduce a second application state graph.

DOM references should be publishable into atom state through useRef or equivalent ref syntax. Cleanup belongs to the rendering owner. Shared application atoms outlive component disposal; their lifetime must not accidentally become the lifetime of the first view that reads them.

The inspiration is Solid's separation of component setup from tracked computations and its scoped cleanup. Compatibility with either React, Preact, or Solid is not a requirement. [Solid component lifecycle](https://docs.solidjs.com/concepts/components/basics) and [cleanup semantics](https://docs.solidjs.com/reference/lifecycle/on-cleanup) describe the relevant model.

## Proposed component API

The [PointEditor exhibit](../experiments/atom-jsx/water-api.proposal.exhibit.tsx) illustrates the proposed authoring experience. Its [API declarations](../experiments/atom-jsx/water-api.proposal.ts) make the example typecheck. These are design artifacts with no runtime implementation. The current automatic JSX transform would evaluate its reads once; it does not supply the proposed tracking behavior.

| API         | Proposed responsibility                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| useValue    | Capture a readable token and the owner's store; return a live accessor. Reads inside a render computation register dependencies.             |
| useSetter   | Capture a writable token and the owner's store; return an atom.io writer. Existing transaction APIs continue to handle multi-state commands. |
| useTimeline | Capture a timeline and the owner's store; return a live accessor for timeline metadata and undo, redo, and clear controls.                   |
| useId       | Allocate a stable instance ID suitable for DOM and accessibility relationships, with matching server and client identity.                    |
| useRef      | Publish an attached element into a nullable atom and release that attachment on disposal.                                                    |
| onCleanup   | Register cleanup for resources established during setup.                                                                                     |

These six names are agreed for water; signatures and detailed behavior remain proposals. There is no positional hook array or component rerender protocol implied by the use prefix. Setup helpers still require a live owner; asynchronous callbacks must capture their accessors and writers during setup rather than calling setup helpers later.

In PointEditor, one point atom contains both coordinates. Setup obtains a point accessor, a writer, an ID, and a ref callback. The compiler would preserve coordinate reads in SVG attributes and the output label as live expressions. The click handler performs one atomic point update. Neither the component nor its click handler is recreated by that update.

Accessor calls in ordinary setup code produce snapshots. Calls inside event handlers read current state without subscribing. Calls inside compiler-created render computations read current state and register dependencies. JavaScript field access on the returned point remains ordinary field access: the atom is the invalidation unit, and unchanged coordinate results can suppress DOM writes. Water does not promise property-level subscriptions to a single point atom.

Direct tokens in JSX and the current project helper remain possible conveniences. They are not the foundation of the proposed execution model. Shared derived values belong in atom.io selectors. View-local formatting can be an expression inside a tracked DOM computation.

useValue returns a callable accessor, not an eagerly captured value. useRef returns the atom-backed attachment callback, not a mutable current container. useTimeline follows the same accessor model as useValue. Its proposed initial value preserves the existing timeline metadata and controls; the final split between live metadata and stable command methods remains open. The HistoryControls component in the [API exhibit](../experiments/atom-jsx/water-api.proposal.exhibit.tsx) demonstrates live metadata and event-driven undo and redo. Timeline reads must track timeline notifications rather than treating timeline tokens as ordinary readable state tokens.

## Additional API candidates

useTransaction is the strongest additional candidate: capture a transaction token and the owner's store, then return a stable command preserving the transaction's parameters and result. This gives multi-state application commands the same store-scoped setup experience as useSetter, without a new transaction mechanism. It is a candidate, not part of the agreed six-function surface or the declaration exhibit.

onMount remains conditional on demonstrated need. A client-only callback after the component's DOM is attached would support work that depends on several sibling refs or subtree layout, where a single ref's attachment timing is insufficient. It would run once per instance, without dependency tracking or reactive reruns.

An untrack utility could permit a current-value read inside a render computation without registering a dependency. Its contract would preserve the owner and store while temporarily disabling dependency collection. It should be added only when a concrete use case needs that distinction; it is not a setup hook.

## The API atom.io controls

The proposed internal boundary is an owned DOM target with a write operation. A target can represent a text node, a DOM property, or a child range. Water creates and owns the target. A small integration layer evaluates its source, records the atom reads, and connects their invalidations to target writes. The RenderOwner, DomTarget, and connect declarations describe this protocol; connect is compiler-facing infrastructure rather than a public effects hook.

The [DOM target exhibit](../experiments/atom-jsx/water-targets.proposal.exhibit.ts) illustrates this lower-level interface for a circle's coordinates and its text label. The owner already controls those nodes; each connection only reads atom-backed state and writes its destination. This is a checked protocol sketch, not generated compiler output.

Each connection follows this contract:

1. Evaluate the source in a synchronous tracking scope associated with the owner's store.
2. Track the state or timeline sources actually used, including changes caused by conditional reads. Initialize lazy state and reconcile subscriptions without losing a write during setup.
3. Let atom.io settle state operations, then queue affected DOM computations. Coalesce repeated invalidations and reread current state before applying DOM changes.
4. Skip unchanged primitive results. Preserve invalidation semantics for mutable object snapshots; identity equality alone is insufficient.
5. Remove obsolete dependencies after a branch changes, cancel queued work on disposal, and release the connection with its owner.

This integration needs dependency collection for water accessors; ordinary getState calls do not gain tracking merely by appearing in JSX. The implementation may use explicit atom.io getter callbacks or a scoped read facility. That choice remains open. Dependencies must include store identity, and nested computations must restore the previous tracking scope.

The bridge may share one upstream atom subscription among several consumers within a root. Each DOM computation still owns its dependency edges and cleanup. Sharing should be justified by measured size and update cost; it is not necessary to establish the API's semantics. Component setup may establish reusable accessors without making the component itself a reactive computation.

Water must also define disposal on computation failure and ordering when a parent region removes a queued child. Adding a tiny API surface does not remove these runtime responsibilities. The current prototype already tests cancellation and cleanup, but does not establish the full proposed compiler or scheduling contract.

## Ownership and identity

useId should return a distinct, stable ID for each allocation within an instance. IDs must agree between server rendering and hydration and remain unique across independently hydrated Astro islands. Root configuration therefore includes an identity prefix, with the integration responsible for reproducing it on the client. A prefix alone does not solve deterministic allocation: differing traversal, conditional setup, and future async rendering need an explicit ID strategy. Generated IDs are for instance identity and DOM relationships, not substitutes for application list keys.

useRef should publish the node after attachment, when the relevant DOM is available, and clear it on detachment only if that attachment still owns the stored reference. The proposal should use an ownership guard robust to replacement, rather than assuming every null callback may clear the atom. Refs are client resources and are not part of serialized application state. Each simultaneously mounted instance needs its own ref atom or family member unless sharing has explicit semantics.

The existing React useAtomicRef supplies an interop precedent, not the complete water lifecycle contract. A separate onMount API is undecided; ref attachment may supply the timing needed for imperative DOM work. onCleanup remains useful independently of reactive effects.

## Vite and Astro

The preferred compiler direction is static DOM creation plus small live expressions. The compiler must preserve expression evaluation, reactive props, children ownership, and event-handler behavior; it cannot simply wrap every expression indiscriminately. Vite supplies the plugin and JSX transform environment. Development reloads must dispose old owners without leaking subscriptions. [Vite JSX support](https://vite.dev/guide/features).

The proposed renderer entrypoints are render, hydrate, and a separate server renderToString. Root configuration supplies the store and ID prefix explicitly. Server rendering reads a request-scoped store, retains no client subscriptions, and releases server-owned resources. Hydration must use matching initial state, IDs, and markup. State transport and initialization belong to the application and integration contract; the renderer should not serialize an entire store implicitly.

Astro integration must provide component detection, server rendering, slots and props handling, and a client entrypoint for interactive islands. Islands hydrate independently, so store sharing must be explicit. A client-only demonstration is useful but does not establish SSR or hydration support. [Astro renderer API](https://docs.astro.build/en/reference/renderer-reference/).

## Open decisions and evaluation

The proposal deliberately leaves these questions unresolved:

- Whether live component props use compiler-generated getters, and how accessors follow a changing token prop. The exhibit keeps token identity fixed per component instance.
- How keyed child ranges move without losing focus, local ownership, or refs. Keys must come from application identity, not useId or array position.
- Whether local atom creation needs an owned scope or family helper. Shared atom disposal must remain independent of DOM disposal.
- The smallest error and async rendering contract, including unresolved promises and hydration mismatches.
- The exact compiler versus runtime boundary, including whether ordinary JSX output is retained as a fallback.

Evaluate this API with a point editor, a conditional child that switches dependencies, and a keyed editable list. Check setup counts, node and focus preservation, atomic updates, store isolation, ref ownership, and cleanup. Add server/client round trips with multiple Astro islands before claiming hydration support. Compare emitted code and compressed client bundles against equivalent Preact and Solid examples, including atom.io consistently where it is part of the application.

The [existing experiment](jsx-experiment.md) remains a runnable baseline with direct token bindings and explicit projections. Its passing tests establish those behaviors, not the proposed accessor tracking, compiler, server renderer, or hydration APIs.

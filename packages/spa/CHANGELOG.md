# @atom.io/spa

## 0.0.4

### Patch Changes

- 00d0f4d: Rename `useValue` to `useGetter`. `useTimeline` now returns a stable `TimelineControls` object instead of an accessor returning `TimelineValue`: read metadata with `history.getCursor()` and `history.getLength()`, call `history.undo()`, `history.redo()`, and `history.clear()` directly, and retrieve captured transaction-group actions through `history.getTransaction().undo?.()` and `history.getTransaction().redo?.()`. These breaking API changes ship as a patch under the 0.0.x release policy.
- 72d951d: Update the SPA guide and executable examples for `useGetter`, direct timeline controls, and matching getter/setter bindings named after their atoms, such as `getPoint` and `setPoint` for `pointAtom`.

## 0.0.3

### Patch Changes

- b1aa735: Support declarative `motion:exit` across DOM, Konva, and Three.js with retained subtree ownership, nested exit coordination, keyed re-entry, reduced-motion completion, and suspended interaction and reactive work during exits. Keep renderer infrastructure running until animation completion and preserve immediate root disposal. Preserve numeric tween momentum on interrupted re-entry and repeated toggles with a braking and return curve. Add runnable motion examples under the SPA package with recorded visual traces and sequence exports, shared by a thin website host. Document exit semantics and update published bundle measurements for the small base lifecycle hooks; the retention coordinator remains behind the optional Motion entrypoint. Separate retained Three.js resource ownership from active Mesh attachment slots, and cancel pending and active Konva drags during logical removal, restoring draggable settings on re-entry.
- b7becbd: Let each selector own its root subscriptions and release them when its actual subscriber map becomes empty. Keep shared selectors active until their last consumer unsubscribes, and notify subscribers of readonly and writable held selectors when their source atoms change. Preserve dynamic dependency tracking and settled transaction notifications.

  SPA now requires atom.io ^0.54.4 for state subscription cleanup during Astro bootstrap.

  Refresh the generated browser bundle size reports after the selector notification fixes.

## 0.0.2

### Patch Changes

- 9565f6d: Replace Babel in the JSX compiler with Oxc's native parser and source-preserving transforms, retaining reactive props, lazy children, live spreads, and Astro component detection. Refresh the debugger bundle measurements for the new compiler output.
- 1f43188: Add optional Konva, Three.js, and Motion entrypoints to SPA, with root-scoped motion:* attributes for spring and tween animations, hover and tap states, shared scene ownership, and resource cleanup. Graphics and animation engines remain optional peers and are excluded from base application bundles. Three.js now supports raycast pointer events, bubbling, capture, click detection, and motion hover/tap bindings. Preserve borrowed Mesh resources and complete native transform baselines when motion bindings are removed.
- 9565f6d: Keep inactive motion gestures at their native rest values when initial is false, preserving numeric scalar and tuple targets when gestures activate and reset.

## 0.0.1

### Patch Changes

- 138c640: Add Astro support for .spa.tsx and .spa.jsx components, native hydration directives, named slots, and persisted island prop updates. Default islands share atom.io's implicit store in the browser and a separate store per SSR request. Untouched initial islands hydrate server markup; delayed islands after state changes and islands introduced by ClientRouter navigation render from live browser state without overwriting edits. Explicit isolation and custom store factories remain available.

  Await asynchronous createStore and prepareStore callbacks before rendering or mounting. Expose the browser host, cancellation, island cleanup, and an application context for shared initialization and resumption decisions. Shared resources survive individual island removal; request resources are released after streaming and browser application resources on final page exit.
- 138c640: Brand named function expressions through their external variable bindings so compiled modules import successfully. Preserve explicit boolean values for enumerated SSR attributes and serialize form defaults as effective input values, checkbox state, and textarea text, with controlled values taking precedence.
- 138c640: Resolve a lone JSX spread through the lazy props merger so self-closing elements and components retain attributes, event handlers, refs, keys, and forwarded props. Preserve reactive updates and keyed component identity during rendering and hydration.
- 138c640: Introduce @atom.io/spa, an atom.io-powered JSX renderer whose components run once per mounted instance. Compiled JSX accessor calls subscribe individual DOM computations. Provide useValue, useSetter, useLoadable, useTimeline, useTransaction, useRef, useId, useStore, onMount, and onCleanup, including family/key overloads for state and timeline helpers.

  Support keyed DOM reconciliation, server rendering, strict hydration, element-specific HTML and SVG attributes, nullable callback refs, and native events with typed currentTarget values. Custom tags use generic HTMLElement types. The Vite compiler keeps SPA and atom.io in one development dependency graph so renderer entrypoints, hooks, and stores share their context.

  Ship MPL-2.0-or-later licensing, tsdown builds, built-package consumer checks, and 100% source coverage gates. Enforce a 3,400-byte ordinary-gzip budget for the complete browser runtime with atom.io external as a peer; application serving-size reports include atom.io and count shared code once.

# @atom.io/spa-devtools

## 0.0.7

### Patch Changes

- 5bde2f5: Extend the optional Motion capability with motion:layout and motion:layoutId for HTML position/size projection and root- and group-scoped shared identities, with observed resizing, reduced motion, and deterministic cleanup. Use one motionCapability registration for animated properties, exits, and layout; layoutId enables projection implicitly. Coordinate measurement through generic capability update boundaries, document readiness-marker handoff and ownership, and refresh the base-runtime size budget and generated reports.

## 0.0.6

### Patch Changes

- 934e565: Add an optional Floating UI capability that positions HTML overlays with CSS translate and composes with Motion transforms on the same element, including automatic position updates and cleanup through retained exits. Reactive inline style changes preserve positioning and Motion values, and pending overlays stay hidden against author !important visibility rules until their first position resolves.

  Refresh the debugger's generated serving-size documentation for the updated SPA runtime.
- 48e8271: Preserve component and element defaults through nested prop spreads by reporting only properties present in a current source, while retaining lazy updates and explicit undefined overrides. Refresh the generated SPA and devtools browser bundle size reports.

## 0.0.5

### Patch Changes

- ffbb22d: Simplify the SPA setup examples to a single counter, present Astro before Vite, and show only the setup each framework requires. Remove unrelated lifecycle helpers, slots, initial props, and custom stores from the Astro counter, and keep the point example focused on reactive state. Use ordinary .tsx component filenames throughout the SPA exhibits, debugger setup, and Astro starter. The Astro integration now compiles .tsx and .jsx files by default; applications using multiple JSX renderers must use include to select their SPA component directories.
- 90f634c: Rework SPA documentation around the Astro starter, dedicated Astro and Vite guides, and focused rendering and hook examples. Move Astro request collection, streaming sidecar delivery, and ordinary browser harvesting into resumability so plain Astro constants and atom defaults use the same host without a special store bridge. Keep async JSX rendering and private-store lifetime binding in SPA, and attach seeds to each island’s HTML so shared cached reads hydrate in either order. Explain siloized islands with a focused example and document private-scope disposal on unmount, persisted islands, and shared page lifetimes. Remove the Resumption wrapper, deferred children, preparation callbacks, and preload lists from the starter and SPA guides while preserving explicit collection scopes and original producer errors. Use state.ts and a stock-counting workflow with persistent saves and conflict detection. Place “you don’t need useEffect” last in Patterns and refresh affected bundle measurements.
- 8b43951: Rename the public VNode type to SpaElement and Child to Children. Update type imports and annotations to the new names; JSX.Element aliases SpaElement, and Component returns Children. Children retains the same recursive union of renderable values, readonly arrays, and accessors, and SpaElement retains the same type and props fields. Update the documentation, examples, Astro starter, and SPA devtools; the devtools now require @atom.io/spa 0.0.5 or newer within the 0.0.x release line for these type exports.

## 0.0.4

### Patch Changes

- 72d951d: Adapt the debugger to SPA's `useGetter` and direct timeline controls, with atom-based getter/setter binding names. Require `@atom.io/spa >=0.0.4 <0.2.0`; earlier releases lack these hook APIs.

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

## 0.0.1

### Patch Changes

- 138c640: Introduce @atom.io/spa-devtools with the AtomIODevtools component and a separate CSS export. Inspect and edit state in the selected store, browse state and timeline families, review transaction logs, and control undo/redo. Preserve the compact row layout, light and dark themes, draggable panel, minimized control, and saved panel settings. Validate JSON edits before opening write operations and release inspector-owned state and subscriptions on cleanup.

  Ship MPL-2.0-or-later licensing, tsdown output with packaged CSS, built-package consumer checks, 100% source coverage gates, and application serving-size reports that include SPA and atom.io.

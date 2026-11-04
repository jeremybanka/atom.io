# @atom.io/spa-devtools

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

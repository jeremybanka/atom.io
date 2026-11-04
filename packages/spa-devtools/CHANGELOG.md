# @atom.io/spa-devtools

## 0.0.2

### Patch Changes

- 9565f6d: Replace Babel in the JSX compiler with Oxc's native parser and source-preserving transforms, retaining reactive props, lazy children, live spreads, and Astro component detection. Refresh the debugger bundle measurements for the new compiler output.
- 1f43188: Add optional Konva, Three.js, and Motion entrypoints to SPA, with root-scoped motion:* attributes for spring and tween animations, hover and tap states, shared scene ownership, and resource cleanup. Graphics and animation engines remain optional peers and are excluded from base application bundles. Three.js now supports raycast pointer events, bubbling, capture, click detection, and motion hover/tap bindings. Preserve borrowed Mesh resources and complete native transform baselines when motion bindings are removed.

## 0.0.1

### Patch Changes

- 138c640: Introduce @atom.io/spa-devtools with the AtomIODevtools component and a separate CSS export. Inspect and edit state in the selected store, browse state and timeline families, review transaction logs, and control undo/redo. Preserve the compact row layout, light and dark themes, draggable panel, minimized control, and saved panel settings. Validate JSON edits before opening write operations and release inspector-owned state and subscriptions on cleanup.

  Ship MPL-2.0-or-later licensing, tsdown output with packaged CSS, built-package consumer checks, 100% source coverage gates, and application serving-size reports that include SPA and atom.io.

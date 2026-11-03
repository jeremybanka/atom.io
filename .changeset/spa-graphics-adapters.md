---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
---

Add optional Konva, Three.js, and Motion entrypoints to SPA, with root-scoped motion:* attributes for spring and tween animations, hover and tap states, shared scene ownership, and resource cleanup. Graphics and animation engines remain optional peers and are excluded from base application bundles. Three.js now supports raycast pointer events, bubbling, capture, click detection, and motion hover/tap bindings. Preserve borrowed Mesh resources and complete native transform baselines when motion bindings are removed.

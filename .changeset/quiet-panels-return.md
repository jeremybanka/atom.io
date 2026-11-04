---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
---

Support declarative `motion:exit` across DOM, Konva, and Three.js with retained subtree ownership, nested exit coordination, keyed re-entry, reduced-motion completion, and suspended interaction and reactive work during exits. Keep renderer infrastructure running until animation completion and preserve immediate root disposal. Preserve numeric tween momentum on interrupted re-entry and repeated toggles with a braking and return curve. Add an adjustable motion sandbox with recorded visual traces and sequence exports. Document exit semantics and update published bundle measurements for the small base lifecycle hooks; the retention coordinator remains behind the optional Motion entrypoint.

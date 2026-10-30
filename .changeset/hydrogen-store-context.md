---
"@atom.io/spa": patch
"atom.io": patch
---

Finalize SPA's initial public API by replacing untrack with useStore, which returns the current root's atom.io store directly. Keep dependency suppression internal to the renderer and document store-aware reads and integration, with coverage for isolated roots, mount callbacks, SSR, hydration, and packed consumers.

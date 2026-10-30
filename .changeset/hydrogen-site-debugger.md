---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Port the atom.io debugger to spa with store-scoped JSON editing, state families, transaction logs, timeline controls, persistent panel settings, and lifecycle cleanup. Support persisted Astro island prop and slot updates, named slots, and ClientRouter hydration; distinguish explicit JSX keys from unkeyed positions and track interpolated JSX template literals. Document the spa debugger now used on atom.io.fyi.

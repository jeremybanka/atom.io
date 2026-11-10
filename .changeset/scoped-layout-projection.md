---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
"atom.io.fyi": patch
---

Extend the optional Motion capability with motion:layout and motion:layoutId for HTML position/size projection and root- and group-scoped shared identities, with observed resizing, reduced motion, and deterministic cleanup. Use one motionCapability registration for animated properties, exits, and layout; layoutId enables projection implicitly. Coordinate measurement through generic capability update boundaries, document readiness-marker handoff and ownership, and refresh the base-runtime size budget and generated reports.

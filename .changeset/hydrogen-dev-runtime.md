---
"@atom.io/hydrogen": patch
"atom.io": patch
---

Keep Hydrogen runtime entrypoints and atom.io in a shared Vite dependency graph so Astro development hydration and client navigation use the same lifecycle and store instances. Add browser regression coverage for development mounting and navigation.

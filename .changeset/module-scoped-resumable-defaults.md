---
"atom.io": patch
"@atom.io/spa": patch
"resumability": patch
"@atom.io/template-astro-spa-resumability": patch
---

Keep resumable atom definitions at module scope by evaluating defaults in an optional store initialization scope, including lazy family members and transaction resets. Add SPA Astro store preparation and scoped browser resumption, and update the Astro starter to use one Reylo-backed SQLite function for direct SSR reads and typed tRPC refreshes.

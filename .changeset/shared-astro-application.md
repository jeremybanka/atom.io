---
"@atom.io/spa": minor
"@atom.io/template-astro-spa-resumability": minor
"resumability": patch
"atom.io": patch
---

Share Astro island state across the browser application and within each SSR request. Untouched initial roots hydrate; delayed roots after state changes and roots introduced by navigation render fresh without overwriting live values. Keep application preparation resources alive across island removal, clean up request resources after streaming, and retain explicit island isolation. Allow resumability scopes to merge sidecars without reseeding consumed defaults and bypass unread seeds when client defaults should run. Update the SQLite/tRPC starter and documentation to demonstrate shared module-scoped atoms and preserved edits across navigation.

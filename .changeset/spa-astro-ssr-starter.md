---
"@atom.io/template-spa-astro-ssr": patch
---

Introduce a Node-hosted Astro starter using @atom.io/spa and resumability/astro with module-scoped atom families. SSR and typed tRPC resets call the same Reylo-backed node:sqlite query. Initial islands resume server values without an RPC request, delayed islands render live shared state after edits, and ClientRouter navigation preserves browser values.

Cache the public drafts page's HTML and resumption sidecar together in memory for 60 seconds, without stale-while-revalidate. The cache is process-local and disabled during development. Keep tRPC responses uncached with Cache-Control: no-store so explicit resets fetch current database values even when the page resumed an older snapshot. Production and development browser checks cover hydration, shared state, fresh resets, and production cache expiry.

Requires Node 24.12 or newer and TypeScript 7.1's content mappers, currently beta. Seed commands initialize the example database without overwriting existing edits; deployed SQLite files require persistent storage.

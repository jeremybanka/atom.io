---
"@atom.io/template-spa-astro-ssr": patch
---

Cache the public drafts page in memory for 60 seconds while keeping tRPC resets uncached. Document the process-local cache lifetime and verify cached snapshot hydration, fresh database resets, and TTL expiry in the production browser check.

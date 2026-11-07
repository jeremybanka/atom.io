---
"atom.io": patch
"resumability": patch
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"@atom.io/template-spa-astro-ssr": patch
---

Rework SPA documentation around the Astro starter, dedicated Astro and Vite guides, and focused rendering and hook examples. Automatically collect resumable defaults in request-owned scopes, await async state used by server views, and attach seeds to each island’s HTML so shared cached reads hydrate in either order. Remove the Resumption wrapper, deferred children, preparation callbacks, and preload lists from the starter and SPA guides while preserving explicit collection scopes and original producer errors. Use state.ts and a stock-counting workflow with persistent saves and conflict detection. Place “you don’t need useEffect” last in Patterns and refresh affected bundle measurements.

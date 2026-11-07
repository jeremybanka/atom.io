---
"atom.io": patch
"resumability": patch
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"@atom.io/template-spa-astro-ssr": patch
---

Rework SPA documentation around the Astro starter, dedicated Astro and Vite guides, and focused rendering and hook examples. Move Astro request collection, streaming sidecar delivery, and ordinary browser harvesting into resumability so plain Astro constants and atom defaults use the same host without a special store bridge. Keep async JSX rendering and private-store lifetime binding in SPA, and attach seeds to each island’s HTML so shared cached reads hydrate in either order. Remove the Resumption wrapper, deferred children, preparation callbacks, and preload lists from the starter and SPA guides while preserving explicit collection scopes and original producer errors. Use state.ts and a stock-counting workflow with persistent saves and conflict detection. Place “you don’t need useEffect” last in Patterns and refresh affected bundle measurements.

---
"atom.io": patch
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"@atom.io/template-spa-astro-ssr": patch
---

Rework SPA documentation around the Astro starter and focused rendering and hook examples, with dedicated Astro and Vite integration guides. Automatically connect Astro islands to resumability when both integrations are installed and await async state read by server views without component preparation callbacks or preload lists. Update the resumability guide and starter to use state.ts and a stock-counting workflow with persistent saves and conflict detection. Place “you don’t need useEffect” last in Patterns and refresh affected bundle measurements. Preserve original async producer failures during server rendering.

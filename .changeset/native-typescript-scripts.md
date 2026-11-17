---
"create-atom.io": patch
"@atom.io/template-spa-astro-ssr": patch
"atom.io.fyi": patch
---

Keep CLI entrypoint sources and browser checks in TypeScript, compile the published CLI executable into dist, and run template and site browser checks directly with Node. Align site checks with the shared debugger's two-row toolbar and light palette. Seed the Astro starter browser fixture when tests start, including when Turbo restores a cached build.

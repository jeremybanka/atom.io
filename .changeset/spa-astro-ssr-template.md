---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"resumability": patch
"@atom.io/template-spa-astro-ssr": patch
"create-atom.io": patch
"atom.io": patch
---

Remove Recoverage scripts and dependencies from the rendering packages while retaining their 100% coverage gates. Rename the Astro starter to @atom.io/template-spa-astro-ssr throughout the CLI, workspace, CI, and documentation. Document its current on-demand rendering and recommended cached SSR deployment policy, keeping HTML and resumption data together and explicit client refreshes fresh.

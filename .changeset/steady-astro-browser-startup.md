---
"@atom.io/template-spa-astro-ssr": patch
---

Warm the development server’s island dependencies before retaining SSR nodes in browser checks, so cold dependency-optimizer reloads cannot invalidate the identity assertions.

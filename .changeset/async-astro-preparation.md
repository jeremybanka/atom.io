---
"@atom.io/spa": patch
"resumability": patch
"@atom.io/template-astro-spa-resumability": patch
---

Support asynchronous Astro store factories with browser host context, cancellation, and cleanup. Coalesce pending island initialization, preserve live prop updates, and release resources on failure or navigation. Update the resumability template to native Astro hydration directives and emit sidecars before island markup so eager hydration can safely harvest them.

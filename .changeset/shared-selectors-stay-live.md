---
"atom.io": patch
"@atom.io/spa": minor
"@atom.io/spa-devtools": patch
"resumability": patch
---

Let each selector own its root subscriptions and release them when its actual subscriber map becomes empty. Keep shared selectors active until their last consumer unsubscribes, and notify subscribers of readonly and writable held selectors when their source atoms change. Preserve dynamic dependency tracking and settled transaction notifications.

SPA now requires atom.io ^0.54.4 for state subscription cleanup during Astro bootstrap.

Refresh the generated browser bundle size reports after the selector notification fixes.

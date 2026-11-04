---
"atom.io": patch
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"resumability": patch
---

Let each selector own its root subscriptions and release them when its actual subscriber map becomes empty. Keep shared selectors active until their last consumer unsubscribes, and notify subscribers of readonly and writable held selectors when their source atoms change. Preserve dynamic dependency tracking and settled transaction notifications.

Refresh the generated browser bundle size reports after the selector notification fixes.

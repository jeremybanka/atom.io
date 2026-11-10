---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Refresh component-only JSX modules during Vite development by remounting affected DOM and scene roots against their original atom.io stores, preserving persistent atoms, families, and timeline history across edits. Release old subscriptions, listeners, refs, and cleanup callbacks, recover failed hot setups without losing the store, and retain independent Astro island stores. Reload state definitions and unsafe module boundaries, preserve authored source maps, and omit hot registration from production application bundles.

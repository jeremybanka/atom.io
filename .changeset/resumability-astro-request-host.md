---
"resumability": patch
---

Make the Astro integration automatically collect resumable reads for each request, including native Astro frontmatter, and stream completed values to the browser in an inert JSON sidecar. Browser reads harvest those values without an explicit Resumption wrapper or manually supplied scope. Keep the default browser scope across ClientRouter navigation, importing new sidecars without reseeding consumed keys, bypassing unread seeds when a client producer can refresh the value, and retaining reusable server-only values. Dispose request collections when responses finish or requests abort, preserving producer and stream errors.

Add createCollection and currentCollection to resumability/server for custom collection lifetimes, detached snapshots of completed values, and rendering without draining unrelated pending work. Add resumability/astro-server and resumability/astro-client entrypoints with renderer adapters, request and browser scope access, and element seed capture. Renderer adapters can select private collections while respecting surrounding explicit scopes. Route browser imports through the Astro host while retaining the core client entrypoint and Resumption component for explicit scope ownership.

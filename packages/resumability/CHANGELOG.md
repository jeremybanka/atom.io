# resumability

## 0.0.2

### Patch Changes

- 8d36ec1: Make the Astro integration automatically collect resumable reads for each request, including native Astro frontmatter, and stream completed values to the browser in an inert JSON sidecar. Browser reads harvest those values without an explicit Resumption wrapper or manually supplied scope. Keep the default browser scope across ClientRouter navigation, importing new sidecars without reseeding consumed keys, bypassing unread seeds when a client producer can refresh the value, and retaining reusable server-only values. Dispose request collections when responses finish or requests abort, preserving producer and stream errors.

  Add createCollection and currentCollection to resumability/server for custom collection lifetimes, detached snapshots of completed values, and rendering without draining unrelated pending work. Add resumability/astro-server and resumability/astro-client entrypoints with renderer adapters, request and browser scope access, and element seed capture. Renderer adapters can select private collections while respecting surrounding explicit scopes. Route browser imports through the Astro host while retaining the core client entrypoint and Resumption component for explicit scope ownership.

## 0.0.1

### Patch Changes

- 138c640: Introduce resumability, a renderer-independent utility for carrying server-produced values into the browser. The default resumability/astro integration removes inline server producers and their imports from browser bundles. Resumption collects asynchronous values and emits a JSON sidecar before island markup; optional codecs support custom value representations.

  Browser resumption scopes harvest server values, run optional client producers on subsequent reads after consumption, and expose cancellation and cleanup. Scopes can merge sidecars without reseeding consumed values and bypass initial seeds when the application needs fresh client values. The package has no atom.io or SPA runtime dependency. Ship MPL-2.0-or-later licensing, tsdown builds, built-package consumer checks, and 100% source coverage gates.

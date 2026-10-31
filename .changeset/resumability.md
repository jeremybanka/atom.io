---
"resumability": patch
---

Introduce resumability, a renderer-independent utility for carrying server-produced values into the browser. The default resumability/astro integration removes inline server producers and their imports from browser bundles. Resumption collects asynchronous values and emits a JSON sidecar before island markup; optional codecs support custom value representations.

Browser resumption scopes harvest server values, run optional client producers on subsequent reads after consumption, and expose cancellation and cleanup. Scopes can merge sidecars without reseeding consumed values and bypass initial seeds when the application needs fresh client values. The package has no atom.io or SPA runtime dependency. Ship MPL-2.0-or-later licensing, tsdown builds, built-package consumer checks, and 100% source coverage gates.

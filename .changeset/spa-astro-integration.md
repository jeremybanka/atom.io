---
"@atom.io/spa": patch
---

Add Astro support for .spa.tsx and .spa.jsx components, native hydration directives, named slots, and persisted island prop updates. Default islands share atom.io's implicit store in the browser and a separate store per SSR request. Untouched initial islands hydrate server markup; delayed islands after state changes and islands introduced by ClientRouter navigation render from live browser state without overwriting edits. Explicit isolation and custom store factories remain available.

Await asynchronous createStore and prepareStore callbacks before rendering or mounting. Expose the browser host, cancellation, island cleanup, and an application context for shared initialization and resumption decisions. Shared resources survive individual island removal; request resources are released after streaming and browser application resources on final page exit.

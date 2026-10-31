# @atom.io/spa

## 0.0.1

### Patch Changes

- 138c640: Add Astro support for .spa.tsx and .spa.jsx components, native hydration directives, named slots, and persisted island prop updates. Default islands share atom.io's implicit store in the browser and a separate store per SSR request. Untouched initial islands hydrate server markup; delayed islands after state changes and islands introduced by ClientRouter navigation render from live browser state without overwriting edits. Explicit isolation and custom store factories remain available.

  Await asynchronous createStore and prepareStore callbacks before rendering or mounting. Expose the browser host, cancellation, island cleanup, and an application context for shared initialization and resumption decisions. Shared resources survive individual island removal; request resources are released after streaming and browser application resources on final page exit.
- 138c640: Brand named function expressions through their external variable bindings so compiled modules import successfully. Preserve explicit boolean values for enumerated SSR attributes and serialize form defaults as effective input values, checkbox state, and textarea text, with controlled values taking precedence.
- 138c640: Resolve a lone JSX spread through the lazy props merger so self-closing elements and components retain attributes, event handlers, refs, keys, and forwarded props. Preserve reactive updates and keyed component identity during rendering and hydration.
- 138c640: Introduce @atom.io/spa, an atom.io-powered JSX renderer whose components run once per mounted instance. Compiled JSX accessor calls subscribe individual DOM computations. Provide useValue, useSetter, useLoadable, useTimeline, useTransaction, useRef, useId, useStore, onMount, and onCleanup, including family/key overloads for state and timeline helpers.

  Support keyed DOM reconciliation, server rendering, strict hydration, element-specific HTML and SVG attributes, nullable callback refs, and native events with typed currentTarget values. Custom tags use generic HTMLElement types. The Vite compiler keeps SPA and atom.io in one development dependency graph so renderer entrypoints, hooks, and stores share their context.

  Ship MPL-2.0-or-later licensing, tsdown builds, built-package consumer checks, and 100% source coverage gates. Enforce a 3,400-byte ordinary-gzip budget for the complete browser runtime with atom.io external as a peer; application serving-size reports include atom.io and count shared code once.

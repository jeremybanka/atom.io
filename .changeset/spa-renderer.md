---
"@atom.io/spa": patch
---

Introduce @atom.io/spa, an atom.io-powered JSX renderer whose components run once per mounted instance. Compiled JSX accessor calls subscribe individual DOM computations. Provide useValue, useSetter, useLoadable, useTimeline, useTransaction, useRef, useId, useStore, onMount, and onCleanup, including family/key overloads for state and timeline helpers.

Support keyed DOM reconciliation, server rendering, strict hydration, element-specific HTML and SVG attributes, nullable callback refs, and native events with typed currentTarget values. Custom tags use generic HTMLElement types. The Vite compiler keeps SPA and atom.io in one development dependency graph so renderer entrypoints, hooks, and stores share their context.

Ship MPL-2.0-or-later licensing, tsdown builds, built-package consumer checks, and 100% source coverage gates. Enforce a 3,400-byte ordinary-gzip budget for the complete browser runtime with atom.io external as a peer; application serving-size reports include atom.io and count shared code once.

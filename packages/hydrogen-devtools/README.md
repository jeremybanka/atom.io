# Hydrogen devtools

An experimental atom.io debugger rendered with hydrogen. This private workspace package powers the debugger on atom.io.fyi. It is separate from hydrogen's renderer and size budget; it has no React, Preact, or Motion dependency.

Use hydrogen's Vite or Astro integration to compile application JSX. Import the stylesheet once, then mount the debugger in a hydrogen component:

```tsx
import "@atom.io/hydrogen-devtools/css"

import type { VNode } from "hydrogen"
import { AtomIODevtools } from "@atom.io/hydrogen-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}

```

The optional store prop selects the inspected store; it defaults to atom.io's implicit store. The debugger owns a rendering root in that store, so its parent island can use a different store. The store is fixed for an instance; use a different component key to inspect another store. Mounting is client-side, and Astro applications can use client:only with the hydrogen renderer hint.

The four views inspect atoms, selectors, transactions, and timelines. State families group their members and offer member disposal. JSON editors support primitive edits, object property renaming, adding and removing entries, array sorting, and conversion between JSON types. Readonly selectors remain readonly. Circular and non-JSON values receive safe textual representations. Failed edits appear in the panel.

Transaction logs show parameters, output, and nested events. Timeline views group families, show event history and the current position, and provide store-scoped undo and redo. Logs use atom.io's introspection states: transaction recording starts when its log is first inspected, and introspection definitions live with the store.

Ctrl+Shift+A shows or hides the debugger. The header supports pointer dragging, arrow-key nudging, minimization, and hiding. Visibility, minimization, selected view, and expanded editors persist in localStorage when available. Shift-click an expansion button to expand or collapse siblings. UI-owned state uses disposable atom family members; unmounting releases those members, DOM subscriptions, and keyboard/resize listeners.

This port shares atom.io's introspection engine with the React debugger. It does not expose React component customization contracts. The React package remains available for React applications.

## Package checks

Breakage exercises the packed package in isolated, locked peer environments, including the coordinated atom.io workspace candidate. Until the first published release, Breakage reports a first-release baseline; these checks establish compatibility with the declared peers rather than a previous hydrogen release. Coverage gates require 100% of statements, branches, functions, and lines across the package source.

Tonnage measures built public entrypoints with declared peers external. Its gzip figures use ordinary gzip; the optimized precompressed client budget is audited separately. CSS, declarations, and source maps are not included in JavaScript measurements.

## Bundle size

Package export sizes include complete runtime export surfaces.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Peer dependencies stay external, and shared modules are counted once per bundle.

| Import                    | Minified JS | Gzip JS |
| ------------------------- | ----------: | ------: |
| `@atom.io/hydrogen-devtools` |    15,324 B | 4,944 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

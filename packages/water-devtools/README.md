# Water devtools

An experimental atom.io debugger rendered with water. This private workspace package powers the debugger on atom.io.fyi. It is separate from water's renderer and size budget; it has no React, Preact, or Motion dependency.

Use water's Vite or Astro integration to compile application JSX. Import the stylesheet once, then mount the debugger in a water component:

```tsx
import "@atom.io/water-devtools/css"

import type { VNode } from "@atom.io/water"
import { AtomIODevtools } from "@atom.io/water-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}

```

The optional store prop selects the inspected store; it defaults to atom.io's implicit store. The debugger owns a rendering root in that store, so its parent island can use a different store. The store is fixed for an instance; use a different component key to inspect another store. Mounting is client-side, and Astro applications can use client:only with the water renderer hint.

The four views inspect atoms, selectors, transactions, and timelines. State families group their members and offer member disposal. JSON editors support primitive edits, object property renaming, adding and removing entries, array sorting, and conversion between JSON types. Readonly selectors remain readonly. Circular and non-JSON values receive safe textual representations. Failed edits appear in the panel.

Transaction logs show parameters, output, and nested events. Timeline views group families, show event history and the current position, and provide store-scoped undo and redo. Logs use atom.io's introspection states: transaction recording starts when its log is first inspected, and introspection definitions live with the store.

Ctrl+Shift+A shows or hides the debugger. The header supports pointer dragging, arrow-key nudging, minimization, and hiding. Visibility, minimization, selected view, and expanded editors persist in localStorage when available. Shift-click an expansion button to expand or collapse siblings. UI-owned state uses disposable atom family members; unmounting releases those members, DOM subscriptions, and keyboard/resize listeners.

This port shares atom.io's introspection engine with the React debugger. It does not expose React component customization contracts. The React package remains available for React applications.

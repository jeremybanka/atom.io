# SPA devtools

An experimental atom.io debugger rendered with spa. The @atom.io/spa-devtools package powers the debugger on atom.io.fyi. It is separate from spa's renderer and size budget. Its root entry requires no React, Preact, or Motion; React integration is available through an optional entry.

Use spa's Vite or Astro integration to compile application JSX. Import the stylesheet once, then mount the debugger in a spa component:

```tsx
import "@atom.io/spa-devtools/css"

import type { SpaElement } from "@atom.io/spa"
import { AtomIODevtools } from "@atom.io/spa-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): SpaElement {
	return <AtomIODevtools store={props.store} hideByDefault />
}

```

The optional store prop selects the inspected store; it defaults to atom.io's implicit store. The debugger owns a rendering root in that store, so its parent island can use a different store. The store is fixed for an instance; use a different component key to inspect another store. Mounting is client-side, and Astro applications can use client:only with the spa renderer hint.

## Browser hosts

Use mountAtomIODevtools with a host element and optional store and hideByDefault options. The options are captured at mount; dispose and mount again to change them. Each call owns a child of the host and preserves its existing children. Call the returned dispose method when removing the debugger; repeated disposal is safe.

```ts
import "@atom.io/spa-devtools/css"

import { mountAtomIODevtools } from "@atom.io/spa-devtools"

export function attachDebugger(host: HTMLElement): () => void {
	const panel = mountAtomIODevtools(host, { hideByDefault: true })
	return panel.dispose
}

```

## React

Install the optional @atom.io/react and React 18 or 19 peers, and import AtomIODevtools from @atom.io/spa-devtools/react. It renders the same SPA debugger inside a React-owned host; application JSX needs no SPA compiler. Import @atom.io/spa-devtools/css once.

```ts
import "@atom.io/spa-devtools/css"

import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import type { RootStore } from "atom.io/internal"
import type { ReactElement } from "react"
import { createElement } from "react"

export function Debugger({ store }: { store: RootStore }): ReactElement {
	return createElement(StoreProvider, {
		store,
		children: createElement(AtomIODevtools),
	})
}

```

The adapter reads StoreContext from @atom.io/react. An explicit store prop takes precedence over its provider; without either it uses the implicit store. Changing the selected store or hideByDefault disposes and remounts the panel. Persisted visibility takes precedence over hideByDefault. Effect cleanup supports StrictMode replay. Server import and render create no panel; mounting happens in a client effect.

The four views inspect atoms, selectors, transactions, and timelines. State families group their members and offer member disposal. JSON editors support primitive edits, object property renaming, adding and removing entries, array sorting, and conversion between JSON types. Readonly selectors remain readonly. Circular and non-JSON values receive safe textual representations. Failed edits appear in the panel.

Transaction logs show parameters, output, and nested events. Timeline views group families, show event history and the current position, and provide store-scoped undo and redo. Logs use atom.io's introspection states: transaction recording starts when its log is first inspected, and introspection definitions live with the store.

Ctrl+Shift+A shows or hides the debugger. Drag the header to move the window, or drag any edge or corner to resize it. During a drag, hover a layout target to preview its exact viewport bounds before releasing: left/right halves, left/center/right thirds, top/bottom halves, or full viewport. The Layout button offers the same targets by keyboard, plus Restore free position. Focus the move handle or a resize handle and use arrow keys for 10-pixel adjustments. Snapped windows start those adjustments from their visible bounds; arrows unrelated to a resize edge or blocked by the viewport leave the snap unchanged. Escape, pointer cancellation, or capture loss restores the pre-gesture geometry; hiding, minimizing, unmounting, or replacing the store cancels active work. The last free position and snap choice persist in localStorage when available, and geometry clamps to the current viewport, including narrow screens. Geometry updates leave focused editor inputs and incomplete numeric text intact. Visibility, minimization, selected view, and expanded editors persist in localStorage when available. Shift-click an expansion button to expand or collapse siblings. UI-owned state uses disposable atom family members; unmounting releases those members, DOM subscriptions, and keyboard/resize listeners.

For a shared debugger UI, React applications can migrate their AtomIODevtools and stylesheet imports to this package's React and CSS entries. The existing @atom.io/react-devtools package remains available, including its JSON editor, elastic input, error boundary and customization contracts; those contracts are not exposed by the shared debugger.

## Package checks

Tsdown builds the package JavaScript and declarations. SPA's compiler transforms the debugger JSX before bundling, preserving reactive bindings. The build copies the stylesheet and its declaration alongside the JavaScript; SPA and atom.io stay external peers.

Breakage exercises the packed package in isolated, locked peer environments, including the coordinated atom.io workspace candidate. Until the first published release, Breakage reports a first-release baseline; these checks establish compatibility with the declared peers rather than a previous spa release. Coverage gates require 100% of statements, branches, functions, and lines across the package source.

The serving recipe measures an interactive SPA app with the debugger: atom creation, render, useGetter, useSetter, JSX, and AtomIODevtools. The combined browser bundle includes atom.io, SPA, and the debugger, with shared modules counted once and unused exports removed. SPA and atom.io remain peer dependencies of the debugger package; these consumer-app measurements include both. The required debugger stylesheet is imported but its bytes are excluded from the JavaScript total, as are application components, declarations, and source maps.

## Browser serving size including SPA and atom.io

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Imported peer dependencies are bundled unless explicitly external, and shared modules are counted once per bundle.

| Recipe                        | Entry                         | Minified JS |  Gzip JS |
| ----------------------------- | ----------------------------- | ----------: | -------: |
| Interactive app with debugger | `tonnage-recipes/debugger.ts` |    99,935 B | 29,939 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

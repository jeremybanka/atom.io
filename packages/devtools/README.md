# atom.io devtools

The atom.io debugger for SPA, React, and browser hosts. The @atom.io/devtools package powers the debugger on atom.io.fyi. It is separate from spa's renderer and size budget. Its root entry requires no React or Preact. Motion and Three.js are package runtime dependencies; React integration is available through an optional entry. The header and minimized launcher use the shared BrandMark from @atom.io/spa/brand, also used by atom.io.fyi. Its slowly rotating dz² orbital renders through SPA's Three.js Canvas. Reduced motion keeps it still; hidden panels release the scene. The static mark remains available while graphics load or if WebGL is unavailable.

Use spa's Vite or Astro integration to compile application JSX. Import the stylesheet once, then mount the debugger in a spa component:

```tsx
import "@atom.io/devtools/css"

import { AtomIODevtools } from "@atom.io/devtools"
import type { SpaElement } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): SpaElement {
	return <AtomIODevtools store={props.store} hideByDefault />
}

```

The optional store prop selects the inspected store; it defaults to atom.io's implicit store. The debugger owns a rendering root in that store, so its parent island can use a different store. The store is fixed for an instance; use a different component key to inspect another store. Mounting is client-side, and Astro applications can use client:only with the spa renderer hint.

## Browser hosts

Use mountAtomIODevtools with a host element and optional store and hideByDefault options. The options are captured at mount; dispose and mount again to change them. Each call owns a child of the host and preserves its existing children. Call the returned dispose method when removing the debugger; repeated disposal is safe.

```ts
import "@atom.io/devtools/css"

import { mountAtomIODevtools } from "@atom.io/devtools"

export function attachDebugger(host: HTMLElement): () => void {
	const panel = mountAtomIODevtools(host, { hideByDefault: true })
	return panel.dispose
}

```

## React

Install the optional @atom.io/react and React 18 or 19 peers, and import AtomIODevtools from @atom.io/devtools/react. It renders the same SPA debugger inside a React-owned host; application JSX needs no SPA compiler. Import @atom.io/devtools/css once.

```ts
import "@atom.io/devtools/css"

import { AtomIODevtools } from "@atom.io/devtools/react"
import { StoreProvider } from "@atom.io/react"
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

Ecology is the first and default view. The other tabs inspect atoms, selectors, transactions, and timelines. State families group their members and offer member disposal. JSON editors support primitive edits, object property renaming, adding and removing entries, array sorting, and conversion between JSON types. Drag an array item by its handle or focus the handle and use Alt+Up or Alt+Down. Readonly selectors remain readonly. Circular and non-JSON values receive safe textual representations. Failed edits appear in the panel.

Transaction logs show parameters, output, and nested events. Timeline views group families, show event history and the current position, and provide store-scoped undo and redo. Logs use atom.io's introspection states: transaction recording starts when its log is first inspected, and introspection definitions live with the store.

Ctrl+Shift+A shows or hides the debugger. Drag the header to move the window, or drag any edge or corner to resize it. During a drag, hover a layout target to preview its exact viewport bounds before releasing: left/right halves, left/center/right thirds, top/bottom halves, or full viewport. The window-size button (□), between minimize and close, offers the same targets by keyboard, plus Restore free position. Focus the logo’s move control or a resize handle and use arrow keys for 10-pixel adjustments. Snapped windows start those adjustments from their visible bounds; arrows unrelated to a resize edge or blocked by the viewport leave the snap unchanged. Escape, pointer cancellation, or capture loss restores the pre-gesture geometry; hiding, minimizing, unmounting, or replacing the store cancels active work. The last free position and snap choice persist in localStorage when available, and geometry clamps to the current viewport, including narrow screens. Geometry updates leave focused editor inputs and incomplete numeric text intact. Visibility, minimization, selected view, and expanded editors persist in localStorage when available. Shift-click an expansion button to expand or collapse siblings. UI-owned state uses disposable atom family members; unmounting releases those members, DOM subscriptions, and keyboard/resize listeners.

Collapsed devtools show only the transparent 32px orbital logo, without panel chrome, noise or resize controls. Drag with a mouse or touch, or focus the logo and use arrow keys; its saved position is independent of the expanded window. Clicking, tapping or pressing Enter/Space restores the prior expanded layout. Dragging does not activate Open, and Escape or pointer cancellation restores the launcher’s previous position.

The @atom.io/spa-devtools and @atom.io/react-devtools packages are deprecated. Migrate by installing @atom.io/devtools and updating your imports as shown above. The old React package’s standalone JSON editor, elastic input, error boundary, and customization exports have no equivalents in the shared package.

The panel’s subtle noise texture is embedded in its stylesheet. The view tabs have a separate row so window controls remain reachable; use Left/Right arrows or Home/End while a tab is focused, or scroll the tab strip in constrained windows. Editors retain 21–22 px rows. Keys, smaller type labels and values use consistent columns; long keys retain their full title. Text, numeric and property-name inputs grow with their contents. Numeric values align right within a nearby value column, borrowing key space for longer numbers; unfinished decimal text remains editable until blur. Opaque read-only values, including errors, can be focused and scrolled horizontally by keyboard or touch to read the full text. Transaction outcomes are indented beneath their labeled transaction, with changes nested one level further.

## Surfaces and typography

The stylesheet includes its own light/dark palette and Theia 0.3 fonts. It follows prefers-color-scheme. The larger header logo replaces the separate grip while retaining pointer dragging and keyboard movement. The wordmark uses the site’s brand color. The shell and inactive tabs use explicit shades; active tabs flow into the content and search toolbars on the same normal surface, with no intervening border or shadow. Inactive tabs have a flat finish. Ecology search results use the first shade. Tint always means lighter and shade always means darker in both themes. The site's hard/soft aliases reverse with the theme; they are compatibility aliases, not drawer-depth numbers.

| Role                                     | Token or rule                                                |
| ---------------------------------------- | ------------------------------------------------------------ |
| Shell and title bar                      | --surface-shell, mapped to --bg-shade-2                      |
| Inactive tabs                            | --surface-inactive, mapped to --bg-shade-1                   |
| Active tabs, content and search toolbars | --surface-content, mapped to --bg-color                      |
| Ecology search results                   | --surface-search, mapped to --bg-shade-1                     |
| Text and subdued text                    | --ink and --ink-muted                                        |
| Keyboard focus and selection             | --accent, with contrasting selection ink                     |
| Errors                                   | --error-ink on --error-surface                               |
| Disabled controls                        | --ink-disabled, without reducing the whole control's opacity |

Drawer headers use the first, second and third shade as actual JSON nesting increases. At the third shade, deeper drawers keep that tone and use indentation/borders to communicate further nesting. This bounded three-tone policy keeps deep structures readable in both themes. Root editor rows remain 22 px and nested rows 21 px. Window gestures, numeric drafts and elastic input sizing retain their existing behavior.

The bundled Theia weights are 200 for lightweight headings, 400 for body/control text and 500 for emphasis. The private font-family name Atom IO Theia avoids accidentally resolving an ambient site installation. Font synthesis is disabled. The original files were authored by Jeremy Banka and are distributed under MPL-2.0; their source paths, hashes and preserved copyright notices are recorded in the packaged fonts/PROVENANCE.json and fonts/LICENSE beside the stylesheet. Font URLs are relative to the emitted CSS, so root and subpath hosting work without requests to atom.io.fyi. Serve the emitted fonts directory with the stylesheet; no system font or root-level site assets are required.

The debugger and storefront use component-owned Lasertag CSS Modules with one class export and named roots. SPA components render the complete debugger, including search results, the ecology graph and inspector, and the window layout palette. Controllers schedule capture and matching, handle gestures and restore focus after SPA commits. Global CSS contains the shared theme tokens, fonts and scoped resets. The emitted stylesheet needs no Lasertag runtime, CSS Modules loader or site build configuration.

## Ecology explorer

Import Ecology or mountEcology from @atom.io/devtools/ecology to embed the live graph, search, and editor inline in an application. Both take an explicit store and own a SPA rendering root in that store. Load @atom.io/devtools/css once. The explorer fills the host's height when specified and has a 360-pixel minimum height. Its search layout responds to the host's width. The SPA component captures the store on mount. Change its key to select a different store, or dispose and remount when using the DOM API.

```ts
import "@atom.io/devtools/css"

import { mountEcology } from "@atom.io/devtools/ecology"
import type { RootStore } from "atom.io/internal"

export function attachEcology(host: HTMLElement, store: RootStore): () => void {
	return mountEcology(host, { store }).dispose
}

```

The ecology tab captures the store on entry and updates as state and observed dependencies change. Affected cards briefly flash, including family cards for changes to their members. Reduced-motion preferences skip the flash. SPA’s Three.js Canvas places atoms and atom families on a descending helix around an invisible cylinder, with selectors ascending on a parallel helix 180° opposite at equal height. Cylinder proportions follow the canvas aspect ratio; resizing preserves orbit direction and relative zoom without recapturing application state. A subtle ground grid follows the camera perspective and fades into the distance below the nodes, against a near-black or off-white backdrop with the shared noise texture. Viewer-facing DOM cards show names, Atom/Selector categories and a short cached-value preview, or a grey en dash when uncached. Family cards show member counts. Painted cards show bounded custom toString output, array lengths, Map and Set sizes, and class names. Plain objects keep their shallow marker. Graph captures use shallow previews. Pending Futures show a springy loader with a one-second minimum cycle, a brief windback when their fate changes, and a one-second completion badge. Caught errors play an explosion as striped bands close in from the top and bottom of the card. The bands settle quickly and stay visible after the animation. Reduced-motion preferences keep the indicators still.

A digest of each family or singleton key supplies its border and outgoing arrows with a stable color, exposed through the card’s --ecology-color CSS variable and inherited by its SVG arrows. Members inherit their family’s color. Atom hues use the warm half of the spectrum (270° through red to 90°); selector hues use the cool half (90° through blue to 270°). Saturation is 75%, with lightness balanced for both themes. Dashed cards identify families, including empty definitions. Clustered members have small, stable offsets around their family’s center, with individual cards hidden. Separate curved arrows form connection bands with a darker core and lighter fringe. Expansion spreads members along the cylinder’s tangent, joined by a faint, arrowless line in the family’s color. Member cards show their subkey under a smaller colored family key, while retaining cached previews and full keys in accessible names and tooltips. Expanding and collapsing a family springs its member cards between their cluster and tangent positions while fading them in or out; arrows follow the moving endpoints. Reversing a transition keeps the same cards and spring progress. Exiting cards are inert. Reduced-motion preferences skip the movement and fading.

One Ecology editor replaces the separate node list, selection inspector and live-editor pane. It sits beside the graph in wide windows and below it at debugger widths of 650 px or less, with a 40% height limit so the graph remains visible. Tapping a card selects it without changing the mobile layout or moving focus into the editor. The selected node or family anchors the section with a strong outline. Selecting a family selects all its captured members; expanded members stay with the family in the selected section, followed by related nodes with a small separation, then other nodes; without selection, all admitted rows belong to Nodes. Rows have matching colored left borders. Hovering a card or any control in its editor row highlights both representations, including family headers and members. The hovered card temporarily comes forward and becomes fully opaque, while selection and keyboard focus remain independent. Leaving the item or cancelling the pointer clears the treatment; touch input does not retain a hover. Stable motion:layoutId identities and a position spring animate rows between sections without remounting their editors; scroll offsets are accounted for, and reduced-motion preferences skip layout animation. Family disclosures coordinate editor members and graph expansion. Cached rows reuse the nested JSON editors from the atoms and selectors views, preserving readonly behavior. Uncached rows show Generate instead of editor controls. Generate explicitly reads or evaluates that state. Failures appear in the debugger error area. Cards and editor rows update from the cache when the application evaluates a default or selector, writes a value, or resolves an async value. Observing these updates leaves dormant state untouched. Expanding object properties and editing values are explicit interactions. The editor initially admits 50 rows, with Show more nodes admitting another 50 up to 500; search covers the captured metadata, including rows beyond that display limit.

Selection emphasizes captured paths upstream and downstream without following side branches. Arrows follow 3D curves projected into SVG inside their source card’s layer: foreground sources draw over background cards, while higher cards cover their arrows. Active edges retain source colors with higher opacity. Active cards and their outgoing arrows stack above unrelated cards, with selected cards foremost; unrelated cards fade to 50%. Escape clears selection outside editor controls. Enter toggles clustering and expansion for selected families or members from their card, editor name button or focused graph. The selected member remains reachable in the editor while its family card represents it on the clustered canvas. Retained observations can be stale, incomplete or truncated.

Search filters editor rows directly. On the canvas, nonmatching cards remain at their positions with a smaller, lower-opacity treatment, preserving their colors, borders and node shapes. Matching records take precedence within the 500-card paint cap; the graph retains up to 1,000 directed arrows. Ranked member navigation expands its family and focuses the camera and editor row. Unfinished edits keep their mounted input, numeric draft and caret through selection, filtering, resizing and Refresh; an edited row outside the filter is explicitly marked until the draft ends. The wide toolbar keeps search inline; compact windows use a search modal with an applied-filter dot. Dismissal retains the query, and native dialogs keep their background inert. The info button opens a dismissible, scrollable guide with navigation instructions, capture details and the legend.

Standard OrbitControls provide left-drag orbit, right-drag pan, wheel zoom, one-finger orbit and two-finger pan/pinch zoom. Focus the graph for arrow-key panning or +/− zoom. Fit shows the painted graph; Reset view restores initial framing. Cards can overlap in projection; orbit, zoom, search and editor name buttons remain available. Module/WebGL failures leave the editor, search and Generate available. Selection, expansion and the camera survive navigation. Value-only updates preserve positions, while topology changes recompute the evenly spaced helices. Refresh recaptures the graph on demand. There is no graph polling or automatic application read. Hidden, minimized and unmounted views cancel pending work.

Ecology Sandbox opens the untouched pantry storefront directly to ecology for development, with no scripted application actions, searches or selections. Storefront and the scenario stories exercise the same isolated order-fulfillment model: stock, cart quantities, line totals, fulfillment fees, coupons, undo/redo and local quote outcomes. The storefront is the page itself. Ctrl+Shift+A shows or hides its floating debugger. The story starts with six cart lines; Reset creates a fresh store. There are no checkout services or network calls, and passive graph/search navigation leaves dormant promotion, lazy audit and empty wishlist untouched.

## Ecology snapshots

captureEcologySnapshot provides a data-only foundation for an ecology explorer; it adds no graphical view. It inspects the supplied root store's committed maps without following an active transaction child. Capture never calls state getters, initializes defaults or family members, attaches introspection subscriptions, or awaits promises. It returns detached metadata with store-local keys, token kinds, family keys and serialized subkeys, cached runtime types, and retained directed dependency edges. Values and live tokens are omitted.

```ts
import {
	captureEcologySnapshot,
	type EcologyRootTrace,
	type EcologySnapshot,
	traceEcologyRoots,
} from "@atom.io/devtools"
import type { Silo } from "atom.io"

export function inspectEcology(
	store: Silo[`store`],
	selectorKey: string,
): { snapshot: EcologySnapshot; trace: EcologyRootTrace } {
	const snapshot = captureEcologySnapshot(store, {
		// Application-node allowance; reserved debugger records use the bounded inspection headroom.
		maxNodes: 1_000,
		maxFamilies: 1_000,
		maxRelations: 5_000,
	})
	const trace = traceEcologyRoots(snapshot, selectorKey, { maxWork: 50_000 })
	return { snapshot, trace }
}

```

A cached value has status cached and a bounded, shallow preview string, including a cached undefined; an absent cache has status unknown. Runtime type inference is deliberately shallow: typeof, null and array, with unknown for an uninspectable revoked proxy. Objects, class instances and asynchronous wrappers remain object; their prototypes, properties and resolved values are not inspected. These are runtime observations, not declared TypeScript types.

Selector dependencies are unknown when neither a cached result nor inbound observations exist. An evaluated constant can have observed dependencies with zero edges. Observed edges describe only the runtime graph's retained observations: they can be partial after a failed or asynchronous evaluation, or belong to a previous branch after invalidation. They are not a static dependency declaration or a promise about the next evaluation. Reserved introspection nodes and families are excluded, but dependency edges to missing or excluded nodes retain their keys so root tracing reports uncertainty. Family member counts cover registered, instantiated members, including empty registered families; a token obtained with findState alone need not instantiate a member.

Capture defaults to returning at most 1,000 application nodes, inspecting 1,000 family records and inspecting 5,000 neighboring graph relations. The node allowance excludes reserved debugger records. Total state inspections remain bounded at the node allowance plus 1,000 records; a zero node allowance performs no state inspections. The extra headroom covers excluded records and a possible omitted-node probe. Bounded tail inspection distinguishes a filtered-only tail from an application node beyond the allowance. The reported work.nodes counts actual inspections, so it can exceed the application-node allowance. Node, family and relation options accept nonnegative integers up to ceilings of 10,000, 10,000 and 50,000 respectively. Family inspections still charge excluded records; relation inspections still charge reverse-direction and excluded neighbors. Results expose actual inspection counts, truncation flags and per-selector dependency truncation; node truncation means an application node was omitted or the finite inspection bound left records unknown. Family counts are lower bounds when state capture truncates. Iteration follows store insertion order, so a truncated snapshot is a bounded prefix rather than a ranked sample. No sorting or recursive value traversal runs during capture.

traceEcologyRoots follows the captured edges iteratively, deduplicates shared roots, and reports unresolved keys and cycle back-edge destinations. Its default 50,000 work units include snapshot indexing and traversal, with a configurable ceiling of 1,000,000. Status observed means the retained graph traversal finished; incomplete means some visited dependency is unknown, missing or truncated; truncated means the trace budget ran out. None of these statuses establishes complete static dependencies. Capture again after application activity to obtain new observations; snapshots are not subscriptions.

## Package checks

Tsdown builds the package JavaScript and declarations. SPA's compiler transforms the debugger JSX before bundling, preserving reactive bindings. The build bundles the component styles into the existing CSS entry and copies its declaration and the three licensed font assets alongside the JavaScript; SPA and atom.io stay external peers.

Breakage exercises the packed package in isolated, locked peer environments, including the coordinated atom.io workspace candidate. Until the first published release, Breakage reports a first-release baseline; these checks establish compatibility with the declared peers rather than a previous spa release. Coverage gates require 100% of statements, branches, functions, and lines across the package source.

The serving recipe measures an interactive SPA app with the debugger: atom creation, render, useGetter, useSetter, JSX, and AtomIODevtools. The combined browser bundle includes atom.io, SPA, and the debugger, with shared modules counted once and unused exports removed. The logo loads Three.js when the debugger becomes visible; ecology loads its graph and controls on entry. Data-only imports do not initialize either scene. The measurements below include that deferred graphics code. SPA and atom.io remain peer dependencies of the debugger package; these consumer-app measurements include both. The required debugger stylesheet is imported but its bytes and the bundled fonts are excluded from the JavaScript total, as are application components, declarations, and source maps.

## Browser serving size including SPA and atom.io

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Imported peer dependencies are bundled unless explicitly external, and shared modules are counted once per bundle.

| Recipe                        | Entry                         | Minified JS |   Gzip JS |
| ----------------------------- | ----------------------------- | ----------: | --------: |
| Interactive app with debugger | `tonnage-recipes/debugger.ts` |   971,790 B | 289,242 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

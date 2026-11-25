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

## Exclude devtools from production browser builds

In Vite and Astro, put dynamic imports for both the devtools code and stylesheet behind import.meta.env.DEV. Call the helper from your browser entry with a stable host element and dispose the returned handle when removing the panel. Standard production builds replace the development flag with false and can drop both imports and their assets. [Vite build-time flags](https://vite.dev/guide/env-and-mode.html#built-in-constants) · [Astro environment variables](https://docs.astro.build/en/guides/environment-variables/#vites-built-in-support)

```ts
import type {
	AtomIODevtoolsHandle,
	AtomIODevtoolsProps,
} from "@atom.io/devtools"

export async function mountDevelopmentDevtools(
	host: Element,
	options?: AtomIODevtoolsProps,
): Promise<AtomIODevtoolsHandle | undefined> {
	if (import.meta.env.DEV) {
		const [{ mountAtomIODevtools }] = await Promise.all([
			import(`@atom.io/devtools`),
			import(`@atom.io/devtools/css`),
		])
		return mountAtomIODevtools(host, options)
	}
}

```

Keep all devtools-only imports in that branch or in a module dynamically imported from it. That includes the React adapter, dedicated debugging workers, and any styles or assets they use. Type-only imports are erased. A runtime visibility setting leaves the code available in the shipped bundle, and an unconditional dynamic import still emits a separate chunk. With another bundler, use its equivalent compile-time development flag and check the production output for devtools chunks, styles, and assets.

For React, see [Development-only React mounting](#development-only-react-mounting).

For remote stores, gate the owner separately. Excluding the browser UI and its connection code leaves server-side exposure policy in the store owner's hands.

## Local and remote stores

Supply stores to the SPA or React component or to mountAtomIODevtools. Each target has a unique ID and a label. Local targets take a RootStore in the current process. Remote targets take a function that opens a fresh MessagePort or DevtoolsPanelTransport. The panel mounts every supplied target and initially shows the first. The store picker beside the window controls groups targets under Local and Remote. Its button shows the current store and a caret, collapsing to just the caret when the window is narrow. Switching preserves each target's selected view and keeps its connection live. Disposing the panel closes its remote connections. When stores is omitted, the existing single-store setup applies.

A local target stays in-process. Gate the panel mount with your app's development setting if you want the local debugger available only during development.

```ts
import { mountAtomIODevtools } from "@atom.io/devtools"
import { Silo } from "atom.io"

const worker = new Worker(new URL(`./worker.js`, import.meta.url), {
	type: `module`,
})
const local = new Silo({
	name: `Page`,
	lifespan: `ephemeral`,
	isProduction: true,
})
local.atom<string>({ key: `location`, default: `Main thread` })
const panel = mountAtomIODevtools(document.querySelector(`#devtools`)!, {
	stores: [
		{
			id: `worker`,
			label: `Counter worker`,
			kind: `remote`,
			connect() {
				const { port1, port2 } = new MessageChannel()
				worker.postMessage({ type: `connect`, port: port2 }, [port2])
				return port1
			},
		},
		{ id: `page`, label: `Page store`, kind: `local`, store: local.store },
	],
})

const output = document.querySelector<HTMLOutputElement>(`#worker-values`)!
worker.addEventListener(
	`message`,
	({ data }: MessageEvent<{ count: number; doubled: number }>) => {
		output.value = `Count: ` + data.count + ` · Doubled: ` + data.doubled
	},
)
document.querySelector(`#increment`)!.addEventListener(`click`, () => {
	worker.postMessage({ type: `increment` })
})
worker.addEventListener(`error`, panel.dispose, { once: true })
window.addEventListener(
	`pagehide`,
	() => {
		panel.dispose()
		worker.terminate()
	},
	{ once: true },
)

```

## Web Worker stores

The worker entry adapts a dedicated MessagePort. The example enables control explicitly for an isolated demo Silo containing sample data. The worker executes edits, selector generation, family member disposal, and timeline undo and redo. Transactions retain up to 200 outcomes per transaction recorded since the connection opened. State values are transferred when structured-cloneable, and editable values must be JSON data. Full-store Ecology snapshots and updates include transaction, timeline, and timeline family metadata. The operation records are optional in protocol version 1 so either endpoint can still read frames from older versions.

Each connection starts with a full snapshot of the exposed store. Later messages carry changed state entries, history updates, and changed Ecology records. Ecology updates inspect the affected state, family, and dependency records. When the graph reaches its capture limits, the debugger uses a bounded recapture to establish which records are in view. Opening a state tab batches the visible rows' generation and watch requests.

```ts
import { exposeDevtoolsStore } from "@atom.io/devtools/worker"
import { Silo } from "atom.io"

const silo = new Silo({
	name: `Counter worker`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const countAtom = silo.atom<number>({ key: `count`, default: 2 })
const doubledSelector = silo.selector<number>({
	key: `doubled`,
	get: ({ get }) => 2 * get(countAtom),
})
silo.timeline({ key: `count`, scope: [countAtom] })
const incrementTransaction = silo.transaction<() => void>({
	key: `increment`,
	do: ({ set }) => {
		set(countAtom, (value) => value + 1)
	},
})

type AppMessage = { type: `connect`; port: MessagePort } | { type: `increment` }
const worker = globalThis as unknown as Pick<
	Worker,
	`addEventListener` | `postMessage`
>
const report = () => {
	worker.postMessage({
		count: silo.getState(countAtom),
		doubled: silo.getState(doubledSelector),
	})
}
silo.subscribe(countAtom, () => {
	queueMicrotask(report)
})

worker.addEventListener(`message`, ({ data }: MessageEvent<AppMessage>) => {
	if (data.type === `connect`) {
		exposeDevtoolsStore(data.port, silo, { access: `control` })
		report()
	} else {
		silo.runTransaction(incrementTransaction)()
	}
})

```

Dispose the panel before terminating a worker you own, and dispose it on a worker error. Some browsers do not dispatch a MessagePort close event when the worker exits abruptly. Disposing the panel closes its connection and releases its local listeners.

From the repository root, start the demo and open the printed URL. The store picker switches between the page and worker. Increment in worker runs a worker transaction, and the Selectors tab shows the derived value. Edit count in the Atoms tab and press Enter to send it back. The Timelines tab can undo that edit, and Ecology shows the observed edge from count to doubled.

```sh
pnpm exec turbo run demo:worker --filter=@atom.io/devtools

```

## Custom transports and hosted stores

The remote bridge uses history and topology APIs from atom.io/introspection. Use atom.io 0.54.14 or later in the 0.54 series. The snapshot and update protocol belongs to this devtools package.

Import the owner-side exposeDevtoolsStore from @atom.io/devtools/remote in Node, a Cloudflare Worker, or another store host. This entry has no browser UI dependency. Pass a DevtoolsStoreTransport on the owner and return a DevtoolsPanelTransport from the matching panel target's connect function. The transports send typed frames, install a listener, report disconnects, and close the connection with its listeners. Network adapters should validate frame shapes and cap their sizes before delivery. Deliver decoded frames reliably and in order in later tasks, after pending microtasks. Updates are numbered starting at one. The panel closes the connection if it detects a gap or receives an update before the initial snapshot. A new connection receives its own initial snapshot. The initial snapshot carries the protocol version. The panel closes an incompatible connection before displaying store data. A transport that uses JSON needs a codec for any snapshot values it intends to preserve beyond JSON, such as errors, dates, maps, and undefined. MessagePort uses structured clone directly.

The store owner chooses the access policy for each connection.

| Access           | Store owner behavior                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off, the default | Sends a close frame and closes the connection without reading or publishing the store.                                                                                                  |
| Inspect          | Publishes cached values and retained history. Rejects commands that write state, evaluate selectors, dispose of family members, or move a timeline. The panel displays Inspection only. |
| Control          | Grants inspection and the supported debugger operations. State edits and time travel are checked against the owner's revisions.                                                         |

Either enabled mode also requires productionAccess set to that exact mode when the Silo is configured as production or Node reports a production environment. Pairing a request for control with a production inspection grant closes the connection. A development-only Node host can skip creating the transport entirely outside development.

```ts
import {
	type DevtoolsStoreTransport,
	exposeDevtoolsStore,
} from "@atom.io/devtools/remote"
import type { Silo } from "atom.io"

/** Called with a transport factory for an already authorized development session. */
export function attachDevelopmentDevtools(
	silo: Silo,
	connect: () => DevtoolsStoreTransport,
): (() => void) | undefined {
	if (process.env[`NODE_ENV`] !== `development`) return
	return exposeDevtoolsStore(connect(), silo, { access: `control` })
}

```

On Cloudflare Workers, use a deployment binding to classify the Silo as production and decide whether to create debug connections. Wrangler can substitute NODE\_ENV at build time, so use a runtime binding for an environment-specific access decision. [Cloudflare Workers environment documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/#processenv)

Keep the debug route and panel connection out of production by default. For intentionally hosted access, authenticate the operator and authorize that operator for the specific Silo before attaching the transport. Resolve the Silo and access settings on the owner from trusted session and deployment data. Use a private diagnostic or per-tenant Silo and prefer inspection with a states allowlist of standalone primitive atoms and selectors. The allowlist omits other state, history, and the dependency graph. Editable allowlisted atoms in control mode also require a validator. Whole-store inspection can reveal sensitive data in cached values, transaction parameters and results, and history. The host owns authentication, authorization, encryption, and session expiry. Call the returned disposer when the operator loses access or the session expires.

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

The adapter reads StoreContext from @atom.io/react. An explicit store prop takes precedence over its provider. Without either it uses the implicit store. Changing the inspected store, the configured targets, or hideByDefault disposes and remounts the panel. Recreating an equivalent stores array preserves the mounted panel and its selection, including when a remote target supplies an inline connect function. The adapter compares remote targets by ID and label. Change the target ID when switching to a different endpoint, and open a fresh connection whenever connect is called. Persisted visibility takes precedence over hideByDefault. Effect cleanup supports StrictMode replay. The panel mounts in a client effect after server rendering.

Ecology is the first and default view. The other tabs inspect atoms, selectors, transactions, and timelines. State families group their members and offer member disposal. JSON editors support primitive edits, object property renaming, adding and removing entries, array sorting, and conversion between JSON types. Drag an array item by its handle or focus the handle and use Alt+Up or Alt+Down. Readonly selectors remain readonly. Circular and non-JSON values receive safe textual representations. Failed edits appear in the panel.

Transaction logs show parameters, output, and nested events. Timeline views group families, show event history and the current position, and provide store-scoped undo and redo. Logs use atom.io's introspection states: transaction recording starts when its log is first inspected, and introspection definitions live with the store.

Ctrl+Shift+A shows or hides the debugger. Drag the header to move the window, or drag any edge or corner to resize it. During a drag, hover a miniature layout in the snap palette to preview its exact bounds before releasing. The palette offers left and right halves, top and bottom halves, left, center, and right thirds, left and right two-thirds, and full viewport. Slide along the bottom edge to preview thirds and two-thirds. The window-size button (□), between minimize and close, opens the palette for keyboard use, including Restore free position. Focus the logo’s move control or a resize handle and use arrow keys for 10-pixel adjustments. Snapped windows start those adjustments from their visible bounds; arrows unrelated to a resize edge or blocked by the viewport leave the snap unchanged. Escape, pointer cancellation, or capture loss restores the pre-gesture geometry; hiding, minimizing, unmounting, or replacing the store cancels active work. The last free position and snap choice persist in localStorage when available, and geometry clamps to the current viewport, including narrow screens. Geometry updates leave focused editor inputs and incomplete numeric text intact. Visibility, minimization, selected view, and expanded editors persist in localStorage when available. Shift-click an expansion button to expand or collapse siblings. UI-owned state uses disposable atom family members; unmounting releases those members, DOM subscriptions, and keyboard/resize listeners.

Collapsed devtools show only the transparent 32px orbital logo, without panel chrome, noise or resize controls. Drag with a mouse or touch, or focus the logo and use arrow keys; its saved position is independent of the expanded window. Clicking, tapping or pressing Enter/Space restores the prior expanded layout. Dragging does not activate Open, and Escape or pointer cancellation restores the launcher’s previous position.

The @atom.io/spa-devtools and @atom.io/react-devtools packages are deprecated. Migrate by installing @atom.io/devtools and updating your imports as shown above. The old React package’s standalone JSON editor, elastic input, error boundary, and customization exports have no equivalents in the shared package.

The panel’s subtle noise texture is embedded in its stylesheet. The view tabs have a separate row so window controls remain reachable; use Left/Right arrows or Home/End while a tab is focused, or scroll the tab strip in constrained windows. Editors retain 21–22 px rows. Keys, smaller type labels and values use consistent columns; long keys retain their full title. Text, numeric and property-name inputs grow with their contents. Numeric values align right within a nearby value column, borrowing key space for longer numbers; unfinished decimal text remains editable until blur. Opaque read-only values, including errors, can be focused and scrolled horizontally by keyboard or touch to read the full text. Transaction outcomes are indented beneath their labeled transaction, with changes nested one level further.

### Development-only React mounting

For Vite or Astro, save the adapter and its stylesheet together in development-react-panel.ts.

```ts
import "@atom.io/devtools/css"

export { AtomIODevtools as default } from "@atom.io/devtools/react"

```

In a neighboring development-react.tsx file, guard the lazy import with import.meta.env.DEV. Render DevelopmentDevtools inside your app's StoreProvider. The production build can remove the lazy import along with the adapter and stylesheet. [React lazy loading](https://react.dev/reference/react/lazy)

```tsx
/** @jsxImportSource react */
import { lazy, type ReactElement, Suspense } from "react"

const DevtoolsPanel = import.meta.env.DEV
	? lazy(() => import(`./development-react-panel.ts`))
	: null

export function DevelopmentDevtools(): ReactElement | null {
	if (!DevtoolsPanel) return null
	return (
		<Suspense fallback={null}>
			<DevtoolsPanel />
		</Suspense>
	)
}

```

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

Transactions, timelines, and timeline families appear on a third helix. They have color-matched icons and can be searched by name or primitive type in local and remote Ecology. Timelines show their current cursor and retained step count. Timeline families include empty definitions and expand to show instantiated members.

Expand a transaction or timeline in the Ecology editor to inspect the same outcomes and events shown in the Transactions and Timelines tabs. Transaction history retains up to 200 outcomes per transaction from when the local debugger or standalone explorer mounts, or from when a remote connection opens. Timeline histories show the current cursor and offer undo and redo. Remote inspection mode disables those controls.

Dashed lines link transactions to atoms they changed in committed runs, including writes from nested transactions. Dotted lines link timelines and timeline families to their registered scopes. Solid arrows show selector dependencies. Selecting either end of a dashed or dotted line highlights the relationship and puts the other end in the related nodes section.

A digest of each family or singleton key supplies its border and outgoing arrows with a stable color, exposed through the card’s --ecology-color CSS variable and inherited by its SVG arrows. Members inherit their family’s color. Atom hues range from warm yellow to red (50° to 0°), selectors from cyan through blue to indigo (182° to 252°), transactions from turquoise through green to lime (169° to 68°), and timelines from magenta to violet (315° to 265°). Saturation is 75%, with lightness balanced for both themes. Dashed cards identify families, including empty definitions. Clustered members have small, stable offsets around their family’s center, with individual cards hidden. Separate curved arrows form connection bands with a darker core and lighter fringe. Expansion spreads members along the cylinder’s tangent, joined by a faint, arrowless line in the family’s color. Member cards show their subkey under a smaller colored family key, while retaining cached previews and full keys in accessible names and tooltips. Expanding and collapsing a family springs its member cards between their cluster and tangent positions while fading them in or out; arrows follow the moving endpoints. Reversing a transition keeps the same cards and spring progress. Exiting cards are inert. Reduced-motion preferences skip the movement and fading.

One Ecology editor replaces the separate node list, selection inspector and live-editor pane. It sits beside the graph in wide windows and below it at debugger widths of 650 px or less, with a 40% height limit so the graph remains visible. Tapping a card selects it without changing the mobile layout or moving focus into the editor. The selected node or family anchors the section with a strong outline. Selecting a family selects all its captured members; expanded members stay with the family in the selected section, followed by related nodes with a small separation, then other nodes; without selection, all admitted rows belong to Nodes. Rows have matching colored left borders. Hovering a card or any control in its editor row highlights both representations, including family headers and members. The hovered card temporarily comes forward and becomes fully opaque, while selection and keyboard focus remain independent. Leaving the item or cancelling the pointer clears the treatment; touch input does not retain a hover. Stable motion:layoutId identities and a position spring animate rows between sections without remounting their editors; scroll offsets are accounted for, and reduced-motion preferences skip layout animation. Family disclosures coordinate editor members and graph expansion. Cached rows reuse the nested JSON editors from the atoms and selectors views, preserving readonly behavior. Uncached rows show Generate instead of editor controls. Generate explicitly reads or evaluates that state. Failures appear in the debugger error area. Cards and editor rows update from the cache when the application evaluates a default or selector, writes a value, or resolves an async value. Observing these updates leaves dormant state untouched. Expanding object properties and editing values are explicit interactions. The editor initially admits 50 rows, with Show more nodes admitting another 50 up to 500; search covers the captured metadata, including rows beyond that display limit.

Selection emphasizes captured paths upstream and downstream without following side branches. Arrows follow 3D curves projected into SVG inside their source card’s layer: foreground sources draw over background cards, while higher cards cover their arrows. Active edges retain source colors with higher opacity. Active cards and their outgoing arrows stack above unrelated cards, with selected cards foremost; unrelated cards fade to 50%. Escape clears selection outside editor controls. Enter toggles clustering and expansion for selected families or members from their card, editor name button or focused graph. The selected member remains reachable in the editor while its family card represents it on the clustered canvas. Retained observations can be stale, incomplete or truncated.

Search filters editor rows directly. On the canvas, nonmatching cards remain at their positions with a smaller, lower-opacity treatment, preserving their colors, borders and node shapes. Matching records take precedence within the 500-card paint cap; the graph retains up to 1,000 directed arrows. Ranked member navigation expands its family and focuses the camera and editor row. Unfinished edits keep their mounted input, numeric draft and caret through selection, filtering, resizing and live updates; an edited row outside the filter is explicitly marked until the draft ends. The wide toolbar keeps search inline; compact windows use a search modal with an applied-filter dot. Dismissal retains the query, and native dialogs keep their background inert. The info button opens a dismissible, scrollable guide with navigation instructions, capture details and the legend.

Standard OrbitControls provide left-drag orbit, right-drag pan, wheel zoom, one-finger orbit and two-finger pan/pinch zoom. Focus the graph for arrow-key panning or +/− zoom. Reset view restores the default camera framing. Cards can overlap in projection; orbit, zoom, search and editor name buttons remain available. Module/WebGL failures leave the editor, search and Generate available. Selection, expansion and the camera survive navigation. Value-only updates preserve positions, while topology changes recompute the evenly spaced helices. There is no graph polling or automatic application read. Hidden, minimized and unmounted views cancel pending work.

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

Operation records contain registered transaction keys, timeline cursors and retained step counts, and the keys of instantiated timeline family members. The operation capture inspects up to 1,000 records by default. The maxOperations option accepts integers from 0 to 10,000. The operation section reports actual inspection work and whether the bound left records uninspected. Timeline family member counts are lower bounds when operation capture truncates.

Operation targets contain state and family keys. Transaction targets accumulate up to 1,000 distinct atom keys per registered definition. Commit recording inspects up to 10,000 outcome entries per commit, without retaining values, arguments, or return data. Timeline targets come from the live scope. Operation target capture uses a separate maxRelations budget and reports incomplete relationships in the operation metadata. Full-store remote Ecology uses the same metadata for its dashed and dotted lines.

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
| Interactive app with debugger | `tonnage-recipes/debugger.ts` | 1,017,763 B | 303,082 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

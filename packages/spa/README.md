<p align="center"><img src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/spa/icon-512.png" alt="SPA logo" width="160" height="160"></p>

# SPA

An experimental JSX framework whose state engine is atom.io. Components run once per mounted instance. Calls to accessors inside compiled JSX subscribe the affected DOM computations; atom.io updates those computations without rerunning component setup.

The npm package is named @atom.io/spa. Its browser runtime, Vite compiler, server renderer, and Astro integration are implemented here. It has no independent state primitive, effect API, React hook dispatcher, or compatibility layer.

## Start with the Astro template

Use the [SPA + Astro SSR template](https://github.com/jeremybanka/atom.io/tree/main/templates/spa-astro-ssr) for a ready-to-run application with Astro islands, resumable initial data, SQLite, and tRPC:

```sh
npm create atom.io@latest my-spa -- --templateName=spa-astro-ssr --packageManager=npm
cd my-spa
npm run dev

```

For manual setup, see the [Astro](https://atom.io.fyi/docs/spa/astro) and [Vite](https://atom.io.fyi/docs/spa/vite) integration guides on atom.io.fyi.

## A point, not two signals

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
export function PointEditor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	return (
		<section>
			<h2>Point</h2>
			<svg viewBox="0 0 100 100">
				<circle cx={getPoint().x} cy={getPoint().y} r="3" />
			</svg>
			<output>
				{getPoint().x}, {getPoint().y}
			</output>
			<button
				onClick={() => {
					setPoint(({ x, y }) => ({ x: x + 1, y }))
				}}
			>
				Move right
			</button>
		</section>
	)
}

```

Name the getter and setter after the atom: pointAtom uses getPoint and setPoint. The getPoint getter returns the current object. Each JSX attribute reads its coordinate when evaluated. Both bindings depend on the point atom, and unchanged primitive results skip DOM writes. Reads during setup are snapshots; reads in event handlers are current and untracked. Shared derived state belongs in atom.io selectors.

Component children follow the same getter contract as named props. A component declaring string children reads a string for both literal text and expression children, including an explicit children attribute. Read props.children inside compiled JSX or a tracked binding for reactive updates; setup reads capture a snapshot. Deliberately function-valued children remain functions, including render callbacks.

## Astro

Register the Astro integration, which compiles .tsx and .jsx components by default:

```ts
import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"

export default defineConfig({ integrations: [spa()] })

```

Create a counter component:

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })

export default function Counter(): SpaElement {
	const getCount = useGetter(countAtom)
	const setCount = useSetter(countAtom)
	return (
		<button
			onClick={() => {
				setCount((count) => count + 1)
			}}
		>
			Count: {getCount()}
		</button>
	)
}

```

Import it into an Astro page and use client:load to make it interactive. Astro handles server rendering and browser hydration:

```astro
---
import Counter from "./Counter.tsx"
---
<html lang="en">
	<head><title>SPA counter</title></head>
	<body>
		<Counter client:load />
	</body>
</html>

```

## Vite

Add @atom.io/spa and atom.io to the application's dependencies. The spa plugin is required: the ordinary TypeScript JSX transform cannot preserve live expressions. It compiles expressions into lazy child computations and property getters; it also preserves spread precedence and live component props.

```ts
import spa from "@atom.io/spa/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [spa()] })

```

```json
{
	"compilerOptions": {
		"module": "ESNext",
		"moduleResolution": "bundler",
		"target": "ES2022",
		"jsx": "preserve",
		"jsxImportSource": "@atom.io/spa",
		"strict": true
	}
}

```

Add a host element in index.html, then mount the same counter from main.tsx:

```html
<!doctype html>
<html lang="en">
	<head><title>SPA counter</title></head>
	<body>
		<div id="app"></div>
		<script type="module" src="/main.tsx"></script>
	</body>
</html>

```

```tsx
import { render } from "@atom.io/spa"

import Counter from "./Counter.tsx"

render(() => <Counter />, document.getElementById(`app`)!)

```

The development plugin keeps SPA and atom.io outside dependency prebundling so renderer entrypoints, component hooks, and stores share one runtime, including Astro adapter environments. It uses full page reloads. Components and render computations are synchronous. Modern browsers with ES2022 and DOM Range support are the target.

## Hooks

| API                           | Contract                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| useLoadable(token, fallback?) | Return a tracked accessor for loading, last-observed values, and handled errors.                                         |
| useGetter(token)              | Return a live accessor for an atom or selector, bound to this instance's store.                                          |
| useSetter(token)              | Return a stable atom.io writer.                                                                                          |
| useTimeline(token)            | Return a stable object with getCursor/getLength readers, undo/redo/clear commands, and transaction-group controls.       |
| useTransaction(token)         | Bind an atom.io transaction, preserving its arguments and result.                                                        |
| useRef(token)                 | Return an attachment callback for a nullable element atom. Clear it only while this attachment still owns the reference. |
| useId()                       | Allocate an instance-stable ID using the root's prefix.                                                                  |
| onCleanup(callback)           | Register synchronous teardown with the current owner.                                                                    |
| onMount(callback)             | Run once after attachment and ref publication; omitted during server rendering.                                          |
| useStore()                    | Return the current root's atom.io store without creating a store or subscribing.                                         |

Call setup helpers synchronously during component setup or owned mount callbacks. Capture their results for event handlers. Tokens are fixed for an instance; use an application key in a reactive child expression to replace a component when its token changes. Component props stay live when read through the props object; destructuring during setup takes a snapshot.

useTimeline returns a TimelineControls object whose methods can be destructured during setup. getCursor and getLength read the current cursor position and recorded checkpoint count; calls inside JSX subscribe the computation, while calls during setup or in event handlers are untracked. undo, redo, and clear are stable commands. history.getTransaction() is a tracked reader that returns an object with optional undo and redo callbacks for the adjacent transaction groups. At a cursor between transactions, both callbacks may be present and target different groups. A missing callback means no transaction group is available in that direction; the reader returns an empty object when neither is available. Calling a returned callback travels its captured group across participating timelines where it remains at the relevant history head, leaving diverged timelines unchanged. Use history.getTransaction().undo?.() or history.getTransaction().redo?.() to retrieve and invoke the current action together.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useTimeline, useTransaction } from "@atom.io/spa"
import { atom, timeline, transaction } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })
const historyTimeline = timeline({ key: `history`, scope: [countAtom] })
const incrementTransaction = transaction<() => void>({
	key: `increment`,
	do: ({ get, set }) => {
		set(countAtom, get(countAtom) + 1)
	},
})

export function TimelineExample(): SpaElement {
	const getCount = useGetter(countAtom)
	const increment = useTransaction(incrementTransaction)
	const history = useTimeline(historyTimeline)
	return (
		<section>
			<output>
				Count: {getCount()} (history: {history.getCursor()}/{history.getLength()}
				)
			</output>
			<button onClick={increment}>Increment</button>
			<button
				disabled={history.getTransaction().undo === undefined}
				onClick={() => {
					history.getTransaction().undo?.()
				}}
			>
				Undo transaction
			</button>
			<button
				disabled={history.getTransaction().redo === undefined}
				onClick={() => {
					history.getTransaction().redo?.()
				}}
			>
				Redo transaction
			</button>
		</section>
	)
}

```

Arrays support keyed components and elements. Reordering preserves instances and nodes; removed ranges release subscriptions, events, refs, and cleanup callbacks. Application keys must be unique among siblings. Explicit keys are compared as strings; unkeyed positions occupy a separate namespace. Unkeyed arrays use positions. A key identifies a row in a reactive child collection; it is not an independent reactive binding.

HTML and SVG use native DOM properties and attributes, plus className/htmlFor aliases. Events use onClick/onInput-style names, with Capture suffixes and onDoubleClick support. Styles are CSS strings. Mutable atom values still invalidate their consumers; project primitive fields for precise DOM writes. Refs attach once per element instance.

HTML and SVG tags have element-specific attribute, event, and ref types. Event handlers receive native events with currentTarget typed as the attached element; target remains EventTarget because events can bubble from descendants. Ref callbacks receive the element on attachment and null on cleanup. Hyphenated custom tags use generic HTML attributes and HTMLElement refs and event targets. SVG presentation attributes use their literal markup spellings. Shared HTML/SVG tag names use HTML types because JSX cannot infer a namespace from parent elements.

## Store access

useStore returns the current root's atom.io RootStore directly. It is the same object supplied to render or hydrate, the selected Astro island store, or the implicit atom.io store when no store was supplied. Server rendering exposes the store selected for that render.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useStore } from "@atom.io/spa"
import { atom } from "atom.io"
import { getFromStore } from "atom.io/internal"

const countAtom = atom<number>({ key: `count`, default: 0 })

export function InspectCount(): SpaElement {
	const store = useStore()
	return (
		<button
			onClick={() => {
				console.log(getFromStore(store, countAtom))
			}}
		>
			Inspect current count
		</button>
	)
}

```

Capture the store during component setup or an owned onMount callback, then pass it to store-aware atom.io operations or integrations. Getting the store creates no subscription. Direct reads such as getFromStore do not participate in SPA's dependency tracking; useGetter and useLoadable provide tracked reads. The returned object is a store, not a Silo or a new wrapper.

## Families

useGetter, useSetter, useRef, and useTimeline accept a family token followed by its key. useLoadable accepts a family, key, and optional fallback. Keys retain their declared types, including tuples, numbers, booleans, and null. Members resolve in the component's store, so isolated roots can use the same family tokens independently.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useRef, useSetter, useTimeline } from "@atom.io/spa"
import { atomFamily, scopeFamily, timelineFamily } from "atom.io"

const countAtoms = atomFamily<number, string>({ key: `count`, default: 0 })
const buttonAtoms = atomFamily<HTMLButtonElement | null, string>({
	key: `button`,
	default: null,
})
const historyTimelines = timelineFamily<string>({
	key: `history`,
	scope: [scopeFamily(countAtoms, { timelineKey: (id) => id })],
})

export function FamilyCounter(props: { id: string }): SpaElement {
	const getCount = useGetter(countAtoms, props.id)
	const setCount = useSetter(countAtoms, props.id)
	const ref = useRef(buttonAtoms, props.id)
	const history = useTimeline(historyTimelines, props.id)
	return (
		<section>
			<button
				ref={ref}
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				{getCount()}
			</button>
			<button disabled={history.getCursor() === 0} onClick={history.undo}>
				Undo
			</button>
		</section>
	)
}

```

The family and key are captured during setup and stay fixed for that component instance. To switch members, replace the component in a reactive child collection with a new application key. Ref ownership and subscription cleanup follow the member just as they do for individual tokens. useTransaction takes a transaction token; atom.io has no transaction-family token.

## Async state

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useLoadable, useSetter } from "@atom.io/spa"
import type { Loadable } from "atom.io"
import { atom } from "atom.io"

const greetingAtom = atom<Loadable<string>, Error>({
	key: `greeting`,
	default: () => Promise.resolve(`Hello`),
	catch: [Error],
})

export function Greeting(): SpaElement {
	const greeting = useLoadable(greetingAtom, `Loading…`)
	const setGreeting = useSetter(greetingAtom)
	return (
		<section aria-busy={greeting().loading}>
			<p>{greeting().value}</p>
			{greeting().error && <p role="alert">{greeting().error?.message}</p>}
			<button
				onClick={() => {
					setGreeting(Promise.resolve(`Hello again`))
				}}
			>
				Refresh
			</button>
		</section>
	)
}

```

Call useLoadable during setup and read its accessor inside JSX. It also accepts a readable family and fixed key, with an optional third fallback argument. Without a fallback, the accessor returns LOADING until it observes a settled value, then an object containing loading and value. Refreshes retain the last observed value while loading. Null, undefined, and the literal string LOADING are valid settled values.

With a fallback, the accessor always returns an object. The fallback is used for initial loading and for errors declared in the token's catch option; handled errors appear separately in error. During a retry after an error, the fallback and error remain visible until a new value settles. An explicitly supplied null or undefined counts as a fallback when the token's value type permits it. Without a fallback, handled errors appear in value. Unexpected errors follow atom.io's normal error handling.

Atom.io owns promise settlement and subscriptions. SPA adds no fetching, retries, cancellation, or suspense. Reads during setup are snapshots; calls inside JSX track state. Family keys are fixed for a component instance. Server rendering returns the current loading or settled view immediately and does not await promises.

## Rendering and ownership

The client exports render and hydrate. Both accept a setup callback, a host Element, and optional store, idPrefix, and onError options, and return dispose and flush methods. Updates coalesce in a microtask; flush drains them synchronously. Dispose is idempotent and removes only owned nodes. Cleanup continues after individual cleanup failures and aggregates errors. A failed computation disposes its root; asynchronous update failures reach onError, while explicit flush failures throw.

The separate server entrypoint exports renderToString with the same setup callback and store/ID options. Supply a request-specific store for SSR. Server rendering retains no subscriptions and runs owner cleanup. Hydration reuses matching server nodes and IDs, attaches events, and recreates subscriptions. Match initial state, component structure, and valid HTML on both sides. A hydration mismatch produces one human-readable console warning per root in development and production, identifying the host and expected/found nodes. SPA repairs mismatched nodes, inserts missing nodes, and removes unexpected leftovers during the same hydration pass. Component setup and mount hooks run once, subscriptions remain active, and matching nodes are reused. Replaced nodes can lose focus, selection, or unsaved browser input; unaffected roots continue running. An explicit client idPrefix takes precedence when repairing mismatched root markers. Use explicit tbody elements in tables. Controlled form properties are applied during hydration.

The production build omits development-only diagnostics and invalid-input checks; the development export condition enables them. Hydration recovery warnings remain available in all builds. Pure render computations must not write state. Promise children, async components, portals, suspense, error boundaries, style objects, and automatic token-as-child bindings are outside this first implementation. Applications handle asynchronous data through atom.io state and synchronous conditional JSX.

## Astro state and data

The integration compiles .tsx and .jsx files by default. Use the include option to limit compilation to SPA component directories when another JSX renderer is present. Top-level functions containing JSX are branded by the compiler for renderer detection.

Default islands share the normal implicit atom.io store in the browser. Module-scoped tokens, SPA hooks, and ordinary getState/setState calls all address the same graph. SSR shares a separate store within each request; concurrent requests never share values. Definitions imported after an earlier island started are installed into that request's store before the next island prepares. Server reads and writes must use the selected store (through SPA hooks or store-aware atom.io operations); free getState/setState calls still target the process-global implicit store.

The integration starts observing browser state before island preparation. Untouched initial islands hydrate their matching server DOM. Once application state changes or a shared client:only island starts, delayed islands mount fresh against the live graph. Astro ClientRouter navigation also makes newly introduced islands mount fresh, preserving existing browser values instead of replaying the incoming server snapshot. Mounted and persisted roots keep their subscriptions and DOM. This decision is conservative across the application: even an unrelated state change disables hydration for later roots. Ordinary defaults should still produce matching initial values. DOM mismatch recovery keeps a view interactive; it does not reconstruct missing server data or resolve nondeterministic application logic.

With resumability/astro installed alongside SPA, resumability owns Astro's request collection, page sidecars, and browser scope. SPA awaits async state used by JSX and uses the host's renderer adapter to attach seeds to islands. Ordinary atom defaults use the host without changing the store's evaluator; private stores bind a separate scope so lazy work ends with the island. Define resumable defaults at module scope and render ordinary Astro islands. Components need no Resumption wrapper, prepareStore callback, or preload list. The same host supports plain Astro constants without atom.io. See the [resumability guide](https://atom.io.fyi/docs/spa/astro#resumability) and the inventory starter for a complete example. Resumability is an optional peer, loaded only by this adapter.

Server-rendered views record the state tokens they read so the browser can check readiness before hydration. If an ordinary async default is still pending without a synchronous seed, SPA mounts a fresh view with its loading state; seeded values continue to hydrate existing DOM. This also handles cached server reads and mixed ordinary/resumable state. Private server preparation and rendering are cancelled with their request, releasing cleanup resources even when a producer ignores its abort signal.

Set a component's isolate property to true to opt into a private store copied from registered definitions. An optional createStore(props, context) factory supplies a custom RootStore or promise and retains a private preparation lifetime. Custom factories that return the same store are responsible for coordinating their hydration and cleanup. Keep atom definitions at module scope in either mode.

An optional prepareStore(store, props, context) callback initializes the selected store and may return a promise. SPA awaits it before component setup on the server and browser. Existing one-argument synchronous factories still work. Shared preparation must be safe to call for multiple islands; use context.application.get(key, initialize) to create an application resource once.

The context provides element (the browser astro-island host, undefined on the server), signal, and onCleanup for the individual island. Its application provides get, signal, onCleanup, and canResume for the shared lifetime. Browser application resources survive island removal and ClientRouter navigation; they end on a full page exit, with back/forward-cache suspension preserved. SSR application resources end after the response stream finishes or is cancelled. Private islands' application resources end with the island. Use application cleanup and cancellation for shared fetches or resumption scopes; use the outer context for resources owned by one island.

Register cleanup as resources are acquired, before awaiting work that might fail. Cleanup callbacks run in reverse order and all run even if one throws; callbacks registered after cancellation run immediately. Cancelling an island stops its wait and prevents a stale mount without cancelling shared application work. Producers must honor their owner's signal to stop I/O. The example below explicitly isolates its per-island data preparation:

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import type { AstroStorePreparation } from "@atom.io/spa/astro"
import type { Loadable } from "atom.io"
import { atom } from "atom.io"
import { disposeFromStore, getFromStore, setIntoStore } from "atom.io/internal"

const greetingAtom = atom<Loadable<string>>({
	key: `greeting`,
	default: ``,
})

export default function Greeting(): SpaElement {
	const greeting = useLoadable(greetingAtom, ``)
	return <p>{greeting().value}</p>
}

const prepare: AstroStorePreparation<{ message: string }> = async (
	store,
	props,
	context,
) => {
	context.onCleanup(() => {
		disposeFromStore(store, greetingAtom)
	})
	// Use your asynchronous data preparation here. SSR and the browser must
	// observe the same initial value; context.element can provide a DOM sidecar.
	setIntoStore(store, greetingAtom, Promise.resolve(props.message))
	await getFromStore(store, greetingAtom)
}
Greeting.isolate = true
Greeting.prepareStore = prepare

```

AstroApplicationContext, AstroStoreContext, AstroStoreFactory, AstroStorePreparation, and Island types are exported from @atom.io/spa/astro. Preparation runs before component setup, so use the context's cleanup registrar there; use SPA's onCleanup inside components. Preparation failures reject the Astro render or hydration operation, retaining cleanup errors alongside the original failure. The factory and preparation callback are awaited per render; component setup and the standalone renderToString API remain synchronous.

Astro client:load, client:idle, client:visible, client:media, and client:only use Astro's scheduling. The integration hydrates eligible initial server markup or renders fresh content and releases the root on astro:unmount. Default slot content arrives as children and named content through slots. Reserved astro-slot wrappers contain Astro's already-rendered HTML; never use their innerHTML escape hatch for untrusted strings.

Persisted islands receive live prop and slot updates without rerunning component setup or recreating their store. Repeated hydration calls during preparation share one factory and preparation invocation. New client mounts use the latest props and slots; hydration attaches to the original server tree first, then applies any changes received while preparing. The factory receives the initial props and runs only when an island is first mounted; put changing values in props rather than relying on the factory to run again.

The checked Astro fixture demonstrates default/named slots and custom independently initialized islands, including client:only. The spa-astro-ssr template demonstrates shared state, server-data resumption, delayed islands, and navigation without losing edits.

## Size and verification

The build audits every browser export, including the JSX runtime, from the built JavaScript. Atom.io is an external peer in the incremental measurement. Compiler, server, and integration code have separate entrypoints. The report also includes the complete client plus atom.io, the Astro client entrypoint, and the installed Preact version under the same bundling/minification settings. These are full exported surfaces, not equivalent application benchmarks.

The hard budget is under 4,300 bytes of ordinary level-9 gzip for the complete client export surface, including hydration recovery and its production diagnostics. Tsdown builds the package JavaScript and declarations, with separate production and development outputs that each share their runtime across entrypoints. The size audit then bundles the built exports with esbuild, minifies with Oxc, and measures compression using Node's gzip and Brotli implementations. The complete client export surface measures approximately 4.2 kB with gzip; dist/size.json records the exact build measurements. Actual application bundles add atom.io and compiler-generated application code.

Build output includes the minified audit entrypoint and machine-readable dist/size.json. These audit files are a bundled measurement; use the package exports in applications so the bundler preserves one runtime instance across entrypoints. Source tests exercise development behavior; the production test executes the audited minified artifact. Chromium checks exercise the actual Astro build, island isolation, hydration, keyed identity, focus/selection, SVG namespaces, and teardown. A fresh-cache Astro development check also covers mount hooks, shared state, and ClientRouter navigation.

```sh
pnpm --filter @atom.io/spa build
pnpm --filter @atom.io/spa cov
pnpm --filter @atom.io/spa-devtools cov
pnpm exec turbo run test:breakage:peers --filter=@atom.io/spa --filter=@atom.io/spa-devtools
pnpm --filter @atom.io/spa test:production
pnpm --filter @atom.io/spa test:optional-peers
pnpm --filter @atom.io/spa exec playwright install chromium
pnpm --filter @atom.io/spa test:browser
pnpm --filter @atom.io/spa size
pnpm --filter @atom.io/spa readme:check

```

## Package checks

Breakage exercises the packed package in isolated, locked peer environments, including the coordinated atom.io workspace candidate. Until the first published release, Breakage reports a first-release baseline; these checks establish compatibility with the declared peers rather than a previous spa release. Coverage gates require 100% of statements, branches, functions, and lines across the package source.

Tonnage measures combined browser bundles containing SPA and atom.io, with shared modules counted once and unused exports removed. The synchronous recipes include atom creation, useGetter, useSetter, and JSX; the client recipe adds render, the hydration recipe adds hydrate, and the Astro recipe adds the browser island adapter. The async recipe uses useLoadable with render and useSetter. The family recipe includes keyed state, refs, and timeline controls, plus atomFamily, timelineFamily, and scopeFamily. SPA declares atom.io as a peer dependency; these consumer-app measurements include it in every total. Application components, Astro scheduling code, CSS, declarations, and source maps are excluded. The full-client gzip budget above remains a separate, SPA-only audit.

## Browser serving sizes including atom.io

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Imported peer dependencies are bundled unless explicitly external, and shared modules are counted once per bundle.

| Recipe                           | Entry                             | Minified JS |  Gzip JS |
| -------------------------------- | --------------------------------- | ----------: | -------: |
| Family app with refs and history | `tonnage-recipes/family-app.ts`   |    64,121 B | 19,146 B |
| Async interactive client app     | `tonnage-recipes/async-app.ts`    |    42,546 B | 13,380 B |
| Interactive client app           | `tonnage-recipes/client-app.ts`   |    42,209 B | 13,229 B |
| Hydrated interactive app         | `tonnage-recipes/hydrated-app.ts` |    42,210 B | 13,227 B |
| Interactive Astro island         | `tonnage-recipes/astro-island.ts` |    48,725 B | 15,280 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

## Optional graphics and motion

SPA includes Konva, Three.js, and Motion integrations behind separate entrypoints. Install only the engines you use. Konva, three, @types/three, and motion are optional peers; the main runtime and JSX declarations work without them installed. Importing the base entrypoint does not load any animation or graphics engine, and each integration's bundle excludes the other engines. These boundaries are verified with isolated consumer and bundle checks.

### Konva

Import Stage, Layer, Group, Rect, Circle, Ellipse, Line, Text, Image, Path, Star, and Transformer from @atom.io/spa/konva. Stage renders a DOM container and creates its native stage after browser mounting. Compiled atom reads update native attributes; keyed children preserve node identity. Native configuration attributes and onClick, onPointerDown, onDragMove, and onDragEnd handlers are supported. Refs receive native nodes and null on cleanup. Removal destroys owned nodes and listeners.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { Circle, Layer, Stage } from "@atom.io/spa/konva"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 100, y: 100 },
})
export function Editor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	return (
		<Stage width={800} height={600}>
			<Layer>
				<Circle
					x={getPoint().x}
					y={getPoint().y}
					radius={25}
					fill="coral"
					draggable
					onDragEnd={(event) => {
						setPoint({ x: event.target.x(), y: event.target.y() })
					}}
				/>
			</Layer>
		</Stage>
	)
}

```

Konva owns hit testing, dragging, and draw batching. Write drag results back into atoms to keep document state synchronized. The exported konvaRenderer can also render into a borrowed container dedicated to its scene children.

### Three.js

Import Canvas, Group, Mesh, PerspectiveCamera, AmbientLight, DirectionalLight, BoxGeometry, SphereGeometry, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, and MeshNormalMaterial from @atom.io/spa/three. Canvas creates a WebGL renderer after browser mounting. Geometry and material children attach to their Mesh, with one of each supported. Position and rotation accept three-number tuples; scale also accepts a scalar.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import {
	AmbientLight,
	BoxGeometry,
	Canvas,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
} from "@atom.io/spa/three"
import { atom } from "atom.io"

const colorAtom = atom<string>({ key: `color`, default: `coral` })
export function Scene(): SpaElement {
	const getColor = useGetter(colorAtom)
	return (
		<Canvas width={800} height={600}>
			<AmbientLight intensity={0.5} />
			<DirectionalLight position={[3, 3, 3]} />
			<Mesh rotation={[0.3, 0.5, 0]}>
				<BoxGeometry args={[1, 1, 1]} />
				<MeshStandardMaterial color={getColor()} />
			</Mesh>
		</Canvas>
	)
}

```

Constructor args are fixed for an instance. To change them, replace the resource with a new key in a reactive child collection. Refs expose native objects. Owned geometries and materials are disposed on removal; textures passed through material properties remain borrowed. Canvas stops drawing and disposes its renderer on removal. The exported threeRenderer renders into a borrowed parent dedicated to its children without creating a WebGL renderer.

Canvas defaults to a perspective camera at z = 5. Its optional camera prop borrows an external camera; a PerspectiveCamera child does not automatically become active. Width and height update the renderer and default camera. Canvas renders continuously and accepts an onFrame callback with scene, camera, renderer, delta seconds, and timestamp seconds. Controls, asset loading, and drawing on demand are outside this initial API.

### Three.js pointer events

Mesh and group components accept onPointerDown, onPointerUp, onPointerMove, onPointerEnter, onPointerLeave, onPointerOver, onPointerOut, onPointerCancel, and onClick handlers. Canvas converts CSS pointer coordinates into a ray through the current camera, updates world matrices, and picks the nearest visible object on the camera's layers. That object occludes objects behind it even when it has no handlers. Three.js material sidedness controls which surfaces can be picked.

Events bubble from the picked object through its scene ancestors; stopPropagation stops ancestor delivery. Enter and leave notifications describe each ancestor's hover boundary without repeating when moving between its children. Hover is tracked per pointer and re-evaluated each frame, so moving objects and cameras update hover even when the pointer stays still. Hidden ancestry and hidden materials are excluded.

A ThreePointerEvent exposes nativeEvent, target (the receiving leaf or captured object), currentTarget (the handler's object), intersection, ray, pointerId, button, buttons, clientX, clientY, preventDefault, stopPropagation, and setPointerCapture/releasePointerCapture/hasPointerCapture methods scoped to that handler's object. Capturing on a group retargets subsequent events to that group. Off-object captured events retain the capture's last intersection; use the current ray for drag-plane calculations. A primary-button click is emitted only when press and release pick the same leaf.

Canvas retains native pointer delivery during a press. Releasing outside a pressed object cancels it unless a scene object explicitly captured the pointer; captured objects still receive the release outside the canvas. Pointer cancellation, browser capture loss, subtree removal, and Canvas disposal clear interaction state and release native capture. Cleanup continues if removal callbacks fail. Borrowed scenes can use createThreeEvents directly, call update after changing the scene, remove to release a subtree's interaction state, and dispose when the surface is released.

### Declarative motion capabilities

Import motionCapability from @atom.io/spa/motion and register it explicitly in render or hydrate options. Importing that entrypoint also supplies JSX type augmentation. Registration belongs to one root, is inherited by its scene subtrees, and never modifies a global registry. Astro islands can set their component's capabilities property to the same array; the integration supplies it to both server rendering and browser hydration.

```tsx
import { render } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionPanel } from "./motion.tsx"

render(() => <MotionPanel />, document.getElementById(`app`)!, {
	capabilities: [motionCapability()],
})

```

Use motion:initial, motion:animate, motion:exit, motion:transition, motion:whileHover, and motion:whileTap directly on native elements or custom tags. These are framework properties, separate from native attributes: they never become HTML attributes. An unregistered namespace or unsupported motion property produces an error. Standard XML, XMLNS, and XLink attribute namespaces retain their normal behavior.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const targetXAtom = atom<number>({ key: `targetX`, default: 0 })
export function MotionPanel(): SpaElement {
	const getTargetX = useGetter(targetXAtom)
	const setTargetX = useSetter(targetXAtom)
	return (
		<section>
			<button
				onClick={() => {
					setTargetX((value) => (value === 0 ? 200 : 0))
				}}
			>
				Move
			</button>
			<sliding-panel
				style="display: block; width: 120px; padding: 16px; background: coral"
				motion:initial={{ opacity: 0, x: -100 }}
				motion:animate={{ opacity: 1, x: getTargetX() }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.05 }}
				motion:whileTap={{ scale: 0.95 }}
			>
				Motion, with your own markup.
			</sliding-panel>
		</section>
	)
}

```

Motion targets update reactively without rerunning component setup. The target stays in atom.io; intermediate values and velocity remain in Motion. Spring transitions preserve motion-value continuity when retargeted. Duration-based tween transitions are also supported. Set initial to false to begin at the first animate target. DOM targets accept scalar CSS values and independent transforms, including custom CSS properties. Keyframe sequences, layout animation, and variant propagation are outside this initial API.

Motion respects the user's reduced-motion preference by default, including changes while mounted. The capability's reducedMotion option can be user, always, or never. Owner cleanup stops animations and releases effects, gesture handlers, and media-query listeners. Removing the capability properties releases that node's binding. Avoid assigning the same property through both native attributes/styles and motion targets: motion owns the properties it animates.

The same attributes animate numeric Konva properties and colors, or Three.js position, rotation, scale, light/material color, opacity, and intensity. Three.js rotation uses Euler components, not quaternion interpolation. DOM hover and tap use Motion's gesture handling; Konva gestures use native pointer events. Three.js gestures use the same raycast event layer as ordinary scene pointer handlers.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshNormalMaterial,
} from "@atom.io/spa/three"
import { atom } from "atom.io"

const targetXAtom = atom<number>({
	key: `targetX`,
	default: 1,
})
// Mount under a root with capabilities: [motionCapability()].
export function SpringCube(): SpaElement {
	const getTargetX = useGetter(targetXAtom)
	return (
		<Canvas>
			<Mesh
				motion:initial={{ position: [-1, 0, 0], scale: 0 }}
				motion:animate={{ position: [getTargetX(), 0, 0], scale: 1 }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.2 }}
				motion:whileTap={{ scale: 0.8 }}
				onPointerDown={(event) => {
					event.setPointerCapture()
				}}
			>
				<BoxGeometry />
				<MeshNormalMaterial />
			</Mesh>
		</Canvas>
	)
}

```

When the motion capability is installed, Canvas draws in Motion's render phase after animated scene values update. Without it, Canvas uses requestAnimationFrame. Both drawing subscriptions and animations end with their owners. The base runtime imports no motion engine or retention coordinator. Presence hooks add approximately 300 bytes of gzip to the released 3.7 kB client surface; the optional Motion entrypoint owns the retention machinery. The full client budget is 4,300 bytes.

### Exit animations and re-entry

Declare motion:exit on an element, custom tag, Konva node, or Three.js scene node. Conditional or keyed removal starts that target from its current Motion values. No presence wrapper is required. Register motionCapability as above.

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const visibleAtom = atom<boolean>({ key: `visible`, default: true })
export function DismissiblePanel(): SpaElement {
	const getVisible = useGetter(visibleAtom)
	const setVisible = useSetter(visibleAtom)
	return (
		<section>
			<button
				onClick={() => {
					setVisible((value) => !value)
				}}
			>
				Toggle panel
			</button>
			{getVisible() && (
				<sliding-panel
					key="panel"
					motion:initial={{ opacity: 0, y: 12 }}
					motion:animate={{ opacity: 1, y: 0 }}
					motion:exit={{ opacity: 0, y: -12 }}
					motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				>
					The same instance returns if toggled before its exit completes.
				</sliding-panel>
			)}
		</section>
	)
}

```

In the repository, the runnable source lives in [examples/motion](https://github.com/jeremybanka/atom.io/tree/main/packages/spa/examples/motion), including its standalone Vite entrypoint and visual recorder. Run the package’s example:motion script to start it locally.

Try the [motion sandbox](https://atom.io.fyi/spa-motion-lab) to interrupt a 2s tween at adjustable speeds, inspect rendered positions and velocities, scrub the captured sequence, or export PNG and JSON evidence.

SPA retains the entire removed subtree until all its exit targets finish, including independently exiting descendants adopted by an exiting ancestor. Native nodes, scene attachments, refs, subscriptions, renderers, geometries, and materials remain owned until final disposal. When keyed Mesh resources are replaced, the incoming geometry and material attach immediately; outgoing resources remain owned through their exits without occupying those attachment slots. Removing a resource without a replacement keeps it attached until its exit finishes. Replacing resources does not render a crossfade between them. Siblings keep their instances; retained ranges keep their previous position. A target without an exit is removed immediately unless another exit retains its enclosing subtree.

Returning the same key and component or element type before disposal cancels the exit and resumes the original instance against the latest props and state. Setup, mount callbacks, and refs do not run again. Motion keeps the current animated values and spring velocity. Moving numeric tweens also preserve velocity, including matching CSS units and scene tuple components: the first 20% of the new duration brakes to rest, then the remaining 80% returns smoothly to the latest animate target. Interrupted tweens begin immediately and use this return curve instead of restarting their authored delay or easing. Fresh tweens keep their authored timing, and zero-duration or reduced-motion updates remain immediate. Discrete and nonnumeric styles retain Motion’s native interpolation. Reusing a key with an incompatible type creates a separate instance; the old generation finishes independently. Keys have meaning within their original child collection. Reordering or reparenting into another collection does not transfer ownership.

During exit, reactive attributes, child reconciliation, user events, gestures, and user onSceneFrame/onFrame callbacks pause. Renderer frame infrastructure continues drawing animated scenes. DOM nodes become inert, aria-hidden, and unavailable to pointer input; owned focus is blurred and is not automatically restored on return. Konva nodes stop listening and cancel both pending and active drags, including descendant drags when an ancestor exits. Re-entry restores the authored draggable settings; a fresh press is required to start dragging again. Three.js objects leave picking and release active pointer interaction state. Re-entry restores their prior interaction settings and handlers.

Exit props and transition settings are read at logical removal; later state changes do not retarget an exiting subtree. Exits use the same transition as animate, defaulting to a spring. Explicit durations, visualDuration, and delays must be finite and nonnegative; velocity must be finite, bounce must be in the range \[0, 1), and stiffness, damping, mass, restDelta, and restSpeed must be finite and positive so exits can settle. Reduced motion skips retention; enabling it during an exit completes that exit. Server rendering omits capability attributes and never starts exits; hydration attaches them for later removals.

Root disposal and fatal errors bypass exits, stop active work, and release resources immediately. Stale animation completions cannot dispose a revived instance. This API covers exit retention and cancellation; layout/pop-layout animation, variants, presence wrappers, and automatic reparenting remain outside its scope.

### Floating overlays with Motion

The optional @atom.io/spa/floating entrypoint adapts @floating-ui/dom. Install Floating UI and Motion for this example, then register both capabilities on the root:

```sh
pnpm add @floating-ui/dom motion

```

```tsx
import { render } from "@atom.io/spa"
import { floatingCapability } from "@atom.io/spa/floating"
import { motionCapability } from "@atom.io/spa/motion"

import { FloatingDetails } from "./floating.tsx"

render(() => <FloatingDetails id="details" />, document.getElementById(`app`)!, {
	capabilities: [floatingCapability(), motionCapability()],
})

```

Floating positions an HTML overlay using CSS translate. Motion can animate x, y, scale, rotation, and opacity on that same element through its separate transform property:

```tsx
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useId, useRef, useSetter } from "@atom.io/spa"
import { flip, offset, shift } from "@floating-ui/dom"
import { atomFamily } from "atom.io"

const floatingOpenAtoms = atomFamily<boolean, string>({
	key: `floatingOpen`,
	default: false,
})
const floatingTriggerAtoms = atomFamily<HTMLButtonElement | null, string>({
	key: `floatingTrigger`,
	default: null,
})
const middleware = [offset(8), flip(), shift({ padding: 8 })]

export function FloatingDetails(props: { id: string }): SpaElement {
	const getOpen = useGetter(floatingOpenAtoms, props.id)
	const setOpen = useSetter(floatingOpenAtoms, props.id)
	const getTrigger = useGetter(floatingTriggerAtoms, props.id)
	const attachTrigger = useRef(floatingTriggerAtoms, props.id)
	const panelId = useId()
	return (
		<>
			<button
				ref={attachTrigger}
				aria-expanded={getOpen()}
				aria-controls={panelId}
				onClick={() => {
					setOpen((value) => !value)
				}}
			>
				Details
			</button>
			{getOpen() && (
				<section
					key="details"
					id={panelId}
					aria-label="Details"
					style="width: 240px; margin: 0"
					floating:reference={getTrigger()}
					floating:placement="bottom-start"
					floating:middleware={middleware}
					motion:initial={{ opacity: 0, y: -4, scale: 0.98 }}
					motion:animate={{ opacity: 1, y: 0, scale: 1 }}
					motion:exit={{ opacity: 0, y: -4, scale: 0.98 }}
				>
					More information about this item.
				</section>
			)}
		</>
	)
}

```

| Attribute           | Behavior                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| floating:reference  | A DOM or virtual reference; null releases positioning.                                              |
| floating:placement  | Floating UI placement, defaulting to bottom.                                                        |
| floating:strategy   | absolute or fixed, defaulting to absolute.                                                          |
| floating:middleware | Standard Floating UI middleware such as offset, flip, and shift.                                    |
| floating:enabled    | Defaults to true; set false when a mounted overlay is closed.                                       |
| floating:autoUpdate | Defaults to true; accepts observer options, or false for positioning only on SPA attribute updates. |

The capability waits for mount and ref publication before measuring, hides the overlay until its first position is available, and reconnects observers when its reference or observer options change. Updates from obsolete calculations are ignored. Server rendering omits floating attributes and starts no observers. Virtual references can supply getBoundingClientRect and an optional contextElement, as documented by Floating UI.

Give the overlay a fixed width or width: max-content and avoid margins so measurement remains stable. Floating owns position, left, top, and translate while enabled, and temporarily owns visibility until the first measurement. Do not animate translate through Motion or assign those positioning properties through another style writer on the same element. Floating restores original inline values and priorities when disabled, removed, or disposed. Keyboard behavior, focus management, dismissal, and top-layer mounting remain application responsibilities.

Reactive inline style changes preserve the current anchor position and Motion values while new measurements are pending. Temporary hiding uses !important until the first position is available, then restores the original inline visibility value and priority.

Position updates continue during Motion's retained exits, until physical disposal. If the reference itself moves through transforms, enable animationFrame in floating:autoUpdate. Run the package's example:floating script for a scrollable experiment with same-element scaling and rotation, moving anchors, viewport collisions, positioning strategies, and interrupted exits. Its test:browser:floating script checks actual Chromium geometry in both capability registration orders.

### Renderer extensions

The renderer entrypoint exposes createSceneRenderer, sceneComponent, bindScene, and onSceneFrame for imperative scene adapters. A host supplies creation, property updates, ordered child attachment, and destruction. Its children callback receives the parent, all owned children including retained exits, and the active children in that collection. Single resource slots can use active children for replacement while retaining ownership of outgoing resources. Children of an exiting parent keep their attachments until disposal. An optional target adapter exposes native property access and events to capabilities. The shared renderer supplies reactive bindings, keyed identity, refs, and cleanup. Use mount inside an owned component or mount callback to inherit its store, capabilities, and lifetime, or render with an explicit parent and optional root options to create a standalone scene root. Scene targets must be dedicated to their renderer's children. Scene subtrees do not support text nodes or hydration; their DOM boundaries defer graphics creation until browser mount. Server rendering validates and omits capability attributes without starting animations.

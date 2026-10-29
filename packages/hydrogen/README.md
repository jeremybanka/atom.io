# Hydrogen

An experimental JSX framework whose state engine is atom.io. Components run once per mounted instance. Calls to accessors inside compiled JSX subscribe the affected DOM computations; atom.io updates those computations without rerunning component setup.

The npm package is named hydrogen. Its browser runtime, Vite compiler, server renderer, and Astro integration are implemented here. It has no independent state primitive, effect API, React hook dispatcher, or compatibility layer.

## A point, not two signals

```tsx
import { atom } from "atom.io"
import type { VNode } from "hydrogen"
import { useId, useRef, useSetter, useValue } from "hydrogen"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
const circleAtom = atom<SVGCircleElement | null>({
	key: `circle`,
	default: null,
})

export function PointEditor(): VNode {
	const point = useValue(pointAtom)
	const setPoint = useSetter(pointAtom)
	const circle = useRef(circleAtom)
	const id = useId()
	return (
		<section aria-labelledby={id}>
			<h2 id={id}>Point</h2>
			<svg viewBox="0 0 100 100">
				<circle ref={circle} cx={point().x} cy={point().y} r="3" />
			</svg>
			<output>
				{point().x}, {point().y}
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

The point accessor returns the current object. Each JSX attribute reads its coordinate when evaluated. Both bindings depend on the point atom, and unchanged primitive results skip DOM writes. Reads during setup are snapshots; reads in event handlers are current and untracked. Shared derived state belongs in atom.io selectors.

## Vite

Add hydrogen and atom.io to the application's dependencies. The hydrogen plugin is required: the ordinary TypeScript JSX transform cannot preserve live expressions. It compiles expressions into lazy child computations and property getters; it also preserves spread precedence and live component props.

```ts
import hydrogen from "hydrogen/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [hydrogen()] })

```

```json
{
	"compilerOptions": {
		"module": "ESNext",
		"moduleResolution": "bundler",
		"target": "ES2022",
		"jsx": "preserve",
		"jsxImportSource": "hydrogen",
		"strict": true
	}
}

```

```tsx
import { render } from "hydrogen"

import { PointEditor } from "./point.tsx"

const root = render(() => <PointEditor />, document.getElementById(`app`)!)
// Call root.dispose() when the application shell removes this root.
import.meta.hot?.dispose(root.dispose)

```

The development plugin keeps Hydrogen and atom.io outside dependency prebundling so renderer entrypoints, component hooks, and stores share one runtime, including Astro adapter environments. It uses full page reloads. Components and render computations are synchronous. Modern browsers with ES2022 and DOM Range support are the target.

## Component API

| API                           | Contract                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| useLoadable(token, fallback?) | Return a tracked accessor for loading, last-observed values, and handled errors.                                         |
| useValue(token)               | Return a live accessor for an atom or selector, bound to this instance's store.                                          |
| useSetter(token)              | Return a stable atom.io writer.                                                                                          |
| useTimeline(token)            | Return an accessor for at, length, undo, redo, clear, and available grouped transaction controls.                        |
| useTransaction(token)         | Bind an atom.io transaction, preserving its arguments and result.                                                        |
| useRef(token)                 | Return an attachment callback for a nullable element atom. Clear it only while this attachment still owns the reference. |
| useId()                       | Allocate an instance-stable ID using the root's prefix.                                                                  |
| onCleanup(callback)           | Register synchronous teardown with the current owner.                                                                    |
| onMount(callback)             | Run once after attachment and ref publication; omitted during server rendering.                                          |
| untrack(callback)             | Read current state without adding dependencies to the surrounding computation.                                           |

Call setup helpers synchronously during component setup or owned mount callbacks. Capture their results for event handlers. Tokens are fixed for an instance; use an application key in a reactive child expression to replace a component when its token changes. Component props stay live when read through the props object; destructuring during setup takes a snapshot.

Arrays support keyed components and elements. Reordering preserves instances and nodes; removed ranges release subscriptions, events, refs, and cleanup callbacks. Application keys must be unique among siblings. Explicit keys are compared as strings; unkeyed positions occupy a separate namespace. Unkeyed arrays use positions. A key identifies a row in a reactive child collection; it is not an independent reactive binding.

HTML and SVG use native DOM properties and attributes, plus className/htmlFor aliases. Events use onClick/onInput-style names, with Capture suffixes and onDoubleClick support. Styles are CSS strings. Mutable atom values still invalidate their consumers; project primitive fields for precise DOM writes. Refs attach once per element instance.

HTML and SVG tags have element-specific attribute, event, and ref types. Event handlers receive native events with currentTarget typed as the attached element; target remains EventTarget because events can bubble from descendants. Ref callbacks receive the element on attachment and null on cleanup. Hyphenated custom tags use generic HTML attributes and HTMLElement refs and event targets. SVG presentation attributes use their literal markup spellings. Shared HTML/SVG tag names use HTML types because JSX cannot infer a namespace from parent elements.

## Async state

```tsx
import type { Loadable } from "atom.io"
import { atom } from "atom.io"
import type { VNode } from "hydrogen"
import { useLoadable, useSetter } from "hydrogen"

const greetingAtom = atom<Loadable<string>, Error>({
	key: `greeting`,
	default: () => Promise.resolve(`Hello`),
	catch: [Error],
})

export function Greeting(): VNode {
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

Atom.io owns promise settlement and subscriptions. Hydrogen adds no fetching, retries, cancellation, or suspense. Reads during setup are snapshots; calls inside JSX track state. Family keys are fixed for a component instance. Server rendering returns the current loading or settled view immediately and does not await promises.

## Rendering and ownership

The client exports render and hydrate. Both accept a setup callback, a host Element, and optional store, idPrefix, and onError options, and return dispose and flush methods. Updates coalesce in a microtask; flush drains them synchronously. Dispose is idempotent and removes only owned nodes. Cleanup continues after individual cleanup failures and aggregates errors. A failed computation disposes its root; asynchronous update failures reach onError, while explicit flush failures throw.

The separate server entrypoint exports renderToString with the same setup callback and store/ID options. Supply a request-specific store for SSR. Server rendering retains no subscriptions and runs owner cleanup. Hydration reuses matching server nodes and IDs, attaches events, and recreates subscriptions. It requires the same initial state, component structure, and valid HTML on both sides; mismatches throw rather than silently remounting. Use explicit tbody elements in tables. Controlled form properties are applied during hydration.

The production build omits development diagnostics and invalid-input checks; the development export condition enables them. Pure render computations must not write state. Promise children, async components, portals, suspense, error boundaries, style objects, and automatic token-as-child bindings are outside this first implementation. Applications handle asynchronous data through atom.io state and synchronous conditional JSX.

## Astro

The integration transforms .hydrogen.tsx and .hydrogen.jsx files by default, so another JSX renderer can coexist. Configure include to change this filter. Top-level functions containing JSX are branded by the compiler for renderer detection.

```ts
import { defineConfig } from "astro/config"
import hydrogen from "hydrogen/astro"

export default defineConfig({ integrations: [hydrogen()] })

```

Each island gets an independent store copied from registered atom.io definitions. A component's optional createStore(props) factory initializes server and browser stores from the same serialized props. This is the state transport boundary; hydrogen does not serialize a whole store. Keep store factories deterministic and include only client-safe props. Custom factories can explicitly share a browser store when required.

```tsx
import { atom, Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import type { Child, VNode } from "hydrogen"
import { onCleanup, useId, useSetter, useValue } from "hydrogen"

const countAtom = atom<number>({ key: `count`, default: 0 })
export default function Counter(props: {
	initial: number
	children?: Child
	slots?: Record<string, Child>
}): VNode {
	const count = useValue(countAtom)
	const setCount = useSetter(countAtom)
	const id = useId()
	onCleanup(() => {
		/* Release imperative resources owned by this instance here. */
	})
	return (
		<section aria-labelledby={id}>
			<h2 id={id}>Counter</h2>
			{props.slots?.[`heading`]}
			{props.children}
			<button
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				{count()}
			</button>
		</section>
	)
}

// Astro calls this on the server and in the browser with the same serialized props.
Counter.createStore = (props: { initial: number }) => {
	const silo = new Silo(
		{ name: `counter-island`, lifespan: `ephemeral`, isProduction: true },
		IMPLICIT.STORE,
	)
	silo.setState(countAtom, props.initial)
	return silo.store
}

```

Astro client:load, client:idle, client:visible, client:media, and client:only use Astro's scheduling. The integration hydrates server markup or mounts client-only content and releases the root on astro:unmount. Default slot content arrives as children and named content through slots. Reserved astro-slot wrappers contain Astro's already-rendered HTML; never use their innerHTML escape hatch for untrusted strings.

Persisted islands receive live prop and slot updates without rerunning component setup or recreating their store. The store factory runs only when an island is first mounted; put changing values in props rather than relying on the factory to run again.

The checked Astro fixture demonstrates default/named slots and multiple independently initialized islands, including client:only.

## Size and verification

The build audits every browser export, including the JSX runtime, from the built JavaScript. Atom.io is an external peer in the incremental measurement. Compiler, server, and integration code have separate entrypoints. The report also includes the complete client plus atom.io, the Astro client entrypoint, and the installed Preact version under the same bundling/minification settings. These are full exported surfaces, not equivalent application benchmarks.

The hard budget is under 3,300 bytes of ordinary level-9 gzip for the complete client export surface. The build bundles with esbuild and minifies with Oxc, then measures compression using Node's gzip and Brotli implementations. The hydrogen client measures 3,245 bytes with gzip. Actual application bundles add atom.io and compiler-generated application code.

Build output includes the minified audit entrypoint and machine-readable dist/size.json. These audit files are a bundled measurement; use the package exports in applications so the bundler preserves one runtime instance across entrypoints. Source tests exercise development behavior; the production test executes the audited minified artifact. Chromium checks exercise the actual Astro build, island isolation, hydration, keyed identity, focus/selection, SVG namespaces, and teardown. A fresh-cache Astro development check also covers mount hooks, shared state, and ClientRouter navigation.

```sh
pnpm --filter hydrogen build
pnpm --filter hydrogen cov
pnpm --filter @atom.io/hydrogen-devtools cov
pnpm exec turbo run test:breakage:peers --filter=hydrogen --filter=@atom.io/hydrogen-devtools
pnpm --filter hydrogen test:production
pnpm --filter hydrogen exec playwright install chromium
pnpm --filter hydrogen test:browser
pnpm --filter hydrogen size
pnpm --filter hydrogen readme:check

```

## Package checks

Breakage exercises the packed package in isolated, locked peer environments, including the coordinated atom.io workspace candidate. Until the first published release, Breakage reports a first-release baseline; these checks establish compatibility with the declared peers rather than a previous hydrogen release. Coverage gates require 100% of statements, branches, functions, and lines across the package source.

Tonnage measures combined browser bundles containing Hydrogen and atom.io, with shared modules counted once and unused exports removed. The synchronous recipes include atom creation, useValue, useSetter, and JSX; the client recipe adds render, the hydration recipe adds hydrate, and the Astro recipe adds the browser island adapter. The async recipe uses useLoadable with render and useSetter. Hydrogen declares atom.io as a peer dependency; these consumer-app measurements include it in every total. Application components, Astro scheduling code, CSS, declarations, and source maps are excluded. The full-client gzip budget above remains a separate, Hydrogen-only audit.

## Browser serving sizes including atom.io

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Imported peer dependencies are bundled unless explicitly external, and shared modules are counted once per bundle.

| Recipe                       | Entry                             | Minified JS |  Gzip JS |
| ---------------------------- | --------------------------------- | ----------: | -------: |
| Async interactive client app | `tonnage-recipes/async-app.ts`    |    39,284 B | 12,253 B |
| Interactive client app       | `tonnage-recipes/client-app.ts`   |    38,949 B | 12,095 B |
| Hydrated interactive app     | `tonnage-recipes/hydrated-app.ts` |    38,950 B | 12,094 B |
| Interactive Astro island     | `tonnage-recipes/astro-island.ts` |    42,778 B | 13,259 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

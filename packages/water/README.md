# Water

An experimental JSX framework whose state engine is atom.io. Components run once per mounted instance. Calls to accessors inside compiled JSX subscribe the affected DOM computations; atom.io updates those computations without rerunning component setup.

This private workspace package is not published. Its browser runtime, Vite compiler, server renderer, and Astro integration are implemented here. It has no independent state primitive, effect API, React hook dispatcher, or compatibility layer.

## A point, not two signals

```tsx
import type { VNode } from "@atom.io/water"
import { useId, useRef, useSetter, useValue } from "@atom.io/water"
import { atom } from "atom.io"

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

Add the workspace package and atom.io to the application's dependencies. The water plugin is required: the ordinary TypeScript JSX transform cannot preserve live expressions. It compiles expressions into lazy child computations and property getters; it also preserves spread precedence and live component props.

```ts
import water from "@atom.io/water/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [water()] })

```

```json
{
	"compilerOptions": {
		"module": "ESNext",
		"moduleResolution": "bundler",
		"target": "ES2022",
		"jsx": "preserve",
		"jsxImportSource": "@atom.io/water",
		"strict": true
	}
}

```

```tsx
import { render } from "@atom.io/water"

import { PointEditor } from "./point.tsx"

const root = render(() => <PointEditor />, document.getElementById(`app`)!)
// Call root.dispose() when the application shell removes this root.
import.meta.hot?.dispose(root.dispose)

```

The development plugin uses full page reloads. Components and render computations are synchronous. Modern browsers with ES2022 and DOM Range support are the target.

## Component API

| API                   | Contract                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| useValue(token)       | Return a live accessor for an atom or selector, bound to this instance's store.                                          |
| useSetter(token)      | Return a stable atom.io writer.                                                                                          |
| useTimeline(token)    | Return an accessor for at, length, undo, redo, clear, and available grouped transaction controls.                        |
| useTransaction(token) | Bind an atom.io transaction, preserving its arguments and result.                                                        |
| useRef(token)         | Return an attachment callback for a nullable element atom. Clear it only while this attachment still owns the reference. |
| useId()               | Allocate an instance-stable ID using the root's prefix.                                                                  |
| onCleanup(callback)   | Register synchronous teardown with the current owner.                                                                    |
| onMount(callback)     | Run once after attachment and ref publication; omitted during server rendering.                                          |
| untrack(callback)     | Read current state without adding dependencies to the surrounding computation.                                           |

Call setup helpers synchronously during component setup or owned mount callbacks. Capture their results for event handlers. Tokens are fixed for an instance; use an application key in a reactive child expression to replace a component when its token changes. Component props stay live when read through the props object; destructuring during setup takes a snapshot.

Arrays support keyed components and elements. Reordering preserves instances and nodes; removed ranges release subscriptions, events, refs, and cleanup callbacks. Application keys must be unique among siblings. Unkeyed arrays use positions. A key identifies a row in a reactive child collection; it is not an independent reactive binding.

HTML and SVG use native DOM properties and attributes, plus className/htmlFor aliases. Events use onClick/onInput-style names, with Capture suffixes and onDoubleClick support. Styles are CSS strings. Mutable atom values still invalidate their consumers; project primitive fields for precise DOM writes. Refs attach once per element instance.

## Rendering and ownership

The client exports render and hydrate. Both accept a setup callback, a host Element, and optional store, idPrefix, and onError options, and return dispose and flush methods. Updates coalesce in a microtask; flush drains them synchronously. Dispose is idempotent and removes only owned nodes. Cleanup continues after individual cleanup failures and aggregates errors. A failed computation disposes its root; asynchronous update failures reach onError, while explicit flush failures throw.

The separate server entrypoint exports renderToString with the same setup callback and store/ID options. Supply a request-specific store for SSR. Server rendering retains no subscriptions and runs owner cleanup. Hydration reuses matching server nodes and IDs, attaches events, and recreates subscriptions. It requires the same initial state, component structure, and valid HTML on both sides; mismatches throw rather than silently remounting. Use explicit tbody elements in tables. Controlled form properties are applied during hydration.

The production build omits development diagnostics and invalid-input checks; the development export condition enables them. Pure render computations must not write state. Promise children, async components, portals, suspense, error boundaries, style objects, and automatic token-as-child bindings are outside this first implementation. Applications handle asynchronous data through atom.io state and synchronous conditional JSX.

## Astro

The integration transforms .water.tsx and .water.jsx files by default, so another JSX renderer can coexist. Configure include to change this filter. Top-level functions containing JSX are branded by the compiler for renderer detection.

```ts
import water from "@atom.io/water/astro"
import { defineConfig } from "astro/config"

export default defineConfig({ integrations: [water()] })

```

Each island gets an independent store copied from registered atom.io definitions. A component's optional createStore(props) factory initializes server and browser stores from the same serialized props. This is the state transport boundary; water does not serialize a whole store. Keep store factories deterministic and include only client-safe props. Custom factories can explicitly share a browser store when required.

```tsx
import type { Child, VNode } from "@atom.io/water"
import { onCleanup, useId, useSetter, useValue } from "@atom.io/water"
import { atom, Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"

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

The checked Astro fixture demonstrates default/named slots and multiple independently initialized islands, including client:only.

## Size and verification

The build audits every browser export, including the JSX runtime, from the built JavaScript. Atom.io is an external peer in the incremental measurement. Compiler, server, and integration code have separate entrypoints. The report also includes the complete client plus atom.io, the Astro client entrypoint, and the installed Preact version under the same bundling/minification settings. These are full exported surfaces, not equivalent application benchmarks.

The hard budget is under 3,000 bytes for dist/client.min.js.gz, an actual precompressed gzip artifact. The build bundles with esbuild, minifies with Oxc, and compresses with Zopfli (50 iterations), then verifies decompression. Ordinary Node gzip at level 9 and Brotli are reported separately. At the initial implementation, optimized gzip is 2,993 bytes and ordinary gzip is 3,040 bytes; an ordinary gzip server does **not** meet the 3,000-byte limit. Serving the emitted precompressed artifact or applying equivalent precompression is necessary for that figure. Actual application bundles add atom.io and compiler-generated application code.

Build output includes the minified audit entrypoint, gzip/Brotli artifacts, and machine-readable dist/size.json. These audit files are a bundled measurement; use the package exports in applications so the bundler preserves one runtime instance across entrypoints. Source tests exercise development behavior; the production test executes the audited minified artifact. Chromium checks exercise the actual Astro build, island isolation, hydration, keyed identity, focus/selection, SVG namespaces, and teardown.

```sh
pnpm --filter @atom.io/water build
pnpm --filter @atom.io/water test:once
pnpm --filter @atom.io/water test:production
pnpm --filter @atom.io/water exec playwright install chromium
pnpm --filter @atom.io/water test:browser
pnpm --filter @atom.io/water size
pnpm --filter @atom.io/water readme:check

```

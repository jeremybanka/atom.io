# resumability

Server-produced values that become browser defaults. A small Astro utility with no atom.io or SPA runtime or peer dependency. This resumes data; it does not serialize closures, replace hydration, or provide a server RPC endpoint.

## Astro setup

Install resumability alongside Astro. Import the default Astro integration as resumability and add it to astro.config.ts:

```ts
import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({ integrations: [resumability()] })

```

The integration owns a collection for each request, including native Astro frontmatter. It streams the page normally and emits completed values in an inert JSON sidecar before the closing body tag. Browser calls automatically harvest that sidecar; no state library or JSX renderer is required. Static builds use the same mechanism.

## A resumable constant

Define a shared reader for a value acquired from your database. Omitting a client producer makes its server value reusable for the lifetime of the browser application:

```ts
import { resumable } from "resumability"

export function warehouseName(): string | Promise<string> {
	return resumable({
		key: [`warehouse-name`, 1],
		server: async () => {
			const { DatabaseSync } = await import(`node:sqlite`)
			const database = new DatabaseSync(`inventory.sqlite`, { readOnly: true })
			try {
				return String(
					database.prepare(`SELECT name FROM warehouses WHERE id = ?`).get(1)![
						`name`
					],
				)
			} finally {
				database.close()
			}
		},
	})
}

```

Read it in page frontmatter and again in a browser script. The browser harvests the transported value, without opening the database or making another request:

```astro
---
import { warehouseName } from "./constant"
const name = await warehouseName()
---
<h1>{name}</h1>
<script>
import { warehouseName } from "./constant"
document.title = await warehouseName()
</script>

```

Keep the reader at module scope and invoke it during rendering. An eager module-level constant would run when the module loads, outside the request lifetime. The constant is a snapshot, not a live database subscription. Add a client producer when subsequent reads should fetch fresh data.

Only completed, awaited values are transported. Cache the complete HTML response with its sidecar. The middleware preserves streaming and aborts the collection when the response ends or the request disconnects. Seed data is public browser-visible JSON.

## Explicit Astro scopes

Define a shared function. The server closure can import Node-only modules; the browser build removes that entire closure before Vite discovers its imports. The client closure supplies fresh values after the initial harvest.

```ts
import type { Resumption } from "resumability"
import { resumable } from "resumability"

export function greeting(scope?: Resumption): string | Promise<string> {
	return resumable(
		{
			key: `greeting`,
			server: async () => {
				const { DatabaseSync } = await import(`node:sqlite`)
				const database = new DatabaseSync(`:memory:`)
				try {
					return String(
						database.prepare(`SELECT 'Hello from SQLite' AS message`).get()![
							`message`
						],
					)
				} finally {
					database.close()
				}
			},
			client: () => `Hello from the browser`,
		},
		scope,
	)
}

```

Render the initial value in a child Astro component, Value.astro:

```astro
---
import { greeting } from "./greeting"
const message = await greeting()
---
<output>{message}</output>
<button>Reset</button>

```

Use Resumption when a subtree needs an explicit scope instead of the page default. The wrapper collects values while rendering its slot, waits for registered producers, and emits an inert JSON sidecar before the slot HTML. Capture a browser scope once and pass it to subsequent calls:

```astro
---
import Resumption from "resumability/Resumption.astro"
import Value from "./Value.astro"
---
<Resumption><Value /></Resumption>
<script>
import { createResumption } from "resumability/client"
import { greeting } from "./greeting"

for (const element of document.querySelectorAll(`astro-resumption`)) {
	const scope = createResumption(element)
	const output = element.querySelector(`output`)!
	output.textContent = await greeting(scope) // Harvest the server value once.
	element.querySelector(`button`)!.addEventListener(`click`, async () => {
		output.textContent = await greeting(scope) // Run the client closure.
	})
	window.addEventListener(`pagehide`, () => scope.dispose(), { once: true })
}
</script>

```

Explicit scopes collect work performed while their slot renders. Parent-page frontmatter runs before that scope opens; place scoped reads in a child component. Plain Astro child frontmatter remains deferred until the slot renders. Await values before generating markup that uses them. The wrapper emits its sidecar before the slot markup. Other framework renderers need an adapter to coordinate asynchronous rendering and browser seed delivery; SPA provides that adapter automatically.

## Defaults and resets

| Situation                                | Result                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Server render                            | Run the server closure once per key within the collection.          |
| Browser has a seed and a client closure  | Consume the seed synchronously, without running the client closure. |
| Browser calls again after consumption    | Execute the client closure; it can return a fresh value or promise. |
| Browser has a seed and no client closure | Reuse the seed on every call, cloning its data before decoding.     |
| Browser has no seed                      | Execute the client closure, or throw if none was provided.          |

Consumption belongs to a key within one browser scope, not to a function identity. Astro owns the default browser scope across ClientRouter navigation, imports new sidecars without reseeding consumed keys, and bypasses unread client-capable seeds after navigation. Server-only constants retain their original seed. A full page load starts a new owner.

For custom scopes, capture one scope per owner and retain it across resets; recreating a scope from the DOM would harvest stale server values again. Different scopes remain independent, including when keys match. Scope.add(elementOrPayload) imports additional sidecars without reseeding keys already read. Dispose the scope when its owner ends to clear remaining values and abort its signal.

Keys are strings, finite numbers, booleans, null, or nested arrays of those values. They must be stable across server and browser and unique for a logical value within a scope. Reusing a key with different producers or codecs is a programming error. Object keys, undefined, sparse arrays, negative zero, and non-finite numbers are rejected.

## Atom defaults are one consumer

An atom can use the same reader as its default. Keep the definition at module scope:

```ts
import { atom, type Loadable } from "atom.io"

import { warehouseName } from "./constant.ts"

export const warehouseNameAtom = atom<Loadable<string>>({
	key: `warehouseName`,
	default: warehouseName,
})

```

Ordinary browser reads and resets resolve through Astro's host without changing atom.io's default evaluator. During SSR, use a request-local store and await the values used in markup. Resumability has no atom.io or SPA runtime or peer dependency.

With @atom.io/spa/astro installed, SPA awaits async state used by JSX and uses resumability's renderer adapter to attach seeds to each island. Private stores additionally bind their own resumption scope during default evaluation, so lazy reads and pending work end with that island. This ownership binding belongs to SPA; the resumption host knows nothing about stores. See the [SPA resumability guide](https://atom.io.fyi/docs/spa/astro#resumability) and spa-astro-ssr template.

## API and transport

The root export provides resumable(options, scope?). Options contain key, an inline server closure, an optional inline client closure, and an optional codec with encode and decode functions. Both producers receive an AbortSignal through their context. The server path returns a promise; a browser seed is returned synchronously. Client producers may return either. The browser uses an explicit scope when supplied, otherwise the currently active scope.run callback. SSR obtains its scope from the active collection.

The client entrypoint exports createResumption(elementOrPayload?) and resumable. Pass the wrapper element to read its direct sidecar, a parsed Payload for a custom transport, or no argument for a client-only scope. The returned scope has read, run, add, and dispose methods. Add validates the entire payload before merging it. Keys already read keep their consumption state; reusable server-only values keep their original seed. Unread keys can receive newer seeds. Scope.run(callback) activates its scope synchronously, restoring the previous scope even when the callback throws. It returns the callback result unchanged; it does not keep an ambient scope across await. Call resumable before awaiting, or pass an explicit scope for later asynchronous calls. Passing a second argument to scope.run with resume set to false bypasses unread seeds when a client producer is available. This supports fresh mounts after browser state changes: even a default reset before its first read must not resurrect stale server data. Server-only values remain usable because they have no client initializer. The option is scoped to that synchronous callback and restored after nested calls or errors. Producers receive their scope signal when invoked. Disposing a scope aborts that signal; another reset does not cancel an earlier request.

The server entrypoint exports collect and serialize, as well as resumable. Adapters can use createCollection(options?) with an optional signal for an owner-controlled scope and currentCollection() to honor a surrounding explicit scope. The scope provides run, collect, snapshot, dispose, and signal. Collect normally drains registered producers; its drain: false option captures a render without waiting for unrelated work elsewhere in the same request. Snapshot returns detached completed values and remains available after disposal so later islands can transport cached reads. Disposal aborts producers and prevents new reads. Collect accepts a callback and an optional cancellation signal, and returns the callback's value and a versioned payload, awaiting all registered work, including work registered by other producers after an await. Rejections fail collection; cancellation aborts it. Producers must finish or honor cancellation, and must not depend cyclically on one another. Detached work registered after collection closes is rejected. Server collection requires a Node-compatible runtime with AsyncLocalStorage; static Astro builds work too.

The default wire format accepts JSON data and top-level undefined. It rejects values JSON would silently change, including nested undefined, non-finite numbers, Dates, functions, symbols, and cycles. Supply a JSON codec for richer values. Encode runs on the server; decode runs on both sides so SSR and browser observe the same representation. Payloads are inert JSON with HTML terminators escaped, never executable scripts. Treat every transported value as public browser-visible data.

## Compiler boundary

Use a named import of resumable directly from resumability (an import alias is fine), and call it with an inline options object. Put server-only dynamic imports inside the inline server closure. Module-level imports are shared code and are not automatically made server-only. Namespace imports, passing resumable as a callback, options spreads, computed option keys, and referenced server functions are rejected by the browser transform. Do not re-export resumable through another module: the transform recognizes direct imports from this package.

The Astro integration installs the Vite transform for development and production and keeps the runtime out of dependency prebundling. It routes named browser resumable imports to resumability/astro-client, which prefers an explicit scope, then the active scope, then Astro's page scope. The core client entrypoint still supports explicit ownership for other hosts. Compiler and server entrypoints are never needed in the browser bundle. Standalone Vite integrations can use resumablePlugin from the Astro entrypoint and provide their own collection and sidecar transport.

Renderer authors can wrap an Astro server renderer with resumableRenderer from resumability/astro-server. Its optional isolate predicate selects a private collection; requestResumption exposes the host owner for adapters. On the browser side, resumability/astro-client exposes browserResumption(document) and captureElement(scope, element). Browser owners can invalidate initial seeds, register a resumeWhen predicate, capture incoming sidecars, and dispose. SPA uses these APIs while retaining responsibility for JSX rendering, stores, and island lifetimes.

## Size and checks

Tsdown builds the package JavaScript and declarations and copies the Astro wrapper into the published output. A separate size audit measures the complete browser runtime with ordinary level-9 gzip and enforces a 1,000-byte budget. Astro's compiler and server libraries do not contribute to the browser runtime. Application markup, handlers, Astro's own browser scripts, and payload data are additional.

Runtime, compiler, and Astro host coverage is gated at 100%. Chromium checks exercise plain Astro constants without any state library, ordinary atom defaults and resets without a store bridge, and independent explicit scopes in development and production. Browser code contains neither SQLite imports nor SPA. A separate SPA fixture verifies a database constant passed as JSX props and read by an ordinary browser script without application atoms. Packed-package checks validate exports, declarations, and transport without a renderer or atom.io.

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

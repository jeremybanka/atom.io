# @atom.io/resumable

Server-produced values that become browser defaults. A small Astro utility with no atom.io or SPA runtime or peer dependency. This resumes data; it does not serialize closures, replace hydration, or provide a server RPC endpoint.

## Astro setup

Install @atom.io/resumable alongside Astro. Add its integration to astro.config.ts:

```ts
import resumable from "@atom.io/resumable/astro"
import { defineConfig } from "astro/config"

export default defineConfig({ integrations: [resumable()] })

```

Define a shared function. The server closure can import Node-only modules; the browser build removes that entire closure before Vite discovers its imports. The client closure supplies fresh values after the initial harvest.

```ts
import type { Resumption } from "@atom.io/resumable"
import { resumable } from "@atom.io/resumable"

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

Wrap that component in Resumption. The wrapper collects values while rendering its slot, waits for registered producers, and appends an inert JSON sidecar. Capture a browser scope once and pass it to subsequent calls:

```astro
---
import Resumption from "@atom.io/resumable/Resumption.astro"
import Value from "./Value.astro"
---
<Resumption><Value /></Resumption>
<script>
import { createResumption } from "@atom.io/resumable/client"
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

Work that needs the collector must run inside the wrapper's slot, not in the parent page's frontmatter. Await values before generating markup that uses them. Waiting for the sidecar alone cannot update HTML a renderer has already generated. Framework islands need their own adapter or preparation step to feed the resolved values into SSR and pass the browser scope into their state; this package does not modify framework renderers.

## Defaults and resets

| Situation                                | Result                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Server render                            | Run the server closure once per key within the collection.          |
| Browser has a seed and a client closure  | Consume the seed synchronously, without running the client closure. |
| Browser calls again after consumption    | Execute the client closure; it can return a fresh value or promise. |
| Browser has a seed and no client closure | Reuse the seed on every call, cloning its data before decoding.     |
| Browser has no seed                      | Execute the client closure, or throw if none was provided.          |

Consumption belongs to a key within one browser scope, not to a function identity. Capture one scope per owner and retain it across resets; recreating a scope from the DOM would harvest stale server values again. Different wrappers and scopes remain independent, including when keys match. Dispose the scope when its owner is removed to clear remaining values and abort its signal. In an Astro client-router app, tie setup and disposal to that owner's navigation lifecycle.

Keys are strings, finite numbers, booleans, null, or nested arrays of those values. They must be stable across server and browser and unique for a logical value within a scope. Reusing a key with different producers or codecs is a programming error. Object keys, undefined, sparse arrays, negative zero, and non-finite numbers are rejected.

## Atom defaults are one consumer

The family default already receives its key, so it can close over that key in both producers. Capture the resumption scope when constructing the store:

```ts
import type { Resumption } from "@atom.io/resumable"
import { resumable } from "@atom.io/resumable"
import type { AtomFamilyToken, Loadable } from "atom.io"
import { Silo } from "atom.io"

export function createModel(scope?: Resumption): {
	silo: Silo
	draftAtoms: AtomFamilyToken<Loadable<string>, string>
} {
	const silo = new Silo({
		name: `drafts`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const draftAtoms = silo.atomFamily<Loadable<string>, string>({
		key: `draft`,
		default: (documentId) =>
			resumable(
				{
					key: [`draft`, documentId],
					server: async () => {
						const { readFile } = await import(`node:fs/promises`)
						return readFile(
							new URL(
								`./drafts/${encodeURIComponent(documentId)}.txt`,
								import.meta.url,
							),
							`utf8`,
						)
					},
					client: () => ``,
				},
				scope,
			),
	})
	return { silo, draftAtoms }
}

```

During SSR, construct a request-local model inside the collection and await its initial reads. In the browser, construct the model with createResumption's scope before reading atoms. The first read receives the server value; resetState evaluates the default again and gets the client value. No new atom effect or atom.io API is needed. Other state libraries and plain functions can use the same utility.

## API and transport

The root export provides resumable(options, scope?). Options contain key, an inline server closure, an optional inline client closure, and an optional codec with encode and decode functions. Both producers receive an AbortSignal through their context. The server path returns a promise; a browser seed is returned synchronously. Client producers may return either. The browser requires an explicit scope; SSR obtains its scope from the active collection.

The client entrypoint exports createResumption(elementOrPayload?) and resumable. Pass the wrapper element to read its direct sidecar, a parsed Payload for a custom transport, or no argument for a client-only scope. The returned scope has read and dispose methods.

The server entrypoint exports collect and serialize, as well as resumable. Collect accepts a callback and an optional cancellation signal, and returns the callback's value and a versioned payload, awaiting all registered work, including work registered by other producers after an await. Rejections fail collection; cancellation aborts it. Producers must finish or honor cancellation, and must not depend cyclically on one another. Detached work registered after collection closes is rejected. Server collection requires a Node-compatible runtime with AsyncLocalStorage; static Astro builds work too.

The default wire format accepts JSON data and top-level undefined. It rejects values JSON would silently change, including nested undefined, non-finite numbers, Dates, functions, symbols, and cycles. Supply a JSON codec for richer values. Encode runs on the server; decode runs on both sides so SSR and browser observe the same representation. Payloads are inert JSON with HTML terminators escaped, never executable scripts. Treat every transported value as public browser-visible data.

## Compiler boundary

Use a named import of resumable directly from @atom.io/resumable (an import alias is fine), and call it with an inline options object. Put server-only dynamic imports inside the inline server closure. Module-level imports are shared code and are not automatically made server-only. Namespace imports, passing resumable as a callback, options spreads, computed option keys, and referenced server functions are rejected by the browser transform. Do not re-export resumable through another module: the transform recognizes direct imports from this package.

The Astro integration installs the Vite transform for development and production and keeps the runtime out of dependency prebundling. Compiler and server entrypoints are never needed in the browser bundle. Standalone Vite integrations can use resumablePlugin from the Astro entrypoint and provide their own collection and sidecar transport.

## Size and checks

The build audits the complete browser runtime with ordinary level-9 gzip and enforces a 1,000-byte budget. Tonnage below measures browser exports and a serving suggestion that includes atom.io's family creation, reads, and resets; shared modules are counted once. Astro's compiler and server libraries do not contribute to these browser bundles. Application markup, handlers, Astro's own browser scripts, and payload data are additional.

## Browser serving sizes

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Imported peer dependencies are bundled unless explicitly external, and shared modules are counted once per bundle.

| Recipe                                 | Entry                         | Minified JS |  Gzip JS |
| -------------------------------------- | ----------------------------- | ----------: | -------: |
| Resumable browser defaults             | `tonnage-recipes/defaults.ts` |     1,199 B |    636 B |
| Atom family defaults including atom.io | `tonnage-recipes/atoms.ts`    |    35,124 B | 10,424 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

Runtime and compiler coverage is gated at 100%. The plain Astro fixture uses node:sqlite during SSR, then checks independent atom family defaults and repeated resets in Chromium against both development and production. It verifies that executable browser code contains neither SQLite imports nor SPA. Packed-package checks validate exports, declarations, and transport without a renderer or atom.io.

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

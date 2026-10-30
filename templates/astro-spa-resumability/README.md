# Astro + SPA + resumability

A starter showing server-loaded atom family defaults, SPA hydration, and fresh browser defaults on reset. It uses Astro, atom.io, @atom.io/spa, and resumability/astro. Requires Node 24.12 or newer for the SQLite example.

## Run

```sh
npm install
npm run dev

# Build and serve the production output.
npm run build
npm run preview

# Install the test browser, then verify production and development.
npx playwright install chromium
npm test

```

Inside the atom.io workspace:

```sh
pnpm exec turbo run build --filter=@atom.io/template-astro-spa-resumability...
pnpm --filter @atom.io/template-astro-spa-resumability dev

```

The workspace uses local unpublished packages; a packed release replaces workspace dependency ranges with published versions.

## Try it

Each workspace contains the same two document keys in a separate store and resumption scope. The initial notes come from SQLite. Typing updates an atom and its preview without rerunning component setup. Resetting a draft replaces it with a fresh value from the client closure; repeated resets increment that document's local revision. Other drafts and workspaces stay untouched.

Visit How it works and return. Astro's ClientRouter removes the old hosts, which dispose their SPA roots, atom members, and resumption scopes. Returning creates new stores and harvests the newly inserted page's sidecars.

This template uses Astro's default static output. SQLite runs at build time for production and on page requests in development. Production resets run in the browser; they do not issue database queries. An on-demand deployment needs an Astro adapter with a Node-compatible server runtime.

## Integrations

```ts
import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({ integrations: [resumability(), spa()] })

```

The SPA integration compiles the .spa.tsx components. The resumability integration removes inline server closures before browser import analysis, including their dynamic imports. No database module or SQLite query reaches the executable browser bundle.

## Atom defaults

```ts
import type { AtomFamilyToken, Loadable } from "atom.io"
import { Silo } from "atom.io"
import type { Resumption } from "resumability"
import { resumable } from "resumability"

export interface Draft {
	title: string
	body: string
	source: `server` | `client`
	revision: string
}
export const documentIds = [1, 2] as const
export interface Model {
	silo: Silo
	draftAtoms: AtomFamilyToken<Loadable<Draft>, number>
	prepare(): Promise<void>
	dispose(): void
}

export function createModel(scope?: Resumption): Model {
	const silo = new Silo({
		name: `drafts`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const resets = new Map<number, number>()
	const draftAtoms = silo.atomFamily<Loadable<Draft>, number>({
		key: `draft`,
		default: (id) =>
			resumable(
				{
					key: [`draft`, id],
					server: async ({ signal }) => {
						const { readDraft } = await import(`./database.server.ts`)
						signal.throwIfAborted()
						return readDraft(id)
					},
					client: () => {
						const count = (resets.get(id) ?? 0) + 1
						resets.set(id, count)
						return {
							title: `Draft ${id}`,
							body: `Fresh browser draft ${id}, reset ${count}.`,
							source: `client`,
							revision: `client:${id}:${count}`,
						}
					},
				},
				scope,
			),
	})
	return {
		silo,
		draftAtoms,
		async prepare() {
			await Promise.all(documentIds.map((id) => silo.getState(draftAtoms, id)))
		},
		dispose() {
			for (const id of documentIds) silo.disposeState(draftAtoms, id)
		},
	}
}

```

The atom family passes its key into the default closure. Each resumable key combines the family name and document ID. The first browser read consumes the server value; the next default evaluation runs the client closure. Family reset counters belong to the model, so they remain independent between islands.

## The template's adapter

The current SPA Astro renderer creates its store synchronously. This example supplies an explicit preparation and hydration adapter in the template rather than changing either library:

- Resumption wraps each DraftIsland and collects server values in its async scope.
- DraftIsland.astro constructs a request-local model, awaits its initial atom reads, then calls SPA's renderToString with that prepared store.
- Resumption appends the versioned JSON sidecar after the rendered slot.
- island.ts captures one browser resumption scope, constructs the model, and calls SPA's hydrate against the existing DOM. It retains that model and scope for resets.
- The custom element's disconnect callback disposes subscriptions and clears the scope when Astro removes it.

This adapter hydrates eagerly and does not use Astro's client:load or client:visible directives. Treat it as a small application adapter for this example, not a general SPA island renderer. Keep one Resumption wrapper per independently owned store. Put richer server values through an explicit codec, and treat all sidecar data as public browser-visible data.

## Validation

The browser check runs against both the production build and the Astro dev server. It holds JavaScript loading to inspect real SSR content, then verifies that hydration preserves the same textarea nodes and IDs. It checks reactive edits, repeated resets, isolation between family members and islands, ClientRouter cleanup and re-entry, and the absence of server modules in browser scripts. Browser exceptions fail the check.

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

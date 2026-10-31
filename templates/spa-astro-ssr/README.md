# SPA + Astro SSR

A starter with module-scoped atom definitions, server-rendered Astro islands, and typed database refreshes. It uses atom.io, @atom.io/spa, resumability/astro, Reylo over node:sqlite, and tRPC. Requires Node 24.12 or newer and TypeScript 7.1's content mappers (currently beta).

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
pnpm exec turbo run build --filter=@atom.io/template-spa-astro-ssr...
pnpm --filter @atom.io/template-spa-astro-ssr dev

```

The workspace uses local unpublished packages; a packed release replaces workspace dependency ranges with published versions. Development, build, and typecheck commands initialize drafts.sqlite from schema.sql and insert missing example rows without overwriting edits. Reylo checks queries against that schema using .reylo.yaml. The generated database is ignored by Git and excluded from the package.

This is an on-demand Node server application. The Astro Node adapter serves both pages and the tRPC endpoint. Start production from the template directory so it can find drafts.sqlite; supply persistent storage for that file when deploying. Initialize the database before starting a new deployment.

## Rendering and caching

The starter uses on-demand SSR with Astro’s built-in memoryCache provider. The public drafts page has a 60-second TTL and no stale-while-revalidate window. A cache miss reads SQLite in a request-owned store and caches the complete HTML response, including its resumption sidecar. Hits reuse that snapshot; the first request after expiry renders a new one. There are no prerendered pages. The tRPC endpoint is outside the cached route rule and returns Cache-Control: no-store, so resets always read the database.

The cache belongs to one server process: it is lost on restart and is not shared across replicas. This is a small, self-contained deployment default; choose an infrastructure-backed provider when multiple instances need shared caching or invalidation. Astro disables caching in development. Build and preview the template to exercise the production cache.

This template’s example data is public. When adapting it, cache the complete HTML response together with its resumption sidecar. The markup and initial values must come from the same render. Choose a freshness window and invalidation policy that match the data; do not cache a live atom.io store or reuse it across requests. Cache only responses whose data can be shared by everyone using the cache entry. Personalized snapshots need private caching or a correctly scoped cache key.

The initial browser load consumes that snapshot without immediately refetching it. Expiring or invalidating the server cache affects future page loads, not an already running browser store. Keep the explicit reset/tRPC path fresh so Refresh from database can fetch the current row. ClientRouter navigation continues to preserve live browser state rather than replacing edits with another server snapshot.

SSG is also compatible with resumption: the sidecar is produced during the build and remains that snapshot until the next deployment. Use it for routes whose freshness can follow deployments, while retaining on-demand API routes for resets. Astro's [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) and [route caching](https://docs.astro.build/en/guides/caching/) documentation describe the route-level controls and cache providers.

## Try it

Both views use the same two module-scoped document tokens in one browser store and resumption scope. The initial notes come directly from SQLite during SSR. The first island hydrates its existing DOM without making an RPC request. Type into a draft before scrolling to the second view: that delayed island mounts fresh and immediately shows the edit. Typing or refreshing a document updates both views; other documents retain their values. Refresh from database resets the atom, whose client closure calls tRPC for the latest row. The returned revision identifies that read.

Visit How it works and return. Astro's ClientRouter removes the old DOM and SPA releases the island subscriptions, while the application store and resumption scope stay alive. Returning islands render fresh from those live values, so an incoming server response cannot overwrite your edits. Refresh explicitly to fetch new server data. A full page load starts a new application from SSR again. Shared client requests receive the application scope's AbortSignal; navigation keeps that scope alive, while a full page exit aborts it. Resetting does not cancel earlier requests by itself.

## Integrations

```ts
import node from "@astrojs/node"
import spa from "@atom.io/spa/astro"
import { defineConfig, memoryCache } from "astro/config"
import resumability from "resumability/astro"
import reylo from "reylo/vite"

export default defineConfig({
	output: `server`,
	adapter: node({ mode: `standalone` }),
	cache: { provider: memoryCache() },
	routeRules: {
		// Cache the public HTML and its resumption sidecar as one snapshot.
		[`/`]: { maxAge: 60 },
	},
	integrations: [resumability(), spa()],
	vite: { plugins: [reylo()] },
})

```

SPA compiles the .spa.tsx components. Resumability removes inline server closures before browser import analysis, including their dynamic imports. Reylo compiles SQL imports on the server. The browser imports the tRPC router only as a type: no database module, query, or router implementation reaches executable browser code.

## One query, two entry points

```sql
SELECT id, title, body FROM drafts WHERE id = :id;

```

```ts
import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import readDraftQuery from "./read-draft.sql"

/** Both SSR and tRPC use this function and its inferred query result. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- Infer the response from Reylo's content-mapped SQL type; tsc verifies the full RPC contract.
export function readDraft(id: number) {
	const database = new DatabaseSync(`drafts.sqlite`, { readOnly: true })
	try {
		const draft = readDraftQuery.runSync(database, { id })
		if (!draft) throw new Error(`Draft ${id} does not exist`)
		return { ...draft, revision: randomUUID() }
	} finally {
		database.close()
	}
}

```

SSR calls readDraft directly. The tRPC procedure validates its input and calls the same function:

```ts
import { initTRPC } from "@trpc/server"
import { z } from "zod"

import { readDraft } from "./drafts.ts"

const t = initTRPC.create()
export const appRouter = t.router({
	drafts: t.router({
		get: t.procedure
			.input(z.object({ id: z.number().int().positive() }))
			.query(({ input }) => readDraft(input.id)),
	}),
})
export type AppRouter = typeof appRouter

```

Reylo infers the row type from SQL and the database schema. The return type flows through the router into the client and atom, without a handwritten response DTO. The type check uses TypeScript's runExternalCode flag to run Reylo's content mapper.

## Module-scoped atom defaults

```ts
import { atomFamily, type Loadable } from "atom.io"
import { resumable } from "resumability"

import { api, type Draft } from "./api.ts"

export const documentIds = [1, 2] as const

export const draftAtoms = atomFamily<Loadable<Draft>, number, Error>({
	key: `draft`,
	default: (id) =>
		resumable({
			key: [`draft`, id],
			server: async ({ signal }) => {
				const { readDraft } = await import(`./server/drafts.ts`)
				signal.throwIfAborted()
				return readDraft(id)
			},
			client: ({ signal }) => api.drafts.get.query({ id }, { signal }),
		}),
	catch: [Error],
})

```

The family key supplies the query input and resumability key. Atom definitions live on the module graph. All browser views share values; each SSR request has its own store. First browser reads consume the seed. Subsequent defaults use tRPC, with errors available through useLoadable for retry.

## Normal Astro islands

```astro
---
import Resumption from "resumability/Resumption.astro"
import Drafts from "../Drafts.spa.tsx"
import Page from "../layouts/Page.astro"
---
<Page title="Your drafts">
	<Resumption>{() => (
		<>
			<header class="intro">
				<p class="eyebrow">A server head start</p>
				<h1>Pick up where the server left off.</h1>
				<p>
					These notes arrive from SQLite. Edit one, or refresh it from the
					database. Both views share the same atom.io state.
				</p>
			</header>
			<section class="workspace" aria-labelledby="work-heading">
				<h2 id="work-heading">Your editor <small>Loads immediately</small></h2>
				<Drafts id="work" client:load />
			</section>
			<section class="workspace" aria-labelledby="personal-heading">
				<h2 id="personal-heading">
					Another view <small>Same shared documents · loads when visible</small>
				</h2><Drafts id="personal" client:visible />
			</section>
		</>
	)}</Resumption>
</Page>

```

The first workspace uses client:load; the second uses client:visible. Both render their initial data on the server. Deferred child functions keep Astro's eager framework-slot evaluation inside Resumption's async collection scope. One Resumption wrapper covers both views and collects each document once. Its sidecar precedes all the islands, so either can activate first. Keep the wrapper around page content inside the HTML body, not around the document itself.

Drafts.prepareStore initializes the store already selected by SPA:

```ts
import type { AstroStorePreparation } from "@atom.io/spa/astro"
import { getFromStore } from "atom.io/internal"
import { createResumption } from "resumability/client"
import { documentIds, draftAtoms } from "./model.ts"

export const prepareDrafts: AstroStorePreparation = async (
	store,
	_props,
	{ element, application },
) => {
	if (element) {
		const scope = application.get(createResumption, () => {
			const created = createResumption()
			application.onCleanup(created.dispose)
			store.runDefault = (run) =>
				created.run(run, { resume: application.canResume })
			return created
		})
		scope.add(element.closest(`astro-resumption`)!)
	}
	await Promise.all(documentIds.map((id) => getFromStore(store, draftAtoms, id)))
}

```

On the server, Resumption's async collection supplies the scope. In the browser, application.get creates one resumption scope and registers its cleanup once. Each preparation adds the surrounding sidecar; consumed keys cannot be reseeded. Store.runDefault activates that scope whenever a default executes, including lazy family members and transactional resets. Application.canResume controls whether unread seeds may initialize client-capable defaults: after an edit or navigation, those defaults use the client path. The callback awaits the initial reads before rendering or hydration. There are no model factories, model props, or store-to-model registries.

SPA owns the request lifetime through the end of streaming and the browser application lifetime across navigation. Individual islands own only their DOM and subscriptions. Shared preparation resources survive an individual island failing or unmounting. Resumability stays independent of SPA, atom.io, Reylo, and tRPC. Treat all sidecar data as public browser-visible data.

## Validation

The browser check runs against both the production Node server and the Astro dev server. It inspects real SSR content, verifies that initial hydration preserves textarea nodes and IDs while a delayed island replaces stale DOM, and asserts zero RPC requests during hydration. In production, it verifies byte-identical cached HTML and sidecars after SQLite changes, waits for the real 60-second TTL to expire, and checks that a new snapshot is rendered and cached. Development checks verify fresh SSR instead. Repeated resets fetch changed rows through tRPC with no-store headers, including after resuming an older cached snapshot; resets do not rewrite the page cache. It also checks shared document state, client:load and client:visible scheduling, fresh mounts and preserved edits after navigation, and removal of server modules from browser scripts. Browser exceptions fail the check. Type tests reject invalid RPC input and verify the inferred response fields.

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

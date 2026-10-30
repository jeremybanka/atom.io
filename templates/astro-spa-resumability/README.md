# Astro + SPA + resumability

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
pnpm exec turbo run build --filter=@atom.io/template-astro-spa-resumability...
pnpm --filter @atom.io/template-astro-spa-resumability dev

```

The workspace uses local unpublished packages; a packed release replaces workspace dependency ranges with published versions. Development, build, and typecheck commands initialize drafts.sqlite from schema.sql and insert missing example rows without overwriting edits. Reylo checks queries against that schema using .reylo.yaml. The generated database is ignored by Git and excluded from the package.

This is an on-demand Node server application. The Astro Node adapter serves both pages and the tRPC endpoint. Start production from the template directory so it can find drafts.sqlite; supply persistent storage for that file when deploying. Initialize the database before starting a new deployment.

## Try it

Each workspace uses the same two document keys in a separate store and resumption scope. The initial notes come directly from SQLite during SSR. Hydration consumes the sidecar without making an RPC request. Typing updates the local atom and its preview. Refresh from database resets the atom; its client closure calls tRPC for the latest row. The returned revision identifies that read. Other drafts and workspaces retain their local values.

Visit How it works and return. Astro's ClientRouter removes the old islands; SPA runs their cleanup callbacks and disposes the resumption scopes. Returning creates new stores from fresh server reads. The client request receives the scope's AbortSignal so navigation can cancel pending network work. A reset does not cancel earlier requests by itself.

## Integrations

```ts
import node from "@astrojs/node"
import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"
import resumability from "resumability/astro"
import reylo from "reylo/vite"

export default defineConfig({
	output: `server`,
	adapter: node({ mode: `standalone` }),
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

The family key supplies the query input and resumability key. Atom definitions live on the module graph; independent stores own the values. First browser reads consume the seed. Subsequent defaults use tRPC, with errors available through useLoadable for retry.

## Normal Astro islands

```astro
---
import Resumption from "resumability/Resumption.astro"
import Drafts from "../Drafts.spa.tsx"
import Page from "../layouts/Page.astro"
---
<Page title="Your drafts">
	<header class="intro">
		<p class="eyebrow">A server head start</p>
		<h1>Pick up where the server left off.</h1>
		<p>
			These notes arrive from SQLite. Edit one, or refresh it from the database.
			Each workspace keeps its own state.
		</p>
	</header>
	<section class="workspace" aria-labelledby="work-heading">
		<h2 id="work-heading">Work notes <small>Workspace one</small></h2><Resumption
		>{() => <Drafts id="work" client:load />}</Resumption>
	</section>
	<section class="workspace" aria-labelledby="personal-heading">
		<h2 id="personal-heading">
			Personal notes <small>Workspace two · same document keys</small>
		</h2><Resumption>{() => <Drafts id="personal" client:visible />}</Resumption>
	</section>
</Page>

```

The first workspace uses client:load; the second uses client:visible. Both render their initial data on the server. Deferred child functions keep Astro's eager framework-slot evaluation inside Resumption's async collection scope. Each independently owned store has its own Resumption wrapper.

Drafts.prepareStore initializes the store already selected by SPA:

```ts
import type { AstroStorePreparation } from "@atom.io/spa/astro"
import { disposeFromStore, getFromStore } from "atom.io/internal"
import { createResumption } from "resumability/client"

import { documentIds, draftAtoms } from "./model.ts"

/** Bind the island's initialization scope, then read its initial data. */
export const prepareDrafts: AstroStorePreparation = async (
	store,
	_props,
	context,
) => {
	if (context.element) {
		const scope = createResumption(context.element.closest(`astro-resumption`)!)
		store.runDefault = scope.run
		context.onCleanup(scope.dispose)
	}
	context.onCleanup(() => {
		for (const id of documentIds) disposeFromStore(store, draftAtoms, id)
	})
	await Promise.all(documentIds.map((id) => getFromStore(store, draftAtoms, id)))
}

```

On the server, Resumption's async collection supplies the scope. In the browser, store.runDefault activates the captured scope whenever a default executes, including lazy family members and transactional resets. The callback awaits the initial reads before rendering or hydration and registers cleanup for the atoms and scope. There are no model factories, model props, or store-to-model registries.

SPA owns cancellation and cleanup after SSR, failed initialization, and island removal. Resumability stays independent of SPA, atom.io, Reylo, and tRPC. Treat all sidecar data as public browser-visible data.

## Validation

The browser check runs against both the production Node server and the Astro dev server. It inspects real SSR content, verifies that hydration preserves textarea nodes and IDs, and asserts zero RPC requests during hydration. It changes SQLite after SSR and checks that repeated resets fetch the changed rows through tRPC. It also checks family and island isolation, client:load and client:visible scheduling, navigation cleanup, and removal of server modules from browser scripts. Browser exceptions fail the check. Type tests reject invalid RPC input and verify the inferred response fields.

## License

MPL-2.0 or later. See [LICENSE](./LICENSE).

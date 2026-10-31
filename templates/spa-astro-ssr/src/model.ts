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

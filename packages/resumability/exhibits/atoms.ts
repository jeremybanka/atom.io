import { atomFamily, type Loadable } from "atom.io"
import { resumable } from "resumability"

export const draftAtoms = atomFamily<Loadable<string>, string>({
	key: `draft`,
	default: (documentId) =>
		resumable({
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
		}),
})

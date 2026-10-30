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

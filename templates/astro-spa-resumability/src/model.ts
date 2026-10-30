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

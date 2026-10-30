import type { Resumption } from "@atom.io/resumable"
import { resumable } from "@atom.io/resumable"
import type { AtomFamilyToken, Loadable } from "atom.io"
import { Silo } from "atom.io"

export function createModel(scope?: Resumption): {
	silo: Silo
	productAtoms: AtomFamilyToken<Loadable<string>, number>
} {
	const silo = new Silo({
		name: `resumable-fixture`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	let refresh = 0
	const productAtoms = silo.atomFamily<Loadable<string>, number>({
		key: `product`,
		default: (id) =>
			resumable(
				{
					key: [`product`, id],
					server: async () => {
						const { readProduct } = await import(`./database.server`)
						return readProduct(id)
					},
					client: () => `client:${id}:${++refresh}`,
				},
				scope,
			),
	})
	return { silo, productAtoms }
}

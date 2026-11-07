import { atomFamily, type Loadable } from "atom.io"
import { resumable } from "resumability"

import { api, type Product } from "./api.ts"

export const productIds = [1, 2] as const

export const productAtoms = atomFamily<Loadable<Product>, number, Error>({
	key: `product`,
	default: (id) =>
		resumable({
			key: [`product`, id],
			server: async ({ signal }) => {
				const { readProduct } = await import(`./server/inventory.ts`)
				signal.throwIfAborted()
				return readProduct(id)
			},
			client: ({ signal }) => api.inventory.get.query({ id }, { signal }),
		}),
	catch: [Error],
})

export const saveStatusAtoms = atomFamily<
	{ saving: boolean; message: string },
	number
>({
	key: `saveStatus`,
	default: { saving: false, message: `` },
})

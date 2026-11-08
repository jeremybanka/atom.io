import { resumable } from "resumability"

let refresh = 0
export function constant(): string | Promise<string> {
	return resumable({
		key: `constant`,
		server: async () => {
			const { readProduct } = await import(`./database.server.ts`)
			return readProduct(99)
		},
	})
}
export function product(): string | Promise<string> {
	return resumable({
		key: `product`,
		server: async () => {
			const { readProduct } = await import(`./database.server.ts`)
			return readProduct(2)
		},
		client: () => `browser:${++refresh}`,
	})
}

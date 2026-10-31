import { resumable } from "../src/server.ts"
import type { Resumption } from "../src/types.ts"

export function contracts(scope: Resumption): void {
	const read: number | Promise<number> = resumable(
		{ key: [`item`, 0, false, null], server: () => 1, client: () => 2 },
		scope,
	)
	void read
	void resumable({
		key: `date`,
		server: () => new Date(),
		codec: {
			encode: (value) => value.toISOString(),
			decode: (text: string) => new Date(text),
		},
	})
	// @ts-expect-error Client defaults must return the server value type.
	void resumable({ key: `number`, server: () => 1, client: () => `wrong` })
	// @ts-expect-error Object keys are not canonical.
	void resumable({ key: { id: 1 }, server: () => 1 })
	// @ts-expect-error A server closure is required in authored code.
	void resumable({ key: `missing`, client: () => 1 })
	void resumable({
		key: `date`,
		server: () => new Date(),
		// @ts-expect-error Codecs must reconstruct the value type.
		codec: { encode: () => `date`, decode: () => 1 },
	})
}

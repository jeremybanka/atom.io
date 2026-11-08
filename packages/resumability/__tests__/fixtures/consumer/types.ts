import type { Resumption } from "resumability"
import { resumable } from "resumability"
import { createResumption } from "resumability/client"
import {
	collect,
	createCollection,
	currentCollection,
	serialize,
	type ServerCollection,
} from "resumability/server"

export async function contracts(scope: Resumption): Promise<void> {
	const number: number | Promise<number> = resumable(
		{ key: [`n`, 1], server: () => 1, client: () => 2 },
		scope,
	)
	void number
	const { payload } = await collect(() =>
		resumable({
			key: `date`,
			server: () => new Date(),
			codec: {
				encode: (date) => date.toISOString(),
				decode: (text: string) => new Date(text),
			},
		}),
	)
	const owned: ServerCollection = createCollection({
		signal: new AbortController().signal,
	})
	const current: ServerCollection | undefined = currentCollection()
	const rendered = await owned.collect(() => 1, { drain: false })
	const value: number = rendered.value
	void [current, value]
	owned.dispose()
	const text: string = serialize(payload)
	void text
	createResumption(payload).dispose()
	// @ts-expect-error Client defaults must match the server value.
	void resumable({ key: `number`, server: () => 1, client: () => `wrong` })
	// @ts-expect-error Object keys are not canonical.
	void resumable({ key: { id: 1 }, server: () => 1 })
}

import { parse, stringify } from "devalue"

import type { DevtoolsStoreMessage } from "./remote.ts"

export const DEVTOOLS_SOCKET_PROTOCOL = `atom-io-devtools-v1`

const reducers = {
	Error: (value: unknown) =>
		value instanceof Error && { name: value.name, message: value.message },
	Blob: (value: unknown) => value instanceof Blob && value.constructor.name,
}

export function prepareStandaloneValue(value: unknown): unknown {
	if (value === null || typeof value !== `object`) return value
	try {
		stringify(value, reducers)
		return value
	} catch {
		return new Error(`Value could not be displayed in the standalone viewer`)
	}
}

export function encodeStandaloneFrame(frame: DevtoolsStoreMessage): string {
	return stringify(frame, reducers)
}

export function decodeStandaloneFrame(data: string): DevtoolsStoreMessage {
	return parse(data, {
		Error: ({ name, message }: { name: string; message: string }) =>
			Object.assign(new Error(message), { name }),
		Blob: (name: string) =>
			new Error(name + ` contents are unavailable in the standalone viewer`),
	}) as DevtoolsStoreMessage
}

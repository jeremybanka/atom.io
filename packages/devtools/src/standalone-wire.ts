import { parse, stringify } from "devalue"

import type { DevtoolsStoreMessage } from "./remote.ts"

export function encodeStandaloneFrame(frame: DevtoolsStoreMessage): string {
	return stringify(frame, {
		Error: (value: unknown) =>
			value instanceof Error && { name: value.name, message: value.message },
		Blob: (value: unknown) => value instanceof Blob && value.constructor.name,
	})
}

export function decodeStandaloneFrame(data: string): DevtoolsStoreMessage {
	return parse(data, {
		Error: ({ name, message }: { name: string; message: string }) =>
			Object.assign(new Error(message), { name }),
		Blob: (name: string) =>
			new Error(name + ` contents are unavailable in the standalone viewer`),
	}) as DevtoolsStoreMessage
}

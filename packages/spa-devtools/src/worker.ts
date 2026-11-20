import type { Silo } from "atom.io"

import { messagePortTransport } from "./message-port.ts"
import {
	type DevtoolsExposureOptions,
	exposeDevtoolsStore as exposeRemoteStore,
} from "./remote.ts"

export type {
	DevtoolsExposureOptions,
	DevtoolsState as WorkerDevtoolsState,
	DevtoolsPrimitive as WorkerDevtoolsValue,
} from "./remote.ts"

/** Expose a Silo over an owned MessagePort with the same access policy as other transports. */
export function exposeDevtoolsStore(
	port: MessagePort,
	silo: Silo,
	options?: DevtoolsExposureOptions,
): () => void {
	return exposeRemoteStore(messagePortTransport(port), silo, options)
}

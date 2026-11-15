import { employSocket, isRigidRecord } from "@atom.io/realtime"
import type * as AtomIO from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { IMPLICIT, type Transceiver } from "atom.io/internal"

import { provideMutableStream } from "./provide-mutable-stream.ts"
import type { ServerConfig } from "./server-connection-types.ts"

export type MutableProvider = ReturnType<typeof realtimeMutableProvider>
export function realtimeMutableProvider({
	socket,
	store = IMPLICIT.STORE,
}: ServerConfig) {
	return function mutableProvider<
		Core extends Transceiver<any, Json.Serializable, Json.Serializable>,
	>(token: AtomIO.MutableAtomToken<Core>): () => void {
		let stopStream: (() => void) & { resnapshot?: () => void } = () => {}
		let subscription: string | null = null
		const stopSub = employSocket(socket, `sub:${token.key}`, (metadata) => {
			const nextSubscription =
				isRigidRecord(metadata) &&
				metadata[`protocol`] === `rigid-mutable-v1` &&
				typeof metadata[`subscription`] === `string`
					? metadata[`subscription`]
					: null
			if (nextSubscription !== null && nextSubscription === subscription) {
				stopStream.resnapshot?.()
				return
			}
			subscription = nextSubscription
			stopStream()
			stopStream = provideMutableStream(store, socket, token, metadata)
		})
		const stopUnsub = employSocket(socket, `unsub:${token.key}`, () => {
			subscription = null
			stopStream()
			stopStream = () => {}
		})
		return () => {
			stopSub()
			stopUnsub()
			stopStream()
		}
	}
}

import { isRigidRecord, type Socket } from "@atom.io/realtime"
import type { MutableAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	getFromStore,
	getJsonTokenFromStore,
	getUpdateToken,
	type Store,
	subscribeToState,
	type Transceiver,
} from "atom.io/internal"

export type MutableStream = (() => void) & { resnapshot(): void }

/** Raw clients and versioned clients can coexist on different connections. */
export function provideMutableStream(
	store: Store,
	socket: Socket,
	token: MutableAtomToken<
		Transceiver<any, Json.Serializable, Json.Serializable>
	>,
	metadata: unknown,
): MutableStream {
	const subscription =
		isRigidRecord(metadata) &&
		metadata[`protocol`] === `rigid-mutable-v1` &&
		typeof metadata[`subscription`] === `string` &&
		metadata[`subscription`].length <= 256
			? metadata[`subscription`]
			: null
	const epoch = crypto.randomUUID()
	let revision = 0
	const jsonToken = getJsonTokenFromStore(store, token)
	const send = (event: `init` | `next`, value: Json.Serializable): void => {
		socket.emit(
			`${event}:${token.key}`,
			subscription === null
				? value
				: { protocol: `rigid-mutable-v1`, subscription, epoch, revision, value },
		)
	}
	const stop = subscribeToState(
		store,
		getUpdateToken(token),
		`mutable-stream:${socket.id}:${epoch}`,
		({ newValue }) => {
			revision++
			send(`next`, newValue)
		},
	)
	try {
		send(`init`, getFromStore(store, jsonToken))
	} catch (error) {
		stop()
		throw error
	}
	return Object.assign(stop, {
		resnapshot: () => {
			send(`init`, getFromStore(store, jsonToken))
		},
	})
}

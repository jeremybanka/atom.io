import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import { findInStore, setIntoStore, type Store } from "atom.io/internal"
import { employSocket, type Socket } from "atom.io/realtime"

import { createSubscriber } from "./create-subscriber.ts"

export function pullAtomFamilyMember<
	J extends Json.Serializable,
	K extends Canonical,
>(
	store: Store,
	socket: Socket,
	family: AtomIO.AtomFamilyToken<J, K, any>,
	key: NoInfer<K>,
): () => void {
	const token = findInStore(store, family, key)
	return createSubscriber(socket, token.key, () => {
		const stopWatching = employSocket(
			socket,
			`serve:${token.key}`,
			(data: J) => {
				setIntoStore(store, token, data)
			},
		)
		socket.emit(`sub:${family.key}`, key)
		return () => {
			socket.emit(`unsub:${token.key}`)
			stopWatching()
		}
	})
}

import {
	employSocket,
	type Socket,
	type VersionedMutablePullOptions,
} from "@atom.io/realtime"
import type * as AtomIO from "atom.io"
import type { AsJSON, SignalFrom, Store, Transceiver } from "atom.io/internal"
import {
	getJsonTokenFromStore,
	getUpdateToken,
	setIntoStore,
} from "atom.io/internal"

import { createSubscriber, getSubMap } from "./create-subscriber.ts"
import { pullVersionedMutable } from "./pull-versioned-mutable.ts"

export function pullMutableAtom<T extends Transceiver<any, any, any>>(
	store: Store,
	socket: Socket,
	token: AtomIO.MutableAtomToken<T>,
	options?: VersionedMutablePullOptions<AsJSON<T>, SignalFrom<T>>,
): () => void {
	if (options)
		return pullVersionedMutable(
			store,
			socket,
			token,
			(metadata) => {
				socket.emit(`sub:${token.key}`, metadata)
			},
			options,
		)
	if (getSubMap(socket).has(`versioned-mutable:${token.key}`))
		throw new Error(
			`Cannot mix raw and versioned mutable consumers for one socket/token`,
		)
	const jsonToken = getJsonTokenFromStore(store, token)
	const updateToken = getUpdateToken(token)
	return createSubscriber(socket, token.key, () => {
		const stopWatchingForInit = employSocket(
			socket,
			`init:${token.key}`,
			(data: AsJSON<T>) => {
				setIntoStore(store, jsonToken, data)
			},
		)
		const stopWatchingForUpdate = employSocket(
			socket,
			`next:${token.key}`,
			(data: SignalFrom<T>) => {
				setIntoStore(store, updateToken, data)
			},
		)
		socket.emit(`sub:${token.key}`)
		return () => {
			socket.emit(`unsub:${token.key}`)
			stopWatchingForInit()
			stopWatchingForUpdate()
		}
	})
}

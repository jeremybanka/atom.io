import {
	employSocket,
	type Socket,
	type VersionedMutablePullOptions,
} from "@atom.io/realtime"
import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { stringifyJson } from "atom.io/foundations/json"
import type { AsJSON, SignalFrom, Store, Transceiver } from "atom.io/internal"
import {
	findInStore,
	getJsonTokenFromStore,
	getUpdateToken,
	setIntoStore,
} from "atom.io/internal"

import { createSubscriber, getSubMap } from "./create-subscriber.ts"
import { pullVersionedMutable } from "./pull-versioned-mutable.ts"

export function pullMutableAtomFamilyMember<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(
	store: Store,
	socket: Socket,
	family: AtomIO.MutableAtomFamilyToken<T, K>,
	key: NoInfer<K>,
	options?: VersionedMutablePullOptions<AsJSON<T>, SignalFrom<T>>,
): () => void {
	const token = findInStore(store, family, key)
	if (options)
		return pullVersionedMutable(
			store,
			socket,
			token,
			(metadata) => {
				socket.emit(`sub:${family.key}`, key, metadata)
			},
			options,
			{
				event: `unavailable:${family.key}`,
				matches: (unavailable) =>
					stringifyJson(unavailable) === stringifyJson(key),
			},
		)
	if (getSubMap(socket).has(`versioned-mutable:${token.key}`))
		throw new Error(
			`Cannot mix raw and versioned mutable consumers for one socket/token`,
		)
	const jsonToken = getJsonTokenFromStore(store, token)
	const trackerToken = getUpdateToken(token)
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
				setIntoStore(store, trackerToken, data)
			},
		)
		socket.emit(`sub:${family.key}`, key)
		return () => {
			socket.emit(`unsub:${token.key}`)
			stopWatchingForInit()
			stopWatchingForUpdate()
		}
	})
}

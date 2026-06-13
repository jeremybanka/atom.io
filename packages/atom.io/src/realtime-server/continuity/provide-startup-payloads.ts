import type { Json } from "atom.io/foundations/json"
import type { Store } from "atom.io/internal"
import {
	findInStore,
	getFromStore,
	getJsonTokenFromStore,
	isRootStore,
} from "atom.io/internal"
import type { ContinuityToken, Socket, UserKey } from "atom.io/realtime"
import { employSocket } from "atom.io/realtime"

export function provideStartupPayloads(
	store: Store,
	socket: Socket,
	continuity: ContinuityToken,
	userKey: UserKey,
): () => void {
	const continuityKey = continuity.key
	function sendInitialPayload(): void {
		const initialPayload: Json.Serializable[] = []
		for (const atom of continuity.globals) {
			const resourceToken =
				atom.type === `mutable_atom` ? getJsonTokenFromStore(store, atom) : atom
			const resource = getFromStore(store, resourceToken)
			initialPayload.push(resourceToken, resource)
		}
		for (const perspective of continuity.perspectives) {
			const { viewAtoms, resourceAtoms } = perspective
			const userViewState = findInStore(store, viewAtoms, userKey)
			const userView = getFromStore(store, userViewState)
			store.logger.info(`👁`, `atom`, resourceAtoms.key, `${userKey} can see`, {
				viewAtoms,
				resourceAtoms,
				userView,
			})
			for (const visibleToken of userView) {
				const resourceToken =
					visibleToken.type === `mutable_atom`
						? getJsonTokenFromStore(store, visibleToken)
						: visibleToken
				const resource = getFromStore(store, resourceToken)

				initialPayload.push(resourceToken, resource)
			}
		}

		const epoch = isRootStore(store)
			? (store.transactionMeta.epoch.get(continuityKey) ?? null)
			: null

		socket.emit(`continuity-init:${continuityKey}`, epoch, initialPayload)
	}
	return employSocket(socket, `get:${continuityKey}`, sendInitialPayload)
}

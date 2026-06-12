import { getFromStore, IMPLICIT } from "atom.io/internal"
import type { Json } from "atom.io/json"
import type { ContinuityToken, UserKey } from "atom.io/realtime"

import type { ServerConfig } from ".."
import { unacknowledgedUpdatesAtoms } from "./continuity-store.ts"
import { provideOutcomes } from "./provide-outcomes.ts"
import { providePerspectives } from "./provide-perspectives.ts"
import { provideStartupPayloads } from "./provide-startup-payloads.ts"
import { receiveActionRequests } from "./receive-action-requests.ts"
import { trackAcknowledgements } from "./track-acknowledgements.ts"

export type ProvideContinuity = (
	continuity: ContinuityToken,
	userKey: UserKey,
) => () => void
export function prepareToProvideContinuity({
	socket,
	store = IMPLICIT.STORE,
}: ServerConfig): ProvideContinuity {
	return function syncRealtimeContinuity(continuity, userKey) {
		const continuityKey = continuity.key

		const unacknowledgedUpdates = getFromStore(
			store,
			unacknowledgedUpdatesAtoms,
			userKey,
		)
		for (const unacknowledgedUpdate of unacknowledgedUpdates) {
			socket.emit(
				`tx-new:${continuityKey}`,
				unacknowledgedUpdate as Json.Serializable,
			)
		}

		const subscriptions = new Set<() => void>()
		const clearSubscriptions = () => {
			for (const unsubscribe of subscriptions) unsubscribe()
			subscriptions.clear()
		}

		subscriptions.add(providePerspectives(store, socket, continuity, userKey))
		subscriptions.add(provideOutcomes(store, socket, continuity, userKey))
		subscriptions.add(provideStartupPayloads(store, socket, continuity, userKey))
		subscriptions.add(receiveActionRequests(store, socket, continuity, userKey))
		subscriptions.add(trackAcknowledgements(store, socket, continuity, userKey))

		return clearSubscriptions
	}
}

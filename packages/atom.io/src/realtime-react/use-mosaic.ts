import type { MutableAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { StoreContext, useO } from "atom.io/react"
import type {
	AnyMosaicTransceiver,
	MosaicPresenceEnvelope,
} from "atom.io/realtime"
import {
	type MosaicClientProblem,
	type MosaicClientStatus,
	type MosaicController,
	type MosaicSubmitOptions,
	type MosaicSyncOptions,
	syncMosaic,
} from "atom.io/realtime-client"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export type UseMosaicOptions = Omit<MosaicSyncOptions, `transport`>

export type UseMosaicResult<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
> = Pick<
	MosaicController<T, Presence>,
	| `actor`
	| `address`
	| `atom`
	| `change`
	| `clearProblem`
	| `createGroupId`
	| `publishPresence`
	| `retryPending`
	| `session`
	| `syncState`
	| `synchronize`
> & {
	/** Escape hatch for protocol- and lifecycle-level controls. */
	readonly controller: MosaicController<T, Presence>
	readonly pending: readonly string[]
	readonly presence: readonly MosaicPresenceEnvelope<Presence>[]
	readonly problem: MosaicClientProblem<T> | null
	readonly revision: number
	readonly status: MosaicClientStatus
}

/**
 * Synchronize one ordinary mutable atom through the nearest RealtimeProvider.
 * Read the document with `useO(token)` and derive from it with normal selectors;
 * this hook only exposes the Store-owned collaboration control plane.
 */
export function useMosaic<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
>(
	token: MutableAtomToken<T>,
	options: UseMosaicOptions,
): UseMosaicResult<T, Presence> {
	const store = React.useContext(StoreContext)
	const controller = React.useMemo(
		() => syncMosaic<T, Presence>(store, token, options),
		[
			store,
			token.key,
			options.actor,
			options.clock,
			options.idSource,
			options.session,
		],
	)
	useRealtimeService(
		`mosaic:${controller.address.key}:${controller.session}`,
		(socket) => controller.connect(socket),
	)

	const syncState = useO(controller.syncState)

	return React.useMemo(
		() => ({
			actor: controller.actor,
			address: controller.address,
			atom: controller.atom,
			change: (intent, submitOptions?: MosaicSubmitOptions) =>
				controller.change(intent, submitOptions),
			clearProblem: () => {
				controller.clearProblem()
			},
			controller,
			createGroupId: () => controller.createGroupId(),
			pending: syncState.pending,
			presence: syncState.presence,
			problem: syncState.problem,
			publishPresence: (nextPresence) => {
				controller.publishPresence(nextPresence)
			},
			retryPending: () => {
				controller.retryPending()
			},
			revision: syncState.revision,
			session: controller.session,
			status: syncState.status,
			syncState: controller.syncState,
			synchronize: () => {
				controller.synchronize()
			},
		}),
		[controller, syncState],
	)
}

import type { MutableAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type {
	AnyMosaicTransceiver,
	MosaicPresenceEnvelope,
} from "atom.io/realtime"
import {
	type MosaicClientProblem,
	type MosaicClientStatus,
	type MosaicClientTransport,
	type MosaicController,
	type MosaicSubmitOptions,
	type MosaicSyncOptions,
	syncMosaic,
} from "atom.io/realtime-client"
import { StoreContext, useO } from "atom.io/react"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export type UseMosaicOptions = Omit<MosaicSyncOptions, `transport`>

export type UseMosaicResult<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
> = Pick<
	MosaicController<T, Presence>,
	| `actor`
	| `atom`
	| `change`
	| `clearProblem`
	| `createGroupId`
	| `publishPresence`
	| `retryPending`
	| `session`
	| `state`
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
		`mosaic:${controller.atom.key}:${controller.session}`,
		(socket) => controller.connect(socket as MosaicClientTransport),
	)

	const pending = useO(controller.state.pending)
	const presence = useO(controller.state.presence)
	const problem = useO(controller.state.problem)
	const revision = useO(controller.state.revision)
	const status = useO(controller.state.status)

	return React.useMemo(
		() => ({
			actor: controller.actor,
			atom: controller.atom,
			change: (intent, submitOptions?: MosaicSubmitOptions) =>
				controller.change(intent, submitOptions),
			clearProblem: () => {
				controller.clearProblem()
			},
			controller,
			createGroupId: () => controller.createGroupId(),
			pending,
			presence,
			problem,
			publishPresence: (nextPresence) => {
				controller.publishPresence(nextPresence)
			},
			retryPending: () => {
				controller.retryPending()
			},
			revision,
			session: controller.session,
			state: controller.state,
			status,
			synchronize: () => {
				controller.synchronize()
			},
		}),
		[controller, pending, presence, problem, revision, status],
	)
}

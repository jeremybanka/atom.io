import type { Json } from "atom.io/foundations/json"
import type {
	AnyMosaicModel,
	MosaicIntent,
	MosaicOperation,
	MosaicOperationProposal,
} from "atom.io/realtime"
import {
	createMosaicClient,
	type MosaicClient,
	type MosaicClientOptions,
	type MosaicClientSnapshot,
	type MosaicSubmitOptions,
} from "atom.io/realtime-client"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export type UseMosaicOptions<Model extends AnyMosaicModel, History> = Omit<
	MosaicClientOptions<Model, History>,
	`transport`
>

type MosaicControls<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable,
	History,
> = Pick<
	MosaicClient<Model, Presence, History>,
	| `clearProblem`
	| `createGroupId`
	| `publishPresence`
	| `redo`
	| `retryPending`
	| `submit`
	| `synchronize`
	| `undo`
>

export type UseMosaicResult<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable,
	History,
> = MosaicClientSnapshot<Model, Presence, History> &
	MosaicControls<Model, Presence, History> & {
		/** Friendly alias for {@link MosaicClient.submit}. */
		readonly change: (
			intent: MosaicIntent<Model>,
			options?: MosaicSubmitOptions,
		) => MosaicOperationProposal<MosaicOperation<Model>> | null
		/** Escape hatch for advanced lifecycle and protocol controls. */
		readonly client: MosaicClient<Model, Presence, History>
	}

let serviceSequence = 0

/**
 * Create and observe one optimistic Mosaic client through the nearest
 * {@link RealtimeProvider}.
 *
 * Declare the resource and optional history adapter outside render so their
 * identity remains stable. Changing a creation option intentionally creates a
 * fresh client and outbox.
 */
export function useMosaic<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable = Json.Serializable,
	History = null,
>(
	options: UseMosaicOptions<Model, History>,
): UseMosaicResult<Model, Presence, History> {
	const client = React.useMemo(
		() => createMosaicClient<Model, Presence, History>(options),
		[
			options.actor,
			options.clock,
			options.history,
			options.idSource,
			options.resource,
			options.session,
		],
	)
	const subscribe = React.useCallback(
		(listener: () => void) => client.subscribe(listener),
		[client],
	)
	const read = React.useCallback(() => client.read(), [client])
	const snapshot = React.useSyncExternalStore(subscribe, read, read)
	const serviceKey = React.useMemo(
		() =>
			`mosaic:${options.resource.key}:${client.read().session}:${serviceSequence++}`,
		[client, options.resource.key],
	)
	useRealtimeService(serviceKey, (socket) => client.connect(socket))
	React.useEffect(
		() => () => {
			client.dispose()
		},
		[client],
	)

	const controls = React.useMemo<MosaicControls<Model, Presence, History>>(
		() => ({
			clearProblem: () => {
				client.clearProblem()
			},
			createGroupId: () => client.createGroupId(),
			publishPresence: (presence) => {
				client.publishPresence(presence)
			},
			redo: (submitOptions) => client.redo(submitOptions),
			retryPending: () => {
				client.retryPending()
			},
			submit: (intent, submitOptions) => client.submit(intent, submitOptions),
			synchronize: () => {
				client.synchronize()
			},
			undo: (submitOptions) => client.undo(submitOptions),
		}),
		[client],
	)

	return React.useMemo(
		() => ({
			...snapshot,
			...controls,
			change: controls.submit,
			client,
		}),
		[client, controls, snapshot],
	)
}

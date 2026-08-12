import type { WritableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { Store } from "atom.io/internal"
import { setIntoStore, subscribeToState } from "atom.io/internal"
import {
	employSocket,
	mutexAtoms,
	realtimeLeaseAtoms,
	type RealtimeLeaseStatus,
	type Socket,
} from "atom.io/realtime"

import { createSubscriber } from "./create-subscriber.ts"

export function pushState<J extends Json.Serializable>(
	store: Store,
	socket: Socket,
	token: WritableToken<J>,
): () => void {
	return createSubscriber(socket, `push:${token.key}`, () => {
		let lease: Extract<RealtimeLeaseStatus, { state: `owned` }> | null = null
		let publicationSequence = 0
		let renewTimer: ReturnType<typeof setTimeout> | undefined
		let stopPublishing = () => {}
		const stopRenewing = () => {
			if (renewTimer !== undefined) clearTimeout(renewTimer)
			renewTimer = undefined
		}
		const scheduleRenewal = (
			owned: Extract<RealtimeLeaseStatus, { state: `owned` }>,
		) => {
			stopRenewing()
			renewTimer = setTimeout(() => {
				socket.emit(`renew:${token.key}`, {
					generation: owned.generation,
					leaseId: owned.leaseId,
				})
				scheduleRenewal(owned)
			}, owned.renewAfterMs)
		}
		const beginPublishing = (
			owned: Extract<RealtimeLeaseStatus, { state: `owned` }>,
		) => {
			stopPublishing()
			stopPublishing = subscribeToState(store, token, `push`, ({ newValue }) => {
				socket.emit(`pub:${token.key}`, {
					generation: owned.generation,
					leaseId: owned.leaseId,
					sequence: ++publicationSequence,
					value: newValue,
				})
			})
		}

		const stopStatus = employSocket(
			socket,
			`lease-status:${token.key}`,
			(status: RealtimeLeaseStatus) => {
				setIntoStore(store, realtimeLeaseAtoms, token.key, status)
				if (status.state === `owned`) {
					const isNewLease =
						lease?.leaseId !== status.leaseId ||
						lease.generation !== status.generation
					lease = status
					setIntoStore(store, mutexAtoms, token.key, true)
					if (isNewLease) {
						publicationSequence = 0
						beginPublishing(status)
					}
					scheduleRenewal(status)
					return
				}
				lease = null
				stopRenewing()
				stopPublishing()
				setIntoStore(store, mutexAtoms, token.key, false)
			},
		)

		// Compatibility with servers that predate lease-status messages.
		const stopLegacyClaim = employSocket(
			socket,
			`claim-result:${token.key}`,
			(success: boolean) => {
				if (!success || lease !== null) return
				setIntoStore(store, mutexAtoms, token.key, true)
				stopPublishing = subscribeToState(
					store,
					token,
					`push`,
					({ newValue }) => {
						socket.emit(`pub:${token.key}`, newValue)
					},
				)
			},
		)

		socket.emit(`claim:${token.key}`)

		return () => {
			if (lease) {
				socket.emit(`unclaim:${token.key}`, {
					generation: lease.generation,
					leaseId: lease.leaseId,
				})
			} else {
				socket.emit(`unclaim:${token.key}`)
			}
			lease = null
			stopRenewing()
			stopPublishing()
			stopStatus()
			stopLegacyClaim()
			setIntoStore(store, mutexAtoms, token.key, false)
			setIntoStore(store, realtimeLeaseAtoms, token.key, { state: `idle` })
		}
	})
}

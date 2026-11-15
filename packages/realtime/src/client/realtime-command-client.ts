import type {
	RealtimeCommand,
	RealtimeCommandIdentity,
	RealtimeCommandRejection,
	RealtimeCommandRequest,
	RealtimeCommandResult,
	RealtimeSubmission,
} from "@atom.io/realtime"
import { encodeRealtimePayload } from "@atom.io/realtime"
import type { Json } from "atom.io/foundations/json"

import { createRealtimeSubmission } from "./realtime-submission.ts"

export type RealtimeCommandClientOptions = {
	readonly session: string
	readonly request: (request: RealtimeCommandRequest) => Promise<unknown>
	readonly maxPending?: number
	readonly maxPayloadBytes?: number
	readonly onError?: (error: unknown) => void
}
export type RealtimeCommandClient = {
	submit<P extends Json.Serializable, V extends Json.Serializable>(
		command: RealtimeCommand<P, V>,
		parameters: P,
		requestId: string,
	): RealtimeSubmission<RealtimeCommandIdentity, V, RealtimeCommandRejection>
	dispose(): void
}

/** Commands never speculate or replay automatically: a lost reply may follow a committed effect. */
export function createRealtimeCommandClient(
	options: RealtimeCommandClientOptions,
): RealtimeCommandClient {
	const maxPending = options.maxPending ?? 64
	const maxBytes = options.maxPayloadBytes ?? 65_536
	if (
		!options.session ||
		!Number.isSafeInteger(maxPending) ||
		maxPending < 1 ||
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1
	) {
		throw new Error(`Invalid command client configuration.`)
	}
	const pending = new Set<() => void>()
	let disposed = false
	const report = (error: unknown): void => {
		try {
			options.onError?.(error)
		} catch {
			/* diagnostics are isolated */
		}
	}
	return {
		submit(command, parameters, requestId) {
			const identity = Object.freeze({
				requestId,
				session: options.session,
				resource: command.name,
			})
			const controller = createRealtimeSubmission<
				RealtimeCommandIdentity,
				any,
				RealtimeCommandRejection
			>(identity, report)
			const interrupt = (): void => {
				controller.update({
					status: `interrupted`,
					reason: `disposed`,
					recovery: `resnapshot`,
				})
			}
			if (disposed) {
				interrupt()
				return controller.receipt
			}
			if (pending.size >= maxPending) {
				controller.update({
					status: `rejected`,
					rejection: { code: `capacity`, reason: `Command queue is full.` },
					retryable: true,
				})
				return controller.receipt
			}
			pending.add(interrupt)
			void (async () => {
				try {
					const encoded = encodeRealtimePayload(
						{ ...identity, parameters },
						maxBytes,
					)
					if (!requestId || requestId.length > 256 || encoded === null) {
						controller.update({
							status: `rejected`,
							rejection: { code: `invalid`, reason: `Invalid command request.` },
							retryable: false,
						})
						return
					}
					controller.update({ status: `sending` })
					const input = await options.request(
						JSON.parse(encoded) as RealtimeCommandRequest,
					)
					if (disposed) return
					if (
						encodeRealtimePayload(input, maxBytes) === null ||
						typeof input !== `object` ||
						input === null
					)
						throw new Error(`Invalid response.`)
					const result = structuredClone(input) as RealtimeCommandResult
					if (
						result.requestId !== requestId ||
						result.session !== identity.session ||
						result.resource !== identity.resource
					)
						throw new Error(`Response correlation mismatch.`)
					if (result.status === `accepted`) {
						const parsed = await command.result[`~standard`].validate(
							result.value,
						)
						if (parsed.issues) throw new Error(`Invalid command result.`)
						controller.update({ status: `accepted`, value: parsed.value })
					} else if (
						result.status === `rejected` &&
						typeof result.retryable === `boolean` &&
						result.rejection &&
						[
							`invalid`,
							`unknown-command`,
							`unauthorized`,
							`collision`,
							`duplicate`,
							`capacity`,
							`failed`,
							`disposed`,
						].includes(result.rejection.code) &&
						typeof result.rejection.reason === `string`
					) {
						controller.update(result)
					} else throw new Error(`Invalid command result.`)
				} catch (error) {
					report(error)
					controller.update({
						status: `interrupted`,
						reason: `invalid-response`,
						recovery: `resnapshot`,
					})
				} finally {
					pending.delete(interrupt)
				}
			})()
			return controller.receipt
		},
		dispose() {
			disposed = true
			for (const interrupt of pending) interrupt()
			pending.clear()
		},
	}
}

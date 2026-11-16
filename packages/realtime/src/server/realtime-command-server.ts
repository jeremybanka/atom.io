import type {
	RealtimeCommand,
	RealtimeCommandIdentity,
	RealtimeCommandRejection,
	RealtimeCommandRequest,
	RealtimeCommandResult,
} from "@atom.io/realtime"
import { encodeRealtimePayload } from "@atom.io/realtime"
import type { Json } from "atom.io/foundations/json"

export type RealtimeCommandContext = {
	readonly actor: string
	readonly session: string
}
export type RealtimeCommandHandler = {
	readonly definition: RealtimeCommand<any, any>
	authorize(
		context: RealtimeCommandContext,
		parameters: any,
	): boolean | Promise<boolean>
	execute(
		context: RealtimeCommandContext,
		parameters: any,
	): Json.Serializable | Promise<Json.Serializable>
}
export function realtimeCommandHandler<
	P extends Json.Serializable,
	V extends Json.Serializable,
>(
	definition: RealtimeCommand<P, V>,
	handler: {
		authorize(
			context: RealtimeCommandContext,
			parameters: P,
		): boolean | Promise<boolean>
		execute(context: RealtimeCommandContext, parameters: P): V | Promise<V>
	},
): RealtimeCommandHandler {
	return { definition, ...handler }
}
export type RealtimeCommandServerOptions = {
	readonly handlers: readonly RealtimeCommandHandler[]
	readonly maxRequests?: number
	readonly maxPending?: number
	readonly maxPayloadBytes?: number
	readonly duplicate?: `replay` | `reject`
	readonly onError?: (error: unknown) => void
}
export type RealtimeCommandServer = {
	/** Context must come from authenticated transport state, never a request body. */
	handle(
		context: RealtimeCommandContext,
		request: unknown,
	): Promise<RealtimeCommandResult>
	dispose(): void
}

/** Bounded process-local idempotency. Persist application effects and receipts together for crash-safe execution. */
export function createRealtimeCommandServer(
	options: RealtimeCommandServerOptions,
): RealtimeCommandServer {
	const maxRequests = options.maxRequests ?? 1_024
	const maxPending = options.maxPending ?? 64
	const maxBytes = options.maxPayloadBytes ?? 65_536
	for (const limit of [maxRequests, maxPending, maxBytes]) {
		if (!Number.isSafeInteger(limit) || limit < 1)
			throw new Error(`Command limits must be positive safe integers.`)
	}
	const handlers = new Map<string, RealtimeCommandHandler>()
	for (const handler of options.handlers) {
		if (handlers.has(handler.definition.name))
			throw new Error(`Duplicate command definition.`)
		handlers.set(handler.definition.name, handler)
	}
	const receipts = new Map<
		string,
		{ fingerprint: string; result: Promise<RealtimeCommandResult> }
	>()
	let pending = 0
	let disposed = false
	const report = (error: unknown): void => {
		try {
			options.onError?.(error)
		} catch {
			/* diagnostics cannot alter execution */
		}
	}
	return {
		async handle(authenticated, input) {
			const context = Object.freeze({
				actor: authenticated.actor,
				session: authenticated.session,
			})
			const fingerprint = encodeRealtimePayload(input, maxBytes)
			const candidate = (
				fingerprint === null ? null : JSON.parse(fingerprint)
			) as Partial<RealtimeCommandRequest> | null
			const identity: RealtimeCommandIdentity = {
				requestId:
					typeof candidate?.requestId === `string`
						? candidate.requestId.slice(0, 256)
						: ``,
				resource:
					typeof candidate?.resource === `string`
						? candidate.resource.slice(0, 256)
						: ``,
				session: context.session,
			}
			const reject = (
				code: RealtimeCommandRejection[`code`],
				reason: string,
				retryable = false,
			): RealtimeCommandResult => ({
				...identity,
				status: `rejected`,
				rejection: { code, reason },
				retryable,
			})
			if (disposed) return reject(`disposed`, `Command server is disposed.`)
			if (
				!fingerprint ||
				!identity.requestId ||
				!identity.resource ||
				!context.actor ||
				!context.session ||
				candidate?.session !== context.session ||
				candidate?.requestId !== identity.requestId ||
				candidate?.resource !== identity.resource ||
				!Object.hasOwn(candidate, `parameters`)
			)
				return reject(`invalid`, `Invalid command request.`)
			const handler = handlers.get(identity.resource)
			if (!handler) return reject(`unknown-command`, `Unknown command.`)
			if (pending >= maxPending)
				return reject(`capacity`, `Command queue is full.`, true)
			pending++
			try {
				const parameters = await handler.definition.parameters[
					`~standard`
				].validate(candidate.parameters)
				if (parameters.issues)
					return reject(`invalid`, `Invalid command parameters.`)
				if (!(await handler.authorize(context, parameters.value)))
					return reject(`unauthorized`, `Command is not authorized.`)
				if (disposed) return reject(`disposed`, `Command server is disposed.`)
				const key = JSON.stringify([
					context.actor,
					context.session,
					identity.requestId,
				])
				const previous = receipts.get(key)
				if (previous) {
					if (previous.fingerprint !== fingerprint)
						return reject(
							`collision`,
							`Request ID was already used with different content.`,
						)
					if (options.duplicate === `reject`)
						return reject(`duplicate`, `Request ID was already used.`)
					return structuredClone(await previous.result)
				}
				if (receipts.size >= maxRequests)
					return reject(`capacity`, `Command receipt capacity reached.`)
				// Reserve the request before executing application code, including synchronous callbacks.
				const result: Promise<RealtimeCommandResult> = Promise.resolve().then(
					async () => {
						try {
							if (disposed)
								return reject(`disposed`, `Command server is disposed.`)
							const output = await handler.execute(context, parameters.value)
							const value =
								await handler.definition.result[`~standard`].validate(output)
							if (
								value.issues ||
								encodeRealtimePayload(value.value, maxBytes) === null
							) {
								report(new Error(`Invalid command output.`))
								return reject(
									`failed`,
									`Command outcome is unknown; reconcile authoritative state.`,
								)
							}
							return {
								...identity,
								status: `accepted`,
								value: structuredClone(value.value),
							}
						} catch (error) {
							report(error)
							return reject(
								`failed`,
								`Command outcome is unknown; reconcile authoritative state.`,
							)
						}
					},
				)
				receipts.set(key, { fingerprint, result })
				return structuredClone(await result)
			} catch (error) {
				report(error)
				return reject(`failed`, `Command could not be authorized or validated.`)
			} finally {
				pending--
			}
		},
		dispose() {
			disposed = true
			receipts.clear()
		},
	}
}

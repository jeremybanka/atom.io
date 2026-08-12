import type { Json } from "atom.io/foundations/json"

import type { EventsMap, GuardedSocket, Socket } from "./socket-interface.ts"
import type { StandardSchemaV1 } from "./standard-schema.ts"

export type SocketGuard<ListenEvents extends EventsMap> = {
	[K in keyof ListenEvents]: StandardSchemaV1<
		Json.Array,
		Parameters<ListenEvents[K]>
	>
}

export function guardSocket<ListenEvents extends EventsMap>(
	socket: Socket,
	guard: SocketGuard<ListenEvents> | `TRUST`,
	logError?: (error: unknown) => void,
): GuardedSocket<ListenEvents> {
	if (guard === `TRUST`) {
		return socket as GuardedSocket<ListenEvents>
	}

	type Listener = (...args: Json.Serializable[]) => void
	type AnyListener = (event: string, ...args: Json.Serializable[]) => void

	const listenerWrappers = new Map<string, Map<Listener, Listener>>()
	const anyListenerWrappers = new Map<AnyListener, AnyListener>()
	let validationQueue = Promise.resolve()

	const report = (error: unknown): void => {
		try {
			logError?.(error)
		} catch {
			// A diagnostic callback must never break the transport event loop.
		}
	}

	const enqueueValidation = (
		event: string,
		args: Json.Serializable[],
		onValid: (args: Json.Serializable[]) => void,
	): void => {
		validationQueue = validationQueue.then(async () => {
			const schema = guard[event]
			if (schema === undefined) {
				report(new Error(`No socket guard schema is registered for "${event}".`))
				return
			}
			try {
				const result = await schema[`~standard`].validate(args)
				if (result.issues) {
					report(result.issues)
					return
				}
				onValid(result.value)
			} catch (error) {
				report(error)
			}
		})
	}

	const guardedSocket: Socket = {
		id: socket.id,
		on: (event, listener) => {
			const wrapper: Listener = (...args) => {
				enqueueValidation(event, args, (validated) => listener(...validated))
			}
			let wrappers = listenerWrappers.get(event)
			if (wrappers === undefined) {
				wrappers = new Map()
				listenerWrappers.set(event, wrappers)
			}
			const formerWrapper = wrappers.get(listener)
			if (formerWrapper) socket.off(event, formerWrapper)
			wrappers.set(listener, wrapper)
			socket.on(event, wrapper)
		},
		onAny: (listener) => {
			const wrapper: AnyListener = (event, ...args) => {
				enqueueValidation(event, args, (validated) =>
					listener(event, ...validated),
				)
			}
			const formerWrapper = anyListenerWrappers.get(listener)
			if (formerWrapper) socket.offAny(formerWrapper)
			anyListenerWrappers.set(listener, wrapper)
			socket.onAny(wrapper)
		},
		onAnyOutgoing: socket.onAnyOutgoing.bind(socket),
		off: (event, listener) => {
			const wrappers = listenerWrappers.get(event)
			if (listener) {
				const wrapper = wrappers?.get(listener)
				if (wrapper) {
					socket.off(event, wrapper)
					wrappers?.delete(listener)
				}
				if (wrappers?.size === 0) listenerWrappers.delete(event)
				return
			}
			if (wrappers) {
				for (const wrapper of wrappers.values()) socket.off(event, wrapper)
				listenerWrappers.delete(event)
			}
		},
		offAny: (listener) => {
			if (listener) {
				const wrapper = anyListenerWrappers.get(listener)
				if (wrapper) {
					socket.offAny(wrapper)
					anyListenerWrappers.delete(listener)
				}
				return
			}
			for (const wrapper of anyListenerWrappers.values()) {
				socket.offAny(wrapper)
			}
			anyListenerWrappers.clear()
		},
		emit: socket.emit.bind(socket),
	}
	return guardedSocket as GuardedSocket<ListenEvents>
}

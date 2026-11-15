import type {
	RealtimeProtocolOffer,
	RealtimeProtocolResult,
	RealtimeProtocolSelection,
} from "@atom.io/realtime"
import { negotiateRealtimeProtocol } from "@atom.io/realtime"

export type RealtimeProtocolSession = {
	negotiate(remote: unknown): Promise<RealtimeProtocolResult>
	dispose(): Promise<void>
}

/** Authenticate first, then create a session per connection. Install all resource services in start. */
export function createRealtimeProtocolSession(
	offer: RealtimeProtocolOffer,
	start: (
		selection: RealtimeProtocolSelection,
	) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>,
): RealtimeProtocolSession {
	const configuration = structuredClone(offer)
	let disposed = false
	let started: Promise<RealtimeProtocolResult> | undefined
	let cleanup: (() => void | Promise<void>) | undefined
	let disposing: Promise<void> | undefined
	return {
		negotiate(remote) {
			if (disposed)
				return Promise.reject(new Error(`Protocol session is disposed.`))
			started ??= (async () => {
				const result = negotiateRealtimeProtocol(configuration, remote)
				if (result.status === `accepted`) cleanup = await start(result)
				return result
			})()
			return started
		},
		dispose() {
			disposed = true
			disposing ??= (async () => {
				try {
					await started
				} finally {
					await cleanup?.()
				}
			})()
			return disposing
		},
	}
}

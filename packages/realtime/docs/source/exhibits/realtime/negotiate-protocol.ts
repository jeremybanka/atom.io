import {
	createRealtimeProtocolSession,
	type RealtimeProtocolSession,
} from "@atom.io/realtime/server"

export function prepareConnection(
	installServices: () => () => void,
): RealtimeProtocolSession {
	return createRealtimeProtocolSession(
		{
			versions: [1],
			capabilities: [`commands`, `rigid`],
			requiredCapabilities: [`commands`],
			models: { text: [1] },
		},
		() => installServices(),
	)
}

// Authenticate first, exchange offers through the host transport, then invoke
// session.negotiate(remoteOffer). Forward its result to the peer. Invoke
// session.dispose() on disconnect, including while installation is pending.

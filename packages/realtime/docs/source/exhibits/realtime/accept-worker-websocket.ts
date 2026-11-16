import type { UserKey } from "@atom.io/realtime"
import type {
	AcceptedRealtimeWebSocket,
	RealtimeSqliteStorage,
} from "@atom.io/realtime/server/cloudflare"
import {
	acceptCloudflareRealtimeConnection,
	realtimeStateProvider,
	SqliteMosaicDomainBatchStorage,
} from "@atom.io/realtime/server/cloudflare"
import { atom } from "atom.io"
import type { RootStore } from "atom.io/internal"

const countAtom = atom<number>({ key: `count`, default: 0 })

// Call inside a Durable Object fetch handler with WebSocketPair's server side.
// The host returns the client side in its 101 response after setup succeeds.
export async function acceptConnection(
	request: Request,
	server: AcceptedRealtimeWebSocket,
	store: RootStore,
	authenticate: (request: Request) => Promise<UserKey>,
): Promise<void> {
	await acceptCloudflareRealtimeConnection({
		request,
		webSocket: server,
		sessionId: crypto.randomUUID(),
		authenticate,
		setup: (socket, consumer) =>
			realtimeStateProvider({ socket, consumer, store })(countAtom),
	})
}

// Pass this adapter as storage to createMosaicDomainBatchServer. Its SQL tables
// survive object reconstruction; limits reject growth before an unbounded replay.
export function durableBatches(
	storage: RealtimeSqliteStorage,
): SqliteMosaicDomainBatchStorage {
	return new SqliteMosaicDomainBatchStorage(storage, {
		maxBatchesPerDomain: 1_000,
	})
}

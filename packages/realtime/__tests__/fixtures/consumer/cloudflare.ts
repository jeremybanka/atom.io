import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { createWebSocketTransport } from "@atom.io/realtime"
import {
	acceptCloudflareRealtimeConnection,
	SqliteMosaicDomainBatchStorage,
} from "@atom.io/realtime/server/cloudflare"

assert.equal(typeof createWebSocketTransport, `function`)
assert.equal(typeof acceptCloudflareRealtimeConnection, `function`)
assert.equal(typeof SqliteMosaicDomainBatchStorage, `function`)
const require = createRequire(import.meta.url)
for (const peer of [`react`, `socket.io`, `socket.io-client`])
	assert.throws(() => require.resolve(peer))

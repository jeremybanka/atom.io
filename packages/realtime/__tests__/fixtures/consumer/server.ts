import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { createMosaicDomainBatchServer } from "@atom.io/realtime/server"
import { setupRealtimeTestServer } from "@atom.io/realtime/testing/headless"

assert.equal(typeof createMosaicDomainBatchServer, `function`)
assert.equal(typeof setupRealtimeTestServer, `function`)
const require = createRequire(import.meta.url)
for (const peer of [
	`react`,
	`@atom.io/react`,
	`lexical`,
	`happy-dom`,
	`@testing-library/react`,
])
	assert.throws(() => require.resolve(peer))

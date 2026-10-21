import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { mosaicText, myUserKeyAtom } from "@atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	myUserKeyAtom as clientUserKey,
} from "@atom.io/realtime/client"

assert.equal(myUserKeyAtom, clientUserKey)
assert.equal(new (mosaicText({ initialText: `hello` }))().text, `hello`)
assert.equal(typeof createMosaicDomainBatchClient, `function`)
const require = createRequire(import.meta.url)
for (const peer of [
	`react`,
	`@atom.io/react`,
	`lexical`,
	`socket.io`,
	`socket.io-client`,
	`happy-dom`,
	`@testing-library/react`,
])
	assert.throws(() => require.resolve(peer))

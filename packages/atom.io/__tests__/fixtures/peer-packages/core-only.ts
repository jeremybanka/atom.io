import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { atom, getState, setState } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 1 })
setState(countAtom, 2)
assert.equal(getState(countAtom), 2)
const require = createRequire(import.meta.url)
for (const peer of [`react`, `solid-js`, `motion`, `@atom.io/react`]) {
	assert.throws(() => require.resolve(peer))
}
for (const entry of [
	`react`,
	`solid`,
	`react-devtools`,
	`react-devtools/css`,
	`realtime`,
	`realtime-client`,
	`realtime-server`,
	`realtime-react`,
	`realtime-react-lexical`,
	`realtime-testing/headless`,
	`realtime-testing/react`,
]) {
	assert.throws(() => require.resolve(`atom.io/${entry}`))
}

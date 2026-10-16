import assert from "node:assert/strict"

import { atom, getState } from "atom.io"
import plugin from "atom.io/eslint-plugin"

const fixtureAtom = atom<number>({ key: `fixture`, default: 42 })
assert.equal(getState(fixtureAtom), 42)
assert.equal(Object.keys(plugin.rules ?? {}).length, 4)

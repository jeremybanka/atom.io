import { atomFamily, disposeState, findState } from "atom.io"
import { stateExists } from "atom.io/testing"
import { expect, test } from "vitest"

const countAtoms = atomFamily<number, string>({
	key: `count`,
	default: 0,
})

test(`a disposed family member no longer exists`, () => {
	expect(stateExists(countAtoms, `a`)).toBe(false)

	const countA = findState(countAtoms, `a`)

	expect(stateExists(countA)).toBe(true)
	expect(stateExists(countAtoms, `a`)).toBe(true)

	disposeState(countA)

	expect(stateExists(countA)).toBe(false)
	expect(stateExists(countAtoms, `a`)).toBe(false)
})

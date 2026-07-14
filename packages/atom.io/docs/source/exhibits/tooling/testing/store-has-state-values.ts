import { atom, runTransaction, transaction } from "atom.io"
import { storeHasStateValues } from "atom.io/testing"
import { expect, test } from "vitest"

const countAtom = atom<number>({
	key: `count`,
	default: 0,
})

const failingTransaction = transaction({
	key: `failing`,
	do: ({ set }) => {
		set(countAtom, 1)
		throw new Error(`nope`)
	},
})

test(`a failed transaction does not commit values`, () => {
	try {
		runTransaction(failingTransaction)()
	} catch {
		// expected
	}

	expect(storeHasStateValues()).toBe(false)
})

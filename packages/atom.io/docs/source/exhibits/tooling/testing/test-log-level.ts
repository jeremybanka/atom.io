import { atom, setState } from "atom.io"
import { setTestLogLevel } from "atom.io/testing"
import { expect, test, vitest } from "vitest"

const countAtom = atom<number>({
	key: `count`,
	default: 0,
})

test(`state updates can be asserted without printing logs`, () => {
	const logger = setTestLogLevel(null)
	const error = vitest.spyOn(logger, `error`)
	const warn = vitest.spyOn(logger, `warn`)

	setState(countAtom, 1)

	expect(error).not.toHaveBeenCalled()
	expect(warn).not.toHaveBeenCalled()
})

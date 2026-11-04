import { atom, getState, selector, setState } from "atom.io"
import type * as Core from "atom.io/internal"
import { IMPLICIT, Store, withdraw } from "atom.io/internal"
import { afterEach, expect, it, vi } from "vitest"

import { browserApplication } from "../src/astro-application.ts"

vi.mock(`atom.io/internal`, async (importOriginal) => ({
	...(await importOriginal<typeof Core>()),
	subscribeToStateSubject: undefined,
}))

const originalStore = IMPLICIT.STORE
afterEach(() => {
	browserApplication(document).dispose()
	globalThis.ATOM_IO_IMPLICIT_STORE = originalStore
})

it(`observes bootstrap state lazily when a released SDK lacks the state cleanup helper`, () => {
	globalThis.ATOM_IO_IMPLICIT_STORE = new Store({
		name: `legacy-bootstrap`,
		lifespan: `ephemeral`,
		isProduction: true,
	}) as typeof IMPLICIT.STORE
	const countAtom = atom<number>({ key: `count`, default: 0 })
	const compute = vi.fn((count: number) => count * 2)
	const doubledSelector = selector<number>({
		key: `doubled`,
		get: ({ get }) => compute(get(countAtom)),
	})
	const application = browserApplication(document)
	expect(application.canResume).toBe(true)
	expect(compute).not.toHaveBeenCalled()
	expect(getState(doubledSelector)).toBe(0)
	setState(countAtom, 1)
	expect(application.canResume).toBe(false)
	expect(compute).toHaveBeenCalledTimes(1)
	application.dispose()
	expect(withdraw(IMPLICIT.STORE, countAtom).subject.subscribers.size).toBe(0)
	expect(
		withdraw(IMPLICIT.STORE, doubledSelector).subject.subscribers.size,
	).toBe(0)
})

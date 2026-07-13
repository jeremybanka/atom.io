import {
	getState,
	mutableAtom,
	runTransaction,
	setState,
	transaction,
} from "atom.io"
import { Subject } from "atom.io/foundations/subject"
import type { Transceiver } from "atom.io/internal"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { OList } from "atom.io/transceivers/o-list"
import { UList } from "atom.io/transceivers/u-list"
import { vitest } from "vitest"

class LegacyList implements Transceiver<LegacyList, string, readonly string[]> {
	public readonly READONLY_VIEW = this
	public readonly subject = new Subject<string>()
	public values: string[]

	public constructor(values: readonly string[] = []) {
		this.values = [...values]
	}

	public add(value: string): this {
		this.values.push(value)
		this.subject.next(value)
		return this
	}

	public do(value: string): null {
		this.values.push(value)
		return null
	}

	public undo(value: string): void {
		const index = this.values.lastIndexOf(value)
		if (index !== -1) this.values.splice(index, 1)
	}

	public subscribe(
		key: string,
		handleUpdate: (update: string) => void,
	): () => void {
		return this.subject.subscribe(key, handleUpdate)
	}

	public toJSON(): readonly string[] {
		return [...this.values]
	}

	public static fromJSON(json: readonly string[]): LegacyList {
		return new LegacyList(json)
	}
}

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

afterEach(() => {
	vitest.restoreAllMocks()
})

test(`forks a UList once and isolates the child subject`, () => {
	const listAtom = mutableAtom<UList<string>>({
		key: `list`,
		class: UList,
	})
	setState(listAtom, new UList([`seed`]))
	const root = getState(listAtom) as UList<string>
	const rootUpdate = vitest.fn()
	root.subscribe(`root test`, rootUpdate)
	const fork = vitest.spyOn(UList, `transactionFork`)
	const childUpdate = vitest.fn()
	let firstChild: UList<string> | undefined
	let secondChild: UList<string> | undefined
	const mutate = transaction<() => void>({
		key: `mutate`,
		do: ({ set }) => {
			set(listAtom, (child) => {
				firstChild = child
				expect(child).not.toBe(root)
				expect(child.subject).not.toBe(root.subject)
				child.subscribe(`child test`, childUpdate)
				child.add(`a`)
				expect([...root]).toEqual([`seed`])
				expect(rootUpdate).not.toHaveBeenCalled()
				return child
			})
			set(listAtom, (child) => {
				secondChild = child
				expect(child).toBe(firstChild)
				child.add(`b`)
				expect([...root]).toEqual([`seed`])
				expect(rootUpdate).not.toHaveBeenCalled()
				return child
			})
		},
	})

	runTransaction(mutate)()

	expect(fork).toHaveBeenCalledOnce()
	expect(fork).toHaveBeenCalledWith(root)
	expect(secondChild).toBe(firstChild)
	expect(childUpdate).toHaveBeenCalledTimes(2)
	expect(rootUpdate).not.toHaveBeenCalled()
	expect(getState(listAtom)).toBe(root)
	expect([...root]).toEqual([`seed`, `a`, `b`])
})

test(`falls back to one JSON round-trip for a legacy transceiver`, () => {
	const listAtom = mutableAtom<LegacyList>({
		key: `list`,
		class: LegacyList,
	})
	setState(listAtom, new LegacyList([`seed`]))
	const root = getState(listAtom)
	const toJSON = vitest.spyOn(root, `toJSON`)
	const fromJSON = vitest.spyOn(LegacyList, `fromJSON`)
	const mutate = transaction<() => void>({
		key: `mutate legacy list`,
		do: ({ set }) => {
			set(listAtom, (child) => child.add(`a`))
			set(listAtom, (child) => child.add(`b`))
		},
	})

	runTransaction(mutate)()

	expect(toJSON).toHaveBeenCalledOnce()
	expect(fromJSON).toHaveBeenCalledOnce()
	expect(fromJSON).toHaveBeenCalledWith([`seed`])
	expect(getState(listAtom)).toBe(root)
	expect(root.values).toEqual([`seed`, `a`, `b`])
})

test(`an aborted transaction leaves the parent value and subject isolated`, () => {
	const listAtom = mutableAtom<UList<string>>({
		key: `list`,
		class: UList,
	})
	setState(listAtom, new UList([`seed`]))
	const root = getState(listAtom) as UList<string>
	const rootUpdate = vitest.fn()
	root.subscribe(`root test`, rootUpdate)
	const fork = vitest.spyOn(UList, `transactionFork`)
	let child: UList<string> | undefined
	const fail = transaction<() => void>({
		key: `fail`,
		do: ({ set }) => {
			set(listAtom, (forked) => {
				child = forked
				forked.add(`discarded`)
				return forked
			})
			throw new Error(`abort`)
		},
	})

	expect(() => {
		runTransaction(fail)()
	}).toThrow(`abort`)

	expect(fork).toHaveBeenCalledOnce()
	expect(child).not.toBe(root)
	expect(child?.subject).not.toBe(root.subject)
	expect(rootUpdate).not.toHaveBeenCalled()
	expect(getState(listAtom)).toBe(root)
	expect([...root]).toEqual([`seed`])
})

test(`nested transactions fork once per layer`, () => {
	const listAtom = mutableAtom<UList<string>>({
		key: `list`,
		class: UList,
	})
	setState(listAtom, new UList([`seed`]))
	const root = getState(listAtom) as UList<string>
	const fork = vitest.spyOn(UList, `transactionFork`)
	let outerChild: UList<string> | undefined
	let innerChild: UList<string> | undefined
	const inner = transaction<() => void>({
		key: `inner`,
		do: ({ set }) => {
			set(listAtom, (child) => {
				innerChild = child
				child.add(`inner`)
				return child
			})
		},
	})
	const outer = transaction<() => void>({
		key: `outer`,
		do: ({ run, set }) => {
			set(listAtom, (child) => {
				outerChild = child
				child.add(`outer before`)
				return child
			})
			run(inner)()
			set(listAtom, (child) => {
				expect(child).toBe(outerChild)
				child.add(`outer after`)
				return child
			})
		},
	})

	runTransaction(outer)()

	expect(fork).toHaveBeenCalledTimes(2)
	expect(fork).toHaveBeenNthCalledWith(1, root)
	expect(fork).toHaveBeenNthCalledWith(2, outerChild)
	expect(outerChild).not.toBe(root)
	expect(innerChild).not.toBe(outerChild)
	expect(innerChild?.subject).not.toBe(outerChild?.subject)
	expect([...root]).toEqual([`seed`, `outer before`, `inner`, `outer after`])
})

test(`forks a dense OList with independent identity and subject`, () => {
	const listAtom = mutableAtom<OList<string>>({
		key: `list`,
		class: OList,
	})
	setState(listAtom, new OList(`a`, `b`, `c`))
	const root = getState(listAtom) as OList<string>
	const fork = vitest.spyOn(OList, `transactionFork`)
	const childUpdate = vitest.fn()
	let child: OList<string> | undefined
	const mutate = transaction<() => void>({
		key: `mutate ordered list`,
		do: ({ set }) => {
			set(listAtom, (forked) => {
				child = forked
				expect(forked).not.toBe(root)
				expect(forked.subject).not.toBe(root.subject)
				expect([...forked]).toEqual([`a`, `b`, `c`])
				forked.subscribe(`child test`, childUpdate)
				forked[1] = `B`
				expect([...root]).toEqual([`a`, `b`, `c`])
				return forked
			})
		},
	})

	runTransaction(mutate)()

	expect(fork).toHaveBeenCalledOnce()
	expect(fork).toHaveBeenCalledWith(root)
	expect(childUpdate).toHaveBeenCalledOnce()
	expect(child).not.toBe(root)
	expect(child?.subject).not.toBe(root.subject)
	expect(getState(listAtom)).toBe(root)
	expect([...root]).toEqual([`a`, `B`, `c`])
})

test(`preserves sparse OList holes in a transaction fork`, () => {
	const listAtom = mutableAtom<OList<string>>({
		key: `list`,
		class: OList,
	})
	const initial = new OList<string>(6)
	initial[2] = `middle`
	setState(listAtom, initial)
	const root = getState(listAtom) as OList<string>
	const fork = vitest.spyOn(OList, `transactionFork`)
	const mutate = transaction<() => void>({
		key: `mutate sparse ordered list`,
		do: ({ set }) => {
			set(listAtom, (child) => {
				expect(child.length).toBe(6)
				expect(Object.hasOwn(child, 0)).toBe(false)
				expect(Object.hasOwn(child, 1)).toBe(false)
				expect(Object.hasOwn(child, 2)).toBe(true)
				expect(Object.hasOwn(child, 3)).toBe(false)
				expect(Object.hasOwn(child, 4)).toBe(false)
				expect(Object.hasOwn(child, 5)).toBe(false)
				child[5] = `tail`
				expect(Object.hasOwn(root, 5)).toBe(false)
				return child
			})
		},
	})

	runTransaction(mutate)()

	expect(fork).toHaveBeenCalledOnce()
	expect(root.length).toBe(6)
	expect(Object.hasOwn(root, 0)).toBe(false)
	expect(Object.hasOwn(root, 1)).toBe(false)
	expect(Object.hasOwn(root, 2)).toBe(true)
	expect(Object.hasOwn(root, 3)).toBe(false)
	expect(Object.hasOwn(root, 4)).toBe(false)
	expect(Object.hasOwn(root, 5)).toBe(true)
	expect(root[2]).toBe(`middle`)
	expect(root[5]).toBe(`tail`)
})

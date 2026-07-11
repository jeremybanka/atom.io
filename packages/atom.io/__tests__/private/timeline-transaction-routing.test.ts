import type {
	MoleculeCreationEvent,
	RegularAtomToken,
	TransactionOutcomeEvent,
	TransactionSubEvent,
	TransactionToken,
} from "atom.io"
import {
	atom,
	getState,
	redo,
	runTransaction,
	timeline,
	transaction,
	undo,
} from "atom.io"
import { clearStore, IMPLICIT } from "atom.io/internal"

import { partitionTransactionSubEvents } from "../../src/internal/timeline/partition-transaction-sub-events.ts"

const TIMESTAMP = 1

beforeEach(() => {
	clearStore(IMPLICIT.STORE)
})

function relateTopic(
	timelineKey: string,
	topicKey: string,
	topicType: `atom` | `atom_family` = `atom`,
): void {
	IMPLICIT.STORE.timelineTopics.set({ timelineKey, topicKey }, { topicType })
}

function atomUpdate(key: string, familyKey?: string): TransactionSubEvent {
	const token: RegularAtomToken<number, string> = { key, type: `atom` }
	if (familyKey !== undefined) {
		token.family = { key: familyKey, subKey: `"member"` }
	}
	return {
		type: `atom_update`,
		token,
		timestamp: TIMESTAMP,
		update: { oldValue: 0, newValue: 1 },
	}
}

function transactionOutcome(
	key: string,
	subEvents: TransactionSubEvent[],
): TransactionOutcomeEvent<TransactionToken<() => void>> {
	return {
		type: `transaction_outcome`,
		token: { key, type: `transaction` },
		id: `${key}/instance`,
		epoch: 0,
		timestamp: TIMESTAMP,
		subEvents,
		params: [],
		output: undefined,
	}
}

describe(`partitionTransactionSubEvents`, () => {
	test(`routes exact and family topics without duplicating a dual match`, () => {
		const exact = atomUpdate(`exact`)
		const family = atomUpdate(`family("member")`, `family`)
		const dual = atomUpdate(`dual("member")`, `dual`)
		relateTopic(`exact timeline`, `exact`)
		relateTopic(`family timeline`, `family`, `atom_family`)
		relateTopic(`dual timeline`, `dual("member")`)
		relateTopic(`dual timeline`, `dual`, `atom_family`)

		const partitions = partitionTransactionSubEvents(
			IMPLICIT.STORE,
			[exact, family, dual],
			new Set([`exact timeline`, `family timeline`, `dual timeline`]),
		)

		expect(partitions.get(`exact timeline`)).toEqual([exact])
		expect(partitions.get(`family timeline`)).toEqual([family])
		expect(partitions.get(`dual timeline`)).toEqual([dual])
	})

	test(`broadcasts molecule events while retaining source order`, () => {
		const a0 = atomUpdate(`a0`)
		const molecule: MoleculeCreationEvent = {
			type: `molecule_creation`,
			key: `molecule`,
			provenance: `root`,
			timestamp: TIMESTAMP,
		}
		const a1 = atomUpdate(`a1`)
		const b0 = atomUpdate(`b0`)
		relateTopic(`a timeline`, `a0`)
		relateTopic(`a timeline`, `a1`)
		relateTopic(`b timeline`, `b0`)

		const partitions = partitionTransactionSubEvents(
			IMPLICIT.STORE,
			[a0, molecule, a1, b0],
			new Set([`a timeline`, `b timeline`]),
		)

		expect(partitions.get(`a timeline`)).toEqual([a0, molecule, a1])
		expect(partitions.get(`b timeline`)).toEqual([molecule, b0])
	})

	test(`preserves an empty nested transaction wrapper`, () => {
		const excluded = atomUpdate(`excluded`)
		const nested = transactionOutcome(`nested`, [excluded])

		const partitions = partitionTransactionSubEvents(
			IMPLICIT.STORE,
			[nested],
			new Set([`timeline`]),
		)
		const [routed] = partitions.get(`timeline`) ?? []

		expect(routed).not.toBe(nested)
		expect(routed?.type).toBe(`transaction_outcome`)
		if (routed?.type !== `transaction_outcome`) return
		expect(routed.subEvents).toEqual([])
		expect(nested.subEvents).toEqual([excluded])
	})

	test(`reuses unchanged arrays and nested transaction nodes`, () => {
		const included = atomUpdate(`included`)
		const nested = transactionOutcome(`nested`, [included])
		const source = [nested]
		relateTopic(`timeline`, `included`)

		const partitions = partitionTransactionSubEvents(
			IMPLICIT.STORE,
			source,
			new Set([`timeline`]),
		)
		const partition = partitions.get(`timeline`)

		expect(partition).toBe(source)
		expect(partition?.[0]).toBe(nested)
	})

	test(`clones partial nested branches without mutating their source`, () => {
		const a = atomUpdate(`a`)
		const b = atomUpdate(`b`)
		const nested = transactionOutcome(`nested`, [a, b])
		const source = [nested]
		relateTopic(`a timeline`, `a`)
		relateTopic(`b timeline`, `b`)

		const partitions = partitionTransactionSubEvents(
			IMPLICIT.STORE,
			source,
			new Set([`a timeline`, `b timeline`]),
		)
		const [aBranch] = partitions.get(`a timeline`) ?? []
		const [bBranch] = partitions.get(`b timeline`) ?? []

		expect(aBranch).not.toBe(nested)
		expect(bBranch).not.toBe(nested)
		expect(aBranch).not.toBe(bBranch)
		if (
			aBranch?.type !== `transaction_outcome` ||
			bBranch?.type !== `transaction_outcome`
		) {
			return
		}
		expect(aBranch.subEvents).toEqual([a])
		expect(bBranch.subEvents).toEqual([b])
		expect(nested.subEvents).toEqual([a, b])
		expect(source).toEqual([nested])
	})
})

test(`disjoint timelines undo and redo a nested transaction independently`, () => {
	const aAtom = atom<number>({ key: `a`, default: 0 })
	const bAtom = atom<number>({ key: `b`, default: 0 })
	const aTimeline = timeline({ key: `a timeline`, scope: [aAtom] })
	const bTimeline = timeline({ key: `b timeline`, scope: [bAtom] })
	const setB = transaction<() => void>({
		key: `set b`,
		do: ({ set }) => {
			set(bAtom, 1)
		},
	})
	const setBoth = transaction<() => void>({
		key: `set both`,
		do: ({ run, set }) => {
			set(aAtom, 1)
			run(setB)()
		},
	})

	runTransaction(setBoth)()
	expect(getState(aAtom)).toBe(1)
	expect(getState(bAtom)).toBe(1)

	undo(aTimeline)
	expect(getState(aAtom)).toBe(0)
	expect(getState(bAtom)).toBe(1)

	undo(bTimeline)
	expect(getState(aAtom)).toBe(0)
	expect(getState(bAtom)).toBe(0)

	redo(bTimeline)
	expect(getState(aAtom)).toBe(0)
	expect(getState(bAtom)).toBe(1)

	redo(aTimeline)
	expect(getState(aAtom)).toBe(1)
	expect(getState(bAtom)).toBe(1)
})

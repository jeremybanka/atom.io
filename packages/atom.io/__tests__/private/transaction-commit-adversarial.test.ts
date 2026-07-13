import type { Logger, TransactionOutcomeEvent } from "atom.io"
import {
	atom,
	AtomIOLogger,
	getState,
	inspectTimeline,
	runTransaction,
	selector,
	setState,
	Silo,
	subscribe,
	timeline,
	transaction,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { vitest } from "vitest"

import {
	closeOperation as closeSourceOperation,
	openOperation as openSourceOperation,
} from "../../src/internal/operation.ts"
import {
	drainOperationQueue,
	enqueueOperation,
} from "../../src/internal/operation-queue.ts"
import {
	cancelStateNotificationBatch,
	deferStateNotification,
	flushStateNotificationBatch,
	hasStateNotificationBatch,
	startStateNotificationBatch,
} from "../../src/internal/state-notification-batch.ts"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

function captureError(run: () => void): unknown {
	try {
		run()
	} catch (error) {
		return error
	}
	throw new Error(`Expected the operation to throw`)
}

function expectAggregateError(error: unknown, messages: string[]): void {
	expect(error).toBeInstanceOf(AggregateError)
	if (!(error instanceof AggregateError)) return
	const actualMessages = error.errors.map((item: unknown) =>
		item instanceof Error ? item.message : String(item),
	)
	for (const message of messages) {
		expect(actualMessages).toContain(message)
	}
}

function isolatedSilo(name: string): Silo {
	return new Silo({
		name,
		lifespan: `ephemeral`,
		isProduction: true,
	})
}

describe(`batched transaction exception boundaries`, () => {
	it(`commits and finalizes before reporting an atom subscriber error`, () => {
		const silo = isolatedSilo(`atom-subscriber-error`)
		const leftAtom = silo.atom<number>({ key: `left`, default: 0 })
		const rightAtom = silo.atom<number>({ key: `right`, default: 0 })
		const setBothTX = silo.transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		Internal.assignTransactionToContinuity(
			silo.store,
			`setBothContinuity`,
			setBothTX.key,
		)
		const laterLeftSubscriber = vitest.fn()
		const rightSubscriber = vitest.fn()
		const outcomeSnapshots: [left: number, right: number, epoch: number][] = []

		silo.subscribe(leftAtom, () => {
			throw new Error(`left subscriber failed`)
		})
		silo.subscribe(leftAtom, laterLeftSubscriber)
		silo.subscribe(rightAtom, rightSubscriber)
		silo.subscribe(setBothTX, () => {
			outcomeSnapshots.push([
				silo.getState(leftAtom),
				silo.getState(rightAtom),
				Internal.getEpochNumberOfAction(silo.store, setBothTX.key)!,
			])
		})

		const error = captureError(() => {
			silo.runTransaction(setBothTX)()
		})

		expectAggregateError(error, [`left subscriber failed`])
		expect([silo.getState(leftAtom), silo.getState(rightAtom)]).toEqual([1, 2])
		expect(laterLeftSubscriber).toHaveBeenCalledOnce()
		expect(rightSubscriber).toHaveBeenCalledOnce()
		expect(outcomeSnapshots).toEqual([[1, 2, 0]])
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()
	})

	it(`preserves new dynamic roots when selector computation throws`, () => {
		const silo = isolatedSilo(`selector-computation-error`)
		const chooseRightAtom = silo.atom<boolean>({
			key: `chooseRight`,
			default: false,
		})
		const leftAtom = silo.atom<number>({ key: `left`, default: 1 })
		const rightAtom = silo.atom<number>({ key: `right`, default: 10 })
		let failOnTwenty = true
		const selectedBranchSelector = silo.selector<number>({
			key: `selectedBranch`,
			get: ({ get }) => {
				if (!get(chooseRightAtom)) return get(leftAtom)
				const right = get(rightAtom)
				if (failOnTwenty && right === 20) {
					throw new Error(`selector computation failed`)
				}
				return right
			},
		})
		const selectedSelector = silo.selector<number>({
			key: `selected`,
			get: ({ get }) => get(selectedBranchSelector),
		})
		const switchBranchTX = silo.transaction<() => void>({
			key: `switchBranch`,
			commit: `batched`,
			do: ({ set }) => {
				set(rightAtom, 20)
				set(chooseRightAtom, true)
			},
		})
		const selectorUpdates = vitest.fn()
		const transactionUpdates = vitest.fn()

		silo.subscribe(selectedSelector, selectorUpdates)
		silo.subscribe(switchBranchTX, transactionUpdates)
		const error = captureError(() => {
			silo.runTransaction(switchBranchTX)()
		})

		expectAggregateError(error, [`selector computation failed`])
		expect(silo.getState(chooseRightAtom)).toBe(true)
		expect(silo.getState(rightAtom)).toBe(20)
		expect(transactionUpdates).toHaveBeenCalledOnce()
		expect(selectorUpdates).not.toHaveBeenCalled()
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()

		failOnTwenty = false
		silo.setState(rightAtom, 21)
		expect(selectorUpdates).toHaveBeenCalledOnce()
		expect(selectorUpdates.mock.calls[0]?.[0].newValue).toBe(21)
		silo.setState(leftAtom, 2)
		expect(selectorUpdates).toHaveBeenCalledOnce()
	})

	it(`continues selector and outcome delivery after a selector subscriber throws`, () => {
		const silo = isolatedSilo(`selector-subscriber-error`)
		const leftAtom = silo.atom<number>({ key: `left`, default: 0 })
		const rightAtom = silo.atom<number>({ key: `right`, default: 0 })
		const totalSelector = silo.selector<number>({
			key: `total`,
			get: ({ get }) => get(leftAtom) + get(rightAtom),
		})
		const setBothTX = silo.transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		const laterSelectorSubscriber = vitest.fn()
		const transactionSubscriber = vitest.fn()

		silo.subscribe(totalSelector, () => {
			throw new Error(`selector subscriber failed`)
		})
		silo.subscribe(totalSelector, laterSelectorSubscriber)
		silo.subscribe(setBothTX, transactionSubscriber)

		const error = captureError(() => {
			silo.runTransaction(setBothTX)()
		})

		expectAggregateError(error, [`selector subscriber failed`])
		expect(silo.getState(totalSelector)).toBe(3)
		expect(laterSelectorSubscriber).toHaveBeenCalledOnce()
		expect(transactionSubscriber).toHaveBeenCalledOnce()
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()
	})

	it(`rolls back staged values when installation throws`, () => {
		const silo = isolatedSilo(`staging-error`)
		const leftAtom = silo.atom<number>({ key: `left`, default: 0 })
		const explosiveAtom = silo.atom<object>({ key: `explosive`, default: {} })
		const leftValueSelector = silo.selector<number>({
			key: `leftValue`,
			get: ({ get }) => get(leftAtom),
		})
		let hasChecks = 0
		const explosiveValue = new Proxy(
			{},
			{
				has: () => {
					hasChecks += 1
					if (hasChecks === 2) throw new Error(`staging failed`)
					return false
				},
			},
		)
		const stageErrorTX = silo.transaction<() => void>({
			key: `stageError`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(explosiveAtom, explosiveValue)
			},
		})
		const selectorUpdates = vitest.fn()
		const transactionUpdates = vitest.fn()
		silo.subscribe(leftValueSelector, selectorUpdates)
		silo.subscribe(stageErrorTX, transactionUpdates)

		expect(() => {
			silo.runTransaction(stageErrorTX)()
		}).toThrow(`staging failed`)

		expect(silo.getState(leftAtom)).toBe(0)
		expect(silo.getState(leftValueSelector)).toBe(0)
		expect(selectorUpdates).not.toHaveBeenCalled()
		expect(transactionUpdates).not.toHaveBeenCalled()
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()

		silo.setState(leftAtom, 2)
		expect(selectorUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 2 })
	})

	it(`does not leave an operation open when opening log filtering throws`, () => {
		const silo = isolatedSilo(`open-logger-error`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`info`,
				(icon) => {
					if (icon === `⭕`) throw new Error(`opening logger failed`)
					return false
				},
				nullLogger,
			),
		]

		expect(() => Internal.openOperation(silo.store, countAtom)).toThrow(
			`opening logger failed`,
		)
		expect(silo.store.operation.open).toBe(false)
	})

	it(`detaches a transaction child when build logging throws`, () => {
		const silo = isolatedSilo(`build-logger-error`)
		const noOpTX = silo.transaction<() => void>({
			key: `noOp`,
			commit: `batched`,
			do: () => {},
		})
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`info`,
				(icon) => {
					if (icon === `🛫`) throw new Error(`build logger failed`)
					return false
				},
				nullLogger,
			),
		]

		expect(() => {
			silo.runTransaction(noOpTX)()
		}).toThrow(`build logger failed`)
		expect(silo.store.child).toBeNull()
	})

	it(`aggregates an opening logger error with cleanup failure`, () => {
		const silo = isolatedSilo(`open-cleanup-error`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		silo.store.on.operationClose.subscribe(`failing-cleanup`, () => {
			throw new Error(`opening cleanup failed`)
		})
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`info`,
				(icon) => {
					if (icon === `⭕`) throw new Error(`opening logger failed`)
					return false
				},
				nullLogger,
			),
		]

		const error = captureError(() => {
			Internal.openOperation(silo.store, countAtom)
		})

		expectAggregateError(error, [
			`opening logger failed`,
			`opening cleanup failed`,
		])
		expect(silo.store.operation.open).toBe(false)
	})

	it(`closes and publishes operationClose even when closing log filtering throws`, () => {
		const silo = isolatedSilo(`close-logger-error`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		Internal.openOperation(silo.store, countAtom)
		const operationCloseSubscriber = vitest.fn()
		silo.store.on.operationClose.subscribe(`test`, operationCloseSubscriber)
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`info`,
				(icon) => {
					if (icon === `🔴`) throw new Error(`closing logger failed`)
					return false
				},
				nullLogger,
			),
		]

		expect(() => {
			Internal.closeOperation(silo.store)
		}).toThrow(`closing logger failed`)
		expect(silo.store.operation.open).toBe(false)
		expect(operationCloseSubscriber).toHaveBeenCalledOnce()
	})

	it(`aggregates closing logger and operationClose errors`, () => {
		const silo = isolatedSilo(`close-cleanup-error`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		Internal.openOperation(silo.store, countAtom)
		silo.store.on.operationClose.subscribe(`failing-cleanup`, () => {
			throw new Error(`operationClose failed`)
		})
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`info`,
				(icon) => {
					if (icon === `🔴`) throw new Error(`closing logger failed`)
					return false
				},
				nullLogger,
			),
		]

		const error = captureError(() => {
			Internal.closeOperation(silo.store)
		})

		expectAggregateError(error, [
			`closing logger failed`,
			`operationClose failed`,
		])
		expect(silo.store.operation.open).toBe(false)
	})

	it(`reports logger failures from a committed outcome observer`, () => {
		const silo = isolatedSilo(`outcome-logger-error`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const setCountTX = silo.transaction<() => void>({
			key: `setCount`,
			commit: `batched`,
			do: ({ set }) => {
				set(countAtom, 1)
			},
		})
		const nullLogger: Logger = {
			error: () => {},
			info: () => {},
			warn: () => {},
		}
		silo.store.loggers = [
			new AtomIOLogger(
				`warn`,
				() => {
					throw new Error(`outcome logger failed`)
				},
				nullLogger,
			),
		]
		silo.subscribe(setCountTX, () => {
			silo.store.logger.warn(
				`💥`,
				`transaction`,
				setCountTX.key,
				`outcome observer log`,
			)
		})

		const error = captureError(() => {
			silo.runTransaction(setCountTX)()
		})

		expectAggregateError(error, [`outcome logger failed`])
		expect(silo.getState(countAtom)).toBe(1)
		expect(silo.store.operation.open).toBe(false)
	})
})

describe(`commit support queues and batches`, () => {
	it(`aggregates multiple deferred operation errors`, () => {
		const silo = isolatedSilo(`deferred-operation-errors`)
		enqueueOperation(silo.store, () => {
			throw new Error(`first deferred failure`)
		})
		enqueueOperation(silo.store, () => {
			throw new Error(`second deferred failure`)
		})

		const error = captureError(() => {
			drainOperationQueue(silo.store)
		})

		expectAggregateError(error, [
			`first deferred failure`,
			`second deferred failure`,
		])
	})

	it(`pauses draining while an operation remains open`, () => {
		const silo = isolatedSilo(`deferred-operation-pause`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const order: string[] = []
		enqueueOperation(silo.store, () => {
			openSourceOperation(silo.store, countAtom)
			order.push(`opened`)
		})
		enqueueOperation(silo.store, () => {
			order.push(`resumed`)
		})

		drainOperationQueue(silo.store)
		expect(order).toEqual([`opened`])
		closeSourceOperation(silo.store)
		expect(order).toEqual([`opened`, `resumed`])
	})

	it(`flushes and cancels notification batches explicitly`, () => {
		const silo = isolatedSilo(`notification-batch-lifecycle`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const countState = Internal.withdraw(silo.store, countAtom)
		const subscriber = vitest.fn()
		silo.subscribe(countAtom, subscriber)

		startStateNotificationBatch(silo.store)
		deferStateNotification(silo.store, countAtom.key, countState.subject, {
			oldValue: 0,
			newValue: 1,
		})
		flushStateNotificationBatch(silo.store)
		expect(subscriber).toHaveBeenCalledWith({ oldValue: 0, newValue: 1 })
		expect(hasStateNotificationBatch(silo.store)).toBe(false)

		startStateNotificationBatch(silo.store)
		cancelStateNotificationBatch(silo.store)
		expect(hasStateNotificationBatch(silo.store)).toBe(false)
	})
})

describe(`batched transaction reentrancy`, () => {
	it(`queues a whole transaction started from an atom subscriber`, () => {
		const triggerAtom = atom<number>({ key: `trigger`, default: 0 })
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const pairTimeline = timeline({
			key: `pairTimeline`,
			scope: [leftAtom, rightAtom],
		})
		const setBothTX = transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		const outcomeSnapshots: [left: number, right: number][] = []
		const callbackSnapshots: [left: number, right: number][] = []

		subscribe(setBothTX, () => {
			outcomeSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})
		subscribe(triggerAtom, () => {
			runTransaction(setBothTX)()
			callbackSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})

		setState(triggerAtom, 1)

		expect(callbackSnapshots).toEqual([[0, 0]])
		expect(outcomeSnapshots).toEqual([[1, 2]])
		expect([getState(leftAtom), getState(rightAtom)]).toEqual([1, 2])
		expect(inspectTimeline(pairTimeline)).toEqual({ at: 1, length: 1 })
		expect(Internal.IMPLICIT.STORE.on.transactionApplying.state).toBeNull()
	})

	it(`preserves FIFO between a queued transaction and a later state write`, () => {
		const triggerAtom = atom<number>({ key: `trigger`, default: 0 })
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const incrementTX = transaction<() => void>({
			key: `increment`,
			commit: `batched`,
			do: ({ get, set }) => {
				set(countAtom, get(countAtom) + 1)
			},
		})
		const observedCounts: number[] = []

		subscribe(triggerAtom, () => {
			runTransaction(incrementTX)()
			setState(countAtom, (count) => count + 1)
		})
		subscribe(countAtom, () => {
			observedCounts.push(getState(countAtom))
		})

		setState(triggerAtom, 1)

		expect(getState(countAtom)).toBe(2)
		expect(observedCounts).toEqual([1, 2])
	})

	it(`drains reentrant JOIN_OP notifications in a later phase`, () => {
		const silo = isolatedSilo(`join-op-reentrancy`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const setCountTX = silo.transaction<() => void>({
			key: `setCount`,
			commit: `batched`,
			do: ({ set }) => {
				set(countAtom, 1)
			},
		})
		const updates: { oldValue?: number; newValue: number }[] = []

		silo.subscribe(countAtom, (update) => {
			updates.push(update)
			if (update.newValue === 1) {
				Internal.operateOnStore(Internal.JOIN_OP, silo.store, countAtom, 2)
			}
		})

		silo.runTransaction(setCountTX)()

		expect(silo.getState(countAtom)).toBe(2)
		expect(updates).toEqual([
			{ oldValue: 0, newValue: 1 },
			{ oldValue: 1, newValue: 2 },
		])
	})

	it(`queues the family overload of a reentrant JOIN_OP`, () => {
		const silo = isolatedSilo(`join-op-family-reentrancy`)
		const countAtoms = silo.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		silo.setState(countAtoms, `a`, 0)
		const countAtom = silo.findState(countAtoms, `a`)
		const setCountTX = silo.transaction<() => void>({
			key: `setCount`,
			commit: `batched`,
			do: ({ set }) => {
				set(countAtom, 1)
			},
		})
		const updates: { oldValue?: number; newValue: number }[] = []

		silo.subscribe(countAtom, (update) => {
			updates.push(update)
			if (update.newValue === 1) {
				Internal.operateOnStore(Internal.JOIN_OP, silo.store, countAtoms, `a`, 2)
			}
		})

		silo.runTransaction(setCountTX)()

		expect(silo.getState(countAtom)).toBe(2)
		expect(updates).toEqual([
			{ oldValue: 0, newValue: 1 },
			{ oldValue: 1, newValue: 2 },
		])
	})

	it(`restores transactionApplying while draining a queued inner transaction`, () => {
		const triggerAtom = atom<number>({ key: `trigger`, default: 0 })
		const siblingAtom = atom<number>({ key: `sibling`, default: 0 })
		const resultAtom = atom<number>({ key: `result`, default: 0 })
		const allTimeline = timeline({
			key: `allTimeline`,
			scope: [triggerAtom, siblingAtom, resultAtom],
		})
		const innerTX = transaction<() => void>({
			key: `inner`,
			commit: `batched`,
			do: ({ set }) => {
				set(resultAtom, 7)
			},
		})
		const outerTX = transaction<() => void>({
			key: `outer`,
			commit: `batched`,
			do: ({ set }) => {
				set(triggerAtom, 1)
				set(siblingAtom, 2)
			},
		})
		const outcomeOrder: string[] = []
		const siblingApplyingKeys: (string | null)[] = []
		let innerOutcome: TransactionOutcomeEvent<typeof innerTX> | undefined

		subscribe(triggerAtom, () => {
			runTransaction(innerTX)()
		})
		subscribe(siblingAtom, () => {
			siblingApplyingKeys.push(
				Internal.IMPLICIT.STORE.on.transactionApplying.state?.update.token.key ??
					null,
			)
		})
		subscribe(outerTX, () => outcomeOrder.push(`outer`))
		subscribe(innerTX, (outcome) => {
			innerOutcome = outcome
			outcomeOrder.push(`inner`)
		})

		runTransaction(outerTX)()

		expect(getState(resultAtom)).toBe(7)
		expect(innerOutcome?.subEvents.map((event) => event.type)).toEqual([
			`atom_update`,
		])
		expect(outcomeOrder).toEqual([`outer`, `inner`])
		expect(siblingApplyingKeys).toEqual([`outer`])
		expect(inspectTimeline(allTimeline)).toEqual({ at: 2, length: 2 })
		expect(Internal.IMPLICIT.STORE.on.transactionApplying.state).toBeNull()
	})

	it(`builds queued transactions from the preceding staged result`, () => {
		const triggerAtom = atom<number>({ key: `trigger`, default: 0 })
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const incrementTX = transaction<() => void>({
			key: `increment`,
			commit: `batched`,
			do: ({ get, set }) => {
				set(countAtom, get(countAtom) + 1)
			},
		})
		const triggerTX = transaction<() => void>({
			key: `triggerIncrement`,
			commit: `batched`,
			do: ({ set }) => {
				set(triggerAtom, 1)
			},
		})
		const outcomeCounts: number[] = []

		subscribe(triggerAtom, () => {
			runTransaction(incrementTX)()
			runTransaction(incrementTX)()
		})
		subscribe(incrementTX, () => {
			outcomeCounts.push(getState(countAtom))
		})

		runTransaction(triggerTX)()

		expect(getState(countAtom)).toBe(2)
		expect(outcomeCounts).toEqual([1, 2])
	})

	it(`continues draining queued commits after an observer fails`, () => {
		const triggerAtom = atom<number>({ key: `trigger`, default: 0 })
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const incrementTX = transaction<() => void>({
			key: `increment`,
			commit: `batched`,
			do: ({ get, set }) => {
				set(countAtom, get(countAtom) + 1)
			},
		})
		const triggerTX = transaction<() => void>({
			key: `triggerIncrement`,
			commit: `batched`,
			do: ({ set }) => {
				set(triggerAtom, 1)
			},
		})

		subscribe(triggerAtom, () => {
			runTransaction(incrementTX)()
			runTransaction(incrementTX)()
		})
		subscribe(countAtom, (update) => {
			if (update.newValue === 1) throw new Error(`increment observer failed`)
		})

		const error = captureError(() => {
			runTransaction(triggerTX)()
		})

		expect(error).toBeInstanceOf(AggregateError)
		expect(error).toHaveProperty(
			`message`,
			expect.stringContaining(`increment observer failed`),
		)
		expect(getState(countAtom)).toBe(2)
		expect(Internal.IMPLICIT.STORE.operation.open).toBe(false)
		expect(Internal.IMPLICIT.STORE.on.transactionApplying.state).toBeNull()
	})
})

describe(`batched transaction publication`, () => {
	it(`prepares only relevant active timelines for nested events`, () => {
		const silo = isolatedSilo(`nested-timeline-publication`)
		const nestedAtom = silo.atom<number>({ key: `nested`, default: 0 })
		const unrelatedAtom = silo.atom<number>({ key: `unrelated`, default: 0 })
		const pausedAtom = silo.atom<number>({ key: `paused`, default: 0 })
		const nestedTimeline = silo.timeline({
			key: `nestedTimeline`,
			scope: [nestedAtom],
		})
		const unrelatedTimeline = silo.timeline({
			key: `unrelatedTimeline`,
			scope: [unrelatedAtom],
		})
		const pausedTimeline = silo.timeline({
			key: `pausedTimeline`,
			scope: [pausedAtom],
		})
		Internal.withdraw(silo.store, pausedTimeline).timeTraveling = `into_past`
		const innerTX = silo.transaction<() => void>({
			key: `inner`,
			do: ({ set }) => {
				set(nestedAtom, 1)
			},
		})
		const outerTX = silo.transaction<() => void>({
			key: `outer`,
			commit: `batched`,
			do: ({ run, set }) => {
				run(innerTX)()
				set(pausedAtom, 1)
			},
		})

		silo.runTransaction(outerTX)()

		expect(Internal.inspectTimelineInStore(silo.store, nestedTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(
			Internal.inspectTimelineInStore(silo.store, unrelatedTimeline),
		).toEqual({ at: 0, length: 0 })
		expect(Internal.inspectTimelineInStore(silo.store, pausedTimeline)).toEqual({
			at: 0,
			length: 0,
		})
	})

	it(`publishes timeline and forwarding outcomes despite observer errors`, () => {
		const source = isolatedSilo(`adversarial-event-source`)
		const destination = isolatedSilo(`adversarial-event-destination`)
		const sourceLeftAtom = source.atom<number>({
			key: `sourceLeft`,
			default: 0,
		})
		const sourceRightAtom = source.atom<number>({
			key: `sourceRight`,
			default: 0,
		})
		const timelineSideEffectAtom = source.atom<number>({
			key: `timelineSideEffect`,
			default: 0,
		})
		destination.install([sourceLeftAtom, sourceRightAtom], source.store)
		const publicationOrder: string[] = []
		let forwarded = false
		const pairTimeline = source.timeline({
			key: `pairTimeline`,
			scope: [sourceLeftAtom, sourceRightAtom],
		})
		source.subscribe(
			pairTimeline,
			() => {
				publicationOrder.push(`timeline`)
				source.setState(timelineSideEffectAtom, 99)
				throw new Error(`timeline observer failed`)
			},
			`timeline-observer`,
		)
		source.subscribe(
			pairTimeline,
			() => {
				publicationOrder.push(`later timeline observer`)
			},
			`later-timeline-observer`,
		)
		source.subscribe(sourceLeftAtom, () => {
			publicationOrder.push(`atom`)
			expect(
				Internal.inspectTimelineInStore(source.store, pairTimeline),
			).toEqual({
				at: 1,
				length: 1,
			})
			expect(forwarded).toBe(true)
			expect(source.getState(timelineSideEffectAtom)).toBe(0)
			throw new Error(`atom observer failed`)
		})
		const setBothTX = source.transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(sourceLeftAtom, 1)
				set(sourceRightAtom, 2)
			},
		})
		source.subscribe(setBothTX, () => {
			publicationOrder.push(`outcome observer`)
			throw new Error(`outcome observer failed`)
		})
		Internal.subscribeToTransaction(
			source.store,
			setBothTX,
			`test-realtime-forwarding`,
			(outcome) => {
				Internal.ingestTransactionOutcomeEvent(
					destination.store,
					outcome,
					`newValue`,
				)
				forwarded = true
				publicationOrder.push(`forwarded`)
			},
			`realtime`,
		)

		const error = captureError(() => {
			source.runTransaction(setBothTX)()
		})

		expectAggregateError(error, [
			`timeline observer failed`,
			`atom observer failed`,
			`outcome observer failed`,
		])
		expect(forwarded).toBe(true)
		expect(source.getState(timelineSideEffectAtom)).toBe(99)
		expect(publicationOrder).toEqual([
			`forwarded`,
			`timeline`,
			`later timeline observer`,
			`atom`,
			`outcome observer`,
		])
		expect([
			destination.getState(sourceLeftAtom),
			destination.getState(sourceRightAtom),
		]).toEqual([1, 2])
		expect(Internal.inspectTimelineInStore(source.store, pairTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(source.store.on.transactionApplying.state).toBeNull()
	})

	it(`does not infer internal observers from public subscription keys`, () => {
		const silo = isolatedSilo(`public-subscription-keys`)
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const sideEffectAtom = silo.atom<number>({ key: `sideEffect`, default: 0 })
		const setCountTX = silo.transaction<() => void>({
			key: `setCount`,
			commit: `batched`,
			do: ({ set }) => {
				set(countAtom, 1)
			},
		})
		const atomUpdates = vitest.fn()
		const sideEffectSnapshots: number[] = []

		silo.subscribe(
			countAtom,
			(update) => {
				atomUpdates(update)
				sideEffectSnapshots.push(silo.getState(sideEffectAtom))
			},
			`timeline`,
		)
		silo.subscribe(
			setCountTX,
			() => {
				silo.setState(sideEffectAtom, 99)
			},
			`sync-continuity:spoofed`,
		)

		silo.runTransaction(setCountTX)()

		expect(atomUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 1 })
		expect(sideEffectSnapshots).toEqual([0])
		expect(silo.getState(sideEffectAtom)).toBe(99)
	})
})

describe(`strict and preferred batched commits`, () => {
	it(`commits an empty strict batch`, () => {
		const silo = isolatedSilo(`empty-strict-batch`)
		const emptyTX = silo.transaction<() => string>({
			key: `empty`,
			commit: `batched`,
			do: () => `done`,
		})
		const transactionSubscriber = vitest.fn()
		silo.subscribe(emptyTX, transactionSubscriber)

		expect(silo.runTransaction(emptyTX)()).toBe(`done`)
		expect(transactionSubscriber).toHaveBeenCalledOnce()
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()
	})

	it(`strict batching rejects unsupported work before parent mutation`, async () => {
		const silo = isolatedSilo(`strict-batching`)
		const promisedAtom = silo.atom<number | Promise<number>>({
			key: `promised`,
			default: 0,
		})
		const setPromisedTX = silo.transaction<() => void>({
			key: `setPromised`,
			commit: `batched`,
			do: ({ set }) => {
				set(promisedAtom, Promise.resolve(1))
			},
		})
		const transactionSubscriber = vitest.fn()
		const atomSubscriber = vitest.fn()
		silo.subscribe(setPromisedTX, transactionSubscriber)
		silo.subscribe(promisedAtom, atomSubscriber)

		expect(() => {
			silo.runTransaction(setPromisedTX)()
		}).toThrow()
		expect(silo.getState(promisedAtom)).toBe(0)
		expect(transactionSubscriber).not.toHaveBeenCalled()
		expect(silo.store.operation.open).toBe(false)
		expect(silo.store.on.transactionApplying.state).toBeNull()
		await Promise.resolve()
		await Promise.resolve()
		expect(atomSubscriber).not.toHaveBeenCalled()
		expect(silo.getState(promisedAtom)).toBe(0)
	})

	it(`strict batching rejects an unsupported intermediate update`, () => {
		const silo = isolatedSilo(`strict-intermediate-update`)
		const promisedAtom = silo.atom<number | Promise<number>>({
			key: `promised`,
			default: 0,
		})
		const setPromisedTX = silo.transaction<() => void>({
			key: `setPromised`,
			commit: `batched`,
			do: ({ set }) => {
				set(promisedAtom, Promise.resolve(1))
				set(promisedAtom, 2)
			},
		})

		expect(() => {
			silo.runTransaction(setPromisedTX)()
		}).toThrow(`strict batched commit`)
		expect(silo.getState(promisedAtom)).toBe(0)
	})

	it(`strict batching rejects an atom with a pending value`, async () => {
		const silo = isolatedSilo(`strict-pending-atom`)
		const promisedAtom = silo.atom<number | Promise<number>>({
			key: `promised`,
			default: 0,
		})
		let resolvePending = (_value: number) => {}
		const pending = new Promise<number>((resolve) => {
			resolvePending = resolve
		})
		silo.setState(promisedAtom, pending)
		const setPromisedTX = silo.transaction<() => void>({
			key: `setPromised`,
			commit: `batched`,
			do: ({ set }) => {
				set(promisedAtom, 2)
			},
		})

		expect(() => {
			silo.runTransaction(setPromisedTX)()
		}).toThrow(`pending atom`)
		resolvePending(1)
		expect(await silo.getState(promisedAtom)).toBe(1)
	})

	it(`preferred batching falls back to playback for unsupported work`, async () => {
		const silo = isolatedSilo(`preferred-batching`)
		const promisedAtom = silo.atom<number | Promise<number>>({
			key: `promised`,
			default: 0,
		})
		const promisedValue = Promise.resolve(1)
		const setPromisedTX = silo.transaction<() => void>({
			key: `setPromised`,
			commit: `prefer-batched`,
			do: ({ set }) => {
				set(promisedAtom, promisedValue)
			},
		})
		const transactionSubscriber = vitest.fn()
		silo.subscribe(setPromisedTX, transactionSubscriber)

		silo.runTransaction(setPromisedTX)()

		expect(await silo.getState(promisedAtom)).toBe(1)
		expect(transactionSubscriber).toHaveBeenCalledOnce()
	})

	it(`uses the outermost playback strategy for nested transactions`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const totalSelector = selector<number>({
			key: `total`,
			get: ({ get }) => get(leftAtom) + get(rightAtom),
		})
		const innerTX = transaction<() => void>({
			key: `inner`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		const outerTX = transaction<() => void>({
			key: `outer`,
			do: ({ run }) => {
				run(innerTX)()
			},
		})
		const selectorUpdates = vitest.fn()
		subscribe(totalSelector, selectorUpdates)

		runTransaction(outerTX)()

		expect(selectorUpdates.mock.calls).toEqual([
			[{ oldValue: 0, newValue: 1 }],
			[{ oldValue: 1, newValue: 3 }],
		])
	})
})

import type {
	AtomCreationEvent,
	AtomDisposalEvent,
	AtomFamilyToken,
	AtomToken,
	AtomUpdateEvent,
	FamilyMetadata,
	StateUpdate,
	TimelineCullEvent,
	TimelineEffect,
	TimelineEvent,
	TimelineManageable,
	TimelineOptions,
	TimelineToken,
	TimelineUpdate,
	TransactionOutcomeEvent,
	TransactionSubEvent,
	TransactionToken,
	WritablePureSelectorToken,
} from "atom.io"
import { Subject } from "atom.io/foundations/subject"

import { ensureState } from "../get-state/ensure-state.ts"
import { eldest, newest } from "../lineage.ts"
import { getUpdateToken } from "../mutable/index.ts"
import type { Atom } from "../state-types.ts"
import { deposit, type Store, withdraw } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { isChildStore } from "../transaction/index.ts"
import type { GroupedTimelineTransactionEvent } from "./timeline-transaction-group.ts"
import {
	addTimelineToTransactionGroup,
	TIMELINE_TRANSACTION_GROUP,
} from "./timeline-transaction-group.ts"

type TimelineRecordCallback = (event: {
	readonly type: `timeline_record`
	readonly event: TimelineEvent<any>
}) => void

export type Timeline<ManagedAtom extends TimelineManageable> = {
	type: `timeline`
	key: string
	family?: FamilyMetadata
	at: number
	timeTraveling: `into_future` | `into_past` | null
	history: TimelineEvent<ManagedAtom>[]
	selectorTime: number | null
	transactionKey: string | null
	onRecordCallbacks: Set<TimelineRecordCallback>
	pendingRecord: TimelineEvent<ManagedAtom> | null
	pendingUndoStepLimit: number | null
	cleanup: (() => void) | null
	ownedTopicKeys: Set<string>
	install: (store: RootStore) => void
	subject: Subject<TimelineUpdate<ManagedAtom>>
	subscriptions: Map<string, () => void>
}

export function createTimeline<ManagedAtom extends TimelineManageable>(
	store: RootStore,
	options: TimelineOptions<ManagedAtom>,
	data?: Timeline<ManagedAtom>,
	family?: FamilyMetadata,
): TimelineToken<ManagedAtom> {
	const tl: Timeline<ManagedAtom> = {
		type: `timeline`,
		key: options.key,
		...(family ? { family } : {}),
		at: 0,
		timeTraveling: null,
		selectorTime: null,
		transactionKey: null,
		...data,
		history: data?.history.map((update) => ({ ...update })) ?? [],
		install: (s) => createTimeline(s, options, tl),
		onRecordCallbacks: new Set(),
		pendingRecord: null,
		pendingUndoStepLimit: null,
		cleanup: null,
		ownedTopicKeys: new Set(),
		subject: new Subject(),
		subscriptions: new Map(),
	}

	const timelineKey = options.key
	const target = newest(store)
	for (const initialTopic of options.scope) {
		switch (initialTopic.type) {
			case `atom`:
			case `mutable_atom`:
				{
					const atomToken: AtomToken<any, any, any> = initialTopic
					const atomKey = atomToken.key
					let existingTimelineKey = target.timelineTopics.getRelatedKey(atomKey)
					if (`family` in atomToken) {
						const familyKey = atomToken.family.key
						existingTimelineKey = target.timelineTopics.getRelatedKey(familyKey)
						if (existingTimelineKey) {
							store.logger.error(
								`❌`,
								`timeline`,
								options.key,
								`Failed to add atom "${atomKey}" because its family "${familyKey}" already belongs to timeline "${existingTimelineKey}"`,
							)
							continue
						}
					}
					if (existingTimelineKey) {
						store.logger.error(
							`❌`,
							`timeline`,
							options.key,
							`Failed to add atom "${atomKey}" because it already belongs to timeline "${existingTimelineKey}"`,
						)
						continue
					}
					addAtomToTimeline(store, atomToken, tl)
				}
				break

			case `atom_family`:
			case `mutable_atom_family`:
				{
					const familyToken: AtomFamilyToken<any, any, any> = initialTopic
					const familyKey = familyToken.key
					const existingTimelineKey =
						target.timelineTopics.getRelatedKey(familyKey)
					if (existingTimelineKey) {
						store.logger.error(
							`❌`,
							`timeline`,
							options.key,
							`Failed to add atom family "${familyKey}" because it already belongs to timeline "${existingTimelineKey}"`,
						)
						continue
					}
					addAtomFamilyToTimeline(store, familyToken, tl)
				}
				break
		}
	}
	tl.ownedTopicKeys = new Set(store.timelineTopics.getRelatedKeys(tl.key) ?? [])

	store.timelines.set(options.key, tl)
	const token: TimelineToken<ManagedAtom> = {
		key: timelineKey,
		type: `timeline`,
		...(tl.family ? { family: tl.family } : {}),
	}
	installTimelineEffects(store, tl, token, options.effects)
	store.on.timelineCreation.next(token)
	return token
}

export function addAtomToTimeline(
	store: Store,
	atomToken: AtomToken<any, any, any>,
	tl: Timeline<any>,
): void {
	ensureState(store, atomToken)
	const atom = withdraw(store, atomToken)
	if (tl.subscriptions.has(atom.key)) {
		return
	}
	if (atom.type === `mutable_atom`) {
		const updateToken = getUpdateToken(atom)
		const updateAtom = withdraw(store, updateToken)
		addAtomTopicToTimeline(store, atom, tl)
		addAtomTopicToTimeline(store, updateAtom, tl)

		const unsubscribeFromReplacements = subscribeToAtomUpdates(
			store,
			atomToken,
			atom,
			tl,
			true,
		)
		const unsubscribeFromSignals = subscribeToAtomUpdates(
			store,
			updateToken,
			updateAtom,
			tl,
			false,
		)
		tl.subscriptions.set(atom.key, () => {
			unsubscribeFromReplacements()
			unsubscribeFromSignals()
		})
		return
	}

	addAtomTopicToTimeline(store, atom, tl)
	tl.subscriptions.set(
		atom.key,
		subscribeToAtomUpdates(store, atomToken, atom, tl, false),
	)
}

function addAtomTopicToTimeline(
	store: Store,
	atom: Atom<any, any>,
	tl: Timeline<any>,
): void {
	store.timelineTopics.set(
		{ topicKey: atom.key, timelineKey: tl.key },
		{ topicType: `atom` },
	)
	tl.ownedTopicKeys.add(atom.key)
}

function subscribeToAtomUpdates(
	store: Store,
	atomToken: AtomToken<any, any, any>,
	atom: Atom<any, any>,
	tl: Timeline<any>,
	referenceReplacementsOnly: boolean,
): () => void {
	return atom.subject.subscribe(
		`timeline`,
		function timelineCapturesAtomUpdate(update) {
			if (referenceReplacementsOnly && update.oldValue === update.newValue) {
				return
			}
			const target = newest(store)
			const currentSelectorToken =
				store.operation.open &&
				store.operation.token.type === `writable_pure_selector`
					? store.operation.token
					: null
			const currentSelectorTime =
				store.operation.open &&
				store.operation.token.type === `writable_pure_selector`
					? store.operation.timestamp
					: null

			const txUpdateInProgress = target.on.transactionApplying.state?.update

			store.logger.info(
				`⏳`,
				`timeline`,
				tl.key,
				`atom`,
				atomToken.key,
				`went`,
				update.oldValue,
				`->`,
				update.newValue,
				txUpdateInProgress
					? `in transaction "${txUpdateInProgress.token.key}"`
					: currentSelectorToken
						? `in selector "${currentSelectorToken.key}"`
						: ``,
			)
			if (tl.timeTraveling === null) {
				if (txUpdateInProgress) {
					joinTransaction(store, tl, txUpdateInProgress)
				} else if (currentSelectorToken && currentSelectorTime) {
					buildSelectorUpdate(
						store,
						tl,
						atomToken,
						update,
						currentSelectorToken,
						currentSelectorTime,
					)
				} else {
					const timestamp = Date.now()
					tl.selectorTime = null

					const atomUpdate: AtomUpdateEvent<any> & TimelineEvent<any> = {
						checkpoint: true,
						type: `atom_update`,
						token: deposit(atom),
						update,
						timestamp,
					}
					store.logger.info(
						`⌛`,
						`timeline`,
						tl.key,
						`got an atom_update to "${atom.key}"`,
					)
					addToHistory(tl, atomUpdate)
				}
			}
		},
	)
}

function addAtomFamilyToTimeline(
	store: Store,
	atomFamilyToken: AtomFamilyToken<any, any, any>,
	tl: Timeline<any>,
): void {
	const family = withdraw(store, atomFamilyToken)
	store.timelineTopics.set(
		{ topicKey: family.key, timelineKey: tl.key },
		{ topicType: `atom_family` },
	)
	tl.subscriptions.set(
		family.key,
		family.subject.subscribe(
			`timeline`,
			function timelineCapturesStateLifecycleEvent(creationOrDisposal) {
				handleStateLifecycleEvent(store, creationOrDisposal, tl)
			},
		),
	)
	for (const atom of store.atoms.values()) {
		if (atom.family?.key === family.key) {
			addAtomToTimeline(store, atom, tl)
		}
	}
}

function joinTransaction(
	store: Store,
	tl: Timeline<any>,
	txUpdateInProgress: TransactionOutcomeEvent<TransactionToken<any>>,
) {
	const currentTxKey = txUpdateInProgress.token.key
	const currentTxInstanceId = txUpdateInProgress.id
	const currentTxToken: TransactionToken<any> = {
		key: currentTxKey,
		type: `transaction`,
	}
	const currentTransaction = withdraw(store, currentTxToken)
	if (currentTxKey && tl.transactionKey === null) {
		tl.transactionKey = currentTxKey
		const ownedTopicKeysAtStart = new Set(tl.ownedTopicKeys)
		const unsubscribe = currentTransaction.subject.subscribe(
			`timeline:${tl.key}`,
			(transactionUpdate) => {
				unsubscribe()
				tl.transactionKey = null
				if (tl.timeTraveling === null && currentTxInstanceId) {
					const ownedTopicKeys = new Set([
						...ownedTopicKeysAtStart,
						...tl.ownedTopicKeys,
					])
					const subEventsFiltered = filterTransactionSubEvents(
						transactionUpdate.subEvents,
						ownedTopicKeys,
					)

					const timelineTransactionUpdate: GroupedTimelineTransactionEvent = {
						checkpoint: true,
						...transactionUpdate,
						subEvents: subEventsFiltered,
						[TIMELINE_TRANSACTION_GROUP]: addTimelineToTransactionGroup(
							transactionUpdate,
							tl.key,
						),
					}

					addToHistory(tl, timelineTransactionUpdate)
				}
			},
		)
	}
}

function buildSelectorUpdate(
	store: Store,
	tl: Timeline<any>,
	atomToken: AtomToken<any, any, any>,
	eventOrUpdate: AtomCreationEvent<any> | StateUpdate<any>,
	currentSelectorToken: WritablePureSelectorToken<any>,
	currentSelectorTime: number,
) {
	let latestEvent: TimelineEvent<any> | undefined = tl.history.at(-1)
	if (currentSelectorTime !== tl.selectorTime) {
		latestEvent = {
			checkpoint: true,
			type: `selector_update`,
			timestamp: currentSelectorTime,
			token: currentSelectorToken,
			subEvents: [],
		}
		if (`type` in eventOrUpdate) {
			latestEvent.subEvents.push(eventOrUpdate)
		} else {
			latestEvent.subEvents.push({
				type: `atom_update`,
				token: atomToken,
				update: eventOrUpdate,
				timestamp: Date.now(), // 👺 use store operation
			})
		}

		addToHistory(tl, latestEvent, false)
		tl.selectorTime = currentSelectorTime
		const unsubscribe = store.on.operationClose.subscribe(
			`timeline:${tl.key}:selector:${currentSelectorTime}`,
			() => {
				unsubscribe()
				settleHistoryRecord(tl, latestEvent as TimelineEvent<any>)
			},
		)

		store.logger.info(
			`⌛`,
			`timeline`,
			tl.key,
			`got a selector_update "${currentSelectorToken.key}" with`,
			latestEvent.subEvents.map((event) => event.token.key),
		)
	} else {
		if (latestEvent?.type === `selector_update`) {
			if (`type` in eventOrUpdate) {
				latestEvent.subEvents.push(eventOrUpdate)
			} else {
				latestEvent.subEvents.push({
					type: `atom_update`,
					token: atomToken,
					update: eventOrUpdate,
					timestamp: Date.now(), // 👺 use store operation
				})
			}
			store.logger.info(
				`⌛`,
				`timeline`,
				tl.key,
				`set selector_update "${currentSelectorToken.key}" to`,
				latestEvent?.subEvents.map((event) => event.token.key),
			)
		}
	}
}

function filterTransactionSubEvents(
	updates: TransactionSubEvent[],
	timelineTopics: Set<string>,
): TransactionSubEvent[] {
	return updates
		.filter((updateFromTx) => {
			if (updateFromTx.type === `transaction_outcome`) {
				return true
			}

			let key: string
			let familyKey: string | undefined
			switch (updateFromTx.type) {
				case `atom_update`:
				case `atom_creation`:
				case `atom_disposal`:
					key = updateFromTx.token.key
					familyKey = updateFromTx.token.family?.key
					break
				case `molecule_creation`:
				case `molecule_disposal`:
				case `molecule_transfer`:
					return true // always include
			}
			timelineTopics.has(key)
			if (familyKey && timelineTopics.has(familyKey)) {
				return true
			}
			return timelineTopics.has(key)
		})
		.map((updateFromTx): TransactionSubEvent => {
			if (`subEvents` in updateFromTx) {
				return {
					...updateFromTx,
					subEvents: filterTransactionSubEvents(
						updateFromTx.subEvents,
						timelineTopics,
					),
				}
			}
			return updateFromTx
		})
}

export function handleStateLifecycleEvent(
	store: Store,
	event: AtomCreationEvent<any> | AtomDisposalEvent<any>,
	tl: Timeline<any>,
): void {
	const target = newest(store)
	if (isChildStore(target)) {
		return
	}
	const currentSelectorToken =
		store.operation.open &&
		store.operation.token.type === `writable_pure_selector`
			? store.operation.token
			: null
	const currentSelectorTime =
		store.operation.open &&
		store.operation.token.type === `writable_pure_selector`
			? store.operation.timestamp
			: null
	if (!tl.timeTraveling) {
		const txUpdateInProgress = target.on.transactionApplying.state
		if (txUpdateInProgress) {
			joinTransaction(store, tl, txUpdateInProgress.update)
		} else if (
			currentSelectorToken &&
			currentSelectorTime &&
			event.type === `atom_creation`
		) {
			buildSelectorUpdate(
				store,
				tl,
				event.token,
				event,
				currentSelectorToken,
				currentSelectorTime,
			)
		} else {
			addToHistory(tl, event)
		}
	}
	switch (event.type) {
		case `atom_creation`:
			addAtomToTimeline(store, event.token, tl)
			break
		case `atom_disposal`:
			tl.subscriptions.get(event.token.key)?.()
			tl.subscriptions.delete(event.token.key)
			break
	}
}

function addToHistory(
	tl: Timeline<any>,
	event: TimelineEvent<any>,
	settle = true,
): void {
	if (tl.at !== tl.history.length) {
		tl.history.splice(tl.at)
	}
	tl.history.push(event)
	tl.at = tl.history.length
	tl.pendingRecord = event
	if (settle) {
		settleHistoryRecord(tl, event)
	}
}

function settleHistoryRecord(
	tl: Timeline<any>,
	event: TimelineEvent<any>,
): void {
	if (tl.pendingRecord !== event) {
		return
	}
	const recordEvent = {
		type: `timeline_record`,
		event,
	} as const
	try {
		for (const callback of tl.onRecordCallbacks) {
			callback(recordEvent)
		}
	} finally {
		const limit = tl.pendingUndoStepLimit
		tl.pendingRecord = null
		tl.pendingUndoStepLimit = null
		if (limit !== null) {
			cullTimelineUndoSteps(tl, limit)
		}
		tl.subject.next({
			type: `timeline_update`,
			event,
			at: tl.at,
			length: tl.history.length,
		})
	}
}

function cullTimelineUndoSteps(
	tl: Timeline<any>,
	limit: number,
): TimelineCullEvent | null {
	if (tl.at === 0) return null
	const checkpointStarts = [0]
	for (let index = 1; index < tl.at; index++) {
		if (tl.history[index].checkpoint === true) {
			checkpointStarts.push(index)
		}
	}
	const from = checkpointStarts.length
	const overflow = from - limit
	if (overflow <= 0) {
		return null
	}

	const deleteCount = limit === 0 ? tl.at : checkpointStarts[overflow]
	tl.history.splice(0, deleteCount)
	tl.at -= deleteCount
	return {
		type: `timeline_cull`,
		target: `undo_steps`,
		from,
		to: limit,
	}
}

function validateCullLimit(limit: number): void {
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new RangeError(
			`A timeline cull limit must be a non-negative safe integer.`,
		)
	}
}

function installTimelineEffects<ManagedAtom extends TimelineManageable>(
	store: RootStore,
	tl: Timeline<ManagedAtom>,
	token: TimelineToken<ManagedAtom>,
	effects: readonly TimelineEffect<ManagedAtom>[] | undefined,
): void {
	if (!effects) return
	const cleanupFunctions: (() => void)[] = []
	for (const effect of effects) {
		const cleanup = effect({
			onRecord: (callback) => {
				tl.onRecordCallbacks.add(callback as TimelineRecordCallback)
			},
			cullUndoSteps: (limit) => {
				validateCullLimit(limit)
				if (tl.pendingRecord) {
					tl.pendingUndoStepLimit = Math.min(
						tl.pendingUndoStepLimit ?? Number.POSITIVE_INFINITY,
						limit,
					)
					return
				}
				const cullEvent = cullTimelineUndoSteps(tl, limit)
				if (cullEvent) {
					tl.subject.next({
						type: `timeline_update`,
						event: cullEvent,
						at: tl.at,
						length: tl.history.length,
					})
				}
			},
			token,
			store: eldest(store),
		})
		if (cleanup) cleanupFunctions.push(cleanup)
	}
	tl.cleanup = () => {
		for (const cleanup of cleanupFunctions) cleanup()
	}
}

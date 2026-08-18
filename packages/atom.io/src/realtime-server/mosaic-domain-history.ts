import { createHash, randomUUID } from "node:crypto"

import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	MOSAIC_DOMAIN_HISTORY_CHECKPOINT_INDEX,
	MOSAIC_DOMAIN_HISTORY_CHECKPOINT_PATH,
	MOSAIC_DOMAIN_HISTORY_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainActorHistory,
	type MosaicDomainHistoryCheckpoint,
	type MosaicDomainHistoryCursor,
	type MosaicDomainHistoryGesture,
	type MosaicDomainHistoryGestureOperation,
	type MosaicDomainHistoryProtection,
	type MosaicDomainHistoryRequest,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainHistorySessionWatermark,
	type MosaicDomainHistorySnapshot,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	mosaicDomainMemberHistoryPolicy,
	mosaicDomainMemberModelIdentity,
	type MosaicReduceContext,
} from "atom.io/realtime"

import type { MosaicDomainBatchServer } from "./mosaic-domain-batch-server.ts"
import type {
	MosaicDomainCheckpointCoordinator,
	MosaicDomainCheckpointIndexUpdate,
} from "./mosaic-domain-checkpoint.ts"
import type { MosaicDomainCheckpointStorageAdapter } from "./mosaic-domain-checkpoint-storage.ts"
import { proposeMosaicDomainHistoryBatch } from "./mosaic-domain-history-capability.ts"

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicDomainHistoryLimits = {
	readonly maxActors: number
	readonly maxCheckpointRaceSnapshots: number
	readonly maxOperationIdsPerProtection: number
	readonly maxOperationsPerGesture: number
	readonly maxProtections: number
	readonly maxRecentRequests: number
	readonly maxRootKeysPerProtection: number
	readonly maxSessions: number
	readonly undoStepsPerActor: number
}

export const DEFAULT_MOSAIC_DOMAIN_HISTORY_LIMITS: MosaicDomainHistoryLimits =
	Object.freeze({
		maxActors: 1_024,
		maxCheckpointRaceSnapshots: 16,
		maxOperationIdsPerProtection: 10_000,
		maxOperationsPerGesture: 10_000,
		maxProtections: 4_096,
		maxRecentRequests: 256,
		maxRootKeysPerProtection: 256,
		maxSessions: 4_096,
		undoStepsPerActor: 100,
	})

export type MosaicDomainHistoryCheckpointIntegration<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	compactMember(context: {
		readonly address: MosaicDomainMemberAddress<Identity>
		readonly revision: number
		readonly value: Json.Serializable
	}): Promise<Json.Serializable>
	indexes(context: {
		readonly batches: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[]
		readonly fromRevision: number
		readonly revision: number
	}): Promise<readonly MosaicDomainCheckpointIndexUpdate[]>
}

export type MosaicDomainHistoryConnection = Disposable & {
	request(
		request: MosaicDomainHistoryRequest,
	): Promise<MosaicDomainHistoryRequestResult>
	snapshot(): Promise<MosaicDomainHistorySnapshot>
}

export type MosaicDomainHistoryCoordinatorOptions<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly batches: MosaicDomainBatchServer
	readonly checkpoint?: Pick<MosaicDomainCheckpointCoordinator, `readIndex`>
	readonly domain: MosaicDomainInstance<Identity, any, any>
	readonly limits?: Partial<MosaicDomainHistoryLimits>
	readonly minimumRecoveryRevision?: () => MaybePromise<number>
	readonly storage?: Pick<
		MosaicDomainCheckpointStorageAdapter,
		`deleteCheckpointRetentionLease` | `upsertCheckpointRetentionLease`
	>
}

export type MosaicDomainHistoryStats = {
	readonly actorCount: number
	readonly gestureCount: number
	readonly operationCount: number
	readonly protectionCount: number
	readonly recentRequestCount: number
	readonly sessionCount: number
}

export type MosaicDomainHistoryCoordinator<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = Disposable & {
	readonly checkpoint: MosaicDomainHistoryCheckpointIntegration<Identity>
	connect(identity: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainHistoryConnection
	flush(): Promise<void>
	protect(protection: MosaicDomainHistoryProtection): Promise<void>
	releaseProtection(id: string): Promise<void>
	readonly stats: MosaicDomainHistoryStats
}

type MutableActorHistory<Identity extends MosaicDomainIdentity> = {
	actor: string
	cursorRevision: number
	redo: MosaicDomainHistoryGesture<Identity>[]
	truncatedBeforeRevision: number
	undo: MosaicDomainHistoryGesture<Identity>[]
}

type HistoryState<Identity extends MosaicDomainIdentity> = {
	actors: Map<string, MutableActorHistory<Identity>>
	headBatchId: string | null
	revision: number
	retiredBeforeRevision: number
	sessions: Map<string, MosaicDomainHistorySessionWatermark>
}

type RequestReceipt = {
	readonly fingerprint: string
	readonly result: MosaicDomainHistoryRequestResult
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const positiveInteger = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) > 0

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

const sameCursor = (
	left: MosaicDomainHistoryCursor,
	right: MosaicDomainHistoryCursor,
): boolean =>
	left.revision === right.revision &&
	left.redoGestureId === right.redoGestureId &&
	left.undoGestureId === right.undoGestureId

function emptyState<
	Identity extends MosaicDomainIdentity,
>(): HistoryState<Identity> {
	return {
		actors: new Map(),
		headBatchId: null,
		retiredBeforeRevision: 0,
		revision: 0,
		sessions: new Map(),
	}
}

function actorHistory<Identity extends MosaicDomainIdentity>(
	state: HistoryState<Identity>,
	actor: string,
): MutableActorHistory<Identity> {
	let history = state.actors.get(actor)
	if (history === undefined) {
		history = {
			actor,
			cursorRevision: state.revision,
			redo: [],
			truncatedBeforeRevision: state.retiredBeforeRevision,
			undo: [],
		}
		state.actors.set(actor, history)
	}
	return history
}

function checkpointFromState<Identity extends MosaicDomainIdentity>(
	state: HistoryState<Identity>,
): MosaicDomainHistoryCheckpoint<Identity> {
	return {
		actors: [...state.actors.values()]
			.sort((left, right) => left.actor.localeCompare(right.actor))
			.map((history) => ({
				actor: history.actor,
				cursorRevision: history.cursorRevision,
				redo: clone(history.redo),
				truncatedBeforeRevision: history.truncatedBeforeRevision,
				undo: clone(history.undo),
			})),
		headBatchId: state.headBatchId,
		protocolVersion: MOSAIC_DOMAIN_HISTORY_PROTOCOL_VERSION,
		revision: state.revision,
		retiredBeforeRevision: state.retiredBeforeRevision,
		sessions: [...state.sessions.values()]
			.sort(
				(left, right) =>
					left.actor.localeCompare(right.actor) ||
					left.session.localeCompare(right.session),
			)
			.map(clone),
	}
}

function assertGesture(value: MosaicDomainHistoryGesture): void {
	if (
		!identifier(value?.actor) ||
		!identifier(value?.id) ||
		!positiveInteger(value?.firstRevision) ||
		!positiveInteger(value?.lastRevision) ||
		value.firstRevision > value.lastRevision ||
		!Array.isArray(value?.operations) ||
		value.operations.length === 0
	) {
		throw new Error(`A Mosaic Domain history gesture is invalid.`)
	}
	for (const operation of value.operations) {
		if (
			!identifier(operation?.id) ||
			!identifier(operation?.session) ||
			!positiveInteger(operation?.revision) ||
			operation.revision < value.firstRevision ||
			operation.revision > value.lastRevision ||
			typeof operation?.address !== `object` ||
			operation.address === null ||
			typeof operation?.model !== `object` ||
			operation.model === null
		) {
			throw new Error(`A Mosaic Domain history operation is invalid.`)
		}
	}
}

function stateFromCheckpoint<Identity extends MosaicDomainIdentity>(
	value: unknown,
	limits: MosaicDomainHistoryLimits,
): HistoryState<Identity> {
	if (
		typeof value !== `object` ||
		value === null ||
		(value as MosaicDomainHistoryCheckpoint).protocolVersion !==
			MOSAIC_DOMAIN_HISTORY_PROTOCOL_VERSION ||
		!Number.isSafeInteger((value as MosaicDomainHistoryCheckpoint).revision) ||
		(value as MosaicDomainHistoryCheckpoint).revision < 0 ||
		!Number.isSafeInteger(
			(value as MosaicDomainHistoryCheckpoint).retiredBeforeRevision,
		) ||
		(value as MosaicDomainHistoryCheckpoint).retiredBeforeRevision < 0 ||
		(value as MosaicDomainHistoryCheckpoint).retiredBeforeRevision >
			(value as MosaicDomainHistoryCheckpoint).revision ||
		!Array.isArray((value as MosaicDomainHistoryCheckpoint).actors) ||
		!Array.isArray((value as MosaicDomainHistoryCheckpoint).sessions)
	) {
		throw new Error(`A Mosaic Domain history checkpoint is invalid.`)
	}
	const checkpoint = value as MosaicDomainHistoryCheckpoint<Identity>
	if (
		checkpoint.actors.length > limits.maxActors ||
		checkpoint.sessions.length > limits.maxSessions ||
		(checkpoint.headBatchId !== null && !identifier(checkpoint.headBatchId))
	) {
		throw new Error(`A Mosaic Domain history checkpoint exceeds its bounds.`)
	}
	const state = emptyState<Identity>()
	state.headBatchId = checkpoint.headBatchId
	state.revision = checkpoint.revision
	state.retiredBeforeRevision = checkpoint.retiredBeforeRevision
	for (const actor of checkpoint.actors) {
		if (
			!identifier(actor?.actor) ||
			!Number.isSafeInteger(actor?.cursorRevision) ||
			actor.cursorRevision < 0 ||
			actor.cursorRevision > checkpoint.revision ||
			!Number.isSafeInteger(actor?.truncatedBeforeRevision) ||
			actor.truncatedBeforeRevision < 0 ||
			actor.truncatedBeforeRevision > checkpoint.revision ||
			!Array.isArray(actor?.undo) ||
			!Array.isArray(actor?.redo) ||
			actor.undo.length > limits.undoStepsPerActor ||
			actor.redo.length > limits.undoStepsPerActor ||
			state.actors.has(actor.actor)
		) {
			throw new Error(`A Mosaic Domain actor history is invalid.`)
		}
		for (const gesture of [...actor.undo, ...actor.redo]) {
			assertGesture(gesture)
			if (gesture.actor !== actor.actor) {
				throw new Error(`A Mosaic Domain history actor is inconsistent.`)
			}
			if (gesture.operations.length > limits.maxOperationsPerGesture) {
				throw new Error(`A Mosaic Domain history gesture exceeds its bounds.`)
			}
		}
		state.actors.set(actor.actor, {
			actor: actor.actor,
			cursorRevision: actor.cursorRevision,
			redo: clone(actor.redo),
			truncatedBeforeRevision: actor.truncatedBeforeRevision,
			undo: clone(actor.undo),
		})
		state.retiredBeforeRevision = Math.max(
			state.retiredBeforeRevision,
			actor.truncatedBeforeRevision,
		)
	}
	for (const session of checkpoint.sessions) {
		const key = canonicalize([session?.actor, session?.session])
		if (
			!identifier(session?.actor) ||
			!identifier(session?.session) ||
			!positiveInteger(session?.sequence) ||
			state.sessions.has(key)
		) {
			throw new Error(`A Mosaic Domain history session watermark is invalid.`)
		}
		state.sessions.set(key, clone(session))
	}
	return state
}

function snapshotFor<Identity extends MosaicDomainIdentity>(
	state: HistoryState<Identity>,
	actor: string,
): MosaicDomainHistorySnapshot {
	const history = state.actors.get(actor)
	const undo = history?.undo ?? []
	const redo = history?.redo ?? []
	const truncatedBeforeRevision =
		history?.truncatedBeforeRevision ?? state.retiredBeforeRevision
	const oldestRetainedRevision = [...undo, ...redo].reduce(
		(oldest, gesture) => Math.min(oldest, gesture.firstRevision),
		state.revision,
	)
	return {
		actor,
		cursor: {
			redoGestureId: redo.at(-1)?.id ?? null,
			revision: history?.cursorRevision ?? state.revision,
			undoGestureId: undo.at(-1)?.id ?? null,
		},
		horizon: {
			canRedo: redo.length > 0,
			canUndo: undo.length > 0,
			oldestRetainedRevision,
			redoSteps: redo.length,
			truncatedBeforeRevision,
			undoSteps: undo.length,
		},
	}
}

/** Coordinate bounded, actor-selective history over accepted Domain gestures. */
export function createMosaicDomainHistoryCoordinator<
	Identity extends MosaicDomainIdentity,
>(
	options: MosaicDomainHistoryCoordinatorOptions<Identity>,
): MosaicDomainHistoryCoordinator<Identity> {
	const limits = { ...DEFAULT_MOSAIC_DOMAIN_HISTORY_LIMITS, ...options.limits }
	for (const [name, value] of Object.entries(limits)) {
		if (!positiveInteger(value)) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}
	let state = emptyState<Identity>()
	let disposed = false
	let tail = Promise.resolve()
	const protections = new Map<string, MosaicDomainHistoryProtection>()
	const retentionLeaseId = `mosaic-domain-history:${randomUUID()}`
	const recentRequests = new Map<string, RequestReceipt>()
	const checkpointRaceSnapshots = new Map<
		number,
		MosaicDomainHistoryCheckpoint<Identity>
	>()
	const observer = options.batches.connect({
		actor: `atom.io:mosaic-domain-history`,
		session: `atom.io:mosaic-domain-history`,
	})

	const enqueue = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = tail.then(work, work)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	const rememberCheckpointRaceSnapshot = (): void => {
		checkpointRaceSnapshots.set(state.revision, checkpointFromState(state))
		while (checkpointRaceSnapshots.size > limits.maxCheckpointRaceSnapshots) {
			checkpointRaceSnapshots.delete(
				checkpointRaceSnapshots.keys().next().value!,
			)
		}
	}

	const trimActors = (): void => {
		while (state.actors.size > limits.maxActors) {
			const supportedActors = new Set(
				[...state.sessions.values()].map(({ actor }) => actor),
			)
			let oldestSupported: MutableActorHistory<Identity> | undefined
			let oldestUnsupported: MutableActorHistory<Identity> | undefined
			const isOlder = (
				candidate: MutableActorHistory<Identity>,
				current: MutableActorHistory<Identity> | undefined,
			): boolean =>
				current === undefined ||
				candidate.cursorRevision < current.cursorRevision ||
				(candidate.cursorRevision === current.cursorRevision &&
					candidate.actor < current.actor)
			for (const candidate of state.actors.values()) {
				if (supportedActors.has(candidate.actor)) {
					if (isOlder(candidate, oldestSupported)) oldestSupported = candidate
				} else if (isOlder(candidate, oldestUnsupported)) {
					oldestUnsupported = candidate
				}
			}
			// Preserve the hard memory bound even for a checkpoint imported with
			// watermarks whose actors have no retained stack. In ordinary operation,
			// the newly observed actor is unsupported and is the preferred victim.
			const oldest = oldestUnsupported ?? oldestSupported
			if (oldest === undefined) break
			state.retiredBeforeRevision = Math.max(
				state.retiredBeforeRevision,
				oldest.cursorRevision,
			)
			state.actors.delete(oldest.actor)
		}
	}

	const refreshRetention = async (): Promise<void> => {
		if (options.storage === undefined) return
		let minimumRevision = state.revision
		for (const history of state.actors.values()) {
			for (const gesture of [...history.undo, ...history.redo]) {
				minimumRevision = Math.min(minimumRevision, gesture.firstRevision - 1)
			}
		}
		for (const protection of protections.values()) {
			minimumRevision = Math.min(minimumRevision, protection.minimumRevision)
		}
		await options.storage.upsertCheckpointRetentionLease(
			options.domain.identity,
			{
				id: retentionLeaseId,
				kind: `history`,
				minimumRevision: Math.max(0, minimumRevision),
				rootKeys: [...protections.values()].flatMap(
					({ rootKeys }) => rootKeys ?? [],
				),
			},
		)
	}

	const classify = async (
		accepted: MosaicAcceptedDomainBatchEnvelope<Identity>,
	): Promise<{
		changes: MosaicDomainHistoryGestureOperation<Identity>[]
		compensations: {
			readonly mode: `redo` | `undo`
			readonly targets: readonly string[]
		}[]
	}> => {
		const changes: MosaicDomainHistoryGestureOperation<Identity>[] = []
		const compensations: {
			readonly mode: `redo` | `undo`
			readonly targets: readonly string[]
		}[] = []
		for (const operation of accepted.batch.operations) {
			const parsed = await options.domain.parseAddress(operation.address)
			const model = parsed.member.model
			if (model === undefined) continue
			const policy = mosaicDomainMemberHistoryPolicy(model)
			if (policy === undefined) continue
			const context: MosaicReduceContext = {
				actor: accepted.batch.actor,
				dependencies: accepted.batch.dependencies,
				group: accepted.batch.group,
				id: operation.id,
				revision: accepted.revision,
				session: accepted.batch.session,
			}
			const classification = policy.classify(operation.operation, context)
			if (classification.kind === `exclude`) continue
			if (classification.kind === `compensation`) {
				compensations.push({
					mode: classification.mode,
					targets: [...classification.targetOperationIds],
				})
				continue
			}
			changes.push({
				address: clone(operation.address),
				id: operation.id,
				model: clone(operation.model),
				operation: clone(operation.operation),
				revision: accepted.revision,
				session: accepted.batch.session,
			})
		}
		return { changes, compensations }
	}

	const applyAccepted = async (
		accepted: MosaicAcceptedDomainBatchEnvelope<Identity>,
	): Promise<void> => {
		if (accepted.revision <= state.revision) return
		if (accepted.revision !== state.revision + 1) {
			throw new Error(
				`Mosaic Domain history revision gap: expected ${state.revision + 1}, received ${accepted.revision}.`,
			)
		}
		const { changes, compensations } = await classify(accepted)
		if (changes.length > 0 && compensations.length > 0) {
			throw new Error(
				`A Domain batch cannot mix history changes and compensation.`,
			)
		}
		if (changes.length > limits.maxOperationsPerGesture) {
			throw new Error(`A Mosaic Domain history gesture exceeds its bounds.`)
		}
		if (compensations.length > 0) {
			const mode = compensations[0].mode
			if (compensations.some((item) => item.mode !== mode)) {
				throw new Error(`A Domain compensation batch must use one mode.`)
			}
			const history = actorHistory(state, accepted.batch.actor)
			const from = mode === `undo` ? history.undo : history.redo
			const to = mode === `undo` ? history.redo : history.undo
			const target = from.at(-1)
			const expected = new Set(target?.operations.map(({ id }) => id) ?? [])
			const actual = new Set(compensations.flatMap(({ targets }) => targets))
			if (
				target === undefined ||
				expected.size !== actual.size ||
				[...expected].some((id) => !actual.has(id))
			) {
				throw new Error(`A Domain compensation targeted a stale history cursor.`)
			}
			from.pop()
			to.push(target)
			history.cursorRevision = accepted.revision
		} else if (changes.length > 0) {
			const history = actorHistory(state, accepted.batch.actor)
			const gestureId = accepted.batch.group ?? accepted.batch.id
			const previous = history.undo.at(-1)
			if (previous?.id === gestureId) {
				const operations = [...previous.operations, ...changes]
				if (operations.length > limits.maxOperationsPerGesture) {
					throw new Error(`A Mosaic Domain history gesture exceeds its bounds.`)
				}
				history.undo[history.undo.length - 1] = {
					...previous,
					lastRevision: accepted.revision,
					operations,
				}
			} else {
				history.undo.push({
					actor: accepted.batch.actor,
					firstRevision: accepted.revision,
					id: gestureId,
					lastRevision: accepted.revision,
					operations: changes,
				})
			}
			history.redo.splice(0)
			history.cursorRevision = accepted.revision
			while (history.undo.length > limits.undoStepsPerActor) {
				const removed = history.undo.shift()!
				history.truncatedBeforeRevision = Math.max(
					history.truncatedBeforeRevision,
					removed.lastRevision,
				)
			}
		}
		state.headBatchId = accepted.batch.id
		state.revision = accepted.revision
		trimActors()
		rememberCheckpointRaceSnapshot()
		await refreshRetention()
	}

	const synchronize = async (): Promise<void> => {
		const recovery = await observer.recover(state.revision)
		for (const accepted of recovery.tail) {
			await applyAccepted(
				accepted as MosaicAcceptedDomainBatchEnvelope<Identity>,
			)
		}
		if (state.revision !== recovery.headRevision) {
			throw new Error(
				`Mosaic Domain history recovery returned an incomplete tail.`,
			)
		}
	}

	const initialize = async (): Promise<void> => {
		const stored = await options.checkpoint?.readIndex(
			MOSAIC_DOMAIN_HISTORY_CHECKPOINT_INDEX,
			MOSAIC_DOMAIN_HISTORY_CHECKPOINT_PATH,
		)
		if (stored !== null && stored !== undefined) {
			state = stateFromCheckpoint<Identity>(stored.value, limits)
			if (state.revision !== stored.revision) {
				throw new Error(
					`A Mosaic Domain history checkpoint revision is invalid.`,
				)
			}
		}
		rememberCheckpointRaceSnapshot()
		await synchronize()
		await refreshRetention()
	}

	const ready = initialize()
	const unsubscribe = observer.subscribe((accepted) => {
		void enqueue(() =>
			applyAccepted(accepted as MosaicAcceptedDomainBatchEnvelope<Identity>),
		)
	})

	const retainedOperationIds = (
		address: MosaicDomainMemberAddress<Identity>,
		revision: number,
	): Set<string> => {
		const snapshot = checkpointRaceSnapshots.get(revision)
		if (snapshot === undefined) {
			throw new Error(
				`Mosaic Domain history cannot compact an expired race cut at revision ${revision}.`,
			)
		}
		const addressKey = mosaicDomainMemberAddressKey(address)
		const retained = new Set<string>()
		for (const history of snapshot.actors) {
			for (const gesture of [...history.undo, ...history.redo]) {
				for (const operation of gesture.operations) {
					if (mosaicDomainMemberAddressKey(operation.address) === addressKey) {
						retained.add(operation.id)
					}
				}
			}
		}
		for (const protection of protections.values()) {
			for (const id of protection.operationIds ?? []) retained.add(id)
		}
		return retained
	}

	const checkpointIntegration: MosaicDomainHistoryCheckpointIntegration<Identity> =
		{
			async compactMember({ address, revision, value }) {
				await ready
				await tail
				const parsed = await options.domain.parseAddress(address)
				const model = parsed.member.model
				if (model === undefined) return clone(value)
				const policy = mosaicDomainMemberHistoryPolicy(model)
				if (policy?.compact === undefined) return clone(value)
				const retained = retainedOperationIds(address, revision)
				for (const id of policy.references?.(value) ?? []) retained.add(id)
				const compacted = policy.compact(clone(value), {
					retainedOperationIds: retained,
					throughRevision: revision,
				})
				return options.domain.validateValue(
					parsed.address.member,
					clone(compacted),
				) as Promise<Json.Serializable>
			},
			async indexes({ revision }) {
				await ready
				await tail
				const snapshot = checkpointRaceSnapshots.get(revision)
				if (snapshot === undefined) {
					throw new Error(
						`Mosaic Domain history cannot checkpoint an expired race cut at revision ${revision}.`,
					)
				}
				return [
					{
						index: MOSAIC_DOMAIN_HISTORY_CHECKPOINT_INDEX,
						path: MOSAIC_DOMAIN_HISTORY_CHECKPOINT_PATH,
						value: clone(snapshot),
					},
				]
			},
		}

	const request = async (
		actor: string,
		session: string,
		received: MosaicDomainHistoryRequest,
	): Promise<MosaicDomainHistoryRequestResult> => {
		await ready
		return enqueue(async () => {
			if (disposed) throw new Error(`This Mosaic Domain history is disposed.`)
			await synchronize()
			if (
				!identifier(received?.id) ||
				received?.session !== session ||
				!positiveInteger(received?.sequence) ||
				(received?.mode !== `undo` && received?.mode !== `redo`) ||
				typeof received?.cursor !== `object` ||
				received.cursor === null
			) {
				return {
					reason: `A Mosaic Domain history request is invalid.`,
					recovery: `history-resnapshot`,
					snapshot: snapshotFor(state, actor),
					status: `rejected`,
				}
			}
			const sessionKey = canonicalize([actor, session])
			const receiptKey = canonicalize([actor, session, received.sequence])
			const fingerprint = canonicalize(received)
			const prior = recentRequests.get(receiptKey)
			if (prior !== undefined) {
				return prior.fingerprint === fingerprint
					? clone(prior.result)
					: {
							reason: `A Mosaic Domain history sequence was reused with different content.`,
							recovery: `domain-resnapshot`,
							snapshot: snapshotFor(state, actor),
							status: `rejected`,
						}
			}
			if (
				!state.sessions.has(sessionKey) &&
				state.sessions.size >= limits.maxSessions
			) {
				return {
					reason: `The Mosaic Domain history session capacity is full.`,
					recovery: `retry`,
					snapshot: snapshotFor(state, actor),
					status: `rejected`,
				}
			}
			const watermark = state.sessions.get(sessionKey)?.sequence ?? 0
			if (received.sequence <= watermark) {
				return {
					reason: `The Mosaic Domain history request is older than the retained receipt window.`,
					recovery: `history-resnapshot`,
					snapshot: snapshotFor(state, actor),
					status: `rejected`,
				}
			}
			if (received.sequence !== watermark + 1) {
				return {
					reason: `The Mosaic Domain history request sequence has a gap.`,
					recovery: `retry`,
					snapshot: snapshotFor(state, actor),
					status: `rejected`,
				}
			}
			const current = snapshotFor(state, actor)
			if (!sameCursor(received.cursor, current.cursor)) {
				const minimumRecoveryRevision =
					(await options.minimumRecoveryRevision?.()) ?? 0
				const retiredActorHistory =
					state.retiredBeforeRevision > 0 &&
					received.cursor.revision <= state.retiredBeforeRevision
				return {
					reason: `The actor history cursor is stale.`,
					recovery:
						retiredActorHistory ||
						received.cursor.revision < minimumRecoveryRevision
							? `domain-resnapshot`
							: `history-resnapshot`,
					snapshot: current,
					status: `rejected`,
				}
			}
			const history = state.actors.get(actor)
			const source = received.mode === `undo` ? history?.undo : history?.redo
			const gesture = source?.at(-1)
			if (gesture === undefined) {
				return { snapshot: current, status: `unavailable` }
			}

			const byAddress = new Map<
				string,
				MosaicDomainHistoryGestureOperation<Identity>[]
			>()
			for (const operation of gesture.operations) {
				const key = mosaicDomainMemberAddressKey(operation.address)
				const group = byAddress.get(key) ?? []
				group.push(operation)
				byAddress.set(key, group)
			}
			const historyBatchId = `history:${createHash(`sha256`)
				.update(canonicalize([actor, session, received.id, received.sequence]))
				.digest(`hex`)}`
			const operations = []
			let ordinal = 0
			for (const targets of byAddress.values()) {
				const parsed = await options.domain.parseAddress(targets[0].address)
				const model = parsed.member.model
				const policy =
					model === undefined
						? undefined
						: mosaicDomainMemberHistoryPolicy(model)
				if (model === undefined || policy === undefined) {
					throw new Error(`A retained Domain member has no history policy.`)
				}
				operations.push({
					address: clone(targets[0].address),
					id: `${historyBatchId}:${ordinal++}`,
					model: mosaicDomainMemberModelIdentity(model),
					operation: policy.compensate({
						actor,
						gestureId: gesture.id,
						mode: received.mode,
						requestId: received.id,
						targets: clone(targets),
					}),
				})
			}
			const historySession = `history:${createHash(`sha256`)
				.update(canonicalize([actor, session]))
				.digest(`hex`)}`
			const accepted = await proposeMosaicDomainHistoryBatch(
				options.batches,
				{ actor, session: historySession },
				{
					affectedMembers: operations.map(({ address }) => address),
					dependencies: state.headBatchId === null ? [] : [state.headBatchId],
					domain: options.domain.identity,
					group: historyBatchId,
					id: historyBatchId,
					operations,
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: received.sequence,
					session: historySession,
				},
				async (batch, revision) => {
					const expected = new Set(gesture.operations.map(({ id }) => id))
					const actual = new Set<string>()
					for (const operation of batch.operations) {
						const parsed = await options.domain.parseAddress(operation.address)
						const model = parsed.member.model
						const policy =
							model === undefined
								? undefined
								: mosaicDomainMemberHistoryPolicy(model)
						const classification = policy?.classify(operation.operation, {
							actor,
							dependencies: batch.dependencies,
							group: batch.group,
							id: operation.id,
							revision,
							session: historySession,
						})
						if (
							classification?.kind !== `compensation` ||
							classification.mode !== received.mode
						) {
							throw new Error(
								`A Domain model generated a non-conforming history compensation.`,
							)
						}
						for (const id of classification.targetOperationIds) actual.add(id)
					}
					if (
						expected.size !== actual.size ||
						[...expected].some((id) => !actual.has(id))
					) {
						throw new Error(
							`A Domain model generated a stale history compensation.`,
						)
					}
				},
			)
			if (accepted.status === `rejected`) {
				return {
					reason: accepted.rejection.reason,
					recovery:
						accepted.rejection.recovery === `retry`
							? `retry`
							: `domain-resnapshot`,
					snapshot: snapshotFor(state, actor),
					status: `rejected`,
				}
			}
			await applyAccepted(
				accepted.accepted as MosaicAcceptedDomainBatchEnvelope<Identity>,
			)
			const result: MosaicDomainHistoryRequestResult = {
				acceptedRevision: accepted.accepted.revision,
				snapshot: snapshotFor(state, actor),
				status: `accepted`,
			}
			state.sessions.set(sessionKey, {
				actor,
				sequence: received.sequence,
				session,
			})
			rememberCheckpointRaceSnapshot()
			recentRequests.set(receiptKey, { fingerprint, result: clone(result) })
			while (recentRequests.size > limits.maxRecentRequests) {
				recentRequests.delete(recentRequests.keys().next().value!)
			}
			return result
		})
	}

	return {
		checkpoint: checkpointIntegration,
		connect({ actor, session }) {
			if (!identifier(actor) || !identifier(session)) {
				throw new Error(`Domain history requires actor and session IDs.`)
			}
			let closed = false
			return {
				request(received) {
					if (closed) {
						return Promise.reject(
							new Error(`This Domain history connection is closed.`),
						)
					}
					return request(actor, session, clone(received))
				},
				async snapshot() {
					if (closed)
						throw new Error(`This Domain history connection is closed.`)
					await ready
					await tail
					return snapshotFor(state, actor)
				},
				[Symbol.dispose]() {
					closed = true
				},
			}
		},
		async flush() {
			await ready
			await tail
		},
		async protect(protection) {
			await ready
			return enqueue(async () => {
				if (
					!identifier(protection?.id) ||
					!Number.isSafeInteger(protection?.minimumRevision) ||
					protection.minimumRevision < 0 ||
					protection.minimumRevision > state.revision ||
					![
						`annotation`,
						`history`,
						`outbox`,
						`presence`,
						`proposal`,
						`session`,
					].includes(protection.kind) ||
					!Array.isArray(protection.operationIds ?? []) ||
					(protection.operationIds?.length ?? 0) >
						limits.maxOperationIdsPerProtection ||
					protection.operationIds?.some((id) => !identifier(id)) === true ||
					!Array.isArray(protection.rootKeys ?? []) ||
					(protection.rootKeys?.length ?? 0) > limits.maxRootKeysPerProtection ||
					protection.rootKeys?.some(
						(key) => !/^sha256:[0-9a-f]{64}$/.test(key),
					) === true ||
					(!protections.has(protection.id) &&
						protections.size >= limits.maxProtections)
				) {
					throw new Error(`A Mosaic Domain history protection is invalid.`)
				}
				const previous = protections.get(protection.id)
				protections.set(protection.id, clone(protection))
				try {
					await refreshRetention()
				} catch (error) {
					if (previous === undefined) protections.delete(protection.id)
					else protections.set(protection.id, previous)
					throw error
				}
			})
		},
		async releaseProtection(id) {
			await ready
			return enqueue(async () => {
				const previous = protections.get(id)
				protections.delete(id)
				try {
					await refreshRetention()
				} catch (error) {
					if (previous !== undefined) protections.set(id, previous)
					throw error
				}
			})
		},
		get stats() {
			let gestureCount = 0
			let operationCount = 0
			for (const history of state.actors.values()) {
				const gestures = [...history.undo, ...history.redo]
				gestureCount += gestures.length
				operationCount += gestures.reduce(
					(count, gesture) => count + gesture.operations.length,
					0,
				)
			}
			return {
				actorCount: state.actors.size,
				gestureCount,
				operationCount,
				protectionCount: protections.size,
				recentRequestCount: recentRequests.size,
				sessionCount: state.sessions.size,
			}
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			unsubscribe()
			const storage = options.storage
			if (storage !== undefined) {
				const release = () =>
					storage.deleteCheckpointRetentionLease(
						options.domain.identity,
						retentionLeaseId,
					)
				void ready.then(release, release).catch(() => undefined)
			}
		},
	}
}

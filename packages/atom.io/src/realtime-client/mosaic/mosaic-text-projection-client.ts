import type {
	ReadableToken,
	ReadonlyPureSelectorToken,
	RegularAtomToken,
} from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	createReadonlyPureSelectorFamily,
	createRegularAtomFamily,
	disposeFromStore,
	findInStore,
	getFromStore,
	setIntoStore,
	subscribeToState,
} from "atom.io/internal"
import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
	MosaicDomainResidencySelection,
	MosaicTextIndexFragment,
	MosaicTextIndexLeaf,
	MosaicTextIndexLookup,
	MosaicTextIndexRange,
	MosaicTextIndexRoot,
	MosaicTextRelativePosition,
} from "atom.io/realtime"
import { mosaicDomainMemberAddressKey, splitMosaicText } from "atom.io/realtime"

import type {
	MosaicDomainResidencyClient,
	MosaicDomainResidencyClientOperation,
	MosaicDomainResidencySubscription,
} from "../mosaic-domain-residency-client.ts"

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicTextLogicalEdit =
	| {
			readonly anchor: MosaicTextRelativePosition
			readonly gestureId?: string
			readonly head: MosaicTextRelativePosition
			readonly text: string
			readonly type: `replace`
	  }
	| { readonly gestureId?: string; readonly type: `redo` | `undo` }

export type MosaicTextProjectedSegment = {
	readonly end: number
	readonly fragments: readonly MosaicTextIndexFragment[]
	readonly id: string
	readonly start: number
	readonly text: string
}

export type MosaicTextProjectedBlock = {
	/** A run-relative identity that survives physical leaf split and merge. */
	readonly anchor: MosaicTextRelativePosition
	readonly end: number
	readonly key: string
	readonly start: number
	readonly text: string
}

export type MosaicTextRangeProjection = {
	readonly blocks: readonly MosaicTextProjectedBlock[]
	readonly range: MosaicTextIndexRange
	/** Full resident leaves; renderers may virtualize these directly. */
	readonly segments: readonly MosaicTextProjectedSegment[]
	/** Only the requested bounded range, never the complete document by default. */
	readonly text: string
}

export type MosaicTextProjectionEditPlan<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
> = {
	readonly operations:
		| MosaicDomainResidencyClientOperation<Identity>
		| readonly MosaicDomainResidencyClientOperation<Identity>[]
	/** Members needed to prepare and settle this model-specific edit. */
	readonly selection?: MosaicDomainResidencySelection<Identity, Range>
}

export type MosaicTextProjectionEditContext = {
	readonly actor: string
	readonly gestureId: string
	readonly range: MosaicTextIndexRange | null
	readonly session: string
}

export type MosaicTextRangeAcquisitionOptions = {
	readonly overscan?: number
}

export type MosaicTextProjectionClientOptions<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
> = {
	readonly actor: string
	readonly domainKey?: string
	readonly evictReleased?: boolean
	readonly idSource?: (sequence: number) => string
	readonly materialize: () => Promise<string>
	readonly maximumActiveRanges?: number
	readonly maximumRangeUtf16Units?: number
	readonly planEdit: (
		edit: MosaicTextLogicalEdit,
		context: MosaicTextProjectionEditContext,
	) => MaybePromise<MosaicTextProjectionEditPlan<Identity, Range>>
	readonly positionAtOffset: (offset: number) => Promise<MosaicTextIndexLookup>
	readonly rangeMember: string
	readonly rangeMemberLimit?: number
	/** Delegate undo/redo to the authoritative MOS-16 history transport. */
	readonly requestHistory?: (
		mode: `redo` | `undo`,
		context: MosaicTextProjectionEditContext & { readonly range: null },
	) => MaybePromise<void>
	readonly residency: MosaicDomainResidencyClient<Identity, Range>
	readonly resolvePosition: (
		position: MosaicTextRelativePosition,
	) => Promise<number>
	readonly rootAddress: MosaicDomainMemberAddress<Identity>
	readonly session: string
}

export type MosaicTextRangeLease = Disposable & {
	readonly active: boolean
	readonly range: MosaicTextIndexRange
	readonly selector: ReadonlyPureSelectorToken<MosaicTextRangeProjection>
	read(): MosaicTextRangeProjection
	release(): Promise<void>
}

export type MosaicTextRangeObserver = Disposable & {
	readonly active: boolean
	readonly range: MosaicTextIndexRange
	release(): Promise<void>
}

export type MosaicTextProjectionClientState = {
	readonly activeRangeCount: number
	readonly observerCount: number
	readonly residentRangeCount: number
}

export type MosaicTextProjectionClient<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
> = Disposable & {
	acquireRange(
		range: MosaicTextIndexRange,
		options?: MosaicTextRangeAcquisitionOptions,
	): Promise<MosaicTextRangeLease>
	dispose(): Promise<void>
	edit(edit: MosaicTextLogicalEdit): Promise<void>
	lengthSelector(): Promise<ReadonlyPureSelectorToken<number>>
	materialize(): Promise<string>
	observeRange(
		range: MosaicTextIndexRange,
		listener: (projection: MosaicTextRangeProjection) => void,
		options?: MosaicTextRangeAcquisitionOptions,
	): Promise<MosaicTextRangeObserver>
	positionAtOffset(offset: number): Promise<MosaicTextRelativePosition>
	readLength(): Promise<number>
	readRange(
		range: MosaicTextIndexRange,
		options?: MosaicTextRangeAcquisitionOptions,
	): Promise<MosaicTextRangeProjection>
	resolvePosition(position: MosaicTextRelativePosition): Promise<number>
	readonly residency: MosaicDomainResidencyClient<Identity, Range>
	readonly state: MosaicTextProjectionClientState
	subscribeState(
		listener: (state: MosaicTextProjectionClientState) => void,
	): () => void
}

type RangeRecord<Identity extends MosaicDomainIdentity> = {
	activation: Promise<void>
	addresses: readonly MosaicDomainMemberAddress<Identity>[]
	membership: RegularAtomToken<number>
	observers: Set<(projection: MosaicTextRangeProjection) => void>
	projection: MosaicTextRangeProjection | null
	released: boolean
	readonly range: MosaicTextIndexRange
	refresh: Promise<void>
	references: number
	selector: ReadonlyPureSelectorToken<MosaicTextRangeProjection>
	stopSelector: (() => void) | null
	subscription: MosaicDomainResidencySubscription<Identity> | null
	tokens: ReadableToken<any, any, any>[]
}

const MAXIMUM_BOUND = 1_000_000

const identifier = (value: string, name: string): string => {
	if (value.length === 0 || value.length > 512) {
		throw new Error(`${name} must be a non-empty bounded string.`)
	}
	return value
}

const positiveBound = (value: number, name: string): number => {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_BOUND) {
		throw new RangeError(`${name} must be a positive bounded safe integer.`)
	}
	return value
}

const validateRange = (range: MosaicTextIndexRange): MosaicTextIndexRange => {
	if (
		range.kind !== `utf16-range` ||
		!Number.isSafeInteger(range.start) ||
		!Number.isSafeInteger(range.end) ||
		range.start < 0 ||
		range.end < range.start
	) {
		throw new RangeError(`Invalid Mosaic text projection range.`)
	}
	return { end: range.end, kind: `utf16-range`, start: range.start }
}

const leafText = (leaf: MosaicTextIndexLeaf): string =>
	leaf.fragments.map(({ text }) => text).join(``)

const positionKey = (position: MosaicTextRelativePosition): string =>
	JSON.stringify([position.runId, position.offset, position.affinity])

function localOffsetForPosition(
	leaf: MosaicTextIndexLeaf,
	position: MosaicTextRelativePosition,
): number | null {
	return localOffsetForFragments(leaf.fragments, position)
}

function localOffsetForFragments(
	fragments: readonly MosaicTextIndexFragment[],
	position: MosaicTextRelativePosition,
): number | null {
	if (position.runId === null) return null
	let utf16 = 0
	for (const fragment of fragments) {
		if (fragment.runId === position.runId) {
			const graphemes = splitMosaicText(fragment.text)
			const local = position.offset - fragment.start
			if (local < 0) return null
			if (local === 0 && position.affinity === `right`) return utf16
			if (local === graphemes.length && position.affinity === `left`) {
				return utf16 + fragment.text.length
			}
			if (local > 0 && local < graphemes.length) {
				let localUtf16 = 0
				for (let index = 0; index < local; index++) {
					localUtf16 += graphemes[index].length
				}
				return utf16 + localUtf16
			}
			// A right-affinity end may follow intervening inserted runs, and a
			// left-affinity start may precede them. Keep scanning for the matching
			// side of the logical boundary; fall back remotely if it is not resident.
		}
		utf16 += fragment.text.length
	}
	return null
}

function positionAtLocalOffset(
	leaves: readonly MosaicTextIndexLeaf[],
	offset: number,
): MosaicTextRelativePosition {
	return positionAtFragments(
		leaves.flatMap(({ fragments }) => fragments),
		offset,
	)
}

function positionAtFragments(
	fragments: readonly MosaicTextIndexFragment[],
	offset: number,
): MosaicTextRelativePosition {
	let remaining = offset
	for (const fragment of fragments) {
		const graphemes = splitMosaicText(fragment.text)
		let utf16 = 0
		for (let index = 0; index < graphemes.length; index++) {
			const next = utf16 + graphemes[index].length
			if (remaining < next) {
				return {
					affinity: `right`,
					offset: fragment.start + index,
					runId: fragment.runId,
				}
			}
			if (remaining === next) {
				return {
					affinity: `left`,
					offset: fragment.start + index + 1,
					runId: fragment.runId,
				}
			}
			utf16 = next
		}
		remaining -= utf16
	}
	const last = fragments.at(-1)
	if (last === undefined) return { affinity: `left`, offset: 0, runId: null }
	return {
		affinity: `left`,
		offset: last.start + splitMosaicText(last.text).length,
		runId: last.runId,
	}
}

function assertLeaf(value: unknown): MosaicTextIndexLeaf {
	if (
		typeof value !== `object` ||
		value === null ||
		(value as MosaicTextIndexLeaf).kind !== `leaf` ||
		(value as MosaicTextIndexLeaf).version !== 1 ||
		!Array.isArray((value as MosaicTextIndexLeaf).fragments)
	) {
		throw new Error(`A resident Mosaic text projection member is not a leaf.`)
	}
	return value as MosaicTextIndexLeaf
}

function assertRoot(value: unknown): MosaicTextIndexRoot {
	if (
		typeof value !== `object` ||
		value === null ||
		(value as MosaicTextIndexRoot).kind !== `root` ||
		(value as MosaicTextIndexRoot).version !== 1
	) {
		throw new Error(`The resident Mosaic text projection root is invalid.`)
	}
	return value as MosaicTextIndexRoot
}

function projectRange(
	range: MosaicTextIndexRange,
	leaves: readonly MosaicTextIndexLeaf[],
	residentStart: number,
): MosaicTextRangeProjection {
	let cursor = residentStart
	const segments = leaves.map((leaf): MosaicTextProjectedSegment => {
		const text = leafText(leaf)
		const segment = Object.freeze({
			end: cursor + text.length,
			fragments: structuredClone(leaf.fragments),
			id: leaf.id,
			start: cursor,
			text,
		})
		cursor = segment.end
		return segment
	})
	const residentText = segments.map(({ text }) => text).join(``)
	const relativeStart = Math.max(0, range.start - residentStart)
	const relativeEnd = Math.max(relativeStart, range.end - residentStart)
	const text = residentText.slice(relativeStart, relativeEnd)
	const blocks: MosaicTextProjectedBlock[] = []
	let blockStart = 0
	for (let index = 0; index <= text.length; index++) {
		if (index < text.length && text[index] !== `\n`) continue
		const start = range.start + blockStart
		const end = range.start + index
		const anchor = positionAtLocalOffset(leaves, relativeStart + blockStart)
		blocks.push(
			Object.freeze({
				anchor,
				end,
				key: positionKey(anchor),
				start,
				text: text.slice(blockStart, index),
			}),
		)
		blockStart = index + 1
	}
	return Object.freeze({
		blocks: Object.freeze(blocks),
		range: Object.freeze(structuredClone(range)),
		segments: Object.freeze(segments),
		text,
	})
}

/**
 * Store-owned, renderer-neutral lifecycle for bounded Mosaic text projections.
 * Text indexing stays model-specific; the generic Domain only sees addresses.
 */
export function createMosaicTextProjectionClient<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable = MosaicTextIndexRange,
>(
	options: MosaicTextProjectionClientOptions<Identity, Range>,
): MosaicTextProjectionClient<Identity, Range> {
	identifier(options.actor, `actor`)
	identifier(options.session, `session`)
	identifier(options.rangeMember, `rangeMember`)
	const maximumActiveRanges = positiveBound(
		options.maximumActiveRanges ?? 64,
		`maximumActiveRanges`,
	)
	const maximumRangeUtf16Units = positiveBound(
		options.maximumRangeUtf16Units ?? 1_000_000,
		`maximumRangeUtf16Units`,
	)
	const rangeMemberLimit = positiveBound(
		options.rangeMemberLimit ?? 128,
		`rangeMemberLimit`,
	)
	const domainKey = options.domainKey ?? `text`
	identifier(domainKey, `domainKey`)
	const resourceKey = `atom.io/realtime/mosaic-text-projection:${JSON.stringify([
		mosaicDomainMemberAddressKey(options.rootAddress),
		options.rangeMember,
		options.actor,
		options.session,
		domainKey,
	])}`
	const ownerStore = options.residency.store
	const previous = ownerStore.miscResources.get(resourceKey)
	if (previous !== undefined) {
		return previous as MosaicTextProjectionClient<Identity, Range>
	}
	let rootLease: Awaited<ReturnType<typeof options.residency.acquire>> | null =
		null
	let rootActivation: Promise<void> | null = null
	let rootToken: ReadableToken<any, any, any> | null = null
	let lengthToken: ReadonlyPureSelectorToken<number> | null = null
	let disposed = false
	let editSequence = 0
	const records = new Map<string, RangeRecord<Identity>>()
	const closures = new Map<string, Promise<void>>()
	const stateListeners = new Set<
		(state: MosaicTextProjectionClientState) => void
	>()
	const membershipFamily = createRegularAtomFamily<number, string, never>(
		ownerStore,
		{ default: 0, key: `${resourceKey}:membership` },
	)
	const rangeFamily = createReadonlyPureSelectorFamily<
		MosaicTextRangeProjection,
		string,
		never
	>(ownerStore, {
		get:
			(key) =>
			({ get }) => {
				const record = records.get(key)
				if (record === undefined) {
					throw new Error(`Mosaic text projection range is not acquired.`)
				}
				get(record.membership)
				const leaves = record.tokens.map((token) => assertLeaf(get(token)))
				if (leaves.length === 0) {
					return projectRange(record.range, [], record.range.start)
				}
				const first = leaves[0]
				const lookup = recordLookup.get(record)
				if (lookup === undefined) {
					throw new Error(`Mosaic text projection position is not ready.`)
				}
				const local = localOffsetForPosition(first, lookup.position)
				if (local === null) {
					throw new Error(`Mosaic text projection position is not resident.`)
				}
				return projectRange(record.range, leaves, lookup.globalUtf16 - local)
			},
		key: `${resourceKey}:range`,
	})
	const lengthFamily = createReadonlyPureSelectorFamily<number, string, never>(
		ownerStore,
		{
			get:
				() =>
				({ get }) =>
					assertRoot(get(rootToken!)).reference?.summary.utf16Units ?? 0,
			key: `${resourceKey}:length`,
		},
	)

	const stateSnapshot = (): MosaicTextProjectionClientState =>
		Object.freeze({
			activeRangeCount: [...records.values()].reduce(
				(sum, record) => sum + record.references,
				0,
			),
			observerCount: [...records.values()].reduce(
				(sum, record) => sum + record.observers.size,
				0,
			),
			residentRangeCount: records.size,
		})
	const notifyState = (): void => {
		const state = stateSnapshot()
		for (const listener of stateListeners) {
			try {
				listener(state)
			} catch (error) {
				options.residency.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-text-projection`,
					`A Mosaic text projection state observer threw.`,
					error,
				)
			}
		}
	}

	const ensureRoot = async (): Promise<void> => {
		if (disposed)
			throw new Error(`This Mosaic text projection client is disposed.`)
		if (rootLease !== null) return
		rootActivation ??= options.residency
			.acquire(options.rootAddress)
			.then((lease) => {
				if (disposed) {
					lease.release()
					throw new Error(`This Mosaic text projection client is disposed.`)
				}
				rootLease = lease
				rootToken = lease.token
			})
			.catch((error) => {
				rootActivation = null
				throw error
			})
		await rootActivation
	}

	const requireStore = (): typeof ownerStore => ownerStore

	const readRoot = async (): Promise<MosaicTextIndexRoot> => {
		await ensureRoot()
		if (disposed)
			throw new Error(`This Mosaic text projection client is disposed.`)
		return assertRoot(getFromStore(requireStore(), rootToken!))
	}

	const getLengthSelector = async (): Promise<
		ReadonlyPureSelectorToken<number>
	> => {
		await ensureRoot()
		if (disposed)
			throw new Error(`This Mosaic text projection client is disposed.`)
		if (lengthToken !== null) return lengthToken
		getFromStore(requireStore(), lengthFamily, `length`)
		lengthToken = findInStore(requireStore(), lengthFamily, `length`)
		return lengthToken
	}

	const canonicalRange = async (
		range: MosaicTextIndexRange,
		acquisition: MosaicTextRangeAcquisitionOptions = {},
	): Promise<MosaicTextIndexRange> => {
		const received = validateRange(structuredClone(range))
		const overscan = acquisition.overscan ?? 0
		if (!Number.isSafeInteger(overscan) || overscan < 0) {
			throw new RangeError(
				`Mosaic text overscan must be a non-negative integer.`,
			)
		}
		const length = (await readRoot()).reference?.summary.utf16Units ?? 0
		if (received.start > length || received.end > length) {
			throw new RangeError(
				`Mosaic text projection range is outside the document.`,
			)
		}
		const normalized = {
			end: Math.min(length, received.end + overscan),
			kind: `utf16-range` as const,
			start: Math.max(0, received.start - overscan),
		}
		if (normalized.end - normalized.start > maximumRangeUtf16Units) {
			throw new RangeError(
				`Mosaic text projection range exceeds ${maximumRangeUtf16Units} UTF-16 units.`,
			)
		}
		return normalized
	}

	const recordKey = (range: MosaicTextIndexRange): string =>
		JSON.stringify([range.start, range.end])

	const refreshRecord = async (
		record: RangeRecord<Identity>,
		force = false,
	): Promise<void> => {
		const subscription = record.subscription
		if (
			record.released ||
			disposed ||
			subscription === null ||
			!subscription.active
		) {
			return
		}
		const addresses = subscription.addresses
		const keys = addresses.map(mosaicDomainMemberAddressKey)
		const previousAddresses = record.addresses
		const previousKeys = previousAddresses.map(mosaicDomainMemberAddressKey)
		if (
			!force &&
			keys.length === previousKeys.length &&
			keys.every((key, index) => key === previousKeys[index])
		) {
			return
		}
		const tokens: ReadableToken<any, any, any>[] = []
		for (const address of addresses) {
			const resident = await options.residency.resident(address)
			if (resident === null) {
				if (record.released || disposed) return
				throw new Error(`A resolved Mosaic text leaf is not resident.`)
			}
			tokens.push(resident.token)
		}
		if (record.released || disposed || record.subscription !== subscription) {
			return
		}
		record.addresses = addresses
		record.tokens = tokens
		setIntoStore(requireStore(), record.membership, (revision) => revision + 1)
		if (options.evictReleased ?? true) {
			const current = new Set(keys)
			for (const address of previousAddresses) {
				if (!current.has(mosaicDomainMemberAddressKey(address))) {
					await options.residency.evict(address)
				}
			}
		}
	}

	const createRecord = (range: MosaicTextIndexRange): RangeRecord<Identity> => {
		const store = requireStore()
		const key = recordKey(range)
		getFromStore(store, membershipFamily, key)
		const membership = findInStore(store, membershipFamily, key)
		const record = {
			activation: Promise.resolve(),
			addresses: [],
			membership,
			observers: new Set(),
			projection: null,
			range,
			refresh: Promise.resolve(),
			released: false,
			references: 0,
			selector:
				null as unknown as ReadonlyPureSelectorToken<MosaicTextRangeProjection>,
			stopSelector: null,
			subscription: null,
			tokens: [],
		} satisfies RangeRecord<Identity>
		records.set(key, record)
		getFromStore(store, rangeFamily, key)
		record.selector = findInStore(store, rangeFamily, key)
		return record
	}

	const recordLookup = new WeakMap<
		RangeRecord<Identity>,
		MosaicTextIndexLookup
	>()
	const updateLookup = async (
		record: RangeRecord<Identity>,
	): Promise<boolean> => {
		const previousLookup = recordLookup.get(record)
		const lookup = await options.positionAtOffset(record.range.start)
		recordLookup.set(record, lookup)
		return JSON.stringify(previousLookup) !== JSON.stringify(lookup)
	}

	const activateRecord = async (
		record: RangeRecord<Identity>,
	): Promise<void> => {
		const subscription = await options.residency.subscribe(
			{
				kind: `range`,
				limit: rangeMemberLimit,
				member: options.rangeMember,
				range: record.range as unknown as Range,
			},
			() => {
				record.refresh = record.refresh
					.then(async () => {
						const changed = await updateLookup(record)
						await refreshRecord(record, changed)
					})
					.catch((error) => {
						if (error instanceof Error && error.name === `AbortError`) return
						options.residency.store.logger.error(
							`🐞`,
							`transaction`,
							`mosaic-text-projection`,
							`A Mosaic text range could not refresh.`,
							error,
						)
					})
			},
		)
		if (record.released || disposed) {
			await subscription.release()
			throw new Error(`This Mosaic text projection client is disposed.`)
		}
		record.subscription = subscription
		if (subscription.addresses.length > 0) {
			await updateLookup(record)
		}
		await refreshRecord(record)
		if (record.released || disposed) {
			throw new Error(`This Mosaic text projection client is disposed.`)
		}
		const publish = (projection: MosaicTextRangeProjection): void => {
			record.projection = projection
			for (const observer of record.observers) {
				try {
					observer(projection)
				} catch (error) {
					options.residency.store.logger.error(
						`🐞`,
						`transaction`,
						`mosaic-text-projection`,
						`A Mosaic text projection observer threw.`,
						error,
					)
				}
			}
		}
		publish(getFromStore(requireStore(), record.selector))
		record.stopSelector = subscribeToState(
			requireStore(),
			record.selector,
			`${resourceKey}:observe:${recordKey(record.range)}`,
			({ newValue }) => {
				publish(newValue)
			},
		)
	}

	const releaseRecord = async (record: RangeRecord<Identity>): Promise<void> => {
		if (record.references > 0) record.references--
		if (record.references > 0) {
			notifyState()
			return
		}
		if (record.released) return
		record.released = true
		const key = recordKey(record.range)
		records.delete(key)
		notifyState()
		const closing = (async () => {
			const failures: unknown[] = []
			record.stopSelector?.()
			record.stopSelector = null
			const subscription = record.subscription
			record.subscription = null
			try {
				await subscription?.release()
			} catch (error) {
				failures.push(error)
			}
			await record.refresh
			if (options.evictReleased ?? true) {
				for (const address of record.addresses) {
					try {
						await options.residency.evict(address)
					} catch (error) {
						failures.push(error)
					}
				}
			}
			disposeFromStore(requireStore(), rangeFamily, key)
			disposeFromStore(requireStore(), membershipFamily, key)
			record.observers.clear()
			if (failures.length > 0) {
				throw new AggregateError(
					failures,
					`Mosaic text range cleanup did not complete cleanly.`,
				)
			}
		})().finally(() => closures.delete(key))
		closures.set(key, closing)
		await closing
	}

	const acquireRange = async (
		range: MosaicTextIndexRange,
		acquisition?: MosaicTextRangeAcquisitionOptions,
	): Promise<MosaicTextRangeLease> => {
		if (disposed)
			throw new Error(`This Mosaic text projection client is disposed.`)
		await ensureRoot()
		const normalized = await canonicalRange(range, acquisition)
		if (disposed)
			throw new Error(`This Mosaic text projection client is disposed.`)
		const key = recordKey(normalized)
		await closures.get(key)
		let record = records.get(key)
		if (record === undefined) {
			if (records.size >= maximumActiveRanges) {
				throw new Error(
					`Mosaic text projection active ranges exceed ${maximumActiveRanges}.`,
				)
			}
			record = createRecord(normalized)
			records.set(key, record)
			record.activation = activateRecord(record)
		}
		record.references++
		notifyState()
		try {
			await record.activation
		} catch (error) {
			try {
				await releaseRecord(record)
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					`Mosaic text range activation and cleanup failed.`,
				)
			}
			throw error
		}
		let active = true
		const release = async (): Promise<void> => {
			if (!active) return
			active = false
			if (disposed) return
			await releaseRecord(record)
		}
		return {
			get active() {
				return active && !disposed
			},
			range: normalized,
			read: () => {
				if (!active || disposed)
					throw new Error(`This Mosaic text range lease is released.`)
				return getFromStore(requireStore(), record.selector)
			},
			release,
			selector: record.selector,
			[Symbol.dispose]() {
				void release()
			},
		}
	}

	const dispose = async (): Promise<void> => {
		if (disposed) return
		disposed = true
		const failures: unknown[] = []
		for (const record of [...records.values()]) {
			record.references = 1
			try {
				await releaseRecord(record)
			} catch (error) {
				failures.push(error)
			}
		}
		for (const closing of [...closures.values()]) {
			try {
				await closing
			} catch (error) {
				failures.push(error)
			}
		}
		try {
			rootLease?.release()
		} catch (error) {
			failures.push(error)
		}
		rootLease = null
		if (lengthToken !== null) {
			disposeFromStore(ownerStore, lengthFamily, `length`)
			lengthToken = null
		}
		stateListeners.clear()
		if (ownerStore.miscResources.get(resourceKey) === client) {
			ownerStore.miscResources.delete(resourceKey)
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Mosaic text projection cleanup did not complete cleanly.`,
			)
		}
	}
	const createGestureId = (): string => {
		const sequence = editSequence++
		return (
			options.idSource?.(sequence) ??
			`${options.actor}:${options.session}:gesture:${sequence}`
		)
	}
	const residentPositionAtOffset = (
		offset: number,
	): MosaicTextRelativePosition | null => {
		for (const record of records.values()) {
			for (const segment of record.projection?.segments ?? []) {
				if (offset < segment.start || offset > segment.end) continue
				return positionAtFragments(segment.fragments, offset - segment.start)
			}
		}
		return null
	}

	const client: MosaicTextProjectionClient<Identity, Range> = {
		acquireRange,
		dispose,
		async edit(edit) {
			if (disposed)
				throw new Error(`This Mosaic text projection client is disposed.`)
			const received = structuredClone(edit)
			const gestureId = identifier(
				received.gestureId ?? createGestureId(),
				`gestureId`,
			)
			let range: MosaicTextIndexRange | null = null
			if (received.type === `replace`) {
				const [anchor, head] = await Promise.all([
					options.resolvePosition(received.anchor),
					options.resolvePosition(received.head),
				])
				range = validateRange({
					end: Math.max(anchor, head),
					kind: `utf16-range`,
					start: Math.min(anchor, head),
				})
			}
			const context = {
				actor: options.actor,
				gestureId,
				range,
				session: options.session,
			}
			if (received.type !== `replace` && options.requestHistory !== undefined) {
				await options.requestHistory(received.type, {
					...context,
					range: null,
				})
				return
			}
			const plan = await options.planEdit(received, context)
			const operations = Array.isArray(plan.operations)
				? plan.operations
				: [plan.operations]
			if (operations.length === 0) {
				throw new Error(`A Mosaic text edit plan requires an operation.`)
			}
			const scope =
				plan.selection === undefined
					? null
					: await options.residency.subscribe(plan.selection)
			try {
				await options.residency.submit(operations, gestureId)
			} finally {
				try {
					await scope?.release()
				} catch (error) {
					options.residency.store.logger.error(
						`🐞`,
						`transaction`,
						`mosaic-text-projection`,
						`A temporary Mosaic text edit selection could not be released.`,
						error,
					)
				}
			}
		},
		lengthSelector: getLengthSelector,
		async materialize() {
			if (disposed)
				throw new Error(`This Mosaic text projection client is disposed.`)
			return options.materialize()
		},
		async observeRange(range, listener, acquisition) {
			const lease = await acquireRange(range, acquisition)
			const record = records.get(recordKey(lease.range))
			if (record === undefined || !lease.active) {
				await lease.release()
				throw new Error(`This Mosaic text projection client is disposed.`)
			}
			let active = true
			record.observers.add(listener)
			try {
				listener(lease.read())
			} catch (error) {
				options.residency.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-text-projection`,
					`A Mosaic text projection observer threw.`,
					error,
				)
			}
			notifyState()
			const release = async (): Promise<void> => {
				if (!active) return
				active = false
				record.observers.delete(listener)
				if (disposed) return
				await lease.release()
			}
			return {
				get active() {
					return active && !disposed
				},
				range: lease.range,
				release,
				[Symbol.dispose]() {
					void release()
				},
			}
		},
		async positionAtOffset(offset) {
			if (!Number.isSafeInteger(offset) || offset < 0) {
				throw new RangeError(`Mosaic text offset is outside the document.`)
			}
			// Capture a logical anchor from the caller's already-rendered resident
			// snapshot before yielding to a root read or a concurrent refresh.
			const resident = residentPositionAtOffset(offset)
			if (resident !== null) return resident
			const length = await client.readLength()
			if (offset > length) {
				throw new RangeError(`Mosaic text offset is outside the document.`)
			}
			const refreshedResident = residentPositionAtOffset(offset)
			if (refreshedResident !== null) return refreshedResident
			return (await options.positionAtOffset(offset)).position
		},
		async readLength() {
			return (await readRoot()).reference?.summary.utf16Units ?? 0
		},
		async readRange(range, acquisition) {
			const lease = await acquireRange(range, acquisition)
			try {
				return lease.read()
			} finally {
				await lease.release()
			}
		},
		resolvePosition(position) {
			for (const record of records.values()) {
				for (const segment of record.projection?.segments ?? []) {
					const local = localOffsetForFragments(segment.fragments, position)
					if (local !== null) return Promise.resolve(segment.start + local)
				}
			}
			return options.resolvePosition(structuredClone(position))
		},
		residency: options.residency,
		get state() {
			return stateSnapshot()
		},
		subscribeState(listener) {
			stateListeners.add(listener)
			try {
				listener(stateSnapshot())
			} catch (error) {
				options.residency.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-text-projection`,
					`A Mosaic text projection state observer threw.`,
					error,
				)
			}
			return () => stateListeners.delete(listener)
		},
		[Symbol.dispose]() {
			void dispose()
		},
	}

	ownerStore.miscResources.set(resourceKey, client)
	return client
}

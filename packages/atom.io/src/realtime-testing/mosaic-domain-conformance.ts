import type { Json } from "atom.io/foundations/json"
import {
	type MosaicDomainIdentity,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
} from "atom.io/realtime"

import { structurallyEqual } from "./structural-equality.ts"

export const MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE: readonly [
	`duplicate`,
	`delay`,
	`reorder`,
	`reject`,
	`disconnect`,
	`restart`,
	`resnapshot`,
] = Object.freeze([
	`duplicate`,
	`delay`,
	`reorder`,
	`reject`,
	`disconnect`,
	`restart`,
	`resnapshot`,
])

export type MosaicDomainConformanceFault =
	(typeof MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE)[number]

export type MosaicDomainConformanceCounters = {
	readonly checkpointWrites: number
	readonly deliveredPayloads: number
	readonly residentMembers: number
	readonly retainedHistory: number
	readonly selectorInvalidations: number
}

export type MosaicDomainConformanceFoundation = {
	readonly addresses: readonly MosaicDomainMemberAddress[]
	readonly identity: MosaicDomainIdentity
	readonly ownership: {
		readonly atomFamily: boolean
		readonly headlessStore: boolean
		readonly rendererProjection: boolean
		readonly selector: boolean
		readonly transaction: boolean
	}
}

export type MosaicDomainConformanceResidencyEvidence = {
	readonly eagerComplete: boolean
	readonly firstResidentAddresses: readonly MosaicDomainMemberAddress[]
	readonly secondResidentAddresses: readonly MosaicDomainMemberAddress[]
	readonly totalMemberCount: number
}

export type MosaicDomainConformanceAtomicBatchEvidence = {
	readonly affectedMembers: readonly MosaicDomainMemberAddress[]
	/** Model-level segments or structural edits committed by the gesture. */
	readonly logicalOperationCount: number
	readonly revisionAfter: number
	readonly revisionBefore: number
	/** Selector subscription values observed between the old and committed value. */
	readonly selectorIntermediateValues: readonly Json.Serializable[]
	/** Number of selector notifications for the committed transaction. */
	readonly selectorSettlements: number
}

export type MosaicDomainConformanceHistoryEvidence = {
	readonly baselineForeignProjection: Json.Serializable
	readonly baselineOwnProjection: Json.Serializable
	readonly foreignProjectionAfterForeignGesture: Json.Serializable
	readonly foreignProjectionAfterRedo: Json.Serializable
	readonly foreignProjectionAfterUndo: Json.Serializable
	readonly ownProjectionAfterGesture: Json.Serializable
	readonly ownProjectionAfterRedo: Json.Serializable
	readonly ownProjectionAfterUndo: Json.Serializable
}

export type MosaicDomainConformancePresenceEvidence = {
	readonly departedActor: string
	readonly durableProjectionAfterCleanup: Json.Serializable
	readonly durableProjectionBeforePresence: Json.Serializable
	readonly visibleActorsAfterCleanup: readonly string[]
	readonly visibleActorsBeforeCleanup: readonly string[]
}

export type MosaicDomainConformanceFaultEvidence = {
	readonly accepted: boolean
	readonly authoritativeProjection: Json.Serializable
	readonly clientProjections: readonly Json.Serializable[]
	readonly fault: MosaicDomainConformanceFault
	/** Concrete adapter-observed applications of the requested fault. */
	readonly faultSignals: number
	readonly projectionBefore: Json.Serializable
}

export type MosaicDomainConformanceAdapter = Disposable & {
	exerciseAtomicBatch(): Promise<MosaicDomainConformanceAtomicBatchEvidence>
	exerciseFault(
		fault: MosaicDomainConformanceFault,
	): Promise<MosaicDomainConformanceFaultEvidence>
	exerciseHistory(): Promise<MosaicDomainConformanceHistoryEvidence>
	exercisePresence(): Promise<MosaicDomainConformancePresenceEvidence>
	exerciseResidency(): Promise<MosaicDomainConformanceResidencyEvidence>
	foundation(): Promise<MosaicDomainConformanceFoundation>
	instrumentation(): Promise<MosaicDomainConformanceCounters>
	readonly name: string
}

export type MosaicDomainConformanceReport = {
	readonly counters: MosaicDomainConformanceCounters
	readonly domain: string
	readonly name: string
	readonly schedule: readonly MosaicDomainConformanceFault[]
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Mosaic Domain conformance: ${message}`)
}

const assertCounter = (name: string, value: number): void => {
	assert(
		Number.isSafeInteger(value) && value >= 0,
		`instrumentation counter "${name}" is invalid`,
	)
}

const assertCounters = (counters: MosaicDomainConformanceCounters): void => {
	for (const [name, value] of Object.entries(counters)) {
		assertCounter(name, value)
	}
}

const domainIdentityKey = (identity: MosaicDomainIdentity): string =>
	`${identity.definition.key}@${identity.definition.version}#${identity.instance}`

const assertSameDomain = (
	identity: MosaicDomainIdentity,
	addresses: readonly MosaicDomainMemberAddress[],
	context: string,
): void => {
	const identityKey = domainIdentityKey(identity)
	for (const address of addresses) {
		assert(
			domainIdentityKey(address.domain) === identityKey,
			`${context} escaped the declared Domain`,
		)
	}
}

const uniqueAddressKeys = (
	addresses: readonly MosaicDomainMemberAddress[],
): Set<string> => new Set(addresses.map(mosaicDomainMemberAddressKey))

/**
 * Run the public cross-vertical contract against one model adapter.
 *
 * Adapters own model vocabulary; the runner owns the schedule and every
 * cross-model invariant so text and design proofs cannot silently drift.
 */
export async function testMosaicDomainConformance(
	adapter: MosaicDomainConformanceAdapter,
): Promise<MosaicDomainConformanceReport> {
	assert(adapter.name.length > 0, `adapter names cannot be empty`)
	const foundation = await adapter.foundation()
	assert(
		foundation.identity.definition.key.length > 0 &&
			foundation.identity.instance.length > 0 &&
			Number.isSafeInteger(foundation.identity.definition.version) &&
			foundation.identity.definition.version > 0,
		`the adapter returned an invalid Domain identity`,
	)
	assert(
		foundation.addresses.length >= 2 &&
			uniqueAddressKeys(foundation.addresses).size ===
				foundation.addresses.length,
		`representative member addresses must be distinct`,
	)
	assertSameDomain(
		foundation.identity,
		foundation.addresses,
		`representative addressing`,
	)
	assert(
		Object.values(foundation.ownership).every(Boolean),
		`ordinary Store/family/selector/transaction ownership was not preserved`,
	)

	const initialCounters = await adapter.instrumentation()
	assertCounters(initialCounters)

	const residency = await adapter.exerciseResidency()
	assertSameDomain(
		foundation.identity,
		residency.firstResidentAddresses,
		`first residency`,
	)
	assertSameDomain(
		foundation.identity,
		residency.secondResidentAddresses,
		`second residency`,
	)
	const firstResidentKeys = uniqueAddressKeys(residency.firstResidentAddresses)
	const secondResidentKeys = uniqueAddressKeys(residency.secondResidentAddresses)
	assert(
		firstResidentKeys.size > 0,
		`the first partial client loaded no members`,
	)
	assert(
		secondResidentKeys.size > 0,
		`the second partial client loaded no members`,
	)
	assert(
		[...firstResidentKeys].every((key) => !secondResidentKeys.has(key)),
		`partial clients did not receive disjoint member sets`,
	)
	assert(!residency.eagerComplete, `partial residency eagerly loaded the Domain`)
	assert(
		Number.isSafeInteger(residency.totalMemberCount) &&
			firstResidentKeys.size + secondResidentKeys.size <
				residency.totalMemberCount,
		`partial residency did not leave any Domain members unloaded`,
	)

	const atomic = await adapter.exerciseAtomicBatch()
	assertSameDomain(foundation.identity, atomic.affectedMembers, `atomic gesture`)
	assert(
		uniqueAddressKeys(atomic.affectedMembers).size >= 1 &&
			Number.isSafeInteger(atomic.logicalOperationCount) &&
			atomic.logicalOperationCount >= 2,
		`the representative gesture did not span multiple logical edits`,
	)
	assert(
		atomic.revisionAfter === atomic.revisionBefore + 1,
		`the representative gesture did not commit at one Domain revision`,
	)
	assert(
		atomic.selectorSettlements === 1 &&
			atomic.selectorIntermediateValues.length === 0,
		`derived selectors exposed a partial gesture settlement`,
	)

	const history = await adapter.exerciseHistory()
	assert(
		structurallyEqual(
			history.ownProjectionAfterUndo,
			history.baselineOwnProjection,
		),
		`actor undo did not restore its own baseline projection`,
	)
	assert(
		structurallyEqual(
			history.ownProjectionAfterRedo,
			history.ownProjectionAfterGesture,
		),
		`actor redo did not restore its own gesture projection`,
	)
	assert(
		structurallyEqual(
			history.foreignProjectionAfterUndo,
			history.foreignProjectionAfterForeignGesture,
		) &&
			structurallyEqual(
				history.foreignProjectionAfterRedo,
				history.foreignProjectionAfterForeignGesture,
			),
		`actor compensation altered a foreign projection`,
	)
	assert(
		structurallyEqual(
			history.baselineForeignProjection,
			history.foreignProjectionAfterForeignGesture,
		) === false,
		`the foreign control gesture did not change its projection`,
	)

	const presence = await adapter.exercisePresence()
	assert(
		presence.visibleActorsBeforeCleanup.includes(presence.departedActor) &&
			!presence.visibleActorsAfterCleanup.includes(presence.departedActor),
		`departed presence was not cleaned up`,
	)
	assert(
		structurallyEqual(
			presence.durableProjectionBeforePresence,
			presence.durableProjectionAfterCleanup,
		),
		`presence mutated durable Domain state`,
	)

	for (const fault of MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE) {
		const evidence = await adapter.exerciseFault(fault)
		assert(evidence.fault === fault, `adapter executed the wrong fault step`)
		assert(
			Number.isSafeInteger(evidence.faultSignals) && evidence.faultSignals > 0,
			`fault "${fault}" did not produce observable instrumentation`,
		)
		assert(
			evidence.clientProjections.length >= 2 &&
				evidence.clientProjections.every((projection) =>
					structurallyEqual(projection, evidence.authoritativeProjection),
				),
			`clients did not converge after fault "${fault}"`,
		)
		if (fault === `reject`) {
			assert(!evidence.accepted, `the reject step was accepted`)
			assert(
				structurallyEqual(
					evidence.projectionBefore,
					evidence.authoritativeProjection,
				),
				`a rejected batch changed durable state`,
			)
		} else {
			assert(evidence.accepted, `fault "${fault}" lost its valid gesture`)
		}
	}

	const counters = await adapter.instrumentation()
	assertCounters(counters)
	for (const key of Object.keys(
		counters,
	) as (keyof MosaicDomainConformanceCounters)[]) {
		assert(
			counters[key] >= initialCounters[key],
			`instrumentation counter "${key}" moved backwards`,
		)
	}
	assert(
		counters.residentMembers > 0,
		`resident-member instrumentation stayed empty`,
	)
	assert(counters.deliveredPayloads > 0, `payload instrumentation stayed empty`)
	assert(
		counters.checkpointWrites > 0,
		`checkpoint instrumentation stayed empty`,
	)
	assert(
		counters.selectorInvalidations > 0,
		`selector instrumentation stayed empty`,
	)
	assert(counters.retainedHistory > 0, `history instrumentation stayed empty`)

	return Object.freeze({
		counters: Object.freeze({ ...counters }),
		domain: domainIdentityKey(foundation.identity),
		name: adapter.name,
		schedule: MOSAIC_DOMAIN_CONFORMANCE_FAULT_SCHEDULE,
	})
}

import type { MutableAtomToken, TransactionToken, WritableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	actUponStore,
	createTransaction,
	getFromStore,
	getJsonTokenFromStore,
	type RootStore,
} from "atom.io/internal"

import type {
	AnyMosaicTransceiver,
	MosaicModelIdentifier,
	MosaicReduceContext,
	MosaicTransceiverConstructor,
} from "./mosaic/index.ts"
import type {
	MosaicDomainIdentity,
	MosaicDomainInstance,
	MosaicDomainMemberAddress,
} from "./mosaic-domain.ts"
import type { StandardSchemaV1 } from "./standard-schema.ts"

/** Wire version for atomic Mosaic Domain batches. */
export const MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION = 1 as const

export type MosaicDomainBatchProtocolVersion =
	typeof MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION

export type MosaicDomainValueModel<
	Value extends Json.Serializable = Json.Serializable,
	Operation extends Json.Serializable = Json.Serializable,
> = {
	readonly identity: MosaicModelIdentifier
	readonly kind: `value`
	readonly operationSchema: StandardSchemaV1<unknown, Operation>
	/** Pure, synchronous reduction used for both preflight and settlement. */
	reduce(value: Value, operation: Operation, context: MosaicReduceContext): Value
}

export type MosaicDomainTransceiverModel<
	TransceiverType extends AnyMosaicTransceiver = AnyMosaicTransceiver,
> = {
	readonly class: MosaicTransceiverConstructor<TransceiverType>
	readonly kind: `transceiver`
	readonly operationSchema: StandardSchemaV1<unknown, Json.Serializable>
}

/** A deterministic member model registered directly on a MOS-10 member. */
export type MosaicDomainMemberModel =
	| MosaicDomainTransceiverModel
	| MosaicDomainValueModel

export type MosaicDomainBatchMemberOperation<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly id: string
	readonly model: MosaicModelIdentifier
	readonly operation: Json.Serializable
}

/** Untrusted client proposal. The server supplies authenticated authorship. */
export type MosaicDomainBatchProposal<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly affectedMembers: readonly MosaicDomainMemberAddress<Identity>[]
	readonly dependencies: readonly string[]
	readonly domain: Identity
	readonly group: string | null
	readonly id: string
	readonly operations: readonly MosaicDomainBatchMemberOperation<Identity>[]
	readonly protocolVersion: MosaicDomainBatchProtocolVersion
	readonly session: string
}

/** A schema-normalized proposal bound to an authenticated actor. */
export type MosaicDomainBatchEnvelope<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = MosaicDomainBatchProposal<Identity> & {
	readonly actor: string
}

/** One accepted domain revision; every member operation shares this revision. */
export type MosaicAcceptedDomainBatchEnvelope<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly batch: MosaicDomainBatchEnvelope<Identity>
	readonly revision: number
}

export type MosaicDomainBatchRejectionCode =
	| `backpressure`
	| `batch-id-collision`
	| `capacity-exceeded`
	| `gap`
	| `incompatible-version`
	| `invalid-model-operation`
	| `invalid-payload`
	| `missing-dependency`
	| `operation-id-collision`
	| `unauthorized`

export type MosaicDomainBatchRejection = {
	readonly batchId: string | null
	readonly code: MosaicDomainBatchRejectionCode
	readonly reason: string
	readonly recovery: `discard-batch` | `resnapshot` | `retry` | `upgrade`
}

export type MosaicDomainBatchLimits = {
	readonly maxBytes: number
	readonly maxMembers: number
	readonly maxOperations: number
}

export const DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS: MosaicDomainBatchLimits =
	Object.freeze({
		maxBytes: 256 * 1024,
		maxMembers: 256,
		maxOperations: 1024,
	})

type InternalUpdate = {
	readonly next: unknown
	readonly previous: unknown
	readonly token: WritableToken<any, any, any>
}

const preparedUpdates = new WeakMap<object, readonly InternalUpdate[]>()
const preparedApplied = new WeakMap<object, boolean>()
const preparedStores = new WeakMap<object, RootStore>()
const settlements = new WeakMap<
	RootStore,
	{
		readonly updates: readonly InternalUpdate[]
		readonly which: `next` | `previous`
	}
>()
const settlementTransactions = new WeakMap<
	RootStore,
	TransactionToken<() => void>
>()

export type PreparedMosaicDomainBatch<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly batch: MosaicDomainBatchEnvelope<Identity>
	readonly members: readonly MosaicDomainMemberAddress<Identity>[]
}

export type MosaicDomainBatchProjection<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly batch: MosaicDomainBatchEnvelope<Identity>
	readonly revision?: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const isJsonSerializable = (
	value: unknown,
	ancestors: WeakSet<object> = new WeakSet(),
): value is Json.Serializable => {
	if (
		value === null ||
		typeof value === `boolean` ||
		typeof value === `string`
	) {
		return true
	}
	if (typeof value === `number`) return Number.isFinite(value)
	if (typeof value !== `object`) return false
	if (ancestors.has(value)) return false
	ancestors.add(value)
	const prototype = Object.getPrototypeOf(value) as {
		readonly constructor?: { readonly name?: string }
	} | null
	const plainObject =
		prototype === null || prototype.constructor?.name === `Object`
	const valid = Array.isArray(value)
		? value.every((item) => isJsonSerializable(item, ancestors))
		: plainObject &&
			Object.values(value).every((item) => isJsonSerializable(item, ancestors))
	ancestors.delete(value)
	return valid
}

const canonicalize = (value: Json.Serializable): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, Json.Serializable>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

/** Canonical authenticated content used for collision-safe receipt matching. */
export function mosaicDomainBatchMeaningKey(
	batch: MosaicDomainBatchEnvelope,
): string {
	return canonicalize(batch)
}

export function mosaicDomainMemberAddressKey(
	address: MosaicDomainMemberAddress,
): string {
	return canonicalize(address)
}

function sameModel(
	actual: MosaicModelIdentifier,
	expected: MosaicModelIdentifier,
): boolean {
	return canonicalize(actual) === canonicalize(expected)
}

async function validate<Output>(
	schema: StandardSchemaV1<unknown, Output>,
	value: unknown,
	boundary: string,
): Promise<Output> {
	const result = await schema[`~standard`].validate(value)
	if (result.issues) {
		throw new Error(
			`${boundary} failed validation: ${result.issues
				.map(({ message }) => message)
				.join(`; `)}`,
		)
	}
	return result.value
}

/** Validate protocol shape and per-proposal safety limits before model work. */
export function assertMosaicDomainBatchEnvelope(
	value: MosaicDomainBatchEnvelope,
	limits: MosaicDomainBatchLimits = DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS,
): void {
	if (!isRecord(value))
		throw new Error(`A Mosaic Domain batch must be an object.`)
	if (value.protocolVersion !== MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION) {
		throw new Error(`Unsupported Mosaic Domain batch protocol version.`)
	}
	for (const [name, id] of [
		[`actor`, value.actor],
		[`batch`, value.id],
		[`session`, value.session],
	] as const) {
		if (!identifier(id))
			throw new Error(`A Mosaic Domain ${name} ID is invalid.`)
	}
	if (value.group !== null && !identifier(value.group)) {
		throw new Error(`A Mosaic Domain gesture group ID is invalid.`)
	}
	if (!Array.isArray(value.dependencies)) {
		throw new Error(`Mosaic Domain batch dependencies must be an array.`)
	}
	if (new Set(value.dependencies).size !== value.dependencies.length) {
		throw new Error(`Mosaic Domain batch dependencies must be unique.`)
	}
	if (!value.dependencies.every(identifier)) {
		throw new Error(`A Mosaic Domain batch dependency ID is invalid.`)
	}
	if (!Array.isArray(value.operations) || value.operations.length === 0) {
		throw new Error(`A Mosaic Domain batch requires at least one operation.`)
	}
	if (value.operations.length > limits.maxOperations) {
		throw new Error(
			`Mosaic Domain batch operation count exceeds ${limits.maxOperations}.`,
		)
	}
	if (
		!Array.isArray(value.affectedMembers) ||
		value.affectedMembers.length > limits.maxMembers
	) {
		throw new Error(
			`Mosaic Domain batch member count exceeds ${limits.maxMembers}.`,
		)
	}
	if (!isJsonSerializable(value)) {
		throw new Error(`A Mosaic Domain batch must be JSON-serializable.`)
	}
	const operationIds = new Set<string>()
	const operationMembers = new Set<string>()
	for (const operation of value.operations) {
		if (!isRecord(operation) || !identifier(operation[`id`])) {
			throw new Error(`A Mosaic Domain member operation ID is invalid.`)
		}
		if (operationIds.has(operation[`id`])) {
			throw new Error(`Mosaic Domain member operation IDs must be unique.`)
		}
		operationIds.add(operation[`id`])
		operationMembers.add(
			mosaicDomainMemberAddressKey(
				operation[`address`] as MosaicDomainMemberAddress,
			),
		)
	}
	const affected = value.affectedMembers.map(mosaicDomainMemberAddressKey)
	if (
		new Set(affected).size !== affected.length ||
		affected.length !== operationMembers.size ||
		affected.some((address) => !operationMembers.has(address))
	) {
		throw new Error(
			`Mosaic Domain affected members must exactly match member operations.`,
		)
	}
	let bytes: number
	try {
		bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
	} catch {
		throw new Error(`A Mosaic Domain batch must be JSON-serializable.`)
	}
	if (bytes > limits.maxBytes) {
		throw new Error(`Mosaic Domain batch bytes exceed ${limits.maxBytes}.`)
	}
}

export function mosaicDomainMemberModelIdentity(
	model: MosaicDomainMemberModel,
): MosaicModelIdentifier {
	return model.kind === `transceiver` ? model.class.mosaic : model.identity
}

function wireValue(value: unknown): unknown {
	return isRecord(value) && typeof value[`toJSON`] === `function`
		? (value[`toJSON`] as () => unknown)()
		: value
}

async function preflightMosaicDomainBatchWithProjection<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	batch: MosaicDomainBatchEnvelope<Identity>,
	options: {
		readonly limits?: Partial<MosaicDomainBatchLimits>
		readonly revision?: number | null
	} = {},
	projectedValues?: ReadonlyMap<string, unknown>,
): Promise<PreparedMosaicDomainBatch<Identity>> {
	if (domain.disposed) throw new Error(`This Mosaic Domain is disposed.`)
	const limits = { ...DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS, ...options.limits }
	assertMosaicDomainBatchEnvelope(batch, limits)
	const stableBatch = structuredClone(batch)
	if (canonicalize(stableBatch.domain) !== canonicalize(domain.identity)) {
		throw new Error(`The Mosaic Domain batch belongs to another domain.`)
	}

	const staged = new Map<string, InternalUpdate>()
	for (const operation of stableBatch.operations) {
		const parsed = await domain.parseAddress(operation.address)
		if (parsed.member.role !== `durable`) {
			throw new Error(
				`Mosaic Domain member "${operation.address.member}" is not durable.`,
			)
		}
		const model = parsed.member.model
		if (model === undefined) {
			throw new Error(
				`Mosaic Domain member "${operation.address.member}" has no batch model.`,
			)
		}
		if (!sameModel(operation.model, mosaicDomainMemberModelIdentity(model))) {
			throw new Error(
				`Mosaic Domain member "${operation.address.member}" has incompatible model metadata.`,
			)
		}
		const normalized = await validate(
			model.operationSchema,
			operation.operation,
			`Mosaic Domain member "${operation.address.member}" operation`,
		)
		const acquired = await domain.acquire(parsed)
		const token: WritableToken<any, any, any> =
			model.kind === `transceiver`
				? getJsonTokenFromStore(
						domain.store,
						acquired.token as MutableAtomToken<AnyMosaicTransceiver>,
					)
				: acquired.token
		const key = token.key
		const prior = staged.get(key)
		const projected = projectedValues?.get(key)
		const previous =
			prior?.previous ??
			(projectedValues?.has(key) === true
				? projected
				: getFromStore(domain.store, token))
		const current = prior?.next ?? previous
		const context: MosaicReduceContext = {
			actor: stableBatch.actor,
			dependencies: stableBatch.dependencies,
			group: stableBatch.group,
			id: operation.id,
			revision: options.revision ?? null,
			session: batch.session,
		}
		let next: unknown
		if (model.kind === `value`) {
			next = model.reduce(
				structuredClone(current as Json.Serializable),
				normalized,
				context,
			)
		} else {
			const projection = model.class.fromJSON(
				structuredClone(current as Json.Serializable),
			)
			const decision = projection.validate(normalized, context)
			if (decision.status !== `accept`) {
				throw new Error(
					decision.status === `defer`
						? `Mosaic Domain member "${operation.address.member}" is missing model dependencies.`
						: decision.reason,
				)
			}
			projection.do({ ...context, operation: decision.operation })
			next = projection.toJSON()
		}
		const output = wireValue(next)
		if (!isJsonSerializable(output)) {
			throw new Error(
				`Mosaic Domain member "${operation.address.member}" produced a non-serializable value.`,
			)
		}
		await domain.validateValue(operation.address.member, output)
		staged.set(key, {
			next,
			previous,
			token,
		})
	}

	const prepared = Object.freeze({
		batch: stableBatch,
		members: Object.freeze([...stableBatch.affectedMembers]),
	})
	preparedUpdates.set(prepared, [...staged.values()])
	preparedApplied.set(prepared, false)
	preparedStores.set(prepared, domain.store)
	return prepared
}

/**
 * Resolve, schema-check, and reduce every operation without mutating the Store.
 * The returned object is capability-bound to this process and cannot be forged.
 */
export function preflightMosaicDomainBatch<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	batch: MosaicDomainBatchEnvelope<Identity>,
	options: {
		readonly limits?: Partial<MosaicDomainBatchLimits>
		readonly revision?: number | null
	} = {},
): Promise<PreparedMosaicDomainBatch<Identity>> {
	return preflightMosaicDomainBatchWithProjection(domain, batch, options)
}

function settleUpdates(
	store: RootStore,
	updates: readonly InternalUpdate[],
	transactionId: string,
	which: `next` | `previous`,
): void {
	let transaction = settlementTransactions.get(store)
	if (transaction === undefined) {
		transaction = createTransaction<() => void>(store, {
			key: `atom.io/realtime/mosaic-domain-batch-settlement`,
			do: ({ set }) => {
				const settlement = settlements.get(store)
				if (settlement === undefined) {
					throw new Error(`A Mosaic Domain settlement has no prepared values.`)
				}
				for (const update of settlement.updates) {
					set(update.token, update[settlement.which])
				}
			},
		})
		settlementTransactions.set(store, transaction)
	}
	settlements.set(store, { updates, which })
	try {
		actUponStore(store, transaction, transactionId)()
	} finally {
		settlements.delete(store)
	}
}

function settlePrepared(
	prepared: PreparedMosaicDomainBatch,
	which: `next` | `previous`,
): void {
	const updates = preparedUpdates.get(prepared)
	if (updates === undefined) {
		throw new Error(`A prepared Mosaic Domain batch cannot be forged.`)
	}
	const applied = preparedApplied.get(prepared) === true
	if ((which === `next`) === applied) return
	const store = preparedStores.get(prepared)
	if (store === undefined) {
		throw new Error(`A prepared Mosaic Domain batch lost its Store.`)
	}
	settleUpdates(store, updates, `${prepared.batch.id}:${which}`, which)
	preparedApplied.set(prepared, which === `next`)
}

/**
 * Replace applied optimistic batches with a newly reduced projection in one
 * ordinary Store transaction. No intermediate rollback state becomes visible.
 */
export async function reprojectMosaicDomainBatches<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	remove: readonly PreparedMosaicDomainBatch<Identity>[],
	project: readonly MosaicDomainBatchProjection<Identity>[],
): Promise<readonly PreparedMosaicDomainBatch<Identity>[]> {
	const base = new Map<string, InternalUpdate>()
	const tokens = new Map<string, WritableToken<any, any, any>>()
	const seen = new Set<PreparedMosaicDomainBatch<Identity>>()
	for (const prepared of remove) {
		if (seen.has(prepared)) {
			throw new Error(`A prepared Mosaic Domain batch cannot be removed twice.`)
		}
		seen.add(prepared)
		const updates = preparedUpdates.get(prepared)
		if (
			updates === undefined ||
			preparedStores.get(prepared) !== domain.store ||
			preparedApplied.get(prepared) !== true
		) {
			throw new Error(
				`A Mosaic Domain reprojection can remove only applied batches from its Store.`,
			)
		}
		for (const update of updates) {
			tokens.set(update.token.key, update.token)
			if (!base.has(update.token.key)) base.set(update.token.key, update)
		}
	}

	const projectedValues = new Map<string, unknown>()
	for (const [key, update] of base) projectedValues.set(key, update.previous)
	const preparedProjection: PreparedMosaicDomainBatch<Identity>[] = []
	for (const item of project) {
		const prepared = await preflightMosaicDomainBatchWithProjection(
			domain,
			item.batch,
			item.revision === undefined ? {} : { revision: item.revision },
			projectedValues,
		)
		preparedProjection.push(prepared)
		for (const update of preparedUpdates.get(prepared) ?? []) {
			tokens.set(update.token.key, update.token)
			projectedValues.set(update.token.key, update.next)
		}
	}

	const updates: InternalUpdate[] = []
	for (const [key, token] of tokens) {
		updates.push({
			next: projectedValues.has(key)
				? projectedValues.get(key)
				: base.get(key)?.previous,
			previous: getFromStore(domain.store, token),
			token,
		})
	}
	if (updates.length > 0) {
		settleUpdates(
			domain.store,
			updates,
			`reproject:${project.map(({ batch }) => batch.id).join(`,`)}`,
			`next`,
		)
	}
	for (const prepared of remove) preparedApplied.set(prepared, false)
	for (const prepared of preparedProjection) preparedApplied.set(prepared, true)
	return Object.freeze(preparedProjection)
}

/** Apply all prepared resident member values through one ordinary transaction. */
export function applyMosaicDomainBatch(
	prepared: PreparedMosaicDomainBatch,
): void {
	settlePrepared(prepared, `next`)
}

/** Roll back one optimistic batch through one ordinary transaction. */
export function revertMosaicDomainBatch(
	prepared: PreparedMosaicDomainBatch,
): void {
	settlePrepared(prepared, `previous`)
}

import type {
	MutableAtomToken,
	TransactionCommitEvent,
	TransactionToken,
	WritableToken,
} from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	actUponStore,
	assertTransactionCommitEventOwner,
	createTransaction,
	getFromStore,
	getJsonTokenFromStore,
	type RootStore,
} from "atom.io/internal"

import type {
	AnyMosaicTransceiver,
	MosaicModelIdentifier,
	MosaicOperationSignal,
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
	/** Encode one committed ordinary Atom.io state change for this model. */
	encodeTransaction?(
		change: MosaicDomainValueTransactionChange<Value>,
		context: MosaicDomainTransactionEncodeContext,
	): unknown
	/** Pure, synchronous reduction used for both preflight and settlement. */
	reduce(value: Value, operation: Operation, context: MosaicReduceContext): Value
}

export type MosaicDomainTransceiverModel<
	TransceiverType extends AnyMosaicTransceiver = AnyMosaicTransceiver,
> = {
	readonly class: MosaicTransceiverConstructor<TransceiverType>
	readonly kind: `transceiver`
	readonly operationSchema: StandardSchemaV1<unknown, Json.Serializable>
	/** Encode one committed transceiver signal for this model. */
	encodeTransaction?(
		signal: MosaicOperationSignal,
		context: MosaicDomainTransactionEncodeContext,
	): unknown
}

export type MosaicDomainValueTransactionChange<
	Value extends Json.Serializable = Json.Serializable,
> = {
	readonly newValue: Value
	readonly oldValue: Value
}

/** Stable metadata supplied to model-owned transaction encoders. */
export type MosaicDomainTransactionEncodeContext = MosaicReduceContext & {
	readonly revision: null
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
	readonly nextExists: boolean
	readonly previous: unknown
	readonly previousExists: boolean
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

export type MosaicDomainMemberHydration<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly value: Json.Serializable
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

const deepFreeze = <Value extends Json.Serializable>(value: Value): Value => {
	if (value !== null && typeof value === `object`) {
		for (const child of Object.values(value)) {
			deepFreeze(child)
		}
		Object.freeze(value)
	}
	return value
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

async function validateOperation<Output extends Json.Serializable>(
	schema: StandardSchemaV1<unknown, Output>,
	value: unknown,
	boundary: string,
): Promise<Output> {
	const normalized = await validate(schema, value, boundary)
	if (!isJsonSerializable(normalized)) {
		throw new Error(`${boundary} produced a non-serializable operation.`)
	}
	const repeated = await validate(schema, structuredClone(normalized), boundary)
	if (
		!isJsonSerializable(repeated) ||
		canonicalize(normalized) !== canonicalize(repeated)
	) {
		throw new Error(`${boundary} schema must normalize idempotently.`)
	}
	return normalized
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

function readMemberValueWithoutAllocating(
	domain: MosaicDomainInstance<any, any, any>,
	parsed: Awaited<
		ReturnType<MosaicDomainInstance<any, any, any>[`parseAddress`]>
	>,
	token: WritableToken<any, any, any>,
	exists: boolean,
): unknown {
	if (!(`family` in token) || exists) {
		return getFromStore(domain.store, token)
	}
	const family = domain.store.families.get(parsed.member.token.key)
	if (family === undefined) {
		throw new Error(
			`Mosaic Domain durable family member "${parsed.address.member}" is not installed.`,
		)
	}
	if (family.type === `mutable_atom_family`) {
		return new family.class().toJSON()
	}
	if (family.type === `atom_family`) {
		return typeof family.default === `function`
			? family.default(parsed.address.key)
			: family.default
	}
	throw new Error(
		`Mosaic Domain durable family member "${parsed.address.member}" is not an atom family.`,
	)
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
	projectedExisting?: ReadonlySet<string>,
): Promise<PreparedMosaicDomainBatch<Identity>> {
	if (domain.disposed) throw new Error(`This Mosaic Domain is disposed.`)
	const limits = { ...DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS, ...options.limits }
	assertMosaicDomainBatchEnvelope(batch, limits)
	const stableBatch = structuredClone(batch)
	if (canonicalize(stableBatch.domain) !== canonicalize(domain.identity)) {
		throw new Error(`The Mosaic Domain batch belongs to another domain.`)
	}

	const staged = new Map<string, InternalUpdate>()
	const normalizedOperations: MosaicDomainBatchMemberOperation<Identity>[] = []
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
		const normalized = await validateOperation(
			model.operationSchema,
			operation.operation,
			`Mosaic Domain member "${operation.address.member}" operation`,
		)
		const operationForModel = structuredClone(normalized)
		const acquired = await domain.acquire(parsed)
		const memberExists =
			!(`family` in acquired.token) || domain.store.atoms.has(acquired.token.key)
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
				: readMemberValueWithoutAllocating(domain, parsed, token, memberExists))
		const previousExists =
			prior?.previousExists ??
			(projectedValues?.has(key) === true
				? projectedExisting?.has(key) === true
				: memberExists)
		const current = prior?.next ?? previous
		const context: MosaicReduceContext = {
			actor: stableBatch.actor,
			dependencies: stableBatch.dependencies,
			group: stableBatch.group,
			id: operation.id,
			revision: options.revision ?? null,
			session: stableBatch.session,
		}
		let next: unknown
		if (model.kind === `value`) {
			next = model.reduce(
				structuredClone(current as Json.Serializable),
				operationForModel,
				context,
			)
		} else {
			const projection = model.class.fromJSON(
				structuredClone(current as Json.Serializable),
			)
			const decision = projection.validate(operationForModel, context)
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
		const validated = await domain.validateValue(parsed.address.member, output)
		staged.set(key, {
			next: validated,
			nextExists: true,
			previous,
			previousExists,
			token,
		})
		normalizedOperations.push({
			address: parsed.address,
			id: operation.id,
			model: structuredClone(mosaicDomainMemberModelIdentity(model)),
			operation: structuredClone(normalized),
		})
	}
	const normalizedMembers = new Map<
		string,
		MosaicDomainMemberAddress<Identity>
	>()
	for (const operation of normalizedOperations) {
		normalizedMembers.set(
			mosaicDomainMemberAddressKey(operation.address),
			operation.address,
		)
	}
	const normalizedBatch = deepFreeze(
		structuredClone({
			...stableBatch,
			affectedMembers: [...normalizedMembers.values()],
			operations: normalizedOperations,
		}),
	)

	const prepared = Object.freeze({
		batch: normalizedBatch,
		members: Object.freeze([...normalizedBatch.affectedMembers]),
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

/**
 * Read a durable member's deterministic initial checkpoint without allocating
 * a family member or consulting its mutable current value.
 */
export async function defaultMosaicDomainMemberCheckpoint<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	address: MosaicDomainMemberAddress<Identity>,
): Promise<Json.Serializable> {
	const parsed = await domain.parseAddress(address)
	if (parsed.member.role !== `durable`) {
		throw new Error(`A Mosaic Domain checkpoint member must be durable.`)
	}
	const declared = parsed.member.token
	const installed = declared.type.endsWith(`_family`)
		? domain.store.families.get(declared.key)
		: domain.store.atoms.get(declared.key)
	if (installed === undefined) {
		throw new Error(`A Mosaic Domain checkpoint member is not installed.`)
	}
	const token = installed as unknown as
		| {
				readonly class: new () => { toJSON(): unknown }
				readonly type: `mutable_atom` | `mutable_atom_family`
		  }
		| {
				readonly default: unknown
				readonly type: `atom` | `atom_family`
		  }
	let value: unknown
	if (`class` in token) {
		value = new token.class().toJSON()
	} else {
		value =
			typeof token.default === `function`
				? token.default(parsed.address.key)
				: token.default
	}
	const output = wireValue(value)
	if (!isJsonSerializable(output)) {
		throw new Error(`A Mosaic Domain member default is not serializable.`)
	}
	const validated = await domain.validateValue(
		parsed.address.member,
		structuredClone(output),
	)
	if (!isJsonSerializable(validated)) {
		throw new Error(`A Mosaic Domain member default is not serializable.`)
	}
	return structuredClone(validated)
}

/**
 * Reduce one checkpoint member through an accepted tail without acquiring it
 * in the Store. This is the lazy MOS-12/MOS-13 hydration boundary.
 */
export async function projectMosaicDomainCheckpointMember<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	address: MosaicDomainMemberAddress<Identity>,
	initial: Json.Serializable,
	tail: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[],
): Promise<Json.Serializable> {
	const parsed = await domain.parseAddress(address)
	if (parsed.member.role !== `durable` || parsed.member.model === undefined) {
		throw new Error(
			`A Mosaic Domain checkpoint member must be durable and modeled.`,
		)
	}
	const model = parsed.member.model
	const addressKey = mosaicDomainMemberAddressKey(parsed.address)
	let current = await domain.validateValue(
		parsed.address.member,
		structuredClone(initial),
	)
	if (!isJsonSerializable(current)) {
		throw new Error(`A Mosaic Domain checkpoint member is not serializable.`)
	}
	let previousRevision = -1
	for (const accepted of tail) {
		assertMosaicDomainBatchEnvelope(accepted.batch)
		if (
			!Number.isSafeInteger(accepted.revision) ||
			accepted.revision < 1 ||
			accepted.revision <= previousRevision ||
			(previousRevision >= 0 && accepted.revision !== previousRevision + 1) ||
			canonicalize(accepted.batch.domain) !== canonicalize(domain.identity)
		) {
			throw new Error(`A Mosaic Domain checkpoint tail is invalid.`)
		}
		previousRevision = accepted.revision
		for (const operation of accepted.batch.operations) {
			if (mosaicDomainMemberAddressKey(operation.address) !== addressKey)
				continue
			if (!sameModel(operation.model, mosaicDomainMemberModelIdentity(model))) {
				throw new Error(`A Mosaic Domain checkpoint tail model is incompatible.`)
			}
			const normalized = await validateOperation(
				model.operationSchema,
				operation.operation,
				`Mosaic Domain checkpoint member operation`,
			)
			const context: MosaicReduceContext = {
				actor: accepted.batch.actor,
				dependencies: accepted.batch.dependencies,
				group: accepted.batch.group,
				id: operation.id,
				revision: accepted.revision,
				session: accepted.batch.session,
			}
			let next: unknown
			if (model.kind === `value`) {
				next = model.reduce(
					structuredClone(current),
					structuredClone(normalized),
					context,
				)
			} else {
				const projection = model.class.fromJSON(structuredClone(current))
				const decision = projection.validate(
					structuredClone(normalized),
					context,
				)
				if (decision.status !== `accept`) {
					throw new Error(
						decision.status === `defer`
							? `A Mosaic Domain checkpoint tail is missing model dependencies.`
							: decision.reason,
					)
				}
				projection.do({ ...context, operation: decision.operation })
				next = projection.toJSON()
			}
			const output = wireValue(next)
			if (!isJsonSerializable(output)) {
				throw new Error(
					`A Mosaic Domain checkpoint projection is not serializable.`,
				)
			}
			current = await domain.validateValue(
				parsed.address.member,
				structuredClone(output),
			)
			if (!isJsonSerializable(current)) {
				throw new Error(
					`A Mosaic Domain checkpoint projection is not serializable.`,
				)
			}
		}
	}
	return structuredClone(current)
}

/**
 * Prepare optimism that an authenticated Store commit has already revealed.
 * The Store-owned event is an unforgeable adoption capability; this function
 * validates the model reduction against the isolated committed snapshots but
 * never applies the resulting values a second time.
 *
 * @internal Used by the realtime-client transaction bridge.
 */
export async function prepareCommittedMosaicDomainBatch<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	batch: MosaicDomainBatchEnvelope<Identity>,
	commit: TransactionCommitEvent,
): Promise<PreparedMosaicDomainBatch<Identity>> {
	assertTransactionCommitEventOwner(domain.store, commit)
	assertMosaicDomainBatchEnvelope(batch)
	const previousValues = new Map<string, unknown>()
	const previousExisting = new Set<string>()
	const committedValues = new Map<string, Json.Serializable>()
	const committedExisting = new Set<string>()
	for (const address of batch.affectedMembers) {
		const parsed = await domain.parseAddress(address)
		const acquired = await domain.acquire(parsed)
		if (parsed.member.role !== `durable` || parsed.member.model === undefined) {
			throw new Error(
				`A committed Mosaic Domain snapshot must address a durable modeled member.`,
			)
		}
		const token: WritableToken<any, any, any> =
			parsed.member.model.kind === `transceiver`
				? getJsonTokenFromStore(
						domain.store,
						acquired.token as MutableAtomToken<AnyMosaicTransceiver>,
					)
				: acquired.token
		const snapshot = commit.snapshots.find(
			(candidate) => candidate.token.key === acquired.token.key,
		)
		if (
			snapshot === undefined ||
			!isJsonSerializable(snapshot.oldValue) ||
			!isJsonSerializable(snapshot.newValue)
		) {
			throw new Error(
				`A committed Mosaic Domain batch is missing an exact serializable member snapshot.`,
			)
		}
		previousValues.set(token.key, structuredClone(snapshot.oldValue))
		committedValues.set(token.key, structuredClone(snapshot.newValue))
		if (snapshot.oldExists) previousExisting.add(token.key)
		if (snapshot.newExists) committedExisting.add(token.key)
	}
	const prepared = await preflightMosaicDomainBatchWithProjection(
		domain,
		batch,
		{},
		previousValues,
		previousExisting,
	)
	const updates = preparedUpdates.get(prepared)
	if (updates === undefined) {
		throw new Error(`A committed Mosaic Domain batch lost its prepared values.`)
	}
	for (const update of updates) {
		if (!committedValues.has(update.token.key)) {
			throw new Error(
				`A committed Mosaic Domain batch is missing a member snapshot.`,
			)
		}
		const expectedExists = committedExisting.has(update.token.key)
		const matches =
			update.nextExists === expectedExists &&
			canonicalize(update.next as Json.Serializable) ===
				canonicalize(committedValues.get(update.token.key)!)
		if (!matches) {
			throw new Error(
				`A Mosaic Domain transaction encoder did not reproduce the committed value.`,
			)
		}
	}
	preparedApplied.set(prepared, true)
	return prepared
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
			do: ({ dispose, set }) => {
				const settlement = settlements.get(store)
				if (settlement === undefined) {
					throw new Error(`A Mosaic Domain settlement has no prepared values.`)
				}
				for (const update of settlement.updates) {
					const exists = update[`${settlement.which}Exists`]
					if (exists) set(update.token, update[settlement.which])
					else dispose(update.token as never)
				}
			},
		})
		settlementTransactions.set(store, transaction)
	}
	settlements.set(store, { updates, which })
	let committed = false
	const unsubscribe = store.on.transactionCommit.subscribe(
		`mosaic-domain-settlement:${transactionId}`,
		(event) => {
			if (
				event.outcome.token.key === transaction.key &&
				event.outcome.id === transactionId
			) {
				committed = true
			}
		},
	)
	try {
		try {
			actUponStore(store, transaction, transactionId)()
		} catch (error) {
			if (!committed) throw error
			store.logger.error(
				`🐞`,
				`transaction`,
				transactionId,
				`A Mosaic Domain settlement committed, but an observer threw.`,
				error,
			)
		}
	} finally {
		unsubscribe()
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
	return rebaseMosaicDomainBatches(domain, remove, [], project)
}

/**
 * Replace a confirmed hydration cut and its optimistic projection through one
 * Store transaction. All addresses and values validate before family members
 * are acquired, and no intermediate checkpoint is observable.
 */
export async function hydrateMosaicDomainBatches<
	Identity extends MosaicDomainIdentity,
>(
	domain: MosaicDomainInstance<Identity, any, any>,
	remove: readonly PreparedMosaicDomainBatch<Identity>[],
	members: readonly MosaicDomainMemberHydration<Identity>[],
	project: readonly MosaicDomainBatchProjection<Identity>[],
): Promise<readonly PreparedMosaicDomainBatch<Identity>[]> {
	return rebaseMosaicDomainBatches(domain, remove, members, project)
}

async function rebaseMosaicDomainBatches<Identity extends MosaicDomainIdentity>(
	domain: MosaicDomainInstance<Identity, any, any>,
	remove: readonly PreparedMosaicDomainBatch<Identity>[],
	members: readonly MosaicDomainMemberHydration<Identity>[],
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
	const projectedExisting = new Set<string>()
	for (const [key, update] of base) {
		projectedValues.set(key, update.previous)
		if (update.previousExists) projectedExisting.add(key)
	}

	// Parse and validate the complete checkpoint before `acquire` can expose any
	// newly materialized family member to the Store.
	const parsedHydrations: {
		readonly parsed: Awaited<ReturnType<typeof domain.parseAddress>>
		readonly value: Json.Serializable
	}[] = []
	const hydrationAddresses = new Set<string>()
	for (const hydration of members) {
		const parsed = await domain.parseAddress(hydration.address)
		if (parsed.member.role !== `durable`) {
			throw new Error(
				`Mosaic Domain member "${parsed.address.member}" is not durable.`,
			)
		}
		const addressKey = mosaicDomainMemberAddressKey(parsed.address)
		if (hydrationAddresses.has(addressKey)) {
			throw new Error(`A Mosaic Domain hydration address must be unique.`)
		}
		hydrationAddresses.add(addressKey)
		const value = await domain.validateValue(
			parsed.address.member,
			structuredClone(hydration.value),
		)
		if (!isJsonSerializable(value)) {
			throw new Error(
				`Mosaic Domain member "${parsed.address.member}" hydration is not serializable.`,
			)
		}
		parsedHydrations.push({ parsed, value })
	}
	for (const { parsed, value } of parsedHydrations) {
		const acquired = await domain.acquire(parsed)
		const memberExists =
			!(`family` in acquired.token) || domain.store.atoms.has(acquired.token.key)
		const token: WritableToken<any, any, any> =
			acquired.member.model?.kind === `transceiver`
				? getJsonTokenFromStore(
						domain.store,
						acquired.token as MutableAtomToken<AnyMosaicTransceiver>,
					)
				: (acquired.token as WritableToken<any, any, any>)
		tokens.set(token.key, token)
		projectedValues.set(token.key, structuredClone(value))
		projectedExisting.add(token.key)
		if (!base.has(token.key)) {
			base.set(token.key, {
				next: value,
				nextExists: true,
				previous: memberExists ? getFromStore(domain.store, token) : undefined,
				previousExists: memberExists,
				token,
			})
		}
	}
	const preparedProjection: PreparedMosaicDomainBatch<Identity>[] = []
	for (const item of project) {
		const prepared = await preflightMosaicDomainBatchWithProjection(
			domain,
			item.batch,
			item.revision === undefined ? {} : { revision: item.revision },
			projectedValues,
			projectedExisting,
		)
		preparedProjection.push(prepared)
		for (const update of preparedUpdates.get(prepared) ?? []) {
			tokens.set(update.token.key, update.token)
			projectedValues.set(update.token.key, update.next)
			projectedExisting.add(update.token.key)
		}
	}

	const updates: InternalUpdate[] = []
	for (const [key, token] of tokens) {
		const current = base.get(key)
		updates.push({
			next: projectedValues.has(key)
				? projectedValues.get(key)
				: base.get(key)?.previous,
			nextExists: projectedExisting.has(key),
			previous:
				current?.previousExists === false
					? current.previous
					: getFromStore(domain.store, token),
			previousExists: current?.previousExists ?? true,
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

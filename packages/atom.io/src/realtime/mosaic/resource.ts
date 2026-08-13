import type { Json } from "atom.io/foundations/json"

import type {
	MosaicModelIdentifier,
	MosaicOperationMetadata,
	MosaicResourceIdentifier,
} from "./protocol.ts"

/** Metadata available to deterministic validation and reduction. */
export type MosaicReduceContext = MosaicOperationMetadata & {
	/**
	 * The server stream order, or null for a provisional local projection. Models
	 * may use an accepted revision to canonicalize order, but never assign one.
	 */
	readonly revision: number | null
}

/** Local-only context used to translate a friendly intent into an operation. */
export type MosaicPrepareContext = MosaicOperationMetadata & {
	/** Injected clock time. It must never affect reduction of accepted operations. */
	readonly now: number
	readonly revision: null
}

export type MosaicModelDecision<Operation extends Json.Serializable> =
	| { readonly operation: Operation; readonly status: `accept` }
	| { readonly dependencies: readonly string[]; readonly status: `defer` }
	| { readonly reason: string; readonly status: `reject` }

export type MosaicModel<
	State,
	Intent extends Json.Serializable,
	Operation extends Json.Serializable,
	Snapshot extends Json.Serializable,
> = MosaicModelIdentifier & {
	readonly apply: (
		state: State,
		operation: Operation,
		context: MosaicReduceContext,
	) => State
	readonly create: () => State
	readonly hydrate: (snapshot: unknown) => State
	readonly prepare: (
		state: State,
		intent: Intent,
		context: MosaicPrepareContext,
	) => Operation | null
	readonly snapshot: (state: State) => Snapshot
	readonly validate: (
		state: State,
		operation: unknown,
		context: MosaicReduceContext,
	) => MosaicModelDecision<Operation>
}

export type AnyMosaicModel = MosaicModel<any, any, any, any>

/** Preserve inference while declaring one versioned replicated model. */
export function defineMosaicModel<
	State,
	Intent extends Json.Serializable,
	Operation extends Json.Serializable,
	Snapshot extends Json.Serializable,
>(
	model: MosaicModel<State, Intent, Operation, Snapshot>,
): MosaicModel<State, Intent, Operation, Snapshot> {
	if (model.key.length === 0)
		throw new Error(`A Mosaic model key cannot be empty`)
	if (!Number.isSafeInteger(model.version) || model.version < 1) {
		throw new Error(`A Mosaic model version must be a positive safe integer`)
	}
	return model
}

export type MosaicResource<Model extends AnyMosaicModel = AnyMosaicModel> =
	MosaicResourceIdentifier & {
		readonly model: Model
	}

/** Bind a stable resource key to the model that materializes its stream. */
export function defineMosaicResource<
	const Key extends string,
	Model extends AnyMosaicModel,
>(options: {
	readonly key: Key
	readonly model: Model
}): MosaicResource<Model> & { readonly key: Key } {
	if (options.key.length === 0) {
		throw new Error(`A Mosaic resource key cannot be empty`)
	}
	return options
}

export type MosaicState<Model> =
	Model extends MosaicModel<infer State, any, any, any> ? State : never

export type MosaicIntent<Model> =
	Model extends MosaicModel<any, infer Intent, any, any> ? Intent : never

export type MosaicOperation<Model> =
	Model extends MosaicModel<any, any, infer Operation, any> ? Operation : never

export type MosaicSnapshot<Model> =
	Model extends MosaicModel<any, any, any, infer Snapshot> ? Snapshot : never

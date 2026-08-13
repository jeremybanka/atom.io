import type { Json } from "atom.io/foundations/json"
import type { ConstructorOf, Transceiver } from "atom.io/internal"

import type {
	MosaicModelIdentifier,
	MosaicOperationMetadata,
} from "./protocol.ts"

/** Metadata available to deterministic validation and reduction. */
export type MosaicReduceContext = MosaicOperationMetadata & {
	/** The server stream order, or null for a provisional local projection. */
	readonly revision: number | null
}

/** Local-only context used to translate a friendly intent into an operation. */
export type MosaicPrepareContext = MosaicOperationMetadata & {
	/** Injected clock time. It must never affect accepted reduction semantics. */
	readonly now: number
	readonly revision: null
}

export type MosaicModelDecision<Operation extends Json.Serializable> =
	| { readonly operation: Operation; readonly status: `accept` }
	| { readonly dependencies: readonly string[]; readonly status: `defer` }
	| { readonly reason: string; readonly status: `reject` }

/**
 * The serializable signal carried by a Mosaic transceiver. The wire protocol
 * adds the mutable-atom address and model identifier around this signal.
 */
export type MosaicOperationSignal<
	Operation extends Json.Serializable = Json.Serializable,
> = MosaicReduceContext & {
	readonly operation: Operation
}

/**
 * A convergent transceiver held by an ordinary mutable atom. Its readonly view
 * participates in Atom.io's graph; synchronization remains Store-owned.
 */
export interface MosaicTransceiver<
	View extends {
		subscribe: (
			key: string,
			fn: (signal: MosaicOperationSignal<Operation>) => void,
		) => () => void
	},
	Intent extends Json.Serializable,
	Operation extends Json.Serializable,
	Snapshot extends Json.Serializable,
> extends Transceiver<View, MosaicOperationSignal<Operation>, Snapshot> {
	/** Prepare, apply, and publish one provisional local operation. */
	change(
		intent: Intent,
		context: MosaicPrepareContext,
	): MosaicOperationSignal<Operation> | null
	/** Validate and normalize an untrusted operation against this projection. */
	validate(
		operation: unknown,
		context: MosaicReduceContext,
	): MosaicModelDecision<Operation>
}

export type AnyMosaicTransceiver = MosaicTransceiver<any, any, any, any>

/** A mutable-atom-compatible constructor for one versioned Mosaic model. */
export type MosaicTransceiverConstructor<
	TransceiverType extends AnyMosaicTransceiver = AnyMosaicTransceiver,
> = ConstructorOf<TransceiverType> & {
	readonly mosaic: MosaicModelIdentifier
	readonly timelinePolicy: `append-only`
}

export type MosaicView<TransceiverType> =
	TransceiverType extends MosaicTransceiver<infer View, any, any, any>
		? View
		: never

export type MosaicIntent<TransceiverType> =
	TransceiverType extends MosaicTransceiver<any, infer Intent, any, any>
		? Intent
		: never

export type MosaicOperation<TransceiverType> =
	TransceiverType extends MosaicTransceiver<any, any, infer Operation, any>
		? Operation
		: never

export type MosaicSnapshot<TransceiverType> =
	TransceiverType extends MosaicTransceiver<any, any, any, infer Snapshot>
		? Snapshot
		: never

export type MosaicSignal<TransceiverType> = MosaicOperationSignal<
	MosaicOperation<TransceiverType>
>

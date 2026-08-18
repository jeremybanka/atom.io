import type { Json } from "atom.io/foundations/json"

import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "./mosaic-domain.ts"
import type { MosaicAcceptedDomainBatchEnvelope } from "./mosaic-domain-batch.ts"

/** Protocol version for the immutable Mosaic Domain checkpoint graph. */
export const MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION = 1 as const

/** A content-addressed, storage-stable checkpoint object key. */
export type MosaicDomainCheckpointObjectKey = `sha256:${string}`

/** A bounded leaf or branch in a persistent content-addressed directory. */
export type MosaicDomainCheckpointDirectoryNode =
	| {
			readonly depth: number
			readonly entries: readonly {
				readonly key: string
				readonly value: MosaicDomainCheckpointObjectKey
			}[]
			readonly kind: `directory-leaf`
	  }
	| {
			readonly children: readonly {
				readonly segment: string
				readonly value: MosaicDomainCheckpointObjectKey
			}[]
			readonly depth: number
			readonly kind: `directory-branch`
	  }

/** One immutable durable-member version. */
export type MosaicDomainCheckpointMember<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly kind: `member`
	readonly revision: number
	readonly value: Json.Serializable
}

/** One immutable application index-path version. */
export type MosaicDomainCheckpointIndex = {
	readonly index: string
	readonly kind: `index`
	readonly path: string
	readonly revision: number
	readonly value: Json.Serializable
}

/**
 * The small atomic root of a checkpoint graph. Member and application-index
 * directories are persistent bounded tries, so unchanged subtrees are shared.
 */
export type MosaicDomainCheckpointRoot<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly domain: Identity
	readonly indexDirectory: MosaicDomainCheckpointObjectKey | null
	readonly kind: `root`
	readonly memberDirectory: MosaicDomainCheckpointObjectKey | null
	readonly protocolVersion: typeof MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION
	readonly retentionEpoch: number
	readonly revision: number
}

export type MosaicDomainCheckpointObject<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> =
	| MosaicDomainCheckpointDirectoryNode
	| MosaicDomainCheckpointIndex
	| MosaicDomainCheckpointMember<Identity>
	| MosaicDomainCheckpointRoot<Identity>

/** A requested-member recovery cut followed by its contiguous accepted tail. */
export type MosaicDomainCheckpointRecovery<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly headRevision: number
	readonly members: readonly MosaicDomainCheckpointMember<Identity>[]
	readonly root: MosaicDomainCheckpointRoot<Identity>
	readonly rootKey: MosaicDomainCheckpointObjectKey
	readonly tail: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[]
}

/** A named liveness constraint used by safe checkpoint and tail reclamation. */
export type MosaicDomainCheckpointRetentionLease = {
	readonly id: string
	readonly kind: `history` | `outbox` | `proposal` | `session`
	readonly minimumRevision: number
	readonly rootKeys?: readonly MosaicDomainCheckpointObjectKey[]
}

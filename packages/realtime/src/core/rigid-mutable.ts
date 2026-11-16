import type { Clock } from "./clock.ts"
import type { StandardSchemaV1 } from "./standard-schema.ts"

export type RigidMutableStatus = {
	readonly status: `hydrating` | `live` | `revoked` | `failed`
	readonly epoch: string | null
	readonly revision: number | null
}
export type VersionedMutablePullOptions<Snapshot, Signal> = {
	readonly snapshotSchema: StandardSchemaV1<unknown, Snapshot>
	readonly signalSchema: StandardSchemaV1<unknown, Signal>
	readonly onStatus?: (status: RigidMutableStatus) => void
	readonly maxPendingMessages?: number
	readonly maxMessageBytes?: number
	readonly clock?: Clock
}

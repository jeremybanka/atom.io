import type {
	ReadableToken,
	TimelineEvent,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import type {
	EcologyFamily,
	EcologyNode,
	EcologyOperation,
	EcologyOperations,
	EcologySnapshot,
} from "./ecology.ts"

export type RemotePrimitive = boolean | number | string | null
export const REMOTE_PROTOCOL_VERSION = 1

export type RemoteState = {
	key: string
	kind: `atom` | `selector`
	editable: boolean
	revision: number
} & ({ value: RemotePrimitive } | { error: string })

export type RemoteMessage =
	| {
			type: `snapshot`
			version: number
			control: boolean
			states: RemoteState[]
	  }
	| { type: `snapshot-update`; sequence: number; states: RemoteState[] }
	| { type: `store`; version: number; snapshot: RemoteStoreSnapshot }
	| { type: `store-update`; sequence: number; update: RemoteStoreUpdate }
	| { type: `edit-error`; message: string }
	| { type: `close` }

export type PanelMessage =
	| { type: `edit`; key: string; revision: number | undefined; value: unknown }
	| ({ type: `generate` } & RemoteGenerate)
	| ({ type: `release` } & RemoteRelease)
	| {
			type: `state-requests`
			generate: RemoteGenerate[]
			release: RemoteRelease[]
	  }
	| { type: `dispose`; key: string }
	| {
			type: `timeline`
			key: string
			action: `undo` | `redo`
			revision: number | undefined
	  }
	| { type: `close` }

export type RemoteGenerate = { key: string; watch?: number }
export type RemoteRelease = { key: string; watch: number }
export type RemoteCachedValue =
	| { status: `uncached` }
	| { status: `value`; value: unknown }
export type RemoteStateToken = ReadableToken<unknown, any, any>
type TransactionHistory = TransactionOutcomeEvent<TransactionToken<any>>
type TimelineHistory = TimelineEvent<any>
type StoreState = {
	token: RemoteStateToken
	cache: RemoteCachedValue
	revision: number
	editable: boolean
}
type StoreTransaction<History> = {
	token: TransactionToken<any>
	history: History
}
type StoreTimeline<History> = {
	token: TimelineToken<any>
	at: number
	revision: number
	history: History
}
export interface RemoteStoreSnapshot {
	control: boolean
	states: StoreState[]
	transactions: StoreTransaction<TransactionHistory[]>[]
	timelines: StoreTimeline<TimelineHistory[]>[]
	ecology: EcologySnapshot
}

/** Retain a slice of the previous history and append newly arrived records. */
export type RemoteHistoryUpdate<Event> = {
	start: number
	length: number
	append: Event[]
}
export type RemoteEcologyEdge = EcologySnapshot[`edges`][number]
type RemoteEcologyMetadata = Pick<EcologySnapshot, `truncated` | `work`>
export type RemoteRecordsUpdate<Record> = { upsert: Record[]; remove: string[] }
export type RemoteEcologyUpdate = {
	nodes: RemoteRecordsUpdate<EcologyNode>
	edges?: RemoteRecordsUpdate<RemoteEcologyEdge>
	families?: RemoteRecordsUpdate<EcologyFamily>
	operations?: RemoteRecordsUpdate<EcologyOperation> &
		Omit<EcologyOperations, `records`>
	metadata?: RemoteEcologyMetadata
}
export interface RemoteStoreUpdate {
	states: StoreState[]
	removedStates: string[]
	transactions: StoreTransaction<RemoteHistoryUpdate<TransactionHistory>>[]
	timelines: StoreTimeline<RemoteHistoryUpdate<TimelineHistory>>[]
	removedTimelines: string[]
	ecology?: RemoteEcologyUpdate
}

export function isRemotePrimitive(value: unknown): value is RemotePrimitive {
	return (
		value === null ||
		typeof value === `string` ||
		typeof value === `boolean` ||
		(typeof value === `number` && Number.isFinite(value))
	)
}

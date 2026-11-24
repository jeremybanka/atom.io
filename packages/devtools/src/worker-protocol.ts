import type {
	ReadableToken,
	TimelineEvent,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import type { EcologyFamily, EcologyNode, EcologySnapshot } from "./ecology.ts"

export type WorkerDevtoolsValue = boolean | number | string | null

export type WorkerState = {
	key: string
	kind: `atom` | `selector`
	editable: boolean
	revision: number
} & ({ value: WorkerDevtoolsValue } | { error: string })

export type WorkerMessage =
	| { type: `snapshot`; control: boolean; states: WorkerState[] }
	| { type: `snapshot-update`; states: WorkerState[] }
	| { type: `store`; snapshot: WorkerStoreSnapshot }
	| { type: `store-update`; update: WorkerStoreUpdate }
	| { type: `edit-error`; message: string }
	| { type: `close` }

export type PanelMessage =
	| { type: `edit`; key: string; revision: number | undefined; value: unknown }
	| ({ type: `generate` } & WorkerGenerate)
	| ({ type: `release` } & WorkerRelease)
	| {
			type: `state-requests`
			generate: WorkerGenerate[]
			release: WorkerRelease[]
	  }
	| { type: `dispose`; key: string }
	| {
			type: `timeline`
			key: string
			action: `undo` | `redo`
			revision: number | undefined
	  }
	| { type: `close` }

export type WorkerGenerate = { key: string; watch?: number }
export type WorkerRelease = { key: string; watch: number }
export type WorkerCachedValue =
	| { status: `uncached` }
	| { status: `value`; value: unknown }
export type WorkerStateToken = ReadableToken<unknown, any, any>
type TransactionHistory = TransactionOutcomeEvent<TransactionToken<any>>
type TimelineHistory = TimelineEvent<any>
type StoreState = {
	token: WorkerStateToken
	cache: WorkerCachedValue
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
export interface WorkerStoreSnapshot {
	control: boolean
	states: StoreState[]
	transactions: StoreTransaction<TransactionHistory[]>[]
	timelines: StoreTimeline<TimelineHistory[]>[]
	ecology: EcologySnapshot
}

/** Retain a slice of the previous history and append newly arrived records. */
export type WorkerHistoryUpdate<Event> = {
	start: number
	length: number
	append: Event[]
}
export type WorkerEcologyEdge = EcologySnapshot[`edges`][number]
export type WorkerEcologyMetadata = Pick<EcologySnapshot, `truncated` | `work`>
export type WorkerRecordsUpdate<Record> = { upsert: Record[]; remove: string[] }
export type WorkerEcologyUpdate = {
	nodes: WorkerRecordsUpdate<EcologyNode>
	edges?: WorkerRecordsUpdate<WorkerEcologyEdge>
	families?: WorkerRecordsUpdate<EcologyFamily>
	metadata?: WorkerEcologyMetadata
}
export interface WorkerStoreUpdate {
	states: StoreState[]
	removedStates: string[]
	transactions: StoreTransaction<WorkerHistoryUpdate<TransactionHistory>>[]
	timelines: StoreTimeline<WorkerHistoryUpdate<TimelineHistory>>[]
	removedTimelines: string[]
	ecology?: WorkerEcologyUpdate
}

export function isWorkerDevtoolsValue(
	value: unknown,
): value is WorkerDevtoolsValue {
	return (
		value === null ||
		typeof value === `string` ||
		typeof value === `boolean` ||
		(typeof value === `number` && Number.isFinite(value))
	)
}

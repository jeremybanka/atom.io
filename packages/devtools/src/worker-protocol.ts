import type {
	ReadableToken,
	TimelineEvent,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import type { EcologySnapshot } from "./ecology.ts"
import type { RecordedEvent } from "./history-event.ts"

export type WorkerDevtoolsValue = boolean | number | string | null

type WorkerState = {
	key: string
	kind: `atom` | `selector`
	editable: boolean
	revision: number
} & ({ value: WorkerDevtoolsValue } | { error: string })

export type WorkerMessage =
	| { type: `snapshot`; control: boolean; states: WorkerState[] }
	| { type: `store`; snapshot: WorkerStoreSnapshot }
	| { type: `edit-error`; message: string }
	| { type: `close` }

export type PanelMessage =
	| { type: `edit`; key: string; revision: number | undefined; value: unknown }
	| { type: `generate` | `dispose`; key: string }
	| {
			type: `timeline`
			key: string
			action: `undo` | `redo`
			revision: number | undefined
	  }
	| { type: `close` }

export type WorkerCachedValue =
	| { status: `uncached` }
	| { status: `value`; value: unknown }
export type WorkerStateToken = ReadableToken<unknown, any, any>
export type WorkerHistory<Event = RecordedEvent> = { id: string; event: Event }
export interface WorkerStoreSnapshot {
	control: boolean
	states: {
		token: WorkerStateToken
		cache: WorkerCachedValue
		revision: number
		editable: boolean
	}[]
	transactions: {
		token: TransactionToken<any>
		history: WorkerHistory<TransactionOutcomeEvent<TransactionToken<any>>>[]
	}[]
	timelines: {
		token: TimelineToken<any>
		at: number
		revision: number
		history: WorkerHistory<TimelineEvent<any>>[]
	}[]
	ecology: EcologySnapshot
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

export type WorkerDevtoolsValue = boolean | number | string | null

type WorkerState = {
	key: string
	kind: `atom` | `selector`
	editable: boolean
	revision: number
} & ({ value: WorkerDevtoolsValue } | { error: string })

export type WorkerMessage =
	| { type: `snapshot`; states: WorkerState[] }
	| { type: `edit-error`; message: string }
	| { type: `close` }

export type PanelMessage =
	| { type: `edit`; key: string; revision: number | undefined; value: unknown }
	| { type: `close` }

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

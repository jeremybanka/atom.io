import type {
	RealtimeRequestResult,
	RealtimeSubmission,
	RealtimeSubmissionState,
} from "@atom.io/realtime"

type SubmissionUpdate<Value, Rejection> =
	| { readonly status: `queued` | `sending` | `offline` }
	| RealtimeRequestResult<Value, Rejection>
export type RealtimeSubmissionController<Identity, Value, Rejection> = {
	readonly receipt: RealtimeSubmission<Identity, Value, Rejection>
	update(next: SubmissionUpdate<Value, Rejection>): void
}

/** @internal The owning client keeps only unresolved receipts. */
export function createRealtimeSubmission<Identity, Value, Rejection>(
	identity: Identity,
	onListenerError: (error: unknown) => void,
): RealtimeSubmissionController<Identity, Value, Rejection> {
	type State = RealtimeSubmissionState<Identity, Value, Rejection>
	type Result = Identity & RealtimeRequestResult<Value, Rejection>
	const listeners = new Set<(state: State) => void>()
	let state: State = Object.freeze({ ...identity, status: `queued` as const })
	let complete = false
	let resolve!: (value: Result) => void
	const promise = new Promise<Result>((finish) => {
		resolve = finish
	})
	const notify = (listener: (state: State) => void): void => {
		try {
			listener(state)
		} catch (error) {
			onListenerError(error)
		}
	}
	const receipt: RealtimeSubmission<Identity, Value, Rejection> = Object.freeze({
		identity,
		get state() {
			return state
		},
		settled: promise,
		subscribe(listener: (state: State) => void) {
			if (!complete) listeners.add(listener)
			notify(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	})
	return {
		receipt,
		update(
			next:
				| { readonly status: `queued` | `sending` | `offline` }
				| RealtimeRequestResult<Value, Rejection>,
		) {
			if (complete) return
			state = Object.freeze({ ...identity, ...next })
			complete =
				next.status !== `queued` &&
				next.status !== `sending` &&
				next.status !== `offline`
			if (complete) resolve(state as Result)
			for (const listener of [...listeners]) notify(listener)
			if (complete) listeners.clear()
		},
	}
}

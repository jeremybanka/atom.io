import type {
	RealtimeSubmission,
	RealtimeSubmissionState,
} from "@atom.io/realtime"
import type {
	MosaicDomainBatchClient,
	MosaicDomainBatchClientState,
} from "@atom.io/realtime/client"
import { useCallback, useSyncExternalStore } from "react"

/** Observe one receipt; reconnects and other submissions cannot replace its result. */
export function useRealtimeSubmission<Identity, Value, Rejection>(
	submission: RealtimeSubmission<Identity, Value, Rejection>,
): RealtimeSubmissionState<Identity, Value, Rejection> {
	const subscribe = useCallback(
		(notify: () => void) => submission.subscribe(notify),
		[submission],
	)
	const snapshot = useCallback(() => submission.state, [submission])
	return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Aggregate connection/recovery, pending, and error state; use receipts for individual edits. */
export function useMosaicDomainBatchClientState(
	client: MosaicDomainBatchClient,
): MosaicDomainBatchClientState {
	const subscribe = useCallback(
		(notify: () => void) => client.subscribe(notify),
		[client],
	)
	const snapshot = useCallback(() => client.state, [client])
	return useSyncExternalStore(subscribe, snapshot, snapshot)
}

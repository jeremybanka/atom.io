import type {
	MosaicDomainBatchClient,
	MosaicDomainBatchSubmission,
} from "@atom.io/realtime/client"
import {
	useMosaicDomainBatchClientState,
	useRealtimeSubmission,
} from "@atom.io/realtime/react"
import type { ReactNode } from "react"

export function SubmissionStatus({
	submission,
}: {
	submission: MosaicDomainBatchSubmission
}): ReactNode {
	const state = useRealtimeSubmission(submission)
	switch (state.status) {
		case `accepted`:
			return `Saved at revision ${state.value.revision}`
		case `rejected`:
			return state.rejection.reason
		case `interrupted`:
			return `Outcome unknown; recover before repeating this edit.`
		case `superseded`:
			return `Replaced by ${state.supersededBy}`
		case `offline`:
		case `queued`:
		case `sending`:
			return state.status
	}
}

export function ConnectionStatus({
	client,
}: {
	client: MosaicDomainBatchClient
}): ReactNode {
	const state = useMosaicDomainBatchClientState(client)
	return `${state.status}: ${state.pendingBatchIds.length} pending edits`
}

/** Correlation is independent of transport delivery and aggregate client status. */
export type RealtimeRequestIdentity<Resource> = {
	readonly requestId: string
	readonly session: string
	readonly resource: Resource
}

export type RealtimeRequestResult<Value, Rejection> =
	| { readonly status: `accepted`; readonly value: Value }
	| {
			readonly status: `rejected`
			readonly rejection: Rejection
			readonly retryable: boolean
	  }
	| { readonly status: `superseded`; readonly supersededBy: string }
	| {
			readonly status: `interrupted`
			readonly reason: `disposed` | `invalid-response`
			readonly recovery: `resnapshot`
	  }

export type RealtimeSubmissionState<Identity, Value, Rejection> = Identity &
	(
		| { readonly status: `queued` | `sending` | `offline` }
		| RealtimeRequestResult<Value, Rejection>
	)

/** A caller-owned receipt. Terminal results never change and never reject. */
export type RealtimeSubmission<Identity, Value, Rejection> = {
	readonly identity: Identity
	readonly state: RealtimeSubmissionState<Identity, Value, Rejection>
	readonly settled: Promise<Identity & RealtimeRequestResult<Value, Rejection>>
	subscribe(
		listener: (
			state: RealtimeSubmissionState<Identity, Value, Rejection>,
		) => void,
	): () => void
}

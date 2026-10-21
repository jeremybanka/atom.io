import type { AtomFamilyToken } from "atom.io"
import { atomFamily } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

export type RealtimeLeaseStatus =
	| { state: `idle` }
	| { state: `waiting`; position: number }
	| {
			expiresAt: number
			generation: number
			leaseId: string
			renewAfterMs: number
			state: `owned`
	  }
	| {
			generation: number
			reason: `expired` | `released` | `stale`
			state: `released`
	  }

export const mutexAtoms: AtomFamilyToken<boolean, Canonical> = atomFamily({
	key: `mutex`,
	default: false,
})

/** Detailed ownership state for a realtime push lease. */
export const realtimeLeaseAtoms: AtomFamilyToken<
	RealtimeLeaseStatus,
	Canonical
> = atomFamily({
	key: `realtimeLease`,
	default: { state: `idle` },
})

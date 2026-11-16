import type { Json } from "atom.io/foundations/json"

/** Complete snapshots may skip revisions; deltas may not use this protocol. */
export type RigidSnapshot<Value extends Json.Serializable> = {
	readonly epoch: string
	readonly revision: number
	readonly value: Value
}
export type RigidLease = {
	readonly generation: number
	readonly expiresAt: number
	readonly renewAfterMs: number
}
export type RigidProblem = {
	readonly code:
		| `conflict`
		| `invalid`
		| `unauthorized`
		| `lease-lost`
		| `unavailable`
	readonly reason: string
}
export type RigidWriteResult<Value extends Json.Serializable> =
	| { readonly status: `accepted`; readonly snapshot: RigidSnapshot<Value> }
	| { readonly status: `rejected`; readonly problem: RigidProblem }
	| { readonly status: `interrupted`; readonly outcome: `unknown` }
export type RigidState<Value extends Json.Serializable> = {
	readonly status:
		| `disconnected`
		| `hydrating`
		| `readonly`
		| `waiting`
		| `writable`
		| `revoked`
		| `failed`
	readonly snapshot: RigidSnapshot<Value> | null
	readonly lease: RigidLease | null
	readonly problem: RigidProblem | null
	readonly pending: number
}

/** Internal wire discriminator shared by both ends of the versioned service. */
export const rigidEvents = (
	resource: string,
): { request: string; response: string } => ({
	request: `rigid:request:${resource}`,
	response: `rigid:response:${resource}`,
})
export const isRigidRecord = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)
export const isRigidRevision = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0

export const VECTOR_BATCH_EVENTS = {
	accepted: `vector-domain:batch:accepted`,
	propose: `vector-domain:batch:propose`,
	recover: `vector-domain:batch:recover`,
} as const

export const VECTOR_RESIDENCY_EVENTS = {
	accepted: `vector-residency:accepted`,
	hydrate: `vector-residency:hydrate`,
	propose: `vector-residency:propose`,
	subscribe: `vector-residency:subscribe`,
	unsubscribe: `vector-residency:unsubscribe`,
} as const

export type VectorAcknowledgement<Value> =
	| { readonly ok: true; readonly value: Value }
	| { readonly ok: false; readonly reason: string }

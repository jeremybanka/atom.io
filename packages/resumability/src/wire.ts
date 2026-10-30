import type { Encoded, Json, Payload } from "./types.ts"

/** Reject values JSON would silently change; codecs handle richer types. */
export function encode(value: unknown): Encoded {
	if (value === undefined) return [0]
	const ancestors = new Set<object>()
	function validate(item: unknown): void {
		if (item === null || typeof item === `string` || typeof item === `boolean`)
			return
		if (
			typeof item === `number` &&
			Number.isFinite(item) &&
			!Object.is(item, -0)
		)
			return
		if (typeof item !== `object` || ancestors.has(item))
			throw new TypeError(`resumable: value needs a JSON codec`)
		const proto = Object.getPrototypeOf(item)
		if (!Array.isArray(item) && proto !== Object.prototype && proto !== null)
			throw new TypeError(`resumable: value needs a JSON codec`)
		if (Reflect.ownKeys(item).some((key) => typeof key === `symbol`))
			throw new TypeError(`resumable: symbol properties need a codec`)
		ancestors.add(item)
		for (const entry of Array.isArray(item)
			? Array.from(item)
			: Object.values(item))
			validate(entry)
		ancestors.delete(item)
	}
	validate(value)
	return [1, JSON.parse(JSON.stringify(value)) as Json]
}
export function serialize(payload: Payload): string {
	return JSON.stringify(payload).replaceAll(`<`, `\\u003c`)
}

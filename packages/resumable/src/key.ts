import type { Key } from "./types.ts"

export function keyOf(key: Key): string {
	const valid = (part: Key): boolean =>
		part === null ||
		typeof part === `string` ||
		typeof part === `boolean` ||
		(typeof part === `number` &&
			Number.isFinite(part) &&
			!Object.is(part, -0)) ||
		(Array.isArray(part) && Array.from(part).every(valid))
	if (!valid(key)) throw new TypeError(`resumable: invalid key`)
	return JSON.stringify(key)
}

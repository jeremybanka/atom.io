export type Change = (update: (previous: unknown) => unknown) => void
export type JsonKind =
	| `string`
	| `number`
	| `boolean`
	| `null`
	| `array`
	| `object`
export function kind(value: unknown): JsonKind | `other` {
	if (value === null) return `null`
	if (Array.isArray(value)) return `array`
	if (
		typeof value === `object` &&
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
	)
		return `object`
	if (
		typeof value === `string` ||
		typeof value === `number` ||
		typeof value === `boolean`
	)
		return typeof value as JsonKind
	return `other`
}
export function describe(value: unknown): string {
	try {
		const seen = new WeakSet<object>()
		return (
			JSON.stringify(value, (_, item: unknown) => {
				if (typeof item === `bigint`) return `${item}n`
				if (item instanceof Error) return `${item.name}: ${item.message}`
				if (item instanceof Map) return { Map: [...item] }
				if (item instanceof Set) return { Set: [...item] }
				if (typeof item === `object` && item !== null) {
					if (seen.has(item)) return `[Circular]`
					seen.add(item)
				}
				return item
			}) ?? String(value)
		)
	} catch {
		return Object.prototype.toString.call(value)
	}
}
export function convert(value: unknown, type: JsonKind): unknown {
	switch (type) {
		case `null`:
			return null
		case `string`:
			return value == null
				? ``
				: typeof value === `string`
					? value
					: describe(value)
		case `number`: {
			const next = Array.isArray(value) ? value.length : Number(value)
			return Number.isFinite(next) ? next : 0
		}
		case `boolean`:
			return typeof value === `string` ? value === `true` : Boolean(value)
		case `array`:
			return Array.isArray(value)
				? value
				: value == null
					? []
					: typeof value === `object`
						? Object.entries(value)
						: [value]
		case `object`:
			return kind(value) === `object`
				? value
				: Array.isArray(value)
					? Object.fromEntries(value.map((item, index) => [index, item]))
					: value == null
						? {}
						: { value }
	}
}

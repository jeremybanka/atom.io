export type Change = (update: (previous: unknown) => unknown) => void
export type JsonKind =
	| `string`
	| `number`
	| `boolean`
	| `null`
	| `array`
	| `object`

/** A bounded cache preview: never enumerate objects, invoke getters/toJSON, or coerce objects. */
export function preview(value: unknown): string {
	if (value === null) return `null`
	if (typeof value === `object`) {
		try {
			return Array.isArray(value) ? `[…]` : `{…}`
		} catch {
			return `<?>`
		}
	}
	if (typeof value === `function`) return `ƒ`
	let text: string
	if (typeof value === `string`) text = JSON.stringify(value.slice(0, 60))
	else if (typeof value === `bigint`) text = `${value}n`
	else if (typeof value === `symbol`) text = String(value)
	else if (typeof value === `number`) text = String(value)
	else if (typeof value === `boolean`) return value ? `true` : `false`
	else return `undefined`
	return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, `size`)!.get!
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, `size`)!.get!

/** Rich previews belong to painted cards. Snapshot capture uses the shallow preview above. */
export function cardValuePreview(value: unknown): string {
	if (
		value === null ||
		(typeof value !== `object` && typeof value !== `function`)
	)
		return preview(value)
	try {
		const prototype: unknown = Object.getPrototypeOf(value)
		let current: unknown = value
		for (let depth = 0; current !== null && depth < 16; depth++) {
			const method = Object.getOwnPropertyDescriptor(current, `toString`)
			if (method) {
				if (
					current !== Object.prototype &&
					current !== Array.prototype &&
					current !== Function.prototype &&
					current !== Error.prototype &&
					typeof method.value === `function`
				) {
					try {
						const text: unknown = Reflect.apply(method.value, value, [])
						if (typeof text === `string`)
							return text.length > 60 ? `${text.slice(0, 59)}…` : text
					} catch {
						// Keep the structural preview if the formatter fails.
					}
				}
				break
			}
			current = current === value ? prototype : Object.getPrototypeOf(current)
		}
		if (Array.isArray(value))
			return `[…${Object.getOwnPropertyDescriptor(value, `length`)!.value}]`
		if (value instanceof Map) return `Map(${Reflect.apply(mapSize, value, [])})`
		if (value instanceof Set) return `Set(${Reflect.apply(setSize, value, [])})`
		if (prototype !== Object.prototype && prototype !== null) {
			const constructor: unknown = Object.getOwnPropertyDescriptor(
				prototype,
				`constructor`,
			)?.value
			const name: unknown =
				typeof constructor === `function`
					? Object.getOwnPropertyDescriptor(constructor, `name`)?.value
					: undefined
			if (typeof name === `string` && name) return name.slice(0, 60)
		}
	} catch {
		// Proxies and unfamiliar native wrappers can reject reflective inspection.
	}
	return preview(value)
}

/** Coarse cached shapes need no prototype inspection; opening children is an explicit action. */
export function shallowKind(value: unknown): JsonKind | `other` {
	if (value === null) return `null`
	if (typeof value === `object`) {
		try {
			return Array.isArray(value) ? `array` : `object`
		} catch {
			return `other`
		}
	}
	return typeof value === `string` ||
		typeof value === `number` ||
		typeof value === `boolean`
		? (typeof value as JsonKind)
		: `other`
}
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

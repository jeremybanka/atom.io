import { historyValue } from "./history-event.ts"

const limit = 32
const accessor = Symbol(`recorded accessor`)
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, `size`)!.get!
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, `size`)!.get!

type Slot = { value: unknown }
type Collection = {
	kind: `Array` | `Object` | `Map` | `Set`
	size?: number
	keys: unknown[]
	truncated: boolean
	read(key: unknown): Slot | undefined
}

function property(
	value: object,
	key: PropertyKey,
	enumerable: boolean,
): Slot | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key)
	if (!descriptor || (enumerable && !descriptor.enumerable)) return undefined
	return { value: `value` in descriptor ? descriptor.value : accessor }
}

function indices(from: number, to: number): number[] {
	return Array.from({ length: to - from }, (_, index) => from + index)
}

/** Inspect the recorded value on demand using own data properties or native collection methods. */
function collection(value: unknown): Collection | undefined {
	if (value === null || typeof value !== `object`) return undefined
	if (Array.isArray(value)) {
		const size = Object.getOwnPropertyDescriptor(value, `length`)
			?.value as number
		if (typeof size !== `number` || !Number.isSafeInteger(size) || size < 0)
			return undefined
		return {
			kind: `Array`,
			size,
			keys: indices(0, Math.min(size, limit)),
			truncated: size > limit,
			read: (key) => property(value, key as number, false),
		}
	}
	const prototype: unknown = Object.getPrototypeOf(value)
	if (prototype === Object.prototype || prototype === null) {
		const keys = Reflect.ownKeys(value)
		return {
			kind: `Object`,
			keys: keys.slice(0, limit),
			truncated: keys.length > limit,
			read: (key) => property(value, key as PropertyKey, true),
		}
	}
	const map = value instanceof Map
	if (!map && !(value instanceof Set)) return undefined
	const size = Reflect.apply(map ? mapSize : setSize, value, []) as number
	const keys: unknown[] = []
	const items: Iterable<unknown> = map
		? Map.prototype.keys.call(value)
		: Set.prototype.values.call(value)
	for (const key of items) {
		if (keys.length === limit) break
		keys.push(key)
	}
	const read = (key: unknown): Slot | undefined => {
		if (map)
			return Map.prototype.has.call(value, key)
				? { value: Map.prototype.get.call(value, key) }
				: undefined
		return Set.prototype.has.call(value, key) ? { value: key } : undefined
	}
	return { kind: map ? `Map` : `Set`, size, keys, truncated: size > limit, read }
}

type Description = { text: string; complete: boolean; truncated: boolean }

function describe(value: unknown, expanded: boolean): Description {
	const path = new Set<unknown>()
	let budget = expanded ? 96 : 12
	let complete = true
	let truncated = false
	const shorten = (text: string) => {
		complete = false
		return text
	}
	const omit = (text: string) => {
		truncated = true
		return shorten(text)
	}
	function visit(item: unknown, depth: number): string {
		if (budget-- <= 0) return omit(`…`)
		if (item === accessor) return shorten(`[accessor]`)
		if (Object.is(item, -0)) return `-0`
		if (typeof item === `bigint`) return `${item}n`
		if (typeof item === `symbol`) return String(item)
		const stringLimit = expanded ? (depth === 0 ? 16_384 : 1024) : 120
		const primitive = historyValue(item, stringLimit)
		if (primitive !== undefined)
			return typeof item === `string` && item.length > stringLimit
				? omit(primitive)
				: primitive
		if (path.has(item)) return shorten(`[circular]`)
		try {
			if (item instanceof Date) {
				const time = Date.prototype.getTime.call(item)
				return Number.isNaN(time)
					? `Invalid Date`
					: `Date(${Date.prototype.toISOString.call(item)})`
			}
			const shape = collection(item)
			if (!shape) return shorten(`[opaque]`)
			if (depth >= (expanded ? 3 : 2)) return omit(`${shape.kind}(…)`)
			path.add(item)
			const maximum = expanded ? limit : 4
			const parts = []
			for (const key of shape.keys.slice(0, maximum)) {
				const entry = shape.read(key)
				if (shape.kind === `Array`)
					parts.push(entry ? visit(entry.value, depth + 1) : `<empty>`)
				else if (entry) {
					const text = visit(entry.value, depth + 1)
					parts.push(
						shape.kind === `Set` ? text : `${visit(key, depth + 1)}: ${text}`,
					)
				}
			}
			if (shape.truncated || shape.keys.length > maximum) parts.push(omit(`…`))
			const text = parts.join(`, `)
			if (shape.kind === `Array`) return `[${text}]`
			if (shape.kind === `Object`) return `{${text}}`
			return `${shape.kind}(${shape.size}) {${text}}`
		} catch {
			return shorten(`[opaque]`)
		} finally {
			path.delete(item)
		}
	}
	const text = visit(value, 0)
	return { text, complete, truncated }
}

export function describeOutcomeValue(
	value: unknown,
	expanded = false,
): Description {
	return describe(value, expanded)
}

export type HistoryEntryChange = {
	label: string
	before?: Slot | undefined
	after?: Slot | undefined
}

export type HistoryCollectionChange = {
	kind: Collection[`kind`]
	beforeSize: number | undefined
	afterSize: number | undefined
	entries: HistoryEntryChange[]
	truncated: boolean
}

export function historyCollectionChanges(
	previous: unknown,
	next: unknown,
): HistoryCollectionChange | undefined {
	try {
		const before = collection(previous),
			after = collection(next)
		if (!before || !after || before.kind !== after.kind) return undefined
		const keys = new Set([...before.keys, ...after.keys])
		if (before.kind === `Array` && before.size !== after.size) {
			const low = Math.max(limit, Math.min(before.size!, after.size!))
			const high = Math.max(before.size!, after.size!)
			for (const index of indices(low, Math.max(low, Math.min(high, low + 8))))
				keys.add(index)
		}
		const entries: HistoryEntryChange[] = []
		for (const key of keys) {
			const old = before.read(key),
				current = after.read(key)
			if (!old && !current) continue
			if (old && current) {
				if (Object.is(old.value, current.value)) continue
				if (typeof old.value === `object` && typeof current.value === `object`) {
					const a = describe(old.value, false),
						b = describe(current.value, false)
					if (a.complete && b.complete && a.text === b.text) continue
				}
			}
			const label =
				before.kind === `Array`
					? `[${key as number}]`
					: before.kind === `Object`
						? String(key)
						: before.kind === `Map`
							? describeOutcomeValue(key).text
							: ``
			entries.push({ label, before: old, after: current })
		}
		return {
			kind: before.kind,
			beforeSize: before.size,
			afterSize: after.size,
			entries,
			truncated: before.truncated || after.truncated,
		}
	} catch {
		return undefined
	}
}

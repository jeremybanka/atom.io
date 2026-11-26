import { historyValue } from "./history-event.ts"

const limit = 32
const comparisonLimit = 4096
const accessor = Symbol(`recorded accessor`)
const empty = Symbol(`array hole`)
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

function recordKey(key: unknown): string {
	const name = String(key)
	if (typeof key === `symbol` || /^[a-zA-Z_$][\w$]*$/.test(name)) return name
	return JSON.stringify(name)
}

function indices(from: number, to: number): number[] {
	return Array.from({ length: to - from }, (_, index) => from + index)
}

/** Inspect the recorded value on demand using own data properties or native collection methods. */
function collection(value: unknown, scanMap = false): Collection | undefined {
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
			read: (key) => {
				const index = key as number
				if (index < size)
					return property(value, index, false) ?? { value: empty }
			},
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
	const maxKeys = map && scanMap ? comparisonLimit : limit
	const keys: unknown[] = []
	const items: Iterable<unknown> = map
		? Map.prototype.keys.call(value)
		: Set.prototype.values.call(value)
	for (const key of items) {
		if (keys.length === maxKeys) break
		keys.push(key)
	}
	const read = (key: unknown): Slot | undefined => {
		if (map)
			return Map.prototype.has.call(value, key)
				? { value: Map.prototype.get.call(value, key) }
				: undefined
		return Set.prototype.has.call(value, key) ? { value: key } : undefined
	}
	return {
		kind: map ? `Map` : `Set`,
		size,
		keys,
		truncated: size > maxKeys,
		read,
	}
}

export function historySnapshotShape(
	value: unknown,
): { kind: Collection[`kind`]; description: string } | undefined {
	try {
		const shape = collection(value)
		if (!shape) return undefined
		const { kind, size } = shape
		return {
			kind,
			description:
				size === undefined
					? kind
					: `${kind} · ${kind === `Array` ? `length` : `size`} ${size}`,
		}
	} catch {
		return undefined
	}
}

type Description = {
	text: string
	complete: boolean
	truncated: boolean
	circular?: true
}

function describe(
	value: unknown,
	expanded: boolean,
	multiline: boolean,
): Description {
	const path = new Set<unknown>()
	let budget = expanded ? 96 : 12
	let complete = true
	let truncated = false
	let circular = false
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
		if (item === empty) return `<empty>`
		if (Object.is(item, -0)) return `-0`
		if (typeof item === `bigint`) return `${item}n`
		if (typeof item === `symbol`) return String(item)
		const stringLimit = expanded ? (depth === 0 ? 16_384 : 1024) : 120
		const primitive = historyValue(item, stringLimit)
		if (primitive !== undefined)
			return typeof item === `string` && item.length > stringLimit
				? omit(primitive)
				: primitive
		if (path.has(item)) {
			circular = true
			return shorten(`[circular]`)
		}
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
				if (entry) {
					const text = visit(entry.value, depth + 1)
					parts.push(
						shape.kind === `Array` || shape.kind === `Set`
							? text
							: `${multiline && shape.kind === `Object` ? recordKey(key) : visit(key, depth + 1)}: ${text}`,
					)
				}
			}
			if (shape.truncated || shape.keys.length > maximum) parts.push(omit(`…`))
			const indent = `  `.repeat(depth + 1)
			const text =
				multiline && parts.length > 1
					? `\n${indent}${parts.join(`,\n${indent}`)}\n${`  `.repeat(depth)}`
					: parts.join(`, `)
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
	return { text, complete, truncated, ...(circular ? { circular: true } : {}) }
}

export function describeOutcomeValue(
	value: unknown,
	expanded = false,
	multiline = false,
): Description {
	return describe(value, expanded, multiline)
}

type HistorySnapshotEntry = {
	position: number
	label: string
	beforeLabel?: string
	afterLabel?: string
	beforeChanged?: boolean
	afterChanged?: boolean
	before?: Slot | undefined
	after?: Slot | undefined
	changed: boolean
}

export type HistoryCollectionChange = {
	kind: Collection[`kind`]
	beforeSize: number | undefined
	afterSize: number | undefined
	beforeEmpty: boolean
	afterEmpty: boolean
	entries: HistorySnapshotEntry[]
	truncated: boolean
	comparisonLimited: boolean
	changeCount?: number
	orderChanged?: true
	objectKeys?: true
}

/** Extract a single changed field without invoking getters or custom formatters. */
export function changedRecordField(
	before: unknown,
	after: unknown,
): { label: string; before: string; after: string } | undefined {
	try {
		const previous = collection(before),
			next = collection(after)
		if (
			previous?.kind !== `Object` ||
			next?.kind !== `Object` ||
			previous.truncated ||
			next.truncated
		)
			return undefined
		const changes = [...new Set([...previous.keys, ...next.keys])].filter(
			(key) => {
				const old = previous.read(key),
					current = next.read(key)
				return (
					Boolean(old) !== Boolean(current) ||
					!sameValue(old?.value, current?.value)
				)
			},
		)
		if (changes.length !== 1) return undefined
		const key = changes[0]
		const old = previous.read(key),
			current = next.read(key)
		return {
			label: recordKey(key),
			before: old ? describeOutcomeValue(old.value).text : `<absent>`,
			after: current ? describeOutcomeValue(current.value).text : `<absent>`,
		}
	} catch {
		return undefined
	}
}

function sameValue(before: unknown, after: unknown): boolean {
	if (Object.is(before, after)) return true
	if (typeof before !== `object` || typeof after !== `object`) return false
	const a = describeOutcomeValue(before),
		b = describeOutcomeValue(after)
	return a.complete && b.complete && a.text === b.text
}

function arrayComparisonPositions(
	beforeSize: number,
	afterSize: number,
): number[] {
	const size = Math.max(beforeSize, afterSize)
	const prefix = indices(0, Math.min(size, comparisonLimit))
	const boundary = Math.max(comparisonLimit, Math.min(beforeSize, afterSize))
	const end = Math.min(size, boundary + 8)
	if (beforeSize !== afterSize) {
		const lastShared = Math.min(beforeSize, afterSize) - 1
		if (lastShared >= comparisonLimit && lastShared < boundary)
			prefix.push(lastShared)
	}
	if (boundary < end) prefix.push(...indices(boundary, end))
	return prefix
}

/** Align one dense insertion or removal while keeping each snapshot's real indexes. */
function alignArraySplice(
	before: Collection,
	after: Collection,
	digits: number,
): HistorySnapshotEntry[] | undefined {
	const beforeSize = before.size!,
		afterSize = after.size!
	const size = Math.max(beforeSize, afterSize)
	const shared = Math.min(beforeSize, afterSize)
	if (shared === 0 || size > limit || size - shared !== 1) return undefined
	const previous = indices(0, beforeSize).map(before.read)
	const next = indices(0, afterSize).map(after.read)
	if ([...previous, ...next].some((slot) => slot?.value === empty))
		return undefined
	const added = afterSize > beforeSize
	const shorter = added ? previous : next
	const longer = added ? next : previous
	let insertion = 0
	while (
		insertion < shared &&
		sameValue(shorter[insertion]?.value, longer[insertion]?.value)
	)
		insertion++
	if (insertion === shared) return undefined
	for (let index = insertion; index < shared; index++) {
		if (!sameValue(shorter[index]?.value, longer[index + 1]?.value))
			return undefined
	}
	const label = (index: number) => String(index).padStart(digits, `0`)
	return indices(0, size).map((position) => {
		const shortIndex = position > insertion ? position - 1 : position
		const shortSlot = position === insertion ? undefined : shorter[shortIndex]
		const beforeIndex = added ? shortIndex : position
		const afterIndex = added ? position : shortIndex
		return {
			position,
			label: label(position),
			beforeLabel: label(beforeIndex),
			afterLabel: label(afterIndex),
			before: added ? shortSlot : previous[position],
			after: added ? next[position] : shortSlot,
			changed: position === insertion,
		}
	})
}

function orderedCollectionRows(
	before: Collection,
	after: Collection,
	label: (key: unknown) => string,
): HistorySnapshotEntry[] | undefined {
	if (before.truncated || after.truncated || before.size !== after.size)
		return undefined
	const beforeKeys = new Set(before.keys)
	if (after.keys.some((key) => !beforeKeys.has(key))) return undefined
	if (before.keys.every((key, index) => Object.is(key, after.keys[index])))
		return undefined
	return before.keys.map((key, position) => {
		const nextKey = after.keys[position]
		const previous = before.read(key)
		const current = after.read(nextKey)
		const beforeChanged = !sameValue(previous?.value, after.read(key)?.value)
		const afterChanged = !sameValue(before.read(nextKey)?.value, current?.value)
		return {
			position,
			label: label(key),
			beforeLabel: label(key),
			afterLabel: label(nextKey),
			before: previous,
			after: current,
			changed: beforeChanged || afterChanged,
			beforeChanged,
			afterChanged,
		}
	})
}

export function historyCollectionChanges(
	previous: unknown,
	next: unknown,
): HistoryCollectionChange | undefined {
	try {
		const before = collection(previous, true),
			after = collection(next, true)
		if (!before || !after || before.kind !== after.kind) return undefined
		const array = before.kind === `Array`
		const map = before.kind === `Map`
		const bounded = array || map
		const length = Math.max(before.size ?? 0, after.size ?? 0)
		const digits = String(Math.max(0, length - 1)).length
		const objectKeys = new Map<object, number>()
		const mapLabel = (key: unknown): string => {
			const text = describeOutcomeValue(key).text
			if (key === null || (typeof key !== `object` && typeof key !== `function`))
				return text
			const id = objectKeys.get(key) ?? objectKeys.size + 1
			objectKeys.set(key, id)
			return `#${id} ${text}`
		}
		const order =
			before.kind === `Map`
				? orderedCollectionRows(before, after, mapLabel)
				: before.kind === `Set`
					? orderedCollectionRows(before, after, () => ``)
					: undefined
		const aligned = array ? alignArraySplice(before, after, digits) : order
		const keys = array
			? aligned
				? []
				: arrayComparisonPositions(before.size!, after.size!)
			: [...new Set([...before.keys, ...after.keys])]
		const entries: HistorySnapshotEntry[] = []
		const changedEntries: HistorySnapshotEntry[] = []
		let changeCount = 0
		for (const [offset, key] of keys.entries()) {
			const old = before.read(key),
				current = after.read(key)
			if (!old && !current) continue
			const changed = !sameValue(
				old ? old.value : empty,
				current ? current.value : empty,
			)
			if (changed) changeCount++
			const rows = bounded && changed ? changedEntries : entries
			if (bounded && rows.length >= limit) {
				const lastShared = Math.min(before.size!, after.size!) - 1
				if (
					!array ||
					changed ||
					before.size === after.size ||
					key !== lastShared
				)
					continue
			}
			const label = array
				? String(key).padStart(digits, `0`)
				: before.kind === `Object`
					? recordKey(key)
					: before.kind === `Map`
						? mapLabel(key)
						: ``
			rows.push({
				position: array ? (key as number) : map ? offset : entries.length,
				label,
				before: old,
				after: current,
				changed,
			})
		}
		const matchBeforeBoundary =
			array && before.size !== after.size
				? Math.min(before.size!, after.size!) - 1
				: -1
		const context = entries.filter(
			(entry) => entry.position !== matchBeforeBoundary,
		)
		const boundaryContext = entries.find(
			(entry) => entry.position === matchBeforeBoundary,
		)
		const snapshot =
			aligned?.slice(0, limit) ??
			(bounded
				? changedEntries
						.concat(
							(boundaryContext ? [boundaryContext, ...context] : context).slice(
								0,
								limit - changedEntries.length,
							),
						)
						.sort((a, b) => a.position - b.position)
				: entries)
		return {
			kind: before.kind,
			beforeSize: before.size,
			afterSize: after.size,
			beforeEmpty:
				before.size !== undefined
					? before.size === 0
					: !before.truncated &&
						entries.every((entry) => entry.before === undefined),
			afterEmpty:
				after.size !== undefined
					? after.size === 0
					: !after.truncated &&
						entries.every((entry) => entry.after === undefined),
			entries: snapshot,
			truncated: bounded
				? snapshot.length < (array ? length : keys.length) ||
					(map && (before.truncated || after.truncated))
				: before.truncated || after.truncated,
			comparisonLimited:
				(array && !aligned && keys.length < length) ||
				(map && (before.truncated || after.truncated)),
			...(changeCount > 3 ? { changeCount } : {}),
			...(order ? { orderChanged: true } : {}),
			...(objectKeys.size ? { objectKeys: true } : {}),
		}
	} catch {
		return undefined
	}
}

import type { Accessor } from "@atom.io/spa"
import { onCleanup, onMount, useGetter, useId, useSetter } from "@atom.io/spa"
import type {
	ReadableToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
	Setter,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import type { RootStore, Timeline } from "atom.io/internal"
import {
	createRegularAtomFamily,
	disposeFromStore,
	findInStore,
	setIntoStore,
} from "atom.io/internal"
import type { FamilyNode, IntrospectionStates } from "atom.io/introspection"
import { attachIntrospectionStates, observeStore } from "atom.io/introspection"

import { appendTransactionHistory } from "./history-event.ts"
import type { RemotePanelConnection } from "./remote-connection.ts"

const locals = new WeakMap<RootStore, RegularAtomFamilyToken<unknown, string>>()
const introspection = new WeakMap<RootStore, IntrospectionStates>()
export type Path = readonly string[]
export interface EditorTools {
	store: RootStore
	expanded: RegularAtomToken<Record<string, boolean>>
	error: RegularAtomToken<string>
	worker?: RemotePanelConnection | undefined
	history: OperationHistory
	attempt(run: () => void): void
}
type StateToken = ReadableToken<unknown, any, any>
export type StateTokenIndex = Map<string, StateToken | FamilyNode<StateToken>>
export type TimelineView = Pick<Timeline<any>, `at` | `history`>
export type TransactionHistory = readonly TransactionOutcomeEvent<
	TransactionToken<any>
>[]
interface OperationHistory {
	useTransaction(key: string): Accessor<TransactionHistory>
	useTimeline(key: string): Accessor<TimelineView | undefined>
}
interface StoreViews {
	atomIndex: ReadableToken<StateTokenIndex>
	selectorIndex: ReadableToken<StateTokenIndex>
	transactionIndex: ReadableToken<TransactionToken<any>[]>
	timelineIndex: ReadableToken<TimelineToken<any>[]>
}
export interface RemoteStoreViews extends StoreViews {
	transactionLog(key: string): ReadableToken<TransactionHistory>
	timelineLog(key: string): ReadableToken<TimelineView>
}
export type Tools = EditorTools & StoreViews

function ownedAtom<T>(store: RootStore, initial: T): RegularAtomToken<T> {
	let family = locals.get(store)
	if (!family) {
		family = createRegularAtomFamily<unknown, string, never>(store, {
			key: `🔍 spa devtools`,
			default: undefined,
		})
		locals.set(store, family)
	}
	const token = findInStore(store, family, useId()) as RegularAtomToken<T>
	setIntoStore(store, token, initial)
	onCleanup(() => {
		disposeFromStore(store, token)
	})
	return token
}
export function useLocal<T>(
	store: RootStore,
	initial: T,
): [Accessor<T>, (next: T | Setter<T>) => void] {
	const token = ownedAtom(store, initial)
	return [useGetter(token) as Accessor<T>, useSetter(token)]
}
export function useSaved<T>(
	store: RootStore,
	key: string,
	fallback: T,
): [Accessor<T>, (next: T | Setter<T>) => void] {
	let initial = fallback
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(key) ?? `null`)
		if (saved !== null && typeof saved === typeof fallback) initial = saved as T
	} catch {
		/* Storage may be unavailable. */
	}
	const [getValue, setValue] = useLocal(store, initial)
	return [
		getValue,
		(next) => {
			setValue(next)
			try {
				localStorage.setItem(key, JSON.stringify(getValue()))
			} catch {
				/* Keep in-memory state when storage is unavailable. */
			}
		},
	]
}
function getIntrospectionStates(store: RootStore): IntrospectionStates {
	let states = introspection.get(store)
	if (!states) {
		states = attachIntrospectionStates(store)
		introspection.set(store, states)
	}
	return states
}
function localViews(store: RootStore): StoreViews {
	return getIntrospectionStates(store)
}
function useLocalOperationHistory(store: RootStore): OperationHistory {
	const [readRevision, updateRevision] = useLocal(store, 0)
	const transactions = new Map<string, TransactionHistory>()
	const timelineViews = new Map<string, TimelineView>()
	const empty: TransactionHistory = []
	onMount(() => {
		onCleanup(
			observeStore(store, ({ transactions: changes, timelines }) => {
				for (const [key, { registeredAt, outcomes }] of changes) {
					transactions.set(
						key,
						appendTransactionHistory(
							transactions.get(key) ?? empty,
							outcomes,
							registeredAt,
						),
					)
				}
				for (const key of timelines) timelineViews.delete(key)
				if (changes.size || timelines.size)
					updateRevision((revision) => revision + 1)
			}),
		)
	})
	return {
		useTransaction: (key) => () => {
			readRevision()
			return transactions.get(key) ?? empty
		},
		useTimeline: (key) => () => {
			readRevision()
			const cached = timelineViews.get(key)
			if (cached) return cached
			const timeline = store.timelines.get(key)
			if (!timeline) return
			const view = { at: timeline.at, history: timeline.history }
			timelineViews.set(key, view)
			return view
		},
	}
}
function remoteOperationHistory(
	worker: RemotePanelConnection,
	store: RootStore,
): OperationHistory {
	return {
		useTransaction: (key) => useGetter(worker.views.transactionLog(key)),
		useTimeline(key) {
			const token = worker.views.timelineLog(key)
			const read = useGetter(token)
			const readIndex = useGetter(worker.views.timelineIndex)
			return () => {
				readIndex()
				return store.atoms.has(token.key) ? read() : undefined
			}
		},
	}
}
export function useTools(
	store: RootStore,
	worker?: RemotePanelConnection,
): Tools {
	return {
		...(worker?.views ?? localViews(store)),
		...useEditorTools(store, worker),
	}
}
export function useEditorTools(
	store: RootStore,
	worker?: RemotePanelConnection,
): EditorTools {
	let expanded: Record<string, boolean> = {}
	try {
		const saved: unknown = JSON.parse(
			localStorage.getItem(`🔍 spa expanded`) ?? `{}`,
		)
		if (
			saved &&
			typeof saved === `object` &&
			!Array.isArray(saved) &&
			Object.values(saved).every((value) => typeof value === `boolean`)
		)
			expanded = saved as Record<string, boolean>
	} catch {
		/* Ignore corrupt or unavailable storage. */
	}
	const error = worker?.error ?? ownedAtom(store, ``)
	const setError = useSetter(error)
	return {
		store,
		error,
		worker,
		history: worker
			? remoteOperationHistory(worker, store)
			: useLocalOperationHistory(store),
		expanded: ownedAtom(store, expanded),
		attempt(run) {
			try {
				run()
				setError(``)
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught))
			}
		},
	}
}
export function useExpanded(
	tools: EditorTools,
	path: Path,
	initial = false,
): [Accessor<boolean>, (event: MouseEvent) => void] {
	const getExpanded = useGetter(tools.expanded)
	const setExpanded = useSetter(tools.expanded)
	const key = JSON.stringify(path)
	const group = `all:${JSON.stringify(path.slice(0, -1))}`
	const read = () => getExpanded()[key] ?? getExpanded()[group] ?? initial
	return [
		read,
		(event) => {
			const next = !read()
			setExpanded((previous) => {
				const result = { ...previous }
				if (event.shiftKey) {
					const parent = JSON.stringify(path.slice(0, -1))
					for (const item of Object.keys(result)) {
						if (item.startsWith(`[`)) {
							const candidate = JSON.parse(item) as string[]
							if (JSON.stringify(candidate.slice(0, -1)) === parent)
								Reflect.deleteProperty(result, item)
						}
					}
					result[group] = next
				} else {
					result[key] = next
				}
				try {
					localStorage.setItem(`🔍 spa expanded`, JSON.stringify(result))
				} catch {
					/* Keep in-memory expansion state. */
				}
				return result
			})
		},
	]
}

/** Give presentation fields independent dependencies, so status updates do not redraw a graph. */
export function usePresentation<T extends object>(
	store: RootStore,
	initial: T,
): {
	read(): T
	version(): number
	update(patch: Partial<T>): void
} {
	const fields = new Map<
		keyof T,
		[Accessor<unknown>, (value: unknown) => void]
	>()
	const state = {} as T
	for (const key of Object.keys(initial) as (keyof T)[]) {
		const [read, write] = useLocal<unknown>(store, initial[key])
		fields.set(key, [read, write])
		Object.defineProperty(state, key, { enumerable: true, get: read })
	}
	const [version, setVersion] = useLocal(store, 0)
	return {
		read: () => state,
		version,
		update(patch) {
			let changed = false
			for (const key of Object.keys(patch) as (keyof T)[]) {
				const [read, write] = fields.get(key)!
				if (read() !== patch[key]) {
					write(patch[key])
					changed = true
				}
			}
			if (changed) setVersion((value) => value + 1)
		},
	}
}

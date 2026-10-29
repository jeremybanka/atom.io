import type {
	ReadableFamilyToken,
	ReadableToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
	Setter,
	TimelineFamilyToken,
	TimelineManageable,
	TimelineToken,
	TransactionToken,
	ViewOf,
	WritableFamilyToken,
	WritableToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { RootStore } from "atom.io/internal"
import {
	actUponStore,
	clearTimelineInStore,
	findInStore,
	findTimelineInStore,
	getFromStore,
	getTimelineTransactionAtHead,
	IMPLICIT,
	inspectTimelineInStore,
	setIntoStore,
	subscribeToState,
	subscribeToTimeline,
	timeTravel,
	timeTravelTransactionGroupInStore,
} from "atom.io/internal"

export type Cleanup = () => void
// A callable interface permits the recursive Child union. A type alias does not.
/* oxlint-disable typescript/prefer-function-type -- A callable interface is required for recursive Child. */
export interface Accessor<T> {
	(): T
}
/* oxlint-enable typescript/prefer-function-type */
export type Component<P = any> = (props: P) => Child
export interface VNode {
	type: string | Component | null
	props: Record<string, any>
}
export type Child =
	| VNode
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| readonly Child[]
	| Accessor<Child>
export interface RootOptions {
	store?: RootStore
	idPrefix?: string
	onError?: (error: unknown) => void
}
export interface Scope {
	_root: Root
	_parent?: Scope | undefined
	_cleanups: Set<Cleanup | Scope>
	_updates: Cleanup[]
	_dead: boolean
}
export interface Root extends Scope {
	_store: RootStore
	_prefix: string
	_id: number
	_queue: Set<Cleanup>
	_mounts: Cleanup[] | undefined
	flush: Cleanup
	error: (error: unknown) => void
}

export let owner: Scope | undefined
type Subscribe = (notify: Cleanup) => Cleanup
let tracking: ((subscribe: Subscribe) => void) | undefined
let serial = 0

export function within<T>(scope: Scope, run: () => T): T {
	const previous = owner
	owner = scope
	try {
		return run()
	} finally {
		owner = previous
	}
}
export function untrack<T>(run: () => T): T {
	const previous = tracking
	tracking = undefined
	try {
		return run()
	} finally {
		tracking = previous
	}
}
export function createScope(parent?: Scope): Scope {
	const child: Scope = {
		_root: parent?._root as Root,
		_parent: parent,
		_cleanups: new Set(),
		_updates: [],
		_dead: false,
	}
	parent?._cleanups.add(child)
	return child
}
export function fail(scope: Scope, error: unknown): never {
	try {
		dispose(scope)
	} catch (cleanup) {
		throw new AggregateError([error, cleanup])
	}
	throw error
}
export function dispose(scope: Scope): void {
	if (scope._dead) return
	scope._dead = true
	const errors: unknown[] = []
	for (const cleanup of [...scope._cleanups].reverse()) {
		try {
			typeof cleanup === `function` ? cleanup() : dispose(cleanup)
		} catch (error) {
			errors.push(error)
		}
	}
	scope._parent?._cleanups.delete(scope)
	scope._cleanups.clear()
	scope._updates.length = 0
	if (errors.length) throw new AggregateError(errors)
}
export function invalidate(scope: Scope): void {
	for (const run of scope._updates) enqueue(scope, run)
	for (const child of scope._cleanups)
		if (typeof child !== `function`) invalidate(child)
}
function enqueue(scope: Scope, run: Cleanup): void {
	if (scope._dead) return
	const root = scope._root
	if (!root._queue.size)
		queueMicrotask(() => {
			try {
				root.flush()
			} catch (error) {
				root.error(error)
			}
		})
	root._queue.add(run)
}
export function createRoot(options: RootOptions = {}, server = false): Root {
	const root = {
		_store: options.store ?? IMPLICIT.STORE,
		_prefix: options.idPrefix ?? `w${serial++}`,
		_id: 0,
		...createScope(),
		_queue: new Set(),
		_mounts: server ? undefined : [],
	} as unknown as Root
	root._root = root
	root.error =
		options.onError ??
		((error) => {
			throw error
		})
	root.flush = () => {
		try {
			let passes = 0
			while (root._queue.size || root._mounts!.length) {
				if (import.meta.env.DEV && ++passes > 100)
					throw new Error(`hydrogen: update loop`)
				for (const run of [...root._queue]) if (root._queue.delete(run)) run()
				for (const run of root._mounts!.splice(0)) run()
			}
		} catch (error) {
			fail(root, error)
		}
	}
	return root
}
/** Return the atom.io store selected by the current root. */
export function useStore(): RootStore {
	return owner!._root._store
}
export function onCleanup(cleanup: Cleanup): void {
	owner!._cleanups.add(cleanup)
}
export function onMount(run: Cleanup): void {
	const scope = owner!
	scope._root._mounts?.push(() => {
		if (!scope._dead)
			within(scope, () => {
				untrack(run)
			})
	})
}
export function useId(): string {
	const root = owner!._root
	return `${root._prefix}-${root._id++}`
}

export function observe<T>(
	scope: Scope,
	read: Accessor<T>,
	apply: (value: T) => void,
): void {
	const subscriptions = new Map<Subscribe, Cleanup>()
	const run = () => {
		if (scope._dead) return
		const used = new Set<Subscribe>()
		const previous = tracking
		tracking = (subscribe) => {
			used.add(subscribe)
			if (!subscriptions.has(subscribe))
				subscriptions.set(
					subscribe,
					subscribe(() => {
						enqueue(scope, run)
					}),
				)
		}
		let value: T
		try {
			value = within(scope, read)
		} finally {
			tracking = previous
			for (const [subscribe, unsubscribe] of subscriptions)
				if (!used.has(subscribe)) {
					unsubscribe()
					subscriptions.delete(subscribe)
				}
		}
		untrack(() => {
			apply(value)
		})
	}
	scope._updates.push(run)
	scope._cleanups.add(() => {
		scope._root._queue.delete(run)
		for (const unsubscribe of subscriptions.values()) unsubscribe()
	})
	run()
}

/** Resolve a fixed family key in the current owner's store. */
export function resolveStateToken(token: any, key?: Canonical): any {
	const store = owner!._root._store
	return token.type.endsWith(`_family`) ? findInStore(store, token, key!) : token
}

/** Capture a token for this instance. Change the component key to change its token. */
export function useValue<T, E = never>(
	token: ReadableToken<T, any, E>,
): Accessor<ViewOf<T | E>>
export function useValue<T, K extends Canonical, E = never>(
	family: ReadableFamilyToken<T, K, E>,
	key: NoInfer<K>,
): Accessor<ViewOf<T | E>>
export function useValue(token: any, key?: Canonical): Accessor<any> {
	token = resolveStateToken(token, key)
	const store = owner!._root._store
	const subscribe: Subscribe = (notify) =>
		subscribeToState(store, token, `hydrogen:${serial++}`, notify)
	return () => {
		const value = getFromStore(store, token)
		tracking?.(subscribe)
		return value
	}
}
export function useSetter<T>(
	token: WritableToken<T, any, any>,
): (value: T | Setter<T>) => void
export function useSetter<T, K extends Canonical>(
	family: WritableFamilyToken<T, K, any>,
	key: NoInfer<K>,
): (value: T | Setter<T>) => void
export function useSetter(token: any, key?: Canonical): (value: any) => void {
	token = resolveStateToken(token, key)
	const store = owner!._root._store
	return (value) => {
		setIntoStore(store, token, value)
	}
}
export function useTransaction<F extends (...args: any[]) => any>(
	token: TransactionToken<F>,
): (...args: Parameters<F>) => ReturnType<F> {
	return actUponStore(owner!._root._store, token, `hydrogen:${serial++}`)
}

const refs = new WeakMap<RootStore, Map<string, object>>()
export function useRef<E extends Element>(
	token: RegularAtomToken<E | null>,
): (element: E | null) => void
export function useRef<E extends Element, K extends Canonical>(
	family: RegularAtomFamilyToken<E | null, K>,
	key: NoInfer<K>,
): (element: E | null) => void
export function useRef<E extends Element>(
	token: any,
	key?: Canonical,
): (element: E | null) => void {
	token = resolveStateToken(token, key)
	const store = owner!._root._store
	const owners = refs.get(store) ?? new Map<string, object>()
	refs.set(store, owners)
	const identity = {}
	let held: E | null = null
	return (element) => {
		if (element) {
			held = element
			owners.set(token.key, identity)
			setIntoStore(store, token, element)
		} else if (owners.get(token.key) === identity) {
			owners.delete(token.key)
			if (getFromStore(store, token) === held) setIntoStore(store, token, null)
			held = null
		}
	}
}
export interface TimelineValue {
	at: number
	length: number
	undo(): void
	redo(): void
	clear(): void
	undoTransaction?: Cleanup
	redoTransaction?: Cleanup
}
export function useTimeline<M extends TimelineManageable>(
	token: TimelineToken<M>,
): Accessor<TimelineValue>
export function useTimeline<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): Accessor<TimelineValue>
export function useTimeline(
	token: any,
	key?: Canonical,
): Accessor<TimelineValue> {
	const store = owner!._root._store
	if (token.type === `timeline_family`)
		token = findTimelineInStore(store, token, key!)
	const subscribe: Subscribe = (notify) =>
		subscribeToTimeline(store, token, `hydrogen:${serial++}`, notify)
	const controls = {
		undo: () => {
			timeTravel(store, `undo`, token)
		},
		redo: () => {
			timeTravel(store, `redo`, token)
		},
		clear: () => {
			clearTimelineInStore(store, token)
		},
	}
	return () => {
		const value: TimelineValue = {
			...inspectTimelineInStore(store, token),
			...controls,
		}
		tracking?.(subscribe)
		for (const direction of [`undo`, `redo`] as const) {
			const group = getTimelineTransactionAtHead(
				store.timelines.get(token.key)!,
				direction,
			)
			if (group)
				value[`${direction}Transaction`] = () =>
					timeTravelTransactionGroupInStore(store, direction, group)
		}
		return value
	}
}

export function plain(value: Child): string {
	if (typeof value === `function`) return plain(value())
	if (Array.isArray(value)) return value.map(plain).join(``)
	if (value == null || typeof value === `boolean`) return ``
	if (import.meta.env.DEV && typeof value === `object`)
		throw new Error(`hydrogen: text required`)
	// oxlint-disable-next-line typescript/no-base-to-string -- Valid text children are primitives here; development rejects malformed object children.
	return String(value)
}

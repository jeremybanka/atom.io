import type {
	disposeState,
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
	disposeFromStore,
	findInStore,
	findTimelineInStore,
	getFromStore,
	getTimelineTransactionAtHead,
	IMPLICIT,
	setIntoStore,
	subscribeToState,
	subscribeToTimeline,
	timeTravel,
	timeTravelTransactionGroupInStore,
	withdraw,
} from "atom.io/internal"

import type { Capability } from "./capabilities.ts"
import type {
	ExitParticipant,
	PresenceCoordinator,
	PresenceTarget,
} from "./presence.ts"

export type Cleanup = () => void
// A callable interface permits the recursive Children union. A type alias does not.
/* oxlint-disable typescript/prefer-function-type -- A callable interface is required for recursive Children. */
export interface Accessor<T> {
	(): T
}
/* oxlint-enable typescript/prefer-function-type */
export type Component<P = any> = (props: P) => Children
/** A JSX descriptor for an intrinsic tag, component, or fragment. */
export interface SpaElement {
	type: string | Component | null
	props: Record<string, any>
}
/** Renderable content, including nested groups and reactive accessors. */
export type Children =
	| SpaElement
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| readonly Children[]
	| Accessor<Children>
export interface RootOptions {
	capabilities?: readonly Capability[]
	store?: RootStore
	idPrefix?: string
	onError?: (error: unknown) => void
}
interface BoundaryOptions extends Omit<RootOptions, `capabilities`> {
	_capabilities?: Map<string, Capability>
}
export interface Scope {
	_exiting?: boolean
	_exits?: Set<ExitParticipant>
	_targets?: Set<PresenceTarget>
	_root: Root
	_parent?: Scope | undefined
	_options?: BoundaryOptions | undefined
	_cleanups: Set<Cleanup | Scope>
	_updates: Cleanup[]
	_dead: boolean
}
export interface Root extends Scope {
	_onRead?:
		| ((value: unknown, token: ReadableToken<unknown>, store: RootStore) => void)
		| undefined
	_presence?: PresenceCoordinator
	_presenceFactory?: Capability[`presence`]
	_capabilities: Map<string, Capability>
	_boundaryCapabilities?: Map<Capability, number>
	_prepareCapability?: ((capability: Capability) => void) | undefined
	_failure?: { error: unknown; report: Root[`error`] } | undefined
	_store: RootStore
	_prefix: string
	_id: number
	_queue: Set<Cleanup>
	_mounts: Cleanup[] | undefined
	_forms?: Set<Cleanup>
	_host?: Element
	flush: Cleanup
	error: (error: unknown) => void
}

export let owner: Scope | undefined
type Subscribe = (notify: Cleanup) => Cleanup
let tracking: ((subscribe: Subscribe) => void) | undefined
let serial = 0

function scopedErrorHandler(
	scope: Scope,
	error: unknown,
): Root[`error`] | undefined {
	const failure = scope._root._failure
	return failure && Object.is(failure.error, error)
		? failure.report
		: scope._options?.onError
}
function throwScopedError(
	scope: Scope,
	error: unknown,
	report = scopedErrorHandler(scope, error),
): never {
	if (report) scope._root._failure = { error, report }
	throw error
}
export function within<T>(scope: Scope, run: () => T): T {
	const previous = owner
	owner = scope
	try {
		return run()
	} catch (error) {
		throwScopedError(scope, error)
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
		_options: parent?._options,
		_cleanups: new Set(),
		_updates: [],
		_dead: false,
	}
	parent?._cleanups.add(child)
	return child
}
export function fail(scope: Scope, error: unknown): never {
	const report = scopedErrorHandler(scope, error)
	try {
		dispose(scope)
	} catch (cleanup) {
		throwScopedError(scope, new AggregateError([error, cleanup]), report)
	}
	throw error
}
export function dispose(scope: Scope): void {
	if (scope._dead) return
	scope._dead = true
	const errors: unknown[] = []
	let report: Root[`error`] | undefined
	const record = (error: unknown) => {
		errors.push(error)
		// Keep the first boundary handler as nested disposal wraps its errors.
		report ??= scopedErrorHandler(scope, error)
	}
	try {
		scope._root._presence?.forget(scope)
	} catch (error) {
		record(error)
	}
	for (const cleanup of [...scope._cleanups].reverse()) {
		try {
			typeof cleanup === `function` ? cleanup() : dispose(cleanup)
		} catch (error) {
			record(error)
		}
	}
	scope._parent?._cleanups.delete(scope)
	scope._cleanups.clear()
	scope._targets?.clear()
	scope._updates.length = 0
	if (errors.length) throwScopedError(scope, new AggregateError(errors), report)
}
export function invalidate(scope: Scope): void {
	for (const run of scope._updates) enqueue(scope, run)
	for (const child of scope._cleanups)
		if (typeof child !== `function`) invalidate(child)
}
export function enqueue(scope: Scope, run: Cleanup): void {
	if (!isPresent(scope)) return
	const root = scope._root
	if (!root._queue.size)
		queueMicrotask(() => {
			try {
				root.flush()
			} catch (error) {
				const report = scopedErrorHandler(root, error) ?? root.error
				root._failure = undefined
				report(error)
			}
		})
	root._queue.add(run)
}
function capabilityMap(list: readonly Capability[] | undefined) {
	const capabilities = new Map<string, Capability>()
	for (const capability of list ?? []) {
		if (capabilities.has(capability.namespace))
			throw new Error(`spa: duplicate capability ${capability.namespace}`)
		capabilities.set(capability.namespace, capability)
	}
	return capabilities
}
function registerPresence(
	root: Root,
	capability: Capability,
	shared = false,
): void {
	const create = capability.presence
	if (!create) return
	if (root._presence) {
		if (!shared || root._presenceFactory !== create)
			throw new Error(`spa: multiple presence coordinators`)
	} else {
		root._presence = create(root)
		root._presenceFactory = create
	}
}
export function scopeCapabilities(scope: Scope): Map<string, Capability> {
	return scope._options?._capabilities ?? scope._root._capabilities
}
export function reportScopeError(scope: Scope, error: unknown): void {
	const report = scopedErrorHandler(scope, error) ?? scope._root.error
	try {
		fail(scope._root, error)
	} catch (failure) {
		scope._root._failure = undefined
		report(failure)
	}
}

/** Override root options for these children while sharing their parent's ownership. */
export function RootBoundary(
	props: RootOptions & { children?: Children },
): Children {
	const scope = owner!
	const { store, idPrefix, onError, capabilities } = props
	const options = { ...scope._options }
	if (store !== undefined) options.store = store
	if (idPrefix !== undefined) options.idPrefix = idPrefix
	if (onError !== undefined) options.onError = onError
	if (capabilities !== undefined) {
		options._capabilities = capabilityMap(capabilities)
		const root = scope._root
		const active = (root._boundaryCapabilities ??= new Map())
		for (const capability of options._capabilities.values()) {
			registerPresence(root, capability, true)
			active.set(capability, (active.get(capability) ?? 0) + 1)
			scope._cleanups.add(() => {
				const remaining = active.get(capability)! - 1
				if (remaining) active.set(capability, remaining)
				else active.delete(capability)
			})
			root._prepareCapability?.(capability)
		}
	}
	scope._options = options
	return () => props.children
}

export function createRoot(options: RootOptions = {}, server = false): Root {
	const capabilities = capabilityMap(options.capabilities)
	const root = {
		_capabilities: capabilities,
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
	for (const capability of capabilities.values())
		registerPresence(root, capability)
	root.flush = () => {
		if (!root._queue.size && !root._mounts!.length && !root._forms?.size) return
		root._failure = undefined
		try {
			const commits = new Map<Capability, Cleanup | undefined>()
			const prepare = (capability: Capability) => {
				if (!commits.has(capability))
					commits.set(capability, capability.beforeUpdate?.(root))
			}
			const previous = root._prepareCapability
			root._prepareCapability = prepare
			try {
				for (const capability of capabilities.values()) prepare(capability)
				for (const capability of root._boundaryCapabilities?.keys() ?? [])
					prepare(capability)
				let passes = 0
				while (root._queue.size || root._mounts!.length) {
					if (import.meta.env.DEV && ++passes > 100)
						throw new Error(`spa: update loop`)
					for (const run of [...root._queue]) if (root._queue.delete(run)) run()
					for (const run of root._mounts!.splice(0)) run()
				}
				for (const restore of root._forms ?? []) untrack(restore)
			} finally {
				root._prepareCapability = previous
				for (const commit of commits.values()) commit?.()
			}
			root._failure = undefined
		} catch (error) {
			fail(root, error)
		}
	}
	return root
}
/** Return the atom.io store selected by the current owner. */
export function useStore(): RootStore {
	return owner!._options?.store ?? owner!._root._store
}
/** Return atom.io disposal bound to the current root's store. */
export function useDisposal(): typeof disposeState {
	return disposeFromStore.bind(null, useStore()) as typeof disposeState
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
	return `${owner!._options?.idPrefix ?? root._prefix}-${root._id++}`
}

export function observe<T>(
	scope: Scope,
	read: Accessor<T>,
	apply: (value: T) => void,
): void {
	const subscriptions = new Map<Subscribe, Cleanup>()
	const run = () => {
		if (!isPresent(scope)) return
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
		within(scope, () => {
			untrack(() => {
				apply(value)
			})
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
	const store = useStore()
	return token.type.endsWith(`_family`) ? findInStore(store, token, key!) : token
}

/** Capture a token for this instance. Change the component key to change its token. */
export function useGetter<T, E = never>(
	token: ReadableToken<T, any, E>,
): Accessor<ViewOf<T | E>>
export function useGetter<T, K extends Canonical, E = never>(
	family: ReadableFamilyToken<T, K, E>,
	key: NoInfer<K>,
): Accessor<ViewOf<T | E>>
export function useGetter(token: any, key?: Canonical): Accessor<any> {
	token = resolveStateToken(token, key)
	const root = owner!._root
	const store = useStore()
	const subscribe: Subscribe = (notify) =>
		subscribeToState(store, token, `spa:${serial++}`, notify)
	return () => {
		const value = getFromStore(store, token)
		root._onRead?.(value, token, store)
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
	const store = useStore()
	return (value) => {
		setIntoStore(store, token, value)
	}
}
export function useTransaction<F extends (...args: any[]) => any>(
	token: TransactionToken<F>,
): (...args: Parameters<F>) => ReturnType<F> {
	return actUponStore(useStore(), token, `spa:${serial++}`)
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
	const store = useStore()
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
export interface TimelineControls {
	getCursor(): number
	getLength(): number
	undo(): void
	redo(): void
	clear(): void
	getTransaction(): { undo?: Cleanup; redo?: Cleanup }
}
export function useTimeline<M extends TimelineManageable>(
	token: TimelineToken<M>,
): TimelineControls
export function useTimeline<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): TimelineControls
export function useTimeline(token: any, key?: Canonical): TimelineControls {
	const store = useStore()
	const selected: TimelineToken<any> =
		token.type === `timeline_family`
			? findTimelineInStore(store, token, key!)
			: token
	const subscribe: Subscribe = (notify) =>
		subscribeToTimeline(store, selected, `spa:${serial++}`, notify)
	const read = () => {
		const timeline = withdraw(store, selected)
		tracking?.(subscribe)
		return timeline
	}
	return {
		getCursor: () => read().at,
		getLength: () => read().history.length,
		undo: () => {
			timeTravel(store, `undo`, selected)
		},
		redo: () => {
			timeTravel(store, `redo`, selected)
		},
		clear: () => {
			clearTimelineInStore(store, selected)
		},
		getTransaction: () => {
			const timeline = read()
			const controls: ReturnType<TimelineControls[`getTransaction`]> = {}
			for (const direction of [`undo`, `redo`] as const) {
				const group = getTimelineTransactionAtHead(timeline, direction)
				if (group)
					controls[direction] = () => {
						timeTravelTransactionGroupInStore(store, direction, group)
					}
			}
			return controls
		},
	}
}

export function plain(value: Children): string {
	if (typeof value === `function`) return plain(value())
	if (Array.isArray(value)) return value.map(plain).join(``)
	if (value == null || typeof value === `boolean`) return ``
	if (import.meta.env.DEV && typeof value === `object`)
		throw new Error(`spa: text required`)
	// oxlint-disable-next-line typescript/no-base-to-string -- Valid text children are primitives here; development rejects malformed object children.
	return String(value)
}

export function isPresent(scope: Scope): boolean {
	for (let at: Scope | undefined = scope; at; at = at._parent)
		if (at._dead || at._exiting) return false
	return true
}

import type { ReadableToken, ViewOf } from "atom.io"
import type { Store } from "atom.io/internal"
import { getFromStore, IMPLICIT, subscribeToState } from "atom.io/internal"

const PROJECTION = Symbol(`atom-jsx.projection`)
const ELEMENT = Symbol(`atom-jsx.element`)
export function Fragment(props: { children?: Child }): Child {
	return props.children
}

interface ChildTokenValue {
	readonly __T?: Child
	readonly __E?: Child
}

export type Child =
	| VNode
	| (ReadableToken<unknown, any, unknown> & ChildTokenValue)
	| Projection<Child>
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| readonly Child[]

export type Component<P = any> = (props: P) => Child
export interface VNode {
	readonly [ELEMENT]: true
	readonly type: string | Component
	readonly props: Record<string, any>
}

let subscriptionId = 0

export interface Projection<T> {
	readonly [PROJECTION]: true
	readonly read: (store: Store) => T
	readonly subscribe: (store: Store, update: () => void) => () => void
}

/** A pure, view-local projection. Shared or multi-token derivations belong in selectors. */
export function project<T, U, E = never>(
	token: ReadableToken<T, any, E>,
	select: (value: ViewOf<T | E>) => U,
): Projection<U> {
	return {
		[PROJECTION]: true,
		read: (store) => select(getFromStore(store, token)),
		subscribe(store, update) {
			getFromStore(store, token)
			return subscribeToState(
				store,
				token,
				`jsx-experiment:${++subscriptionId}`,
				update,
			)
		},
	}
}

function isProjection(value: unknown): value is Projection<unknown> {
	return typeof value === `object` && value !== null && PROJECTION in value
}

// Tokens are serializable references, so recognize their public discriminators.
const readableTypes = {
	atom: true,
	mutable_atom: true,
	readonly_pure_selector: true,
	writable_pure_selector: true,
	readonly_held_selector: true,
	writable_held_selector: true,
} satisfies Record<ReadableToken<unknown>[`type`], true>

function isReadableToken(
	value: unknown,
): value is ReadableToken<unknown, any, unknown> {
	return (
		typeof value === `object` &&
		value !== null &&
		`key` in value &&
		typeof value.key === `string` &&
		`type` in value &&
		typeof value.type === `string` &&
		Object.hasOwn(readableTypes, value.type)
	)
}

export function jsx(
	type: VNode[`type`],
	props: VNode[`props`] | null,
	key?: unknown,
): VNode {
	if (key !== undefined || props?.[`key`] !== undefined) {
		throw new Error(`Keyed reconciliation is not implemented in this experiment`)
	}
	return { [ELEMENT]: true, type, props: props ?? {} }
}
export const jsxs = jsx
export const jsxDEV = jsx

interface Root {
	store: Store
	queue: Set<() => void>
	schedule: (update: () => void) => void
}
interface Scope {
	root: Root
	disposed: boolean
	cleanups: Set<() => void>
}
let currentScope: Scope | undefined

function inScope<T>(scope: Scope, run: () => T): T {
	const previous = currentScope
	currentScope = scope
	try {
		return run()
	} finally {
		currentScope = previous
	}
}

function createScope(root: Root, parent?: Scope): Scope {
	const scope: Scope = { root, disposed: false, cleanups: new Set() }
	if (parent) {
		const cleanup = () => {
			disposeScope(scope)
		}
		parent.cleanups.add(cleanup)
		scope.cleanups.add(() => parent.cleanups.delete(cleanup))
	}
	return scope
}

function disposeScope(scope: Scope): void {
	if (scope.disposed) return
	scope.disposed = true
	const errors: unknown[] = []
	for (const cleanup of [...scope.cleanups].reverse()) {
		try {
			cleanup()
		} catch (error) {
			errors.push(error)
		}
	}
	scope.cleanups.clear()
	if (errors.length) throw new AggregateError(errors, `JSX cleanup failed`)
}

export function onCleanup(cleanup: () => void): void {
	if (!currentScope || currentScope.disposed)
		throw new Error(`onCleanup requires a mounted component`)
	currentScope.cleanups.add(cleanup)
}

/** Capture during component setup, then use in event handlers with atom.io APIs. */
export function useStore(): Store {
	if (!currentScope) throw new Error(`useStore requires a mounted component`)
	return currentScope.root.store
}

function observe<T>(
	source: Projection<T>,
	scope: Scope,
	apply: (value: T) => void,
): void {
	let initialized = false
	let previous: T
	const update = () => {
		if (!scope.disposed)
			inScope(scope, () => {
				const value = source.read(scope.root.store)
				// Mutable object snapshots can change without changing identity.
				if (
					initialized &&
					(value === null || typeof value !== `object`) &&
					Object.is(previous, value)
				)
					return
				initialized = true
				previous = value
				apply(value)
			})
	}
	// The source initializes lazy state before subscribing; read after setup.
	const unsubscribe = source.subscribe(scope.root.store, () => {
		scope.root.schedule(update)
	})
	scope.cleanups.add(() => {
		scope.root.queue.delete(update)
		unsubscribe()
	})
	update()
}

function insert(
	node: Node,
	parent: Node,
	before: Node | null,
	scope: Scope,
): void {
	parent.insertBefore(node, before)
	scope.cleanups.add(() => node.parentNode?.removeChild(node))
}

const SVG = `http://www.w3.org/2000/svg`
const HTML = `http://www.w3.org/1999/xhtml`
const reservedContent = new Set([
	`innerHTML`,
	`outerHTML`,
	`textContent`,
	`innerText`,
	`dangerouslySetInnerHTML`,
])

function setProp(element: Element, name: string, value: unknown): void {
	if (reservedContent.has(name))
		throw new Error(`${name} would bypass owned children`)
	if (name === `className`) name = `class`
	if (name === `htmlFor`) name = `for`
	if (
		name === `style` &&
		value !== null &&
		value !== undefined &&
		typeof value !== `string`
	) {
		throw new TypeError(`This experiment accepts CSS strings for style`)
	}
	if (
		element.namespaceURI === HTML &&
		name in element &&
		name !== `style` &&
		name !== `list` &&
		name !== `form`
	) {
		const target = element as unknown as Record<string, unknown>
		target[name] = value ?? (typeof target[name] === `boolean` ? false : ``)
	} else if (
		value == null ||
		(value === false && !name.startsWith(`aria-`) && !name.startsWith(`data-`))
	) {
		element.removeAttribute(name)
	} else {
		if (
			typeof value !== `string` &&
			typeof value !== `number` &&
			typeof value !== `boolean` &&
			typeof value !== `bigint`
		) {
			throw new TypeError(`${name} requires a primitive attribute value`)
		}
		element.setAttribute(
			name,
			value === true && !name.startsWith(`aria-`) && !name.startsWith(`data-`)
				? ``
				: String(value),
		)
	}
}

function mount(
	child: Child,
	parent: Node,
	before: Node | null,
	scope: Scope,
	namespace: string,
): void {
	const document = parent.ownerDocument!
	if (child == null || typeof child === `boolean`) return
	if (Array.isArray(child)) {
		for (const item of child) mount(item, parent, before, scope, namespace)
		return
	}
	if (isReadableToken(child)) {
		mount(
			project(child, (value) => value),
			parent,
			before,
			scope,
			namespace,
		)
		return
	}
	if (isProjection(child)) {
		const anchor = document.createComment(`atom`)
		insert(anchor, parent, before, scope)
		let branch: Scope | undefined
		let text: Text | undefined
		observe(child, scope, (value) => {
			const primitive =
				typeof value === `string` ||
				typeof value === `number` ||
				typeof value === `bigint`
			if (primitive && text) {
				if (text.data !== String(value)) text.data = String(value)
				return
			}
			if (branch) disposeScope(branch)
			branch = createScope(scope.root, scope)
			text = undefined
			if (primitive) {
				text = document.createTextNode(String(value))
				insert(text, parent, anchor, branch)
			} else {
				mount(value, parent, anchor, branch, namespace)
			}
		})
		return
	}
	if (
		typeof child === `string` ||
		typeof child === `number` ||
		typeof child === `bigint`
	) {
		insert(document.createTextNode(String(child)), parent, before, scope)
		return
	}
	if (!(ELEMENT in child))
		throw new TypeError(
			`Unsupported JSX child; use a selector to produce renderable values`,
		)
	if (child.type === Fragment) {
		mount(child.props[`children`], parent, before, scope, namespace)
		return
	}
	if (typeof child.type === `function`) {
		const componentScope = createScope(scope.root, scope)
		inScope(componentScope, () => {
			mount(
				(child.type as Component)(child.props),
				parent,
				before,
				componentScope,
				namespace,
			)
		})
		return
	}
	const elementNamespace = child.type === `svg` ? SVG : namespace
	const element = document.createElementNS(elementNamespace, child.type)
	insert(element, parent, before, scope)
	// Select.value needs its option children to exist before the first assignment.
	mount(
		child.props[`children`],
		element,
		null,
		scope,
		child.type === `foreignObject` ? HTML : elementNamespace,
	)
	for (const [name, value] of Object.entries(child.props)) {
		if (name === `children` || name === `ref`) continue
		if (name.startsWith(`on`)) {
			if (typeof value !== `function`)
				throw new TypeError(`${name} requires an event handler`)
			const capture = name.endsWith(`Capture`)
			const eventName = name.slice(2, capture ? -7 : undefined).toLowerCase()
			const event = eventName === `doubleclick` ? `dblclick` : eventName
			element.addEventListener(event, value as EventListener, capture)
			scope.cleanups.add(() => {
				element.removeEventListener(event, value as EventListener, capture)
			})
		} else if (isReadableToken(value) || isProjection(value)) {
			observe(
				isReadableToken(value) ? project(value, (snapshot) => snapshot) : value,
				scope,
				(snapshot) => {
					setProp(element, name, snapshot)
				},
			)
		} else {
			setProp(element, name, value)
		}
	}
	const ref = child.props[`ref`] as ((node: Element | null) => void) | undefined
	if (ref) {
		scope.cleanups.add(() => {
			ref(null)
		})
		ref(element)
	}
}

export interface RenderRoot {
	/** Apply queued invalidations now; normally they coalesce in a microtask. */
	flush: () => void
	dispose: () => void
}

/** Appends owned nodes; disposal leaves preexisting host content intact. */
export function render(
	child: Child,
	host: Element,
	options: { store?: Store } = {},
): RenderRoot {
	let queued = false
	const queue = new Set<() => void>()
	const flush = () => {
		queued = false
		try {
			let passes = 0
			while (queue.size) {
				if (++passes > 100) throw new Error(`Reactive rendering did not settle`)
				for (const update of [...queue]) {
					if (queue.delete(update)) update()
				}
			}
		} catch (error) {
			queue.clear()
			try {
				disposeScope(scope)
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					`Rendering and cleanup failed`,
				)
			}
			throw error
		}
	}
	const root: Root = {
		store: options.store ?? IMPLICIT.STORE,
		queue,
		schedule(update) {
			queue.add(update)
			if (!queued) {
				queued = true
				queueMicrotask(flush)
			}
		},
	}
	const scope = createScope(root)
	try {
		mount(
			child,
			host,
			null,
			scope,
			host.namespaceURI === SVG && host.localName !== `foreignObject`
				? SVG
				: HTML,
		)
	} catch (error) {
		try {
			disposeScope(scope)
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], `Mount and cleanup failed`)
		}
		throw error
	}
	return {
		flush,
		dispose: () => {
			disposeScope(scope)
		},
	}
}

import type { Child, Component, RootOptions, Scope, VNode } from "./core.ts"
import {
	createRoot,
	createScope,
	dispose,
	fail,
	invalidate,
	observe,
	owner,
	untrack,
	within,
} from "./core.ts"
import { Fragment, merge } from "./jsx-runtime.ts"

export interface SceneHost<N> {
	create(type: string, props: Record<string, any>): N
	update(
		node: N,
		props: Record<string, any>,
		previous: Record<string, any>,
	): void
	children(parent: N, children: N[]): void
	destroy(node: N): void
}
interface Entry<N> {
	scope: Scope
	value: Child
	nodes: () => N[]
}

export interface SceneRenderer<N> {
	mount(setup: () => Child, parent: N): void
	render(
		setup: () => Child,
		parent: N,
		options?: RootOptions,
	): { flush(): void; dispose(): void }
}

/** A scene renderer shares SPA's owner, store, scheduler, and component lifecycle. */
export function createSceneRenderer<N>(host: SceneHost<N>): SceneRenderer<N> {
	function mount(
		source: () => Child,
		scope: Scope,
		changed: () => void,
	): () => N[] {
		let entries: Entry<N>[] = []
		observe(scope, source, (next) => {
			const values = (
				Array.isArray(next) ? next.flat(Infinity) : [next]
			) as Child[]
			const old = new Map(
				entries.map((entry, i) => [key(entry.value, i), entry]),
			)
			const seen = new Set<string>()
			entries = values.map((value, i) => {
				const id = key(value, i)
				if (seen.has(id)) throw new Error(`spa: duplicate scene key`)
				seen.add(id)
				let entry = old.get(id)
				old.delete(id)
				if (entry && !same(entry.value, value)) {
					dispose(entry.scope)
					entry = undefined
				}
				if (entry) {
					entry.value = value
					invalidate(entry.scope)
					return entry
				}
				const childScope = createScope(scope)
				const created: Entry<N> = { scope: childScope, value, nodes: () => [] }
				created.nodes = build(() => created.value, childScope, changed)
				return created
			})
			for (const entry of old.values()) dispose(entry.scope)
			changed()
		})
		return () => entries.flatMap((entry) => entry.nodes())
	}
	function key(value: Child, i: number): string {
		const explicit = (value as VNode | null)?.props?.[`key`]
		return explicit == null ? `index:${i}` : `key:${explicit}`
	}
	function same(a: Child, b: Child): boolean {
		return (
			typeof a === typeof b &&
			(a as VNode | null)?.type === (b as VNode | null)?.type
		)
	}
	function build(
		source: () => Child,
		scope: Scope,
		changed: () => void,
	): () => N[] {
		const value = untrack(source)
		if (typeof value === `function`)
			return mount(() => (source() as () => Child)(), scope, changed)
		if (Array.isArray(value)) return mount(source, scope, changed)
		if (value == null || typeof value === `boolean`) return () => []
		if (typeof value !== `object`)
			throw new Error(`spa: scene children must be nodes`)
		if (!(`type` in value) || !(`props` in value))
			throw new Error(`spa: invalid scene child`)
		const vnode = value
		const props = merge(() => (source() as VNode).props)
		if (!vnode.type || vnode.type === Fragment)
			return mount(() => props[`children`], scope, changed)
		if (typeof vnode.type === `function`) {
			const output = within(scope, () =>
				untrack(() => (vnode.type as Component)(props)),
			)
			return mount(() => output, scope, changed)
		}
		const node = host.create(
			vnode.type,
			untrack(() => props),
		)
		scope._cleanups.add(() => {
			host.destroy(node)
		})
		let previous: Record<string, any> = {}
		observe(
			scope,
			() => ({ ...props }),
			(next) => {
				host.update(node, next, previous)
				previous = next
			},
		)
		let children: () => N[] = () => []
		const sync = () => {
			host.children(node, children())
		}
		children = mount(() => props[`children`], scope, sync)
		sync()
		const ref = untrack(() => props[`ref`])
		if (ref)
			scope._root._mounts!.unshift(() => {
				if (!scope._dead) {
					scope._cleanups.add(() => ref(null))
					ref(node)
				}
			})
		return () => [node]
	}
	function attach(setup: () => Child, parent: N, scope: Scope) {
		let nodes: () => N[] = () => []
		const sync = () => {
			host.children(parent, nodes())
		}
		nodes = mount(() => untrack(setup), scope, sync)
		sync()
		scope._cleanups.add(() => {
			host.children(parent, [])
		})
	}
	return {
		/** Attach beneath the current component; disposal follows its lifetime. */
		mount(setup: () => Child, parent: N): void {
			if (!owner) throw new Error(`spa: scene mount requires an owner`)
			const scope = createScope(owner)
			try {
				attach(setup, parent, scope)
			} catch (error) {
				fail(scope, error)
			}
		},
		render(setup: () => Child, parent: N, options: RootOptions = {}) {
			const root = createRoot(options)
			try {
				within(root, () => {
					attach(setup, parent, root)
				})
				root.flush()
			} catch (error) {
				fail(root, error)
			}
			return {
				flush: root.flush,
				dispose: () => {
					dispose(root)
				},
			}
		},
	}
}

/** Define a typed scene component without introducing another JSX runtime. */
export function sceneComponent<P>(type: string): (props: P) => VNode {
	return (props) => ({ type, props: props as Record<string, any> })
}

/** Bind imperative scene work to the current owner and its reactive dependencies. */
export function bindScene<T>(read: () => T, apply: (value: T) => void): void {
	observe(owner!, read, apply)
}

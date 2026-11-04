import type { CapabilityTarget } from "./capabilities.ts"
import { capabilityProps } from "./capabilities.ts"
import type { Child, Component, RootOptions, Scope, VNode } from "./core.ts"
import {
	createRoot,
	createScope,
	dispose,
	fail,
	invalidate,
	isPresent,
	observe,
	owner,
	untrack,
	within,
} from "./core.ts"
import { Fragment, merge } from "./jsx-runtime.ts"

export interface SceneHost<N> {
	target?(node: N): CapabilityTarget
	create(type: string, props: Record<string, any>): N
	update(
		node: N,
		props: Record<string, any>,
		previous: Record<string, any>,
	): void
	children(parent: N, children: N[], activeChildren: N[]): void
	destroy(node: N): void
}
type SceneNodes<N> = (activeOnly?: boolean) => N[]

interface Entry<N> {
	scope: Scope
	value: Child
	nodes: SceneNodes<N>
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
	): SceneNodes<N> {
		let entries: Entry<N>[] = []
		const presence = scope._root._presence?.collection<Entry<N>, Child>(
			(entry) => entry.scope,
			(entry, value) => same(entry.value, value),
		)
		const retire = (
			entry: Entry<N>,
			id: string,
			eligible: boolean,
			index: number,
		) => {
			if (presence)
				presence.remove(entry, id, eligible, index, () => {
					if (!scope._dead) changed()
				})
			else dispose(entry.scope)
		}
		observe(scope, source, (next) => {
			const values = (
				Array.isArray(next) ? next.flat(Infinity) : [next]
			) as Child[]
			const previous = entries
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
					retire(
						entry,
						id,
						value == null || typeof value === `boolean`,
						previous.indexOf(entry),
					)
					entry = undefined
				}
				entry ??= presence?.take(id, value)
				if (entry) {
					entry.value = value
					scope._root._presence?.resume(entry.scope)
					invalidate(entry.scope)
					return entry
				}
				const childScope = createScope(scope)
				const created: Entry<N> = { scope: childScope, value, nodes: null! }
				created.nodes = build(() => created.value, childScope, changed)
				return created
			})
			for (const [id, entry] of old)
				retire(entry, id, true, previous.indexOf(entry))
			changed()
		})
		return (activeOnly = false) => {
			const rendered = activeOnly
				? entries
				: (presence?.merge(entries) ?? entries)
			return rendered.flatMap((entry) => entry.nodes(activeOnly))
		}
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
	): SceneNodes<N> {
		const value = untrack(source)
		if (typeof value === `function`)
			return mount(() => (source() as () => Child)(), scope, changed)
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
		const nativeProps = capabilityProps(
			scope,
			host.target?.(node) ?? { kind: `scene`, node },
			() => ({ ...props }),
		)
		let previous: Record<string, any> = {}
		observe(
			scope,
			() => ({ ...props }),
			(all) => {
				const next = nativeProps(all)
				host.update(node, next, previous)
				previous = next
			},
		)
		let children: SceneNodes<N> = () => []
		const sync = () => {
			host.children(node, children(), children(true))
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
		let nodes: SceneNodes<N> = () => []
		const sync = () => {
			host.children(parent, nodes(), nodes(true))
		}
		nodes = mount(() => untrack(setup), scope, sync)
		sync()
		scope._cleanups.add(() => {
			host.children(parent, [], [])
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

/** Scene drawing follows an installed capability clock, or the browser clock. */
export function onSceneFrame(
	callback: (time: number) => void,
	infrastructure = false,
): void {
	const scope = owner!
	const clocks = [...scope._root._capabilities.values()].filter(
		(capability) => capability.scheduleFrame,
	)
	if (clocks.length > 1)
		throw new Error(`spa: multiple frame clock capabilities`)
	const draw = (time: number) => {
		if (scope._dead || (!infrastructure && !isPresent(scope))) return
		try {
			callback(time)
		} catch (error) {
			try {
				fail(scope._root, error)
			} catch (failure) {
				scope._root.error(failure)
			}
		}
	}
	let stop: () => void
	if (clocks[0]) stop = clocks[0].scheduleFrame!(draw)
	else {
		let frame = 0
		const tick = (time: number) => {
			if (scope._dead) return
			draw(time)
			if (!scope._dead) frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		stop = () => {
			cancelAnimationFrame(frame)
		}
	}
	scope._cleanups.add(stop)
}

import type { CapabilityTarget } from "./capabilities.ts"
import { capabilityProps } from "./capabilities.ts"
import type {
	Children,
	Component,
	RootOptions,
	Scope,
	SpaElement,
} from "./core.ts"
import {
	createRoot,
	createScope,
	dispose,
	fail,
	invalidate,
	isPresent,
	observe,
	owner,
	reportScopeError,
	scopeCapabilities,
	untrack,
	within,
} from "./core.ts"
import { hotRoot, trackRoot } from "./hot.ts"
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
	value: Children
	nodes: SceneNodes<N>
}

export interface SceneRenderer<N> {
	mount(setup: () => Children, parent: N): void
	render(
		setup: () => Children,
		parent: N,
		options?: RootOptions,
	): { flush(): void; dispose(): void }
}

/** A scene renderer shares SPA's owner, store, scheduler, and component lifecycle. */
export function createSceneRenderer<N>(host: SceneHost<N>): SceneRenderer<N> {
	function mount(
		source: () => Children,
		scope: Scope,
		changed: () => void,
	): SceneNodes<N> {
		let entries: Entry<N>[] = []
		let reconciling = false
		const report = () => {
			if (!reconciling) changed()
		}
		const collection = () =>
			scope._root._presence?.collection<Entry<N>, Children>(
				(entry) => entry.scope,
				(entry, value) => same(entry.value, value),
			)
		let presence: ReturnType<typeof collection>
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
			presence ??= collection()
			reconciling = true
			const values = (
				Array.isArray(next) ? next.flat(Infinity) : [next]
			) as Children[]
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
				created.nodes = build(() => created.value, childScope, report)
				return created
			})
			for (const [id, entry] of old)
				retire(entry, id, true, previous.indexOf(entry))
			reconciling = false
			if (
				entries.length !== previous.length ||
				entries.some((entry, i) => entry !== previous[i])
			)
				changed()
		})
		return (activeOnly = false) => {
			const rendered = activeOnly
				? entries
				: (presence?.merge(entries) ?? entries)
			return rendered.flatMap((entry) => entry.nodes(activeOnly))
		}
	}
	function key(value: Children, i: number): string {
		const explicit = (value as SpaElement | null)?.props?.[`key`]
		return explicit == null ? `index:${i}` : `key:${explicit}`
	}
	function same(a: Children, b: Children): boolean {
		return (
			typeof a === typeof b &&
			(a as SpaElement | null)?.type === (b as SpaElement | null)?.type
		)
	}
	function build(
		source: () => Children,
		scope: Scope,
		changed: () => void,
	): SceneNodes<N> {
		const value = untrack(source)
		if (typeof value === `function`)
			return mount(() => (source() as () => Children)(), scope, changed)
		if (value == null || typeof value === `boolean`) return () => []
		if (typeof value !== `object`)
			throw new Error(`spa: scene children must be nodes`)
		if (!(`type` in value) || !(`props` in value))
			throw new Error(`spa: invalid scene child`)
		const vnode = value
		const props = merge(() => (source() as SpaElement).props)
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
					within(scope, () => ref(node))
				}
			})
		return () => [node]
	}
	function attach(setup: () => Children, parent: N, scope: Scope) {
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
		mount(setup: () => Children, parent: N): void {
			if (!owner) throw new Error(`spa: scene mount requires an owner`)
			const scope = createScope(owner)
			try {
				attach(setup, parent, scope)
			} catch (error) {
				fail(scope, error)
			}
		},
		render(setup: () => Children, parent: N, options: RootOptions = {}) {
			const mountRoot = (next: RootOptions) => {
				const root = createRoot(next)
				if (import.meta.env.DEV) trackRoot(root)
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
			}
			return import.meta.env.DEV
				? hotRoot(mountRoot, options)
				: mountRoot(options)
		},
	}
}

/** Define a typed scene component without introducing another JSX runtime. */
export function sceneComponent<P>(type: string): (props: P) => SpaElement {
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
	const clocks = [...scopeCapabilities(scope).values()].filter(
		(capability) => capability.scheduleFrame,
	)
	if (clocks.length > 1)
		throw new Error(`spa: multiple frame clock capabilities`)
	const draw = (time: number) => {
		if (scope._dead || (!infrastructure && !isPresent(scope))) return
		try {
			callback(time)
		} catch (error) {
			reportScopeError(scope, error)
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

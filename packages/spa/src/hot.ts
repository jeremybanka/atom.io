import { IMPLICIT } from "atom.io/internal"

import type { Component, Root, RootOptions } from "./core.ts"
import { owner } from "./core.ts"

interface Handle {
	dispose(): void
	flush(): void
}
type Factory = (options: RootOptions, before: Node | null) => Handle
interface View {
	modules: Set<string>
	options: RootOptions
	refresh(): void
	report(error: unknown): void
}

function createHotRuntime() {
	const components = new Map<string, { current: Component; proxy: Component }>()
	const roots = new WeakMap<Root, View>()
	const views = new Set<View>()
	let mounting: View | undefined
	function track(root: Root): void {
		if (mounting) {
			roots.set(root, mounting)
			mounting.options.idPrefix ??= root._prefix
		}
	}
	function register<T extends Component>(
		id: string,
		name: string,
		implementation: T,
	): T {
		const key = JSON.stringify([id, name])
		let record = components.get(key)
		if (record) record.current = implementation
		else {
			const created = {
				current: implementation as Component,
				proxy: null! as Component,
			}
			created.proxy = Object.assign(
				(props: Record<string, any>) => {
					if (owner) {
						const root = owner._root
						const view = roots.get(root) ?? mounting
						if (view) {
							roots.set(root, view)
							view.options.idPrefix ??= root._prefix
							view.modules.add(id)
						}
					}
					return created.current(props)
				},
				{ spa: true },
			)
			record = created
			components.set(key, record)
		}
		return record.proxy as T
	}
	function manage(
		factory: Factory,
		options: RootOptions,
		host?: Element,
	): Handle {
		const settings = { ...options, store: options.store ?? IMPLICIT.STORE }
		const anchor = host?.ownerDocument.createComment(`spa-hot`)
		let current: Handle
		let errorNode: HTMLElement | undefined
		let disposed = false
		const placeAnchor = () => {
			if (!anchor || anchor.parentNode) return
			let inside = false
			for (const node of [...host!.childNodes]) {
				if (node.nodeType === 8 && node.nodeValue === `w:${settings.idPrefix}`)
					inside = true
				if (inside && node.nodeType === 8 && node.nodeValue === `/w`) {
					host!.insertBefore(anchor, node.nextSibling)
					return
				}
			}
			host!.append(anchor)
		}
		const boot = () => {
			const previous = mounting
			mounting = view
			try {
				current = factory(settings, anchor?.parentNode ? anchor : null)
			} finally {
				mounting = previous
			}
		}
		const view: View = {
			modules: new Set(),
			options: settings,
			refresh() {
				placeAnchor()
				current.dispose()
				errorNode?.remove()
				boot()
			},
			report(error) {
				const target =
					host ?? (typeof document === `undefined` ? undefined : document.body)
				if (target) {
					errorNode = target.ownerDocument.createElement(`pre`)
					errorNode.setAttribute(`data-spa-hot-error`, ``)
					errorNode.textContent = `SPA hot refresh failed: ${String(error)}`
					target.insertBefore(errorNode, anchor?.parentNode ? anchor : null)
				}
				options.onError?.(error)
			},
		}
		views.add(view)
		try {
			boot()
		} catch (error) {
			views.delete(view)
			throw error
		}
		if (view.modules.size) placeAnchor()
		return {
			flush() {
				current.flush()
			},
			dispose() {
				if (disposed) return
				disposed = true
				views.delete(view)
				errorNode?.remove()
				anchor?.remove()
				current.dispose()
			},
		}
	}
	function refreshViews(id: string): void {
		for (const view of [...views]) {
			if (!views.has(view) || !view.modules.has(id)) continue
			try {
				view.refresh()
			} catch (error) {
				view.report(error)
			}
		}
	}
	return { register, root: manage, refresh: refreshViews, track }
}

const runtime = import.meta.env.DEV ? createHotRuntime() : undefined

/** Development protocol used by the Vite transform. */
export function registerComponent<T extends Component>(
	id: string,
	name: string,
	implementation: T,
): T {
	return runtime ? runtime.register(id, name, implementation) : implementation
}
export function refresh(id: string): void {
	runtime?.refresh(id)
}
export function trackRoot(root: Root): void {
	runtime?.track(root)
}
export function hotRoot(
	factory: Factory,
	options: RootOptions,
	host?: Element,
): Handle {
	return runtime ? runtime.root(factory, options, host) : factory(options, null)
}

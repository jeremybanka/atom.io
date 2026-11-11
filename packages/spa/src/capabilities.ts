import type { Cleanup, Root, Scope } from "./core.ts"
import { isPresent, scopeCapabilities } from "./core.ts"
import type { ExitHandle, PresenceCoordinator } from "./presence.ts"

/** Native renderers expose property access without importing capability engines. */
export interface CapabilityTarget {
	kind: string
	node: unknown
	suspend?(): Cleanup
	read?(key: string): unknown
	write?(key: string, value: unknown): void
	listen?(event: string, listener: () => void): Cleanup
}
export interface CapabilityBinding {
	exit?(props: Record<string, unknown>): ExitHandle | undefined
	resume?(): void
	/** Inline CSS before native style replacement, for restoring capability-owned values. */
	update(props: Record<string, unknown>, previousStyle?: string): void
	dispose(): void
}
export interface Capability {
	namespace: string
	/** Prepare a synchronous update batch and return its commit callback. */
	beforeUpdate?(root: Root): Cleanup
	presence?(root: Root): PresenceCoordinator
	scheduleFrame?(callback: (time: number) => void): Cleanup
	/** SPA supplies ownership for integrations that measure after mount or report async errors. */
	attach(target: CapabilityTarget, scope?: Scope): CapabilityBinding
}
type EventHandler = (this: unknown, ...args: unknown[]) => unknown

export function capabilityNamespace(key: string): string | undefined {
	const colon = key.indexOf(`:`)
	if (colon < 0) return undefined
	const namespace = key.slice(0, colon)
	return /^(xml|xmlns|xlink)$/.test(namespace) ? undefined : namespace
}
function requireCapability(
	capabilities: Map<string, Capability>,
	namespace: string,
) {
	const capability = capabilities.get(namespace)
	if (!capability)
		throw new Error(
			`spa: capability "${namespace}" is not registered for this root`,
		)
	return capability
}
export function validateCapabilities(
	scope: Scope,
	props: Record<string, unknown>,
): void {
	const capabilities = scopeCapabilities(scope)
	for (const key of Object.keys(props)) {
		const namespace = capabilityNamespace(key)
		if (namespace) requireCapability(capabilities, namespace)
	}
}

/** Separate framework properties from native attributes and own their bindings. */
export function capabilityProps(
	scope: Scope,
	target: CapabilityTarget,
	read?: () => Record<string, any>,
	applyNative?: (props: Record<string, any>) => string | undefined,
): (props: Record<string, any>) => Record<string, any> {
	const root = scope._root
	const bindings = new Map<Capability, CapabilityBinding>()
	let handlers: WeakMap<EventHandler, EventHandler> | undefined
	const event = (handler: EventHandler) => {
		const cache = (handlers ??= new WeakMap())
		let wrapped = cache.get(handler)
		if (!wrapped) {
			wrapped = function (this: unknown, ...args: unknown[]) {
				// Presence may activate after this listener mounts.
				if (!root._presence || isPresent(scope)) return handler.apply(this, args)
			}
			cache.set(handler, wrapped)
		}
		return wrapped
	}

	if (root._presence) root._presence.target(scope, target)
	else (scope._targets ??= new Set()).add(target)
	const cleanup: Cleanup = () => {
		const errors: unknown[] = []
		for (const binding of [...bindings.values()].reverse()) {
			try {
				binding.dispose()
			} catch (error) {
				errors.push(error)
			}
		}
		bindings.clear()
		if (errors.length) throw new AggregateError(errors)
	}
	scope._cleanups.add(cleanup)
	return (props) => {
		const capabilities = scopeCapabilities(scope)
		const native: Record<string, any> = {}
		const groups = new Map<Capability, Record<string, unknown>>()
		for (const key of Object.keys(props)) {
			const namespace = capabilityNamespace(key)
			if (!namespace) {
				const value = props[key]
				native[key] =
					key.startsWith(`on`) && typeof value === `function`
						? event(value)
						: value
				continue
			}
			const capability = requireCapability(capabilities, namespace)
			const group = groups.get(capability) ?? {}
			group[key.slice(namespace.length + 1)] = props[key]
			groups.set(capability, group)
		}
		const previousStyle = applyNative?.(native)
		for (const [capability, values] of groups) {
			let binding = bindings.get(capability)
			if (!binding) {
				binding = capability.attach(target, scope)
				bindings.set(capability, binding)
				root._presence?.bind(
					scope,
					binding,
					read ?? (() => props),
					capability.namespace,
				)
			}
			if (previousStyle !== undefined) binding.update(values, previousStyle)
			else binding.update(values)
		}
		for (const [capability, binding] of bindings)
			if (!groups.has(capability)) {
				bindings.delete(capability)
				root._presence?.unbind(binding)
				binding.dispose()
			}
		return native
	}
}

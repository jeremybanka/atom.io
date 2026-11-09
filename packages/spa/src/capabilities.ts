import type { Cleanup, Root, Scope } from "./core.ts"
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
	presence?(root: Root): PresenceCoordinator
	scheduleFrame?(callback: (time: number) => void): Cleanup
	/** SPA supplies ownership for integrations that measure after mount or report async errors. */
	attach(target: CapabilityTarget, scope?: Scope): CapabilityBinding
}

export function capabilityNamespace(key: string): string | undefined {
	const colon = key.indexOf(`:`)
	if (colon < 0) return undefined
	const namespace = key.slice(0, colon)
	return /^(xml|xmlns|xlink)$/.test(namespace) ? undefined : namespace
}
export function validateCapabilities(
	scope: Scope,
	props: Record<string, unknown>,
): void {
	for (const key of Object.keys(props)) {
		const namespace = capabilityNamespace(key)
		if (namespace && !scope._root._capabilities.has(namespace))
			throw new Error(
				`spa: capability "${namespace}" is not registered for this root`,
			)
	}
}

/** Separate framework properties from native attributes and own their bindings. */
export function capabilityProps(
	scope: Scope,
	target: CapabilityTarget,
	read?: () => Record<string, any>,
	applyNative?: (props: Record<string, any>) => string | undefined,
): (props: Record<string, any>) => Record<string, any> {
	const bindings = new Map<string, CapabilityBinding>()

	scope._root._presence?.target(scope, target)
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
		validateCapabilities(scope, props)
		const native: Record<string, any> = {}
		const groups = new Map<string, Record<string, unknown>>()
		for (const key of Object.keys(props)) {
			const namespace = capabilityNamespace(key)
			if (!namespace) {
				const value = props[key]
				native[key] =
					key.startsWith(`on`) && typeof value === `function`
						? (scope._root._presence?.event(scope, value) ?? value)
						: value
				continue
			}
			const group = groups.get(namespace) ?? {}
			group[key.slice(namespace.length + 1)] = props[key]
			groups.set(namespace, group)
		}
		const previousStyle = applyNative?.(native)
		for (const [namespace, values] of groups) {
			let binding = bindings.get(namespace)
			if (!binding) {
				binding = scope._root._capabilities.get(namespace)!.attach(target, scope)
				bindings.set(namespace, binding)
				scope._root._presence?.bind(
					scope,
					binding,
					read ?? (() => props),
					namespace,
				)
			}
			if (previousStyle !== undefined) binding.update(values, previousStyle)
			else binding.update(values)
		}
		for (const [namespace, binding] of bindings)
			if (!groups.has(namespace)) {
				bindings.delete(namespace)
				scope._root._presence?.unbind(binding)
				binding.dispose()
			}
		return native
	}
}

import type { Cleanup, Scope } from "./core.ts"

/** Native renderers expose property access without importing capability engines. */
export interface CapabilityTarget {
	kind: string
	node: unknown
	read?(key: string): unknown
	write?(key: string, value: unknown): void
	listen?(event: string, listener: () => void): Cleanup
}
export interface CapabilityBinding {
	update(props: Record<string, unknown>): void
	dispose(): void
}
export interface Capability {
	namespace: string
	scheduleFrame?(callback: (time: number) => void): Cleanup
	attach(target: CapabilityTarget): CapabilityBinding
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
): (props: Record<string, any>) => Record<string, any> {
	const bindings = new Map<string, CapabilityBinding>()
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
				native[key] = props[key]
				continue
			}
			const group = groups.get(namespace) ?? {}
			group[key.slice(namespace.length + 1)] = props[key]
			groups.set(namespace, group)
		}
		for (const [namespace, values] of groups) {
			let binding = bindings.get(namespace)
			if (!binding) {
				binding = scope._root._capabilities.get(namespace)!.attach(target)
				bindings.set(namespace, binding)
			}
			binding.update(values)
		}
		for (const [namespace, binding] of bindings)
			if (!groups.has(namespace)) {
				bindings.delete(namespace)
				binding.dispose()
			}
		return native
	}
}

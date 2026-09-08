import type { RootStore } from "./transaction/index.ts"

export type RuntimeRegistry = {
	implicitStore: RootStore | undefined
	contexts: Map<string, unknown>
}

// Bump this protocol key whenever stores or adapter contexts become incompatible.
// Package versions and optional peer resolutions do not define runtime compatibility.
// Never adopt the legacy unversioned global: its store ABI cannot be established.
const runtimeKey = Symbol.for(`atom.io/runtime/1`)
const realm = globalThis as typeof globalThis & {
	[key: symbol]: RuntimeRegistry | undefined
}
export const RUNTIME: RuntimeRegistry = (realm[runtimeKey] ??= {
	implicitStore: undefined,
	contexts: new Map(),
})

export function runtimeContext<T>(key: string, create: () => T): T {
	if (!RUNTIME.contexts.has(key)) {
		RUNTIME.contexts.set(key, create())
	}
	return RUNTIME.contexts.get(key) as T
}

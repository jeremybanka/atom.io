export * from "./default-components.tsx"
export * from "./developer-interface.tsx"
export * from "./editors-by-type/utilities/cast-to-json.ts"

export type SetterOrUpdater<T> = <New extends T>(
	next: New | ((old: T) => New),
) => void

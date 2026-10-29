import type { RegularAtomFamilyToken, RegularAtomToken, Setter } from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	createRegularAtomFamily,
	disposeFromStore,
	findInStore,
	setIntoStore,
} from "atom.io/internal"
import type { IntrospectionStates } from "atom.io/introspection"
import { attachIntrospectionStates } from "atom.io/introspection"
import type { Accessor } from "hydrogen"
import { onCleanup, useId, useSetter, useValue } from "hydrogen"

const locals = new WeakMap<RootStore, RegularAtomFamilyToken<unknown, string>>()
const introspection = new WeakMap<RootStore, IntrospectionStates>()
export type Path = readonly string[]
export interface Tools extends IntrospectionStates {
	store: RootStore
	expanded: RegularAtomToken<Record<string, boolean>>
	error: RegularAtomToken<string>
	attempt(run: () => void): void
}

export function ownedAtom<T>(store: RootStore, initial: T): RegularAtomToken<T> {
	let family = locals.get(store)
	if (!family) {
		family = createRegularAtomFamily<unknown, string, never>(store, {
			key: `🔍 hydrogen devtools`,
			default: undefined,
		})
		locals.set(store, family)
	}
	const token = findInStore(store, family, useId()) as RegularAtomToken<T>
	setIntoStore(store, token, initial)
	onCleanup(() => {
		disposeFromStore(store, token)
	})
	return token
}
export function useLocal<T>(
	store: RootStore,
	initial: T,
): [Accessor<T>, (next: T | Setter<T>) => void] {
	const token = ownedAtom(store, initial)
	return [useValue(token) as Accessor<T>, useSetter(token)]
}
export function useSaved<T>(
	store: RootStore,
	key: string,
	fallback: T,
): [Accessor<T>, (next: T | Setter<T>) => void] {
	let initial = fallback
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(key) ?? `null`)
		if (saved !== null && typeof saved === typeof fallback) initial = saved as T
	} catch {
		/* Storage may be unavailable. */
	}
	const [value, set] = useLocal(store, initial)
	return [
		value,
		(next) => {
			set(next)
			try {
				localStorage.setItem(key, JSON.stringify(value()))
			} catch {
				/* Keep in-memory state when storage is unavailable. */
			}
		},
	]
}
export function useTools(store: RootStore): Tools {
	let states = introspection.get(store)
	if (!states) {
		states = attachIntrospectionStates(store)
		introspection.set(store, states)
	}
	let expanded: Record<string, boolean> = {}
	try {
		const saved: unknown = JSON.parse(
			localStorage.getItem(`🔍 hydrogen expanded`) ?? `{}`,
		)
		if (
			saved &&
			typeof saved === `object` &&
			!Array.isArray(saved) &&
			Object.values(saved).every((value) => typeof value === `boolean`)
		)
			expanded = saved as Record<string, boolean>
	} catch {
		/* Ignore corrupt or unavailable storage. */
	}
	const error = ownedAtom(store, ``)
	const setError = useSetter(error)
	return {
		...states,
		store,
		error,
		expanded: ownedAtom(store, expanded),
		attempt(run) {
			try {
				run()
				setError(``)
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught))
			}
		},
	}
}
export function useExpanded(
	tools: Tools,
	path: Path,
	initial = false,
): [Accessor<boolean>, (event: MouseEvent) => void] {
	const value = useValue(tools.expanded)
	const set = useSetter(tools.expanded)
	const key = JSON.stringify(path)
	const group = `all:${JSON.stringify(path.slice(0, -1))}`
	const read = () => value()[key] ?? value()[group] ?? initial
	return [
		read,
		(event) => {
			const next = !read()
			set((previous) => {
				const result = { ...previous }
				if (event.shiftKey) {
					const parent = JSON.stringify(path.slice(0, -1))
					for (const item of Object.keys(result)) {
						if (item.startsWith(`[`)) {
							const candidate = JSON.parse(item) as string[]
							if (JSON.stringify(candidate.slice(0, -1)) === parent)
								Reflect.deleteProperty(result, item)
						}
					}
					result[group] = next
				} else {
					result[key] = next
				}
				try {
					localStorage.setItem(`🔍 hydrogen expanded`, JSON.stringify(result))
				} catch {
					/* Keep in-memory expansion state. */
				}
				return result
			})
		},
	]
}

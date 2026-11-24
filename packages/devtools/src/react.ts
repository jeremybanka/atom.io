import { StoreContext } from "@atom.io/react"
import type { ReactElement } from "react"
import { createElement, useContext, useEffect, useRef } from "react"

import type {
	AtomIODevtoolsHandle,
	AtomIODevtoolsProps,
	AtomIODevtoolsTarget,
} from "./mount.ts"
import { mountAtomIODevtools } from "./mount.ts"

export type { AtomIODevtoolsProps } from "./mount.ts"

function sameTargets(
	previous: readonly AtomIODevtoolsTarget[] | undefined,
	next: readonly AtomIODevtoolsTarget[] | undefined,
): boolean {
	if (previous === next) return true
	return Boolean(
		previous &&
		next &&
		previous.length === next.length &&
		previous.every((target, index) => {
			const other = next[index]
			if (target.id !== other.id || target.label !== other.label) return false
			return target.kind === `local`
				? other.kind === `local` && target.store === other.store
				: other.kind === `remote` && target.connect === other.connect
		}),
	)
}

/** The shared SPA debugger, following the React store provider unless overridden. */
export function AtomIODevtools({
	store: explicitStore,
	stores,
	hideByDefault = false,
}: AtomIODevtoolsProps): ReactElement {
	const providerStore = useContext(StoreContext)
	const targets = stores?.length ? stores : undefined
	const store = targets ? undefined : (explicitStore ?? providerStore)
	const host = useRef<HTMLDivElement>(null)
	const mounted = useRef<
		| {
				panel: AtomIODevtoolsHandle
				store: typeof store
				targets: typeof targets
				hideByDefault: boolean
		  }
		| undefined
	>(undefined)
	useEffect(() => {
		const previous = mounted.current
		if (
			previous?.store === store &&
			previous?.hideByDefault === hideByDefault &&
			sameTargets(previous.targets, targets)
		)
			return
		mounted.current = undefined
		previous?.panel.dispose()
		const panel = mountAtomIODevtools(
			host.current!,
			store ? { store, hideByDefault } : { stores: targets!, hideByDefault },
		)
		mounted.current = { panel, store, targets, hideByDefault }
	})
	useEffect(
		() => () => {
			const previous = mounted.current
			mounted.current = undefined
			previous?.panel.dispose()
		},
		[],
	)
	return createElement(`div`, { ref: host })
}

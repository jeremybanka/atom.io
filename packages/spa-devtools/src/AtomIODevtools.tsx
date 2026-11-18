/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onMount } from "@atom.io/spa"

import css from "./AtomIODevtools.module.css"
import { type AtomIODevtoolsProps, mountAtomIODevtools } from "./mount.ts"
/** Owns a rendering root in the inspected store, independently of its parent island. */
export function AtomIODevtools(props: AtomIODevtoolsProps): SpaElement {
	let host: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		host = element
	}
	onMount(() => {
		onCleanup(mountAtomIODevtools(host!, props).dispose)
	})
	return <atom-io-devtools class={css.class} ref={attach} />
}

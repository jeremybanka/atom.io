import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onMount, useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })
function record(id: string, phase: string): void {
	if (typeof document !== `undefined`) {
		const page = document.documentElement,
			attribute = `data-${id}-${phase}`
		page.setAttribute(
			attribute,
			String(Number(page.getAttribute(attribute) ?? 0) + 1),
		)
	}
}
export default function Recovery(props: { id: string }): SpaElement {
	record(props.id, `setups`)
	onCleanup(() => {
		record(props.id, `cleanups`)
	})
	onMount(() => {
		record(props.id, `mounts`)
	})
	const count = useGetter(countAtom),
		setCount = useSetter(countAtom)
	return (
		<article data-recovery={props.id}>
			<input defaultValue="initial" />
			<button
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				{count()}
			</button>
		</article>
	)
}
Recovery.isolate = true

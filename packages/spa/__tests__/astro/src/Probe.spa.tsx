import type { VNode } from "@atom.io/spa"
import { onCleanup, onMount, useSetter, useValue } from "@atom.io/spa"
import { atom } from "atom.io"

const orderAtom = atom<string[]>({ key: `order`, default: [`a`, `b`] })
let setups = 0
let cleanups = 0
function Row(props: { name: string }) {
	setups++
	onCleanup(() => {
		cleanups++
	})
	return <input data-row={props.name} value={props.name} />
}
export default function Probe(): VNode {
	onMount(() => {
		document.getElementById(`probe`)!.dataset[`mounted`] = `true`
	})
	const order = useValue(orderAtom)
	const setOrder = useSetter(orderAtom)
	return (
		<section id="probe">
			<textarea data-lines>{`\nfirst line`}</textarea>
			<div data-enumerated draggable spellcheck={false} />
			<form data-defaults>
				<input defaultValue={'hello <&"'} />
				<input type="checkbox" defaultChecked />
				<textarea defaultValue={"\nhello <&"} />
			</form>
			<svg>
				<foreignObject>
					<p data-namespace="html">HTML in SVG</p>
				</foreignObject>
				<circle cx="1" cy="2" r="1" />
			</svg>
			{order().map((name) => (
				<Row key={name} name={name} />
			))}
			<button
				data-reorder
				onClick={() => {
					setOrder((rows) => [...rows].reverse())
				}}
			>
				Reorder
			</button>
			<button
				data-remove
				onClick={() => {
					setOrder([`a`])
				}}
			>
				Remove
			</button>
			<button
				data-stats
				onClick={(event) => {
					;(event.currentTarget as HTMLElement).textContent =
						`${setups}/${cleanups}`
				}}
			>
				Stats
			</button>
		</section>
	)
}

import type { SpaElement } from "@atom.io/spa"

export default function Constant(props: { title: string }): SpaElement {
	return <output>{props.title}</output>
}

import type { VNode } from "@atom.io/spa"

export default function Constant(props: { title: string }): VNode {
	return <output>{props.title}</output>
}

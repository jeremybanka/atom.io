import { useI, useO } from "@atom.io/react"
import { atomFamily } from "atom.io"
import { useLayoutEffect, useRef } from "react"

const heightAtoms = atomFamily<number, string>({
	key: `height`,
	default: 0,
})
export function Tooltip({ viewId, text }: { viewId: string; text: string }) {
	const node = useRef<HTMLDivElement>(null)
	const height = useO(heightAtoms, viewId)
	const setHeight = useI(heightAtoms, viewId)
	useLayoutEffect(() => {
		setHeight(node.current?.getBoundingClientRect().height ?? 0)
	}, [text, setHeight])
	return (
		<div ref={node} style={{ position: `absolute`, top: -height }}>
			{text}
		</div>
	)
}

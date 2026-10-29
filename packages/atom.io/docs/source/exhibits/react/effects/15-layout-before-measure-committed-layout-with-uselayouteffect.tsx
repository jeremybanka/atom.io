import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"

export function Tooltip({ text }: { text: string }): ReactNode {
	const node = useRef<HTMLDivElement>(null)
	const [height, setHeight] = useState(0)
	useLayoutEffect(() => {
		setHeight(node.current?.getBoundingClientRect().height ?? 0)
	}, [text])
	return (
		<div ref={node} style={{ position: `absolute`, top: -height }}>
			{text}
		</div>
	)
}

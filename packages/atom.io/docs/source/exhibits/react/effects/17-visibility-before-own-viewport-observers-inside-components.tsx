import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"

import { observeVisibility } from "./helpers.ts"

export function Card(): ReactNode {
	const node = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	useEffect(() => observeVisibility(node.current, setVisible), [])
	return <div ref={node}>{visible ? `In view` : `Outside viewport`}</div>
}

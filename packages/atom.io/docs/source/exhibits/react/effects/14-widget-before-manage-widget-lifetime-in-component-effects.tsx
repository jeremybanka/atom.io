import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"

import { createMap } from "./services.ts"

export function MapView(): ReactNode {
	const node = useRef<HTMLDivElement>(null)
	const map = useRef<ReturnType<typeof createMap> | null>(null)
	const [zoom, setZoom] = useState(1)
	useEffect(() => {
		if (!node.current) return
		map.current = createMap(node.current)
		return () => {
			map.current?.destroy()
			map.current = null
		}
	}, [])
	useEffect(() => {
		map.current?.setZoom(zoom)
	}, [zoom])
	return (
		<>
			<div ref={node} />
			<button
				type="button"
				onClick={() => {
					setZoom(zoom + 1)
				}}
			>
				Zoom in
			</button>
		</>
	)
}

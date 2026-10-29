import { useAtomicRef, useI } from "@atom.io/react"
import { atomFamily, findState, getState, subscribe } from "atom.io"
import type { ReactNode } from "react"
import { useRef } from "react"

import { createMap } from "./services.ts"

const zoomAtoms = atomFamily<number, string>({ key: `zoom`, default: 1 })
const mapNodeAtoms = atomFamily<HTMLDivElement | null, string>({
	key: `mapNode`,
	default: null,
	effects: (viewId) => [
		({ onSet }) => {
			let detach = () => {}
			onSet(({ newValue }) => {
				detach()
				detach = () => {}
				if (!newValue) return
				const map = createMap(newValue)
				const zoom = findState(zoomAtoms, viewId)
				map.setZoom(getState(zoom))
				const unsubscribe = subscribe(zoom, ({ newValue: nextZoom }) => {
					map.setZoom(nextZoom)
				})
				detach = () => {
					unsubscribe()
					map.destroy()
				}
			})
			return () => {
				detach()
			}
		},
	],
})
export function MapView({ viewId }: { viewId: string }): ReactNode {
	const node = useAtomicRef(mapNodeAtoms, viewId, useRef)
	const setZoom = useI(zoomAtoms, viewId)
	return (
		<>
			<div ref={node} />
			<button
				type="button"
				onClick={() => {
					setZoom((zoom) => zoom + 1)
				}}
			>
				Zoom in
			</button>
		</>
	)
}

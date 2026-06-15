import type { VNode } from "preact"
import * as React from "react"

import css from "./DynamicSpotlight.module.css"

export type ElementPosition = Pick<DOMRect, `height` | `left` | `top` | `width`>
export type SpotlightProps = {
	elementId: null | string
	startingPosition?: ElementPosition
	padding?: number
	updateSignals?: unknown[]
	parentRef?: React.RefObject<HTMLElement | null>
}
export function DynamicSpotlight({
	elementId,
	startingPosition = {
		top: 0,
		left: 0,
		width: 0,
		height: 0,
	},
	padding = 0,
	updateSignals = [],
	parentRef,
}: SpotlightProps): VNode | null {
	const [position, setPosition] = React.useState(startingPosition)
	React.useEffect(() => {
		if (!elementId) {
			setPosition(startingPosition)
			return
		}
		const element = document.getElementById(elementId)
		if (element) {
			const updatePosition = () => {
				const e = document.getElementById(elementId)
				if (!e) {
					return
				}
				const boundingRect = e.getBoundingClientRect()
				if (parentRef) {
					const parentRect = parentRef.current?.getBoundingClientRect()
					setPosition({
						top: boundingRect.top - (parentRect?.top ?? 0),
						left: boundingRect.left - (parentRect?.left ?? 0),
						width: boundingRect.width,
						height: boundingRect.height,
					})
				} else {
					setPosition(boundingRect)
				}
			}
			element.addEventListener(``, updatePosition)
			updatePosition()
			addEventListener(`resize`, updatePosition)
			return () => {
				removeEventListener(`resize`, updatePosition)
				element.removeEventListener(`resize`, updatePosition)
			}
		}
		setPosition(startingPosition)
	}, [elementId, ...updateSignals])

	if (position.width === 0) {
		return <dynamic-spotlight style={{ display: `none` }} />
	}

	return (
		<dynamic-spotlight
			class={css.class}
			style={{
				top: position.top - padding,
				left: position.left - padding,
				width: position.width + padding * 2,
				height: position.height + padding * 2,
			}}
		/>
	)
}

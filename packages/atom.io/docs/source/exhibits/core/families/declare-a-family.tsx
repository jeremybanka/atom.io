import { atomFamily, getState } from "atom.io"
import { useO } from "atom.io/react"
import * as React from "react"

type PointXY = { x: number; y: number }

export const pointAtoms = atomFamily<PointXY, string>({
	key: `point`,
	default: { x: 0, y: 0 },
})

getState(pointAtoms, `example`) // -> { x: 0, y: 0 }

export function Point(props: { pointId: string }): React.JSX.Element {
	const { x, y } = useO(pointAtoms, props.pointId)

	return <div className="point" style={{ left: x, top: y }} />
}

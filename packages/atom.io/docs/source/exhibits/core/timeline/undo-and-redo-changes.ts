import { getState, redo, setState, subscribe, undo } from "atom.io"

import { pointAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTimeline } from "./create-a-timeline.ts"

subscribe(coordinatesTimeline, (value) => {
	console.log(value)
})

setState(pointAtoms, `sample_key`, { x: 1, y: 0 })
getState(pointAtoms, `sample_key`) // { x: 1, y: 0 }
setState(pointAtoms, `sample_key`, { x: 2, y: 0 })
getState(pointAtoms, `sample_key`) // { x: 2, y: 0 }
undo(coordinatesTimeline)
getState(pointAtoms, `sample_key`) // { x: 1, y: 0 }
redo(coordinatesTimeline)
getState(pointAtoms, `sample_key`) // { x: 2, y: 0 }

import { getState, redo, setState, subscribe, undo } from "atom.io"

import { xAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTimeline } from "./create-a-timeline.ts"

subscribe(coordinatesTimeline, (value) => {
	console.log(value)
})

setState(xAtoms, `sample_key`, 1)
getState(xAtoms, `sample_key`) // 1
setState(xAtoms, `sample_key`, 2)
getState(xAtoms, `sample_key`) // 2
undo(coordinatesTimeline)
getState(xAtoms, `sample_key`) // 1
redo(coordinatesTimeline)
getState(xAtoms, `sample_key`) // 2

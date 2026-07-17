import { setState, subscribe } from "atom.io"

import { pointAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTimeline } from "./create-a-timeline.ts"

subscribe(coordinatesTimeline, (value) => {
	console.log(value)
})

setState(pointAtoms, `sample_key`, { x: 1, y: 0 })
/* {
  newValue: { x: 1, y: 0 },
  oldValue: { x: 0, y: 0 },
  key: `sample_key`,
  type: `atom_update`,
  timestamp: 1629780000000,
  family: {
    key: `point`,
    type: `atom_family`,
  }
} */

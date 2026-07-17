import { inspectTimeline, setState, undo } from "atom.io"

import { pointAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTimeline } from "./create-a-timeline.ts"

inspectTimeline(coordinatesTimeline) // -> { at: 0, length: 0 }

setState(pointAtoms, `sample_key`, { x: 1, y: 0 })
setState(pointAtoms, `sample_key`, { x: 2, y: 0 })

inspectTimeline(coordinatesTimeline) // -> { at: 2, length: 2 }

undo(coordinatesTimeline)

inspectTimeline(coordinatesTimeline) // -> { at: 1, length: 2 }

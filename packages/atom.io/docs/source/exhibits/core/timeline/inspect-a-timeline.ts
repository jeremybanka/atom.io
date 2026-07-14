import { inspectTimeline, setState, undo } from "atom.io"

import { xAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTimeline } from "./create-a-timeline.ts"

inspectTimeline(coordinatesTimeline) // -> { at: 0, length: 0 }

setState(xAtoms, `sample_key`, 1)
setState(xAtoms, `sample_key`, 2)

inspectTimeline(coordinatesTimeline) // -> { at: 2, length: 2 }

undo(coordinatesTimeline)

inspectTimeline(coordinatesTimeline) // -> { at: 1, length: 2 }

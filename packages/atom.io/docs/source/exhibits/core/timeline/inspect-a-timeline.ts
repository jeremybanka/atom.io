import { inspectTimeline, setState, undo } from "atom.io"

import { xAtoms } from "../families/declare-a-family.tsx"
import { coordinatesTL } from "./create-a-timeline.ts"

inspectTimeline(coordinatesTL) // -> { at: 0, length: 0 }

setState(xAtoms, `sample_key`, 1)
setState(xAtoms, `sample_key`, 2)

inspectTimeline(coordinatesTL) // -> { at: 2, length: 2 }

undo(coordinatesTL)

inspectTimeline(coordinatesTL) // -> { at: 1, length: 2 }

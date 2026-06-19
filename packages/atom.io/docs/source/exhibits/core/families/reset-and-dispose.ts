import {
	atomFamily,
	disposeState,
	getState,
	resetState,
	setState,
} from "atom.io"
import { stateExists } from "atom.io/testing"

const rowHeights = atomFamily<number, string>({
	key: `rowHeight`,
	default: 32,
})

setState(rowHeights, `header`, 48)
getState(rowHeights, `header`) // -> 48

resetState(rowHeights, `header`)
getState(rowHeights, `header`) // -> 32
stateExists(rowHeights, `header`) // -> true

disposeState(rowHeights, `header`)
stateExists(rowHeights, `header`) // -> false

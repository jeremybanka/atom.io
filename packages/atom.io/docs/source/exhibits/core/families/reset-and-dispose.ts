import {
	atomFamily,
	disposeState,
	getState,
	resetState,
	setState,
} from "atom.io"
import { stateExists } from "atom.io/testing"

const rowHeightAtoms = atomFamily<number, string>({
	key: `rowHeight`,
	default: 32,
})

setState(rowHeightAtoms, `header`, 48)
getState(rowHeightAtoms, `header`) // -> 48

resetState(rowHeightAtoms, `header`)
getState(rowHeightAtoms, `header`) // -> 32
stateExists(rowHeightAtoms, `header`) // -> true

disposeState(rowHeightAtoms, `header`)
stateExists(rowHeightAtoms, `header`) // -> false

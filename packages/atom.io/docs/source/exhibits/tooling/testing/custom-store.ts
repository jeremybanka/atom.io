import { atom } from "atom.io"
import { stateExistsInStore, takeSnapshot } from "atom.io/testing"

const countAtom = atom<number>({
	key: `count`,
	default: 0,
})

const snapshot = takeSnapshot()

stateExistsInStore(snapshot.store, countAtom) // -> true

snapshot.restore()

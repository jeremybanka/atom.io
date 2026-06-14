import { getJsonToken, getState, mutableAtom, setState } from "atom.io"
import { UList } from "atom.io/transceivers/u-list"

const selectedTagKeysAtom = mutableAtom<UList<string>>({
	key: `selectedTagKeys`,
	class: UList,
})

const selectedTagKeysJSON = getJsonToken(selectedTagKeysAtom)

getState(selectedTagKeysJSON) // -> []

setState(selectedTagKeysAtom, (selectedTagKeys) =>
	selectedTagKeys.add(`typescript`),
)

getState(selectedTagKeysJSON) // -> [`typescript`]

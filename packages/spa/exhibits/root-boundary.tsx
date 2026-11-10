import type { SpaElement } from "@atom.io/spa"
import { Root, useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"
import type { RootStore } from "atom.io/internal"

export const textAtom = atom<string>({ key: `text`, default: `` })

function Editor() {
	const getText = useGetter(textAtom)
	const setText = useSetter(textAtom)
	return (
		<textarea
			value={getText()}
			onInput={(event) => {
				setText(event.currentTarget.value)
			}}
		/>
	)
}

export function Documents(props: {
	left: RootStore
	right: RootStore
}): SpaElement {
	return (
		<>
			<Root store={props.left}>
				<Editor />
			</Root>
			<Root store={props.right}>
				<Editor />
			</Root>
		</>
	)
}

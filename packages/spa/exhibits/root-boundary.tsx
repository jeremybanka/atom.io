import type { SpaElement } from "@atom.io/spa"
import { Root, useGetter, useSetter } from "@atom.io/spa"
import { atom, Silo } from "atom.io"
import type { RootStore } from "atom.io/internal"

export const textAtom = atom<string>({ key: `text`, default: `` })

function createDocumentStore(name: string): RootStore {
	const silo = new Silo({ name, lifespan: `ephemeral`, isProduction: false })
	silo.install([textAtom])
	return silo.store
}

const leftStore = createDocumentStore(`left-document`)
const rightStore = createDocumentStore(`right-document`)

function Editor(props: { label: string }) {
	const getText = useGetter(textAtom)
	const setText = useSetter(textAtom)
	return (
		<textarea
			aria-label={props.label}
			value={getText()}
			onInput={(event) => {
				setText(event.currentTarget.value)
			}}
		/>
	)
}

export default function Documents(props: {
	left?: RootStore
	right?: RootStore
}): SpaElement {
	return (
		<>
			<Root store={props.left ?? leftStore}>
				<Editor label="Left document" />
			</Root>
			<Root store={props.right ?? rightStore}>
				<Editor label="Right document" />
			</Root>
		</>
	)
}

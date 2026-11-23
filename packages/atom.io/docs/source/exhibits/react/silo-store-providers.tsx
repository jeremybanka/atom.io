import { StoreProvider, useI, useO } from "@atom.io/react"
import { Silo } from "atom.io"
import type { JSX } from "react/jsx-runtime"

function createDocumentState(name: string) {
	const silo = new Silo({
		name,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const titleAtom = silo.atom<string>({
		key: `title`,
		default: `Untitled`,
	})
	return { silo, titleAtom }
}

const leftDocument = createDocumentState(`left-document`)
const rightDocument = createDocumentState(`right-document`)
export const leftDocumentSilo = leftDocument.silo

function TitleEditor(props: { document: typeof leftDocument; label: string }) {
	const title = useO(props.document.titleAtom)
	const setTitle = useI(props.document.titleAtom)

	return (
		<label>
			{props.label}
			<input
				value={title}
				onChange={(event) => {
					setTitle(event.currentTarget.value)
				}}
			/>
		</label>
	)
}

export default function DocumentWorkspace(): JSX.Element {
	return (
		<>
			<StoreProvider store={leftDocument.silo.store}>
				<TitleEditor document={leftDocument} label="Left document title" />
			</StoreProvider>
			<StoreProvider store={rightDocument.silo.store}>
				<TitleEditor document={rightDocument} label="Right document title" />
			</StoreProvider>
		</>
	)
}

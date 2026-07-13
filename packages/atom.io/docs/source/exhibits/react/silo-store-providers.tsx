import { Silo } from "atom.io"
import { StoreProvider, useI, useO } from "atom.io/react"
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

function TitleEditor(props: { document: typeof leftDocument }) {
	const title = useO(props.document.titleAtom)
	const setTitle = useI(props.document.titleAtom)

	return (
		<input
			aria-label={`${props.document.silo.store.config.name} title`}
			value={title}
			onChange={(event) => {
				setTitle(event.currentTarget.value)
			}}
		/>
	)
}

export function DocumentWorkspace(): JSX.Element {
	return (
		<>
			<StoreProvider store={leftDocument.silo.store}>
				<TitleEditor document={leftDocument} />
			</StoreProvider>
			<StoreProvider store={rightDocument.silo.store}>
				<TitleEditor document={rightDocument} />
			</StoreProvider>
		</>
	)
}

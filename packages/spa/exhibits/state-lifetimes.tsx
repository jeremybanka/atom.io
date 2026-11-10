import type { SpaElement } from "@atom.io/spa"
import { onCleanup, useGetter, useSetter } from "@atom.io/spa"
import { atom, atomFamily, disposeState } from "atom.io"

export const draftTextAtoms = atomFamily<string, string>({
	key: `draftText`,
	default: ``,
})
export const sessionEditsAtoms = atomFamily<number, string>({
	key: `sessionEdits`,
	default: 0,
})
export const draftGenerationAtom = atom<number>({
	key: `draftGeneration`,
	default: 0,
})

function DraftEditor(props: {
	identity: string
	session: string
	disposeDraft: (identity: string) => void
}): SpaElement {
	// Capture fixed family bindings once, using the same identity for cleanup.
	const identity = props.identity
	const disposeDraft = props.disposeDraft
	const getDraftText = useGetter(draftTextAtoms, identity)
	const setDraftText = useSetter(draftTextAtoms, identity)
	const setSessionEdits = useSetter(sessionEditsAtoms, props.session)
	onCleanup(() => {
		disposeDraft(identity)
	})
	return (
		<label>
			{identity}
			<input
				data-draft={identity}
				value={getDraftText()}
				onInput={(event) => {
					setDraftText(event.currentTarget.value)
					setSessionEdits((count) => count + 1)
				}}
			/>
		</label>
	)
}

export function DraftWorkspace(props: {
	session: string
	// For a custom root store, pass its public Silo.disposeState binding here.
	disposeDraft?: (identity: string) => void
}): SpaElement {
	const session = props.session
	const disposeDraft =
		props.disposeDraft ??
		((identity: string) => {
			disposeState(draftTextAtoms, identity)
		})
	const getDraftGeneration = useGetter(draftGenerationAtom)
	const setDraftGeneration = useSetter(draftGenerationAtom)
	const getSessionEdits = useGetter(sessionEditsAtoms, session)
	return (
		<section>
			{[`${session}/left/${getDraftGeneration()}`, `${session}/right`].map(
				(identity) => (
					<DraftEditor
						key={identity}
						identity={identity}
						session={session}
						disposeDraft={disposeDraft}
					/>
				),
			)}
			<button
				onClick={() => {
					setDraftGeneration((generation) => generation + 1)
				}}
			>
				Replace left draft
			</button>
			<output>Session edits: {getSessionEdits()}</output>
		</section>
	)
}

// The session owner calls this only after every consumer has unmounted.
export function finishDraftSession(session: string): void {
	disposeState(sessionEditsAtoms, session)
}

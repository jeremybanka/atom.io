import type { SpaElement } from "@atom.io/spa"
import {
	onCleanup,
	useDisposal,
	useGetter,
	useId,
	useSetter,
} from "@atom.io/spa"
import { atomFamily } from "atom.io"

type HelpTopic = `formatting` | `shortcuts`
type PopoverIdentity = readonly [toolbar: string, topic: HelpTopic]

export const popoverOpenAtoms = atomFamily<boolean, PopoverIdentity>({
	key: `popoverOpen`,
	default: false,
})
export const formattingHelpVisibleAtoms = atomFamily<boolean, string>({
	key: `formattingHelpVisible`,
	default: true,
})

function HelpTrigger(props: {
	identity: PopoverIdentity
	panelId: string
}): SpaElement {
	const getOpen = useGetter(popoverOpenAtoms, props.identity)
	const setOpen = useSetter(popoverOpenAtoms, props.identity)
	return (
		<button
			aria-controls={props.panelId}
			aria-expanded={getOpen()}
			aria-haspopup="dialog"
			onClick={() => {
				setOpen((open) => !open)
			}}
		>
			{props.identity[1]} help
		</button>
	)
}

function HelpPanel(props: {
	identity: PopoverIdentity
	panelId: string
}): SpaElement {
	const getOpen = useGetter(popoverOpenAtoms, props.identity)
	return (
		<div
			id={props.panelId}
			role="dialog"
			aria-label={`${props.identity[1]} help`}
			hidden={!getOpen()}
		>
			{props.identity[1] === `formatting`
				? `Select text, then choose bold or italic from the toolbar.`
				: `Use Ctrl+Z to undo and Ctrl+Shift+Z to redo.`}
		</div>
	)
}

function HelpPopover(props: { identity: PopoverIdentity }): SpaElement {
	const identity = props.identity
	const panelId = useId()
	const dispose = useDisposal()
	// This owner outlives both consumers of the ambient visibility state.
	onCleanup(() => {
		dispose(popoverOpenAtoms, identity)
	})
	return (
		<section data-help={`${identity[0]}/${identity[1]}`}>
			<HelpTrigger identity={identity} panelId={panelId} />
			<HelpPanel identity={identity} panelId={panelId} />
		</section>
	)
}

export function HelpToolbar(props: { id: string }): SpaElement {
	const toolbar = props.id
	const getFormattingHelpVisible = useGetter(formattingHelpVisibleAtoms, toolbar)
	const setFormattingHelpVisible = useSetter(formattingHelpVisibleAtoms, toolbar)
	const dispose = useDisposal()
	onCleanup(() => {
		dispose(formattingHelpVisibleAtoms, toolbar)
	})
	return (
		<nav aria-label={`${toolbar} help`}>
			{(getFormattingHelpVisible()
				? ([`formatting`, `shortcuts`] as const)
				: ([`shortcuts`] as const)
			).map((topic) => (
				<HelpPopover key={topic} identity={[toolbar, topic]} />
			))}
			<button
				onClick={() => {
					setFormattingHelpVisible((visible) => !visible)
				}}
			>
				{getFormattingHelpVisible() ? `Hide` : `Show`} formatting help
			</button>
		</nav>
	)
}

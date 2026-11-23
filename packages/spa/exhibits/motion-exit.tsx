import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

const visibleAtom = atom<boolean>({ key: `visible`, default: true })
export default function DismissiblePanel(): SpaElement {
	const getVisible = useGetter(visibleAtom)
	const setVisible = useSetter(visibleAtom)
	return (
		<section>
			<button
				onClick={() => {
					setVisible((value) => !value)
				}}
			>
				Toggle panel
			</button>
			{getVisible() && (
				<sliding-panel
					key="panel"
					motion:initial={{ opacity: 0, y: 12 }}
					motion:animate={{ opacity: 1, y: 0 }}
					motion:exit={{ opacity: 0, y: -12 }}
					motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				>
					The same instance returns if toggled before its exit completes.
				</sliding-panel>
			)}
		</section>
	)
}

DismissiblePanel.capabilities = [motionCapability()]

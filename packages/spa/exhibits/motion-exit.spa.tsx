import type { VNode } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const visibleAtom = atom<boolean>({ key: `visible`, default: true })
export function DismissiblePanel(): VNode {
	const visible = useGetter(visibleAtom)
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
			{visible() && (
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

import type { SpaElement } from "@atom.io/spa"
import { useGetter, useId, useRef, useSetter } from "@atom.io/spa"
import { flip, offset, shift } from "@floating-ui/dom"
import { atomFamily } from "atom.io"

const floatingOpenAtoms = atomFamily<boolean, string>({
	key: `floatingOpen`,
	default: false,
})
const floatingTriggerAtoms = atomFamily<HTMLButtonElement | null, string>({
	key: `floatingTrigger`,
	default: null,
})
const middleware = [offset(8), flip(), shift({ padding: 8 })]

export function FloatingDetails(props: { id: string }): SpaElement {
	const getOpen = useGetter(floatingOpenAtoms, props.id)
	const setOpen = useSetter(floatingOpenAtoms, props.id)
	const getTrigger = useGetter(floatingTriggerAtoms, props.id)
	const attachTrigger = useRef(floatingTriggerAtoms, props.id)
	const panelId = useId()
	return (
		<>
			<button
				ref={attachTrigger}
				aria-expanded={getOpen()}
				aria-controls={panelId}
				onClick={() => {
					setOpen((value) => !value)
				}}
			>
				Details
			</button>
			{getOpen() && (
				<section
					key="details"
					id={panelId}
					aria-label="Details"
					style="width: 240px; margin: 0"
					floating:reference={getTrigger()}
					floating:placement="bottom-start"
					floating:middleware={middleware}
					motion:initial={{ opacity: 0, y: -4, scale: 0.98 }}
					motion:animate={{ opacity: 1, y: 0, scale: 1 }}
					motion:exit={{ opacity: 0, y: -4, scale: 0.98 }}
				>
					More information about this item.
				</section>
			)}
		</>
	)
}

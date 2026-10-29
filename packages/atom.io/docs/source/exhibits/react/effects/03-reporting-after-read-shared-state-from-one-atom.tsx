import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import type { ReactNode } from "react"

const enabledAtom = atom<boolean>({ key: `enabled`, default: false })
export function Toggle(): ReactNode {
	const enabled = useO(enabledAtom)
	const setEnabled = useI(enabledAtom)
	return (
		<button
			type="button"
			onClick={() => {
				setEnabled((value) => !value)
			}}
		>
			{String(enabled)}
		</button>
	)
}
export function Parent(): ReactNode {
	const enabled = useO(enabledAtom)
	return (
		<section>
			<Toggle />
			<output>Feature {enabled ? `on` : `off`}</output>
		</section>
	)
}

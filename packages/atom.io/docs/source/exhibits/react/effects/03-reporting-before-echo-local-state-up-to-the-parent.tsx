import type { ReactNode } from "react"
import { useEffect, useState } from "react"

function Toggle({
	onChange,
}: {
	onChange: (enabled: boolean) => void
}): ReactNode {
	const [enabled, setEnabled] = useState(false)
	useEffect(() => {
		onChange(enabled)
	}, [enabled, onChange])
	return (
		<button
			type="button"
			onClick={() => {
				setEnabled(!enabled)
			}}
		>
			{String(enabled)}
		</button>
	)
}

export default function Parent(): ReactNode {
	const [enabled, setEnabled] = useState(false)
	return (
		<section>
			<Toggle onChange={setEnabled} />
			<output>Feature {enabled ? `on` : `off`}</output>
		</section>
	)
}

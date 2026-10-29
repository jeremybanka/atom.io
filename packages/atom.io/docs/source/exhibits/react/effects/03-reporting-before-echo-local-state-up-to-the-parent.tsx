import { useEffect, useState } from "react"

export function Toggle({ onChange }: { onChange: (enabled: boolean) => void }) {
	const [enabled, setEnabled] = useState(false)
	useEffect(() => {
		onChange(enabled)
	}, [enabled, onChange])
	return (
		<button type="button" onClick={() => setEnabled(!enabled)}>
			{String(enabled)}
		</button>
	)
}

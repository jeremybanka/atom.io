import type { SpaElement } from "@atom.io/spa"
import { useId } from "@atom.io/spa"

export function EmailField(): SpaElement {
	const id = useId()
	return (
		<>
			<label for={id}>Email address</label>
			<input id={id} name="email" type="email" autoComplete="email" />
		</>
	)
}

import type { SpaElement } from "@atom.io/spa"

export function ContactFields(): SpaElement {
	return (
		<>
			<label>
				Name <input name="name" autoComplete="name" />
			</label>
			<label>
				Email <input name="email" type="email" autoComplete="email" />
			</label>
		</>
	)
}

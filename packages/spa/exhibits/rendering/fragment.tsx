import type { VNode } from "@atom.io/spa"

export function ContactFields(): VNode {
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

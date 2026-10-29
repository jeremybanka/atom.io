/**
 * Compile-only illustration of the proposed compiler/renderer protocol.
 * The caller already owns the nodes and has created the accessor during setup.
 * connect is declaration-only; this is not executable generated output.
 */
import type { Accessor, RenderOwner } from "./water-api.proposal.ts"
import { connect } from "./water-api.proposal.ts"

export function connectPointTargets(
	owner: RenderOwner,
	point: Accessor<{ x: number; y: number }>,
	circle: SVGCircleElement,
	label: Text,
): void {
	connect(owner, () => point().x, {
		write(x) {
			circle.setAttribute(`cx`, String(x))
		},
	})
	connect(owner, () => point().y, {
		write(y) {
			circle.setAttribute(`cy`, String(y))
		},
	})
	connect(
		owner,
		() => {
			const { x, y } = point()
			return `(${x}, ${y})`
		},
		{
			write(text) {
				label.data = text
			},
		},
	)
}

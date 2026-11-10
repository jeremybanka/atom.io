import type { SpaElement } from "@atom.io/spa"
import type {} from "@atom.io/spa/motion"

export function TurnBanner(): SpaElement {
	return (
		<aside
			motion:animate={{
				x: [`-1500%`, `2%`, `4%`, `1500%`],
				skewX: [`-50deg`, `-5deg`, `-5deg`, `-50deg`],
				width: [`20vw`, `90vw`, `90vw`, `10vw`],
				opacity: [0, 1, 1, 0],
			}}
			motion:transition={{
				duration: 3,
				times: [0, 0.1, 0.77, 1],
				ease: [`circOut`, `linear`, `easeIn`],
				properties: { opacity: { times: [0, 0.2, 0.8, 1], ease: `linear` } },
			}}
		>
			Next turn
		</aside>
	)
}

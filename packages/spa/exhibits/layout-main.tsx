import { render } from "@atom.io/spa"
import { layoutCapability } from "@atom.io/spa/layout"
import { motionCapability } from "@atom.io/spa/motion"

import { ReadinessBoard } from "./layout.tsx"

const host = document.querySelector(`#app`)!
const root = render(() => <ReadinessBoard />, host, {
	capabilities: [
		motionCapability(),
		layoutCapability({ transition: { duration: 0.3, ease: `easeInOut` } }),
	],
})

export const disposeBoard = root.dispose

import { render } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionPanel } from "./motion.spa.tsx"

render(() => <MotionPanel />, document.getElementById(`app`)!, {
	capabilities: [motionCapability()],
})

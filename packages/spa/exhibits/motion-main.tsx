import { render } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionPanel } from "./motion.tsx"

render(() => <MotionPanel />, document.getElementById(`app`)!, {
	capabilities: [motionCapability()],
})

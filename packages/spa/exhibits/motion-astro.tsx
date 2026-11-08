import type { SpaElement } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionPanel } from "./motion-basic.tsx"

export default function MotionIsland(): SpaElement {
	return <MotionPanel />
}

MotionIsland.capabilities = [motionCapability()]

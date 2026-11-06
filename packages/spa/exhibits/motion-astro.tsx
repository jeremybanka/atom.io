import type { VNode } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionPanel } from "./motion-basic.tsx"

export default function MotionIsland(): VNode {
	return <MotionPanel />
}

MotionIsland.capabilities = [motionCapability()]

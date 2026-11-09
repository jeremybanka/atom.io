import { render } from "@atom.io/spa"
import { floatingCapability } from "@atom.io/spa/floating"
import { motionCapability } from "@atom.io/spa/motion"

import { FloatingDetails } from "./floating.tsx"

render(() => <FloatingDetails id="details" />, document.getElementById(`app`)!, {
	capabilities: [floatingCapability(), motionCapability()],
})

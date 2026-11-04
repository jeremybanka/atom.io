import "./motion-sandbox.css"

import { render } from "@atom.io/spa"

import { MotionLab } from "./MotionLab.tsx"

const root = render(
	() => <MotionLab />,
	document.querySelector(`motion-lab-root`)!,
	{
		capabilities: MotionLab.capabilities,
	},
)
import.meta.hot?.dispose(root.dispose)

import "@atom.io/water-devtools/css"

import type { Component } from "@atom.io/water"
import {
	AtomIODevtools,
	type AtomIODevtoolsProps,
} from "@atom.io/water-devtools"

export const component: Component<AtomIODevtoolsProps> = AtomIODevtools
export const props: AtomIODevtoolsProps = { hideByDefault: true }

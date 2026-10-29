import "@atom.io/hydrogen-devtools/css"

import type { Component } from "@atom.io/hydrogen"
import {
	AtomIODevtools,
	type AtomIODevtoolsProps,
} from "@atom.io/hydrogen-devtools"

export const component: Component<AtomIODevtoolsProps> = AtomIODevtools
export const props: AtomIODevtoolsProps = { hideByDefault: true }

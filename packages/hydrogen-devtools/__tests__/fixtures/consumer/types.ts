import "@atom.io/hydrogen-devtools/css"

import {
	AtomIODevtools,
	type AtomIODevtoolsProps,
} from "@atom.io/hydrogen-devtools"
import type { Component } from "hydrogen"

export const component: Component<AtomIODevtoolsProps> = AtomIODevtools
export const props: AtomIODevtoolsProps = { hideByDefault: true }

import "@atom.io/spa-devtools/css"

import type { Component } from "@atom.io/spa"
import { AtomIODevtools, type AtomIODevtoolsProps } from "@atom.io/spa-devtools"

export const component: Component<AtomIODevtoolsProps> = AtomIODevtools
export const props: AtomIODevtoolsProps = { hideByDefault: true }

import "@atom.io/devtools/css"

import type { AtomIODevtoolsProps } from "@atom.io/devtools/react"
import { AtomIODevtools } from "@atom.io/devtools/react"
import type { ReactElement } from "react"
import { createElement } from "react"

export const props: AtomIODevtoolsProps = { hideByDefault: true }
export const element: ReactElement = createElement(AtomIODevtools, props)

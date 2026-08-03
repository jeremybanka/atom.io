import type { DeepReadonly } from "atom.io/foundations/type-utils"

type DocumentView = DeepReadonly<{
	metadata: { author: string }
	pages: string[]
}>

declare const document: DocumentView

document.metadata.author // string; assignment is forbidden
document.pages // readonly string[]

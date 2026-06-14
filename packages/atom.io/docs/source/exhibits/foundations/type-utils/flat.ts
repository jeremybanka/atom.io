import type { Flat } from "atom.io/foundations/type-utils"

type Intersected = { id: string } & { done: boolean }
type Readable = Flat<Intersected>

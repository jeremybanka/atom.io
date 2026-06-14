import type { ViewOf } from "atom.io/foundations/type-utils"

type ListView = ViewOf<string[]> // readonly string[]
type SetView = ViewOf<Set<string>> // ReadonlySet<string>

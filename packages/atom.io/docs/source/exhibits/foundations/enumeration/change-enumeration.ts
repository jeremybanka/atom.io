import { enumeration } from "atom.io/foundations/enumeration"

const change = enumeration([`add`, `delete`, `clear`] as const)

change.add // 0
change.delete // 1
change.clear // 2

change[0] // "add"
change[1] // "delete"
change[2] // "clear"

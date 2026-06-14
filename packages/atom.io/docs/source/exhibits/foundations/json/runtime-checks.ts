import { isJson } from "atom.io/foundations/json"

isJson({ ok: true }) // true
isJson(new Set()) // false

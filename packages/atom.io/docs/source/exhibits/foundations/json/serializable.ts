import { type Json, parseJson, stringifyJson } from "atom.io/foundations/json"

const value = {
	id: `playlist:road-trip`,
	tracks: [`dreams`, `ventura-highway`],
} satisfies Json.Serializable

const encoded = stringifyJson(value)
const decoded = parseJson<typeof value>(encoded)

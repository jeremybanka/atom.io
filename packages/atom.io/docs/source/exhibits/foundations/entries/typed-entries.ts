import { fromEntries, toEntries } from "atom.io/foundations/entries"

const flags = {
	visible: true,
	locked: false,
}

const entries = toEntries(flags)
const rebuilt = fromEntries(entries)

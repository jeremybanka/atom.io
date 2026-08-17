import { mosaicText } from "atom.io/realtime"
import { bench, describe } from "vitest"

const GRAPHEME_COUNT = 50_000
const Text = mosaicText()
const document = new Text()

document.change(
	{ text: `x`.repeat(GRAPHEME_COUNT), type: `replace-text` },
	{
		actor: `benchmark`,
		dependencies: [],
		group: `benchmark`,
		id: `benchmark`,
		now: 0,
		revision: null,
		session: `benchmark`,
	},
)

const runCheckpoint = document.toJSON()
const graphemeNodeReference = Array.from(
	{ length: GRAPHEME_COUNT },
	(_, index) => ({
		after: index === 0 ? null : `operation:node:${index - 1}`,
		before: null,
		createdBy: `operation`,
		id: `operation:node:${index}`,
		value: `x`,
	}),
)

describe(`Mosaic text checkpoint serialization`, () => {
	bench(`run-oriented checkpoint`, () => {
		JSON.stringify(runCheckpoint)
	})

	bench(`grapheme-node reference`, () => {
		JSON.stringify(graphemeNodeReference)
	})
})

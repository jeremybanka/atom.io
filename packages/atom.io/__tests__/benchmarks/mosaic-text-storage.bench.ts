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

const runCheckpointBytes = JSON.stringify(runCheckpoint).length
const graphemeNodeReferenceBytes = JSON.stringify(graphemeNodeReference).length
const durableRunObjects = runCheckpoint.runs.length

// These are intentionally generous gates rather than machine-sensitive timing
// assertions. A run checkpoint must retain its order-of-magnitude storage and
// resident-object advantage before serialization throughput is benchmarked.
if (runCheckpointBytes * 10 >= graphemeNodeReferenceBytes) {
	throw new Error(
		`Run checkpoint exceeded 10% of the grapheme-node reference bytes`,
	)
}
if (durableRunObjects * 100 >= GRAPHEME_COUNT) {
	throw new Error(
		`Durable run objects exceeded 1% of the grapheme-node reference objects`,
	)
}

describe(`Mosaic text checkpoint serialization`, () => {
	bench(`run-oriented checkpoint`, () => {
		JSON.stringify(runCheckpoint)
	})

	bench(`grapheme-node reference`, () => {
		JSON.stringify(graphemeNodeReference)
	})
})

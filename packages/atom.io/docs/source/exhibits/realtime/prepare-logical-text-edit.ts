import { mosaicText } from "atom.io/realtime"

const Text = mosaicText({
	maximumRunGraphemes: 65_536,
	maximumRunUtf16Units: 1_000_000,
	maximumRunsPerOperation: 65_536,
})
const document = new Text()

const signal = document.prepare(
	{
		selection: {
			anchor: { affinity: `right`, offset: 0, runId: null },
			head: { affinity: `left`, offset: 0, runId: null },
		},
		text: `# One logical document`,
		type: `replace-selection`,
	},
	{
		actor: `ada`,
		dependencies: [],
		group: `ada:import:1`,
		id: `ada:import:1:source`,
		now: Date.now(),
		revision: null,
		session: `ada:browser`,
	},
)

if (signal !== null) {
	const nextVisibleRuns = document.preview(signal)
	// Compose derived index maintenance from nextVisibleRuns, then propose both
	// operation families in one Domain batch. The accepted batch calls do().
	void nextVisibleRuns
}

import fs from "node:fs/promises"
const median = (a) => {
	a = a.filter((x) => Number.isFinite(x)).sort((left, right) => left - right)
	return a.length ? a[Math.floor(a.length / 2)] : null
}
const data = JSON.parse(
	await fs.readFile(process.argv[2] ?? "results-main.json", "utf8"),
)
const groups = Map.groupBy(data, (r) =>
	[r.profile, r.scenario, r.variant].join("|"),
)
const summary = []
for (const [key, rs] of groups) {
	const m = (f) => median(rs.map(f))
	const startupJS = (r) =>
		r.startup.resources
			.filter((x) => x.url.endsWith(".js"))
			.reduce((s, x) => s + x.bytes, 0)
	summary.push({
		profile: rs[0].profile,
		case: rs[0].scenario,
		variant: rs[0].variant,
		n: rs.length,
		fcp: m((r) => r.startup.fcp),
		startupScriptMs: m((r) => r.startup.metrics.ScriptDuration * 1000),
		startupTaskMs: m((r) => r.startup.metrics.TaskDuration * 1000),
		hydrationMs: m((r) => r.startup.hydrate),
		ready: m((r) => r.startup.ready),
		htmlGzip: m((r) => r.startup.htmlEncoded),
		jsGzip: m(startupJS),
		totalGzip: m(
			(r) =>
				r.startup.htmlEncoded +
				r.startup.resources.reduce((s, x) => s + x.bytes, 0),
		),
		setups: m((r) => r.startup.setups),
		longTasks: m((r) => r.startup.longtasks.length),
		maxLongTask: m((r) =>
			Math.max(0, ...r.startup.longtasks.map((t) => t.duration)),
		),
		firstDOM: m((r) => r.first.click.dom),
		firstPaint: m((r) => r.first.click.paint),
		firstScriptDelta: m(
			(r) =>
				(r.first.metrics.ScriptDuration - r.startup.metrics.ScriptDuration) *
				1000,
		),
		warmPaint: m((r) => median(r.warm.map((c) => c.paint))),
		denseMs: m((r) => r.denseMs),
		endSetups: m((r) => r.end.setups),
		correct: rs.every(
			(r) => r.errors.length === 0 && r.end.allQuantitiesCorrect,
		),
		rangeScript: [
			Math.min(...rs.map((r) => r.startup.metrics.ScriptDuration * 1000)),
			Math.max(...rs.map((r) => r.startup.metrics.ScriptDuration * 1000)),
		],
	})
}
console.log(JSON.stringify(summary, null, 2))

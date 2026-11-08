import fs from "node:fs/promises"
import { render as spa } from "./build/spa.mjs"
import { render as resume } from "./build/spike.mjs"
const results = []
for (const count of [12, 200, 1000])
	for (const [variant, render] of [
		["spa", spa],
		["resume", resume],
	]) {
		const props = { count, work: 0, below: false, precomputed: false }
		for (let rep = -2; rep < 15; rep++) {
			const start = performance.now()
			const result = render(props)
			const duration = performance.now() - start
			if (rep >= 0)
				results.push({
					count,
					variant,
					rep,
					duration,
					htmlBytes: Buffer.byteLength(
						typeof result === "string" ? result : result.html,
					),
				})
		}
	}
await fs.writeFile("results-ssr.json", JSON.stringify(results, null, 2))
console.log("Completed", results.length, "warm SSR samples")

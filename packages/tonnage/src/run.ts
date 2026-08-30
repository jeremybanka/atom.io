import fs from "node:fs/promises"
import path from "node:path"

import { updateGeneratedSection } from "./readme.ts"
import { createTonnageReport, renderTonnageMarkdown } from "./report.ts"
import type { TonnageConfig, TonnageMode, TonnageRunResult } from "./types.ts"

export async function runTonnage(
	config: TonnageConfig,
	options: {
		configDirectory?: string
		mode: TonnageMode
	},
): Promise<TonnageRunResult> {
	const configDirectory = path.resolve(options.configDirectory ?? process.cwd())
	const readmePath = path.resolve(configDirectory, config.readme ?? `README.md`)
	const oldReadme = await fs.readFile(readmePath, `utf8`)
	const report = await createTonnageReport(config, configDirectory)
	const markdown = renderTonnageMarkdown(report, config)
	const newReadme = updateGeneratedSection(oldReadme, markdown, config.marker)
	const changed = oldReadme !== newReadme

	if (options.mode === `write` && changed) {
		await fs.writeFile(readmePath, newReadme)
	}

	return { changed, readmePath, report }
}

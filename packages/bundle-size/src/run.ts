import fs from "node:fs/promises"
import path from "node:path"

import { updateGeneratedSection } from "./readme.ts"
import { createBundleSizeReport, renderBundleSizeMarkdown } from "./report.ts"
import type {
	BundleSizeConfig,
	BundleSizeMode,
	BundleSizeRunResult,
} from "./types.ts"

export async function runBundleSize(
	config: BundleSizeConfig,
	options: {
		configDirectory?: string
		mode: BundleSizeMode
	},
): Promise<BundleSizeRunResult> {
	const configDirectory = path.resolve(options.configDirectory ?? process.cwd())
	const readmePath = path.resolve(configDirectory, config.readme ?? `README.md`)
	const oldReadme = await fs.readFile(readmePath, `utf8`)
	const report = await createBundleSizeReport(config, configDirectory)
	const markdown = renderBundleSizeMarkdown(report, config)
	const newReadme = updateGeneratedSection(oldReadme, markdown, config.marker)
	const changed = oldReadme !== newReadme

	if (options.mode === `write` && changed) {
		await fs.writeFile(readmePath, newReadme)
	}

	return { changed, readmePath, report }
}

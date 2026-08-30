import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, test } from "vitest"

import {
	bundleSizeMarkers,
	createBundleSizeReport,
	measureImports,
	renderBundleSizeMarkdown,
	runBundleSize,
	updateGeneratedSection,
} from "../src/index.ts"

describe(`bundle-size reports`, () => {
	test(`measures the actual bundled output`, async () => {
		const fixture = await makeFixture()
		const measurement = await measureImports([fixture.entryPath], {
			resolveDirectory: fixture.directory,
		})

		expect(measurement.rawBytes).toBeGreaterThan(1_000)
		expect(measurement.gzipBytes).toBeGreaterThan(0)
		expect(measurement.gzipBytes).toBeLessThan(measurement.rawBytes)
	})

	test(`discovers package exports and deduplicates recipe graphs`, async () => {
		const fixture = await makeFixture()
		const config = {
			packageJson: `package.json`,
			recipes: [
				{
					imports: [`fixture-package`, `fixture-package/feature`],
					name: `Everything`,
				},
			],
		}
		const report = await createBundleSizeReport(config, fixture.directory)

		expect(report.exports.map((row) => row.name)).toEqual([
			`fixture-package`,
			`fixture-package/feature`,
		])
		expect(report.recipes).toHaveLength(1)
		expect(report.recipes[0]?.rawBytes).toBeLessThan(
			(report.exports[0]?.rawBytes ?? 0) + (report.exports[1]?.rawBytes ?? 0),
		)
		expect(renderBundleSizeMarkdown(report)).toContain(`shared modules`)
	})

	test(`writes generated README sections and detects drift`, async () => {
		const fixture = await makeFixture()
		const { end, start } = bundleSizeMarkers(`fixture`)
		await fs.writeFile(
			fixture.readmePath,
			[`# Fixture`, ``, start, `stale`, end, ``].join(`\n`),
		)
		const config = {
			marker: `fixture`,
			packageJson: `package.json`,
			readme: `README.md`,
		}

		const stale = await runBundleSize(config, {
			configDirectory: fixture.directory,
			mode: `check`,
		})
		expect(stale.changed).toBe(true)

		const written = await runBundleSize(config, {
			configDirectory: fixture.directory,
			mode: `write`,
		})
		expect(written.changed).toBe(true)

		const current = await runBundleSize(config, {
			configDirectory: fixture.directory,
			mode: `check`,
		})
		expect(current.changed).toBe(false)
	})

	test(`requires one ordered marker pair`, () => {
		expect(() => updateGeneratedSection(`# README`, `report`)).toThrow(
			`README must contain exactly one`,
		)
	})
})

async function makeFixture(): Promise<{
	directory: string
	entryPath: string
	readmePath: string
}> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), `bundle-size-test-`))
	const entryPath = path.join(directory, `index.js`)
	const featurePath = path.join(directory, `feature.js`)
	const readmePath = path.join(directory, `README.md`)
	const compressibleText = `atom.io bundle-size `.repeat(200)

	await Promise.all([
		fs.writeFile(
			path.join(directory, `package.json`),
			JSON.stringify({
				exports: {
					".": `./index.js`,
					"./feature": `./feature.js`,
					"./package.json": `./package.json`,
				},
				name: `fixture-package`,
				type: `module`,
			}),
		),
		fs.writeFile(
			entryPath,
			`export { feature } from "./feature.js"; export const text = ${JSON.stringify(compressibleText)};`,
		),
		fs.writeFile(featurePath, `export const feature = "feature";`),
		fs.writeFile(readmePath, `# Fixture\n`),
	])

	return { directory, entryPath, readmePath }
}

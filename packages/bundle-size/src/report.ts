import fs from "node:fs/promises"
import path from "node:path"

import { measureImports } from "./measure.ts"
import type {
	BundleSizeConfig,
	BundleSizeExports,
	BundleSizeReport,
	BundleSizeRow,
} from "./types.ts"

type PackageJson = {
	exports?: unknown
	name?: string
	peerDependencies?: Record<string, string>
}

export async function createBundleSizeReport(
	config: BundleSizeConfig,
	configDirectory: string,
): Promise<BundleSizeReport> {
	const packageJsonPath = path.resolve(
		configDirectory,
		config.packageJson ?? `package.json`,
	)
	const packageJson = JSON.parse(
		await fs.readFile(packageJsonPath, `utf8`),
	) as PackageJson
	if (!packageJson.name) {
		throw new Error(`${packageJsonPath} does not declare a package name.`)
	}

	const resolveDirectory = path.dirname(packageJsonPath)
	const peerDependencies = Object.keys(packageJson.peerDependencies ?? {})
	const external = unique([...peerDependencies, ...(config.external ?? [])])
	const exportImports = selectExportImports(
		packageJson.name,
		packageJson.exports,
		config.exports,
	)

	const exportRows = await Promise.all(
		exportImports.map(async (specifier): Promise<BundleSizeRow> => ({
			...(await measureImports([specifier], {
				external,
				platform: config.platform,
				resolveDirectory,
				target: config.target,
			})),
			imports: [specifier],
			name: specifier,
		})),
	)
	const recipeRows = await Promise.all(
		(config.recipes ?? []).map(async (recipe): Promise<BundleSizeRow> => ({
			...(await measureImports(recipe.imports, {
				external: unique([...external, ...(recipe.external ?? [])]),
				platform: recipe.platform ?? config.platform,
				resolveDirectory,
				target: config.target,
			})),
			imports: recipe.imports,
			name: recipe.name,
		})),
	)

	return {
		exports: exportRows,
		packageName: packageJson.name,
		recipes: recipeRows,
	}
}

export function renderBundleSizeMarkdown(
	report: BundleSizeReport,
	config: BundleSizeConfig = {},
): string {
	const lines = [
		`## ${config.heading ?? `Bundle size`}`,
		``,
		`Each row bundles the real public entry points, retains their complete runtime export surfaces, and reports exact minified and level-9 gzip byte counts. Peer dependencies stay external. Recipe imports are bundled together, so shared modules are counted once.`,
	]

	if (report.exports.length > 0) {
		lines.push(
			``,
			`### Public modules`,
			``,
			...markdownTable(
				[`Import`, `Minified`, `Gzip`],
				report.exports.map((row) => [
					code(row.name),
					formatBytes(row.rawBytes),
					formatBytes(row.gzipBytes),
				]),
				[`left`, `right`, `right`],
			),
		)
	}

	if (report.recipes.length > 0) {
		lines.push(
			``,
			`### Common recipes`,
			``,
			...markdownTable(
				[`Recipe`, `Public imports`, `Minified`, `Gzip`],
				report.recipes.map((row) => [
					escapeCell(row.name),
					row.imports.map(code).join(`<br>`),
					formatBytes(row.rawBytes),
					formatBytes(row.gzipBytes),
				]),
				[`left`, `left`, `right`, `right`],
			),
		)
	}

	return lines.join(`\n`)
}

function selectExportImports(
	packageName: string,
	exportsValue: unknown,
	selection: BundleSizeConfig[`exports`],
): string[] {
	if (selection === false) {
		return []
	}

	const exportKeys = getExportKeys(exportsValue)
	const options: BundleSizeExports =
		typeof selection === `object` ? selection : {}
	const included = options.include
		? [...options.include]
		: exportKeys.filter((exportKey) => exportKey !== `./package.json`)
	const excluded = new Set(options.exclude ?? [])

	return included
		.filter((exportKey) => !excluded.has(exportKey))
		.map((exportKey) => toPackageImport(packageName, exportKey))
}

function getExportKeys(exportsValue: unknown): string[] {
	if (typeof exportsValue === `string` || Array.isArray(exportsValue)) {
		return [`.`]
	}
	if (!exportsValue || typeof exportsValue !== `object`) {
		return [`.`]
	}

	const keys = Object.keys(exportsValue)
	return keys.some((key) => key.startsWith(`.`)) ? keys : [`.`]
}

function toPackageImport(packageName: string, exportKey: string): string {
	if (exportKey === `.`) {
		return packageName
	}
	if (!exportKey.startsWith(`./`)) {
		throw new Error(`Invalid package export key: ${exportKey}`)
	}
	return `${packageName}/${exportKey.slice(2)}`
}

function formatBytes(bytes: number): string {
	return `${new Intl.NumberFormat(`en-US`).format(bytes)} B`
}

function code(value: string): string {
	return `<code>${escapeCell(value)}</code>`
}

function escapeCell(value: string): string {
	return value.replaceAll(`&`, `&amp;`).replaceAll(`|`, `&#124;`)
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)]
}

function markdownTable(
	headings: readonly string[],
	rows: readonly (readonly string[])[],
	alignments: readonly (`left` | `right`)[],
): string[] {
	const widths = headings.map((heading, column) =>
		Math.max(heading.length, ...rows.map((row) => row[column]?.length ?? 0), 3),
	)
	const renderRow = (cells: readonly string[]): string =>
		`| ${cells.map((cell, column) => padCell(cell, widths[column] ?? 3, alignments[column] ?? `left`)).join(` | `)} |`
	const separator = widths.map((width, column) =>
		alignments[column] === `right`
			? `${`-`.repeat(width - 1)}:`
			: `-`.repeat(width),
	)

	return [renderRow(headings), renderRow(separator), ...rows.map(renderRow)]
}

function padCell(
	cell: string,
	width: number,
	alignment: `left` | `right`,
): string {
	return alignment === `right` ? cell.padStart(width) : cell.padEnd(width)
}

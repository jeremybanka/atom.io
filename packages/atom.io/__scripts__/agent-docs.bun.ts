#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"

import {
	type ExhibitReference,
	extractExhibitCode,
	parseExhibitReference,
} from "@atom.io/exhibits"

type StructuredDoc = {
	body: string
	file: string
	frontmatter: {
		order?: number
		packages: string[]
		related: string[]
		slug: string
		summary: string
		title: string
	}
}

type DocPage = {
	output: string
	source: string
	title: string
	url: string
}

type ExampleDoc = {
	output: string
	source: string
	title: string
}

const SCRIPT_ROOT = path.dirname(new URL(import.meta.url).pathname)
const ATOM_IO_ROOT = path.resolve(SCRIPT_ROOT, `..`)
const WORKSPACE_ROOT = path.resolve(ATOM_IO_ROOT, `../..`)
const ATOM_IO_FYI_ROOT = path.join(WORKSPACE_ROOT, `apps`, `atom.io.fyi`)
const DOCS_SOURCE_ROOT = path.join(ATOM_IO_ROOT, `docs`, `source`)
const PACKAGE_AGENT_DOCS_ROOT = path.join(ATOM_IO_ROOT, `docs`, `agent`)
const SITE_AGENT_DOCS_ROOT = path.join(ATOM_IO_FYI_ROOT, `agent-docs`)
const PUBLIC_ROOT = path.join(ATOM_IO_FYI_ROOT, `public`)
const CONCEPTS_ROOT = path.join(DOCS_SOURCE_ROOT, `concepts`)
const EXHIBITS_ROOT = path.join(DOCS_SOURCE_ROOT, `exhibits`)
const BACKTICK = `\``
const FENCE = BACKTICK.repeat(3)
const SHOULD_WRITE_SITE_OUTPUT = process.argv.includes(`--site`)

const DOC_PAGES: DocPage[] = [
	{
		output: `getting-started.md`,
		source: `docs/source/pages/docs/getting-started.mdx`,
		title: `getting started`,
		url: `/docs/getting-started`,
	},
	{
		output: `tutorial.md`,
		source: `docs/source/pages/docs/tutorial.mdx`,
		title: `tutorial`,
		url: `/docs/tutorial`,
	},
	{
		output: `remote-data.md`,
		source: `docs/source/pages/docs/remote-data.mdx`,
		title: `remote data`,
		url: `/docs/remote-data`,
	},
	{
		output: `typesafe-router.md`,
		source: `docs/source/pages/docs/typesafe-router.mdx`,
		title: `typesafe router`,
		url: `/docs/typesafe-router`,
	},
	{
		output: `atom-io-vs-others.md`,
		source: `docs/source/pages/docs/atom-io-vs-others.mdx`,
		title: `atom.io vs others`,
		url: `/docs/atom-io-vs-others`,
	},
	{
		output: `understand-atom-io.md`,
		source: `docs/source/pages/docs/understand-atom-io.mdx`,
		title: `understand atom.io`,
		url: `/docs`,
	},
	{
		output: `atom.io.md`,
		source: `docs/source/pages/docs/index.mdx`,
		title: `atom.io`,
		url: `/docs/atom-io`,
	},
	{
		output: `atom.io-react.md`,
		source: `docs/source/pages/docs/react.mdx`,
		title: `atom.io/react`,
		url: `/docs/react`,
	},
	{
		output: `atom.io-foundations.md`,
		source: `docs/source/pages/docs/foundations.mdx`,
		title: `atom.io/foundations`,
		url: `/docs/foundations`,
	},
	{
		output: `atom.io-foundations-json.md`,
		source: `docs/source/pages/docs/foundations/json.mdx`,
		title: `atom.io/foundations/json`,
		url: `/docs/foundations/json`,
	},
	{
		output: `atom.io-foundations-canonical.md`,
		source: `docs/source/pages/docs/foundations/canonical.mdx`,
		title: `atom.io/foundations/canonical`,
		url: `/docs/foundations/canonical`,
	},
	{
		output: `atom.io-foundations-entries.md`,
		source: `docs/source/pages/docs/foundations/entries.mdx`,
		title: `atom.io/foundations/entries`,
		url: `/docs/foundations/entries`,
	},
	{
		output: `atom.io-foundations-enumeration.md`,
		source: `docs/source/pages/docs/foundations/enumeration.mdx`,
		title: `atom.io/foundations/enumeration`,
		url: `/docs/foundations/enumeration`,
	},
	{
		output: `atom.io-foundations-type-utils.md`,
		source: `docs/source/pages/docs/foundations/type-utils.mdx`,
		title: `atom.io/foundations/type-utils`,
		url: `/docs/foundations/type-utils`,
	},
	{
		output: `atom.io-foundations-future.md`,
		source: `docs/source/pages/docs/foundations/future.mdx`,
		title: `atom.io/foundations/future`,
		url: `/docs/foundations/future`,
	},
	{
		output: `atom.io-foundations-subject.md`,
		source: `docs/source/pages/docs/foundations/subject.mdx`,
		title: `atom.io/foundations/subject`,
		url: `/docs/foundations/subject`,
	},
	{
		output: `atom.io-foundations-overlays.md`,
		source: `docs/source/pages/docs/foundations/overlays.mdx`,
		title: `atom.io/foundations/overlays`,
		url: `/docs/foundations/overlays`,
	},
	{
		output: `atom.io-foundations-junction.md`,
		source: `docs/source/pages/docs/foundations/junction.mdx`,
		title: `atom.io/foundations/junction`,
		url: `/docs/foundations/junction`,
	},
	{
		output: `atom.io-web.md`,
		source: `docs/source/pages/docs/web.mdx`,
		title: `atom.io/web`,
		url: `/docs/web`,
	},
	{
		output: `atom.io-transceivers.md`,
		source: `docs/source/pages/transceivers.mdx`,
		title: `atom.io/transceivers`,
		url: `/transceivers`,
	},
	{
		output: `atom.io-eslint-plugin.md`,
		source: `docs/source/pages/docs/eslint-plugin.mdx`,
		title: `atom.io/eslint-plugin`,
		url: `/docs/eslint-plugin`,
	},
	{
		output: `atom.io-react-devtools.md`,
		source: `docs/source/pages/docs/react-devtools.mdx`,
		title: `atom.io/react-devtools`,
		url: `/docs/react-devtools`,
	},
	{
		output: `atom.io-testing.md`,
		source: `docs/source/pages/docs/testing.mdx`,
		title: `atom.io/testing`,
		url: `/docs/testing`,
	},
]

function getLanguage(filepath: string): string {
	const extension = filepath.endsWith(`.txt`)
		? filepath.slice(0, -`.txt`.length).split(`.`).pop()
		: filepath.split(`.`).pop()
	switch (extension) {
		case `sh`:
			return `bash`
		case `js`:
			return `javascript`
		case `jsx`:
			return `jsx`
		case `ts`:
			return `ts`
		case `tsx`:
			return `tsx`
		case undefined:
			return `text`
		default:
			return `text`
	}
}

function slugToTitle(slug: string): string {
	return slug
		.split(`/`)
		.at(-1)!
		.replace(/\.[^.]+$/, ``)
		.replaceAll(`-`, ` `)
}

function cleanText(value: string): string {
	return value
		.replaceAll(/\/\*[\s\S]*?\*\//g, ``)
		.replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, ``)
		.replaceAll(/<code>([\s\S]*?)<\/code>/g, (_match, code: string) => {
			return `\`${code.trim()}\``
		})
		.replaceAll(/<[^>]+>/g, ``)
		.replaceAll(/\s+/g, ` `)
		.trim()
}

function parseListValue(value: string): string[] {
	const trimmed = value.trim()
	if (!trimmed) {
		return []
	}
	if (trimmed.startsWith(`[`) && trimmed.endsWith(`]`)) {
		return trimmed
			.slice(1, -1)
			.split(`,`)
			.map((item) => item.trim().replace(/^["']|["']$/g, ``))
			.filter(Boolean)
	}
	return [trimmed.replace(/^["']|["']$/g, ``)]
}

function parseFrontmatter(contents: string): {
	body: string
	frontmatter: Record<string, string[] | string>
} {
	if (!contents.startsWith(`---\n`)) {
		return { body: contents, frontmatter: {} }
	}
	const end = contents.indexOf(`\n---`, 4)
	if (end === -1) {
		return { body: contents, frontmatter: {} }
	}
	const frontmatterText = contents.slice(4, end)
	const body = contents.slice(end + `\n---`.length).trimStart()
	const frontmatter: Record<string, string[] | string> = {}
	const lines = frontmatterText.split(`\n`)
	let activeListKey: string | null = null

	for (const line of lines) {
		const listItem = line.match(/^\s*-\s+(.*)$/)
		if (listItem && activeListKey) {
			const current = frontmatter[activeListKey]
			if (Array.isArray(current)) {
				current.push(listItem[1].trim())
			}
			continue
		}

		const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
		if (!keyValue) {
			activeListKey = null
			continue
		}
		const [, key, value] = keyValue
		if (value === ``) {
			frontmatter[key] = []
			activeListKey = key
			continue
		}
		frontmatter[key] =
			value.includes(`,`) || value.startsWith(`[`)
				? parseListValue(value)
				: value.replace(/^["']|["']$/g, ``)
		activeListKey = null
	}

	return { body, frontmatter }
}

function readStructuredDoc(contents: string, file: string): StructuredDoc {
	const { body, frontmatter } = parseFrontmatter(contents)
	const packages = frontmatter[`packages`] ?? `atom.io`
	const related = frontmatter[`related`] ?? ``
	const rawOrder = Array.isArray(frontmatter[`order`])
		? Number.NaN
		: Number(frontmatter[`order`])
	return {
		body,
		file,
		frontmatter: {
			...(Number.isFinite(rawOrder) ? { order: rawOrder } : {}),
			packages: Array.isArray(packages) ? packages : parseListValue(packages),
			related: Array.isArray(related) ? related : parseListValue(related),
			slug: Array.isArray(frontmatter[`slug`])
				? path.basename(file).replace(/\.mdx?$/, ``)
				: (frontmatter[`slug`] ?? path.basename(file).replace(/\.mdx?$/, ``)),
			summary: Array.isArray(frontmatter[`summary`])
				? ``
				: (frontmatter[`summary`] ?? ``),
			title: Array.isArray(frontmatter[`title`])
				? slugToTitle(file)
				: (frontmatter[`title`] ?? slugToTitle(file)),
		},
	}
}

function extractImportMap(contents: string): Map<string, string> {
	const importMap = new Map<string, string>()
	for (const match of contents.matchAll(
		/import\s+([A-Za-z0-9_]+)\s+from\s+["']x\/([^"']+)\.gen["'];?/g,
	)) {
		importMap.set(match[1], match[2])
	}
	return importMap
}

function stripMdxBoilerplate(contents: string): string {
	return contents
		.replaceAll(/^import\s+.+$/gm, ``)
		.replaceAll(/<\/?Layout>/g, ``)
		.replaceAll(/<span[^>]*>([\s\S]*?)<\/span>/g, `$1`)
		.replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, ``)
}

function findSelfClosingTagEnd(contents: string, start: number): number {
	let quote: string | null = null
	let escaped = false
	let braceDepth = 0

	for (let index = start; index < contents.length - 1; index++) {
		const char = contents[index]
		const next = contents[index + 1]

		if (quote) {
			if (escaped) {
				escaped = false
				continue
			}
			if (char === `\\`) {
				escaped = true
				continue
			}
			if (char === quote) {
				quote = null
			}
			continue
		}

		if (char === `"` || char === `'` || char === BACKTICK) {
			quote = char
			continue
		}
		if (char === `{`) {
			braceDepth++
			continue
		}
		if (char === `}` && braceDepth > 0) {
			braceDepth--
			continue
		}
		if (char === `/` && next === `>` && braceDepth === 0) {
			return index + 2
		}
	}

	return -1
}

function readQuotedAttribute(
	attributes: string,
	name: string,
): string | undefined {
	const match = attributes.match(new RegExp(`${name}="([^"]*)"`))
	return match?.[1]
}

function readCodeExpression(attributes: string): string | undefined {
	const start = attributes.indexOf(`code={`)
	if (start === -1) {
		return undefined
	}
	const expressionStart = start + `code={`.length
	let quote: string | null = null
	let escaped = false
	let braceDepth = 1

	for (let index = expressionStart; index < attributes.length; index++) {
		const char = attributes[index]

		if (quote) {
			if (escaped) {
				escaped = false
				continue
			}
			if (char === `\\`) {
				escaped = true
				continue
			}
			if (char === quote) {
				quote = null
			}
			continue
		}

		if (char === `"` || char === `'` || char === BACKTICK) {
			quote = char
			continue
		}
		if (char === `{`) {
			braceDepth++
			continue
		}
		if (char === `}`) {
			braceDepth--
			if (braceDepth === 0) {
				return attributes.slice(expressionStart, index)
			}
		}
	}

	return undefined
}

function cookCodeExpression(expression: string): string {
	// Static docs literals are trusted source files and may contain escaped
	// template text that is easier to decode through the JavaScript parser.
	// oxlint-disable-next-line @typescript-eslint/no-implied-eval
	return Function(`return (${expression})`)() as string
}

function renderCodeBlock({
	code,
	filepath,
	label,
	source,
}: {
	code: string
	filepath: string
	label?: string
	source?: string
}): string {
	const title = label ?? filepath
	const lines = [`### ${title}`]
	if (source) {
		lines.push(`Source: ${source}`)
	}
	lines.push(``, `${FENCE}${getLanguage(filepath)}`, code.trimEnd(), FENCE)
	return lines.join(`\n`)
}

function replaceCodeBlocks(contents: string): string {
	let output = ``
	let cursor = 0

	while (cursor < contents.length) {
		const start = contents.indexOf(`<CodeBlock`, cursor)
		if (start === -1) {
			output += contents.slice(cursor)
			break
		}
		const end = findSelfClosingTagEnd(contents, start)
		if (end === -1) {
			output += contents.slice(cursor)
			break
		}

		output += contents.slice(cursor, start)
		const attributes = contents.slice(start + `<CodeBlock`.length, end - 2)
		const filepath = readQuotedAttribute(attributes, `filepath`) ?? `code`
		const label = readQuotedAttribute(attributes, `label`)
		const expression = readCodeExpression(attributes)
		if (expression) {
			const codeBlockOptions: {
				code: string
				filepath: string
				label?: string
			} = {
				code: cookCodeExpression(expression),
				filepath,
			}
			if (label !== undefined) {
				codeBlockOptions.label = label
			}
			output += `\n${renderCodeBlock(codeBlockOptions)}\n`
		} else {
			output += `\n[interactive/example omitted: CodeBlock]\n`
		}
		cursor = end
	}

	return output
}

async function resolveExhibitSource(
	relativeImport: string,
): Promise<string | null> {
	const candidates = [
		`.ts`,
		`.tsx`,
		`.js`,
		`.jsx`,
		`.txt`,
		`.ts.txt`,
		`.tsx.txt`,
		`.js.txt`,
		`.jsx.txt`,
	].map((extension) => path.join(EXHIBITS_ROOT, `${relativeImport}${extension}`))

	for (const candidate of candidates) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {
			// Try the next source-file extension.
		}
	}

	const directory = path.join(EXHIBITS_ROOT, path.dirname(relativeImport))
	try {
		const entries = await fs.readdir(directory, { withFileTypes: true })
		const basename = path.basename(relativeImport)
		for (const entry of entries) {
			if (!entry.isFile()) {
				continue
			}
			const displayFilename = entry.name.endsWith(`.txt`)
				? entry.name.slice(0, -`.txt`.length)
				: entry.name
			const generatedBasename = displayFilename.replace(/\.[^.]+$/, ``)
			if (generatedBasename === basename) {
				return path.join(directory, entry.name)
			}
		}
	} catch {
		// Fall through to an omitted exhibit marker.
	}
	return null
}

async function resolveExhibitSourcePath(src: string): Promise<{
	reference: ExhibitReference
	sourcePath: string
} | null> {
	const reference = parseExhibitReference(src)
	const normalized = reference.source
	const exactSourcePath = path.join(EXHIBITS_ROOT, normalized)
	try {
		const stat = await fs.stat(exactSourcePath)
		if (stat.isFile()) {
			return { reference, sourcePath: exactSourcePath }
		}
	} catch {
		// Fall back to the legacy extension resolution below.
	}
	const sourcePath = await resolveExhibitSource(
		normalized.replace(/(?:\.txt)?\.[^.]+$/, ``),
	)
	return sourcePath ? { reference, sourcePath } : null
}

function titleFromExhibitSource(src: string): string {
	return slugToTitle(src.replace(/\.txt$/, ``))
}

async function replaceExhibits(
	contents: string,
	importMap: Map<string, string>,
): Promise<string> {
	let output = ``
	let cursor = 0
	const componentPattern = /<([A-Z][A-Za-z0-9_]*)\b[^>]*\/>/g

	for (const match of contents.matchAll(componentPattern)) {
		const [tag, componentName] = match
		const index = match.index ?? 0
		output += contents.slice(cursor, index)
		if (componentName === `Exhibit`) {
			const src = readQuotedAttribute(tag, `src`)
			if (!src) {
				throw new Error(`Exhibit is missing a src attribute.`)
			}
			const resolved = await resolveExhibitSourcePath(src)
			if (!resolved) {
				throw new Error(`Unknown exhibit source: ${src}`)
			}

			const sourceCode = await fs.readFile(resolved.sourcePath, `utf8`)
			const code = extractExhibitCode(sourceCode, resolved.reference)
			const source =
				path.relative(ATOM_IO_ROOT, resolved.sourcePath) +
				(resolved.reference.region ? `#${resolved.reference.region}` : ``)
			output += `\n${renderCodeBlock({
				code,
				filepath: path.basename(resolved.sourcePath).replace(/\.txt$/, ``),
				label:
					readQuotedAttribute(tag, `label`) ??
					titleFromExhibitSource(resolved.reference.source),
				source,
			})}\n`
			cursor = index + tag.length
			continue
		}

		const relativeImport = importMap.get(componentName)
		if (!relativeImport) {
			output += tag
			cursor = index + tag.length
			continue
		}

		const sourcePath = await resolveExhibitSource(relativeImport)
		if (!sourcePath) {
			output += `\n[interactive/example omitted: ${componentName}]\n`
			cursor = index + tag.length
			continue
		}

		const code = await fs.readFile(sourcePath, `utf8`)
		const source = path.relative(ATOM_IO_ROOT, sourcePath)
		output += `\n${renderCodeBlock({
			code,
			filepath: path.basename(sourcePath).replace(/\.txt$/, ``),
			label: slugToTitle(relativeImport),
			source,
		})}\n`
		cursor = index + tag.length
	}

	output += contents.slice(cursor)
	return output
}

function convertTables(contents: string): string {
	return contents.replaceAll(/<table>[\s\S]*?<\/table>/g, (table) => {
		const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
			.map((row) => {
				return [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
					.map((cell) => cleanText(cell[1]))
					.filter(Boolean)
			})
			.filter((row) => row.length > 0)

		if (rows.length === 0) {
			return `\n[interactive/table omitted]\n`
		}

		const header = rows[0].some((cell) => cell.toLowerCase() === `exports`)
			? rows.shift()!
			: [`Export`, `Description`]
		const width = Math.max(header.length, ...rows.map((row) => row.length))
		const normalize = (row: string[]): string[] => {
			return Array.from({ length: width }, (_, index) => row[index] ?? ``)
		}
		const headerCells = normalize(header)
		const separator = headerCells.map(() => `---`)
		const bodyRows = rows.map(normalize)
		return [
			``,
			`| ${headerCells.join(` | `)} |`,
			`| ${separator.join(` | `)} |`,
			...bodyRows.map((row) => `| ${row.join(` | `)} |`),
			``,
		].join(`\n`)
	})
}

function omitUnknownJsx(contents: string): string {
	return contents
		.split(/(```[\s\S]*?```)/g)
		.map((part) => {
			if (part.startsWith(FENCE)) {
				return part
			}
			return part
				.replaceAll(
					/<([A-Z][A-Za-z0-9_.]*)[^>]*>[\s\S]*?<\/\1>/g,
					(_tag, name) => {
						return `\n[interactive/example omitted: ${name}]\n`
					},
				)
				.replaceAll(/<([A-Z][A-Za-z0-9_.]*)[^>]*\/>/g, (_tag, name) => {
					return `\n[interactive/example omitted: ${name}]\n`
				})
		})
		.join(``)
}

function normalizeMarkdown(contents: string): string {
	const normalized = contents
		.replaceAll(/\n[ \t]+\n/g, `\n\n`)
		.replaceAll(/\n{3,}/g, `\n\n`)
		.trim()

	return `${normalized}\n`
}

async function renderDocPage(page: DocPage): Promise<string> {
	const sourcePath = path.join(ATOM_IO_ROOT, page.source)
	const raw = await fs.readFile(sourcePath, `utf8`)
	const importMap = extractImportMap(raw)
	const stripped = stripMdxBoilerplate(raw)
	const withTables = convertTables(stripped)
	const withCodeBlocks = replaceCodeBlocks(withTables)
	const withExhibits = await replaceExhibits(withCodeBlocks, importMap)
	const withoutJsx = omitUnknownJsx(withExhibits)
	return normalizeMarkdown(
		[
			`# ${page.title}`,
			``,
			`Source: ${page.source}`,
			`URL: ${page.url}`,
			``,
			withoutJsx,
		].join(`\n`),
	)
}

async function renderStructuredBody(
	doc: StructuredDoc,
	options?: {
		bodyTransform?: (body: string) => string
	},
): Promise<string> {
	const importMap = extractImportMap(doc.body)
	const stripped = stripMdxBoilerplate(doc.body)
	const withTables = convertTables(stripped)
	const withCodeBlocks = replaceCodeBlocks(withTables)
	const withExhibits = await replaceExhibits(withCodeBlocks, importMap)
	const withoutJsx = omitUnknownJsx(withExhibits)
	return options?.bodyTransform ? options.bodyTransform(withoutJsx) : withoutJsx
}

async function renderStructuredDoc(
	doc: StructuredDoc,
	options?: {
		bodyTransform?: (body: string) => string
	},
): Promise<string> {
	const { frontmatter } = doc
	return normalizeMarkdown(
		[
			`# ${frontmatter.title}`,
			``,
			frontmatter.summary,
			``,
			`Source: ${doc.file}`,
			`Packages: ${frontmatter.packages.join(`, `)}`,
			`Related: ${frontmatter.related.join(`, `) || `none`}`,
			``,
			await renderStructuredBody(doc, options),
		].join(`\n`),
	)
}

async function renderExampleDoc(sourcePath: string): Promise<{
	doc: string
	entry: ExampleDoc
}> {
	const code = await fs.readFile(sourcePath, `utf8`)
	const source = path.relative(ATOM_IO_ROOT, sourcePath)
	const output = source
		.replace(/^docs\/source\/exhibits\//, ``)
		.replace(/\.txt$/, ``)
		.replace(/\.[^.]+$/, `.md`)
	const title = slugToTitle(output)
	const doc = normalizeMarkdown(
		[
			`# ${title}`,
			``,
			`Source: ${source}`,
			``,
			`${FENCE}${getLanguage(sourcePath)}`,
			code.trimEnd(),
			FENCE,
		].join(`\n`),
	)
	return { doc, entry: { output, source, title } }
}

async function listFiles(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name)
			if (entry.isDirectory()) {
				return listFiles(entryPath)
			}
			return [entryPath]
		}),
	)
	return files.flat().sort()
}

async function writeFile(file: string, contents: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, contents)
}

async function resetDirectory(directory: string): Promise<void> {
	await fs.rm(directory, { force: true, recursive: true })
	await fs.mkdir(directory, { recursive: true })
}

async function copyDirectory(from: string, to: string): Promise<void> {
	await resetDirectory(to)
	const files = await listFiles(from)
	await Promise.all(
		files.map(async (file) => {
			const relative = path.relative(from, file)
			await writeFile(path.join(to, relative), await fs.readFile(file, `utf8`))
		}),
	)
}

async function readPackageVersion(): Promise<string> {
	const packageJson = JSON.parse(
		await fs.readFile(path.join(ATOM_IO_ROOT, `package.json`), `utf8`),
	) as { version?: string }
	return packageJson.version ?? `0.0.0`
}

async function main(): Promise<void> {
	await resetDirectory(PACKAGE_AGENT_DOCS_ROOT)

	const conceptFiles = (await listFiles(CONCEPTS_ROOT)).filter((file) =>
		file.endsWith(`.md`),
	)
	const concepts = await Promise.all(
		conceptFiles.map(async (file) => {
			return readStructuredDoc(
				await fs.readFile(file, `utf8`),
				path.relative(ATOM_IO_ROOT, file),
			)
		}),
	)
	concepts.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title))

	for (const concept of concepts) {
		await writeFile(
			path.join(
				PACKAGE_AGENT_DOCS_ROOT,
				`concepts`,
				`${concept.frontmatter.slug}.md`,
			),
			await renderStructuredDoc(concept),
		)
	}

	const docEntries = []
	for (const page of DOC_PAGES) {
		const contents = await renderDocPage(page)
		await writeFile(
			path.join(PACKAGE_AGENT_DOCS_ROOT, `packages`, page.output),
			contents,
		)
		docEntries.push({
			output: `packages/${page.output}`,
			source: page.source,
			title: page.title,
			url: page.url,
		})
	}

	const exampleFiles = (await listFiles(EXHIBITS_ROOT)).filter((file) =>
		/\.(?:[cm]?[jt]sx?|txt)$/.test(file),
	)
	const exampleEntries: ExampleDoc[] = []
	for (const exampleFile of exampleFiles) {
		const { doc, entry } = await renderExampleDoc(exampleFile)
		await writeFile(
			path.join(PACKAGE_AGENT_DOCS_ROOT, `examples`, entry.output),
			doc,
		)
		exampleEntries.push({
			...entry,
			output: `examples/${entry.output}`,
		})
	}

	const version = await readPackageVersion()
	const manifest = {
		version,
		concepts: concepts.map((concept) => ({
			output: `concepts/${concept.frontmatter.slug}.md`,
			packages: concept.frontmatter.packages,
			related: concept.frontmatter.related,
			slug: concept.frontmatter.slug,
			source: concept.file,
			summary: concept.frontmatter.summary,
			title: concept.frontmatter.title,
		})),
		docs: docEntries,
		examples: exampleEntries.sort((a, b) => a.output.localeCompare(b.output)),
	}

	const readme = normalizeMarkdown(
		[
			`# atom.io agent docs`,
			``,
			`This directory is generated from atom.io-owned docs source for AI agents working in projects that use atom.io.`,
			`Use these files when you need to implement, debug, review, or repair atom.io code without browsing the web.`,
			`The corpus is plain Markdown, easy to grep, and organized around concepts, package guides, patterns, and source-linked examples.`,
			``,
			`Start with:`,
			``,
			`- concepts/atom.md for the core state primitive`,
			`- concepts/selector.md for derived state`,
			`- concepts/transaction.md for coordinated state changes`,
			`- concepts/timeline.md for undo and redo`,
			`- concepts/join.md for relations across atom families`,
			`- packages/atom.io.md for the main package docs`,
			`- packages/atom.io-react.md for React bindings`,
			`- packages/remote-data.md for fetched, queried, and RPC-backed state`,
			`- packages/typesafe-router.md for typesafe router guidance with TreeTrunks`,
			`- examples/ for original exhibit source files`,
			`- manifest.json for a deterministic index of every generated doc`,
			``,
			`Loadable reminder for generated code and review:`,
			``,
			`- useLoadable(...) in render observes and hydrates the state`,
			`- atomFamily keyed by route params or query input makes cache identity explicit`,
			`- resetState(...) in a mount effect is suspicious because it usually causes duplicate async work`,
			`- resetState(...) after a mutation, retry, explicit refresh, or test setup is intentional invalidation`,
			``,
			`Short version: Read is hydration. Key is identity. Reset is invalidation.`,
			``,
			`The source of truth remains the authored files under packages/atom.io/docs/source in the atom.io repository.`,
		].join(`\n`),
	)
	await writeFile(path.join(PACKAGE_AGENT_DOCS_ROOT, `README.md`), readme)
	await writeFile(path.join(PACKAGE_AGENT_DOCS_ROOT, `AGENTS.md`), readme)
	await writeFile(
		path.join(PACKAGE_AGENT_DOCS_ROOT, `manifest.json`),
		`${JSON.stringify(manifest, null, `\t`)}\n`,
	)

	if (SHOULD_WRITE_SITE_OUTPUT) {
		await copyDirectory(PACKAGE_AGENT_DOCS_ROOT, SITE_AGENT_DOCS_ROOT)

		const llmsTxt = normalizeMarkdown(
			[
				`# atom.io`,
				``,
				`atom.io is a versatile state engine for TypeScript applications.`,
				``,
				`Agent documentation:`,
				``,
				`- Full generated corpus: /llms-full.txt`,
				`- Concepts glossary: /docs/concepts`,
				`- Main docs: /docs`,
				`- Remote/RPC data guide: /docs/remote-data`,
				`- typesafe router guide: /docs/typesafe-router`,
				`- React bindings: /docs/react`,
				`- Foundations and transceivers: /docs/foundations and /transceivers`,
				``,
				`The generated corpus is owned by atom.io, shipped in the atom.io package at docs/agent, and mirrored on atom.io.fyi for web access.`,
			].join(`\n`),
		)
		await writeFile(path.join(PUBLIC_ROOT, `llms.txt`), llmsTxt)

		const llmsFullParts = [
			readme,
			...(await Promise.all(
				concepts.map((concept) => renderStructuredDoc(concept)),
			)),
			...(await Promise.all(DOC_PAGES.map(renderDocPage))),
		]
		await writeFile(
			path.join(PUBLIC_ROOT, `llms-full.txt`),
			normalizeMarkdown(llmsFullParts.join(`\n\n---\n\n`)),
		)
	}
}

await main()

import path from "node:path"

import { parse } from "@babel/parser"
import * as t from "@babel/types"

export interface ExhibitFile {
	file: string
	source: string
	code: string
}

export type ExhibitFramework = `react` | `spa` | `solid`

function frameworkFromImport(source: string): ExhibitFramework | undefined {
	if (/^(?:react(?:-dom)?|@atom\.io\/react)(?:\/|$)/.test(source)) return `react`
	if (/^@atom\.io\/spa(?:\/|$)/.test(source)) return `spa`
	if (/^(?:solid-js|@solidjs\/web|@atom\.io\/solid)(?:\/|$)/.test(source))
		return `solid`
}

function isFunction(node: t.Node | null | undefined): boolean {
	return (
		t.isFunctionDeclaration(node) ||
		t.isFunctionExpression(node) ||
		t.isArrowFunctionExpression(node)
	)
}

function hasDefaultFunction(body: readonly t.Statement[]): boolean {
	const functions = new Set<string>()
	let defaultBinding: string | undefined
	for (const statement of body) {
		if (t.isExportDefaultDeclaration(statement)) {
			if (isFunction(statement.declaration)) return true
			if (t.isIdentifier(statement.declaration))
				defaultBinding = statement.declaration.name
		}
		if (t.isExportNamedDeclaration(statement) && !statement.source) {
			for (const specifier of statement.specifiers) {
				if (
					t.isExportSpecifier(specifier) &&
					(t.isIdentifier(specifier.exported, { name: `default` }) ||
						t.isStringLiteral(specifier.exported, { value: `default` }))
				)
					defaultBinding = t.isIdentifier(specifier.local)
						? specifier.local.name
						: specifier.local.value
			}
		}
		const declaration = t.isExportNamedDeclaration(statement)
			? statement.declaration
			: statement
		if (t.isFunctionDeclaration(declaration) && declaration.id)
			functions.add(declaration.id.name)
		if (t.isVariableDeclaration(declaration)) {
			for (const { id, init } of declaration.declarations) {
				if (t.isIdentifier(id) && isFunction(init)) functions.add(id.name)
			}
		}
	}
	return defaultBinding !== undefined && functions.has(defaultBinding)
}

function parseExhibit({ file, code }: ExhibitFile) {
	if (!/\.tsx?$/.test(file) || file.endsWith(`.d.ts`)) return null
	let ast: t.File
	try {
		ast = parse(code, {
			sourceType: `module`,
			plugins: file.endsWith(`.tsx`) ? [`typescript`, `jsx`] : [`typescript`],
		})
	} catch (error) {
		if (error instanceof SyntaxError) return null
		throw error
	}
	const imports = new Set<string>()
	const frameworks = new Set<ExhibitFramework>()
	let hasJsx = false
	let unresolved = false
	t.traverseFast(ast, (node) => {
		if (t.isJSXElement(node) || t.isJSXFragment(node)) hasJsx = true
		if (t.isImportDeclaration(node)) {
			const framework = frameworkFromImport(node.source.value)
			if (framework) frameworks.add(framework)
		}
		if (t.isImportDeclaration(node) && node.importKind !== `type`) {
			if (
				node.specifiers.length === 0 ||
				node.specifiers.some(
					(item) => !t.isImportSpecifier(item) || item.importKind !== `type`,
				)
			)
				imports.add(node.source.value)
		}
		if (
			(t.isExportNamedDeclaration(node) || t.isExportAllDeclaration(node)) &&
			node.exportKind !== `type` &&
			node.source
		)
			imports.add(node.source.value)
		if (t.isImportExpression(node)) {
			if (t.isStringLiteral(node.source)) imports.add(node.source.value)
			else unresolved = true
		}
	})
	let unsupportedJsx = false
	for (const comment of ast.comments ?? []) {
		const source = /@jsxImportSource\s+(\S+)/.exec(comment.value)?.[1]
		if (source === undefined) continue
		const framework = frameworkFromImport(source)
		if (framework) frameworks.add(framework)
		else unsupportedJsx = true
	}
	return unresolved
		? null
		: {
				imports,
				frameworks,
				hasJsx,
				defaultFunction: hasDefaultFunction(ast.program.body),
				unsupportedJsx,
			}
}

const runtimePackages =
	/^(?:atom\.io(?:\/(?:foundations|transceivers)\/[^/]+|\/(?:web|internal|introspection|testing))?|@atom\.io\/(?:spa|react|solid)(?:\/[\w-]+)?|react(?:\/jsx(?:-dev)?-runtime)?|react-dom(?:\/client)?|solid-js|@solidjs\/web(?:\/jsx(?:-dev)?-runtime)?|three)$/

export interface ExhibitSandbox extends ExhibitFile {
	ecology: boolean
	preview: ExhibitFramework | null
}

/** Include modules whose entire runtime import graph can run in the browser. */
export function findExhibitSandboxes(exhibits: readonly ExhibitFile[]): {
	sandboxes: ExhibitSandbox[]
	jsxFrameworks: ReadonlyMap<string, ExhibitFramework | null>
} {
	const importsByFile = new Map(
		exhibits.map((exhibit) => [exhibit.file, parseExhibit(exhibit)]),
	)
	const candidates = exhibits.flatMap((exhibit) => {
		const pending = [exhibit.file]
		const visited = new Set(pending)
		const jsxFiles: string[] = []
		const frameworks = new Set<ExhibitFramework>()
		let ecology = false
		let supportsJsx = true
		for (const file of pending) {
			const parsed = importsByFile.get(file)
			if (!parsed) return []
			supportsJsx &&= !parsed.unsupportedJsx
			if (parsed.hasJsx) jsxFiles.push(file)
			for (const framework of parsed.frameworks) frameworks.add(framework)
			for (const source of parsed.imports) {
				if (source.startsWith(`.`)) {
					const base = path.resolve(path.dirname(file), source)
					const dependency = [base, `${base}.ts`, `${base}.tsx`].find(
						(candidate) => importsByFile.has(candidate),
					)
					if (!dependency) return []
					if (!visited.has(dependency)) {
						visited.add(dependency)
						pending.push(dependency)
					}
				} else {
					if (!runtimePackages.test(source)) return []
					ecology ||=
						source === `atom.io` ||
						source === `@atom.io/react` ||
						source === `@atom.io/solid`
					const framework = frameworkFromImport(source)
					if (framework) frameworks.add(framework)
				}
			}
		}
		const framework =
			supportsJsx && frameworks.size <= 1
				? frameworks.values().next().value
				: null
		const preview = importsByFile.get(exhibit.file)?.defaultFunction
			? framework
			: null
		return ecology || preview !== null
			? [{ ...exhibit, ecology, preview, jsxFiles }]
			: []
	})
	const jsxFrameworks = new Map<string, ExhibitFramework | null>()
	function assignJsx(framework: ExhibitFramework, jsxFiles: readonly string[]) {
		for (const file of jsxFiles) {
			const previous = jsxFrameworks.get(file)
			jsxFrameworks.set(
				file,
				previous === undefined || previous === framework ? framework : null,
			)
		}
	}
	for (const { preview, jsxFiles } of candidates) {
		if (preview) assignJsx(preview, jsxFiles)
	}
	// Untagged examples inherit a renderer from an exhibit that uses their JSX.
	const resolved = candidates.map(({ preview, ...exhibit }) => {
		if (preview !== undefined) return { ...exhibit, preview }
		const inherited = new Set(
			exhibit.jsxFiles
				.map((file) => jsxFrameworks.get(file))
				.filter((framework) => framework !== undefined),
		)
		const [framework = `react`] = inherited
		return { ...exhibit, preview: inherited.size <= 1 ? framework : null }
	})
	for (const { preview, jsxFiles } of resolved) {
		if (preview) assignJsx(preview, jsxFiles)
	}
	const sandboxes = resolved.flatMap(({ jsxFiles, ...exhibit }) => {
		const preview = jsxFiles.some((file) => jsxFrameworks.get(file) === null)
			? null
			: exhibit.preview
		return exhibit.ecology || preview ? [{ ...exhibit, preview }] : []
	})
	return { sandboxes, jsxFrameworks }
}

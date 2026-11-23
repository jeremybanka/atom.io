import path from "node:path"

import { parse } from "@babel/parser"
import * as t from "@babel/types"

export interface ExhibitFile {
	file: string
	source: string
	code: string
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
	let unresolved = false
	t.traverseFast(ast, (node) => {
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
	const hasOtherJsxRuntime = ast.comments?.some((comment) => {
		const source = /@jsxImportSource\s+(\S+)/.exec(comment.value)?.[1]
		return source !== undefined && source !== `react`
	})
	return unresolved
		? null
		: {
				imports,
				defaultFunction: hasDefaultFunction(ast.program.body),
				reactCompatible: !hasOtherJsxRuntime,
			}
}

const runtimePackages =
	/^(?:atom\.io(?:\/(?:foundations|transceivers)\/[^/]+|\/(?:web|internal|introspection|testing))?|@atom\.io\/(?:spa|react)(?:\/[\w-]+)?|react(?:\/jsx(?:-dev)?-runtime)?|react-dom(?:\/client)?)$/

export interface ExhibitSandbox extends ExhibitFile {
	ecology: boolean
	preview: boolean
}

/** Include modules whose entire runtime import graph can run in the browser. */
export function findExhibitSandboxes(exhibits: readonly ExhibitFile[]): {
	sandboxes: ExhibitSandbox[]
	reactFiles: ReadonlySet<string>
} {
	const importsByFile = new Map(
		exhibits.map((exhibit) => [exhibit.file, parseExhibit(exhibit)]),
	)
	const reactFiles = new Set<string>()
	const sandboxes = exhibits.flatMap((exhibit) => {
		const pending = [exhibit.file]
		const visited = new Set(pending)
		let ecology = false
		let preview = importsByFile.get(exhibit.file)?.defaultFunction === true
		for (const file of pending) {
			const parsed = importsByFile.get(file)
			if (!parsed) return []
			preview &&= parsed.reactCompatible
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
					ecology ||= source === `atom.io` || source === `@atom.io/react`
					preview &&= !/^@atom\.io\/spa(?:\/|$)/.test(source)
				}
			}
		}
		if (preview) for (const file of visited) reactFiles.add(file)
		return ecology || preview ? [{ ...exhibit, ecology, preview }] : []
	})
	return { sandboxes, reactFiles }
}

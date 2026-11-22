import path from "node:path"

import { parse } from "@babel/parser"
import * as t from "@babel/types"

export interface ExhibitFile {
	file: string
	source: string
	code: string
}

function runtimeImports({ file, code }: ExhibitFile): string[] | null {
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
	return unresolved ? null : [...imports]
}

const runtimePackages =
	/^(?:atom\.io(?:\/(?:foundations|transceivers)\/[^/]+|\/(?:web|internal|introspection|testing))?|@atom\.io\/(?:spa|react)(?:\/[\w-]+)?|react(?:\/jsx-runtime)?)$/

/** Include modules whose entire runtime import graph can run in the browser. */
export function findExhibitSandboxes(
	exhibits: readonly ExhibitFile[],
): ExhibitFile[] {
	const importsByFile = new Map(
		exhibits.map((exhibit) => [exhibit.file, runtimeImports(exhibit)]),
	)
	return exhibits.filter((exhibit) => {
		const pending = [exhibit.file]
		const visited = new Set(pending)
		let usesState = false
		for (const file of pending) {
			const imports = importsByFile.get(file)
			if (!imports) return false
			for (const source of imports) {
				if (source.startsWith(`.`)) {
					const base = path.resolve(path.dirname(file), source)
					const dependency = [base, `${base}.ts`, `${base}.tsx`].find(
						(candidate) => importsByFile.has(candidate),
					)
					if (!dependency) return false
					if (!visited.has(dependency)) {
						visited.add(dependency)
						pending.push(dependency)
					}
				} else {
					if (!runtimePackages.test(source)) return false
					usesState ||= source === `atom.io` || source === `@atom.io/react`
				}
			}
		}
		return usesState
	})
}

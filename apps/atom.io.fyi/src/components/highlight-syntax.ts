import { parse } from "@babel/parser"
import * as t from "@babel/types"
import type { Lang } from "@pierre/highlights"

export type SyntaxTreatment = {
	start: number
	end: number
	color: string
	priority: number
}

// This is a build-time syntax pass, not a typecheck. Parsing lets us distinguish
// nested generic arguments from comparisons, JSX, strings, and comments.
export function getSyntaxTreatments(
	code: string,
	lang: Lang,
): SyntaxTreatment[] {
	if (lang === `bash`) return []
	let ast: t.File
	try {
		ast = parse(code, {
			sourceType: `unambiguous`,
			plugins:
				lang === `ts`
					? [`typescript`]
					: lang === `tsx`
						? [`typescript`, `jsx`]
						: [`jsx`],
			errorRecovery: true,
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
			allowImportExportEverywhere: true,
		})
	} catch (error) {
		// Exhibits can be incomplete fragments. Keep Highlights' output when a
		// fragment cannot be parsed instead of preventing the page from building.
		if (error instanceof SyntaxError) return []
		throw error
	}
	const treatments: SyntaxTreatment[] = []
	function add(
		node: t.Node | null | undefined,
		color: string,
		priority = 2,
	): void {
		if (node?.start != null && node.end != null)
			treatments.push({
				start: node.start,
				end: node.end,
				color:
					color === `plain` ? `var(--code-color)` : `var(--code-${color}-color)`,
				priority,
			})
	}
	function functionName(node: t.Node): void {
		if (t.isIdentifier(node)) add(node, `function`, 3)
		else if (
			(t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
			!node.computed
		)
			add(node.property, `function`, 3)
	}
	t.traverseFast(ast, (node) => {
		if (t.isImportNamespaceSpecifier(node)) add(node.local, `plain`, 3)
		if (t.isTSTypeParameterDeclaration(node)) add(node, `type`)
		if (
			t.isCallExpression(node) ||
			t.isOptionalCallExpression(node) ||
			t.isNewExpression(node)
		) {
			if (node.typeParameters) {
				add(node.typeParameters, `type`)
				if (!t.isNewExpression(node)) functionName(node.callee)
			}
		}
		if (lang === `ts` && t.isTSTypeReference(node))
			add(node.typeName, `plain`, 1)
		if (t.isImportSpecifier(node) && node.importKind === `type`) {
			add({ ...node, end: node.imported.start }, `keyword`)
		}
		if (t.isImportDeclaration(node) && node.importKind === `type`) {
			add({ ...node, end: node.specifiers[0]?.start }, `keyword`)
			if (lang === `ts`) {
				for (const specifier of node.specifiers) add(specifier, `plain`, 1)
			}
		}
		if (
			t.isExportNamedDeclaration(node) &&
			node.exportKind === `type` &&
			!node.declaration
		) {
			add({ ...node, end: node.specifiers[0]?.start }, `keyword`)
			if (lang === `ts`) {
				for (const specifier of node.specifiers) add(specifier, `plain`, 1)
			}
		}

		if (
			t.isVariableDeclarator(node) &&
			t.isIdentifier(node.id) &&
			!node.id.typeAnnotation &&
			(t.isArrowFunctionExpression(node.init) ||
				t.isFunctionExpression(node.init))
		)
			functionName(node.id)
		if (
			t.isObjectProperty(node) &&
			!node.computed &&
			(t.isArrowFunctionExpression(node.value) ||
				t.isFunctionExpression(node.value))
		)
			functionName(node.key)
		if (
			t.isAssignmentExpression(node) &&
			(t.isArrowFunctionExpression(node.right) ||
				t.isFunctionExpression(node.right))
		)
			functionName(node.left)
		if (
			t.isImportDeclaration(node) &&
			lang !== `ts` &&
			node.importKind !== `type` &&
			!node.specifiers.some(
				(specifier) =>
					t.isImportSpecifier(specifier) && specifier.importKind === `type`,
			)
		) {
			for (const specifier of node.specifiers) {
				// Only bindings get import colors; `as` is still a keyword, and a
				// namespace is an object rather than a function.
				if (t.isImportNamespaceSpecifier(specifier)) continue
				add(specifier.local, `function`, 3)
				if (t.isImportSpecifier(specifier))
					add(specifier.imported, `function`, 3)
			}
		}
	})
	return treatments.sort((a, b) => b.priority - a.priority)
}

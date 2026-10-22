import { parse } from "@babel/parser"
import * as t from "@babel/types"
import type { Lang } from "@pierre/highlights"

export type SyntaxTreatment = {
	start: number
	end: number
	color: string
	priority: number
	literalOnly: boolean
}

// This build-time pass describes syntax, not resolved symbols or inferred types.
// A call target can be colored without knowing what its binding resolves to.
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
		// Incomplete exhibits keep lexical highlighting rather than blocking builds.
		if (error instanceof SyntaxError) return []
		throw error
	}
	const treatments: SyntaxTreatment[] = []
	function add(
		node: t.Node | null | undefined,
		color: string,
		priority = 2,
		literalOnly = false,
	): void {
		if (node?.start != null && node.end != null)
			treatments.push({
				start: node.start,
				// Babel includes annotations in binding identifiers. Color just the
				// name so a function binding cannot swallow its parameter/return types.
				end: t.isIdentifier(node)
					? (node.typeAnnotation?.start ?? node.end)
					: node.end,
				color:
					color === `plain` ? `var(--code-color)` : `var(--code-${color}-color)`,
				priority,
				literalOnly,
			})
	}
	function typeName(node: t.Node): void {
		if (t.isTSQualifiedName(node)) {
			typeName(node.left)
			typeName(node.right)
		} else if (t.isMemberExpression(node) && !node.computed) {
			typeName(node.object)
			typeName(node.property)
		} else add(node, `type`)
	}
	function functionName(node: t.Node | null | undefined): void {
		if (t.isIdentifier(node)) add(node, `function`)
		else if (
			t.isTSNonNullExpression(node) ||
			t.isTSAsExpression(node) ||
			t.isTSTypeAssertion(node) ||
			t.isTSInstantiationExpression(node) ||
			t.isParenthesizedExpression(node)
		)
			functionName(node.expression)
		else if (
			(t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
			!node.computed
		)
			add(node.property, `function`)
	}
	t.traverseFast(ast, (node) => {
		// Names alone say nothing about types or callability, even when capitalized
		// or spelled like globals (console, Promise, undefined, etc.).
		if (t.isIdentifier(node)) add(node, `plain`, 0)
		if (t.isTSTypeReference(node)) typeName(node.typeName)
		if (t.isTSExpressionWithTypeArguments(node)) typeName(node.expression)
		if (t.isTSImportType(node) && node.qualifier) typeName(node.qualifier)
		if (t.isTSTypeParameter(node) && node.start != null) {
			// Constraints/defaults are separate nodes; `extends` stays a keyword.
			const nameStart = code.indexOf(node.name, node.start)
			add(
				{ ...node, start: nameStart, end: nameStart + node.name.length },
				`type`,
			)
		}
		if (/^TS\w+Keyword$/.test(node.type)) add(node, `type`)
		// Template literal types contain other syntax inside ${...}; only their
		// literal pieces inherit the type color from this enclosing node.
		if (t.isTSLiteralType(node)) add(node, `type`, 2, true)
		if (
			t.isTSTypeAliasDeclaration(node) ||
			t.isTSInterfaceDeclaration(node) ||
			t.isClassDeclaration(node) ||
			t.isClassExpression(node) ||
			t.isTSEnumDeclaration(node)
		)
			add(node.id, `type`)

		if (t.isImportDeclaration(node)) {
			if (node.importKind === `type`)
				add({ ...node, end: node.specifiers[0]?.start }, `keyword`)
			for (const specifier of node.specifiers) {
				const isType =
					node.importKind === `type` ||
					(t.isImportSpecifier(specifier) && specifier.importKind === `type`)
				if (isType) {
					add(specifier.local, `type`)
					if (t.isImportSpecifier(specifier)) add(specifier.imported, `type`)
				}
			}
		}
		if (t.isImportSpecifier(node) && node.importKind === `type`)
			add({ ...node, end: node.imported.start }, `keyword`)
		if (t.isExportNamedDeclaration(node) && !node.declaration) {
			if (node.exportKind === `type`)
				add({ ...node, end: node.specifiers[0]?.start }, `keyword`)
			for (const specifier of node.specifiers) {
				if (
					t.isExportSpecifier(specifier) &&
					(node.exportKind === `type` || specifier.exportKind === `type`)
				) {
					add(specifier.local, `type`)
					add(specifier.exported, `type`)
					if (specifier.exportKind === `type`)
						add({ ...specifier, end: specifier.local.start }, `keyword`)
				}
			}
		}

		if (
			t.isCallExpression(node) ||
			t.isOptionalCallExpression(node) ||
			t.isNewExpression(node)
		)
			functionName(node.callee)
		if (t.isTaggedTemplateExpression(node)) functionName(node.tag)
		if (
			t.isFunctionDeclaration(node) ||
			t.isFunctionExpression(node) ||
			t.isTSDeclareFunction(node)
		)
			functionName(node.id)
		if (
			(t.isObjectMethod(node) ||
				t.isClassMethod(node) ||
				t.isTSMethodSignature(node)) &&
			!node.computed
		)
			functionName(node.key)
		if (
			t.isVariableDeclarator(node) &&
			(t.isArrowFunctionExpression(node.init) ||
				t.isFunctionExpression(node.init))
		)
			functionName(node.id)
		if (
			(t.isObjectProperty(node) || t.isClassProperty(node)) &&
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
	})
	return treatments.sort((a, b) => b.priority - a.priority)
}

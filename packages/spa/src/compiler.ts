import type { PluginObj } from "@babel/core"
import { transformSync, types as t } from "@babel/core"

export function compile(
	code: string,
	filename: string,
): { code: string; map: any } {
	const plugin = (): PluginObj => {
		let create: t.Identifier
		let merge: t.Identifier
		const generated = new WeakSet<object>()
		const components = new Set<string>()
		function name(
			node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
		): t.Expression {
			if (t.isJSXMemberExpression(node))
				return t.memberExpression(
					t.isJSXIdentifier(node.object)
						? node.object.name === `this`
							? t.thisExpression()
							: t.identifier(node.object.name)
						: name(node.object),
					t.identifier(node.property.name),
				)
			if (t.isJSXNamespacedName(node))
				return t.stringLiteral(`${node.namespace.name}:${node.name.name}`)
			return /^[a-z]/.test(node.name) || node.name.includes(`-`)
				? t.stringLiteral(node.name)
				: t.identifier(node.name)
		}
		function literal(node: t.Node): boolean {
			return (
				t.isLiteral(node) &&
				(!t.isTemplateLiteral(node) || node.expressions.length === 0)
			)
		}
		function child(node: t.Expression): t.Expression {
			return generated.has(node) || literal(node) || t.isFunction(node)
				? node
				: t.arrowFunctionExpression([], node)
		}
		return {
			visitor: {
				ExportDefaultDeclaration(path) {
					if (
						t.isArrowFunctionExpression(path.node.declaration) ||
						t.isFunctionExpression(path.node.declaration)
					) {
						const id = path.scope.generateUidIdentifier(`Component`)
						path.replaceWithMultiple([
							t.variableDeclaration(`const`, [
								t.variableDeclarator(id, path.node.declaration),
							]),
							t.exportDefaultDeclaration(id),
						])
					}
				},
				Program: {
					enter(path) {
						create = path.scope.generateUidIdentifier(`spa`)
						merge = path.scope.generateUidIdentifier(`props`)
					},
					exit(path) {
						path.unshiftContainer(
							`body`,
							t.importDeclaration(
								[
									t.importSpecifier(create, t.identifier(`jsx`)),
									t.importSpecifier(merge, t.identifier(`merge`)),
								],
								t.stringLiteral(`@atom.io/spa/jsx-runtime`),
							),
						)
						for (const component of components)
							path.pushContainer(
								`body`,
								t.expressionStatement(
									t.assignmentExpression(
										`=`,
										t.memberExpression(
											t.identifier(component),
											t.identifier(`spa`),
										),
										t.booleanLiteral(true),
									),
								),
							)
					},
				},
				"JSXElement|JSXFragment": {
					exit(path: any) {
						const node = path.node as t.JSXElement | t.JSXFragment
						const chunks: t.Expression[] = []
						let properties: (t.ObjectProperty | t.ObjectMethod)[] = []
						const flush = () => {
							if (properties.length) {
								chunks.push(t.objectExpression(properties))
								properties = []
							}
						}
						if (t.isJSXElement(node))
							for (const attribute of node.openingElement.attributes) {
								if (t.isJSXSpreadAttribute(attribute)) {
									flush()
									chunks.push(t.arrowFunctionExpression([], attribute.argument))
									continue
								}
								const key = t.isJSXNamespacedName(attribute.name)
									? `${attribute.name.namespace.name}:${attribute.name.name.name}`
									: attribute.name.name
								const value =
									attribute.value == null
										? t.booleanLiteral(true)
										: t.isJSXExpressionContainer(attribute.value)
											? attribute.value.expression
											: attribute.value
								// The parser rejects empty attribute expressions.
								const expression = value as t.Expression
								properties.push(
									key === `key` ||
										literal(expression) ||
										t.isFunction(expression)
										? t.objectProperty(t.stringLiteral(key), expression)
										: t.objectMethod(
												`get`,
												t.stringLiteral(key),
												[],
												t.blockStatement([t.returnStatement(expression)]),
											),
								)
							}
						const children = t.react
							.buildChildren(node)
							.map((value) => child(value as t.Expression))
						if (children.length)
							properties.push(
								t.objectProperty(
									t.identifier(`children`),
									children.length === 1
										? children[0]
										: t.arrayExpression(children),
								),
							)
						flush()
						const props =
							chunks.length > 1
								? t.callExpression(merge, chunks)
								: (chunks[0] ?? t.objectExpression([]))
						const result = t.callExpression(create, [
							t.isJSXElement(node)
								? name(node.openingElement.name)
								: t.nullLiteral(),
							props,
						])
						generated.add(result)
						let fn = path.findParent((parent: any) => parent.isFunction())
						while (fn?.findParent((parent: any) => parent.isFunction()))
							fn = fn.findParent((parent: any) => parent.isFunction())
						if (fn) {
							if (fn.node.id) components.add(fn.node.id.name)
							else if (
								fn.parentPath.isVariableDeclarator() &&
								t.isIdentifier(fn.parentPath.node.id)
							)
								components.add(fn.parentPath.node.id.name)
							else if (
								fn.parentPath.isExportDefaultDeclaration() &&
								t.isFunctionDeclaration(fn.node)
							) {
								fn.node.id = path.scope.generateUidIdentifier(`Component`)
								components.add(fn.node.id.name)
							}
						}
						path.replaceWith(result)
					},
				},
			},
		}
	}
	const result = transformSync(code, {
		filename,
		babelrc: false,
		configFile: false,
		sourceMaps: true,
		parserOpts: { plugins: [`jsx`, `typescript`] },
		plugins: [plugin],
	})!
	return { code: result.code!, map: result.map }
}

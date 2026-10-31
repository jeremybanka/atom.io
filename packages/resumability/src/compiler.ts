import type { PluginObject } from "@babel/core"
import { transformSync, types as t } from "@babel/core"

/** Remove server closures before Vite discovers their dynamic imports. */
export function compile(
	code: string,
	filename: string,
): { code: string; map: unknown } {
	const result = transformSync(code, {
		filename,
		configFile: false,
		babelrc: false,
		sourceMaps: true,
		parserOpts: { sourceType: `module`, plugins: [`typescript`, `jsx`] },
		plugins: [
			(): PluginObject => ({
				visitor: {
					Program: {
						exit(path) {
							path.scope.crawl()
							for (const statement of path.get(`body`)) {
								if (
									!statement.isImportDeclaration() ||
									![`resumability`, `resumability/client`].includes(
										statement.node.source.value,
									)
								)
									continue
								for (const specifier of statement.node.specifiers) {
									if (t.isImportNamespaceSpecifier(specifier))
										throw statement.buildCodeFrameError(
											`Use a named resumable import so the server boundary is explicit`,
										)
									if (
										!t.isImportSpecifier(specifier) ||
										!(
											t.isIdentifier(specifier.imported, {
												name: `resumable`,
											}) ||
											t.isStringLiteral(specifier.imported, {
												value: `resumable`,
											})
										)
									)
										continue
									for (const reference of path.scope.getBinding(
										specifier.local.name,
									)!.referencePaths) {
										if (
											!reference.parentPath.isCallExpression() ||
											reference.parentPath.node.callee !== reference.node
										)
											throw reference.buildCodeFrameError(
												`Call resumable directly; aliases and higher-order use cannot establish a server boundary`,
											)
									}
								}
							}
						},
					},
					CallExpression(path) {
						const callee = path.node.callee
						if (!t.isIdentifier(callee)) return
						const binding = path.scope.getBinding(callee.name)?.path
						if (
							!binding?.isImportSpecifier() ||
							!(
								t.isIdentifier(binding.node.imported, { name: `resumable` }) ||
								t.isStringLiteral(binding.node.imported, { value: `resumable` })
							)
						)
							return
						const declaration = binding.parent
						if (
							![`resumability`, `resumability/client`].includes(
								declaration.source.value,
							)
						)
							return
						const options = path.node.arguments[0]
						if (
							!t.isObjectExpression(options) ||
							options.properties.some(
								(property) => t.isSpreadElement(property) || property.computed,
							)
						)
							throw path.buildCodeFrameError(
								`resumable requires inline options without spreads or computed keys`,
							)
						options.properties = (
							options.properties as (t.ObjectMethod | t.ObjectProperty)[]
						).filter((property) => {
							if (
								!(
									t.isIdentifier(property.key, { name: `server` }) ||
									t.isStringLiteral(property.key, { value: `server` })
								)
							)
								return true
							if (
								!(
									t.isObjectMethod(property, { kind: `method` }) ||
									(t.isObjectProperty(property) &&
										(t.isArrowFunctionExpression(property.value) ||
											t.isFunctionExpression(property.value)))
								)
							)
								throw path.buildCodeFrameError(
									`resumable server must be an inline closure; put server-only imports inside it`,
								)
							return false
						})
					},
				},
			}),
		],
	})!
	return { code: result.code!, map: result.map }
}

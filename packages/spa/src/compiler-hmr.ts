import remapping from "@jridgewell/remapping"
import type { SourceMap } from "magic-string"
import MagicString from "magic-string"
import type { Node } from "oxc-parser"
import { parseSync, visitorKeys } from "oxc-parser"

function walk(node: Node, visit: (node: Node) => void): void {
	visit(node)
	for (const key of visitorKeys[node.type]) {
		const value = (node as unknown as Record<string, unknown>)[key]
		if (Array.isArray(value)) {
			for (const child of value) if (child) walk(child, visit)
		} else if (value) walk(value as Node, visit)
	}
}
const factories = new Set([
	`atom`,
	`atomFamily`,
	`selector`,
	`selectorFamily`,
	`transaction`,
	`timeline`,
	`timelineFamily`,
	`Silo`,
])
function stateIn(program: Node): boolean {
	const names = new Set(factories)
	walk(program, (node) => {
		if (
			node.type === `ImportDeclaration` &&
			node.source.value.startsWith(`atom.io`)
		) {
			for (const specifier of node.specifiers) {
				if (
					specifier.type === `ImportSpecifier` &&
					specifier.imported.type === `Identifier` &&
					factories.has(specifier.imported.name)
				)
					names.add(specifier.local.name)
			}
		}
	})
	let found = false
	walk(program, (node) => {
		if (node.type === `CallExpression` || node.type === `NewExpression`) {
			const callee = node.callee
			if (
				(callee.type === `Identifier` && names.has(callee.name)) ||
				(callee.type === `MemberExpression` &&
					!callee.computed &&
					callee.property.type === `Identifier` &&
					factories.has(callee.property.name))
			)
				found = true
		}
	})
	return found
}

export function requiresModuleReload(code: string, filename: string): boolean {
	const program = parseSync(filename, code, { lang: `tsx` }).program
	return (
		stateIn(program) ||
		program.body.some((node) => {
			if (node.type === `ExportDefaultDeclaration`) return true
			if (node.type === `ExportAllDeclaration`) return node.exportKind !== `type`
			if (node.type !== `ExportNamedDeclaration` || node.exportKind === `type`)
				return false
			if (node.declaration)
				return ![
					`TSInterfaceDeclaration`,
					`TSTypeAliasDeclaration`,
					`TSDeclareFunction`,
				].includes(node.declaration.type)
			return node.specifiers.some((specifier) => specifier.exportKind !== `type`)
		})
	)
}

/** Instrument only local component exports, composing both edits back to authored JSX. */
export function hotModule(
	code: string,
	filename: string,
	originalMap: SourceMap,
):
	| {
			code: string
			map: string
			exports: string[]
	  }
	| undefined {
	const program = parseSync(filename, code, {
		lang: `tsx`,
		preserveParens: true,
	}).program
	if (stateIn(program)) return
	const components = new Set<string>()
	const declarations = new Map<string, Node>()
	const exports = new Map<string, string[]>()
	const defaults: Extract<Node, { type: `ExportDefaultDeclaration` }>[] = []
	const identifiers = new Set<string>()
	walk(program, (node) => {
		if (node.type === `Identifier`) identifiers.add(node.name)
	})
	const branded = (node: Node): boolean => {
		if (
			node.type !== `ExpressionStatement` ||
			node.expression.type !== `AssignmentExpression`
		)
			return false
		const { left, right } = node.expression
		if (
			left.type !== `MemberExpression` ||
			left.computed ||
			left.object.type !== `Identifier` ||
			left.property.type !== `Identifier` ||
			left.property.name !== `spa` ||
			right.type !== `Literal` ||
			right.value !== true
		)
			return false
		components.add(left.object.name)
		return true
	}
	const declaration = (node: Node): boolean => {
		if (node.type === `FunctionDeclaration` && node.id) {
			declarations.set(node.id.name, node)
			return true
		}
		if (node.type === `VariableDeclaration`) {
			for (const entry of node.declarations) {
				if (entry.id.type === `Identifier`) declarations.set(entry.id.name, node)
				let unsafe = false
				let init = entry.init
				while (init?.type === `ParenthesizedExpression`) init = init.expression
				if (
					init &&
					init.type !== `ArrowFunctionExpression` &&
					init.type !== `FunctionExpression`
				)
					walk(init, (child) => {
						if (
							[
								`CallExpression`,
								`NewExpression`,
								`TaggedTemplateExpression`,
							].includes(child.type)
						)
							unsafe = true
					})
				if (unsafe) return false
			}
			return true
		}
		return [
			`TSInterfaceDeclaration`,
			`TSTypeAliasDeclaration`,
			`TSDeclareFunction`,
		].includes(node.type)
	}
	const add = (local: string, exported: string) => {
		exports.set(local, [...(exports.get(local) ?? []), exported])
	}
	for (const statement of program.body) {
		if (
			statement.type === `ExportAllDeclaration` &&
			statement.exportKind === `type`
		)
			continue
		if (
			statement.type === `ImportDeclaration` ||
			statement.type === `EmptyStatement`
		)
			continue
		if (
			statement.type === `ExpressionStatement` &&
			(statement.directive || branded(statement))
		)
			continue
		if (statement.type === `ExportNamedDeclaration`) {
			if (statement.exportKind === `type`) continue
			if (statement.source) return
			if (statement.declaration) {
				const node = statement.declaration
				if (!declaration(node)) return
				if (node.type === `FunctionDeclaration` && node.id)
					add(node.id.name, node.id.name)
				if (node.type === `VariableDeclaration`)
					for (const entry of node.declarations) {
						if (entry.id.type !== `Identifier`) return
						add(entry.id.name, entry.id.name)
					}
			} else
				for (const specifier of statement.specifiers) {
					if (specifier.exportKind === `type`) continue
					add(
						// Local export names are identifiers; string names require a source above.
						(specifier.local as { name: string }).name,
						specifier.exported.type === `Identifier`
							? specifier.exported.name
							: specifier.exported.value,
					)
				}
		} else if (statement.type === `ExportDefaultDeclaration`) {
			const node = statement.declaration
			if (node.type === `Identifier`) add(node.name, `default`)
			else if (node.type === `FunctionDeclaration` && node.id) {
				declaration(node)
				add(node.id.name, `default`)
			} else return
			defaults.push(statement)
		} else if (!declaration(statement)) return
	}
	if (
		!exports.size ||
		[...exports.keys()].some(
			(name) => !components.has(name) || !declarations.has(name),
		)
	)
		return
	const output = new MagicString(code)
	const mutable = new Set<Node>()
	for (const name of exports.keys()) {
		const node = declarations.get(name)!
		if (
			node.type === `VariableDeclaration` &&
			node.kind === `const` &&
			!mutable.has(node)
		) {
			output.update(node.start, node.start + 5, `let`)
			mutable.add(node)
		}
	}
	for (const node of defaults) {
		const value = node.declaration
		const name =
			value.type === `Identifier`
				? value.name
				: (value as { id: { name: string } }).id.name
		const prefix = code.slice(node.start, value.start)
		for (const token of prefix.matchAll(
			/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\b(?:export|default)\b/g,
		)) {
			if (token[0] === `export` || token[0] === `default`)
				output.update(
					node.start + token.index,
					node.start + token.index + token[0].length,
					value.type === `Identifier` && token[0] === `export` ? `export {` : ``,
				)
		}
		if (value.type === `Identifier`)
			output.appendLeft(value.end, ` as default }`)
		else output.appendLeft(node.end, `;\nexport { ${name} as default };`)
	}
	const uid = (base: string) => {
		let name = base
		while (identifiers.has(name)) name += `_`
		identifiers.add(name)
		return name
	}
	const register = uid(`__spaHotRegister`),
		refresh = uid(`__spaHotRefresh`)
	let position = program.hashbang?.end ?? 0
	for (const statement of program.body) {
		if (statement.type !== `ExpressionStatement` || !statement.directive) break
		position = statement.end
	}
	output.appendLeft(
		position,
		`\nimport { registerComponent as ${register}, refresh as ${refresh} } from "@atom.io/spa/hot";\n`,
	)
	output.append(`\nif (import.meta.hot) {\n`)
	for (const [name, aliases] of exports)
		output.append(
			`${name} = ${register}(${JSON.stringify(filename)}, ${JSON.stringify(aliases.sort()[0])}, ${name});\n`,
		)
	output.append(
		`import.meta.hot.accept(() => ${refresh}(${JSON.stringify(filename)}));\n}\n`,
	)
	return {
		code: output.toString(),
		map: remapping(
			[
				output
					.generateMap({
						source: filename,
						includeContent: true,
						hires: true,
					})
					.toString(),
				originalMap.toString(),
			],
			() => null,
		).toString(),
		exports: [...exports.values()].flat().sort(),
	}
}

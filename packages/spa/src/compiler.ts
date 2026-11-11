import { decode } from "html-entities"
import type { SourceMap } from "magic-string"
import MagicString from "magic-string"
import type {
	Expression,
	JSXElement,
	JSXElementName,
	JSXFragment,
	Node,
} from "oxc-parser"
import { parseSync, visitorKeys } from "oxc-parser"

type Part = string | Node

const decodeJsx = (value: string): string =>
	decode(value, { level: `html4`, scope: `strict` })

/** Match JSX's multiline whitespace rules without reprinting JavaScript. */
function text(value: string): string {
	const lines = value.split(/\r\n|\n|\r/)
	let last = 0
	for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i
	return lines
		.map((line, i) => {
			line = line.replace(/\t/g, ` `)
			if (i > 0) line = line.replace(/^ +/, ``)
			if (i < lines.length - 1) line = line.replace(/ +$/, ``)
			return line && i < last ? `${line} ` : line
		})
		.join(``)
}

function eager(node: Node, allowJsx = false): boolean {
	if (node.type === `ParenthesizedExpression`)
		return eager(node.expression, allowJsx)
	return (
		node.type === `Literal` ||
		node.type === `FunctionExpression` ||
		node.type === `ArrowFunctionExpression` ||
		(allowJsx && (node.type === `JSXElement` || node.type === `JSXFragment`)) ||
		(node.type === `TemplateLiteral` && node.expressions.length === 0)
	)
}

function needsLexicalScope(node: Node): boolean {
	if (
		node.type === `ThisExpression` ||
		node.type === `Super` ||
		node.type === `MetaProperty` ||
		(node.type === `Identifier` &&
			(node.name === `arguments` || node.name === `eval`))
	)
		return true
	return visitorKeys[node.type].some((key) => {
		const value = (node as unknown as Record<string, unknown>)[key]
		return Array.isArray(value)
			? value.some((child) => child && needsLexicalScope(child))
			: Boolean(value && needsLexicalScope(value as Node))
	})
}

function isFunction(node: Node): boolean {
	return (
		node.type === `FunctionDeclaration` ||
		node.type === `FunctionExpression` ||
		node.type === `ArrowFunctionExpression`
	)
}

export function compile(
	code: string,
	filename: string,
): { code: string; map: SourceMap } {
	const parsed = parseSync(filename, code, {
		lang: `tsx`,
		preserveParens: true,
	})
	if (parsed.errors.length) {
		const error = parsed.errors[0]
		throw new SyntaxError(
			[`${filename}: ${error.message}`, error.codeframe]
				.filter(Boolean)
				.join(`\n`),
		)
	}
	const output = new MagicString(code)
	const parents = new WeakMap<Node, Node>()
	const suspending = new WeakSet<Node>()
	const identifiers = new Set<string>()
	const elements: (JSXElement | JSXFragment)[] = []
	const functions = new Set<Node>()
	function walk(node: Node, parent?: Node, outerFunction?: Node): void {
		if (parent) parents.set(node, parent)
		output.addSourcemapLocation(node.start)
		output.addSourcemapLocation(node.end)
		if (node.type === `Identifier` || node.type === `JSXIdentifier`)
			identifiers.add(node.name)
		if (!outerFunction && isFunction(node)) outerFunction = node
		if (node.type === `AwaitExpression` || node.type === `YieldExpression`) {
			// Suspension belongs to the enclosing function, including inside a key.
			let enclosing: Node | undefined = node
			while (enclosing && !isFunction(enclosing)) {
				suspending.add(enclosing)
				enclosing = parents.get(enclosing)
			}
		}
		if (node.type === `JSXElement` || node.type === `JSXFragment`) {
			elements.push(node)
			if (outerFunction) functions.add(outerFunction)
		}
		for (const key of visitorKeys[node.type]) {
			const value = (node as unknown as Record<string, unknown>)[key]
			if (Array.isArray(value)) {
				for (const child of value) if (child) walk(child, node, outerFunction)
			} else if (value) walk(value as Node, node, outerFunction)
		}
	}
	walk(parsed.program)
	function uid(base: string): string {
		let name = `_${base}`
		let suffix = 1
		while (identifiers.has(name)) name = `_${base}${++suffix}`
		identifiers.add(name)
		return name
	}
	const create = uid(`spa`)
	const merge = uid(`props`)
	const join = (parts: Part[][], separator: string): Part[] =>
		parts.flatMap((part, i) => (i ? [separator, ...part] : part))
	const expression = (node: Expression): Part[] =>
		eager(node, true) ? [`(`, node, `)`] : [`() => (`, node, `)`]
	function tag(node: JSXElementName): string {
		if (node.type === `JSXNamespacedName`)
			return JSON.stringify(`${node.namespace.name}:${node.name.name}`)
		if (node.type === `JSXMemberExpression`)
			return code.slice(node.start, node.end)
		return /^[a-z]/.test(node.name) || node.name.includes(`-`)
			? JSON.stringify(node.name)
			: node.name
	}
	/** Rewrite syntax around untouched expression spans, including nested JSX. */
	function rewrite(node: JSXElement | JSXFragment, parts: Part[]): void {
		let cursor = node.start
		let replacement = ``
		for (const part of parts) {
			if (typeof part === `string`) {
				replacement += part
				continue
			}
			if (cursor < part.start) output.update(cursor, part.start, replacement)
			else output.appendLeft(cursor, replacement)
			cursor = part.end
			replacement = ``
		}
		// Every JSX node ends with closing syntax after its last expression span.
		output.update(cursor, node.end, replacement)
	}
	for (const node of elements) {
		const chunks: Part[][] = []
		let properties: Part[][] = []
		const flush = () => {
			if (properties.length) chunks.push([`{`, ...join(properties, `, `), `}`])
			properties = []
		}
		if (node.type === `JSXElement`) {
			for (const attribute of node.openingElement.attributes) {
				if (attribute.type === `JSXSpreadAttribute`) {
					flush()
					chunks.push([`() => (`, attribute.argument, `)`])
					continue
				}
				const key = JSON.stringify(
					attribute.name.type === `JSXNamespacedName`
						? `${attribute.name.namespace.name}:${attribute.name.name.name}`
						: attribute.name.name,
				)
				const value = attribute.value
				if (!value) properties.push([`${key}: true`])
				else if (value.type === `Literal`)
					properties.push([`${key}: ${JSON.stringify(decodeJsx(value.value))}`])
				else {
					const expr =
						value.type === `JSXExpressionContainer` ? value.expression : value
					if (eager(expr) || (key === `"key"` && suspending.has(expr)))
						properties.push([`${key}: (`, expr, `)`])
					else if (key === `"key"` && needsLexicalScope(expr)) {
						// Keep the expression in the caller's lexical scope.
						flush()
						const read = uid(`key`)
						chunks.push([
							`((${read}) => ({ get "key"(){ return ${read}(); } }))(() => (`,
							expr,
							`))`,
						])
					} else properties.push([`get ${key}(){ return (`, expr, `); }`])
				}
			}
		}
		const component =
			node.type === `JSXElement` &&
			!tag(node.openingElement.name).startsWith(`"`)
		const children: Part[][] = []
		let lazyChildren = false
		for (const child of node.children) {
			if (child.type === `JSXText`) {
				const value = text(decodeJsx(child.value))
				if (value) children.push([JSON.stringify(value)])
			} else if (child.type === `JSXElement` || child.type === `JSXFragment`)
				children.push([child])
			else if (child.type === `JSXExpressionContainer`) {
				if (child.expression.type !== `JSXEmptyExpression`) {
					if (component) {
						// Component props expose their declared values, including callbacks.
						children.push([`(`, child.expression, `)`])
						if (!eager(child.expression, true)) lazyChildren = true
					} else children.push(expression(child.expression))
				}
			} else
				throw new SyntaxError(`${filename}: JSX spread children are unsupported`)
		}
		if (children.length) {
			const value =
				children.length === 1 ? children[0] : [`[`, ...join(children, `, `), `]`]
			if (lazyChildren) {
				// Capture the computation outside the getter's method scope.
				const read = uid(`children`)
				properties.push([`get children(){ return ${read}(); }`])
				chunks.push([
					`((${read}) => ({`,
					...join(properties, `, `),
					`}))(() => (`,
					...value,
					`))`,
				])
				properties = []
			} else properties.push([`children: `, ...value])
		}
		flush()
		const spreads =
			node.type === `JSXElement` &&
			node.openingElement.attributes.some(
				(attr) => attr.type === `JSXSpreadAttribute`,
			)
		const props =
			spreads || chunks.length > 1
				? [`${merge}(`, ...join(chunks, `, `), `)`]
				: (chunks[0] ?? [`{}`])
		rewrite(node, [
			`${create}(${node.type === `JSXElement` ? tag(node.openingElement.name) : `null`}, `,
			...props,
			`)`,
		])
	}
	const components = new Set<string>()
	for (const fn of functions) {
		let node = fn
		let parent = parents.get(node)
		while (parent?.type === `ParenthesizedExpression`) {
			node = parent
			parent = parents.get(node)
		}
		if (fn.type === `FunctionDeclaration` && fn.id) components.add(fn.id.name)
		else if (
			parent?.type === `VariableDeclarator` &&
			parent.id.type === `Identifier`
		)
			components.add(parent.id.name)
		else if (parent?.type === `ExportDefaultDeclaration`) {
			const name = uid(`Component`)
			if (fn.type === `FunctionDeclaration`) {
				// Keep anonymous default function declarations hoisted.
				const token = [
					...code
						.slice(fn.start, fn.body!.start)
						.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\bfunction\b|\*/g),
				].find((match) => match[0] === (fn.generator ? `*` : `function`))!
				output.appendLeft(fn.start + token.index + token[0].length, ` ${name}`)
			} else {
				// Replace only keywords so intervening comments and annotations survive.
				const prefix = code.slice(parent.start, node.start)
				for (const token of prefix.matchAll(
					/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\b(?:export|default)\b/g,
				)) {
					if (token[0] !== `export` && token[0] !== `default`) continue
					output.update(
						parent.start + token.index,
						parent.start + token.index + token[0].length,
						token[0] === `export` ? `const ${name} =` : ``,
					)
				}
				output.appendLeft(parent.end, `;\nexport default ${name};`)
			}
			components.add(name)
		}
	}
	if (elements.length) {
		// Keep hashbangs and directive prologues ahead of generated imports.
		let position = parsed.program.hashbang?.end ?? 0
		for (const statement of parsed.program.body) {
			if (statement.type !== `ExpressionStatement` || !statement.directive) break
			position = statement.end
		}
		output.appendLeft(
			position,
			`\nimport { jsx as ${create}, merge as ${merge} } from "@atom.io/spa/jsx-runtime";\n`,
		)
		for (const component of components)
			output.append(`\n;${component}.spa = true;`)
	}
	return {
		code: output.toString(),
		map: output.generateMap({
			source: filename,
			includeContent: true,
			hires: true,
		}),
	}
}

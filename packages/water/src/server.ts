import type { Child, RootOptions, Scope, VNode } from "./core.ts"
import {
	createRoot,
	createScope,
	dispose,
	plain,
	untrack,
	within,
} from "./core.ts"
import { Fragment } from "./jsx-runtime.ts"

const escape = (value: unknown): string =>
	String(value).replace(
		/[&<>"']/g,
		(char) =>
			({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[
				char
			]!,
	)
const voidTags =
	/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/
const booleans = new Set(
	`allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected`.split(
		` `,
	),
)
function stringify(
	value: Child,
	owner: Scope,
	namespace = `html`,
	selectValue?: string | number,
): string {
	if (typeof value === `function`) {
		const values = ([untrack(value)] as unknown[]).flat(Infinity) as Child[]
		const keys = new Set<unknown>()
		return (
			`<!--{-->` +
			values
				.map((child, index) => {
					const key = (child as VNode | null)?.props?.[`key`] ?? index
					if (keys.has(key)) throw new Error(`water: duplicate key`)
					keys.add(key)
					return `<!--[-->${within(owner, () => stringify(child, createScope(owner), namespace, selectValue))}<!--]-->`
				})
				.join(``) +
			`<!--}-->`
		)
	}
	if (Array.isArray(value))
		return value
			.map((child) => stringify(child, owner, namespace, selectValue))
			.join(``)
	if (value == null || typeof value === `boolean`) return ``
	if (typeof value !== `object`) return `<!--t-->${escape(value)}`
	if (!(`type` in value) || !(`props` in value))
		throw new TypeError(`water: invalid child`)
	const { type, props } = value
	if (!type || type === Fragment)
		return stringify(() => props[`children`], owner, namespace, selectValue)
	if (typeof type === `function`) {
		const childOwner = createScope(owner)
		return within(childOwner, () =>
			stringify(
				untrack(() => type(props)),
				childOwner,
				namespace,
				selectValue,
			),
		)
	}
	if (!/^[A-Za-z][\w.:-]*$/.test(type)) throw new Error(`water: invalid tag`)
	if (type === `astro-slot`)
		return `<astro-slot>${props[`innerHTML`] ?? ``}</astro-slot>`
	const ns = type === `svg` ? `svg` : namespace
	let attrs = ``
	let textValue: string | number | undefined
	for (let key of Object.keys(props)) {
		if (
			key === `children` ||
			key === `ref` ||
			key === `key` ||
			key.startsWith(`on`)
		)
			continue
		if (
			/^(innerHTML|outerHTML|textContent|innerText|dangerouslySetInnerHTML)$/.test(
				key,
			)
		)
			throw new Error(`water: owned content`)
		let attribute = props[key]
		if (key === `className`) key = `class`
		if (key === `htmlFor`) key = `for`
		if (!/^[^\s"'<>/=]+$/.test(key)) throw new Error(`water: invalid attribute`)
		if (key === `value` && (type === `select` || type === `textarea`)) {
			textValue = attribute
			continue
		}
		if (key === `style` && attribute != null && typeof attribute !== `string`)
			throw new TypeError(`water: CSS string required`)
		const boolean = ns === `html` && booleans.has(key.toLowerCase())
		if (
			attribute == null ||
			(boolean && !attribute) ||
			(attribute === false && !/^(aria-|data-)/.test(key))
		)
			continue
		attrs +=
			boolean || (attribute === true && !/^(aria-|data-)/.test(key))
				? ` ${key}=""`
				: ` ${key}="${escape(attribute)}"`
	}
	if (
		type === `option` &&
		selectValue !== undefined &&
		String(props[`value`]) === String(selectValue)
	)
		attrs += ` selected=""`
	if (ns === `html` && voidTags.test(type)) return `<${type}${attrs}>`
	if (ns === `html` && /^(textarea|title|style|script)$/.test(type)) {
		let text = plain(
			type === `textarea` ? (textValue ?? props[`children`]) : props[`children`],
		)
		if (type === `textarea` && text.startsWith(`\n`)) text = `\n${text}`
		if (/^(script|style)$/.test(type) && new RegExp(`</${type}`, `i`).test(text))
			throw new Error(`water: unsafe raw text`)
		return `<${type}${attrs}>${/^(script|style)$/.test(type) ? text : escape(text)}</${type}>`
	}
	const children = stringify(
		() => props[`children`],
		owner,
		type === `foreignObject` ? `html` : ns,
		type === `select` ? textValue : selectValue,
	)
	return `<${type}${attrs}>${children}</${type}>`
}

export function renderToString(
	setup: () => Child,
	options: RootOptions = {},
): string {
	const root = createRoot(options, true)
	if (/--|[<>]/.test(root._prefix)) throw new Error(`water: invalid idPrefix`)
	try {
		return `<!--w:${root._prefix}-->${within(root, () => stringify(untrack(setup), root))}<!--/w-->`
	} finally {
		dispose(root)
	}
}

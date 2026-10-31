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
	`allowfullscreen async autofocus autoplay checked controls credentialless default defer disabled disablepictureinpicture disableremoteplayback formnovalidate inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected shadowrootclonable shadowrootdelegatesfocus shadowrootserializable`.split(
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
					const explicit = (child as VNode | null)?.props?.[`key`]
					const key = explicit == null ? index : String(explicit)
					if (keys.has(key)) throw new Error(`spa: duplicate key`)
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
		throw new TypeError(`spa: invalid child`)
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
	if (!/^[A-Za-z][\w.:-]*$/.test(type)) throw new Error(`spa: invalid tag`)
	if (type === `astro-slot`)
		return `<astro-slot${props[`name`] ? ` name="${escape(props[`name`])}"` : ``}>${props[`innerHTML`] ?? ``}</astro-slot>`
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
			throw new Error(`spa: owned content`)
		let attribute = props[key]
		if (ns === `html`) {
			if (key === `defaultValue` && (type === `input` || type === `textarea`)) {
				if (props[`value`] != null) continue
				key = `value`
			} else if (key === `defaultChecked` && type === `input`) {
				if (props[`checked`] != null) continue
				key = `checked`
			}
		}
		if (key === `className`) key = `class`
		if (key === `htmlFor`) key = `for`
		if (!/^[^\s"'<>/=]+$/.test(key)) throw new Error(`spa: invalid attribute`)
		if (key === `value` && (type === `select` || type === `textarea`)) {
			textValue = attribute ?? textValue
			continue
		}
		if (key === `style` && attribute != null && typeof attribute !== `string`)
			throw new TypeError(`spa: CSS string required`)
		const boolean =
			ns === `html` &&
			(booleans.has(key.toLowerCase()) ||
				(/^(capture|download|hidden)$/.test(key) &&
					typeof attribute === `boolean`))
		if (attribute == null || (boolean && !attribute)) continue
		attrs += boolean ? ` ${key}=""` : ` ${key}="${escape(attribute)}"`
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
			throw new Error(`spa: unsafe raw text`)
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
	if (/--|[<>]/.test(root._prefix)) throw new Error(`spa: invalid idPrefix`)
	try {
		return `<!--w:${root._prefix}-->${within(root, () => stringify(untrack(setup), root))}<!--/w-->`
	} finally {
		dispose(root)
	}
}

import type { Accessor, Child, RootOptions, Scope, VNode } from "./core.ts"
import {
	createRoot,
	createScope,
	dispose,
	fail,
	invalidate,
	observe,
	plain,
	untrack,
	within,
} from "./core.ts"
import { Fragment, merge } from "./jsx-runtime.ts"

const HTML = `http://www.w3.org/1999/xhtml`
const SVG = `http://www.w3.org/2000/svg`
type Cursor = { node: Node | null }
type RecordNode = { _value: Child; _scope: Scope; _start: Node; _end: Node }

function take(
	node: Node,
	parent: Node,
	before: Node | null,
	owner: Scope,
	cursor?: Cursor,
): Node {
	if (
		cursor &&
		!(node.nodeType === 3 && !node.nodeValue && cursor.node?.nodeType !== 3)
	) {
		const found = cursor.node
		if (
			!found ||
			found.nodeType !== node.nodeType ||
			found.nodeName !== node.nodeName ||
			(found as Element).namespaceURI !== (node as Element).namespaceURI ||
			(node.nodeType !== 1 && found.nodeValue !== node.nodeValue)
		)
			throw new Error(
				import.meta.env.DEV ? `water: hydration mismatch` : undefined,
			)
		node = found
		cursor.node = found.nextSibling
	} else parent.insertBefore(node, cursor ? cursor.node : before)
	owner._cleanups.add(() => {
		;(node as ChildNode).remove()
	})
	return node
}
function comment(
	value: string,
	parent: Node,
	before: Node | null,
	owner: Scope,
	cursor?: Cursor,
): Node {
	return take(
		parent.ownerDocument!.createComment(value),
		parent,
		before,
		owner,
		cursor,
	)
}
function property(
	element: Element,
	key: string,
	value: any,
	previous: any,
): void {
	if (/^(key|children|ref)$/.test(key)) return
	if (key === `innerHTML` && element.localName === `astro-slot`) return
	if (
		/^(innerHTML|outerHTML|textContent|innerText|dangerouslySetInnerHTML)$/.test(
			key,
		)
	)
		throw new Error(import.meta.env.DEV ? `water: owned content` : undefined)
	if (key.startsWith(`on`)) {
		const capture = key.endsWith(`Capture`)
		const event = key
			.slice(2, capture ? -7 : undefined)
			.toLowerCase()
			.replace(`doubleclick`, `dblclick`)
		if (previous) element.removeEventListener(event, previous, capture)
		if (value != null) {
			if (import.meta.env.DEV && typeof value !== `function`)
				throw new Error(`water: event handler`)
			element.addEventListener(event, value, capture)
		}
		return
	}
	if (key === `className`) key = `class`
	if (key === `htmlFor`) key = `for`
	if (
		import.meta.env.DEV &&
		key === `style` &&
		value != null &&
		typeof value !== `string`
	)
		throw new Error(`water: CSS string required`)
	if (
		element.namespaceURI === HTML &&
		key in element &&
		!/^(style|form|list)$/.test(key)
	) {
		const target = element as any
		target[key] = value ?? (typeof target[key] === `boolean` ? false : ``)
	} else if (value == null || (value === false && !/^(aria-|data-)/.test(key)))
		element.removeAttribute(key)
	else
		element.setAttribute(
			key,
			value === true && !/^(aria-|data-)/.test(key) ? `` : String(value),
		)
}

function mount(
	value: Child,
	parent: Node,
	before: Node | null,
	owner: Scope,
	namespace: string,
	cursor?: Cursor,
	source = () => value,
): void {
	if (typeof value === `function`) {
		comment(`{`, parent, before, owner, cursor)
		let end: Node | null = null
		let records = new Map<unknown, RecordNode>()
		let initial = cursor
		observe(
			owner,
			() => (source() as () => Child)(),
			(next) => {
				const values = ([next] as unknown[]).flat(Infinity) as Child[]
				const kept = new Map<unknown, RecordNode>()
				const focus = parent.ownerDocument!.activeElement as HTMLElement | null
				for (let index = 0; index < values.length; index++) {
					const child = values[index]
					const vnode = child as VNode | null
					const explicit = vnode?.props?.[`key`]
					const key = explicit == null ? index : String(explicit)
					if (import.meta.env.DEV && kept.has(key))
						throw new Error(`water: duplicate key`)
					let record = records.get(key)
					if (
						record &&
						(typeof record._value !== typeof child ||
							(record._value as VNode | null)?.type !== vnode?.type)
					) {
						dispose(record._scope)
						record = undefined
					}
					if (!record) {
						const childOwner = createScope(owner)
						record = {
							_value: child,
							_scope: childOwner,
							_start: comment(`[`, parent, end ?? before, childOwner, initial),
							_end: null!,
						}
						const held = record
						mount(
							child,
							parent,
							end ?? before,
							childOwner,
							namespace,
							initial,
							() => held._value,
						)
						record._end = comment(
							`]`,
							parent,
							end ?? before,
							childOwner,
							initial,
						)
					} else {
						record._value = child
						invalidate(record._scope)
					}
					kept.set(key, record)
				}
				for (const [key, record] of records)
					if (!kept.has(key)) dispose(record._scope)
				if (!initial) {
					let at = end ?? before
					for (const record of [...kept.values()].reverse()) {
						if (record._end.nextSibling !== at) {
							const range = parent.ownerDocument!.createRange()
							range.setStartBefore(record._start)
							range.setEndAfter(record._end)
							parent.insertBefore(range.extractContents(), at)
						}
						at = record._start
					}
					if (
						focus?.isConnected &&
						focus !== parent.ownerDocument!.activeElement
					)
						focus.focus({ preventScroll: true })
				}
				initial = undefined
				records = kept
			},
		)
		end = comment(`}`, parent, before, owner, cursor)
		return
	}
	if (Array.isArray(value)) {
		for (const child of value)
			mount(child, parent, before, owner, namespace, cursor)
		return
	}
	if (value == null || typeof value === `boolean`) return
	if (typeof value !== `object`) {
		comment(`t`, parent, before, owner, cursor)
		const text = take(
			parent.ownerDocument!.createTextNode(String(value)),
			parent,
			before,
			owner,
			cursor,
		)
		observe(owner, source as Accessor<string | number | bigint>, (next) => {
			const data = String(next)
			if (text.nodeValue !== data) text.nodeValue = data
		})
		return
	}
	if (import.meta.env.DEV && (!(`type` in value) || !(`props` in value)))
		throw new Error(`water: invalid child`)
	const vnode = value as VNode
	const props = merge(() => (source() as VNode).props)
	if (!vnode.type || vnode.type === Fragment) {
		mount(() => props[`children`], parent, before, owner, namespace, cursor)
		return
	}
	if (typeof vnode.type === `function`) {
		const childOwner = createScope(owner)
		const output = within(childOwner, () =>
			untrack(() => (vnode.type as Function)(props)),
		)
		mount(output, parent, before, childOwner, namespace, cursor)
		return
	}
	const ns = vnode.type === `svg` ? SVG : namespace
	const element = take(
		parent.ownerDocument!.createElementNS(ns, vnode.type),
		parent,
		before,
		owner,
		cursor,
	) as Element
	if (vnode.type === `astro-slot`) {
		if (!cursor) element.innerHTML = props[`innerHTML`] ?? ``
	} else if (ns === HTML && /^(textarea|title|style|script)$/.test(vnode.type)) {
		observe(
			owner,
			() =>
				plain(
					vnode.type === `textarea`
						? (props[`value`] ?? props[`children`])
						: props[`children`],
				),
			(text) => {
				if (element.textContent !== text) element.textContent = text
			},
		)
	} else {
		const children = cursor ? { node: element.firstChild } : undefined
		if (
			!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(
				vnode.type,
			) ||
			ns !== HTML
		)
			mount(
				() => props[`children`],
				element,
				null,
				owner,
				vnode.type === `foreignObject` ? HTML : ns,
				children,
			)
		if (children?.node)
			throw new Error(
				import.meta.env.DEV ? `water: hydration mismatch` : undefined,
			)
	}
	let previous: Record<string, any> = {}
	owner._cleanups.add(() => {
		for (const key in previous)
			if (key.startsWith(`on`)) property(element, key, null, previous[key])
	})
	observe(
		owner,
		() => ({ ...props }),
		(next) => {
			for (const key in { ...previous, ...next })
				if (
					!Object.is(previous[key], next[key]) ||
					typeof next[key] === `object`
				) {
					property(element, key, next[key], previous[key])
					previous[key] = next[key]
				}
			previous = next
		},
	)
	const ref = untrack(() => props[`ref`])
	if (ref) {
		owner._root._mounts!.unshift(() => {
			if (!owner._dead) {
				owner._cleanups.add(() => ref(null))
				ref(element)
			}
		})
	}
}

export interface WaterRoot {
	dispose(): void
	flush(): void
}
function start(
	setup: () => Child,
	host: Element,
	options: RootOptions,
	hydrating: boolean,
): WaterRoot {
	const cursor = hydrating ? { node: host.firstChild } : undefined
	const prefix = cursor?.node?.nodeValue?.slice(2)
	if (
		hydrating &&
		(prefix === undefined ||
			(options.idPrefix !== undefined && prefix !== options.idPrefix))
	)
		throw new Error(
			import.meta.env.DEV ? `water: hydration mismatch` : undefined,
		)
	const root = createRoot(options)
	if (prefix !== undefined) root._prefix = prefix
	try {
		comment(`w:${root._prefix}`, host, null, root, cursor)
		within(root, () => {
			mount(
				untrack(setup),
				host,
				null,
				root,
				host.namespaceURI === SVG ? SVG : HTML,
				cursor,
			)
		})
		comment(`/w`, host, null, root, cursor)
		if (cursor?.node)
			throw new Error(
				import.meta.env.DEV ? `water: hydration mismatch` : undefined,
			)
		root.flush()
	} catch (error) {
		fail(root, error)
	}
	return {
		dispose: () => {
			dispose(root)
		},
		flush: root.flush,
	}
}
export function render(
	setup: () => Child,
	host: Element,
	options: RootOptions = {},
): WaterRoot {
	return start(setup, host, options, false)
}
export function hydrate(
	setup: () => Child,
	host: Element,
	options: RootOptions = {},
): WaterRoot {
	return start(setup, host, options, true)
}

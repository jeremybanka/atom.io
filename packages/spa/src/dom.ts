import { capabilityProps } from "./capabilities.ts"
import type {
	Accessor,
	Children,
	RootOptions,
	Scope,
	SpaElement,
} from "./core.ts"
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
type Cursor = {
	node: Node | null
	report(expected: Node | null, found: Node | null): void
}
type RecordNode = { _value: Children; _scope: Scope; _start: Node; _end: Node }

function finish(cursor?: Cursor): void {
	if (cursor?.node) {
		cursor.report(null, cursor.node)
		while (cursor.node) {
			const node: Node = cursor.node
			cursor.node = node.nextSibling
			;(node as ChildNode).remove()
		}
	}
}

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
		) {
			cursor.report(node, found)
			parent.insertBefore(node, found)
			cursor.node = found?.nextSibling ?? null
			;(found as ChildNode | null)?.remove()
		} else {
			node = found
			cursor.node = found.nextSibling
		}
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
		throw new Error(import.meta.env.DEV ? `spa: owned content` : undefined)
	if (key.startsWith(`on`)) {
		const capture = /(?<!Pointer)Capture$/.test(key)
		const event = key
			.slice(2, capture ? -7 : undefined)
			.toLowerCase()
			.replace(`doubleclick`, `dblclick`)
		if (previous) element.removeEventListener(event, previous, capture)
		if (value != null) {
			if (import.meta.env.DEV && typeof value !== `function`)
				throw new Error(`spa: event handler`)
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
		throw new Error(`spa: CSS string required`)
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
	value: Children,
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
		const presence = owner._root._presence?.collection<RecordNode, Children>(
			(record) => record._scope,
			(record, child) =>
				typeof record._value === typeof child &&
				(record._value as SpaElement | null)?.type ===
					(child as SpaElement | null)?.type,
		)
		const retire = (
			record: RecordNode,
			key: unknown,
			eligible: boolean,
			index: number,
		) => {
			if (presence) presence.remove(record, key, eligible, index, () => {})
			else dispose(record._scope)
		}
		let initial = cursor
		observe(
			owner,
			() => (source() as () => Children)(),
			(next) => {
				const values = ([next] as unknown[]).flat(Infinity) as Children[]
				const kept = new Map<unknown, RecordNode>()
				const focus = parent.ownerDocument!.activeElement as HTMLElement | null
				for (let index = 0; index < values.length; index++) {
					const child = values[index]
					const vnode = child as SpaElement | null
					const explicit = vnode?.props?.[`key`]
					const key = explicit == null ? index : String(explicit)
					if (import.meta.env.DEV && kept.has(key))
						throw new Error(`spa: duplicate key`)
					let record = records.get(key)
					if (
						record &&
						(typeof record._value !== typeof child ||
							(record._value as SpaElement | null)?.type !== vnode?.type)
					) {
						retire(
							record,
							key,
							child == null || typeof child === `boolean`,
							[...records.keys()].indexOf(key),
						)
						record = undefined
					}
					record ??= presence?.take(key, child)
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
						owner._root._presence?.resume(record._scope)
						invalidate(record._scope)
					}
					kept.set(key, record)
				}
				for (const [key, record] of records)
					if (!kept.has(key))
						retire(record, key, true, [...records.keys()].indexOf(key))
				if (!initial) {
					let at = end ?? before
					const rendered = presence?.merge([...kept.values()]) ?? [
						...kept.values(),
					]
					for (const record of rendered.reverse()) {
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
						!focus.closest(`[inert]`) &&
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
		throw new Error(`spa: invalid child`)
	const vnode = value as SpaElement
	const props = merge(() => (source() as SpaElement).props)
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
		const children = cursor
			? { node: element.firstChild, report: cursor.report }
			: undefined
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
		finish(children)
	}
	let previous: Record<string, any> = {}
	const nativeProps = capabilityProps(
		owner,
		{ kind: `dom`, node: element },
		() => ({ ...props }),
		(next) => {
			const styleChanged = previous[`style`] !== next[`style`]
			for (const key in { ...previous, ...next })
				if (
					!Object.is(previous[key], next[key]) ||
					typeof next[key] === `object`
				) {
					property(element, key, next[key], previous[key])
					previous[key] = next[key]
				}
			previous = next
			return styleChanged
		},
	)
	owner._cleanups.add(() => {
		for (const key in previous)
			if (key.startsWith(`on`)) property(element, key, null, previous[key])
	})
	observe(owner, () => ({ ...props }), nativeProps)
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

export interface SpaRoot {
	dispose(): void
	flush(): void
}
function start(
	setup: () => Children,
	host: Element,
	options: RootOptions,
	hydrating: boolean,
): SpaRoot {
	let reported = false
	const cursor: Cursor | undefined = hydrating
		? {
				node: host.firstChild,
				report(expected, found) {
					if (!reported) {
						reported = true
						// eslint-disable-next-line no-console -- Recoverable degradation must remain human-readable in production.
						console.warn(
							`spa: hydration mismatch. Repairing server HTML to match the browser view; replaced nodes may lose focus or unsaved input.`,
							{ host, expected, found },
						)
					}
				},
			}
		: undefined
	const marker = cursor?.node
	const prefix =
		marker?.nodeType === 8 && marker.nodeValue?.startsWith(`w:`)
			? marker.nodeValue.slice(2)
			: undefined
	const root = createRoot(options)
	if (prefix !== undefined && options.idPrefix === undefined)
		root._prefix = prefix
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
		finish(cursor)
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
	setup: () => Children,
	host: Element,
	options: RootOptions = {},
): SpaRoot {
	return start(setup, host, options, false)
}
export function hydrate(
	setup: () => Children,
	host: Element,
	options: RootOptions = {},
): SpaRoot {
	return start(setup, host, options, true)
}

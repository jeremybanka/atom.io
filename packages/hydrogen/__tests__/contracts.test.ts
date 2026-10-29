import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import integration from "../src/astro.ts"
import astroClient from "../src/astro-client.ts"
import astroServer from "../src/astro-server.ts"
import { islandStore } from "../src/astro-shared.ts"
import { compile } from "../src/compiler.ts"
import { owner, type Scope, useValue } from "../src/core.ts"
import {
	createRoot,
	createScope,
	dispose,
	invalidate,
	observe,
	onMount,
	plain,
	useRef,
	useTimeline,
	useTransaction,
	within,
} from "../src/core.ts"
import { hydrate, render } from "../src/dom.ts"
import { Fragment, jsx, merge } from "../src/jsx-runtime.ts"
import { renderToString } from "../src/server.ts"
import hydrogen from "../src/vite.ts"

afterEach(() => vi.unstubAllEnvs())

it(`compiles JSX syntax while keeping getters and spread precedence live`, () => {
	const sources = [
		`export default (function () { return <UI.Group.Item {...first} a="a" {...last} enabled key={id} ns:value={value} get={fn} onClick={() => 1}><this.Label />{\`static\`}{\`value \${value}\`}{() => value}{1}<X-thing /></UI.Group.Item> })`,
		`const App = () => <><ui.Label/><svg:path/><Custom/>{/* empty */}</>`,
		`<div/>`,
		`(function () { return <div/> })()`,
		`(() => <div/>)()`,
	]
	for (const source of sources) {
		const result = compile(source, `syntax.tsx`)
		expect(result.code).toContain(`hydrogen/jsx-runtime`)
		expect(result.map.sources).toEqual([`syntax.tsx`])
		expect(result.code).not.toMatch(/<\/?(?:div|Custom|UI)/)
	}
	const result = compile(
		`const App = () => <div {...a} title={value}>{value}</div>`,
		`live.tsx`,
	)
	expect(result.code).toContain(`get "title"()`)
	expect(result.code).toContain(`() => value`)
	expect(() => compile(`<div value={}/>`, `invalid.tsx`)).toThrow()
})
it(`filters Vite inputs, resets global regexes, and reloads matching documents`, () => {
	for (const plugin of [hydrogen(), hydrogen({ include: /\.tsx$/g })]) {
		const transform = plugin.transform as Function
		expect(transform(`<p/>`, `/src/a.tsx?query`).code).toContain(`_hydrogen`)
		expect(transform(`<p/>`, `/src/a.tsx`).code).toContain(`_hydrogen`)
		expect(transform(`bad syntax`, `/node_modules/a.tsx`)).toBeUndefined()
		expect(transform(`bad syntax`, `/src/a.ts`)).toBeUndefined()
		const send = vi.fn()
		const update = plugin.handleHotUpdate as Function
		expect(
			update({ server: { ws: { send } }, file: `/src/a.ts` }),
		).toBeUndefined()
		expect(update({ server: { ws: { send } }, file: `/src/a.tsx` })).toEqual([])
		expect(send).toHaveBeenCalledExactlyOnceWith({ type: `full-reload` })
	}
	for (const adapter of [
		integration(),
		integration({ include: /custom.tsx$/ }),
	]) {
		const addRenderer = vi.fn(),
			updateConfig = vi.fn()
		;(adapter.hooks[`astro:config:setup`] as Function)({
			addRenderer,
			updateConfig,
		})
		expect(addRenderer.mock.calls[0][0].serverEntrypoint).toBe(
			`hydrogen/astro-server`,
		)
		expect(updateConfig.mock.calls[0][0].vite.plugins[0].name).toBe(`hydrogen`)
	}
})
it(`supports automatic JSX runtime keys and lazy missing spreads`, () => {
	expect(Fragment({ children: `child` })).toBe(`child`)
	expect(jsx(`p`, null).props).toEqual({})
	expect(jsx(`p`, null, 1).props[`key`]).toBe(1)
	expect(jsx(`p`, { key: 0 }, 2).props[`key`]).toBe(2)
	const props = merge(
		() => undefined as any,
		{ a: 1 },
		() => ({ a: 2, b: 3 }),
	)
	expect({ ...props }).toEqual({ a: 2, b: 3 })
	expect(props[`missing`]).toBeUndefined()
})
it(`creates isolated default island stores and replaces component identity`, async () => {
	const A = Object.assign(() => jsx(`p`, { children: `A` }), { hydrogen: true })
	const B = Object.assign(() => jsx(`b`, { children: `B` }), { hydrogen: true })
	expect(islandStore(A, {})).not.toBe(islandStore(A, {}))
	expect(await (astroServer.check as Function)(null)).toBe(false)
	expect(await (astroServer.check as Function)(() => null)).toBe(false)
	const host = document.createElement(`div`)
	await astroClient(host)(A, {}, {}, { client: `only` })
	await astroClient(host)(B, {}, {}, { client: `load` })
	expect(host.textContent).toBe(`B`)
	host.dispatchEvent(new Event(`astro:unmount`))
	const silo = new Silo({
		name: `islands`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const C = Object.assign(() => jsx(`p`, { children: `C` }), {
		createStore: () => silo.store,
	})
	for (let i = 0; i < 2; i++) {
		await astroClient(host)(C, {}, {}, { client: `only` })
		host.dispatchEvent(new Event(`astro:unmount`))
	}
	const Broken = Object.assign(
		() => {
			throw new Error(`setup`)
		},
		{ createStore: () => silo.store },
	)
	await expect(
		astroClient(host)(Broken, {}, {}, { client: `only` }),
	).rejects.toThrow(`setup`)
	expect(
		[...silo.store.atoms.keys()].filter((key) =>
			key.startsWith(`🔍 hydrogen islands`),
		),
	).toEqual([])
})
it(`ignores stale work and cancels mounts in disposed scopes`, () => {
	const root = createRoot()
	const scope = createScope(root)
	const read = vi.fn(() => 1),
		apply = vi.fn(),
		mounted = vi.fn()
	within(scope, () => {
		onMount(mounted)
	})
	observe(scope, read, apply)
	const run = scope._updates[0]
	dispose(scope)
	run()
	// A stale invalidation can arrive after disposal; it cannot schedule work.
	scope._updates.push(run)
	invalidate(scope)
	root.flush()
	expect(read).toHaveBeenCalledOnce()
	expect(mounted).not.toHaveBeenCalled()
	expect(() => {
		root.error(new Error(`unhandled`))
	}).toThrow(`unhandled`)
	dispose(root)
})
it(`stops feedback loops and preserves externally replaced refs`, () => {
	const root = createRoot()
	const repeat = () => root._queue.add(repeat)
	root._queue.add(repeat)
	expect(() => {
		root.flush()
	}).toThrow(`update loop`)
	expect(root._dead).toBe(true)
	const silo = new Silo({
		name: `ref`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const elementAtom = silo.atom<Element | null>({
		key: `element`,
		default: null,
	})
	const refOwner = createRoot({ store: silo.store })
	const ref = within(refOwner, () => useRef(elementAtom))
	ref(document.createElement(`p`))
	const replacement = document.createElement(`b`)
	silo.setState(elementAtom, replacement)
	ref(null)
	expect(silo.getState(elementAtom)).toBe(replacement)
	dispose(refOwner)
})
it(`controls complete transaction groups, redo, and clearing timelines`, () => {
	const silo = new Silo({
		name: `history`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const historyTimeline = silo.timeline({ key: `history`, scope: [countAtom] })
	const twoTransaction = silo.transaction<() => void>({
		key: `two`,
		do: ({ set }) => {
			set(countAtom, 1)
			set(countAtom, 2)
		},
	})
	const root = createRoot({ store: silo.store })
	const [history, run] = within(
		root,
		() =>
			[useTimeline(historyTimeline), useTransaction(twoTransaction)] as const,
	)
	run()
	expect(history().undoTransaction).toBeTypeOf(`function`)
	history().undoTransaction!()
	expect(silo.getState(countAtom)).toBe(0)
	history().redoTransaction!()
	expect(silo.getState(countAtom)).toBe(2)
	history().undo()
	history().redo()
	expect(silo.getState(countAtom)).toBe(2)
	history().clear()
	expect(history().length).toBe(0)
	dispose(root)
})
it(`validates text, duplicate keys, and owned content on the server`, () => {
	expect(plain([null, false, () => [`x`, 1n]])).toBe(`x1`)
	expect(() => plain(jsx(`p`, {}))).toThrow(`text required`)
	const invalid = [
		[{}, `invalid child`],
		[{ type: `p` }, `invalid child`],
		[jsx(`bad tag`, {}), `invalid tag`],
		[jsx(`p`, { innerHTML: `x` }), `owned content`],
		[jsx(`p`, { "bad name": 1 }), `invalid attribute`],
		[jsx(`p`, { style: { color: `red` } }), `CSS string required`],
		[jsx(`script`, { children: `</script>` }), `unsafe raw text`],
		[() => [jsx(`p`, { key: `a` }), jsx(`p`, { key: `a` })], `duplicate key`],
	] as const
	for (const [child, message] of invalid)
		expect(() => renderToString(() => child as any)).toThrow(message)
	expect(() => renderToString(() => null, { idPrefix: `--` })).toThrow(
		`invalid idPrefix`,
	)
	const output = renderToString(() => [
		jsx(`label`, {
			className: `c`,
			htmlFor: `x`,
			style: `color:red`,
			hidden: false,
			disabled: true,
			"data-on": true,
			"data-off": false,
			custom: true,
			absent: null,
			no: false,
		}),
		jsx(`svg`, {
			children: jsx(`foreignObject`, {
				children: jsx(`input`, { disabled: true }),
			}),
		}),
		jsx(`astro-slot`, {}),
		jsx(`p`, { style: null }),
		jsx(`script`, { children: `const n = 1` }),
	])
	expect(output).toContain(`class="c" for="x"`)
	expect(output).toContain(`data-off="false" custom=""`)
	expect(output).toContain(`<astro-slot></astro-slot>`)
	expect(output).not.toContain(`hidden=`)
})
it(`handles DOM attributes, capture events, SVG hosts, and empty text hydration`, () => {
	const host = document.createElement(`div`)
	const click = vi.fn()
	const root = render(
		() => [
			jsx(`label`, {
				className: `c`,
				htmlFor: `x`,
				custom: true,
				"aria-checked": true,
				onClickCapture: click,
			}),
			jsx(`astro-slot`, {}),
		],
		host,
	)
	host
		.querySelector(`label`)!
		.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
	expect(click).toHaveBeenCalledOnce()
	expect(host.querySelector(`label`)!.getAttribute(`custom`)).toBe(``)
	root.dispose()
	const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
	const svgRoot = render(
		() => jsx(`foreignObject`, { children: jsx(`input`, {}) }),
		svg,
	)
	expect(svg.querySelector(`input`)!.namespaceURI).toBe(
		`http://www.w3.org/1999/xhtml`,
	)
	svgRoot.dispose()
	host.innerHTML = renderToString(() => ``, { idPrefix: `empty` })
	const empty = hydrate(() => ``, host, { idPrefix: `empty` })
	expect([...host.childNodes].some((node) => node.nodeType === 3)).toBe(true)
	empty.dispose()
})
it(`rejects malformed DOM input and hydration leftovers in development and production`, () => {
	for (const dev of [true, false]) {
		vi.stubEnv(`DEV`, dev)
		const host = document.createElement(`div`)
		for (const props of [
			{ innerHTML: `x` },
			...(dev ? [{ style: {} }, { onClick: `wrong` }] : []),
		])
			expect(() => render(() => jsx(`p`, props), host)).toThrow()
		if (dev) {
			expect(() => render(() => ({ type: `p` }) as any, host)).toThrow(
				`invalid child`,
			)
			expect(() =>
				render(() => () => [jsx(`p`, { key: 1 }), jsx(`p`, { key: 1 })], host),
			).toThrow(`duplicate key`)
		}
		expect(() => hydrate(() => null, host)).toThrow()
		host.innerHTML = renderToString(() => jsx(`p`, {}), { idPrefix: `a` })
		expect(() => hydrate(() => null, host, { idPrefix: `b` })).toThrow()
		host.innerHTML = renderToString(() => jsx(`p`, {}))
		host.querySelector(`p`)!.append(document.createTextNode(`extra`))
		expect(() => hydrate(() => jsx(`p`, {}), host)).toThrow()
		host.innerHTML = renderToString(() => null) + `extra`
		expect(() => hydrate(() => null, host)).toThrow()
		host.innerHTML = renderToString(() => jsx(`b`, {}))
		expect(() => hydrate(() => jsx(`p`, {}), host)).toThrow()
	}
})
it(`resets removed boolean properties and skips refs whose owners were removed before attachment`, () => {
	const host = document.createElement(`div`)
	const silo = new Silo({
		name: `props`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const propsAtom = silo.atom<Record<string, unknown>>({
		key: `props`,
		default: { disabled: true },
	})
	let read!: () => Record<string, unknown>
	const root = render(
		() => {
			read = useValue(propsAtom)
			return jsx(`button`, merge(read))
		},
		host,
		{ store: silo.store },
	)
	silo.setState(propsAtom, {})
	root.flush()
	expect(host.querySelector(`button`)!.disabled).toBe(false)
	root.dispose()
	let childOwner!: Scope
	const ref = vi.fn()
	const Child = () => {
		childOwner = owner!
		return jsx(`input`, { ref })
	}
	const second = render(
		() => [
			jsx(Child, {}),
			jsx(`input`, {
				ref: (element: Element | null) => {
					if (element) dispose(childOwner)
				},
			}),
		],
		host,
	)
	expect(ref).not.toHaveBeenCalled()
	second.dispose()
})

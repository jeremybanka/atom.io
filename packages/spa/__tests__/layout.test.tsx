import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { dispose } from "../src/core.ts"
import type { Capability, CapabilityBinding } from "../src/index.ts"
import { render, useGetter } from "../src/index.ts"
import type { LayoutCapabilityOptions } from "../src/layout.ts"
import { layoutCapability } from "../src/layout.ts"
import { motionCapability } from "../src/motion.ts"
import { renderToString } from "../src/server.ts"

const probe = vi.hoisted(() => ({
	nodes: [] as any[],
	events: [] as any[],
	values: {} as any,
	animated: false,
	store: new WeakMap<object, any>(),
	adopted: 0,
	failMeasure: false,
	failDetach: false,
	ownRoot: false,
}))
vi.mock(`motion`, async (actual) => ({
	...(await actual()),
	visualElementStore: probe.store,
	handOffElementState: vi.fn(() => {
		probe.adopted++
	}),
	acquireProjectionNode: (element: HTMLElement) => {
		const latestValues = { ...probe.values }
		const visual: any = {
			latestValues,
			values: new Map(probe.animated ? [[`x`, 1]] : []),
			props: {},
			getProps() {
				return this.props
			},
			update: vi.fn((props) => {
				visual.props = props
			}),
			unmount: vi.fn(),
		}
		const node: any = {
			latestValues,
			applyProjectionStyles: vi.fn(),
			options: { visualElement: visual },
			layout: { source: 1 },
			setOptions: vi.fn((options) => Object.assign(node.options, options)),
			willUpdate: vi.fn(() => {
				if (probe.failMeasure) throw new Error(`measure failed`)
				probe.events.push([`before`, element.style.width])
			}),
			didUpdate: vi.fn(() => {
				probe.events.push([`after`, element.style.width])
			}),
			isLead: vi.fn(() => true),
			finishAnimation: vi.fn(),
			promote: vi.fn(),
		}
		if (!probe.ownRoot) node.root = node
		visual.projection = node
		probe.store.set(element, visual)
		const detach = vi.fn(() => {
			if (probe.failDetach) throw new Error(`detach failed`)
		})
		probe.nodes.push({ node, visual, detach, element })
		return [node, detach]
	},
}))
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	probe.nodes.length = 0
	probe.events.length = 0
	probe.values = {}
	probe.adopted = 0
	probe.animated = probe.failMeasure = probe.failDetach = probe.ownRoot = false
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})
function fixture(
	options: LayoutCapabilityOptions = {},
	initial: Record<string, any> = {
		"layout:animate": true,
		"layout:id": `marker`,
		style: `width:10px;height:10px;transform:rotate(8deg);transform-origin:0 0`,
	},
	extra: Capability[] = [],
) {
	const silo = new Silo({
		name: `layout-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const propsAtom = silo.atom<Record<string, any>>({
		key: `props`,
		default: initial,
	})
	const bindings: CapabilityBinding[] = []
	const base = layoutCapability(options)
	const cap: Capability = {
		...base,
		attach(target, scope) {
			const binding = base.attach(target, scope)
			binding.exit?.({})
			binding.resume?.()
			bindings.push(binding)
			return binding
		},
	}
	const host = document.createElement(`main`)
	document.body.append(host)
	function App() {
		const getProps = useGetter(propsAtom)
		return <section {...getProps()} />
	}
	const onError = vi.fn()
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [cap, ...extra],
		onError,
	})
	cleanups.push(root.dispose)
	return {
		root,
		host,
		silo,
		propsAtom,
		bindings,
		onError,
		update: (props: Record<string, any>) => {
			silo.setState(propsAtom, props)
			root.flush()
		},
	}
}
function observers() {
	const records: any[] = []
	vi.stubGlobal(
		`ResizeObserver`,
		class {
			public observe = vi.fn()
			public unobserve = vi.fn()
			public disconnect = vi.fn()
			public constructor(callback: (changes: { target: Element }[]) => void) {
				records.push({ callback, native: this })
			}
		},
	)
	return records
}
function media() {
	let changed = () => {}
	const preference = {
		matches: false,
		addEventListener: vi.fn((_type, callback) => {
			changed = callback
		}),
		removeEventListener: vi.fn(),
	}
	vi.stubGlobal(`matchMedia`, () => preference)
	return {
		preference,
		changed: () => {
			changed()
		},
	}
}

it(`coordinates measurement around native writes, restores author styles, and releases on capability removal`, () => {
	const watched = observers()
	probe.animated = true
	probe.values = { originX: 0, originY: 0, opacity: 1 }
	vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(10)
	vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(10)
	const f = fixture({ reducedMotion: `never` })
	const current = probe.nodes[0]
	expect(current.visual.props.transformTemplate({}, `none`)).toContain(`rotate`)
	expect(
		current.visual.props.transformTemplate({}, `translateX(2px)`),
	).toContain(`translateX`)
	probe.events.length = 0
	current.node.isLead.mockReturnValue(false)
	f.update({
		"layout:animate": `position`,
		"layout:id": `marker`,
		"layout:group": `ready`,
		"layout:scroll": true,
		style: `width:20px;height:10px`,
	})
	expect(probe.events[0]).toEqual([`before`, `10px`])
	expect(probe.events.at(-1)).toEqual([`after`, `20px`])
	expect(probe.nodes.at(-1).node.options).toMatchObject({
		animationType: `position`,
		layoutScroll: true,
	})
	f.bindings[0].exit?.({})
	expect(probe.nodes.at(-1).node.isPresent).toBe(false)
	f.bindings[0].resume?.()
	expect(probe.nodes.at(-1).node.promote).toHaveBeenCalledOnce()
	f.update({ style: `width:30px` })
	expect(probe.nodes.at(-1).detach).toHaveBeenCalledOnce()
	f.bindings[0].dispose()
	expect(watched[0].native.unobserve).toHaveBeenCalled()
})
it(`initializes nodes in document order, isolates groups and roots, and supports scroll-only and disabled targets`, () => {
	probe.values = { x: 2 }
	probe.ownRoot = true
	const f = fixture(
		{},
		{
			"layout:animate": false,
			"layout:scroll": true,
			"data-layout": `original`,
			"data-layout-id": `original-id`,
		},
	)
	expect(probe.nodes[0].node.options.animate).toBe(false)
	f.root.dispose()
	expect(probe.nodes[0].element.getAttribute(`data-layout`)).toBe(`original`)
	expect(probe.nodes[0].element.getAttribute(`data-layout-id`)).toBe(
		`original-id`,
	)
	const cap = layoutCapability()
	const host = document.createElement(`main`)
	document.body.append(host)
	const root = render(
		() => (
			<article layout:animate>
				<i layout:animate="size" layout:id="same" layout:group="one" />
				<i layout:id="same" layout:group="two" />
			</article>
		),
		host,
		{ capabilities: [cap] },
	)
	cleanups.push(root.dispose)
	const nodes = probe.nodes.slice(1)
	expect(nodes[0].element.tagName).toBe(`ARTICLE`)
	expect(nodes[1].element.getAttribute(`data-layout-id`)).not.toBe(
		nodes[2].element.getAttribute(`data-layout-id`),
	)
	const other = fixture({}, { "layout:id": `same`, "layout:group": `one` })
	expect(probe.nodes.at(-1).element.getAttribute(`data-layout-id`)).not.toBe(
		nodes[1].element.getAttribute(`data-layout-id`),
	)
	other.root.dispose()
})
it(`measures observed external resizes from the previous layout and disconnects observers`, () => {
	const watched = observers()
	const f = fixture()
	const entry = probe.nodes[0]
	watched[0].callback([
		{ target: document.createElement(`div`) },
		{ target: entry.element },
	])
	Object.defineProperty(entry.element, `offsetWidth`, {
		value: 20,
		configurable: true,
	})
	watched[0].callback([{ target: entry.element }])
	expect(entry.node.snapshot).toBe(entry.node.layout)
	entry.node.layout = undefined
	Object.defineProperty(entry.element, `offsetWidth`, {
		value: 30,
		configurable: true,
	})
	watched[0].callback([{ target: entry.element }])
	f.root.dispose()
	watched[0].callback([{ target: entry.element }])
	expect(watched[0].native.disconnect).toHaveBeenCalledOnce()
})
it(`finishes projections on reduced-motion changes and reports resize/media failures through the root`, () => {
	const watched = observers()
	const m = media()
	const f = fixture()
	m.preference.matches = true
	m.changed()
	expect(probe.nodes[0].node.finishAnimation).toHaveBeenCalled()
	Object.defineProperty(probe.nodes[0].element, `offsetWidth`, {
		value: 20,
		configurable: true,
	})
	probe.failMeasure = true
	watched[0].callback([{ target: probe.nodes[0].element }])
	expect(f.onError).toHaveBeenCalledWith(
		expect.objectContaining({ message: `measure failed` }),
	)
	m.changed()
	expect(m.preference.removeEventListener).toHaveBeenCalled()
	probe.failMeasure = false
	const g = fixture({ reducedMotion: `always` })
	g.bindings[0].update({ transition: { duration: -1 } })
	m.changed()
	expect(g.onError).toHaveBeenCalledWith(
		expect.objectContaining({ message: expect.stringContaining(`finite`) }),
	)
})
it(`rejects invalid hosts, properties, and non-settling transitions and cleans every projection after errors`, () => {
	expect(() => layoutCapability().attach({ kind: `three`, node: {} })).toThrow(
		`owned HTML`,
	)
	expect(() => layoutCapability().attach({ kind: `dom`, node: null })).toThrow(
		`owned HTML`,
	)
	expect(() => fixture({}, { "layout:unknown": true })).toThrow(
		`unknown property`,
	)
	for (const transition of [
		{ duration: Infinity },
		{ stiffness: 0 },
		{ damping: -1 },
		{ mass: 0 },
	])
		expect(() => fixture({ transition })).toThrow(`finite`)
	const f = fixture()
	probe.failDetach = true
	expect(() => {
		f.root.dispose()
	}).toThrow(AggregateError)
	expect(probe.nodes.at(-1).visual.unmount).toHaveBeenCalled()
})
it(`skips disconnected targets and completes pending commits safely when a root is disposed mid-update`, () => {
	const f = fixture({}, { "layout:animate": true, style: `width:10px` })
	f.host.remove()
	f.update({ "layout:animate": true, style: `width:20px` })
	let mounted = false
	const stop: Capability = {
		namespace: `stop`,
		attach: () => ({ update() {}, dispose() {} }),
		beforeUpdate(root) {
			if (mounted) dispose(root)
			mounted = true
			return () => {}
		},
	}
	const g = fixture({}, { "layout:animate": true }, [stop])
	g.update({ "layout:animate": true, style: `width:40px` })
	expect(() => {
		g.root.flush()
	}).not.toThrow()
})
it(`keeps layout attributes and engine work out of server markup`, () => {
	const html = renderToString(
		() => <section layout:animate layout:id="server" />,
		{ capabilities: [layoutCapability()] },
	)
	expect(html).not.toContain(`layout:`)
	expect(probe.nodes).toHaveLength(0)
})

it(`defers pre-mount media/observer work and supports environments without ResizeObserver`, () => {
	const watched = observers()
	const m = media()
	const early: Capability = {
		namespace: `early`,
		attach: () => ({ update() {}, dispose() {} }),
		beforeUpdate() {
			m.changed()
			const element = document.querySelector(`main section`)!
			watched[0].callback([{ target: element }])
			element.remove()
			return () => {}
		},
	}
	fixture({}, { "layout:animate": true }, [early])
	expect(probe.nodes).toHaveLength(0)
	vi.stubGlobal(`ResizeObserver`, undefined)
	fixture({ reducedMotion: `never` })
	expect(probe.nodes).toHaveLength(1)
})

it(`adopts reactive Motion properties into an existing projection renderer`, () => {
	const f = fixture({}, { "layout:animate": true, "motion:animate": { x: 0 } }, [
		motionCapability({ reducedMotion: `always` }),
	])
	f.update({ "layout:animate": true, "motion:animate": { x: 50, y: 20 } })
	expect(probe.adopted).toBeGreaterThan(0)
})

it(`preserves authored projection styles and resolves fixed origins against updated dimensions`, () => {
	vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockImplementation(
		function (this: HTMLElement) {
			return parseFloat(this.style.width)
		},
	)
	vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(80)
	probe.values = { opacity: 0.4, originX: 0.5, originY: 0.5 }
	const props = {
		"layout:id": `authored`,
		style: `width:100px;opacity:.15;visibility:hidden;pointer-events:none;transform-origin:25px 10px`,
	}
	const f = fixture({}, props)
	const { node, visual } = probe.nodes[0]
	expect(node.latestValues).toMatchObject({
		opacity: 0.15,
		originX: 0.25,
		originY: 0.125,
	})
	const output = document.createElement(`div`).style
	node.applyProjectionStyles(output)
	expect(output.opacity).toBe(`0.15`)
	expect(output.visibility).toBe(`hidden`)
	const original = node.applyProjectionStyles
	// Projection's reset path clears these properties on every render.
	output.opacity = output.visibility = ``
	delete node.latestValues.opacity
	original(output, { pointerEvents: `auto` })
	expect(Number(output.opacity)).toBe(0.15)
	output.opacity = `0.3`
	output.visibility = `visible`
	original(output)
	expect(output.opacity).toBe(`0.3`)
	expect(output.visibility).toBe(`visible`)
	f.update({ ...props, style: props.style.replace(`100px`, `200px`) })
	expect(node.latestValues.originX).toBe(0.125)
	visual.values.set(`opacity`, 1)
	visual.values.set(`originX`, 1)
	node.latestValues.opacity = 0.8
	node.latestValues.originX = 0.8
	f.update({ ...props, style: props.style.replace(`100px`, `300px`) })
	expect(node.latestValues).toMatchObject({ opacity: 0.8, originX: 0.8 })
	f.root.dispose()
	expect(node.latestValues).toMatchObject({
		opacity: 0.8,
		originX: 0.8,
		originY: 0.5,
	})
})

it(`returns to authored transform rendering after Motion transform values are removed`, () => {
	const props = { "layout:animate": true, style: `transform:rotate(5deg)` }
	const f = fixture({}, props)
	const { node, visual } = probe.nodes[0]
	expect(visual.props.transformTemplate({}, `none`)).toContain(`rotate(5deg)`)
	node.latestValues.x = 50
	f.update({ ...props })
	expect(visual.props.transformTemplate).toBeUndefined()
	delete node.latestValues.x
	f.update({ ...props })
	expect(visual.props.transformTemplate({}, `none`)).toContain(`rotate(5deg)`)
})

it(`keeps a fixed-pixel origin fixed when an existing projection target is resized`, () => {
	vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockImplementation(
		function (this: HTMLElement) {
			return parseFloat(this.style.width)
		},
	)
	const props = {
		"layout:animate": true,
		style: `width:100px;transform-origin:25px 0`,
	}
	const f = fixture({}, props)
	const { node } = probe.nodes[0]
	expect(node.latestValues.originX).toBe(0.25)
	f.update({ ...props, style: props.style.replace(`100px`, `200px`) })
	expect(node.latestValues.originX).toBe(0.125)
})

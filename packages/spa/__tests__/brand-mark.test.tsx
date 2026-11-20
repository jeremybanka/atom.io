/** @jsxImportSource @atom.io/spa */
import { render, useGetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { Silo } from "atom.io"
import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import { BrandMark, type BrandMarkProps } from "../src/BrandMark.tsx"
import { renderToString } from "../src/server.ts"

vi.mock(`three`, async (actual) => ({
	...(await actual<typeof THREE>()),
	WebGLRenderer: vi.fn(function (options) {
		return {
			domElement: options.canvas,
			setSize: vi.fn(),
			setPixelRatio: vi.fn(),
			render: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.doUnmock(`../src/BrandMarkScene.tsx`)
	vi.restoreAllMocks()
	document.body.replaceChildren()
})
function fixture(props: BrandMarkProps = {}) {
	let frame: (time: number) => void = () => {}
	const stop = vi.fn()
	const silo = new Silo({
		name: `brand`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`main`)
	const propsAtom = silo.atom<BrandMarkProps>({ key: `props`, default: props })
	document.body.append(host)
	const root = render(
		() => {
			const get = useGetter(propsAtom)
			return <BrandMark {...get()} />
		},
		host,
		{
			store: silo.store,
			capabilities: [
				{
					...motionCapability({ reducedMotion: `always` }),
					scheduleFrame(run) {
						frame = run
						return stop
					},
				},
			],
		},
	)
	cleanups.push(root.dispose)
	return {
		host,
		root,
		stop,
		update(next: BrandMarkProps) {
			silo.setState(propsAtom, next)
			root.flush()
		},
		tick: (time: number) => {
			frame(time)
			root.flush()
		},
	}
}

it(`renders the orbital, follows reduced-motion and document visibility, and owns its resources`, async () => {
	const preference = new EventTarget() as MediaQueryList
	Object.defineProperty(preference, `matches`, { value: false, writable: true })
	vi.spyOn(window, `matchMedia`).mockReturnValue(preference)
	const hidden = vi.spyOn(document, `hidden`, `get`).mockReturnValue(false)
	const removed = vi.spyOn(preference, `removeEventListener`)
	const f = fixture()
	await vi.waitFor(() => {
		expect(f.host.querySelector(`brand-mark`)?.getAttribute(`data-live`)).toBe(
			`true`,
		)
	})
	const renderer = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const draws = vi.mocked(renderer.render)
	const scene = draws.mock.calls[0][0] as THREE.Scene
	const group = scene.children.find((node) => node instanceof THREE.Group)!
	const meshes = group.children as THREE.Mesh<
		THREE.BufferGeometry,
		THREE.MeshToonMaterial
	>[]
	expect(meshes).toHaveLength(3)
	expect(meshes.map((mesh) => mesh.material.color.getHexString())).toEqual([
		`ff3366`,
		`ff3366`,
		`0099ff`,
	])
	expect(
		scene.children
			.find((node) => node instanceof THREE.PointLight)
			?.position.toArray(),
	).toEqual([1.8, 1.7, 3.5])
	expect(vi.mocked(THREE.WebGLRenderer).mock.lastCall?.[0]).toMatchObject({
		alpha: true,
		antialias: true,
		powerPreference: `low-power`,
	})
	const geometries = meshes.map((mesh) => vi.spyOn(mesh.geometry, `dispose`))
	const materials = [...new Set(meshes.map((mesh) => mesh.material))].map(
		(material) => vi.spyOn(material, `dispose`),
	)
	f.tick(0)
	f.tick(16)
	const angle = group.rotation.y
	expect(angle).toBeGreaterThan(1.1)
	Object.defineProperty(preference, `matches`, { value: true })
	preference.dispatchEvent(new Event(`change`))
	f.tick(32)
	const count = draws.mock.calls.length
	f.tick(48)
	expect(draws).toHaveBeenCalledTimes(count)
	expect(group.rotation.y).toBe(angle)
	window.dispatchEvent(new Event(`resize`))
	f.tick(64)
	expect(draws).toHaveBeenCalledTimes(count + 1)
	hidden.mockReturnValue(true)
	document.dispatchEvent(new Event(`visibilitychange`))
	f.tick(80)
	expect(draws).toHaveBeenCalledTimes(count + 1)
	hidden.mockReturnValue(false)
	document.dispatchEvent(new Event(`visibilitychange`))
	f.tick(96)
	expect(draws).toHaveBeenCalledTimes(count + 2)
	Object.defineProperty(preference, `matches`, { value: false })
	preference.dispatchEvent(new Event(`change`))
	f.tick(5000)
	expect(group.rotation.y - angle).toBeCloseTo((0.1 * Math.PI) / 128)
	f.root.dispose()
	for (const dispose of [...geometries, ...materials])
		expect(dispose).toHaveBeenCalledOnce()
	expect(renderer.dispose).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
	expect(removed).toHaveBeenCalledOnce()
})

it(`keeps the static mark when WebGL cannot initialize`, async () => {
	const previous = vi.mocked(THREE.WebGLRenderer).mock.calls.length
	vi.mocked(THREE.WebGLRenderer).mockImplementationOnce(function () {
		throw new Error(`No WebGL`)
	})
	const f = fixture()
	await vi.waitFor(() => {
		expect(vi.mocked(THREE.WebGLRenderer).mock.calls.length).toBeGreaterThan(
			previous,
		)
	})
	await vi.waitFor(() => {
		expect(f.host.querySelector(`canvas`)).toBeNull()
	})
	expect(f.host.querySelector(`brand-mark`)?.getAttribute(`data-live`)).toBe(
		`false`,
	)
	expect(f.host.querySelector(`brand-mark`)?.getAttribute(`aria-hidden`)).toBe(
		`true`,
	)
})

it.each([false, true])(
	`keeps the fallback if the graphics import fails (disposed: %s)`,
	async (disposed) => {
		let fail!: (error: Error) => void
		vi.doMock(
			`../src/BrandMarkScene.tsx`,
			() =>
				new Promise((_resolve, reject) => {
					fail = reject
				}),
		)
		const f = fixture()
		await vi.waitFor(() => {
			expect(fail).toBeTypeOf(`function`)
		})
		if (disposed) f.root.dispose()
		fail(new Error(`Chunk unavailable`))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(f.host.querySelector(`canvas`)).toBeNull()
		expect(
			f.host.querySelector(`brand-mark`)?.getAttribute(`data-live`) ?? `false`,
		).toBe(`false`)
	},
)

it(`ignores a graphics import that completes after disposal`, async () => {
	let complete!: (value: { BrandMarkScene: () => null }) => void
	vi.doMock(
		`../src/BrandMarkScene.tsx`,
		() =>
			new Promise((resolve) => {
				complete = resolve
			}),
	)
	const f = fixture()
	await vi.waitFor(() => {
		expect(complete).toBeTypeOf(`function`)
	})
	f.root.dispose()
	const scene = vi.fn(() => null)
	complete({ BrandMarkScene: scene })
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(scene).not.toHaveBeenCalled()
	expect(f.host.querySelector(`canvas`)).toBeNull()
})

it(`supports standalone sizing, class forwarding and a static server render`, async () => {
	vi.spyOn(window, `devicePixelRatio`, `get`).mockReturnValue(3)
	const f = fixture({ size: 45, class: `example`, variant: `mark` })
	await vi.waitFor(() => {
		expect(f.host.querySelector(`brand-mark`)?.getAttribute(`data-live`)).toBe(
			`true`,
		)
	})
	const mark = f.host.querySelector<HTMLElement>(`brand-mark`)!
	expect(mark.style.width).toBe(`45px`)
	expect(mark.getAttribute(`data-size`)).toBe(`45`)
	expect(mark.classList.contains(`example`)).toBe(true)
	const renderer = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2)
	f.update({ size: 32 })
	window.dispatchEvent(new Event(`resize`))
	f.tick(16)
	expect(mark.style.width).toBe(`32px`)
	expect(renderer.setSize).toHaveBeenLastCalledWith(32, 32)
	const html = renderToString(() => <BrandMark size={32} />)
	expect(html).toContain(`brand-mark`)
	expect(html).toContain(`data-size="32"`)
	expect(html).toContain(`32px`)
	expect(html).not.toContain(`canvas`)
})

it.each([500, 10000])(
	`preserves splash framing and drawing-buffer limits at width %s`,
	async (width) => {
		vi.spyOn(window, `innerWidth`, `get`).mockReturnValue(width)
		vi.spyOn(window, `innerHeight`, `get`).mockReturnValue(10000)
		vi.spyOn(window, `devicePixelRatio`, `get`).mockReturnValue(
			width === 500 ? 0 : 3,
		)
		const f = fixture({ variant: `splash` })
		await vi.waitFor(() => {
			expect(f.host.querySelector(`brand-mark`)?.getAttribute(`data-live`)).toBe(
				`true`,
			)
		})
		const renderer = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
			.value as THREE.WebGLRenderer
		const [scene, camera] = vi.mocked(renderer.render).mock.calls[0]
		const group = scene.children.find((node) => node instanceof THREE.Group)!
		expect(group.scale.x).toBe(width < 680 ? 0.52 : 0.72)
		expect(group.position.y).toBe(width < 680 ? -0.08 : 0)
		expect((camera as THREE.PerspectiveCamera).aspect).toBe(width / 10000)
		const ratio = vi.mocked(renderer.setPixelRatio).mock.lastCall![0]
		expect(ratio).toBeLessThanOrEqual(1.35)
		expect(width * 2 * 20000 * ratio ** 2).toBeLessThanOrEqual(16_000_000.01)
		expect(f.host.querySelector<HTMLElement>(`brand-mark`)!.style.width).toBe(``)
	},
)
